/*******************************************************
 * index.js
 *   - Imports homeView to generate the big HTML
 *   - Contains routes for /initScene/:index, /recordVideo, etc.
 *******************************************************/
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// import config
const config = require('./config.json');
const scenes = require(config.scenes);

// Our custom modules
const cameraControl = require('./cameraControl');
const fileManager = require('./fileManager');
const aiVoice = require('./aiVoice');
const ffmpegHelper = require('./ffmpegHelper');
const poseTracker = require('./poseTracker');
const buildHomeHTML = require('./homeView');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** Utility: broadcast JSON to connected WS clients */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/** System init */
function initializeSystem() {
  cameraControl.initCameras();
  poseTracker.loadModels();
  fileManager.prepareRecordingDirectory();
  console.log('System initialized. Ready to direct performance.');
}

/** Scene initialization */
function initScene(directory) {
  const scene = scenes.find(s => s.directory === directory);
  if (!scene) {
    console.log(`Scene ${directory} not found`);
    return;
  }
  console.log(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);
  aiVoice.speak(`Please prepare for scene ${scene.description}`);

  broadcast({
    type: 'SHOT_START',
    scene: scene,
  });
}

/** WebSocket logic */
wss.on('connection', (ws) => {
  console.log('📡 New WebSocket client connected.');
  ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to AI Director System.' }));
});

// Static files and directories
app.use('/video', express.static(__dirname));
app.use('/database', express.static(path.join(__dirname, 'database')));

/** Routes */
app.get('/', (req, res) => {
  const html = buildHomeHTML(scenes);
  res.send(html);
});

app.get('/initScene/:directory', (req, res) => {
  const directory = decodeURIComponent(req.params.directory);
  initScene(directory);
  res.json({ success: true, message: 'Scene started', directory: directory });
});

app.get('/recordVideo', async (req, res) => {
  try {
    const RAW_DIR = path.join(__dirname, config.framesRawDir);
    const OVERLAY_DIR = path.join(__dirname, config.framesOverlayDir);
    const OUT_ORIG = config.videoOriginal;
    const OUT_OVER = config.videoOverlay;
    const TEMP_RECORD = config.tempRecord;

    await ffmpegHelper.captureVideo(TEMP_RECORD, 3);
    await ffmpegHelper.extractFrames(TEMP_RECORD, RAW_DIR);
    await poseTracker.processFrames(RAW_DIR, OVERLAY_DIR);
    await ffmpegHelper.encodeVideo(RAW_DIR, OUT_ORIG);
    await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);

    res.json({
      success: true,
      message: 'Video recorded and pose processed!',
      originalName: OUT_ORIG,
      overlayName: OUT_OVER
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  initializeSystem();
});