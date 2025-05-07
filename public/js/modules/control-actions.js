import { logToConsole } from './logger.js';
import { sendWebSocketMessage } from './websocket-handler.js';
import { updateAssemblyUI } from './scene-assembly.js';

let currentShotData = null; // To store the current shot's data, including its cameras
let activeCanvasRecorders = {}; // { cameraName: MediaRecorder instance }
let recordedCanvasBlobs = {};   // { cameraName: [chunks] }
let currentShotDurationSec = 0; // To be updated by WebSocket SHOT_START event

// --- Control Button Functions ---

/**
 * Toggles the voice bypass setting via API call.
 * @param {boolean} currentBypassState - The current state of voiceBypassEnabled.
 * @returns {Promise<boolean>} - Promise resolving to the new bypass state on success, or the original state on failure.
 */
export async function toggleVoiceBypass(currentBypassState) {
  const newState = !currentBypassState;
  try {
    const response = await fetch("/setVoiceBypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newState }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    }

    const info = await response.json();
    document.getElementById("status").innerText = info.message; // Direct DOM manipulation - consider decoupling?
    logToConsole(`Voice Bypass ${newState ? 'enabled' : 'disabled'}.`, 'info');
    return newState; // Return new state on success
  } catch (err) {
    console.error("Set Bypass Error:", err);
    document.getElementById("status").innerText = "Error setting bypass: " + err.message;
    logToConsole(`Error setting bypass: ${err.message}`, 'error');
    return currentBypassState; // Return original state on failure
  }
}

/** Opens the main teleprompter window. */
export function openTeleprompter() {
  window.open("/teleprompter", "teleprompter", "width=800,height=600");
}

/** Opens a character-specific teleprompter window. */
export function openCharacterTeleprompter(character) {
  window.open(`/teleprompter/${character}`, `teleprompter-${character}`, "width=800,height=600");
}

/** Sends test messages to the teleprompter. */
export function testTeleprompter() {
  logToConsole("Testing teleprompter message...", 'info');
  const exampleActorId = "Alan-Grant-A1B2C3"; // Example ID
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

/** Sends a request to play a test video on the teleprompter. */
export function testTeleprompterVideo() {
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

/** Sends a request to clear the teleprompter. */
export function clearTeleprompter() {
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

/** Sends a request to initialize a specific shot. */
export function initShot(sceneDirectory, shotIdentifier) {
  const sceneDirDecoded = decodeURIComponent(sceneDirectory);
  const shotIdDecoded = decodeURIComponent(shotIdentifier);
  logToConsole(`Requesting shot init: Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'`, 'info');
  document.getElementById("status").innerText = `Initializing Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'...`;

  // Reset for new shot
  currentShotData = null; // Will store { scene: ..., shot: ... }
  activeCanvasRecorders = {};
  recordedCanvasBlobs = {};
  currentShotDurationSec = 0;

  const apiUrl = `/initShot/${sceneDirectory}/${shotIdentifier}`;

  fetch(apiUrl)
    .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
    .then(info => {
      document.getElementById("status").innerText = info.message;
      logToConsole(`Shot init request sent for Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}'.`, 'success');
      if (info.sceneData && info.sceneData.scene && info.sceneData.shot) {
        currentShotData = info.sceneData; // Store the whole sceneData object
        logToConsole(`Stored currentShotData for Scene: '${currentShotData.scene.directory}', Shot: '${currentShotData.shot.name || shotIdDecoded}'. Cameras: ${currentShotData.shot.cameras ? currentShotData.shot.cameras.length : 0}`, 'info', currentShotData);
        const sceneDisplayName = currentShotData.scene.description || currentShotData.scene.directory || sceneDirDecoded;
        updateAssemblyUI(currentShotData, sceneDisplayName); // Pass the whole currentShotData
      } else {
        updateAssemblyUI(null, sceneDirDecoded);
        logToConsole('No complete sceneData (with scene and shot) in initShot response to store.', 'warn');
        currentShotData = null; // Ensure it's null if data is incomplete
      }
    })
    .catch(err => {
      console.error("Init Shot Error:", err);
      document.getElementById("status").innerText = "Error initializing shot: " + err;
      logToConsole(`Error initializing Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}': ${err}`, 'error');
      currentShotData = null; // Clear on error
    });
}

/**
 * Sets the current shot details including duration and take number from WebSocket SHOT_START.
 * @param {object} shotDetails - The shot object from the WebSocket message.
 */
export function setCurrentShotDetails(shotDetails) {
  if (!shotDetails) {
    logToConsole('setCurrentShotDetails received null or undefined shotDetails.', 'warn');
    return;
  }

  if (typeof shotDetails.duration === 'number') {
    currentShotDurationSec = shotDetails.duration;
    logToConsole(`Shot duration set to: ${currentShotDurationSec} seconds.`, 'info');
  } else {
    logToConsole('setCurrentShotDetails: shotDetails.duration is not a number.', 'warn', shotDetails);
  }

  // currentShotData now holds { scene: ..., shot: ... }
  // shotDetails from WebSocket is the shot object: { name: ..., duration: ..., take: ... }
  if (currentShotData && currentShotData.shot && typeof shotDetails.take === 'number') {
    currentShotData.shot.take = shotDetails.take; // Assign take to the nested shot object
    logToConsole(`Shot take number set to: ${currentShotData.shot.take}.`, 'info');
  } else {
    if (!currentShotData || !currentShotData.shot) {
      logToConsole('setCurrentShotDetails: currentShotData or currentShotData.shot is null, cannot set take number.', 'warn');
    }
    if (typeof shotDetails.take !== 'number') {
      logToConsole('setCurrentShotDetails: shotDetails.take is not a number.', 'warn', shotDetails);
    }
  }
}

// --- NEW Function to stop all active canvas recorders ---
export function stopAllCanvasRecorders() {
  logToConsole(`Attempting to stop all active canvas recorders. Count: ${Object.keys(activeCanvasRecorders).length}`, 'info');
  let stoppedCount = 0;
  for (const cameraName in activeCanvasRecorders) {
    if (activeCanvasRecorders[cameraName] && activeCanvasRecorders[cameraName].state === 'recording') {
      try {
        activeCanvasRecorders[cameraName].stop(); // onstop handler will process blob
        stoppedCount++;
        logToConsole(`Called stop() for MediaRecorder: ${cameraName}`, 'info');
      } catch (e) {
        logToConsole(`Error calling stop() for MediaRecorder ${cameraName}: ${e.message}`, 'error', e);
        // Might need to clean up activeCanvasRecorders[cameraName] here too
        delete activeCanvasRecorders[cameraName];
      }
    } else {
      // Handle cases where recorder might be inactive or already stopped
      logToConsole(`Skipping stop for ${cameraName}, state: ${activeCanvasRecorders[cameraName]?.state}`, 'debug');
      delete activeCanvasRecorders[cameraName]; // Clean up inactive/invalid entries
    }
  }
  if (stoppedCount > 0) {
    logToConsole(`${stoppedCount} canvas recorders were instructed to stop.`, 'info');
    const statusElement = document.getElementById("status");
    if (statusElement) { // Check if status element exists
      const currentStatus = statusElement.innerText;
      // Avoid appending if already added
      if (!currentStatus.includes("Recordings complete")) {
        statusElement.innerText = currentStatus + " - Recordings complete.";
      }
    }
  }
  // activeCanvasRecorders should now be empty or contain only errored/stopped recorders which will be cleaned by onstop/onerror
}

/** Sends the Actors Ready signal to the server. */
export function actorsReady() {
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

/** Sends the Action signal to the server. */
export function action(cameraManager) {
  const recordingSourceElement = document.querySelector('input[name="recordingSource"]:checked');
  const recordingType = recordingSourceElement ? recordingSourceElement.value : 'camera'; // Default to camera if not found

  logToConsole(`Sending Action signal with recording type: ${recordingType}...`, 'info');
  document.getElementById("status").innerText = `Starting action (${recordingType} recording)...`;

  if (recordingType === 'canvas') {
    logToConsole("Canvas recording selected.", "info");
    if (!currentShotData || !currentShotData.shot || !currentShotData.shot.cameras || currentShotData.shot.cameras.length === 0) {
      logToConsole("Cannot start canvas recording: No current shot data, shot object, or no cameras in the current shot.", "error");
      document.getElementById("status").innerText = "Error: No shot data for canvas recording.";
      return;
    }

    // Add detailed logging for cameraManager state
    logToConsole("Checking cameraManager availability before starting canvas recording...");
    logToConsole(`cameraManager instance present: ${!!cameraManager}`);
    if (cameraManager) {
      logToConsole(`cameraManager.cameraCompositors present: ${!!cameraManager.cameraCompositors}`);
      if (cameraManager.cameraCompositors) {
        logToConsole(`cameraManager.cameraCompositors is Map: ${cameraManager.cameraCompositors instanceof Map}`);
        logToConsole(`cameraManager.cameraCompositors size: ${cameraManager.cameraCompositors.size}`);
        logToConsole(`cameraManager.cameraCompositors keys: ${JSON.stringify(Array.from(cameraManager.cameraCompositors.keys()))}`);
      } else {
        logToConsole('cameraManager.cameraCompositors is null or undefined.', 'warn');
      }
    } else {
      logToConsole('cameraManager instance is null or undefined.', 'warn');
    }
    // End detailed logging

    if (!cameraManager || !cameraManager.cameraCompositors || !(cameraManager.cameraCompositors instanceof Map)) {
      logToConsole("Cannot start canvas recording: cameraManager instance or cameraCompositors (Map) not available/valid.", "error");
      document.getElementById("status").innerText = "Error: Camera manager/compositors not ready.";
      return;
    }
    // Check if the map is actually empty, which might also be a problem
    if (cameraManager.cameraCompositors.size === 0) {
      logToConsole("Cannot start canvas recording: cameraManager.cameraCompositors map is empty.", "error");
      document.getElementById("status").innerText = "Error: No camera compositors available.";
      return;
    }

    logToConsole(`Attempting to record canvases for ${currentShotData.shot.cameras.length} cameras in shot '${currentShotData.shot.name}'. Compositors available: ${cameraManager.cameraCompositors.size}`, "info");
    let MimeType = 'video/webm;codecs=vp9'; // Default, good for alpha
    if (!MediaRecorder.isTypeSupported(MimeType)) {
      logToConsole(`MIME type ${MimeType} not supported, trying video/webm;codecs=vp8`, 'warn');
      MimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(MimeType)) {
        logToConsole(`MIME type ${MimeType} not supported, trying video/webm (default)`, 'warn');
        MimeType = 'video/webm';
        if (!MediaRecorder.isTypeSupported(MimeType)) {
          logToConsole('No suitable webm MIME type supported by MediaRecorder. Canvas recording may fail or have issues.', 'error');
          alert('Your browser does not support the required video recording formats (WebM VP9/VP8). Canvas recording might not work.');
        }
      }
    } else {
      logToConsole(`Using MediaRecorder MIME type: ${MimeType}`, 'info');
    }

    let recordersStarted = 0;
    currentShotData.shot.cameras.forEach(shotCamera => {
      const cameraName = shotCamera.name;
      const compositor = cameraManager.cameraCompositors.get(cameraName);

      if (!compositor || !compositor.canvas) {
        logToConsole(`Canvas for camera '${cameraName}' not found or compositor not ready. Skipping this camera.`, "warn");
        return; // Skips this iteration
      }

      const canvas = compositor.canvas;
      if (canvas.width === 0 || canvas.height === 0) {
        logToConsole(`Canvas for camera '${cameraName}' has zero dimensions. Skipping recorder.`, "warn");
        return;
      }

      logToConsole(`Starting MediaRecorder for canvas: ${cameraName}`, "info");
      recordedCanvasBlobs[cameraName] = []; // Reset for this recording

      try {
        const stream = canvas.captureStream(30); // Target 30 FPS
        const options = { mimeType: MimeType };
        if (MimeType === '') delete options.mimeType;

        const recorder = new MediaRecorder(stream, options);

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedCanvasBlobs[cameraName].push(event.data);
          }
        };

        recorder.onstop = () => {
          logToConsole(`MediaRecorder stopped for ${cameraName}. Processing ${recordedCanvasBlobs[cameraName].length} chunks.`, "info");
          const blob = new Blob(recordedCanvasBlobs[cameraName], { type: MimeType || 'video/webm' });
          recordedCanvasBlobs[cameraName] = []; // Clear chunks after creating blob

          logToConsole(`Blob created for ${cameraName}, size: ${blob.size}, type: ${blob.type}. Ready to send.`, "info");

          if (!currentShotData || !currentShotData.scene || !currentShotData.shot) {
            logToConsole('Cannot upload canvas video: currentShotData is incomplete.', 'error');
            delete activeCanvasRecorders[cameraName];
            return;
          }

          const formData = new FormData();
          const sceneDirectory = currentShotData.scene.directory;
          const shotName = currentShotData.shot.name || 'default_shot_name';
          const takeNumber = currentShotData.shot.take || 1; // Default to 1 if not set
          const filename = `${cameraName}_${shotName}_take${takeNumber}_canvas.webm`;

          formData.append('videoBlob', blob, filename);
          formData.append('sceneDirectory', sceneDirectory);
          formData.append('shotName', shotName);
          formData.append('takeNumber', takeNumber.toString());
          formData.append('cameraName', cameraName);
          formData.append('filename', filename);

          logToConsole(`Uploading canvas recording for ${cameraName} to server...`, 'info');
          fetch('/api/upload/canvas-video', {
            method: 'POST',
            body: formData, // FormData will set Content-Type to multipart/form-data automatically
          })
            .then(response => {
              if (!response.ok) {
                return response.text().then(text => {
                  throw new Error(`Server responded with ${response.status}: ${text || 'No additional error message'}`);
                });
              }
              return response.json();
            })
            .then(data => {
              logToConsole(`Canvas video for ${cameraName} uploaded successfully: ${data.message}`, 'success');
              logToConsole(`Server saved to: ${data.filePath}`, 'info'); // Assuming server sends back filePath
            })
            .catch(error => {
              logToConsole(`Error uploading canvas video for ${cameraName}: ${error.message}`, 'error', error);
              document.getElementById("status").innerText = `Error uploading ${cameraName} canvas: ${error.message}`;
            })
            .finally(() => {
              delete activeCanvasRecorders[cameraName]; // Ensure recorder is removed from active list
            });
        };

        recorder.onerror = (event) => {
          logToConsole(`MediaRecorder error for ${cameraName}: ${event.error.name}`, 'error', event.error);
          delete activeCanvasRecorders[cameraName]; // Clean up on error too
        };

        recorder.start();
        activeCanvasRecorders[cameraName] = recorder;
        recordersStarted++;
        logToConsole(`MediaRecorder started successfully for ${cameraName}.`, "success");

      } catch (e) {
        logToConsole(`Error starting MediaRecorder for ${cameraName}: ${e.message}`, "error", e);
        alert(`Could not start recording for ${cameraName}: ${e.message}`);
      }
    });

    if (recordersStarted > 0) {
      logToConsole(`${recordersStarted} canvas recorders initiated.`, 'info');

      fetch("/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingType: 'canvas' })
      })
        .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
        .then(info => {
          document.getElementById("status").innerText = info.message + ` (${recordersStarted} Canvases Recording)`;
          logToConsole(`Action signal sent (canvas mode). Server response: ${info.message}`, 'success');
        })
        .catch(err => {
          console.error("Action Error (canvas mode) during server POST:", err);
          document.getElementById("status").innerText = "Error sending Action (canvas mode): " + err;
          logToConsole(`Error sending Action (canvas mode): ${err}`, 'error');
        });
    } else {
      logToConsole("No canvas recorders were started. Aborting canvas mode action.", "warn");
      document.getElementById("status").innerText = "Failed to start canvas recorders.";
    }

  } else { // 'camera' or default
    fetch("/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingType: 'camera' })
    })
      .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
      .then(info => {
        document.getElementById("status").innerText = info.message;
        logToConsole("Action signal sent (camera mode).", 'success');
      })
      .catch(err => {
        console.error("Action Error (camera mode):", err);
        document.getElementById("status").innerText = "Error sending Action (camera mode): " + err;
        logToConsole(`Error sending Action(camera mode): ${err}`, 'error');
      });
  }
}

