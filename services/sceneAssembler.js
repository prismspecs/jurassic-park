const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { broadcastConsole, broadcast } = require('../websocket/broadcaster'); // To report progress/status
const sessionService = require('./sessionService'); // Needed?

/**
 * Assembles a scene from specified takes using FFmpeg.
 * Runs asynchronously and reports progress via WebSocket.
 *
 * @param {string} sceneDirectory - The directory name of the scene (e.g., "000 - test").
 * @param {Array<object>} takes - Array of take objects { shot, camera, in, out, take }.
 * @param {string} currentSessionId - The ID of the current session.
 * @returns {Promise<string>} A promise that resolves with the output path on success, or rejects on error.
 */
async function assembleSceneFFmpeg(sceneDirectory, takes, currentSessionId) {
    console.log(`[SceneAssembler] Starting assembly for session: ${currentSessionId}, scene: ${sceneDirectory}`);
    broadcastConsole(`[SceneAssembler] Starting assembly for scene: ${sceneDirectory}`, 'info');

    // Define output path
    const sanitizedSceneDir = sceneDirectory.replace(/[^a-zA-Z0-9_-]/g, '_'); // Sanitize for filename
    const outputFilename = `assembled_${sanitizedSceneDir}_${Date.now()}.mp4`;
    const outputPath = path.join(__dirname, '..', 'recordings', currentSessionId, outputFilename);
    const sessionBasePath = path.join(__dirname, '..', 'recordings', currentSessionId);

    console.log(`[SceneAssembler] Target output path: ${outputPath}`);
    console.log(`[SceneAssembler] Assembly payload (frames): ${JSON.stringify(takes, null, 2)}`);

    // --- FFmpeg Logic using Complex Filtergraph (Video Only) --- 

    // 1. Define Take File Structure/Naming Convention (CRITICAL)
    const assumedTakeBasePath = path.join(sessionBasePath, sceneDirectory);

    // 2. Validate Source Files & Build Filtergraph Inputs
    const inputFiles = [];
    const filterInputsVideo = []; // Names for video streams (e.g., [0:v])
    const trimSetptsFilters = []; // Combined trim/setpts filters for video
    let errors = [];
    let videoIndex = 0;

    for (const take of takes) {
        const sanitize = require('sanitize-filename');
        const safeShotName = sanitize(take.shot);
        const shotTakeDir = `${safeShotName}_${take.take}`;
        const sourceFilename = 'original.mp4'; // Assuming this filename
        const sourcePath = path.join(assumedTakeBasePath, shotTakeDir, take.camera, sourceFilename);
        
        console.log(`[SceneAssembler] Checking for source file: ${sourcePath}`);
        if (!fs.existsSync(sourcePath)) {
            const errorMsg = `Source file not found for take: ${JSON.stringify(take)} at path ${sourcePath}`;
            console.error(`[SceneAssembler] ${errorMsg}`);
            errors.push(errorMsg);
            continue; 
        }
        
        inputFiles.push('-i', sourcePath);

        // Define input stream specifiers for filtergraph
        const videoInputStream = `[${videoIndex}:v]`;
        filterInputsVideo.push(videoInputStream);
        
        // Define the filter for this segment (Video Only)
        const segmentVideoOutput = `[v${videoIndex}]`;
        trimSetptsFilters.push(
            `${videoInputStream}trim=start_frame=${take.inFrame}:end_frame=${take.outFrame},setpts=PTS-STARTPTS${segmentVideoOutput}`
        );

        videoIndex++;
    }

    if (errors.length > 0) {
        const combinedError = `Assembly failed: Could not find source files. Errors: ${errors.join(', ')}`;
        broadcastConsole(`[SceneAssembler] ${combinedError}`, 'error');
        return Promise.reject(new Error(combinedError)); 
    }
    
    if (videoIndex === 0) { // No valid inputs found
        const errorMsg = `Assembly failed: No valid input video segments found.`;
        broadcastConsole(`[SceneAssembler] ${errorMsg}`, 'error');
        return Promise.reject(new Error(errorMsg));
    }

    // 3. Construct Complex Filtergraph Command
    // Combine individual trim/setpts filters
    const trimSetptsFilterString = trimSetptsFilters.join(';');
    // Build the final concat filter string inputs
    const concatVideoInputs = trimSetptsFilters.map((_, i) => `[v${i}]`).join(''); 
    
    // Update concat filter for video only (v=1, a=0)
    const concatFilterString = `${concatVideoInputs}concat=n=${videoIndex}:v=1:a=0[outv]`; 

    const complexFiltergraph = `${trimSetptsFilterString};${concatFilterString}`;

    const ffmpegArgs = [
        ...inputFiles, 
        '-filter_complex', complexFiltergraph,
        '-map', '[outv]', // Map the output video only
        outputPath
    ];

    console.log(`[SceneAssembler] Running FFmpeg complex filtergraph command: ffmpeg ${ffmpegArgs.join(' ')}`);
    broadcastConsole(`[SceneAssembler] Starting FFmpeg filtergraph process for ${outputFilename}...`, 'info');

    // 4. Execute FFmpeg asynchronously (return a promise)
    return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

        let ffmpegOutput = '';
        ffmpegProcess.stdout.on('data', (data) => {
            const line = data.toString();
            ffmpegOutput += line;
            // console.log(`[ffmpeg stdout]: ${line.trim()}`);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const line = data.toString();
            ffmpegOutput += line;
            console.error(`[ffmpeg stderr]: ${line.trim()}`);
            broadcastConsole(`[FFmpeg]: ${line.trim()}`, 'ffmpeg');
        });

        ffmpegProcess.on('close', (code) => {
            console.log(`[SceneAssembler] FFmpeg process closed with code ${code}`);

            if (code === 0) {
                broadcastConsole(`[SceneAssembler] Assembly for ${outputFilename} completed successfully.`, 'success');
                broadcast({ type: 'ASSEMBLY_COMPLETE', payload: { sceneDirectory, outputPath } });
                resolve(outputPath);
            } else {
                const errorMsg = `FFmpeg process exited with error code ${code}. Output: ${ffmpegOutput}`;
                console.error(`[SceneAssembler] ${errorMsg}`);
                broadcastConsole(`[SceneAssembler] Assembly for ${sceneDirectory} failed (FFmpeg code ${code}). Check server logs.`, 'error');
                broadcast({ type: 'ASSEMBLY_FAILED', payload: { sceneDirectory, error: `FFmpeg failed with code ${code}` } });
                reject(new Error(errorMsg));
            }
        });

        ffmpegProcess.on('error', (err) => {
            console.error('[SceneAssembler] Failed to start FFmpeg process:', err);
            broadcastConsole(`[SceneAssembler] Failed to start FFmpeg process: ${err.message}`, 'error');
            broadcast({ type: 'ASSEMBLY_FAILED', payload: { sceneDirectory, error: `Failed to start FFmpeg: ${err.message}` } });
            reject(err);
        });
    });
}

module.exports = {
    assembleSceneFFmpeg
}; 