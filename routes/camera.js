const express = require('express');
const router = express.Router();
const CameraControl = require('../services/cameraControl');
const cameraControl = new CameraControl();
const { recordVideo } = require('../controllers/videoController');

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
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    try {
        const success = await cameraControl.addCamera(name);
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
        return res.status(400).json({ success: false, message: 'Camera name and device ID are required' });
    }

    try {
        cameraControl.setRecordingDevice(cameraName, deviceId);
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
router.get('/recordVideo', recordVideo);

module.exports = router; 