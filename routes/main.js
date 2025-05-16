console.log('[routes/main.js] File loaded and router being defined.'); // ADDED FOR DEBUGGING
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const config = require('../config.json');
const { buildHomeHTML } = require('../views/homeView');
const { actorsReady, action, initShot, draftActorsForShot } = require('../controllers/sceneController');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const sessionService = require('../services/sessionService');
const settingsService = require('../services/settingsService');
const callsheetService = require('../services/callsheetService'); // Import callsheetService
const { broadcastConsole, broadcast } = require('../websocket/broadcaster');
const teleprompterRouter = require('./teleprompter');
const cameraRouter = require('./camera');
const authMiddleware = require('../middleware/auth');
const AudioRecorder = require('../services/audioRecorder');
const audioRecorder = AudioRecorder.getInstance();
const os = require('os');
const sceneController = require('../controllers/sceneController');
const { getLocalIpAddress } = require('../utils/networkUtils');

// Middleware for parsing application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads (including actors)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir); // Use the unified temp directory
    },
    filename: function (req, file, cb) {
        // Keep original filename for actor uploads, add timestamp for others?
        // For now, keeping originalname for simplicity, might need refinement
        // if filename conflicts become an issue between actor uploads and audio.
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Configure multer for audio uploads (Now uses the same tempDir)
const audioStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir); // Use the unified temp directory
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `audio-${timestamp}.webm`);
    }
});

const audioUpload = multer({ storage: audioStorage });

// New multer instance for canvas video uploads (in-memory)
const canvasVideoStorage = multer.memoryStorage();
const canvasUpload = multer({ storage: canvasVideoStorage });

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

// Home route - protected by authentication (Needs its own IP fetch now)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const ipAddress = getLocalIpAddress();
        const port = config.port || 3000;
        const html = await buildHomeHTML(scenes, ipAddress, port);
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
    // sceneController.action(req, res); // Pass req and res
    action(req, res); // Direct call if action is imported directly
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

// --- NEW: Initialize a specific shot within a scene ---
router.get('/initShot/:sceneDir/:shotName', async (req, res) => {
    const { sceneDir, shotName } = req.params;
    try {
        // initShot now only prepares data and does not call actors
        const result = await initShot(decodeURIComponent(sceneDir), decodeURIComponent(shotName));
        res.json({
            success: true,
            message: `Shot '${decodeURIComponent(shotName)}' in scene '${decodeURIComponent(sceneDir)}' initialized successfully.`,
            sceneData: result // Contains scene, shot, shotIndex
        });
    } catch (error) {
        console.error(`Error initializing shot ${shotName} in scene ${sceneDir}:`, error);
        res.status(500).json({ success: false, error: error.message || "Failed to initialize shot" });
    }
});

// New route for drafting actors
router.post('/api/shot/:sceneDir/:shotName/draft-actors', async (req, res) => {
    const { sceneDir: encodedSceneDir, shotName: encodedShotName } = req.params;
    let decodedSceneDir, decodedShotName;

    try {
        decodedSceneDir = decodeURIComponent(encodedSceneDir);
        decodedShotName = decodeURIComponent(encodedShotName);

        const result = await draftActorsForShot(decodedSceneDir, decodedShotName);
        res.json({
            success: true,
            message: result.message || `Actors drafted for shot '${decodedShotName}'.`,
        });
    } catch (error) {
        // Attempt to use decoded names for logging if available, otherwise use encoded
        const logScene = decodedSceneDir || encodedSceneDir;
        const logShot = decodedShotName || encodedShotName;
        console.error(`Error drafting actors for shot ${logShot} in scene ${logScene}:`, error);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to draft actors for shot due to an internal server error.",
            details: error.toString() // Add more details if helpful
        });
    }
});

// --- END NEW ---

