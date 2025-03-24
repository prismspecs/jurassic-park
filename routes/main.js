const express = require('express');
const router = express.Router();
const path = require('path');
const buildHomeHTML = require('../views/homeView');
const buildTeleprompterHTML = require('../views/teleprompterView');
const { initScene, actorsReady, action } = require('../controllers/sceneController');
const { recordVideo } = require('../controllers/videoController');
const { scenes } = require('../services/sceneService');
const cameraControl = require('../services/cameraControl');
const aiVoice = require('../services/aiVoice');
const { broadcastConsole } = require('../websocket/broadcaster');

// Home route
router.get('/', (req, res) => {
    const html = buildHomeHTML(scenes);
    res.send(html);
});

// Teleprompter page
router.get('/teleprompter', (req, res) => {
    const html = buildTeleprompterHTML();
    res.send(html);
});

// Update teleprompter text
router.post('/updateTeleprompter', express.json(), (req, res) => {
    const { text, image } = req.body;
    global.wss.clients.forEach((client) => {
        if (client.readyState === require('ws').OPEN) {
            client.send(JSON.stringify({
                type: 'TELEPROMPTER',
                text,
                image
            }));
        }
    });
    res.json({ success: true, message: 'Teleprompter updated' });
});

// Clear teleprompter
router.post('/clearTeleprompter', (req, res) => {
    global.wss.clients.forEach((client) => {
        if (client.readyState === require('ws').OPEN) {
            client.send(JSON.stringify({
                type: 'CLEAR_TELEPROMPTER'
            }));
        }
    });
    res.json({ success: true, message: 'Teleprompter cleared' });
});

// Handle actors ready state
router.post('/actorsReady', (req, res) => {
    actorsReady();
    res.json({
        success: true,
        message: 'Actors ready state received'
    });
});

// Handle action button press
router.post('/action', (req, res) => {
    action();
    res.json({
        success: true,
        message: 'Action started'
    });
});

// Handle voice bypass toggle
router.post('/setVoiceBypass', express.json(), (req, res) => {
    const { enabled } = req.body;
    aiVoice.setBypass(enabled);
    broadcastConsole(`Voice bypass ${enabled ? 'enabled' : 'disabled'}`);
    res.json({
        success: true,
        message: `Voice bypass ${enabled ? 'enabled' : 'disabled'}`
    });
});

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

// Initialize a scene
router.get('/initScene/:directory', (req, res) => {
    const directory = decodeURIComponent(req.params.directory);
    initScene(directory);
    res.json({ success: true, message: 'Scene started', directory: directory });
});

// Record a video (test)
router.get('/recordVideo', recordVideo);

// Play video in teleprompter
router.post('/playTeleprompterVideo', express.json(), (req, res) => {
    const { videoPath } = req.body;
    if (!videoPath) {
        return res.status(400).json({ success: false, message: 'Video path is required' });
    }

    // Broadcast to all connected WebSocket clients
    global.wss.clients.forEach((client) => {
        if (client.readyState === require('ws').OPEN) {
            client.send(JSON.stringify({
                type: 'PLAY_VIDEO',
                videoPath: videoPath
            }));
        }
    });

    res.json({ success: true, message: 'Video playback started' });
});

module.exports = router; 