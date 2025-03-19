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

module.exports = router; 