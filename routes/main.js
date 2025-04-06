const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { buildHomeHTML } = require('../views/homeView');
const { initScene, actorsReady, action } = require('../controllers/sceneController');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcastConsole } = require('../websocket/broadcaster');
const teleprompterRouter = require('./teleprompter');
const cameraRouter = require('./camera');

// Create temp_uploads directory if it doesn't exist
const tempDir = path.join(__dirname, '..', 'temp_uploads');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

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

// Handle loading new actors
router.post('/loadActors', upload.array('files'), async (req, res) => {
    try {
        const crypto = require('crypto');
        const actorsDir = path.join(__dirname, '..', 'database', 'actors');

        // Group files by their base name (without extension)
        const files = req.files;
        const fileGroups = {};
        const skippedActors = [];
        const processedActors = [];

        files.forEach(file => {
            const baseName = path.basename(file.originalname, path.extname(file.originalname));
            if (!fileGroups[baseName]) {
                fileGroups[baseName] = [];
            }
            fileGroups[baseName].push(file);
        });

        // Process each group of files
        for (const [baseName, groupFiles] of Object.entries(fileGroups)) {
            // Find the JSON file in the group
            const jsonFile = groupFiles.find(f => f.originalname.endsWith('.json'));
            if (!jsonFile) continue;

            // Read the JSON data
            const jsonPath = path.join(tempDir, jsonFile.originalname);
            const actorData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

            // Check if actor with this name already exists
            const existingActors = fs.readdirSync(actorsDir).filter(dir => {
                if (!fs.statSync(path.join(actorsDir, dir)).isDirectory()) return false;
                try {
                    const infoPath = path.join(actorsDir, dir, 'info.json');
                    if (fs.existsSync(infoPath)) {
                        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                        return info.name === actorData.name;
                    }
                } catch (e) {
                    return false;
                }
                return false;
            });

            if (existingActors.length > 0) {
                skippedActors.push(actorData.name);
                continue;
            }

            // Generate a unique identifier
            const randomId = crypto.randomBytes(3).toString('hex').toUpperCase();
            const actorId = `${actorData.name}-${randomId}`;

            // Create actor directory
            const actorDir = path.join(actorsDir, actorId);
            fs.mkdirSync(actorDir, { recursive: true });

            // Find and copy the image file
            const imageFile = groupFiles.find(f =>
                f.originalname === actorData.imageFile ||
                f.originalname === path.basename(actorData.imageFile)
            );

            if (imageFile) {
                const sourceImage = path.join(tempDir, imageFile.originalname);
                const targetImage = path.join(actorDir, 'headshot.jpg');
                fs.copyFileSync(sourceImage, targetImage);
            }

            // Create info.json
            const infoJson = {
                name: actorData.name,
                interestingFact: actorData['interesting-thing']
            };
            fs.writeFileSync(path.join(actorDir, 'info.json'), JSON.stringify(infoJson, null, 2));

            processedActors.push(actorData.name);
        }

        // Clean up temp files
        files.forEach(file => {
            const filePath = path.join(tempDir, file.originalname);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });

        let message = 'Actors loaded successfully';
        if (processedActors.length > 0) {
            message += `: Added ${processedActors.join(', ')}`;
        }
        if (skippedActors.length > 0) {
            message += ` | Skipped existing actors: ${skippedActors.join(', ')}`;
        }

        res.json({
            success: true,
            message: message,
            processed: processedActors,
            skipped: skippedActors
        });
    } catch (error) {
        console.error('Error loading actors:', error);
        res.status(500).json({ success: false, message: 'Error loading actors: ' + error.message });
    }
});

module.exports = router; 