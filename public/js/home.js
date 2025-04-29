import { logToConsole } from './modules/logger.js';
import { initializeResizers } from './modules/layout-resizer.js';

// Wrap everything in an event listener to ensure the DOM is ready,
// especially if the script tag doesn't use 'defer'.
// Using 'defer' is generally better.
document.addEventListener('DOMContentLoaded', () => {

  // --- Global Variables ---
  const ws = new WebSocket("ws://" + window.location.host);
  // Session UI elements
  const currentSessionSpan = document.getElementById('current-session-id');
  const noSessionWarningSpan = document.getElementById('no-session-warning');
  const sessionListSelect = document.getElementById('session-list');
  const selectSessionBtn = document.getElementById('select-session-btn');
  const newSessionNameInput = document.getElementById('new-session-name');
  const createSessionBtn = document.getElementById('create-session-btn');
  const sessionErrorDiv = document.getElementById('session-error');
  
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
        case 'SESSION_UPDATE': // Received when session changes (creation or selection)
          console.log('SESSION_UPDATE received with sessionId:', data.sessionId);
          updateCurrentSessionDisplay(data.sessionId);
          // Potentially update the dropdown selection as well
          if (sessionListSelect && data.sessionId) {
            sessionListSelect.value = data.sessionId;
          }
          break;
        case 'SESSION_LIST_UPDATE': // Received when a session is created/deleted
          console.log('SESSION_LIST_UPDATE received', data.sessions);
          populateSessionList(data.sessions || []);
          // After repopulating, re-select the current one if it exists
          const currentId = currentSessionSpan ? currentSessionSpan.textContent : null;
          if (sessionListSelect && currentId && currentId !== 'Loading...') {
              sessionListSelect.value = currentId;
          }
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
    
    // Ensure newSessionId is trimmed of any whitespace
    const trimmedNewSessionId = newSessionId.trim();
    console.log('Updating session UI for:', trimmedNewSessionId);
    
    // First, remove the active class from all session buttons
    document.querySelectorAll('.session-button').forEach(button => {
      button.classList.remove('active');
    });
    
    // Then, show all delete buttons
    document.querySelectorAll('.delete-session-button').forEach(button => {
      button.style.display = '';
    });
    
    // Find the button for the new active session and update it
    document.querySelectorAll('.session-item').forEach(item => {
      const button = item.querySelector('.session-button');
      const deleteButton = item.querySelector('.delete-session-button');
      
      if (!button) return;
      
      // Extract session ID directly from the onclick attribute 
      const onclickAttr = button.getAttribute('onclick') || '';
      const match = onclickAttr.match(/selectSession\('([^']+)'\)/);
      
      if (match) {
        const sessionInButton = match[1].trim();
        
        // Compare with the new session ID
        if (sessionInButton === trimmedNewSessionId) {
          console.log('Adding active class to:', sessionInButton);
          button.classList.add('active');
          if (deleteButton) deleteButton.style.display = 'none';
        }
      }
    });
    
    logToConsole(`Session updated to: ${trimmedNewSessionId}`, 'info');
  }

  function updateVoiceBypassButton() {
    const btn = document.getElementById("voiceBypassBtn");
    if (btn) {
      btn.textContent = voiceBypassEnabled ? "Disable Voice Bypass" : "Enable Voice Bypass";
      btn.style.backgroundColor = voiceBypassEnabled ? "#ff4444" : "#4CAF50";
    }
  }

  // --- Session Management Functions (NEW/UPDATED) ---

  // Fetch initial session state and list
  async function initializeSessionManagement() {
      await fetchCurrentSession();
      await fetchSessionList();
  }

  // Fetch and display the currently active session
  async function fetchCurrentSession() {
      try {
          const response = await fetch('/api/sessions/current');
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          const data = await response.json();
          updateCurrentSessionDisplay(data.sessionId);
      } catch (error) {
          console.error('Error fetching current session:', error);
          logToConsole(`Error fetching current session: ${error.message}`, 'error');
          updateCurrentSessionDisplay(null); // Indicate error or no session
          showSessionError('Failed to fetch current session.');
      }
  }

  // Fetch the list of sessions and populate the dropdown
  async function fetchSessionList() {
      try {
          const response = await fetch('/api/sessions');
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          const sessions = await response.json();
          populateSessionList(sessions);
          // Try to select the current session in the dropdown after loading
          const currentId = currentSessionSpan ? currentSessionSpan.textContent : null;
           if (sessionListSelect && currentId && currentId !== 'Loading...' && currentId !== '(No session selected)') {
              sessionListSelect.value = currentId;
           }
      } catch (error) {
          console.error('Error fetching session list:', error);
          logToConsole(`Error fetching session list: ${error.message}`, 'error');
          if (sessionListSelect) {
              sessionListSelect.innerHTML = '<option value="">Error loading sessions</option>';
          }
          showSessionError('Failed to load session list.');
      }
  }

  // Update the display of the current session ID
  function updateCurrentSessionDisplay(sessionId) {
      if (currentSessionSpan && noSessionWarningSpan) {
          if (sessionId) {
              currentSessionSpan.textContent = sessionId;
              currentSessionSpan.style.display = 'inline';
              noSessionWarningSpan.style.display = 'none';
          } else {
              currentSessionSpan.textContent = ''; // Clear it
              currentSessionSpan.style.display = 'none';
              noSessionWarningSpan.style.display = 'inline';
          }
      } else {
          console.error('Could not find session display elements');
      }
      // Clear any previous errors when session updates
      clearSessionError();
  }

  // Populate the session dropdown list
  function populateSessionList(sessions) {
      if (!sessionListSelect) return;
      sessionListSelect.innerHTML = ''; // Clear existing options
      if (!sessions || sessions.length === 0) {
          sessionListSelect.innerHTML = '<option value="">No sessions available</option>';
          return;
      }
      // Add a placeholder/default option
       sessionListSelect.innerHTML = '<option value="">-- Select a Session --</option>'; 
      sessions.forEach(sessionId => {
          const option = document.createElement('option');
          option.value = sessionId;
          option.textContent = sessionId; // Display the full ID for now
          sessionListSelect.appendChild(option);
      });
  }

  // Handle creating a new session
  async function createSession() {
      clearSessionError();
      const name = newSessionNameInput ? newSessionNameInput.value.trim() : '';
      if (!name) {
          showSessionError('Please enter a name for the new session.');
          return;
      }
      if (!createSessionBtn) return;
      
      createSessionBtn.disabled = true;
      createSessionBtn.textContent = 'Creating...';
      logToConsole(`Creating new session: ${name}`, 'info');

      try {
          const response = await fetch('/api/sessions/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name })
          });
          const result = await response.json();
          if (!response.ok) {
              throw new Error(result.message || result.error || `HTTP error ${response.status}`);
          }
          logToConsole(`Successfully created session: ${result.sessionId}`, 'success');
          if (newSessionNameInput) newSessionNameInput.value = ''; // Clear input
          // UI update (current session, list) is handled by SESSION_UPDATE and SESSION_LIST_UPDATE broadcasts
          
      } catch (error) {
          console.error('Error creating session:', error);
          logToConsole(`Error creating session: ${error.message}`, 'error');
          showSessionError(`Failed to create session: ${error.message}`);
      } finally {
          if(createSessionBtn) {
             createSessionBtn.disabled = false;
             createSessionBtn.textContent = 'Create & Load';
          }
      }
  }

  // Handle selecting an existing session
  async function selectSession() {
       clearSessionError();
       const selectedId = sessionListSelect ? sessionListSelect.value : null;
       if (!selectedId) {
           showSessionError('Please select a session from the list.');
           return;
       }
       if(!selectSessionBtn) return;
       
       selectSessionBtn.disabled = true;
       selectSessionBtn.textContent = 'Loading...';
       logToConsole(`Attempting to switch to session: ${selectedId}`, 'info');
       
       try {
          const response = await fetch('/api/select-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: selectedId })
          });
          const result = await response.json();
          if (!response.ok) {
              throw new Error(result.message || result.error || `HTTP error ${response.status}`);
          }
          logToConsole(`Successfully requested switch to session: ${selectedId}`, 'success');
          // Current session display update is handled by SESSION_UPDATE broadcast
      } catch (error) {
          console.error('Error selecting session:', error);
          logToConsole(`Error selecting session: ${error.message}`, 'error');
          showSessionError(`Failed to load session: ${error.message}`);
      } finally {
          if(selectSessionBtn) {
            selectSessionBtn.disabled = false;
            selectSessionBtn.textContent = 'Load Session';
          }
      }
  }

  // Show session-related error messages
  function showSessionError(message) {
      if (sessionErrorDiv) {
          sessionErrorDiv.textContent = message;
          sessionErrorDiv.style.display = 'block';
      }
  }

  // Clear session-related error messages
  function clearSessionError() {
      if (sessionErrorDiv) {
          sessionErrorDiv.textContent = '';
          sessionErrorDiv.style.display = 'none';
      }
  }
  
  // --- Event Listeners ---
  if (createSessionBtn && newSessionNameInput) {
    createSessionBtn.addEventListener('click', createSession);
    newSessionNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createSession();
        }
    });
  }
  
  if (selectSessionBtn && sessionListSelect) {
      selectSessionBtn.addEventListener('click', selectSession);
  }

  // Attach listener to the shot container for delegation
  const shotContainer = document.querySelector('.shot-container');
  if (shotContainer) {
    shotContainer.addEventListener('click', (event) => {
      // Find the closest ancestor which is a shot-card
      const shotCard = event.target.closest('.shot-card');
      if (shotCard) {
        const sceneDir = shotCard.dataset.sceneDir; // Access data-* attributes
        const shotId = shotCard.dataset.shotId;
        if (sceneDir && shotId) {
          initShot(sceneDir, shotId); // Call the function directly
        }
      }
    });
  }

  // Attach listeners for other control buttons by ID
  document.getElementById('actionBtn')?.addEventListener('click', action);
  document.getElementById('actorsReadyBtn')?.addEventListener('click', actorsReady);
  document.getElementById('testRecordBtn')?.addEventListener('click', recordVideo);
  document.getElementById('voiceBypassBtn')?.addEventListener('click', toggleVoiceBypass);
  document.getElementById('testConsoleBtn')?.addEventListener('click', testConsole);
  document.getElementById('testAudioRecordBtn')?.addEventListener('click', testAudioRecord);
  document.getElementById('playLastAudioBtn')?.addEventListener('click', playLastRecording);
  document.getElementById('clearAudioBtn')?.addEventListener('click', clearAudio);
  document.getElementById('openTeleprompterBtn')?.addEventListener('click', openTeleprompter);
  document.getElementById('openAlanTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('alan'));
  document.getElementById('openEllieTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('ellie'));
  document.getElementById('testTeleprompterBtn')?.addEventListener('click', testTeleprompter);
  // Assuming testTeleprompterVideo still needs onclick for now or needs an ID
  document.getElementById('clearTeleprompterBtn')?.addEventListener('click', clearTeleprompter);
  document.getElementById('pauseTeleprompterBtn')?.addEventListener('click', pauseAllTeleprompters);
  document.getElementById('playTeleprompterBtn')?.addEventListener('click', playAllTeleprompters);
  document.getElementById('addCameraBtn')?.addEventListener('click', () => cameraManager.addCamera());
  // Listener for recording pipeline dropdown
   document.getElementById('recording-pipeline')?.addEventListener('change', (e) => handlePipelineChange(e.target.value));
  // Listener for recording resolution dropdown (already added)

  // Initial load
  initializeSessionManagement();

  // --- OLD Session Functions (Keep for reference/potential reuse if needed) ---
  /*
  async function selectSession_OLD(sessionId) {
    // ... old implementation ... 
  }
  */
  
  /*
  async function deleteSession(sessionId) {
    // ... old implementation ...
  }
  */

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
    logToConsole(`Pipeline changed to: ${pipeline}`, 'info');
    // Update the server-side setting
    fetch('/api/settings/recording-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline: pipeline })
    })
    .then(response => {
        if (!response.ok) {
            response.text().then(text => { throw new Error(text || 'Failed to set pipeline') });
        }
        return response.json();
    })
    .then(data => {
        logToConsole(`Server setting updated: ${data.message}`, 'success');
    })
    .catch(error => {
        logToConsole(`Error updating server pipeline setting: ${error.message}`, 'error');
    });

    // You might want to update the CameraManager's internal state or UI if needed,
    // but currently the pipeline is only read server-side during recording start.
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

      // --- NEW: Associative Lookup for Preview Device ---
      const configuredPreviewPath = camera.previewDevice; // e.g., "/dev/video2"
      let targetBrowserDeviceId = null;
      let currentPreviewDisplayLabel = "No device selected";
      let initialPreviewCallNeeded = false;

      if (configuredPreviewPath) {
        // 1. Find server device info using the configured path
        const matchedServerDevice = this.serverDevices.find(sd => sd.id === configuredPreviewPath);
        
        if (matchedServerDevice?.name) {
          // 2. Use server device name to find matching browser device (heuristic)
          //    We might need to adjust the matching logic (e.g., startsWith, includes) depending on name formats
          // --- ADDED BROWSER DEVICE LABEL LOGGING ---
          console.log(`[Camera: ${camera.name}] Searching for match for server name '${matchedServerDevice.name}' within these browser devices:`);
          this.availableDevices.forEach((bd, index) => {
            console.log(`  Browser Device ${index}: label='${bd.label}', deviceId='${bd.deviceId}', kind='${bd.kind}', groupId='${bd.groupId}'`);
          });
          // --- END LOGGING ---
          const matchedBrowserDevice = this.availableDevices.find(bd => 
              bd.label && matchedServerDevice.name && 
              bd.label.startsWith(matchedServerDevice.name.split(' (')[0])
          );

          if (matchedBrowserDevice) {
            // 3. Get the actual browser device ID (hex string)
            targetBrowserDeviceId = matchedBrowserDevice.deviceId;
            currentPreviewDisplayLabel = matchedBrowserDevice.label || targetBrowserDeviceId;
            initialPreviewCallNeeded = true;
            console.log(`[Camera: ${camera.name}] Associated config path '${configuredPreviewPath}' to browser deviceId '${targetBrowserDeviceId}' via name '${matchedServerDevice.name}' / label '${matchedBrowserDevice.label}'`);
          } else {
            console.warn(`[Camera: ${camera.name}] Could not find matching browser device for server device named '${matchedServerDevice.name}' (path: ${configuredPreviewPath})`);
            currentPreviewDisplayLabel = `Browser device not found for ${configuredPreviewPath}`;
          }
        } else {
          console.warn(`[Camera: ${camera.name}] Could not find server device info for configured path: ${configuredPreviewPath}`);
          currentPreviewDisplayLabel = `Server device info not found for ${configuredPreviewPath}`;
        }
      } else {
        console.log(`[Camera: ${camera.name}] No previewDevice path configured.`);
      }
      // --- End Associative Lookup ---
      
      // Dynamically build the options for preview devices
      let previewOptionsHtml = '<option value="">Select Preview Device</option>';
      this.availableDevices.forEach(browserDevice => {
          // --- Refined Label Logic (using existing serverDevices list) ---
          const serverDevice = this.serverDevices.find(sd => 
              browserDevice.label && sd.name?.startsWith(browserDevice.label)
          );
          let displayLabel = browserDevice.label || `Device ID: ${browserDevice.deviceId.substring(0, 8)}...`;
          if (serverDevice) {
            displayLabel += ` (${serverDevice.id})`; // Append server path if found
          }
          // --- End Refined Label Logic ---

          // --- Use the LOOKED UP targetBrowserDeviceId for selection ---
          const selected = browserDevice.deviceId === targetBrowserDeviceId ? "selected" : "";
          if (selected) {
            console.log(`[Camera: ${camera.name}] MATCH FOUND for selected preview option! Target Device:`, browserDevice);
          }
          // --- End Selection Logic ---
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
      // --- DEBUG LOGGING START ---
      console.log(`[Camera: ${camera.name}] Building PTZ options. Saved PTZ Device:`, camera.ptzDevice);
      console.log(`[Camera: ${camera.name}] Available PTZ Devices:`, this.ptzDevices);
      // --- DEBUG LOGGING END ---
      this.ptzDevices.forEach(device => {
          const value = device.id || device.path;
          const selected = value === camera.ptzDevice ? "selected" : "";
          // --- MORE DEBUG LOGGING ---
          if (selected) {
            console.log(`[Camera: ${camera.name}] MATCH FOUND! Setting selected for PTZ device:`, device);
          }
          // --- END MORE DEBUG LOGGING ---
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


      // Initialize preview if a browser device was successfully associated
      if (initialPreviewCallNeeded && targetBrowserDeviceId) {
         logToConsole(`Initializing preview for ${camera.name} using associated browserId: ${targetBrowserDeviceId}`, "info");
         console.log(`[Camera: ${camera.name}] Calling updatePreviewDevice with associated browserDeviceId:`, targetBrowserDeviceId);
         // Use setTimeout to ensure the element is fully in the DOM and getUserMedia doesn't block
         setTimeout(() => {
           // --- Pass the LOOKED UP targetBrowserDeviceId ---
           this.updatePreviewDevice(camera.name, targetBrowserDeviceId);
         }, 100);
      } else {
          console.log(`[Camera: ${camera.name}] Skipping initial preview call. initialPreviewCallNeeded=${initialPreviewCallNeeded}, targetBrowserDeviceId=${targetBrowserDeviceId}`);
      }

      return div;
    }

    async updatePreviewDevice(cameraName, browserDeviceId) {
       logToConsole(`Updating preview device for ${cameraName} with browser device ID: ${browserDeviceId}`, "info");
       console.log(`[Camera: ${cameraName}] Entered updatePreviewDevice with browserDeviceId:`, browserDeviceId); // DEBUG
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
             console.log(`[Camera: ${cameraName}] Attempting getUserMedia with deviceId:`, browserDeviceId); // DEBUG
             const stream = await navigator.mediaDevices.getUserMedia({
               video: { deviceId: { exact: browserDeviceId } }
             });
             console.log(`[Camera: ${cameraName}] getUserMedia SUCCESSFUL. Stream:`, stream); // DEBUG
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
             console.error(`[Camera: ${cameraName}] getUserMedia FAILED:`, err); // DEBUG
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

  // Initialize resizers after DOM is ready
  initializeResizers();

  // --- Event Listeners for Controls ---
  const pipelineSelect = document.getElementById('recording-pipeline');
  if (pipelineSelect) {
      pipelineSelect.addEventListener('change', (e) => handlePipelineChange(e.target.value));
  }

  const resolutionSelect = document.getElementById('recording-resolution');
  if (resolutionSelect) {
      resolutionSelect.addEventListener('change', (e) => handleResolutionChange(e.target.value));
  }

  // --- Added: Function to handle resolution change ---
  function handleResolutionChange(resolution) {
    logToConsole(`Resolution changed to: ${resolution}`, 'info');
    // Update the server-side setting
    fetch('/api/settings/recording-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: resolution })
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => { throw new Error(text || 'Failed to set resolution') });
        }
        return response.json();
    })
    .then(data => {
        logToConsole(`Server resolution setting updated: ${data.message}`, 'success');
    })
    .catch(error => {
        logToConsole(`Error updating server resolution setting: ${error.message}`, 'error');
    });
  }

}); // End DOMContentLoaded 