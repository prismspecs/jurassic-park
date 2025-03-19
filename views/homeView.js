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
      text-align: center;
    }
    h1 {
      margin: 20px;
    }
    .scene-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
      padding: 20px;
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
    }
    .scene-card:hover {
      transform: translateY(-3px);
    }
    .scene-card img {
      width: 100%;  
      height: 100%;
      object-fit: cover;
    }
    .scene-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .scene-camera, .scene-instructions {
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .scene-instructions {
      color: #444;
    }
    #buttons {
      margin: 20px;
    }
    button {
      padding: 10px 20px;
      cursor: pointer;
      margin: 5px;
      font-size: 16px;
    }
    #status {
      margin: 10px;
      font-weight: bold;
    }
    video {
      width: 640px;
      margin: 10px auto;
      display: block;
      border: 2px solid #ccc;
    }
  </style>
</head>
<body>
  <h1>AI Director Shots</h1>
  <div id="buttons">
    <button onclick="recordVideo()">Record 3s Video & Process Pose</button>
    <button id="voiceBypassBtn" onclick="toggleVoiceBypass()">Enable Voice Bypass</button>
    <button id="actorsReadyBtn" onclick="actorsReady()" style="display: none;">Actors are Ready</button>
  </div>
  <div id="status"></div>
  <div class="shot-container">
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

  // close the shot container, add a <div> for final videos, plus JS
  html += `
  </div>
  <div id="videos"></div>

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
      }
    };

    function actorsReady() {
      document.getElementById('status').innerText = 'Notifying system that actors are ready...';
      fetch('/actorsReady', { method: 'POST' })
        .then(res => res.json())
        .then(info => {
          if (!info.success) {
            document.getElementById('status').innerText = 'Error: ' + info.message;
            return;
          }
        })
        .catch(err => {
          console.error(err);
          document.getElementById('status').innerText = 'Error: ' + err;
        });
    }

    function initScene(directory) {
      fetch('/initScene/' + encodeURIComponent(directory)) // Encode again to be safe
        .then(res => {
          if (!res.ok) alert('Error starting shot ' + idx);
        })
        .catch(err => console.error(err));
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