// Handle loading new actors
router.post('/loadActors', upload.array('files'), async (req, res) => {
    console.log('[POST /loadActors] Route handler STARTED. req.files:', req.files); // Kept for debugging
    try {
        const crypto = require('crypto');
        const actorsDir = config.actorsDir;
        let currentCallsheet = callsheetService.getCallsheet();

        // Initialize arrays for response
        const recoveredActors = [];
        const processedActors = [];
        const skippedActors = [];
        let callsheetUpdatedByRecovery = false;
        let callsheetUpdatedByUpload = false;

        // First, scan existing actor directories and add them to the service's callsheet if not present
        const existingDirs = fs.readdirSync(actorsDir).filter(dir => {
            // This might have been checking if 'dir' is a directory, e.g., fs.statSync(path.join(actorsDir, dir)).isDirectory()
            // For now, allowing all entries to see if other parts work or error out.
            const fullPath = path.join(actorsDir, dir);
            try {
                return fs.statSync(fullPath).isDirectory();
            } catch (e) {
                return false; // Ignore if it's not a directory or an error occurs
            }
        });

        for (const dir of existingDirs) {
            const infoPath = path.join(actorsDir, dir, 'info.json');
            if (fs.existsSync(infoPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                    const added = callsheetService.addActor({
                        id: dir,
                        name: info.name,
                        available: true,
                        sceneCount: 0
                    });
                    if (added) {
                        recoveredActors.push(info.name);
                        callsheetUpdatedByRecovery = true;
                    }
                } catch (e) {
                    console.error(`Error processing existing actor directory ${dir}:`, e);
                }
            }
        }

        if (callsheetUpdatedByRecovery) {
            currentCallsheet = callsheetService.getCallsheet(); // Refresh callsheet
        }

        // Group uploaded files by actor name (strip timestamps and _survey suffix)
        const fileGroups = {};
        req.files.forEach(file => {
            const filename = path.parse(file.originalname).name; // Gets 'ActorName_timestamp' or 'ActorName_survey_timestamp'

            // Extract the actor name by removing timestamp and _survey suffix if present
            let actorName;
            if (filename.includes('_survey_')) {
                actorName = filename.split('_survey_')[0]; // Extract 'ActorName' from 'ActorName_survey_timestamp'
            } else if (filename.includes('_')) {
                actorName = filename.split('_')[0]; // Extract 'ActorName' from 'ActorName_timestamp'
            } else {
                actorName = filename; // Just use the filename as is if no pattern matches
            }

            if (!fileGroups[actorName]) {
                fileGroups[actorName] = [];
            }
            fileGroups[actorName].push(file);
        });
        console.log('[POST /loadActors] Grouped files by actor name:', JSON.stringify(fileGroups, null, 2));

        for (const [actorName, groupFiles] of Object.entries(fileGroups)) {
            const jsonFile = groupFiles.find(f => f.mimetype === 'application/json' || f.originalname.endsWith('.json'));
            const imageFile = groupFiles.find(f => f.mimetype && f.mimetype.startsWith('image/'));

            if (!jsonFile) {
                console.warn(`No JSON file found for actor ${actorName}, skipping.`);
                skippedActors.push(actorName + " (no JSON)");
                continue;
            }

            if (!imageFile) {
                console.warn(`No image file found for actor ${actorName}, but proceeding anyway.`);
            }

            let actorData;
            try {
                actorData = JSON.parse(fs.readFileSync(jsonFile.path, 'utf8'));
            } catch (e) {
                console.error(`Error reading or parsing JSON file ${jsonFile.originalname}:`, e);
                skippedActors.push(actorName + " (JSON read error)");
                continue;
            }

            // Determine the actor's name: prioritize userName from JSON, then name from JSON, then actorName from filename
            const actorNameToUse = actorData.userName || actorData.name || actorName;

            const existingActorEntry = currentCallsheet.find(a => a.name === actorNameToUse);
            if (existingActorEntry) {
                skippedActors.push(actorNameToUse + " (already exists)");
                console.log(`Actor ${actorNameToUse} already exists, skipping.`);
                continue;
            }

            // --- If actor does NOT exist, proceed with creation ---
            const randomId = crypto.randomBytes(4).toString('hex');
            const actorId = `${actorNameToUse.replace(/\s+/g, '-')}-${randomId}`;

            const newActorDir = path.join(actorsDir, actorId);
            if (!fs.existsSync(newActorDir)) {
                fs.mkdirSync(newActorDir, { recursive: true });
            }

            if (imageFile) {
                try {
                    // Always save the headshot as headshot.jpg (or keep the original extension)
                    const imageExt = path.extname(imageFile.originalname);
                    const headshotPath = path.join(newActorDir, `headshot${imageExt}`);
                    fs.copyFileSync(imageFile.path, headshotPath);
                    console.log(`Copied headshot for ${actorNameToUse} to ${headshotPath}`);
                } catch (e) {
                    console.error(`Error copying image for actor ${actorNameToUse}:`, e);
                }
            } else {
                console.warn(`No image file available for actor ${actorNameToUse}.`);
            }

            const infoJsonContent = {
                id: actorId,
                name: actorNameToUse,
                // Add other details from actorData if they were part of original logic
            };
            try {
                fs.writeFileSync(path.join(newActorDir, 'info.json'), JSON.stringify(infoJsonContent, null, 2));
            } catch (e) {
                console.error(`Error writing info.json for actor ${actorNameToUse}:`, e);
            }

            const added = callsheetService.addActor({
                id: actorId,
                name: actorNameToUse,
                available: true,
                sceneCount: 0 // Default, or from actorData if available
            });
            if (added) {
                processedActors.push(actorNameToUse);
                callsheetUpdatedByUpload = true;
            }
        }

        if (callsheetUpdatedByRecovery || callsheetUpdatedByUpload) {
            console.log('Saving updated callsheet via service...');
            callsheetService.saveCallsheet();
        }

        // Temp file cleanup
        if (req.files && Array.isArray(req.files)) {
            req.files.forEach(file => {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (err) {
                    console.warn(`Failed to delete temp file ${file.path}: ${err.message}`);
                }
            });
        }

        // Construct response message
        let message = 'Actor loading process complete.';
        if (processedActors.length > 0 || recoveredActors.length > 0 || skippedActors.length > 0) {
            message = `Actors processed. Recovered: ${recoveredActors.length}, Newly Added: ${processedActors.length}, Skipped: ${skippedActors.length}.`;
        } else if (req.files && req.files.length > 0) {
            message = 'Files were uploaded, but no new actors were processed. Check server logs for details.';
        } else {
            message = 'No actor files were uploaded or processed.';
        }

        console.log('[POST /loadActors] Attempting to send response:', { success: true, message, recoveredActors, processedActors, skippedActors });
        res.json({
            success: true,
            message: message,
            recovered: recoveredActors,
            processed: processedActors,
            skipped: skippedActors
        });

    } catch (error) {
        console.error("[POST /loadActors] CRITICAL ERROR in /loadActors route:", error);
        res.status(500).json({
            success: false,
            message: "An unexpected error occurred on the server while processing actor files: " + error.message,
            error: error.toString()
        });
    }
});

