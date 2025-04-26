// Wrap everything in an event listener to ensure the DOM is ready,
// especially if the script tag doesn't use 'defer'.
// Using 'defer' is generally better.
document.addEventListener('DOMContentLoaded', () => {

  // --- Global Variables ---
  const ws = new WebSocket("ws://" + window.location.host);
  const consoleOutput = document.getElementById("console-output");
  let voiceBypassEnabled = true;
  let lastAudioRecording = null;

  // --- WebSocket Handlers ---
  ws.onopen = function () {
    console.log("WebSocket connection established");
    logToConsole("WebSocket connected", "info");
    fetch("/getVoiceBypass")
      .then((res) => res.json())
      .then((data) => {
        voiceBypassEnabled = data.enabled;
        updateVoiceBypassButton();
      })
      .catch((err) => {
        console.error("Error fetching voice bypass state:", err);
        logToConsole("Error fetching voice bypass state", "error");
      });
  };

  ws.onerror = function (error) {
    console.error("WebSocket error:", error);
    logToConsole("WebSocket error: " + (error.message || "Unknown error"), "error");
  };

  ws.onclose = function () {
    console.log("WebSocket connection closed");
    logToConsole("WebSocket connection closed", "warn");
  };

  ws.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      console.log('Message from server:', data);

      // --- ADDED: Forward relevant messages to teleprompter iframe ---
      const teleprompterFrame = document.getElementById('teleprompter-frame');
      const characterTeleprompterWindows = {}; // Store refs if needed

      // Determine if the message is for the main teleprompter or a character teleprompter
      const teleprompterMessageTypes = [
          'TELEPROMPTER', 
          'ACTOR_CALLS', 
          'CLEAR_TELEPROMPTER', 
          'PLAY_VIDEO' // Assuming general teleprompter video
      ];
      const characterTeleprompterMessageTypes = [
          'SHOT_START',
          'TELEPROMPTER_CONTROL',
          'SCENE_ENDED',
          'SYSTEM_RESET',
          'TELEPROMPTER_STATUS'
      ];

      if (teleprompterMessageTypes.includes(data.type)) {
          if (teleprompterFrame && teleprompterFrame.contentWindow) {
              teleprompterFrame.contentWindow.postMessage(data, '*'); // Target can be more specific than '*'
          } else {
              console.warn('Teleprompter frame not found or not loaded yet.');
          }
      } else if (characterTeleprompterMessageTypes.includes(data.type)) {
          // Find the appropriate character teleprompter window
          // This requires managing references to opened character windows, 
          // maybe store them in the `characterTeleprompterWindows` object keyed by character name
          // For now, we'll just log it
          console.log('Received character teleprompter message, but forwarding logic needs implementation:', data);
          // Example if you had window references:
          // if (data.character && characterTeleprompterWindows[data.character]) {
          //     characterTeleprompterWindows[data.character].postMessage(data, '*');
          // }
      }

      // --- Original message handling for home.ejs ---
      switch (data.type) {
        case 'CONSOLE':
          logToConsole(data.message, data.level);
          break;
        case 'SESSION_UPDATE':
          updateSessionUI(data.sessionId);
          break;
        case 'ACTORS_CALLED':
          document.getElementById("actorsReadyBtn").style.display = "inline-block";
          document.getElementById("actionBtn").style.display = "none"; // Hide action btn
          document.getElementById("status").innerText = "Waiting for actors to be ready...";
          break;
        case 'ACTORS_READY':
          document.getElementById("actorsReadyBtn").style.display = "none";
          document.getElementById("actionBtn").style.display = "inline-block";
          document.getElementById("status").innerText = "Actors are ready to perform!";
          break;
        // Add other message types handled by the server if needed
        default:
          console.log("Received unhandled message type:", data.type);
      }
    } catch (error) {
      console.error('Error parsing message or handling update:', error);
      logToConsole('Received non-JSON message or error handling update.', 'error');
    }
  };

  // --- ADDED: Handler for SHOT_CAMERA_DESCRIPTIONS message ---
  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'SHOT_CAMERA_DESCRIPTIONS') {
        console.log('Received shot camera descriptions:', data.descriptions);
        
        // Clear previous descriptions first (optional, good practice)
        document.querySelectorAll('.shot-camera-description').forEach(el => el.remove());
        
        data.descriptions.forEach(camInfo => {
          // Ensure cameraManager and its elements are ready
          if (window.cameraManager && window.cameraManager.cameraElements) { 
            const cameraElement = window.cameraManager.cameraElements.get(camInfo.name);
            if (cameraElement) {
              // Find a suitable place to insert the description, e.g., after the header
              const headerElement = cameraElement.querySelector('.camera-header');
              if (headerElement) {
                const descElement = document.createElement('p');
                descElement.className = 'shot-camera-description'; // Add class for easy removal later
                descElement.textContent = `Shot Role: ${camInfo.description}`;
                // Insert after the header
                headerElement.parentNode.insertBefore(descElement, headerElement.nextSibling); 
              }
            }
          } else {
            console.warn('CameraManager not ready when SHOT_CAMERA_DESCRIPTIONS received.');
          }
        });
      }
    } catch (error) {
      // Ignore errors if message wasn't JSON or didn't have the expected type
      if (!(error instanceof SyntaxError)) {
           console.error('Error handling SHOT_CAMERA_DESCRIPTIONS:', error);
      } 
    }
  });
  // --- END ADDED --- 

  // --- UI Update Functions ---
  function updateSessionUI(newSessionId) {
    const currentSessionSpan = document.getElementById('current-session-id');
    if (currentSessionSpan) {
      currentSessionSpan.textContent = newSessionId;
    }
    document.querySelectorAll('.session-item').forEach(item => {
      const button = item.querySelector('.session-button');
      const deleteButton = item.querySelector('.delete-session-button');
      const sessionInButton = button?.getAttribute('onclick')?.match(/selectSession\\('(.*?)'\\)/)?.[1]; // Escaped parentheses

      if (button && sessionInButton) {
        if (sessionInButton === newSessionId) {
          button.classList.add('active');
          if (deleteButton) deleteButton.style.display = 'none';
        } else {
          button.classList.remove('active');
          if (deleteButton) deleteButton.style.display = ''; // Use default display style
        }
      }
    });
    logToConsole(`Session updated to: ${newSessionId}`, 'info');
  }

  function updateVoiceBypassButton() {
    const btn = document.getElementById("voiceBypassBtn");
    if (btn) {
      btn.textContent = voiceBypassEnabled ? "Disable Voice Bypass" : "Enable Voice Bypass";
      btn.style.backgroundColor = voiceBypassEnabled ? "#ff4444" : "#4CAF50";
    }
  }

  // --- Logging Function ---
  function logToConsole(message, level = 'info') {
    const entry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
    if (consoleOutput) {
      consoleOutput.appendChild(entry);
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    } else {
      console.error("Console output element (#console-output) not found!");
    }
  }

  // --- Session Management Functions ---
  async function selectSession(sessionId) {
    logToConsole(`Attempting to switch to session: ${sessionId}`, 'info');
    try {
      const response = await fetch('/api/select-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `sessionId=${encodeURIComponent(sessionId)}`
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.error || `HTTP error ${response.status}`);
      }
      logToConsole(`Successfully requested switch to session: ${sessionId}`, 'success');
      // UI update is handled by the SESSION_UPDATE broadcast message from the server
    } catch (error) {
      console.error('Error selecting session:', error);
      logToConsole(`Error selecting session: ${error.message}`, 'error');
    }
  }

  async function deleteSession(sessionId) {
    if (!confirm(`Are you sure you want to permanently delete session ${sessionId} and all its recordings?`)) {
      return;
    }
    logToConsole(`Attempting to delete session: ${sessionId}`, 'warn');
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.error || `HTTP error ${response.status}`);
      }
      logToConsole(`Successfully deleted session: ${sessionId}`, 'success');
      // Remove the session item from the UI
      const sessionList = document.getElementById('existing-sessions-list');
      // Adjusted selector to be more robust
      const itemToRemove = Array.from(sessionList.querySelectorAll('.session-item')).find(item => {
          const button = item.querySelector('.session-button');
          return button && button.getAttribute('onclick') === `selectSession('${sessionId}')`;
      });
      if (itemToRemove) {
        itemToRemove.remove();
      }
      if (!sessionList.querySelector('.session-item')) {
        sessionList.innerHTML = '<p>No other sessions found.</p>';
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      logToConsole(`Error deleting session ${sessionId}: ${error.message}`, 'error');
    }
  }

  // --- Control Button Functions ---
  function toggleVoiceBypass() {
    const newState = !voiceBypassEnabled;
    fetch("/setVoiceBypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newState }),
    })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        voiceBypassEnabled = newState; // Update state only on success
        updateVoiceBypassButton();
        document.getElementById("status").innerText = info.message;
        logToConsole(`Voice Bypass ${newState ? 'enabled' : 'disabled'}.`, 'info');
      })
      .catch(err => {
        console.error("Set Bypass Error:", err);
        document.getElementById("status").innerText = "Error setting bypass: " + err;
        logToConsole(`Error setting bypass: ${err}`, 'error');
        // Don't change UI state if request failed
      });
  }

  function openTeleprompter() {
    window.open("/teleprompter", "teleprompter", "width=800,height=600");
  }

  function openCharacterTeleprompter(character) {
    window.open(`/teleprompter/${character}`, `teleprompter-${character}`, "width=800,height=600");
  }

  function testTeleprompter() {
    logToConsole("Testing teleprompter message...", 'info');
    // Example actor ID - replace if needed
    const exampleActorId = "Alan-Grant-A1B2C3";
    const headshotPath = `/database/actors/${exampleActorId}/headshot.jpg`;
    fetch("/teleprompter/updateTeleprompter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test message with image", image: headshotPath }),
    })
      .then(res => { if (!res.ok) logToConsole(`Test Teleprompter Error (1): ${res.statusText}`, 'error'); })
      .catch(err => logToConsole(`Test Teleprompter Error (1): ${err}`, 'error'));
    setTimeout(() => {
      fetch("/teleprompter/updateTeleprompter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test message without image" }),
      })
        .then(res => { if (!res.ok) logToConsole(`Test Teleprompter Error (2): ${res.statusText}`, 'error'); })
        .catch(err => logToConsole(`Test Teleprompter Error (2): ${err}`, 'error'));
    }, 3000);
  }

  function testTeleprompterVideo() {
    logToConsole("Testing teleprompter video...", 'info');
    const exampleVideoPath = "/database/test_content/freefall.mp4"; // Check path
    fetch("/teleprompter/playTeleprompterVideo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoPath: exampleVideoPath }),
    })
      .then(res => { if (!res.ok) logToConsole(`Test Teleprompter Video Error: ${res.statusText}`, 'error'); })
      .catch(err => logToConsole(`Test Teleprompter Video Error: ${err}`, 'error'));
  }

  function clearTeleprompter() {
    logToConsole("Clearing teleprompter...", 'info');
    fetch("/teleprompter/clearTeleprompter", { method: "POST" })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        document.getElementById("status").innerText = info.message;
        logToConsole("Teleprompter cleared.", 'info');
      })
      .catch(err => {
        console.error("Clear Teleprompter Error:", err);
        document.getElementById("status").innerText = "Error clearing teleprompter: " + err;
        logToConsole(`Error clearing teleprompter: ${err}`, 'error');
      });
  }

  function initShot(sceneDirectory, shotIdentifier) {
    const sceneDirDecoded = decodeURIComponent(sceneDirectory);
    const shotIdDecoded = decodeURIComponent(shotIdentifier);
    logToConsole(`Requesting shot init: Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'`, 'info');
    document.getElementById("status").innerText = `Initializing Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'...`;
    
    const apiUrl = `/initShot/${sceneDirectory}/${shotIdentifier}`; 
    
    fetch(apiUrl)
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        document.getElementById("status").innerText = info.message;
        logToConsole(`Shot init request sent for Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'.`, 'success');
      })
      .catch(err => {
        console.error("Init Shot Error:", err);
        document.getElementById("status").innerText = "Error initializing shot: " + err;
        logToConsole(`Error initializing Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}': ${err}`, 'error');
      });
  }

  function actorsReady() {
    logToConsole("Sending Actors Ready signal...", 'info');
    document.getElementById("status").innerText = "Notifying system: actors ready...";
    fetch("/actorsReady", { method: "POST" })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        document.getElementById("status").innerText = info.message;
        logToConsole("Actors Ready signal sent.", 'success');
      })
      .catch(err => {
        console.error("Actors Ready Error:", err);
        document.getElementById("status").innerText = "Error sending Actors Ready: " + err;
        logToConsole(`Error sending Actors Ready: ${err}`, 'error');
      });
  }

  function handlePipelineChange(pipeline) {
    logToConsole(`Recording pipeline set to: ${pipeline}`, "info");
    // If pipeline choice needs to be sent to server, do it here.
  }

  async function recordVideo() {
    // This button triggers the test recording route for a specific camera
    // Requires camera selection UI element to be implemented for proper use
    // PROBLEM: This function relies on cameraManager being defined globally or passed in.
    // For now, assume cameraManager is globally available (see end of file)
    const selectedCameraName = "Camera 1"; // Placeholder - NEEDS UI element to select camera
    document.getElementById("status").innerText = `Recording TEST video from ${selectedCameraName}...`;
    const pipeline = document.getElementById("recording-pipeline").value;
    const useFfmpeg = pipeline === "ffmpeg";
    const resolution = document.getElementById("recording-resolution").value;
    logToConsole(`Starting TEST recording for ${selectedCameraName} with ${pipeline} pipeline at ${resolution}`, "info");
    try {
      const response = await fetch(`/camera/${encodeURIComponent(selectedCameraName)}/record?useFfmpeg=${useFfmpeg}&resolution=${resolution}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.error || `HTTP error ${response.status}`);
      }
      logToConsole(`Test recording successful for ${selectedCameraName}. Output: ${result.overlayName}`, 'success');
      document.getElementById("status").innerText = `Test recording finished: ${result.overlayName}`;
      // Optionally display video in #videos div?
      // const vidDiv = document.getElementById("videos");
      // const session = document.getElementById('current-session-id')?.textContent;
      // if(vidDiv && session && result.overlayName) {
      //     vidDiv.innerHTML = `<h3>Test Overlay Video (${selectedCameraName})</h3><video controls src="/recordings/${session}/${result.overlayName}"></video>`;
      // }
    } catch (error) {
      logToConsole(`Test recording error for ${selectedCameraName}: ${error.message}`, "error");
      document.getElementById("status").innerText = `Test recording failed: ${error.message}`;
    }
  }

  function action() {
    logToConsole("Sending Action signal...", 'info');
    document.getElementById("status").innerText = "Starting action...";
    fetch("/action", { method: "POST" })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        document.getElementById("status").innerText = info.message;
        logToConsole("Action signal sent.", 'success');
      })
      .catch(err => {
        console.error("Action Error:", err);
        document.getElementById("status").innerText = "Error sending Action: " + err;
        logToConsole(`Error sending Action: ${err}`, 'error');
      });
  }

  function testConsole() {
    fetch("/testConsole", { method: "POST" })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => { document.getElementById("status").innerText = info.message; })
      .catch(err => {
        console.error("Test Console Error:", err);
        document.getElementById("status").innerText = "Error testing console: " + err;
      });
  }

  function pauseAllTeleprompters() {
    ws.send(JSON.stringify({ type: "TELEPROMPTER_CONTROL", action: "PAUSE" }));
    logToConsole("Paused all teleprompters", "info");
  }

  function playAllTeleprompters() {
    ws.send(JSON.stringify({ type: "TELEPROMPTER_CONTROL", action: "PLAY" }));
    logToConsole("Resumed all teleprompters", "info");
  }

  // --- Audio Functions ---
  function testAudioRecord() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        const audioChunks = [];
        mediaRecorder.ondataavailable = (e) => { audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          const formData = new FormData();
          // Use a timestamp in the filename for uniqueness in temp dir
          formData.append("audio", audioBlob, `rec_${Date.now()}.webm`);
          logToConsole("Sending audio data to server...", 'info');
          try {
            const response = await fetch("/recordAudio", { method: "POST", body: formData });
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.message || `HTTP error ${response.status}`);
            }
            logToConsole(`Audio recorded: ${data.filename}`, "info");
            lastAudioRecording = data.filename; // Store relative filename from session dir
          } catch (err) {
            logToConsole(`Error recording audio: ${err.message}`, "error");
          }
        };
        mediaRecorder.start();
        logToConsole("Recording audio for 5 seconds...", "info");
        setTimeout(() => {
          try {
            if (mediaRecorder.state === "recording") {
              mediaRecorder.stop();
            }
            stream.getTracks().forEach((track) => track.stop()); // Stop microphone access
          } catch (e) { console.error("Error stopping recorder/stream:", e); }
        }, 5000);
      })
      .catch((err) => logToConsole(`Error accessing microphone: ${err.message}`, "error"));
  }

  function playLastRecording() {
    if (!lastAudioRecording) {
      logToConsole("No audio recording available to play", "warn");
      return;
    }
    const currentSessionId = document.getElementById('current-session-id')?.textContent;
    if (!currentSessionId) {
      logToConsole("Cannot determine current session ID to play audio.", "error");
      return;
    }
    // Assumes Express serves /recordings static path
    const audioUrl = `/recordings/${currentSessionId.trim()}/${lastAudioRecording}`; // Added trim()
    logToConsole(`Attempting to play: ${audioUrl}`, 'info');
    const audio = new Audio(audioUrl);
    audio.onerror = (e) => {
      console.error("Audio playback error:", e);
      logToConsole(`Error playing audio from ${audioUrl}. Check server serves /recordings or if file exists.`, "error");
    };
    audio.play()
      .then(() => logToConsole(`Playing ${lastAudioRecording}...`, "info"))
      .catch((err) => logToConsole(`Error initiating audio playback: ${err.message}`, "error"));
  }

  function clearAudio() {
    if (!lastAudioRecording) {
      logToConsole("No audio recording available to clear", "warn");
      return;
    }
    logToConsole("Clear Audio button needs server-side endpoint (e.g., DELETE /api/sessions/:id/audio/:filename).", "warn");
    // Example client-side removal (doesn't delete server file):
    // lastAudioRecording = null;
    // logToConsole("Cleared last audio recording reference (client-side only).", "info");
  }

  // --- Actor Loading Logic ---
  const loadActorsBtn = document.getElementById('loadActorsBtn');
  const actorFilesInput = document.getElementById('actorFiles');
  const loadActorsStatus = document.getElementById('loadActorsStatus');
  if (loadActorsBtn && actorFilesInput && loadActorsStatus) {
    loadActorsBtn.addEventListener('click', async () => {
      const files = actorFilesInput.files;
      if (!files || files.length === 0) { // Check if files is null or empty
        loadActorsStatus.textContent = 'Please select files to load.';
        loadActorsStatus.className = 'status-error'; return;
      }
      const formData = new FormData();
      for (const file of files) { formData.append('files', file); }
      loadActorsStatus.textContent = 'Loading...';
      loadActorsStatus.className = 'status-info';
      try {
        const response = await fetch('/loadActors', { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message || `HTTP error ${response.status}`);
        }
        loadActorsStatus.textContent = result.message || 'Actors loaded!';
        loadActorsStatus.className = 'status-success';
        actorFilesInput.value = ''; // Clear file input
      } catch (error) {
        console.error("Actor Load Error:", error);
        loadActorsStatus.textContent = `Error: ${error.message}`;
        loadActorsStatus.className = 'status-error';
      }
    });
  }

  // --- Camera Manager ---
  class CameraManager {
    constructor() {
      this.cameras = [];
      this.cameraElements = new Map();
      this.availableDevices = []; // Browser devices { deviceId, label, kind, groupId }
      this.ptzDevices = [];
      this.serverDevices = []; // Server devices { id, name }
      this.cameraDefaults = [];
    }

    async initialize() {
      try {
        // --- Get Browser Devices and Request Permissions FIRST ---
        logToConsole("Attempting to enumerate browser devices...", "info");
        let browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
        this.availableDevices = browserDevicesRaw.filter(
          (device) => device.kind === "videoinput"
        );
        logToConsole(`Initial browser devices found: ${this.availableDevices.length}`, "info");
        if (this.availableDevices.length > 0) {
          const labelsMissing = !this.availableDevices[0].label;
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
          if (labelsMissing || isMac) {
            logToConsole("Labels missing or on macOS, requesting camera access for labels...", "info");
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true });
              stream.getTracks().forEach((track) => track.stop());
              browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
              this.availableDevices = browserDevicesRaw.filter(device => device.kind === "videoinput");
              logToConsole(`Browser devices after requesting permission: ${this.availableDevices.length}`, "info");
            } catch (err) {
              logToConsole(`Error requesting camera permission: ${err.message}`, "error");
            }
          }
        }

        // --- Get Server Configuration & Devices ---
        logToConsole("Fetching server configuration and devices...", "info");
        const camerasResponse = await fetch("/camera/cameras");
        if (!camerasResponse.ok) throw new Error(`HTTP error! status: ${camerasResponse.status}`);
        this.cameras = await camerasResponse.json();

        const configResponse = await fetch("/config");
        if (!configResponse.ok) throw new Error(`HTTP error! status: ${configResponse.status}`);
        const config = await configResponse.json();
        this.cameraDefaults = config.cameraDefaults || [];

        const devicesResponse = await fetch("/camera/devices");
        if (!devicesResponse.ok) throw new Error(`HTTP error! status: ${devicesResponse.status}`);
        this.serverDevices = await devicesResponse.json(); // Still need server devices for Recording dropdown
        logToConsole(`Server reported ${this.serverDevices.length} devices`, "info");

        // --- Get PTZ Devices ---
        if (this.cameras.length > 0) {
          logToConsole("Fetching PTZ devices...", "info");
          try {
            const ptzResponse = await fetch("/camera/ptz-devices");
            if (ptzResponse.ok) {
              this.ptzDevices = await ptzResponse.json();
              logToConsole(`Found ${this.ptzDevices.length} PTZ devices`, "info");
            }
          } catch (ptzError) {
            this.ptzDevices = [];
            logToConsole(`Error fetching PTZ devices: ${ptzError.message}`, "error");
          }
        } else {
          this.ptzDevices = [];
        }

        this.renderCameraControls();
        logToConsole(`Camera manager initialized with ${this.cameras.length} cameras`, "success");

      } catch (err) {
        logToConsole(`Error initializing camera manager: ${err.message}`, "error");
      }
    }

    async addCamera() {
      const cameraIndex = this.cameras.length;
      const name = `Camera_${cameraIndex + 1}`;

      // Get the defaults for this camera index, or use empty defaults if none exist
      const defaults = this.cameraDefaults[cameraIndex] || {
        previewDevice: "",
        recordingDevice: "",
        ptzDevice: "",
      };

      try {
        logToConsole(`Adding new camera: ${name}...`, "info");
        const response = await fetch("/camera/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            previewDevice: defaults.previewDevice,
            recordingDevice: defaults.recordingDevice,
            ptzDevice: defaults.ptzDevice,
          }),
        });

        if (response.ok) {
          logToConsole(`Camera ${name} added successfully`, "success");
          await this.initialize(); // Refresh the camera list
        } else {
          const error = await response.json();
          throw new Error(error.message || `HTTP error ${response.status}`);
        }
      } catch (err) {
        logToConsole(`Error adding camera: ${err.message}`, "error");
      }
    }

    async removeCamera(name) {
      if (!confirm(`Are you sure you want to remove camera '${name}'?`)) {
        return;
      }

      try {
        logToConsole(`Removing camera: ${name}...`, "warn");
        const response = await fetch("/camera/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (response.ok) {
          logToConsole(`Camera ${name} removed successfully`, "success");
          await this.initialize(); // Refresh the camera list
        } else {
          const error = await response.json();
          throw new Error(error.message || `HTTP error ${response.status}`);
        }
      } catch (err) {
        logToConsole(`Error removing camera: ${err.message}`, "error");
      }
    }

    renderCameraControls() {
      const container = document.getElementById("cameraControls");
      if (!container) {
         console.error("Camera controls container not found!");
         logToConsole("Error: Camera controls container missing from DOM.", "error");
         return;
      }
      container.innerHTML = "";
      this.cameraElements.clear(); // Clear the map before re-rendering

      if (this.cameras.length === 0) {
        container.innerHTML = '<p>No cameras configured. Click "Add Camera" to set up a camera.</p>';
        return;
      }

      // --- Render controls for each camera ---
      this.cameras.forEach((camera) => {
        const cameraElement = this.createCameraElement(camera);
        container.appendChild(cameraElement);
        this.cameraElements.set(camera.name, cameraElement); // Store element reference
      });

      // --- NEW: Initial render of PTZ controls AFTER elements are in DOM ---
      this.cameras.forEach((camera) => {
        if (camera.ptzDevice) {
           // Check if the element exists before rendering
           const cameraElement = this.cameraElements.get(camera.name);
           if (cameraElement && container.contains(cameraElement)) {
             this.renderPTZControlsForCamera(camera.name, camera.ptzDevice);
           } else {
             console.warn(`Camera element for ${camera.name} not found in DOM for initial PTZ render.`);
           }
        }
      });
      // --- END NEW ---
    }

    createCameraElement(camera) {
      const div = document.createElement("div");
      div.className = "camera-control";

      // --- Determine Preview Display Label & Initial ID --- 
      let currentPreviewDisplayLabel = "No device selected";
      const currentPreviewBrowserId = camera.previewDevice;
      let initialPreviewCallNeeded = false;

      if (currentPreviewBrowserId) {
        const browserDevice = this.availableDevices.find(d => d.deviceId === currentPreviewBrowserId);
        if (browserDevice) {
          currentPreviewDisplayLabel = browserDevice.label || currentPreviewBrowserId;
          initialPreviewCallNeeded = true; // We have a valid browser ID to init with
        } else {
          currentPreviewDisplayLabel = `Saved ID not found: ${currentPreviewBrowserId}`;
        }
      }

      // Dynamically build the options for preview devices
      let previewOptionsHtml = '<option value="">Select Preview Device</option>';
      this.availableDevices.forEach(browserDevice => {
          const serverDevice = this.serverDevices.find(sd => sd.name?.startsWith(browserDevice.label));
          const displayLabel = serverDevice 
              ? `${browserDevice.label} (${serverDevice.id})` 
              : (browserDevice.label || browserDevice.deviceId);
          const selected = browserDevice.deviceId === currentPreviewBrowserId ? "selected" : "";
          previewOptionsHtml += `<option value="${browserDevice.deviceId}" ${selected}>${displayLabel}</option>`;
      });
      
      // Dynamically build the options for recording devices
      let recordingOptionsHtml = '<option value="">Select Recording Device</option>';
      this.serverDevices.forEach(serverDevice => {
          const selected = serverDevice.id === camera.recordingDevice ? "selected" : "";
          recordingOptionsHtml += `<option value="${serverDevice.id}" ${selected}>${serverDevice.name || serverDevice.id}</option>`;
      });

      // Dynamically build the options for PTZ devices
      let ptzOptionsHtml = '<option value="">Select PTZ Device</option>';
      this.ptzDevices.forEach(device => {
          const value = device.id || device.path;
          const selected = value === camera.ptzDevice ? "selected" : "";
          ptzOptionsHtml += `<option value="${value}" ${selected}>${device.name || value}</option>`;
      });


      div.innerHTML = `
          <div class="camera-header">
            <h3>${camera.name.replace(/_/g, ' ')}</h3>
            <button class="remove-btn" title="Remove ${camera.name}">❌</button>
          </div>
          <div class="camera-preview">
            <video id="preview-${camera.name}" autoplay playsinline></video>
            <div class="device-info">Using: ${currentPreviewDisplayLabel}</div>
          </div>
          <div class="camera-settings">
            <div class="setting-group">
              <label>Preview Device:</label>
              <select class="preview-device">
                ${previewOptionsHtml}
              </select>
            </div>
            <div class="setting-group">
              <label>Recording Device:</label>
               <select class="recording-device">
                ${recordingOptionsHtml}
              </select>
            </div>
            <div class="setting-group">
              <label>PTZ Device:</label>
              <select class="ptz-device">
                 ${ptzOptionsHtml}
              </select>
            </div>
            <div class="ptz-controls-container">
              <!-- PTZ controls will be added here if a PTZ device is selected -->
            </div>
            <div class="camera-controls">
              <button class="test-record-btn">Test Record Video (${camera.name.replace(/_/g, ' ')})</button>
            </div>
          </div>
        `;

      // Add event listeners programmatically
      div.querySelector('.remove-btn').addEventListener('click', () => this.removeCamera(camera.name));
      div.querySelector('.preview-device').addEventListener('change', (e) => this.updatePreviewDevice(camera.name, e.target.value));
      div.querySelector('.recording-device').addEventListener('change', (e) => {
          logToConsole('Recording Device changed to: ' + e.target.value, 'info');
          this.updateRecordingDevice(camera.name, e.target.value);
      });
      div.querySelector('.ptz-device').addEventListener('change', (e) => this.updatePTZDevice(camera.name, e.target.value));
      div.querySelector('.test-record-btn').addEventListener('click', () => this.recordVideo(camera.name));


      // Initialize preview if we have a valid browser ID from config
      if (initialPreviewCallNeeded) {
        logToConsole(`Initializing preview for ${camera.name} using browserId: ${currentPreviewBrowserId}`, "info");
        // Use setTimeout to ensure the element is fully in the DOM and getUserMedia doesn't block
        setTimeout(() => {
          this.updatePreviewDevice(camera.name, currentPreviewBrowserId);
        }, 100);
      }

      return div;
    }

    async updatePreviewDevice(cameraName, browserDeviceId) {
      logToConsole(`Updating preview device for ${cameraName} with browser device ID: ${browserDeviceId}`, "info");
      try {
        // Update server - send browserDeviceId 
        await fetch("/camera/preview-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraName, deviceId: browserDeviceId }),
        });

        const videoElement = document.getElementById(`preview-${cameraName}`);
        if (!videoElement) {
          logToConsole(`Video element for ${cameraName} not found`, "error");
          return;
        }

        // Stop any existing stream
        if (videoElement.srcObject) {
          const tracks = videoElement.srcObject.getTracks();
          tracks.forEach(track => track.stop());
          videoElement.srcObject = null;
        }

        // Use browserDeviceId directly for getUserMedia
        if (browserDeviceId) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: browserDeviceId } }
            });
            videoElement.srcObject = stream;

            const browserDevice = this.availableDevices.find(d => d.deviceId === browserDeviceId);
            const displayLabel = browserDevice ? (browserDevice.label || browserDeviceId) : 'Unknown';
            const deviceInfoElement = videoElement.nextElementSibling;
            if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) { // Check class
              deviceInfoElement.textContent = `Using: ${displayLabel}`;
            }
            logToConsole(`Preview for ${cameraName} started with device: ${displayLabel}`, "success");
          } catch (err) {
            logToConsole(`Error starting camera preview: ${err.message}`, "error");
            // Clear label if getUserMedia fails
             const deviceInfoElement = videoElement.nextElementSibling;
             if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) {
                 deviceInfoElement.textContent = `Error: ${err.message}`;
             }
          }
        } else {
          // No device selected, just update the info text
          const deviceInfoElement = videoElement.nextElementSibling;
          if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) {
            deviceInfoElement.textContent = "No device selected";
          }
        }
      } catch (err) {
        logToConsole(`Error updating preview device: ${err.message}`, "error");
      }
    }

    async updateRecordingDevice(cameraName, serverDeviceId) {
      logToConsole(`Setting recording device for ${cameraName} with server device ID: ${serverDeviceId}`, "info");
      try {
        const response = await fetch("/camera/recording-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraName, deviceId: serverDeviceId }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logToConsole(`Error setting recording device: ${errorText}`, "error");
          throw new Error(`Server error: ${response.status}`);
        }

        const responseData = await response.json();
        logToConsole(`Recording device set for ${cameraName}`, "success");
      } catch (err) {
        logToConsole(`Error updating recording device: ${err.message}`, "error");
      }
    }

    async updatePTZDevice(cameraName, serverDeviceId) {
      logToConsole(`Setting PTZ device for ${cameraName} with server device ID: ${serverDeviceId}`, "info");
      try {
        const response = await fetch("/camera/ptz-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraName, deviceId: serverDeviceId }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logToConsole(`Error setting PTZ device: ${errorText}`, "error");
          throw new Error(`Server error: ${response.status}`);
        }

        const responseData = await response.json();
        logToConsole(`PTZ device set for ${cameraName}`, "success");

        // --- NEW: Render PTZ controls after setting a device ---
        this.renderPTZControlsForCamera(cameraName, serverDeviceId);
        // --- END NEW ---

      } catch (err) {
        logToConsole(`Error updating PTZ device: ${err.message}`, "error");
      }
    }

    // --- NEW: Function to render PTZ controls for a specific camera ---
    renderPTZControlsForCamera(cameraName, ptzDeviceId) {
      const cameraElement = this.cameraElements.get(cameraName);
      if (!cameraElement) return;

      const ptzContainer = cameraElement.querySelector('.ptz-controls-container');
      if (!ptzContainer) return;

      // Clear previous controls
      ptzContainer.innerHTML = '';

      // Only render controls if a valid PTZ device is selected
      if (ptzDeviceId) {
        // Use unique IDs per camera instance
        const panId = `ptz-pan-${cameraName}`;
        const tiltId = `ptz-tilt-${cameraName}`;
        const zoomId = `ptz-zoom-${cameraName}`;
        const panValueId = `ptz-pan-value-${cameraName}`;
        const tiltValueId = `ptz-tilt-value-${cameraName}`;
        const zoomValueId = `ptz-zoom-value-${cameraName}`;

        ptzContainer.innerHTML = `
          <div class="ptz-control-group">
            <label for="${panId}">Pan:</label>
            <input type="range" id="${panId}" name="pan" min="-468000" max="468000" step="3600" value="0" 
                   title="Pan">
            <span id="${panValueId}" class="ptz-value-display">0.0°</span> 
          </div>
          <div class="ptz-control-group">
            <label for="${tiltId}">Tilt:</label>
            <input type="range" id="${tiltId}" name="tilt" min="-324000" max="324000" step="3600" value="0"
                   title="Tilt">
            <span id="${tiltValueId}" class="ptz-value-display">0.0°</span> 
          </div>
          <div class="ptz-control-group">
            <label for="${zoomId}">Zoom:</label>
            <input type="range" id="${zoomId}" name="zoom" min="0" max="100" step="1" value="0"
                   title="Zoom">
            <span id="${zoomValueId}" class="ptz-value-display">0%</span> 
          </div>
        `;

        // Add event listeners programmatically
        document.getElementById(panId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'pan', e.target.value));
        document.getElementById(tiltId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'tilt', e.target.value));
        document.getElementById(zoomId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'zoom', e.target.value));

      } else {
        ptzContainer.innerHTML = '<p class="ptz-placeholder">Select a PTZ device to enable controls.</p>';
      }
    }

    // --- NEW: Handler for PTZ slider input changes ---
    handlePTZInputChange(cameraName, control, value) {
      const rawValue = parseInt(value);
      let displayValue = '';
      let displaySpanId = '';

      // Update display span based on control type
      switch (control) {
        case 'pan':
          displayValue = (rawValue / 3600).toFixed(1) + '°';
          displaySpanId = `ptz-pan-value-${cameraName}`;
          break;
        case 'tilt':
          displayValue = (rawValue / 3600).toFixed(1) + '°';
          displaySpanId = `ptz-tilt-value-${cameraName}`;
          break;
        case 'zoom':
          displayValue = rawValue + '%';
          displaySpanId = `ptz-zoom-value-${cameraName}`;
          break;
      }

      const displaySpan = document.getElementById(displaySpanId);
      if (displaySpan) {
        displaySpan.textContent = displayValue;
      }

      // Call the existing method to send data to the server (add throttling/debouncing here if needed)
      this.updatePTZ(cameraName, control, rawValue);
    }
    // --- END NEW ---

    // Existing method to send PTZ command to server
    async updatePTZ(cameraName, control, value) {
      // Add debouncing or throttling here if PTZ updates are too frequent
      try {
        await fetch("/camera/ptz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraName,
            [control]: parseInt(value)
          }),
        });
        // Optional: log success/failure
      } catch (err) {
        logToConsole(`Error updating PTZ controls: ${err.message}`, "error");
      }
    }

    async recordVideo(cameraName) {
      logToConsole(`Starting recording for ${cameraName}...`, "info");
      const statusElement = document.getElementById("status");
      if (statusElement) statusElement.innerText = `Recording from ${cameraName}...`;

      const pipelineElement = document.getElementById("recording-pipeline");
      const resolutionElement = document.getElementById("recording-resolution");

      const pipeline = pipelineElement ? pipelineElement.value : 'gstreamer'; // Default if element not found
      const useFfmpeg = pipeline === "ffmpeg";
      const resolution = resolutionElement ? resolutionElement.value : '1920x1080'; // Default

      try {
        const response = await fetch(
          `/camera/${encodeURIComponent(cameraName)}/record?useFfmpeg=${useFfmpeg}&resolution=${resolution}`,
          { method: "POST" }
        );

        if (!response.ok) {
          const errorText = await response.text(); // Get error details
          throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        logToConsole(`Recording complete for ${cameraName}. Output: ${result.overlayName}`, "success");
        if (statusElement) statusElement.innerText = `Recording finished: ${result.overlayName}`;

        // Construct correct video path using current session ID
        const sessionIdElement = document.getElementById('current-session-id');
        const currentSessionId = sessionIdElement ? sessionIdElement.textContent.trim() : null; // TRIM the whitespace

        const vidDiv = document.getElementById("videos");

        if (vidDiv && currentSessionId && result.overlayName) {
          const videoPath = `/recordings/${encodeURIComponent(currentSessionId)}/${encodeURIComponent(result.overlayName)}`;
          logToConsole(`Displaying video: ${videoPath}`, "info");
          vidDiv.innerHTML = `
            <h3>Overlay Video (${cameraName.replace(/_/g, ' ')})</h3>
            <video controls src="${videoPath}"></video>
          `;
        } else if (!currentSessionId) {
          logToConsole("Could not find current session ID to display video", "error");
        } else if (!vidDiv) {
          logToConsole("Video display container '#videos' not found.", "error");
        }
      } catch (error) {
        logToConsole(`Recording error for ${cameraName}: ${error.message}`, "error");
         if (statusElement) statusElement.innerText = `Recording failed: ${error.message}`;
      }
    }
  }
  
  // Make CameraManager instance globally accessible IF NEEDED by inline event handlers
  // It's generally better to attach event listeners programmatically (as done above for CameraManager)
  // window.cameraManager = new CameraManager(); // Expose globally
  const cameraManager = new CameraManager();

  // --- Initialize Camera Manager ---
  // No need for window.onload as DOMContentLoaded is used
  logToConsole("DOM loaded. Initializing components...", "info");
  if (cameraManager.initialize) {
    cameraManager.initialize().catch(err => {
        logToConsole(`CameraManager initialization failed: ${err}`, 'error');
    });
  } else {
      logToConsole("CameraManager or initialize method not found", 'error');
  }


  // --- Resizer Logic ---
  function initializeResizers() {
    const leftSidebar = document.querySelector('.left-sidebar');
    const mainContent = document.querySelector('.main-content');
    const rightSidebar = document.querySelector('.sidebar');
    const resizerLeftMain = document.getElementById('resizer-left-main');
    const resizerMainRight = document.getElementById('resizer-main-right');

    // Check if all elements exist before proceeding
    if (!leftSidebar || !mainContent || !rightSidebar || !resizerLeftMain || !resizerMainRight) {
        console.error("One or more layout elements or resizers not found. Resizing disabled.");
        logToConsole("Layout resizing setup failed: Elements missing.", "error");
        return; 
    }

    let isResizing = false;
    let startX, initialLeftBasis, initialRightBasis;
    let currentResizer = null;
    let initialMainContentWidth = 0; // Store main content width for right handle

    // Helper to get computed basis or width
    const getBasis = (el) => {
      const basis = getComputedStyle(el).flexBasis;
      if (basis === 'auto' || basis === 'content' || !basis.endsWith('px')) {
        // console.warn('getBasis falling back to offsetWidth for element:', el, 'Computed flex-basis was:', basis);
        return el.offsetWidth;
      }
      return parseInt(basis, 10);
    };

    const startResize = (e, resizer) => {
      // Prevent text selection during drag
      e.preventDefault(); 
      
      isResizing = true;
      currentResizer = resizer;
      startX = e.clientX;

      // Get initial basis values
      initialLeftBasis = getBasis(leftSidebar);
      initialRightBasis = getBasis(rightSidebar);
      initialMainContentWidth = mainContent.offsetWidth; // Get main content width

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize'; // Indicate resizing globally
      // document.body.style.pointerEvents = 'none'; // Might interfere with mouseup? Test.

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', stopResize, { once: true }); // Use {once: true} for cleanup
    };

    const handleMouseMove = (e) => {
      if (!isResizing) return;

      // Use requestAnimationFrame for smoother resizing (optional but good practice)
      window.requestAnimationFrame(() => {
          const currentX = e.clientX;
          const dx = currentX - startX;

          const minLeftWidth = parseInt(getComputedStyle(leftSidebar).minWidth, 10) || 50; // Fallback min width
          const minRightWidth = parseInt(getComputedStyle(rightSidebar).minWidth, 10) || 50;
          const minMainWidth = parseInt(getComputedStyle(mainContent).minWidth, 10) || 100;
          const totalWidth = document.querySelector('.page-layout').offsetWidth; // Use page-layout width

          if (currentResizer === resizerLeftMain) {
              let newLeftBasis = initialLeftBasis + dx;
              let newMainWidth = initialMainContentWidth - dx; // Main adjusts oppositely

              // Ensure minimums are respected
              if (newLeftBasis < minLeftWidth) {
                  newLeftBasis = minLeftWidth;
                  newMainWidth = totalWidth - newLeftBasis - initialRightBasis - (resizerLeftMain.offsetWidth + resizerMainRight.offsetWidth); // Recalculate main width
              } 
              // Check if main content is too small
              if (newMainWidth < minMainWidth) {
                  newMainWidth = minMainWidth;
                  newLeftBasis = totalWidth - newMainWidth - initialRightBasis - (resizerLeftMain.offsetWidth + resizerMainRight.offsetWidth); // Recalculate left width
              }

              leftSidebar.style.flexBasis = `${newLeftBasis}px`;
              mainContent.style.flexBasis = `${newMainWidth}px`; // Adjust main explicitly
              mainContent.style.flexGrow = '0'; // Prevent flex grow during drag

          } else if (currentResizer === resizerMainRight) {
              let newRightBasis = initialRightBasis - dx; // Right sidebar shrinks as mouse moves right
              let newMainWidth = initialMainContentWidth + dx; // Main grows

              // Ensure minimums are respected
              if (newRightBasis < minRightWidth) {
                  newRightBasis = minRightWidth;
                  newMainWidth = totalWidth - initialLeftBasis - newRightBasis - (resizerLeftMain.offsetWidth + resizerMainRight.offsetWidth);
              }
              if (newMainWidth < minMainWidth) {
                  newMainWidth = minMainWidth;
                  newRightBasis = totalWidth - initialLeftBasis - newMainWidth - (resizerLeftMain.offsetWidth + resizerMainRight.offsetWidth);
              }
              
              rightSidebar.style.flexBasis = `${newRightBasis}px`;
              mainContent.style.flexBasis = `${newMainWidth}px`;
              mainContent.style.flexGrow = '0'; 
          }
      });
    };

    const stopResize = () => {
      if (isResizing) {
        isResizing = false;
        
        document.removeEventListener('mousemove', handleMouseMove);
        // 'mouseup' listener removed by {once: true}

        // Restore user interaction styles
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        // document.body.style.pointerEvents = '';

        // Allow flexbox to take over again by removing explicit basis and restoring grow
        mainContent.style.flexGrow = '1'; 
        mainContent.style.flexBasis = '0'; // Or 'auto', '0' often works better with flex-grow=1
        // Optionally reset sidebar basis if needed, or let them keep their dragged size
        // leftSidebar.style.flexBasis = 'auto'; // Example if you want it to reset
        // rightSidebar.style.flexBasis = 'auto'; // Example

        currentResizer = null; // Clear the current resizer
      }
    };

    resizerLeftMain.addEventListener('mousedown', (e) => startResize(e, resizerLeftMain));
    resizerMainRight.addEventListener('mousedown', (e) => startResize(e, resizerMainRight));
  }

  // Initialize resizers after DOM is ready
  initializeResizers();

  // --- Make functions globally available IF they are called by inline `onclick` handlers ---
  // It's better to attach event listeners programmatically instead.
  // Example: document.getElementById('someButton').addEventListener('click', someFunction);
  window.selectSession = selectSession;
  window.deleteSession = deleteSession;
  window.initShot = initShot; 
  window.toggleVoiceBypass = toggleVoiceBypass;
  window.actorsReady = actorsReady;
  window.recordVideo = recordVideo; // This one is tricky as it uses cameraManager instance
  window.action = action;
  window.testConsole = testConsole;
  window.testAudioRecord = testAudioRecord;
  window.playLastRecording = playLastRecording;
  window.clearAudio = clearAudio;
  window.openTeleprompter = openTeleprompter;
  window.openCharacterTeleprompter = openCharacterTeleprompter;
  window.testTeleprompter = testTeleprompter;
  window.testTeleprompterVideo = testTeleprompterVideo;
  window.clearTeleprompter = clearTeleprompter;
  window.pauseAllTeleprompters = pauseAllTeleprompters;
  window.playAllTeleprompters = playAllTeleprompters;
  window.handlePipelineChange = handlePipelineChange;
  // CameraManager methods called by inline handlers need the instance to be global
  // or attached to window. We already made `cameraManager` a global const
  // but we also need to expose the instance methods used by onclicks
  window.cameraManager = cameraManager; 


}); // End DOMContentLoaded 