const express = require('express');
const router = express.Router();
const buildTeleprompterHTML = require('../views/teleprompterView');

// Teleprompter page
router.get('/teleprompter', (req, res) => {
    const html = buildTeleprompterHTML();
    res.send(html);
});

// Update teleprompter text
router.post('/updateTeleprompter', express.json(), (req, res) => {
    const { text, image } = req.body;
    global.broadcast({
        type: 'TELEPROMPTER',
        text,
        image
    });
    res.json({ success: true, message: 'Teleprompter updated' });
});

// Clear teleprompter
router.post('/clearTeleprompter', (req, res) => {
    global.broadcast({
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

    global.broadcast({
        type: 'PLAY_VIDEO',
        videoPath: videoPath
    });

    res.json({ success: true, message: 'Video playback started' });
});

module.exports = router; 