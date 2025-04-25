const path = require('path');
const config = require('../config.json');
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const poseTracker = require('../services/poseTracker');
const sessionService = require('../services/sessionService');
const { broadcastConsole } = require('../websocket/broadcaster');
const cameraControl = require('../services/cameraControl').getInstance();

async function recordVideo(req, res) {
    broadcastConsole('Video recording warming up...');

    try {
        const RAW_DIR = config.framesRawDir;
        const OVERLAY_DIR = config.framesOverlayDir;
        const OUT_ORIG = config.videoOriginal;
        const OUT_OVER = config.videoOverlay;
        const TEMP_RECORD = config.tempRecord;

        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (error) {
            console.error("Error getting session directory in recordVideo:", error);
            return res.status(500).json({ success: false, message: 'Could not determine session directory.' });
        }

        const { cameraName, useFfmpeg, resolution } = req.query;
        if (!cameraName) {
            const defaultCameraName = 'Camera 1';
            console.warn(`No camera name specified in request, defaulting to ${defaultCameraName}`);
            broadcastConsole(`Warning: No camera specified, defaulting to ${defaultCameraName}`, 'warn');
            req.query.cameraName = defaultCameraName;
        }

        const camera = cameraControl.getCamera(req.query.cameraName);
        if (!camera) {
            throw new Error(`Camera ${req.query.cameraName} not found.`);
        }

        const devicePath = camera.getRecordingDevice();
        if (!devicePath) {
            throw new Error(`No recording device configured for camera ${req.query.cameraName}.`);
        }

        let width = 1920;
        let height = 1080;
        if (resolution && resolution.includes('x')) {
            [width, height] = resolution.split('x').map(Number);
        } else {
            console.warn(`Invalid or missing resolution: ${resolution}. Defaulting to ${width}x${height}`);
            broadcastConsole(`Warning: Invalid resolution, defaulting to ${width}x${height}`, 'warn');
        }

        const recordingMethod = useFfmpeg === 'true' ? 'ffmpeg' : 'gstreamer';
        broadcastConsole(`Recording from camera: ${req.query.cameraName} (${devicePath}) using ${recordingMethod} at ${width}x${height}`);

        const recordingHelper = useFfmpeg === 'true' ? ffmpegHelper : gstreamerHelper;

        await recordingHelper.captureVideo(TEMP_RECORD, 10, devicePath, { width, height });
        await ffmpegHelper.extractFrames(TEMP_RECORD, RAW_DIR);

        const absoluteRawDir = path.join(sessionDir, RAW_DIR);
        const absoluteOverlayDir = path.join(sessionDir, OVERLAY_DIR);
        await poseTracker.processFrames(absoluteRawDir, absoluteOverlayDir);

        await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);

        broadcastConsole(`Video recording started: ${OUT_OVER}`);

        res.json({
            success: true,
            message: 'Video recorded and pose processed!',
            overlayName: OUT_OVER
        });
    } catch (err) {
        console.error(err);
        broadcastConsole(`Error during video recording/processing: ${err.message}`, 'error');
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    recordVideo
}; 