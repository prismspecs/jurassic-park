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
const scenes = require(config.scenes);
const callsheet = require(config.callsheet);

// Our custom modules
const cameraControl = require('./services/cameraControl');
const fileManager = require('./services/fileManager');
const aiVoice = require('./services/aiVoice');
const ffmpegHelper = require('./services/ffmpegHelper');
const poseTracker = require('./services/poseTracker');
const buildHomeHTML = require('./views/homeView');
const mainRouter = require('./routes/main');
const { initializeWebSocket } = require('./websocket/handler');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// globals
let sceneTakeIndex = 0;

// Make WebSocket server globally available
global.wss = wss;

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
  
  // aiVoice.setBypass(true);

  sceneTakeIndex = 0;

  const scene = scenes.find(s => s.directory === directory);
  if (!scene) {
    console.log(`Scene ${directory} not found`);
    return;
  }
  console.log(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);
  aiVoice.speak(`Please prepare for scene ${scene.description}`);
  

  // wait 5 seconds
  setTimeout(() => {
    callActors(scene);
  }, config.waitTime);

  broadcast({
    type: 'SHOT_START',
    scene: scene,
  });
}

function callActors(scene) {
  console.log(`Calling actors for scene: ${scene.description}`);
  
  // Get the actors object from the current take
  const actors = scene.takes[sceneTakeIndex].actors;
  
  // Get the character names from the actors object
  const characterNames = Object.keys(actors);
  
  // find how many actors are needed for the scene
  const actorsNeeded = characterNames.length;
  
  console.log(`Actors needed: ${actorsNeeded} for characters: ${characterNames.join(', ')}`);
  
  // sort the callsheet by sceneCount
  const sortedCallsheet = callsheet.sort((a, b) => a.sceneCount - b.sceneCount);

  // get the top actorsNeeded actors
  const actorsToCall = sortedCallsheet.slice(0, actorsNeeded);

  // Call the actors
  actorsToCall.forEach((actor, index) => {
    actor.sceneCount++;
    console.log(`Calling actor: ${actor.name} to play ${characterNames[index]}`);
    aiVoice.speak(`Calling actor: ${actor.name} to play ${characterNames[index]}`);
  });

  // Broadcast that actors are being called
  broadcast({
    type: 'ACTORS_CALLED',
    scene: scene
  });
}

// Initialize WebSocket
initializeWebSocket(wss);

// Static files and directories
app.use('/video', express.static(__dirname));
app.use('/database', express.static(path.join(__dirname, 'database')));

/** Routes */
app.get('/', (req, res) => {
  const html = buildHomeHTML(scenes);
  res.send(html);
});

// Handle actors ready state
app.post('/actorsReady', (req, res) => {
  console.log('Actors are ready to perform');
  broadcast({
    type: 'ACTORS_READY'
  });
  res.json({ success: true, message: 'Actors ready state received' });
});

// Handle voice bypass toggle
app.post('/setVoiceBypass', express.json(), (req, res) => {
  const { enabled } = req.body;
  aiVoice.setBypass(enabled);
  res.json({ 
    success: true, 
    message: `Voice bypass ${enabled ? 'enabled' : 'disabled'}`
  });
});

// Initialize a scene
app.get('/initScene/:directory', (req, res) => {
  const directory = decodeURIComponent(req.params.directory);
  initScene(directory);
  res.json({ success: true, message: 'Scene started', directory: directory });
});

// Record a video (test)
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

// Routes
app.use('/', mainRouter);

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  // write a clickable link to the page
  console.log(`http://localhost:${PORT}`);
  initializeSystem();
});