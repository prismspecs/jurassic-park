/*******************************************************
 * index.js
 *   - Contains routes for /initScene/:index, /recordVideo, etc.
 *******************************************************/
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// import config
const config = require('./config.json');

// Our custom modules
const sessionService = require('./services/sessionService');
const CameraControl = require('./services/cameraControl');
const cameraControl = new CameraControl();
const AudioRecorder = require('./services/audioRecorder');
const audioRecorder = AudioRecorder.getInstance();
const aiVoice = require('./services/aiVoice');
const mainRouter = require('./routes/main');
const { initializeWebSocket } = require('./websocket/handler');
const callsheetService = require('./services/callsheetService');

// Define TEMP_TEST_DIR here in the top-level scope
const TEMP_TEST_DIR = path.join(__dirname, 'temp_audio_tests');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add JSON body parser middleware
app.use(express.json());

// Make WebSocket server globally available
global.wss = wss;

// Initialize WebSocket handler
initializeWebSocket(wss);

/** Utility: broadcast JSON to connected WS clients */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/** Utility: broadcast console message to connected WS clients */
function broadcastConsole(message, level = 'info') {
  broadcast({
    type: 'CONSOLE',
    message,
    level
  });
}

// Initialize aiVoice with broadcast function
aiVoice.init(broadcastConsole);

/** System init */
async function initializeSystem() {
  try {
    // Note: no longer adding a default camera
    callsheetService.initCallsheet();
    // Initialize voice bypass to enabled state
    aiVoice.setBypass(true);
    broadcastConsole('System initialized. Ready to direct performance.');
  } catch (err) {
    console.error('Error during system initialization:', err);
    broadcastConsole('Error during system initialization. Check server logs.', 'error');
  }
}

// Static files and directories
app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));
app.use('/video', express.static(__dirname));
app.use('/database', express.static(path.join(__dirname, 'database')));

// --- ADDED: Static serving for recordings ---
const recordingsDir = path.join(__dirname, config.recordingsDir || 'recordings');
console.log(`Serving recordings from: ${recordingsDir}`);
app.use('/recordings', express.static(recordingsDir));
// --- END: Static serving for recordings ---

// Routes
app.use('/', mainRouter);

// --- Audio API ---

// GET available audio input devices
app.get('/api/audio/devices', async (req, res) => {
  // ... existing code ...
});

// POST to start a test recording for a specific device
app.post('/api/audio/test', async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Missing deviceId in request body' });
  }

  console.log(`API received request to test audio device: ${deviceId}`);

  // Ensure the device is actually marked as active in the recorder instance
  if (!audioRecorder.activeDevices.has(deviceId)) {
    console.error(`Test requested for inactive device: ${deviceId}`);
    return res.status(400).json({ success: false, message: `Device ${deviceId} is not active. Activate it first.` });
  }

  try {
    // REMOVED temporary add/remove logic
    const result = await audioRecorder.startTestRecording(deviceId, TEMP_TEST_DIR);
    console.log(`Test recording result for ${deviceId}:`, result);
    res.json(result); // Send the result from startTestRecording back to the client

  } catch (error) {
    console.error(`API Error testing audio device ${deviceId}:`, error);
    res.status(500).json({ success: false, message: error.message || 'Error running test recording' });
  }
});

// POST to activate a device for recording
app.post('/api/audio/activate', (req, res) => {
  const { deviceId, name } = req.body;
  if (!deviceId || !name) {
    return res.status(400).json({ success: false, error: 'Missing deviceId or name in request body' });
  }
  try {
    const added = audioRecorder.addActiveDevice(deviceId, name);
    if (added) {
      res.json({ success: true, message: `Device ${deviceId} activated.` });
    } else {
      // If it wasn't added, it might already be active, which is okay.
      if (audioRecorder.activeDevices.has(deviceId)) {
        res.json({ success: true, message: `Device ${deviceId} was already active.` });
      } else {
        // This case shouldn't happen if addActiveDevice is robust
        throw new Error('Failed to activate device for unknown reason.');
      }
    }
  } catch (error) {
    console.error(`API Error activating audio device ${deviceId}:`, error);
    res.status(500).json({ success: false, error: error.message || 'Error activating device' });
  }
});

// DELETE to deactivate a device
app.delete('/api/audio/deactivate/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  if (!deviceId) {
    return res.status(400).json({ success: false, error: 'Missing deviceId in request path' });
  }
  try {
    const removed = audioRecorder.removeActiveDevice(deviceId);
    if (removed) {
      res.json({ success: true, message: `Device ${deviceId} deactivated.` });
    } else {
      // If it wasn't removed, it might already be inactive, which is okay.
      if (!audioRecorder.activeDevices.has(deviceId)) {
        res.json({ success: true, message: `Device ${deviceId} was already inactive.` });
      } else {
        throw new Error('Failed to deactivate device for unknown reason.');
      }
    }
  } catch (error) {
    console.error(`API Error deactivating audio device ${deviceId}:`, error);
    res.status(500).json({ success: false, error: error.message || 'Error deactivating device' });
  }
});

// GET currently active audio devices (Optional - might be useful)
app.get('/api/audio/active-devices', (req, res) => {
  try {
    const activeDevices = audioRecorder.getActiveDevices();
    res.json(activeDevices);
  } catch (error) {
    console.error('API Error getting active audio devices:', error);
    res.status(500).json({ message: 'Error getting active audio devices' });
  }
});

// --- OSC API ---
// ... existing code ...

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);

  // --- Initialize Session --- 
  // Select the latest existing session on startup
  const latestSessionId = sessionService.getLatestSessionId();
  if (latestSessionId) {
    sessionService.setCurrentSessionId(latestSessionId);
    console.log(`Initialized. Automatically selected latest session: ${latestSessionId}`);
    broadcastConsole(`Selected latest session: ${latestSessionId}`, 'info');
  } else {
    console.log("Initialized. No existing sessions found.");
    broadcastConsole("No existing sessions found. Please create a new session.", 'warn');
    // currentSessionId remains null, UI should prompt user
  }
  // --- End Initialize Session --- 

  // Clear the main teleprompter on startup
  broadcast({ type: 'CLEAR_TELEPROMPTER' });
  console.log('Broadcasted CLEAR_TELEPROMPTER on startup.');

  initializeSystem();
});

// Ensure temp directory exists (Can stay here or move near definition)
if (!fs.existsSync(TEMP_TEST_DIR)) {
  try {
    fs.mkdirSync(TEMP_TEST_DIR);
    console.log(`Created temporary directory for audio tests: ${TEMP_TEST_DIR}`);
  } catch (err) {
    console.error(`Error creating temp directory ${TEMP_TEST_DIR}:`, err);
    // Decide how to handle this - maybe exit?
  }
}