const express = require('express');
const router = express.Router();
const path = require('path');
const { buildHomeHTML } = require('../views/homeView');
const { initScene, actorsReady, action } = require('../controllers/sceneController');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcastConsole } = require('../websocket/broadcaster');
const teleprompterRouter = require('./teleprompter');
const cameraRouter = require('./camera');

// Test console broadcasting
router.post('/testConsole', (req, res) => {
    broadcastConsole('This is a test console message', 'info');
    res.json({ success: true, message: 'Test message sent' });
});

// Home route
router.get('/', async (req, res) => {
    try {
        const html = await buildHomeHTML(scenes);
        res.send(html);
    } catch (error) {
        console.error('Error rendering home page:', error);
        res.status(500).send('Error rendering home page');
    }
});

// Mount teleprompter routes
router.use('/teleprompter', teleprompterRouter);

// Mount camera routes
router.use('/camera', cameraRouter);

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

// Initialize a scene
router.get('/initScene/:directory', (req, res) => {
    const directory = decodeURIComponent(req.params.directory);
    initScene(directory);
    res.json({ success: true, message: 'Scene started', directory: directory });
});

module.exports = router; 