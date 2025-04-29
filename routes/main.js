const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const config = require('../config.json');
const { buildHomeHTML } = require('../views/homeView');
const { initScene, actorsReady, action, initShot } = require('../controllers/sceneController');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const sessionService = require('../services/sessionService');
const settingsService = require('../services/settingsService');
const { broadcastConsole, broadcast } = require('../websocket/broadcaster');
const teleprompterRouter = require('./teleprompter');
const cameraRouter = require('./camera');
const authMiddleware = require('../middleware/auth');
const AudioRecorder = require('../services/audioRecorder');
const audioRecorder = AudioRecorder.getInstance();

// Middleware for parsing application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

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

// Create temp directory if it doesn't exist
const tempDirAudio = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDirAudio)) {
    fs.mkdirSync(tempDirAudio, { recursive: true });
}

// Configure multer for audio uploads
const audioStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDirAudio);
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `audio-${timestamp}.webm`);
    }
});

const audioUpload = multer({ storage: audioStorage });

// --- NEW Session API Endpoints ---

// GET list of existing session IDs (updated to use new service method)
router.get('/api/sessions', (req, res) => {
    try {
        const sessions = sessionService.listExistingSessions();
        res.json(sessions);
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: "Failed to retrieve sessions" });
    }
});

// POST to create a new session
router.post('/api/sessions/create', (req, res) => {
    const { name } = req.body; // Expect { "name": "user_session_name" }
    if (!name) {
        return res.status(400).json({ success: false, error: "Session name is required" });
    }
    try {
        const newSessionId = sessionService.createNewSession(name);
        broadcast({ type: 'SESSION_UPDATE', sessionId: newSessionId }); // Notify clients
        broadcast({ type: 'SESSION_LIST_UPDATE', sessions: sessionService.listExistingSessions() }); // Also update list
        res.status(201).json({ success: true, sessionId: newSessionId, message: `Session '${newSessionId}' created and selected.` });
    } catch (error) {
        console.error("Error creating new session:", error);
        res.status(500).json({ success: false, error: `Failed to create session: ${error.message}` });
    }
});


// POST to select an existing session (updated to use new service method)
router.post('/api/select-session', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ success: false, error: "Session ID is required" });
    }

    try {
        const trimmedSessionId = sessionId.trim();
        const existingSessions = sessionService.listExistingSessions();
        
        // Validate that the provided ID actually exists as a directory
        if (!existingSessions.includes(trimmedSessionId)) {
            // Double-check filesystem just in case list was stale?
            const sessionPath = path.join(__dirname, '..', 'recordings', trimmedSessionId);
            if (!fs.existsSync(sessionPath)) {
                 return res.status(404).json({ success: false, error: `Session directory not found: ${trimmedSessionId}` });
            }
            // If it exists on disk but wasn't in the list, log a warning but proceed
            console.warn(`Session ${trimmedSessionId} exists on disk but was not in listExistingSessions result. Selecting anyway.`);
        }

        sessionService.setCurrentSessionId(trimmedSessionId);
        broadcast({ type: 'SESSION_UPDATE', sessionId: trimmedSessionId }); // Notify clients
        res.json({ success: true, message: `Session changed to ${trimmedSessionId}` });

    } catch (error) {
        console.error("Error selecting session:", error);
        res.status(500).json({ success: false, error: `Failed to select session: ${error.message}` });
    }
});

// GET the currently active session ID
router.get('/api/sessions/current', (req, res) => {
    try {
        const currentId = sessionService.getCurrentSessionId();
        res.json({ sessionId: currentId }); // Will be { sessionId: null } if none is active
    } catch (error) {
        console.error("Error fetching current session:", error);
        res.status(500).json({ error: "Failed to retrieve current session" });
    }
});

// GET the latest session ID based on directory listing
router.get('/api/sessions/latest', (req, res) => {
    try {
        const latestId = sessionService.getLatestSessionId();
        res.json({ sessionId: latestId }); // Will be { sessionId: null } if none exist
    } catch (error) {
        console.error("Error fetching latest session:", error);
        res.status(500).json({ error: "Failed to retrieve latest session" });
    }
});