// Handle clearing audio files
router.post('/clearAudio', express.json(), (req, res) => {
    try {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({
                success: false,
                message: 'No filename provided'
            });
        }

        const audioPath = path.join(__dirname, '..', 'temp', filename);

        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            res.json({
                success: true,
                message: 'Audio file cleared successfully'
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
    // Expect { deviceId: "hw:0,0", name: "Microphone (Built-in)", channelCount: 2 }
    const { deviceId, name, channelCount } = req.body;
    if (!deviceId || !name) {
        return res.status(400).json({ success: false, error: "deviceId and name are required" });
    }
    // channelCount is optional but useful
    if (channelCount !== undefined && (typeof channelCount !== 'number' || !Number.isInteger(channelCount) || channelCount < 1)) {
        console.warn(`Received invalid channelCount type (${typeof channelCount}) or value (${channelCount}) for device ${deviceId}. Proceeding without channel count.`);
        // Don't reject the request, just proceed without channel count if it's invalid
    }

    try {
        // Pass channelCount (which might be undefined or null if not provided/invalid) to addActiveDevice
        const added = audioRecorder.addActiveDevice(deviceId, name, channelCount);
        if (added) {
            res.status(201).json({ success: true, message: `Device ${name} added to active list.` });
        } else {
            // Device already existed
            res.status(200).json({ success: true, message: `Device ${name} was already active.` });
            // Optionally, we could update the channel count here if it differs, but 
            // addActiveDevice currently doesn't update if already active.
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

// --- NEW: Scene Details API Endpoint ---

// GET full details for a specific scene based on its directory
router.get('/api/scene-details', (req, res) => {
    const { sceneDir } = req.query;

    if (!sceneDir) {
        return res.status(400).json({ error: "Missing required query parameter: sceneDir" });
    }

    try {
        const scene = scenes.find(s => s.directory === sceneDir);

        if (scene) {
            res.json(scene);
        } else {
            res.status(404).json({ error: `Scene not found for directory: ${sceneDir}` });
        }
    } catch (error) {
        console.error(`Error handling /api/scene-details for ${sceneDir}:`, error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ error: "Failed to parse scenes data.", details: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ error: "Scenes database file not found." });
        } else {
            res.status(500).json({ error: "Failed to retrieve scene details.", details: error.message });
        }
    }
});

// --- End Scene Details API Endpoint ---

// --- NEW: Scene Assembly API Endpoint ---

// POST to trigger the assembly of a scene from selected takes
router.post('/api/assemble-scene', sceneController.assembleScene);

// --- End Scene Assembly API Endpoint ---

// GET the list of unique prop filenames referenced in scenes.json
router.get('/api/props', (req, res) => {
    // ... existing code ...
});

// --- NEW: Route for uploading canvas video ---
router.post('/api/upload/canvas-video', canvasUpload.single('videoBlob'), sceneController.uploadCanvasVideo);

// --- NEW: Endpoint to configure Gain/Channels for an active device ---
router.post('/api/audio/config/:deviceId(*)', (req, res) => {
    const { deviceId } = req.params;
    const { gainDb, channels } = req.body; // Expect { gainDb: number | null, channels: number[] | null }

    if (!deviceId) {
        return res.status(400).json({ success: false, error: "Device ID parameter is required" });
    }

    // Validate input types (basic)
    const configToUpdate = {};
    if (gainDb !== undefined) {
        if (typeof gainDb === 'number' || gainDb === null) {
            configToUpdate.gainDb = gainDb;
        } else {
            return res.status(400).json({ success: false, error: "Invalid gainDb value. Must be a number or null." });
        }
    }
    if (channels !== undefined) {
        if (Array.isArray(channels) || channels === null) {
            // Further validation (e.g., array of positive integers) happens in audioRecorder service
            configToUpdate.channels = channels;
        } else {
            return res.status(400).json({ success: false, error: "Invalid channels value. Must be an array of positive integers or null." });
        }
    }

    if (Object.keys(configToUpdate).length === 0) {
        return res.status(400).json({ success: false, error: "No valid configuration parameters provided (gainDb, channels)." });
    }

    try {
        const success = audioRecorder.updateDeviceConfig(deviceId, configToUpdate);
        if (success) {
            res.json({ success: true, message: `Configuration updated for device ${deviceId}.` });
        } else {
            // updateDeviceConfig returns false if device isn't active
            res.status(404).json({ success: false, error: `Device ${deviceId} not found or is not active.` });
        }
    } catch (error) {
        console.error("Error updating audio device configuration:", error);
        res.status(500).json({ success: false, error: `Failed to update configuration: ${error.message}` });
    }
});

// Endpoint to provide specific configuration details to the client
router.get('/api/app-config', (req, res) => {
    try {
        // Extract only the necessary configuration for the client
        const clientConfig = {
            videoFormat: config.videoFormat || 'mp4', // Provide default if not set
            videoBackground: config.videoBackground || [255, 0, 255, 255], // Default magenta
            videoBitsPerSecond: config.videoBitsPerSecond
        };
        res.json(clientConfig);
    } catch (error) {
        console.error("Error fetching client app configuration:", error);
        res.status(500).json({ error: "Failed to retrieve app configuration" });
    }
});

// Character Assignments API
router.get('/api/character-assignments', (req, res) => {
    const assignments = callsheetService.getCharacterAssignments();
    res.json({
        success: true,
        assignments
    });
});

// Add a fixed character assignment
router.post('/api/character-assignments', (req, res) => {
    const { actorName, characterName } = req.body;

    if (!actorName || !characterName) {
        return res.status(400).json({
            success: false,
            message: 'Actor name and character name are required'
        });
    }

    const success = callsheetService.addFixedCharacterAssignment(actorName, characterName);

    if (success) {
        return res.json({
            success: true,
            message: `Assignment added: ${actorName} will play ${characterName}`
        });
    } else {
        return res.status(400).json({
            success: false,
            message: 'Failed to add assignment. It may already exist.'
        });
    }
});

// Remove a fixed character assignment
router.delete('/api/character-assignments', (req, res) => {
    try {
        const { actorName, characterName } = req.body;

        if (!actorName || !characterName) {
            return res.status(400).json({ success: false, message: "Both actorName and characterName are required" });
        }

        const removed = callsheetService.removeFixedCharacterAssignment(actorName, characterName);

        if (removed) {
            res.json({ success: true, message: `Removed assignment for ${actorName} as ${characterName}` });
        } else {
            res.status(404).json({ success: false, message: `Assignment not found for ${actorName} as ${characterName}` });
        }
    } catch (error) {
        console.error('Error removing character assignment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint to refresh actors based on the actors directory
router.get('/api/actors/refresh', (req, res) => {
    try {
        const result = callsheetService.refreshCallsheet();
        res.json(result);
    } catch (error) {
        console.error('Error in /api/actors/refresh:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while refreshing actors: ' + error.message
        });
    }
});

// API endpoint to get actors with their details (name, headshotUrl)
router.get('/api/actors', (req, res) => {
    try {
        const actors = callsheetService.getActorsWithDetails();
        res.json({ success: true, actors });
    } catch (error) {
        console.error('Error in /api/actors:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while fetching actors: ' + error.message
        });
    }
});

module.exports = router;