const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const config = require('../config.json');
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
// poseTracker is no longer needed here
// const poseTracker = require('../services/poseTracker');
// sessionService is not directly used if baseSessionDir is passed, but keep for potential fallback if needed
const sessionService = require('../services/sessionService');

async function runRecordingCapture() { // Renamed function for clarity
    const {
        cameraName,
        useFfmpeg,
        resolution,
        devicePath,
        // sessionDirectory, // OLD: Base directory for the session
        outputBasePath, // NEW: Base path for this specific scene/shot/take
        durationSec
    } = workerData;

    // Validate outputBasePath
    if (!outputBasePath) {
        const errorMsg = `[Worker ${cameraName}] Error: outputBasePath is missing in workerData.`;
        console.error(errorMsg);
        parentPort.postMessage({ status: 'error', camera: cameraName, message: errorMsg });
        return; // Stop execution
    }

    const recordingMethod = useFfmpeg ? 'ffmpeg' : 'gstreamer';
    const recordingHelper = useFfmpeg ? ffmpegHelper : gstreamerHelper;
    const effectiveDuration = durationSec || config.testRecordingDuration || 10; // Default duration

    console.log(`[Worker ${cameraName}] Starting CAPTURE ONLY: ${recordingMethod}, ${resolution.width}x${resolution.height}, Device: ${devicePath}, Duration: ${effectiveDuration}s, BasePath: ${outputBasePath}`);
    parentPort.postMessage({ status: 'starting', camera: cameraName, message: `Capture (${recordingMethod})...` });

    // Define the relative path for the *original* video within the camera's subdirectory
    // The filename itself comes from config
    const videoFilename = config.videoOriginal || 'original.mp4';
    const videoRelativePath = path.join(cameraName, videoFilename);
    // The absolute path is now base path + relative path
    const videoAbsolutePath = path.join(outputBasePath, videoRelativePath);

    try {
        // Ensure the specific output directory for this camera exists within the base path
        const cameraOutputDir = path.dirname(videoAbsolutePath);
        if (!fs.existsSync(cameraOutputDir)) {
            fs.mkdirSync(cameraOutputDir, { recursive: true });
            console.log(`[Worker ${cameraName}] Created camera output directory: ${cameraOutputDir}`);
        }

        // 1. Capture Video
        parentPort.postMessage({ status: 'capture_start', camera: cameraName });
        console.log(`[Worker ${cameraName}] Capturing video to ${videoAbsolutePath}`);
        // Pass the relative path (including camera name) and the base path to the helper
        await recordingHelper.captureVideo(videoRelativePath, effectiveDuration, devicePath, resolution, outputBasePath);
        console.log(`[Worker ${cameraName}] ✅ Video capture complete: ${videoAbsolutePath}`);
        // Report the absolute path back
        parentPort.postMessage({ status: 'capture_complete', camera: cameraName, resultPath: videoAbsolutePath });

        // --- Steps removed --- 
        // 2. Extract Frames (REMOVED)
        // 3. Process Poses (REMOVED)
        // 4. Encode Overlay Video (REMOVED)

        console.log(`[Worker ${cameraName}] Capture finished successfully. Post-processing skipped.`);

    } catch (error) {
        console.error(`[Worker ${cameraName}] Error during capture:`, error);
        parentPort.postMessage({ status: 'error', camera: cameraName, message: error.message, stack: error.stack });
    }
}

runRecordingCapture();