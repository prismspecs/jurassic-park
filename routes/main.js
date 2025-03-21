const express = require('express');
const router = express.Router();
const path = require('path');
const buildHomeHTML = require('../views/homeView');
const { initScene } = require('../controllers/sceneController');
const { recordVideo } = require('../controllers/videoController');
const { scenes } = require('../services/sceneService');

// Home route
router.get('/', (req, res) => {
    const html = buildHomeHTML(scenes);
    res.send(html);
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