const express = require('express');
const router = express.Router();
const cameraControl = require('../services/cameraControl');
const { recordVideo } = require('../controllers/videoController');

// Get available cameras
router.get('/cameras', (req, res) => {
    const cameras = cameraControl.getCameras();
    console.log('Available cameras:', cameras);
    res.json(cameras);
});

// Select camera
router.post('/selectCamera', express.json(), (req, res) => {
    const { camera } = req.body;
    const success = cameraControl.setCamera(camera);
    if (success) {
        res.json({ success: true, message: `Selected camera: ${camera}` });
    } else {
        res.status(400).json({ success: false, message: `Invalid camera: ${camera}` });
    }
});

// Handle PTZ controls
router.post('/ptz', express.json(), (req, res) => {
    const { pan, tilt, zoom } = req.body;
    try {
        cameraControl.setPTZ({ pan, tilt, zoom });
        res.json({ success: true, message: 'PTZ controls updated' });
    } catch (err) {
        console.error('PTZ control error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Record a video
router.get('/recordVideo', recordVideo);

module.exports = router; 