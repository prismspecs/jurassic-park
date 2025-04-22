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

        // Get the camera name and recording method from the request
        const { cameraName, useFfmpeg } = req.query;
        if (!cameraName) {
            throw new Error('No camera specified. Please select a camera first.');
        }

        const camera = cameraControl.getCamera(cameraName);
        if (!camera) {
            throw new Error(`Camera ${cameraName} not found.`);
        }

        const devicePath = camera.getRecordingDevice();
        if (!devicePath) {
            throw new Error(`No recording device configured for camera ${cameraName}.`);
        }

        const recordingMethod = useFfmpeg === 'true' ? 'ffmpeg' : 'gstreamer';
        broadcastConsole(`Recording from camera: ${cameraName} (${devicePath}) using ${recordingMethod}`);

        // Use GStreamer by default, ffmpeg if explicitly requested
        const recordingHelper = useFfmpeg === 'true' ? ffmpegHelper : gstreamerHelper;
        await recordingHelper.captureVideo(TEMP_RECORD, 3, devicePath);
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