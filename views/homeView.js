/*******************************************************
 * homeView.js
 *
 * Returns the entire HTML for the main page as a string.
 * We dynamically insert "shots" into the shot cards.
 *******************************************************/
module.exports = function buildHomeHTML(scenes) {
  // Start building the page
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>AI Director Interface</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 0; padding: 0;
      background: #f0f0f0;
      display: flex;
      min-height: 100vh;
    }
    .main-content {
      flex: 3;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .sidebar {
      flex: 1;
      background: #fff;
      padding: 20px;
      border-left: 1px solid #ccc;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    h1 {
      margin: 0 0 20px 0;
      text-align: center;
    }
    .controls-section {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      box-sizing: border-box;
    }
    .controls-section h2 {
      margin: 0 0 15px 0;
      font-size: 18px;
      color: #333;
    }
    .scene-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
      margin-bottom: 20px;
    }
    .scene-card {
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      width: 220px;
      padding: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      cursor: pointer;
      transition: transform 0.2s ease;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .scene-card:hover {
      transform: translateY(-3px);
    }
    .scene-card img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      border-radius: 4px;
      margin-bottom: 10px;
    }
    .scene-title {
      font-weight: bold;
      margin-bottom: 5px;
      font-size: 14px;
    }
    .scene-camera, .scene-instructions {
      font-size: 0.9em;
      margin-bottom: 5px;
      color: #666;
    }
    .scene-instructions {
      color: #444;
    }
    .teleprompter-container {
      position: relative;
      width: 100%;
      padding-top: 56.25%; /* 16:9 Aspect Ratio */
      overflow: hidden;
      background: #000;
      border-radius: 5px;
      display: flex;
      flex-direction: column;
      margin-top: 20px;
    }
    #teleprompter-frame {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      background: #000;
      border-radius: 5px;
      overflow: hidden;
    }
    #teleprompter-frame::-webkit-scrollbar {
      width: 8px;
    }
    #teleprompter-frame::-webkit-scrollbar-track {
      background: #1a1a1a;
    }
    #teleprompter-frame::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 4px;
    }
    #teleprompter-frame::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    #console-output {
      background: #1e1e1e;
      color: #fff;
      font-family: monospace;
      padding: 10px;
      width: 100%;
      height: 300px;
      overflow-y: auto;
      text-align: left;
      border-radius: 5px;
      font-size: 14px;
      line-height: 1.4;
      margin-top: auto;
      box-sizing: border-box;
    }
    #buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    button {
      padding: 10px 20px;
      cursor: pointer;
      font-size: 14px;
      width: 100%;
      text-align: left;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #fff;
      transition: background-color 0.2s;
    }
    button:hover {
      background: #f0f0f0;
    }
    #status {
      margin: 10px 0;
      font-weight: bold;
      text-align: center;
      padding: 10px;
      background: #f8f8f8;
      border-radius: 4px;
    }
    video {
      width: 640px;
      margin: 10px auto;
      display: block;
      border: 2px solid #ccc;
    }
    #console-output .timestamp {
      color: #888;
    }
    #console-output .error {
      color: #ff6b6b;
    }
    #console-output .info {
      color: #4ecdc4;
    }
    .camera-controls {
      margin-bottom: 20px;
    }
    .ptz-controls {
      margin-top: 10px;
    }
    .control-group {
      margin: 10px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .control-group label {
      min-width: 80px;
      flex-shrink: 0;
    }
    .control-group input[type="range"] {
      flex: 1;
      min-width: 0;
    }
    .control-group span {
      display: inline-block;
      min-width: 60px;
      flex-shrink: 0;
    }
    #cameraSelect {
      width: 100%;
      padding: 5px;
    }
    input[type="number"] {
      width: 80px;
    }
    .camera-preview {
      margin-bottom: 15px;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
      aspect-ratio: 16/9;
    }
    #webcamPreview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .camera-select {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }
    .camera-select select {
      flex: 1;
      padding: 5px;
    }
  </style>
</head>
<body>
  <div class="main-content">
    <h1>AI Director Shots</h1>
    <div class="scene-container">
