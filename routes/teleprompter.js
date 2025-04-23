const express = require('express');
const router = express.Router();
const { buildTeleprompterHTML, buildCharacterTeleprompterHTML } = require('../views/teleprompterView');
const { broadcast, broadcastTeleprompterStatus } = require('../websocket/broadcaster');
const { scenes } = require('../services/sceneService');
const { getCurrentScene } = require('../controllers/sceneController');

// API endpoint to get current scene
router.get('/api/currentScene', (req, res) => {
    res.json({ scene: getCurrentScene() });
});

// Teleprompter page
router.get('/', async (req, res) => {
    try {
        const html = await buildTeleprompterHTML();
        res.send(html);
    } catch (error) {
        console.error('Error rendering teleprompter page:', error);
        res.status(500).send('Error rendering teleprompter page');
    }
});

// Character-specific teleprompter page
router.get('/:character', async (req, res) => {
    try {
        // We no longer need to check for the scene or character here.
        // The client-side JS in characterTeleprompter.ejs will fetch the current scene
        // and display the appropriate message ("Wait for scene..." or the video).

        /* // REMOVED THIS BLOCK
        const character = req.params.character;

        // Check if there's a current scene
        const currentScene = getCurrentScene();
        if (!currentScene) {
            return res.status(400).send('No scene is currently active');
        }

        // Check if the character exists in the current scene
        const scene = scenes.find(s => s.directory === currentScene);
        if (!scene) {
            return res.status(404).send('Scene not found');
        }

        const characterExists = Object.keys(scene.takes[0].characters).includes(character);
        if (!characterExists) {
            return res.status(404).send('Character not found in current scene');
        }
        */

        // Always send the HTML. The client will handle the state.
        const html = await buildCharacterTeleprompterHTML();
        res.send(html);
    } catch (error) {
        console.error('Error rendering character teleprompter page:', error);
        res.status(500).send('Error rendering character teleprompter page');
    }
});

// Update teleprompter text
router.post('/updateTeleprompter', express.json(), (req, res) => {
    const { text, image } = req.body;
    broadcast({
        type: 'TELEPROMPTER',
        text,
        image
    });
    res.json({ success: true, message: 'Teleprompter updated' });
});

// Clear teleprompter
router.post('/clearTeleprompter', (req, res) => {
    broadcast({
        type: 'CLEAR_TELEPROMPTER'
    });
    res.json({ success: true, message: 'Teleprompter cleared' });
});

// Play video in teleprompter
router.post('/playTeleprompterVideo', express.json(), (req, res) => {
    const { videoPath } = req.body;
    if (!videoPath) {
        return res.status(400).json({ success: false, message: 'Video path is required' });
    }

    broadcast({
        type: 'PLAY_VIDEO',
        videoPath: videoPath
    });

    res.json({ success: true, message: 'Video playback started' });
});

// Send a status update message to all character teleprompters
router.post('/status', express.json(), (req, res) => {
    const { message } = req.body;
    if (message === undefined || message === null) {
        return res.status(400).json({ success: false, message: "Missing 'message' in request body" });
    }
    // Use the specific broadcast function
    broadcastTeleprompterStatus(String(message)); 
    res.json({ success: true, message: 'Teleprompter status updated' });
});

module.exports = router; 