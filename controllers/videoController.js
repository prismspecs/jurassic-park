const path = require('path');
const config = require('../config.json');
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const poseTracker = require('../services/poseTracker');
const { broadcastConsole } = require('../websocket/broadcaster');
const cameraControl = require('../services/cameraControl').getInstance();

async function recordVideo(req, res) {
    broadcastConsole('Video recording warming up...');

    try {
        const RAW_DIR = path.join(__dirname, '..', config.framesRawDir);
        const OVERLAY_DIR = path.join(__dirname, '..', config.framesOverlayDir);
        const OUT_ORIG = config.videoOriginal;
        const OUT_OVER = config.videoOverlay;
        const TEMP_RECORD = config.tempRecord;

        // Get the camera name, recording method, and resolution from the request query
        const { cameraName, useFfmpeg, resolution } = req.query;
        if (!cameraName) {
            // FIXME: If no camera name is provided, how do we know which camera to record from?
            // Need a concept of a default or globally selected recording camera.
            // For now, defaulting to 'Camera 1' as a placeholder.
            // throw new Error('No camera specified. Please select a camera first.');
             const defaultCameraName = 'Camera 1';
             console.warn(`No camera name specified in request, defaulting to ${defaultCameraName}`);
             broadcastConsole(`Warning: No camera specified, defaulting to ${defaultCameraName}`, 'warn');
             req.query.cameraName = defaultCameraName; // Inject for later use
        }

        const camera = cameraControl.getCamera(req.query.cameraName);
        if (!camera) {
            throw new Error(`Camera ${req.query.cameraName} not found.`);
        }

        const devicePath = camera.getRecordingDevice();
        if (!devicePath) {
            throw new Error(`No recording device configured for camera ${req.query.cameraName}.`);
        }
        
        // Parse the resolution string (e.g., "1920x1080")
        let width = 1920; // Default width
        let height = 1080; // Default height
        if (resolution && resolution.includes('x')) {
            [width, height] = resolution.split('x').map(Number);
        } else {
            console.warn(`Invalid or missing resolution: ${resolution}. Defaulting to ${width}x${height}`);
            broadcastConsole(`Warning: Invalid resolution, defaulting to ${width}x${height}`, 'warn');
        }

        const recordingMethod = useFfmpeg === 'true' ? 'ffmpeg' : 'gstreamer';
        broadcastConsole(`Recording from camera: ${req.query.cameraName} (${devicePath}) using ${recordingMethod} at ${width}x${height}`);

        // Choose the appropriate helper based on the method
        const recordingHelper = useFfmpeg === 'true' ? ffmpegHelper : gstreamerHelper;

        // Pass the parsed width and height to the captureVideo function
        await recordingHelper.captureVideo(TEMP_RECORD, 10, devicePath, { width, height });
        
        // The rest of the processing remains the same
        await ffmpegHelper.extractFrames(TEMP_RECORD, RAW_DIR);
        await poseTracker.processFrames(RAW_DIR, OVERLAY_DIR);
        await ffmpegHelper.encodeVideo(RAW_DIR, OUT_ORIG);
        await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);

        // use broadcastConsole to print the name of the video files and that it has started
        broadcastConsole(`Video recording started: ${OUT_ORIG} and ${OUT_OVER}`);

        res.json({
            success: true,
            message: 'Video recorded and pose processed!',
            originalName: OUT_ORIG,
            overlayName: OUT_OVER
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    recordVideo
}; 