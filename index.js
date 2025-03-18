/*******************************************************
 * index.js
 *   - Imports homeView to generate the big HTML
 *   - Contains routes for /initScene/:index, /recordVideo, etc.
 *******************************************************/
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// import config
const config = require('./config.json');
const scenes = require(config.scenes);

// Our custom modules
const cameraControl = require('./cameraControl');
const fileManager = require('./fileManager');
const aiVoice = require('./aiVoice');
const ffmpegHelper = require('./ffmpegHelper');
const poseTracker = require('./poseTracker');

// The newly separated HTML generator
const buildHomeHTML = require('./homeView');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let currentShotIndex = 0;

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

/** Basic shot logic */
function initScene(directory) {

  // console.log(directory);

  const scene = scenes.find(s => s.directory === directory);
  if (!scene) {
    console.log(`Scene ${directory} not found`);
    return;
  }
  // log scene description
  console.log(`Scene ${scene.description}`);
  aiVoice.speak(`Please prepare for scene ${scene.description}`);


  // const shot = shots[currentShotIndex];
  // console.log(`Starting shot #${currentShotIndex + 1}: ${shot.description}`);
  // aiVoice.speak(`Please prepare for shot number ${currentShotIndex + 1}. ${shot.instructions}`);

  // cameraControl.setCameraAngle(shot.cameraAngle);
  // fileManager.startRecordingShot(shot);


  broadcast({
    type: 'SHOT_START',
    scene: scene,
  });
}

function completeCurrentShot() {
  console.log(`Completing shot #${currentShotIndex + 1}`);
  fileManager.stopRecordingShot();

  currentShotIndex += 1;
  if (currentShotIndex < shots.length) {
    setTimeout(() => initScene(currentShotIndex), 2000);
  } else {
    console.log('All shots completed! Performance finished.');
    broadcast({ type: 'ALL_SHOTS_DONE' });
  }
}

/** WebSocket logic */
wss.on('connection', (ws) => {
  console.log('📡 New WebSocket client connected.');

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.log('Invalid JSON message:', raw);
      return;
    }

    switch (data.type) {
      case 'SHOT_DONE':
        completeCurrentShot();
        break;
      default:
        console.log('⚠️ Unknown WS message type:', data.type);
        break;
    }
  });

  ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to AI Director System.' }));
});

// Static files and directories
app.use('/video', express.static(__dirname));
app.use('/database', express.static(path.join(__dirname, 'database')));

/** 
 * The home route uses the separate HTML from homeView.js 
 */
app.get('/', (req, res) => {
  const html = buildHomeHTML(scenes);
  res.send(html);
});

/** 
 * initScene route
 */
app.get('/initScene/:directory', (req, res) => {
  const directory = decodeURIComponent(req.params.directory); // Decode spaces & special chars
  initScene(directory);
  res.json({ success: true, message: 'Scene started', directory: directory });
});

/**
 * recordVideo route
 * 1) record 3s
 * 2) extract frames
 * 3) pose detection on each frame => overlay
 * 4) encode original + overlay => show them
 */
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