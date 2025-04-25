const express = require('express');
const router = express.Router();
const CameraControl = require('../services/cameraControl');
const cameraControl = new CameraControl();
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const poseTracker = require('../services/poseTracker');
const config = require('../config.json'); // Read the full config
const sessionService = require('../services/sessionService');
const path = require('path');

// --- Auto-add default camera on startup ---
async function initializeDefaultCamera() {
    try {
        const defaultCameraConfig = config.cameraDefaults && config.cameraDefaults[0];
        if (defaultCameraConfig) {
            const defaultCameraName = 'Camera 1';
            // Check if camera already exists (e.g., due to persistence or prior init)
            if (!cameraControl.getCamera(defaultCameraName)) {
                console.log(`Attempting to add default camera '${defaultCameraName}' on startup...`);
                await cameraControl.addCamera(
                    defaultCameraName,
                    defaultCameraConfig.previewDevice,
                    defaultCameraConfig.recordingDevice,
                    defaultCameraConfig.ptzDevice
                );
                console.log(`Default camera '${defaultCameraName}' added with config:`, defaultCameraConfig);
            } else {
                console.log(`Default camera '${defaultCameraName}' already exists.`);
            }
        } else {
            console.warn('No default camera configuration found in config.json (cameraDefaults[0]).');
        }
    } catch (err) {
        console.error('Error initializing default camera:', err);
    }
}

// Call the initialization function
initializeDefaultCamera();
// ------------------------------------------

// Get available cameras
router.get('/cameras', (req, res) => {
    const cameras = cameraControl.getCameras();
    // Only log if cameras are found to avoid unnecessary logging at startup
    if (cameras.length > 0) {
        console.log('Available cameras:', cameras);
    }
    res.json(cameras);
});