// DELETE a session directory - Updated regex and validation
router.delete('/api/sessions/:sessionId(*)', (req, res) => { // Use (*) to allow slashes/complex names potentially
    const { sessionId } = req.params;
    const currentSession = sessionService.getCurrentSessionId();
    const recordingsBaseDir = path.join(__dirname, '..', 'recordings');
    // IMPORTANT: Resolve the path to prevent traversal attacks, although sanitize should help
    const sessionPath = path.resolve(recordingsBaseDir, sessionId);

    // Make sure the resolved path is still within the recordings directory
    if (!sessionPath.startsWith(path.resolve(recordingsBaseDir))) {
         return res.status(400).json({ success: false, error: "Invalid session ID path." });
    }

    // Basic validation
    if (!sessionId) {
        return res.status(400).json({ success: false, error: "Session ID parameter is required" });
    }
    // Prevent deleting the active session
    if (sessionId === currentSession) {
        return res.status(400).json({ success: false, error: "Cannot delete the currently active session" });
    }
    // Validate format (using the new pattern)
    const sessionRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}_.+$/;
    if (!sessionRegex.test(sessionId)) {
        return res.status(400).json({ success: false, error: `Invalid session ID format: ${sessionId}` });
    }

    // Check if directory exists before attempting deletion (using synchronous methods for pre-check)
    try {
        if (!fs.existsSync(sessionPath) || !fs.lstatSync(sessionPath).isDirectory()) {
            return res.status(404).json({ success: false, error: `Session directory not found: ${sessionId}` });
        }
    } catch (statError) {
        console.error(`Error checking session directory ${sessionId} before deletion:`, statError);
        return res.status(500).json({ success: false, error: 'Error checking session directory status.' });
    }

    console.log(`Attempting to delete session directory: ${sessionPath}`);

    // Use callback-based fs.rmdir with recursive option
    fs.rmdir(sessionPath, { recursive: true }, (err) => {
        if (err) {
            console.error(`Error deleting session directory ${sessionPath}:`, err);
            let errorMessage = 'Failed to delete session directory.';
            let statusCode = 500;

            if (err.code === 'ENOENT') {
                errorMessage = `Session directory not found during delete: ${sessionId}`;
                statusCode = 404;
            } else if (err.code === 'EPERM' || err.code === 'EACCES') {
                errorMessage = `Permission denied when deleting session directory: ${sessionId}. Check file permissions.`;
                statusCode = 403;
            } else if (err.code === 'EBUSY') {
                errorMessage = `Cannot delete session directory ${sessionId} as it is currently in use.`;
                statusCode = 409; // Conflict
            } else if (err.code === 'ENOTEMPTY') {
                 errorMessage = `Directory ${sessionId} not empty (recursive delete might have failed or is not supported).`;
                 statusCode = 500;
            }

            return res.status(statusCode).json({ success: false, error: errorMessage });
        }

        console.log(`Successfully deleted session directory: ${sessionId}`);
        res.json({ success: true, message: `Session ${sessionId} deleted successfully` });
    });
});

// POST to set recording pipeline
router.post('/api/settings/recording-pipeline', (req, res) => {
    const { pipeline } = req.body;
    if (!pipeline) {
        return res.status(400).json({ success: false, message: 'Pipeline value is required' });
    }
    const success = settingsService.setRecordingPipeline(pipeline);
    if (success) {
        broadcast({ type: 'SETTINGS_UPDATE', settings: { recordingPipeline: pipeline } });
        res.json({ success: true, message: `Recording pipeline set to ${pipeline}` });
    } else {
        res.status(400).json({ success: false, message: `Invalid pipeline value: ${pipeline}` });
    }
});

router.post('/api/settings/recording-resolution', (req, res) => {
    const { resolution } = req.body; // Expecting string like "1920x1080"
    if (!resolution) {
        return res.status(400).json({ success: false, message: 'Resolution value is required' });
    }
    const success = settingsService.setRecordingResolution(resolution);
    if (success) {
        const currentResolution = settingsService.getRecordingResolution(); // Get the object back for broadcast
        broadcast({ type: 'SETTINGS_UPDATE', settings: { recordingResolution: currentResolution } });
        res.json({ success: true, message: `Recording resolution set to ${resolution}` });
    } else {
        res.status(400).json({ success: false, message: `Invalid resolution value: ${resolution}` });
    }
});

