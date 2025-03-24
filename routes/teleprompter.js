const express = require('express');
const router = express.Router();
const buildTeleprompterHTML = require('../views/teleprompterView');
const { broadcast } = require('../websocket/broadcaster');

// Teleprompter page
router.get('/', (req, res) => {
    const html = buildTeleprompterHTML();
    res.send(html);
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

module.exports = router; 