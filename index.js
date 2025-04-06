/*******************************************************
 * index.js
 *   - Contains routes for /initScene/:index, /recordVideo, etc.
 *******************************************************/
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// import config
const config = require('./config.json');

// Our custom modules
const cameraControl = require('./services/cameraControl');
const fileManager = require('./services/fileManager');
const aiVoice = require('./services/aiVoice');
const poseTracker = require('./services/poseTracker');
const mainRouter = require('./routes/main');
const { initializeWebSocket } = require('./websocket/handler');
const callsheetService = require('./services/callsheetService');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
function initializeSystem() {
  cameraControl.initCameras();
  poseTracker.loadModels();
  fileManager.prepareRecordingDirectory();
  callsheetService.initCallsheet();
  broadcastConsole('System initialized. Ready to direct performance.');
}

// Static files and directories
app.use('/views', express.static(path.join(__dirname, 'views')));
app.use('/video', express.static(__dirname));
app.use('/database', express.static(path.join(__dirname, 'database')));
app.use('/favicon.ico', express.static(path.join(__dirname, 'favicon.ico')));

// Routes
app.use('/', mainRouter);

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  // write a clickable link to the page
  console.log(`http://localhost:${PORT}`);
  initializeSystem();
});