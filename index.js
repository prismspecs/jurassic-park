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
const scenes = require(config.scenes);
const callsheet = require(config.callsheet);

// Our custom modules
const cameraControl = require('./services/cameraControl');
const fileManager = require('./services/fileManager');
const aiVoice = require('./services/aiVoice');
const ffmpegHelper = require('./services/ffmpegHelper');
const poseTracker = require('./services/poseTracker');
const buildHomeHTML = require('./views/homeView');
const buildTeleprompterHTML = require('./views/teleprompterView');
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
  broadcastConsole('System initialized. Ready to direct performance.');
}

/** Scene initialization */
function initScene(directory) {
  sceneTakeIndex = 0;

  const scene = scenes.find(s => s.directory === directory);
  if (!scene) {
    broadcastConsole(`Scene ${directory} not found`, 'error');
    return;
  }
  broadcastConsole(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);
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
  broadcastConsole(`Calling actors for scene: ${scene.description}`);
  
  // Get the actors object from the current take
  const actors = scene.takes[sceneTakeIndex].actors;
  
  // Get the character names from the actors object
  const characterNames = Object.keys(actors);
  
  // find how many actors are needed for the scene
  const actorsNeeded = characterNames.length;
  
  broadcastConsole(`Actors needed: ${actorsNeeded} for characters: ${characterNames.join(', ')}`);
  
  // sort the callsheet by sceneCount
  const sortedCallsheet = callsheet.sort((a, b) => a.sceneCount - b.sceneCount);

  // get the top actorsNeeded actors
  const actorsToCall = sortedCallsheet.slice(0, actorsNeeded);

  // Call the actors
  actorsToCall.forEach((actor, index) => {
    actor.sceneCount++;
    broadcastConsole(`Calling actor: ${actor.name} to play ${characterNames[index]}`);
    aiVoice.speak(`Calling actor: ${actor.name} to play ${characterNames[index]}`);

    // Update the teleprompter text
    broadcast({
      type: 'TELEPROMPTER',
      text: `Calling actor: ${actor.name} to play ${characterNames[index]}`,
      image: `/database/actors/${actor.name}/headshot.jpg`
    });
  });

  // Save the updated callsheet back to the JSON file
  fs.writeFileSync(config.callsheet, JSON.stringify(callsheet, null, 4));
  broadcastConsole('Updated callsheet saved');

  // Broadcast that actors are being called
  broadcast({
    type: 'ACTORS_CALLED',
    scene: scene
  });
}

function actorsReady() {
  broadcastConsole('Actors are ready to perform');
  broadcast({
    type: 'ACTORS_READY'
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

// Teleprompter page
app.get('/teleprompter', (req, res) => {
  const html = buildTeleprompterHTML();
  res.send(html);
});

// Update teleprompter text
app.post('/updateTeleprompter', express.json(), (req, res) => {
  const { text, image } = req.body;
  broadcast({
    type: 'TELEPROMPTER',
    text,
    image
  });
  res.json({ success: true, message: 'Teleprompter updated' });
});

// Clear teleprompter
app.post('/clearTeleprompter', (req, res) => {
  broadcast({
    type: 'CLEAR_TELEPROMPTER'
  });
  res.json({ success: true, message: 'Teleprompter cleared' });
});

// Handle actors ready state
app.post('/actorsReady', (req, res) => {
  actorsReady();
  res.json({ success: true, message: 'Actors ready state received' });
});

// Handle voice bypass toggle
app.post('/setVoiceBypass', express.json(), (req, res) => {
  const { enabled } = req.body;
  aiVoice.setBypass(enabled);
  broadcastConsole(`Voice bypass ${enabled ? 'enabled' : 'disabled'}`);
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
    broadcastConsole('Starting video recording...');
    const RAW_DIR = path.join(__dirname, config.framesRawDir);
    const OVERLAY_DIR = path.join(__dirname, config.framesOverlayDir);
    const OUT_ORIG = config.videoOriginal;
    const OUT_OVER = config.videoOverlay;
    const TEMP_RECORD = config.tempRecord;

    await ffmpegHelper.captureVideo(TEMP_RECORD, 3);
    broadcastConsole('Video captured, processing frames...');
    await ffmpegHelper.extractFrames(TEMP_RECORD, RAW_DIR);
    await poseTracker.processFrames(RAW_DIR, OVERLAY_DIR);
    broadcastConsole('Frames processed, encoding videos...');
    await ffmpegHelper.encodeVideo(RAW_DIR, OUT_ORIG);
    await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);

    broadcastConsole('Video recording and processing complete!');
    res.json({
      success: true,
      message: 'Video recorded and pose processed!',
      originalName: OUT_ORIG,
      overlayName: OUT_OVER
    });
  } catch (err) {
    broadcastConsole(err.message, 'error');
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