router.get('/api/settings', (req, res) => {
    // Simple endpoint to get all current settings if needed
    res.json({
        recordingPipeline: settingsService.getRecordingPipeline(),
        recordingResolution: settingsService.getRecordingResolution()
    });
});

// Test console broadcasting
router.post('/testConsole', (req, res) => {
    broadcastConsole('This is a test console message', 'info');
    res.json({ success: true, message: 'Test message sent' });
});

// Home route - protected by authentication
router.get('/', authMiddleware, async (req, res) => {
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

// Get current voice bypass state
router.get('/getVoiceBypass', (req, res) => {
    res.json({ enabled: aiVoice.getBypassState() });
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

// Initialize a scene (legacy? Keep for now or deprecate?)
router.get('/initScene/:directory', (req, res) => {
    const directory = decodeURIComponent(req.params.directory);
    initScene(directory); // This likely needs adjustment if initShot is the primary way
    res.json({ success: true, message: 'Scene initialization requested (may be deprecated)', directory: directory });
});

// --- NEW: Initialize a specific shot within a scene ---
router.get('/initShot/:sceneDir/:shotName', (req, res) => {
    const sceneDir = decodeURIComponent(req.params.sceneDir);
    const shotName = decodeURIComponent(req.params.shotName);
    try {
        // Call the controller function (which should be synchronous for now or return status)
        const result = initShot(sceneDir, shotName); // Assuming initShot exists in sceneController
        res.json({ 
            success: true, 
            message: `Shot '${shotName}' in scene '${sceneDir}' initialized.`, 
            scene: sceneDir,
            shot: shotName
        });
    } catch (error) {
        console.error(`Error initializing shot ${shotName} in scene ${sceneDir}:`, error);
        res.status(400).json({ // Use 400 for bad request (e.g., shot not found)
             success: false, 
             message: `Error initializing shot: ${error.message}` 
        }); 
    }
});
// --- END NEW ---

// Handle loading new actors
router.post('/loadActors', upload.array('files'), async (req, res) => {
    try {
        const crypto = require('crypto');
        const actorsDir = config.actorsDir;
        const callsheetPath = path.join(actorsDir, 'callsheet.json');

        // Load existing callsheet
        let callsheet = [];
        if (fs.existsSync(callsheetPath)) {
            callsheet = JSON.parse(fs.readFileSync(callsheetPath, 'utf8'));
            console.log('Loaded existing callsheet:', callsheet);
        }

        // First, scan existing actor directories and add them to callsheet if not present
        const existingDirs = fs.readdirSync(actorsDir).filter(dir => {
            const fullPath = path.join(actorsDir, dir);
            return fs.statSync(fullPath).isDirectory() && dir !== 'temp_uploads';
        });

        const recoveredActors = [];
        for (const dir of existingDirs) {
            const infoPath = path.join(actorsDir, dir, 'info.json');
            if (fs.existsSync(infoPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                    // Check if actor already exists in callsheet
                    const existingActor = callsheet.find(a => a.id === dir);
                    if (!existingActor) {
                        callsheet.push({
                            id: dir,
                            name: info.name,
                            available: true,
                            sceneCount: 0
                        });
                        recoveredActors.push(info.name);
                    }
                } catch (e) {
                    console.error(`Error processing directory ${dir}:`, e);
                }
            }
        }

        // Group files by their base name (without extension)
        const files = req.files || [];
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

            // Check if actor with this name already exists in callsheet
            const existingActor = callsheet.find(a => a.name === actorData.name);
            if (existingActor) {
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

            // Add to callsheet
            callsheet.push({
                id: actorId,
                name: actorData.name,
                available: true,
                sceneCount: 0
            });

            processedActors.push(actorData.name);
        }

        // Save updated callsheet
        console.log('Saving updated callsheet:', callsheet);
        fs.writeFileSync(callsheetPath, JSON.stringify(callsheet, null, 2));

        // Clean up temp files
        files.forEach(file => {
            const filePath = path.join(tempDir, file.originalname);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });

        let message = 'Actors loaded successfully';
        if (recoveredActors.length > 0) {
            message += ` | Recovered existing actors: ${recoveredActors.join(', ')}`;
        }
        if (processedActors.length > 0) {
            message += ` | Added new actors: ${processedActors.join(', ')}`;
        }
        if (skippedActors.length > 0) {
            message += ` | Skipped existing actors: ${skippedActors.join(', ')}`;
        }

        res.json({
            success: true,
            message: message,
            recovered: recoveredActors,
            processed: processedActors,
            skipped: skippedActors
        });
    } catch (error) {
        console.error('Error loading actors:', error);
        res.status(500).json({ success: false, message: 'Error loading actors: ' + error.message });
    }
});

// Handle clearing audio files
router.post('/clearAudio', express.json(), (req, res) => {
    // This might need adjustment depending on how audio is cleared now.
    // Does it clear from the session dir? Does it need the session ID?
    // For now, assuming it clears from the *temp* dir (where recordings were stored before)
    // If it needs to clear from the session dir, it needs the session ID.
    try {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({
                success: false,
                message: 'No filename provided'
            });
        }

        // **Potentially needs update:** Where should this delete from?
        // If it's meant to delete the *final* WAV from the session:
        // const sessionDir = sessionService.getSessionDirectory();
        // const audioPath = path.join(sessionDir, filename);
        // console.log(`Attempting to delete audio file from session: ${audioPath}`);

        // If it's meant to delete the *temporary* webm/wav before/after conversion:
        const audioPath = path.join(__dirname, '..', 'temp', filename); // Current behavior
        console.log(`Attempting to delete audio file from temp: ${audioPath}`);


        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            res.json({
                success: true,
                message: 'Audio file cleared successfully' // Adjust message based on actual behavior
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Audio file not found at specified location'
            });
        }
    } catch (error) {
        console.error('Error clearing audio:', error);
        res.status(500).json({
            success: false,
            message: 'Error clearing audio file'
        });
    }
});

// Expose config to frontend
router.get('/config', (req, res) => {
    res.json(config);
});

// --- NEW Audio Device API Endpoints ---

// GET available audio input devices
router.get('/api/audio/devices', async (req, res) => {
    try {
        const devices = await audioRecorder.detectAudioInputDevices();
        res.json(devices);
    } catch (error) {
        console.error("Error detecting audio devices:", error);
        res.status(500).json({ error: "Failed to detect audio devices" });
    }
});

// GET audio default devices from config
router.get('/api/audio/defaults', (req, res) => {
    try {
        const defaults = config.audioDefaults || [];
        res.json(defaults);
    } catch (error) {
        console.error("Error reading audio defaults from config:", error);
        res.status(500).json({ error: "Failed to read audio defaults" });
    }
});

// GET currently active audio devices for recording
router.get('/api/audio/active-devices', (req, res) => {
    try {
        const devices = audioRecorder.getActiveDevices();
        res.json(devices);
    } catch (error) {
        console.error("Error getting active audio devices:", error);
        res.status(500).json({ error: "Failed to get active audio devices" });
    }
});

// POST to add an active audio device
router.post('/api/audio/active-devices', (req, res) => {
    const { deviceId, name } = req.body; // Expect { deviceId: "hw:0,0", name: "Microphone (Built-in)" }
    if (!deviceId || !name) {
        return res.status(400).json({ success: false, error: "deviceId and name are required" });
    }
    try {
        const added = audioRecorder.addActiveDevice(deviceId, name);
        if (added) {
            res.status(201).json({ success: true, message: `Device ${name} added to active list.` });
        } else {
            // Device already existed
            res.status(200).json({ success: true, message: `Device ${name} was already active.` });
        }
    } catch (error) {
        console.error("Error adding active audio device:", error);
        res.status(500).json({ success: false, error: `Failed to add active device: ${error.message}` });
    }
});

// DELETE an active audio device
router.delete('/api/audio/active-devices/:deviceId(*)', (req, res) => {
    const { deviceId } = req.params;
    if (!deviceId) {
        return res.status(400).json({ success: false, error: "Device ID parameter is required" });
    }
    try {
        const removed = audioRecorder.removeActiveDevice(deviceId);
        if (removed) {
            res.json({ success: true, message: `Device ${deviceId} removed from active list.` });
        } else {
            res.status(404).json({ success: false, error: `Device ${deviceId} not found in active list.` });
        }
    } catch (error) {
        console.error("Error removing active audio device:", error);
        res.status(500).json({ success: false, error: `Failed to remove active device: ${error.message}` });
    }
});

// --- END Audio Device API Endpoints ---

module.exports = router; 