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
const aiVoice = require('./services/aiVoice');
const poseTracker = require('./services/poseTracker');
const mainRouter = require('./routes/main');
const { initializeWebSocket } = require('./websocket/handler');
const callsheetService = require('./services/callsheetService');

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
    poseTracker.loadModels();
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

// Routes
app.use('/', mainRouter);

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);

  // Initialize the session FIRST
  const initialSessionId = sessionService.generateSessionId();
  sessionService.setCurrentSessionId(initialSessionId);
  console.log(`Initialized with session ID: ${initialSessionId}`);

  // Clear the main teleprompter on startup
  broadcast({ type: 'CLEAR_TELEPROMPTER' });
  console.log('Broadcasted CLEAR_TELEPROMPTER on startup.');

  initializeSystem();
});