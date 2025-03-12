/*******************************************************
 * homeView.js
 *
 * Returns the entire HTML for the main page as a string.
 * We dynamically insert "shots" into the shot cards.
 *******************************************************/
module.exports = function buildHomeHTML(shots) {
    // Start building the page
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>AI Director Shots</title>
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
    .shot-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
      padding: 20px;
    }
    .shot-card {
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      width: 220px;
      padding: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      cursor: pointer;
      transition: transform 0.2s ease;
    }
    .shot-card:hover {
      transform: translateY(-3px);
    }
    .shot-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .shot-camera, .shot-instructions {
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .shot-instructions {
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
  </div>
  <div id="status"></div>
  <div class="shot-container">
`;

    // Generate the shot cards from the array
    shots.forEach((shot, idx) => {
        html += `
    <div class="shot-card" onclick="startShot(${idx})">
      <div class="shot-title">Shot #${idx + 1}: ${shot.description}</div>
      <div class="shot-camera">Camera: ${shot.cameraAngle}</div>
      <div class="shot-instructions">${shot.instructions}</div>
    </div>
`;
    });

    // close the shot container, add a <div> for final videos, plus JS
    html += `
  </div>
  <div id="videos"></div>

  <script>
    function startShot(idx) {
      fetch('/startShot/' + idx)
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