// Add a new camera
router.post('/add', async (req, res) => {
    const { name, previewDevice, recordingDevice, ptzDevice } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    try {
        const success = await cameraControl.addCamera(name, previewDevice, recordingDevice, ptzDevice);
        if (success) {
            res.json({ success: true, message: `Camera ${name} added` });
        } else {
            res.status(400).json({ success: false, message: `Camera ${name} already exists` });
        }
    } catch (err) {
        console.error('Error adding camera:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Remove a camera
router.post('/remove', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    const success = cameraControl.removeCamera(name);
    if (success) {
        res.json({ success: true, message: `Camera ${name} removed` });
    } else {
        res.status(400).json({ success: false, message: `Camera ${name} not found` });
    }
});

// Get available devices
router.get('/devices', async (req, res) => {
    try {
        const devices = await cameraControl.detectVideoDevices();
        res.json(devices);
    } catch (err) {
        console.error('Error getting devices:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get available PTZ devices
router.get('/ptz-devices', async (req, res) => {
    try {
        // Only scan for PTZ devices if there are cameras configured
        const cameras = cameraControl.getCameras();
        if (cameras.length === 0) {
            return res.json([]);
        }

        const devices = await cameraControl.scanPTZDevices();
        res.json(devices);
    } catch (err) {
        console.error('Error getting PTZ devices:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set preview device for a camera
router.post('/preview-device', (req, res) => {
    const { cameraName, deviceId } = req.body;
    if (!cameraName || !deviceId) {
        return res.status(400).json({ success: false, message: 'Camera name and device ID are required' });
    }

    try {
        cameraControl.setPreviewDevice(cameraName, deviceId);
        res.json({ success: true, message: 'Preview device set' });
    } catch (err) {
        console.error('Error setting preview device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set recording device for a camera
router.post('/recording-device', (req, res) => {
    const { cameraName, deviceId } = req.body;
    if (!cameraName || !deviceId) {
        return res.status(400).json({ success: false, message: 'Camera name and device path are required' });
    }

    try {
        cameraControl.setRecordingDevice(cameraName, deviceId);
        console.log(`Recording device set for camera: ${cameraName}, device path: ${deviceId}`);
        res.json({ success: true, message: 'Recording device set' });
    } catch (err) {
        console.error('Error setting recording device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set PTZ device for a camera
router.post('/ptz-device', (req, res) => {
    const { cameraName, deviceId } = req.body;
    if (!cameraName || !deviceId) {
        return res.status(400).json({ success: false, message: 'Camera name and device ID are required' });
    }

    try {
        cameraControl.setPTZDevice(cameraName, deviceId);
        res.json({ success: true, message: 'PTZ device set' });
    } catch (err) {
        console.error('Error setting PTZ device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set PTZ for a specific camera
router.post('/ptz', (req, res) => {
    const { cameraName, pan, tilt, zoom } = req.body;
    if (!cameraName) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    try {
        cameraControl.setPTZ(cameraName, { pan, tilt, zoom });
        res.json({ success: true, message: 'PTZ command sent' });
    } catch (err) {
        console.error('PTZ error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Record video from a specific camera
router.post('/:cameraName/record', async (req, res) => {
    const { cameraName } = req.params;
    const { useFfmpeg, resolution } = req.query;

    try {
        console.log(`[Record Route] Handling request for: ${cameraName}`);
        const camera = cameraControl.getCamera(cameraName);
        if (!camera) {
            console.error(`[Record Route] Camera not found: ${cameraName}`);
            return res.status(404).json({ success: false, message: `Camera ${cameraName} not found` });
        }
        console.log(`[Record Route] Found camera instance for ${cameraName}`);

        const devicePath = camera.getRecordingDevice();
        console.log(`[Record Route] Retrieved recording device ID from instance: ${devicePath}`);

        if (!devicePath && devicePath !== 0) {
            console.error(`[Record Route] No recording device configured for ${cameraName}`);
            return res.status(400).json({ success: false, message: `No recording device configured for camera ${cameraName}` });
        }

        // Get Session Directory
        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (sessionError) {
            console.error(`[Record Route] Error getting session directory for ${cameraName}:`, sessionError);
            return res.status(500).json({ success: false, message: 'Could not determine session directory.' });
        }

        // Parse resolution
        let width = 1920;
        let height = 1080;
        if (resolution && resolution.includes('x')) {
            [width, height] = resolution.split('x').map(Number);
        } else {
            console.warn(`[Record Route] Invalid resolution '${resolution}', defaulting.`);
        }

        const recordingMethod = useFfmpeg === 'true' ? 'ffmpeg' : 'gstreamer';
        console.log(`[Record Route] Recording from camera: ${cameraName} (ID: ${devicePath}) using ${recordingMethod} at ${width}x${height}`);

        const recordingHelper = useFfmpeg === 'true' ? ffmpegHelper : gstreamerHelper;

        // --- Define Relative Paths --- 
        const TEMP_RECORD = config.tempRecord;         // e.g., temp_record.mp4
        const RAW_DIR = config.framesRawDir;           // e.g., frames_raw
        const OVERLAY_DIR = config.framesOverlayDir;   // e.g., frames_overlay
        const OUT_OVER = config.videoOverlay;        // e.g., overlay.mp4

        // Pass relative paths to helpers
        await recordingHelper.captureVideo(TEMP_RECORD, 10, devicePath, { width, height });

        console.log(`[Record Route] Processing recorded video for ${cameraName}`);
        await ffmpegHelper.extractFrames(TEMP_RECORD, RAW_DIR);

        // Construct absolute paths for poseTracker
        const absoluteRawDir = path.join(sessionDir, RAW_DIR);
        const absoluteOverlayDir = path.join(sessionDir, OVERLAY_DIR);
        await poseTracker.processFrames(absoluteRawDir, absoluteOverlayDir);

        // Pass relative paths to helper
        await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);
        console.log(`[Record Route] Processing complete for ${cameraName}`);

        res.json({
            success: true,
            message: 'Video recorded and pose processed!',
            overlayName: OUT_OVER // Return relative path
        });
    } catch (err) {
        console.error(`[Record Route] Error during recording for ${cameraName}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;