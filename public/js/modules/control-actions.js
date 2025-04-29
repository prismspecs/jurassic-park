import { logToConsole } from './logger.js';
import { sendWebSocketMessage } from './websocket-handler.js';

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
export function action() {
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