`;

  // Generate the shot cards from the array
  scenes.forEach((scene, idx) => {
    html += `
      <div class="scene-card" onclick="initScene('${encodeURIComponent(scene.directory)}')">
        <div class="scene-title">Scene #${idx + 1}: ${scene.description}</div>
        <img src="./database/scenes/${scene.directory}/thumbnail.jpg" alt="${scene.description}" />
      </div>
    `;
  });

  // close the main content and add sidebar
  html += `
    </div>
    <div id="videos"></div>
    <div class="controls-section">
      <h2>Console Output</h2>
      <div id="console-output"></div>
    </div>
  </div>
  <div class="sidebar">
    <div class="controls-section">
      <h2>Camera Controls</h2>
      <div class="camera-controls">
        <div class="camera-preview">
          <video id="webcamPreview" autoplay playsinline></video>
        </div>
        <div class="camera-select">
          <select id="cameraSelect" onchange="selectCamera(this.value)">
            <option value="">Select Camera</option>
          </select>
          <select id="resolutionSelect" onchange="updateResolution()">
            <option value="3840x2160">4K (3840x2160)</option>
            <option value="1920x1080">1080p (1920x1080)</option>
            <option value="1280x720" selected>720p (1280x720)</option>
            <option value="640x480">480p (640x480)</option>
            <option value="640x360">360p (640x360)</option>
          </select>
        </div>
        <div class="ptz-controls">
          <div class="control-group">
            <label>Pan</label>
            <input type="range" id="panSlider" min="-468000" max="468000" step="3600" value="0" oninput="updatePTZ()">
            <span id="panValue">0°</span>
          </div>
          <div class="control-group">
            <label>Tilt</label>
            <input type="range" id="tiltSlider" min="-324000" max="324000" step="3600" value="0" oninput="updatePTZ()">
            <span id="tiltValue">0°</span>
          </div>
          <div class="control-group">
            <label>O Zoom</label>
            <input type="range" id="zoomSlider" min="0" max="100" step="1" value="0" oninput="updatePTZ()">
            <span id="zoomValue">0%</span>
          </div>
        </div>
      </div>
    </div>
    <div class="controls-section">
      <h2>Controls</h2>
      <div id="buttons">
        <button id="actionBtn" onclick="action()" style="display: none; background-color: #e8f5e9; border-color: #4CAF50; color: #2e7d32;">Action!</button>
        <button id="actorsReadyBtn" onclick="actorsReady()" style="display: none; background-color: #e8f5e9; border-color: #4CAF50; color: #2e7d32;">Actors are Ready</button>
        <button onclick="recordVideo()">Record 3s Video & Process Pose</button>
        <button id="voiceBypassBtn" onclick="toggleVoiceBypass()">Enable Voice Bypass</button>
        <button onclick="openTeleprompter()">Open Teleprompter</button>
        <button onclick="testTeleprompter()">Test Teleprompter</button>
        <button onclick="testTeleprompterVideo()">Test Teleprompter Video</button>
        <button onclick="clearTeleprompter()">Clear Teleprompter</button>
        <button onclick="testConsole()">Test Console</button>
      </div>
    </div>
    <div id="status"></div>
    <div class="controls-section">
      <h2>Teleprompter Preview</h2>
      <div class="teleprompter-container">
        <iframe id="teleprompter-frame" src="/teleprompter"></iframe>
      </div>
    </div>
  </div>

  <script>
    // WebSocket connection for real-time updates
    const ws = new WebSocket('ws://' + window.location.host);
    
    ws.onopen = function() {
        appendToConsole('WebSocket connected', 'info');
    };

    ws.onerror = function(error) {
        appendToConsole('WebSocket error: ' + error.message, 'error');
    };

    ws.onclose = function() {
        appendToConsole('WebSocket connection closed', 'warn');
    };
    
    // Voice bypass state
    let voiceBypassEnabled = false;
    
    function toggleVoiceBypass() {
      voiceBypassEnabled = !voiceBypassEnabled;
      const btn = document.getElementById('voiceBypassBtn');
      btn.textContent = voiceBypassEnabled ? 'Disable Voice Bypass' : 'Enable Voice Bypass';
      btn.style.backgroundColor = voiceBypassEnabled ? '#ff4444' : '#4CAF50';
      
      // Send the bypass state to the server
      fetch('/setVoiceBypass', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: voiceBypassEnabled })
      })
      .then(res => res.json())
      .then(info => {
        document.getElementById('status').innerText = info.message;
      })
      .catch(err => {
        console.error(err);
        document.getElementById('status').innerText = 'Error: ' + err;
      });
    }
    
    ws.onmessage = function(event) {
      const data = JSON.parse(event.data);
      if (data.type === 'ACTORS_CALLED') {
        document.getElementById('actorsReadyBtn').style.display = 'inline-block';
        document.getElementById('status').innerText = 'Waiting for actors to be ready...';
      } else if (data.type === 'ACTORS_READY') {
        document.getElementById('actorsReadyBtn').style.display = 'none';
        document.getElementById('actionBtn').style.display = 'inline-block';
        document.getElementById('status').innerText = 'Actors are ready to perform!';
      } else if (data.type === 'CONSOLE') {
        appendToConsole(data.message, data.level);
      }
    };

    function appendToConsole(message, level = 'info') {
      const console = document.getElementById('console-output');
      const timestamp = new Date().toLocaleTimeString();
      const entry = document.createElement('div');
      entry.className = level;
      entry.innerHTML = '<span class="timestamp">[' + timestamp + ']</span> ' + message;
      console.appendChild(entry);
      console.scrollTop = console.scrollHeight;
    }

    function openTeleprompter() {
      window.open('/teleprompter', 'teleprompter', 'width=800,height=600');
    }

    function testTeleprompter() {
      // First send a message with an image
      fetch('/teleprompter/updateTeleprompter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'This is a test message with an image for the teleprompter.',
          image: '/database/test_content/headshot.jpg'
        })
      });

      // Then send a message without an image
      setTimeout(() => {
        fetch('/teleprompter/updateTeleprompter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: 'This is a test message without an image for the teleprompter.'
          })
        });
      }, 3000); // Wait 3 seconds before sending the second message
    }

    function testTeleprompterVideo() {
      fetch('/teleprompter/playTeleprompterVideo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoPath: '/database/test_content/freefall.mp4'
        })
      });
    }

    function clearTeleprompter() {
      fetch('/teleprompter/clearTeleprompter', { method: 'POST' })
        .then(res => res.json())
        .then(info => {
          document.getElementById('status').innerText = info.message;
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function initScene(directory) {
      fetch('/initScene/' + encodeURIComponent(directory))
        .then(res => res.json())
        .then(info => {
          document.getElementById('status').innerText = info.message;
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function actorsReady() {
      document.getElementById('status').innerText = 'Notifying system that actors are ready...';
      fetch('/actorsReady', { method: 'POST' })
        .then(res => res.json())
        .then(info => {
          document.getElementById('status').innerText = info.message;
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function recordVideo() {
      document.getElementById('status').innerText = 'Recording video...';
      fetch('/camera/recordVideo')
        .then(res => res.json())
        .then(info => {
          if (!info.success) {
            document.getElementById('status').innerText = 'Error: ' + info.message;
            return;
          }
          document.getElementById('status').innerText = info.message || 'Video recorded.';
          const vidDiv = document.getElementById('videos');
          vidDiv.innerHTML = \`
            <h3>Original Video</h3>
            <video controls src="/video/\${info.originalName}"></video>
            <h3>Overlay Video</h3>
            <video controls src="/video/\${info.overlayName}"></video>
          \`;
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function updatePTZ() {
      const data = {
        pan: parseInt(document.getElementById('panSlider').value),
        tilt: parseInt(document.getElementById('tiltSlider').value),
        zoom: parseInt(document.getElementById('zoomSlider').value)
      };

      // Update display values
      document.getElementById('panValue').textContent = (data.pan / 3600).toFixed(1) + '°';
      document.getElementById('tiltValue').textContent = (data.tilt / 3600).toFixed(1) + '°';
      document.getElementById('zoomValue').textContent = data.zoom + '%';

      // Send to server
      fetch('/camera/ptz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    function selectCamera(camera) {
      if (!camera) return;
      
      fetch('/camera/selectCamera', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ camera })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          document.getElementById('status').innerText = data.message;
          // Reinitialize webcam with selected camera
          initWebcam(camera);
        } else {
          document.getElementById('status').innerText = 'Error: ' + data.message;
        }
      })
      .catch(err => {
        document.getElementById('status').innerText = 'Error: ' + err;
      });
    }

    // Initialize camera controls when page loads
    window.addEventListener('load', async () => {
      console.log('Loading cameras...');
      try {
        // First get the list of available video devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log('Available video devices:', videoDevices);
        
        // Get the server's camera list
        const response = await fetch('/camera/cameras');
        const cameras = await response.json();
        console.log('Server cameras:', cameras);
        
        const select = document.getElementById('cameraSelect');
        select.innerHTML = '<option value="">Select Camera</option>';
        
        // Add each camera from the server's list
        cameras.forEach(camera => {
          const option = document.createElement('option');
          option.value = camera.name;
          option.textContent = camera.name;
          option.dataset.device = camera.device;
          option.dataset.isPTZ = camera.isPTZ;
          select.appendChild(option);
        });
        
        // If we have video devices, try to initialize the first one
        if (videoDevices.length > 0) {
          await initWebcam();
        }
      } catch (err) {
        console.error('Error loading cameras:', err);
        document.getElementById('status').innerText = 'Error loading cameras: ' + err.message;
      }
    });

    // Initialize webcam preview
    async function initWebcam(deviceId = null) {
      try {
        // Stop current stream if it exists
        const video = document.getElementById('webcamPreview');
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
        }

        // Get the selected camera option
        const cameraSelect = document.getElementById('cameraSelect');
        const selectedOption = cameraSelect.options[cameraSelect.selectedIndex];
        
        // Start with basic constraints
        const constraints = {
          video: {
            frameRate: { ideal: 30 }
          }
        };

        // If we have a selected camera, try to use it
        if (selectedOption && selectedOption.value) {
          try {
            // First try with the device ID from the server
            constraints.video.deviceId = { exact: selectedOption.dataset.device };
            console.log('Trying to use device:', selectedOption.dataset.device);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            
            // Get the actual capabilities of the stream
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            console.log('Camera capabilities:', capabilities);
            
            // Update status
            document.getElementById('status').innerText = 'Camera initialized: ' + selectedOption.textContent;
            return;
          } catch (err) {
            console.log('Failed with device ID, trying alternative method...', err);
            
            // Try to find the device in the enumerated devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            const matchingDevice = videoDevices.find(device => 
              device.label.toLowerCase().includes(selectedOption.textContent.toLowerCase())
            );
            
            if (matchingDevice) {
              try {
                constraints.video.deviceId = { exact: matchingDevice.deviceId };
                console.log('Trying to use matching device:', matchingDevice.label);
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                video.srcObject = stream;
                document.getElementById('status').innerText = 'Camera initialized: ' + selectedOption.textContent;
                return;
              } catch (err) {
                console.log('Failed with matching device, trying without deviceId...', err);
              }
            }
            
            // If all else fails, try without deviceId
            delete constraints.video.deviceId;
          }
        }
        
        // Try to get the stream with basic constraints
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        // Get the actual capabilities of the stream
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        console.log('Camera capabilities:', capabilities);
        
        // Update status
        document.getElementById('status').innerText = 'Camera initialized successfully';
        
      } catch (err) {
        console.error('Error accessing webcam:', err);
        document.getElementById('status').innerText = 'Error accessing webcam: ' + err.message;
      }
    }

    function updateResolution() {
      // Get current camera selection
      const cameraSelect = document.getElementById('cameraSelect');
      const selectedCamera = cameraSelect.value;
      // Reinitialize with current camera
      initWebcam(selectedCamera);
    }

    // Initialize everything when the page loads
    document.addEventListener('DOMContentLoaded', () => {
      // Don't automatically initialize webcam on load
      // Let the user select a camera first
      initCameraControls();
      initSceneControls();
    });

    function action() {
      document.getElementById('status').innerText = 'Starting action...';
      fetch('/action', { method: 'POST' })
        .then(res => res.json())
        .then(info => {
          document.getElementById('status').innerText = info.message;
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function testConsole() {
        fetch('/testConsole', { method: 'POST' })
            .then(res => res.json())
            .then(info => {
                appendToConsole('Test console message sent', 'info');
            })
            .catch(err => {
                appendToConsole('Error testing console: ' + err, 'error');
            });
    }
  </script>
</body>
</html>
`;

  return html;
};