/** Sends a test message to the server console log. */
export function testConsole() {
  fetch("/testConsole", { method: "POST" })
    .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
    .then(info => { document.getElementById("status").innerText = info.message; })
    .catch(err => {
      console.error("Test Console Error:", err);
      document.getElementById("status").innerText = "Error testing console: " + err;
    });
}

/** Sends a WebSocket message to pause all teleprompters. */
export function pauseAllTeleprompters() {
  sendWebSocketMessage({ type: "TELEPROMPTER_CONTROL", action: "PAUSE" });
  logToConsole("Paused all teleprompters", "info");
}

/** Sends a WebSocket message to resume all teleprompters. */
export function playAllTeleprompters() {
  sendWebSocketMessage({ type: "TELEPROMPTER_CONTROL", action: "PLAY" });
  logToConsole("Resumed all teleprompters", "info");
}

/** Handles change in recording pipeline selection. */
export function handlePipelineChange(pipeline) {
  logToConsole(`Pipeline changed to: ${pipeline}`, 'info');
  fetch('/api/settings/recording-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline: pipeline })
  })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => { throw new Error(text || 'Failed to set pipeline') });
      }
      return response.json();
    })
    .then(data => {
      logToConsole(`Server setting updated: ${data.message}`, 'success');
    })
    .catch(error => {
      logToConsole(`Error updating server pipeline setting: ${error.message}`, 'error');
    });
}

/** Handles change in recording resolution selection. */
export function handleResolutionChange(resolution) {
  logToConsole(`Resolution changed to: ${resolution}`, 'info');
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