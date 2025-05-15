import { logToConsole } from './logger.js';
import { updateCurrentSessionDisplay, populateSessionList } from './session-manager.js';
import { setCurrentShotDetails, stopAllCanvasRecorders } from './control-actions.js';

let ws = null;

/**
 * Initializes the WebSocket connection and sets up event handlers.
 * @param {object} cameraManagerInstance - The instance of CameraManager.
 * @param {Function} onOpenCallback - Callback function to execute when the connection opens (for initial state fetching like voice bypass).
 * @returns {WebSocket} The WebSocket instance.
 */
export function initializeWebSocket(cameraManagerInstance, onOpenCallback) {
    const wsUrl = "ws://" + window.location.host;
    logToConsole(`Initializing WebSocket connection to ${wsUrl}...`, 'info');
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
        console.log("WebSocket connection established");
        logToConsole("WebSocket connected", "info");
        if (typeof onOpenCallback === 'function') {
            onOpenCallback(); // Call the provided callback
        }
    };

    ws.onerror = function (error) {
        console.error("WebSocket error:", error);
        logToConsole("WebSocket error: " + (error.message || "Unknown error"), "error");
    };

    ws.onclose = function () {
        console.log("WebSocket connection closed");
        logToConsole("WebSocket connection closed", "warn");
        // Optionally implement reconnection logic here
    };

    ws.onmessage = function (event) {
        try {
            const data = JSON.parse(event.data);
            console.log('Message from server:', data);

            // --- Teleprompter Forwarding --- 
            const teleprompterFrame = document.getElementById('teleprompter-frame');
            const characterTeleprompterWindows = {}; // TODO: Implement proper window reference management if needed

            const teleprompterMessageTypes = [
                'TELEPROMPTER',
                'ACTOR_CALLS',
                'CLEAR_TELEPROMPTER',
                'PLAY_VIDEO',
                'INITIATE_ACTOR_SHUFFLE'
            ];
            const characterTeleprompterMessageTypes = [
                'SHOT_START',
                'TELEPROMPTER_CONTROL',
                'SCENE_ENDED',
                'SYSTEM_RESET',
                'TELEPROMPTER_STATUS'
            ];

            if (teleprompterFrame && teleprompterFrame.contentWindow && teleprompterMessageTypes.includes(data.type)) {
                teleprompterFrame.contentWindow.postMessage(data, '*');
            } else if (characterTeleprompterMessageTypes.includes(data.type)) {
                console.log('Received character teleprompter message, but forwarding logic needs implementation:', data);
                // if (data.character && characterTeleprompterWindows[data.character]) { ... }
            }

            // --- Main Application Logic --- 
            switch (data.type) {
                case 'CONSOLE':
                    logToConsole(data.message, data.level);
                    break;
                case 'SESSION_UPDATE':
                    console.log('SESSION_UPDATE received with sessionId:', data.sessionId);
                    updateCurrentSessionDisplay(data.sessionId); // Use imported function
                    break;
                case 'SESSION_LIST_UPDATE':
                    console.log('SESSION_LIST_UPDATE received', data.sessions);
                    populateSessionList(data.sessions || []); // Use imported function
                    break;
                case 'ACTORS_CALLED':
                    // TODO: Decouple DOM manipulation - use callbacks or events?
                    document.getElementById("actorsReadyBtn").style.display = "inline-block";
                    document.getElementById("actionBtn").style.display = "none";
                    document.getElementById("status").innerText = "Waiting for actors to be ready...";
                    break;
                case 'ACTORS_READY':
                    // TODO: Decouple DOM manipulation - use callbacks or events?
                    document.getElementById("actorsReadyBtn").style.display = "none";
                    document.getElementById("actionBtn").style.display = "inline-block";
                    document.getElementById("status").innerText = "Actors are ready to perform!";
                    break;
                case 'SHOT_CAMERA_DESCRIPTIONS': // Merged from separate listener
                    console.log('Received shot camera descriptions:', data.descriptions);
                    document.querySelectorAll('.shot-camera-description').forEach(el => el.remove());

                    data.descriptions.forEach(camInfo => {
                        if (cameraManagerInstance && cameraManagerInstance.cameraElements) {
                            const cameraElement = cameraManagerInstance.cameraElements.get(camInfo.name);
                            if (cameraElement) {
                                const headerElement = cameraElement.querySelector('.camera-header');
                                if (headerElement) {
                                    const descElement = document.createElement('p');
                                    descElement.className = 'shot-camera-description';
                                    descElement.textContent = `Shot Role: ${camInfo.description}`;
                                    headerElement.parentNode.insertBefore(descElement, headerElement.nextSibling);
                                }
                            } else {
                                logToConsole(`Warning: Camera element not found for ${camInfo.name} during SHOT_CAMERA_DESCRIPTIONS update.`, 'warn');
                            }
                        } else {
                            console.warn('CameraManager instance or elements not available when SHOT_CAMERA_DESCRIPTIONS received.');
                            logToConsole('Warning: CameraManager not ready for SHOT_CAMERA_DESCRIPTIONS update.', 'warn');
                        }
                    });
                    break;
                case 'SHOT_START':
                    logToConsole('SHOT_START event received from server.', 'info', data);
                    if (data.shot) {
                        setCurrentShotDetails(data.shot);
                    } else {
                        logToConsole('SHOT_START did not contain shot data.', 'warn', data);
                    }
                    break;
                case 'STOP_CANVAS_RECORDING': // New case for stopping canvas recorders
                    logToConsole('STOP_CANVAS_RECORDING event received from server.', 'info');
                    stopAllCanvasRecorders(); // Call the function to stop recorders
                    break;
                // Add other message types handled by the server if needed
                default:
                    // Avoid logging WELCOME message noise
                    if (data.type !== 'WELCOME') {
                        console.log("Received unhandled message type:", data.type);
                    }
            }
        } catch (error) {
            console.error('Error parsing WebSocket message or handling update:', error);
            logToConsole('Received non-JSON message or error handling update.', 'error');
        }
    };

    return ws;
}

/**
 * Sends a message via the WebSocket connection.
 * @param {object} message - The message object to send.
 */
export function sendWebSocketMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        logToConsole('WebSocket is not open. Cannot send message.', 'warn');
        console.error('WebSocket is not open. State:', ws?.readyState);
    }
} 