// index.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Placeholder modules
const shots = require('./shots');
const cameraControl = require('./cameraControl');
const poseTracker = require('./poseTracker');
const fileManager = require('./fileManager');
const aiVoice = require('./aiVoice');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let currentShotIndex = 0;

// --- Utility: broadcast JSON to all clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// --- System init (placeholder)
function initializeSystem() {
  cameraControl.initCameras();
  poseTracker.loadModels();
  fileManager.prepareRecordingDirectory();
  console.log('System initialized. Ready to direct performance.');
}

// --- Shot logic
function startShot(index) {
  if (index < 0 || index >= shots.length) {
    console.log(`Invalid shot index: ${index}`);
    return;
  }
  currentShotIndex = index;

  const shot = shots[currentShotIndex];
  console.log(`Starting shot #${currentShotIndex + 1}: ${shot.description}`);
  aiVoice.speak(`Please prepare for shot number ${currentShotIndex + 1}. ${shot.instructions}`);

  // e.g., camera & file manager actions
  cameraControl.setCameraAngle(shot.cameraAngle);
  fileManager.startRecordingShot(shot);

  // Let connected clients know
  broadcast({
    type: 'SHOT_START',
    index: currentShotIndex,
    shotData: shot,
  });
}

function completeCurrentShot() {
  console.log(`Completing shot #${currentShotIndex + 1}`);
  fileManager.stopRecordingShot();

  // Move to next shot automatically or wait?
  currentShotIndex += 1;
  if (currentShotIndex < shots.length) {
    setTimeout(() => startShot(currentShotIndex), 2000);
  } else {
    console.log('All shots completed! Performance finished.');
    broadcast({ type: 'ALL_SHOTS_DONE' });
  }
}

// --- WebSocket event handling
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
      case 'POSE_DATA':
        console.log('🧍 Pose Data Received:', data.payload);
        // The first param is the string path to the image
        // The second param is the array of keypoints
        poseTracker.processPoseData('latest_pose.jpg', data.payload);
        break;
      default:
        console.log('⚠️ Unknown WebSocket message type:', data.type);
        break;
    }
  });

  ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to AI Director System.' }));
});


// front end
app.get('/', (req, res) => {
  let html = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8"/>
      <title>AI Director Shots</title>
      <style>
        body { font-family: sans-serif; margin: 0; padding: 0; background: #f0f0f0; }
        h1 { text-align: center; margin: 20px 0; }
        .shot-container { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; padding: 20px; }
        .shot-card { background: #fff; border: 1px solid #ccc; border-radius: 6px; width: 220px; padding: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: pointer; transition: transform 0.2s ease; }
        .shot-card:hover { transform: translateY(-3px); }
        .shot-title { font-weight: bold; margin-bottom: 5px; }
        .shot-camera, .shot-instructions { font-size: 0.9em; margin-bottom: 5px; }
        .shot-instructions { color: #444; }
        .test-pose-btn { margin: 20px auto; display: block; padding: 10px 20px; font-size: 16px; cursor: pointer; }
        #overlayImg { display: block; margin: 20px auto; max-width: 640px; border: 2px solid #ccc; }
      </style>
    </head>
    <body>
      <h1>AI Director Shots</h1>
      <button class="test-pose-btn" onclick="testPose()">Capture & Track Pose</button>

      <!-- Container for your shot cards -->
      <div class="shot-container">
  `;

  shots.forEach((shot, idx) => {
    html += `
      <div class="shot-card" onclick="startShot(${idx})">
        <div class="shot-title">Shot #${idx + 1}: ${shot.description}</div>
        <div class="shot-camera">Camera: ${shot.cameraAngle}</div>
        <div class="shot-instructions">${shot.instructions}</div>
      </div>
    `;
  });

  // Add an <img> to display the overlay
  html += `
      </div>

      <img id="overlayImg" src="" alt="Pose Overlay" />

      <script>
        function startShot(idx) {
          fetch('/startShot/' + idx)
            .then(res => {
              if (!res.ok) { alert('Error starting shot ' + idx); }
            })
            .catch(err => { console.error(err); });
        }

        function testPose() {
          fetch('/testPose')
            .then(res => res.text())
            .then(txt => {
              // alert(txt);
              // Now update the overlay <img> to show the new file
              document.getElementById('overlayImg').src = '/poseOverlay?' + Date.now();
              // The ?Date.now() prevents caching
            })
            .catch(err => console.error(err));
        }
      </script>
    </body>
  </html>
  `;

  res.send(html);
});

// --- Route to serve the "latest_pose_overlay.jpg" file
app.get('/poseOverlay', (req, res) => {
  const overlayPath = path.join(__dirname, 'latest_pose_overlay.jpg');
  if (fs.existsSync(overlayPath)) {
    res.sendFile(overlayPath);
  } else {
    res.status(404).send('No overlay image found yet.');
  }
});

// --- Route to actually begin shot
app.get('/startShot/:index', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  startShot(idx);
  res.json({ success: true, message: 'Shot started', shotIndex: idx });
});

// Add a route to trigger pose capture
app.get('/testPose', async (req, res) => {
  try {
    await poseTracker.captureAndTrackPose();
    res.send('Pose capture complete! Check console for details. Image saved as latest_pose_overlay.jpg');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error capturing or detecting pose: ' + err.message);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`AI Director System listening on port ${PORT}`);
  initializeSystem();
});