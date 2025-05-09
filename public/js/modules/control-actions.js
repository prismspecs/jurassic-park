import { logToConsole } from './logger.js';
import { sendWebSocketMessage } from './websocket-handler.js';
import { updateAssemblyUI } from './scene-assembly.js';

let currentShotData = null; // To store the current shot's data, including its cameras
export let currentDinosaurName = null; // To store the name of the dinosaur for the mask
let activeCanvasRecorders = {}; // { cameraName: MediaRecorder instance }
let recordedCanvasBlobs = {};   // { cameraName: [chunks] }
let currentShotDurationSec = 0; // To be updated by WebSocket SHOT_START event
let compositorInstance = null; // Reference to the main VideoCompositor

// --- Function to allow home.js to set the compositor instance ---
export function setMainCompositor(instance) {
  compositorInstance = instance;
  logToConsole('VideoCompositor instance set in control-actions.', 'info');
}

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

function updateDinosaurModeIndicator(shotData) {
  const indicator = document.getElementById('dinosaur-mode-indicator');
  const testMaskBtn = document.getElementById('test-dinosaur-mask-btn');
  const testMaskBtnLabel = testMaskBtn ? testMaskBtn : null; // For changing text
  currentDinosaurName = null; // Reset

  if (indicator && testMaskBtn) {
    if (shotData && shotData.type === 'dinosaur') {
      indicator.textContent = 'dinosaur mode';
      indicator.style.display = 'inline';
      testMaskBtn.style.display = 'block'; // Or 'inline-block' or as appropriate
      if (testMaskBtnLabel && compositorInstance && compositorInstance.isDinosaurMaskActive && compositorInstance.isDinosaurMaskActive()) {
        testMaskBtnLabel.textContent = 'Clear Dinosaur Mask';
        testMaskBtnLabel.classList.remove('btn-warning');
        testMaskBtnLabel.classList.add('btn-danger');
      } else if (testMaskBtnLabel) {
        testMaskBtnLabel.textContent = 'Test Dinosaur Mask';
        testMaskBtnLabel.classList.remove('btn-danger');
        testMaskBtnLabel.classList.add('btn-warning');
      }

      if (shotData.dinosaur && typeof shotData.dinosaur === 'string') {
        currentDinosaurName = shotData.dinosaur;
        logToConsole(`Dinosaur mode activated. Dinosaur asset: ${currentDinosaurName}.mp4`, 'info');
      } else {
        logToConsole('Dinosaur mode activated, but shot.dinosaur property is missing or not a string.', 'warn');
        testMaskBtn.style.display = 'none'; // Hide button if no dino name
        // Also clear mask if it was somehow active and dino name is now missing
        if (compositorInstance && compositorInstance.clearVideoMask && compositorInstance.isDinosaurMaskActive && compositorInstance.isDinosaurMaskActive()) {
          compositorInstance.clearVideoMask();
        }
      }
    } else {
      indicator.textContent = '';
      indicator.style.display = 'none';
      testMaskBtn.style.display = 'none';
      // Clear the mask if dinosaur mode is deactivated
      if (compositorInstance && compositorInstance.clearVideoMask && compositorInstance.isDinosaurMaskActive && compositorInstance.isDinosaurMaskActive()) {
        compositorInstance.clearVideoMask();
        logToConsole('Dinosaur mask cleared due to shot change / mode deactivation.', 'info');
        // Reset button text via direct DOM manipulation if needed, though it's hidden
        if (testMaskBtnLabel) {
          testMaskBtnLabel.textContent = 'Test Dinosaur Mask';
          testMaskBtnLabel.classList.remove('btn-danger');
          testMaskBtnLabel.classList.add('btn-warning');
        }
      }
      if (shotData) {
        logToConsole('Dinosaur mode deactivated (shot type is not dinosaur or no shot active).', 'info');
      }
    }
  }
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
        updateDinosaurModeIndicator(currentShotData.shot);
      } else {
        updateAssemblyUI(null, sceneDirDecoded);
        logToConsole('No complete sceneData (with scene and shot) in initShot response to store.', 'warn');
        currentShotData = null; // Ensure it's null if data is incomplete
        updateDinosaurModeIndicator(null);
      }
    })
    .catch(err => {
      console.error("Init Shot Error:", err);
      document.getElementById("status").innerText = "Error initializing shot: " + err;
      logToConsole(`Error initializing Scene '${sceneDirDecoded}', Shot '${shotIdDecoded}': ${err}`, 'error');
      currentShotData = null; // Clear on error
      updateDinosaurModeIndicator(null);
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
  if (!currentShotData || !currentShotData.scene || !currentShotData.shot) {
    const msg = "Cannot start action: No shot initialized or shot data is incomplete.";
    logToConsole(msg, 'error');
    document.getElementById("status").innerText = msg;
    return;
  }

  const sceneDirectory = encodeURIComponent(currentShotData.scene.directory);
  const shotIdentifier = encodeURIComponent(currentShotData.shot.name || `shot_${currentShotData.shotIndex + 1}`); // Use index as fallback for identifier

  logToConsole(`Sending 'Action' for Scene: '${currentShotData.scene.directory}', Shot: '${currentShotData.shot.name || shotIdentifier}'`, 'info');
  document.getElementById("status").innerText = `Starting action for Scene '${currentShotData.scene.directory}', Shot '${currentShotData.shot.name || shotIdentifier}'...`;

  let recordingType = 'camera'; // Default to server-side recording

  if (currentShotData.shot.type === 'music') {
    logToConsole('Music shot type detected. Setting recordingType to \'camera\' for server endpoint.', 'info');
    recordingType = 'camera';
  } else {
    // Not a music shot, so proceed with determining if canvas recording is needed.
    const canvasRecordEnabled = document.getElementById('canvas-record-toggle') && document.getElementById('canvas-record-toggle').checked;
    const mainOutputCanvas = document.getElementById('main-output-canvas');

    if (canvasRecordEnabled && mainOutputCanvas && mainOutputCanvas.offsetParent !== null) { // Check if canvas is visible
      logToConsole('Canvas recording is enabled and main output canvas is visible.', 'info');
      // Tentatively set to canvas, but will fallback if no recorders actually start.
      recordingType = 'canvas';
      let actualCanvasRecordersStarted = 0;

      // Check if there is a source selected for the main compositor
      if (compositorInstance && compositorInstance.currentSourceId) {
        logToConsole(`Main compositor source ID: ${compositorInstance.currentSourceId}`, 'info');
        const mainRecorder = startCanvasRecording('main-output-canvas', 'main_output');
        if (mainRecorder) {
          activeCanvasRecorders['main_output'] = mainRecorder;
          actualCanvasRecordersStarted++;
          logToConsole('Main output canvas recording initiated.', 'info');
        }
      } else {
        logToConsole('Main compositor has no source, canvas recording for main output will not start.', 'warn');
      }

      // Additionally, handle individual camera canvas recordings if CameraManager is available
      if (cameraManager && typeof cameraManager.getAllCameras === 'function') {
        const cameras = cameraManager.getAllCameras();
        cameras.forEach(camera => {
          if (camera.isRecordingToCanvas) {
            const canvasId = `processed-canvas-${camera.name}`;
            const canvasElement = document.getElementById(canvasId);
            if (canvasElement && canvasElement.offsetParent !== null) { // Check if canvas is visible
              logToConsole(`Attempting canvas recording for visible camera: ${camera.name} on canvas ${canvasId}`, 'info');
              const recorder = startCanvasRecording(canvasId, camera.name);
              if (recorder) {
                activeCanvasRecorders[camera.name] = recorder;
                actualCanvasRecordersStarted++;
              }
            } else {
              logToConsole(`Canvas for camera ${camera.name} (${canvasId}) is not visible. Skipping canvas recording.`, 'warn');
            }
          }
        });
      }

      if (actualCanvasRecordersStarted === 0) {
        logToConsole('Canvas recording was enabled, but no canvas recorders were actually started (e.g., no sources). Falling back to server-side camera recording.', 'warn');
        recordingType = 'camera'; // Fallback if no canvas recorders were started
      } else {
        logToConsole(`${actualCanvasRecordersStarted} canvas recorder(s) were initiated. recordingType is 'canvas'.`, 'info');
      }

    } else {
      logToConsole('Canvas recording is not enabled or main output canvas is not visible. Using server-side camera recording.', 'info');
      recordingType = 'camera';
    }
  }

  fetch("/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneDirectory, shotIdentifier, recordingType }), // Pass determined recordingType
  })
    .then(res => res.ok ? res.json() : res.text().then(text => Promise.reject(text || res.statusText)))
    .then(info => {
      document.getElementById("status").innerText = info.message;
      logToConsole(`'Action' initiated for Scene '${currentShotData.scene.directory}', Shot '${currentShotData.shot.name || shotIdentifier}'. Server says: ${info.message}`, 'success');
    })
    .catch(err => {
      console.error("Action Error:", err);
      document.getElementById("status").innerText = "Error starting action: " + err;
      logToConsole(`Error sending 'Action' signal: ${err}`, 'error');
    });
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