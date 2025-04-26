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
        sessionDirectory, // Base directory for the session
        durationSec
    } = workerData;

    const recordingMethod = useFfmpeg ? 'ffmpeg' : 'gstreamer';
    const recordingHelper = useFfmpeg ? ffmpegHelper : gstreamerHelper;
    const effectiveDuration = durationSec || config.testRecordingDuration || 10; // Default duration

    console.log(`[Worker ${cameraName}] Starting CAPTURE ONLY: ${recordingMethod}, ${resolution.width}x${resolution.height}, Device: ${devicePath}, Duration: ${effectiveDuration}s`);
    parentPort.postMessage({ status: 'starting', camera: cameraName, message: `Capture (${recordingMethod})...` });

    // Define the relative path for the *original* video within the camera's subdirectory
    const VIDEO_ORIGINAL_REL = path.join(cameraName, config.videoOriginal || 'original.mp4');

    try {
        // 1. Capture Video
        parentPort.postMessage({ status: 'capture_start', camera: cameraName });
        console.log(`[Worker ${cameraName}] Capturing video to ${VIDEO_ORIGINAL_REL}`);
        // Pass the absolute session directory and the relative output path
        await recordingHelper.captureVideo(VIDEO_ORIGINAL_REL, effectiveDuration, devicePath, resolution, sessionDirectory);
        console.log(`[Worker ${cameraName}] ✅ Video capture complete: ${VIDEO_ORIGINAL_REL}`);
        parentPort.postMessage({ status: 'capture_complete', camera: cameraName, resultPath: VIDEO_ORIGINAL_REL });

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