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
      height: 200px;
      overflow: hidden;
      background: #000;
      border-radius: 5px;
      display: flex;
      flex-direction: column;
      margin-top: 20px;
    }
    #teleprompter-frame {
      width: 100%;
      height: 100%;
      border: none;
      background: #000;
      border-radius: 5px;
      overflow: hidden;
      font-size: 12px; /* Base font size for the preview */
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
      <h2>Controls</h2>
      <div id="buttons">
        <button onclick="recordVideo()">Record 3s Video & Process Pose</button>
        <button id="voiceBypassBtn" onclick="toggleVoiceBypass()">Enable Voice Bypass</button>
        <button id="actorsReadyBtn" onclick="actorsReady()" style="display: none;">Actors are Ready</button>
        <button onclick="openTeleprompter()">Open Teleprompter</button>
        <button onclick="testTeleprompter()">Test Teleprompter</button>
        <button onclick="clearTeleprompter()">Clear Teleprompter</button>
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
      const messages = [
        {
          text: 'Test actor message ' + new Date().toLocaleTimeString(),
          style: 'actor',
          image: './database/scenes/001 - see dinosaurs/thumbnail.jpg'
        },
        {
          text: 'Test direction message ' + new Date().toLocaleTimeString(),
          style: 'direction'
        },
        {
          text: 'Test action message ' + new Date().toLocaleTimeString(),
          style: 'action'
        },
        {
          text: 'Test normal message ' + new Date().toLocaleTimeString(),
          style: 'normal'
        }
      ];

      // Send each message with a slight delay
      messages.forEach((msg, index) => {
        setTimeout(() => {
          fetch('/updateTeleprompter', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(msg)
          })
          .then(res => res.json())
          .then(info => {
            document.getElementById('status').innerText = info.message;
          })
          .catch(err => {
            console.error(err);
            document.getElementById('status').innerText = 'Error: ' + err;
          });
        }, index * 1000); // Send each message 1 second apart
      });
    }

    function clearTeleprompter() {
      fetch('/clearTeleprompter', { method: 'POST' })
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
      const btn = document.getElementById('actorsReadyBtn');
      btn.disabled = true;
      document.getElementById('status').innerText = 'Notifying system that actors are ready...';
      
      fetch('/actorsReady', { method: 'POST' })
        .then(res => res.json())
        .then(info => {
          document.getElementById('status').innerText = info.message;
          appendToConsole('Actors ready notification sent', 'info');
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
          appendToConsole('Error sending actors ready notification: ' + err, 'error');
          btn.disabled = false;
        });
    }

    function recordVideo() {
      document.getElementById('status').innerText = 'Recording video...';
      fetch('/recordVideo')
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
  </script>
</body>
</html>
`;

  return html;
};