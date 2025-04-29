import { logToConsole } from './modules/logger.js';
import { initializeResizers } from './modules/layout-resizer.js';
import { CameraManager } from './modules/camera-manager.js';

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
  document.getElementById('testRecordBtn')?.addEventListener('click', testAudioRecord);
  document.getElementById('voiceBypassBtn')?.addEventListener('click', toggleVoiceBypass);
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
  // Create CameraManager instance using the imported class
  const cameraManager = new CameraManager();
  // Expose globally ONLY IF absolutely necessary (e.g., for inline onclick in HTML)
  // window.cameraManager = cameraManager; // Avoid if possible

  // --- Initialize Components ---
  logToConsole("DOM loaded. Initializing components...", "info");
  
  // Initialize Session Management (assuming it stays here for now)
  initializeSessionManagement(); 

  // Initialize Camera Manager
  if (cameraManager.initialize) {
    cameraManager.initialize().catch(err => {
        logToConsole(`CameraManager initialization failed: ${err}`, 'error');
    });
  } else {
      logToConsole("CameraManager or initialize method not found", 'error');
  }

  // Initialize Resizers (already moved)
  initializeResizers();

  // --- Event Listeners for Controls (Ensure relevant ones are attached) ---
  // (Double check listeners that might have been inside CameraManager or need the instance)
  // e.g., The addCameraBtn listener is correctly re-added above.

}); // End DOMContentLoaded 