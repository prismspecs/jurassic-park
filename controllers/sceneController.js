const config = require('../config.json');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast, broadcastConsole, broadcastTeleprompterStatus } = require('../websocket/broadcaster');
const sessionService = require('../services/sessionService');
const settingsService = require('../services/settingsService');
const callsheetService = require('../services/callsheetService');
const CameraControl = require('../services/cameraControl');
const cameraControl = CameraControl.getInstance();
const path = require('path');
const QRCode = require('qrcode');
const { Worker } = require('worker_threads');
const { mapPanDegreesToValue, mapTiltDegreesToValue } = require('../utils/ptzMapper'); // Import mapping functions
const AudioRecorder = require('../services/audioRecorder');
const audioRecorder = AudioRecorder.getInstance();

// Encapsulated stage state
const currentStageState = {
    scene: null,
    shotIdentifier: null,
    shotIndex: 0
};

/** Get the current scene - Minimal usage, consider removing if not used externally */
function getCurrentScene() {
    console.log('getCurrentScene called, currentScene:', currentStageState.scene);
    return currentStageState.scene;
}

async function initShot(sceneDirectory, shotIdentifier) {
    broadcastConsole(`Attempting to initialize Scene: '${sceneDirectory}', Shot: '${shotIdentifier}'`, 'info');

    // Reset PTZ cameras to home position before starting the shot
    try {
        await cameraControl.resetPTZHome();
    } catch (error) {
        broadcastConsole(`Error resetting PTZ cameras before shot: ${error.message}`, 'error');
        // Consider if this error should prevent the shot from starting
        // throw new Error(`Failed to reset PTZ cameras: ${error.message}`); // Option to halt
    }

    currentStageState.scene = sceneDirectory;
    currentStageState.shotIdentifier = shotIdentifier;
    currentStageState.shotIndex = -1; // Reset/Indicate invalid index until found

    const scene = scenes.find(s => s.directory === sceneDirectory);
    if (!scene) {
        broadcastConsole(`Error: Scene not found for directory: ${sceneDirectory}`, 'error');
        throw new Error(`Scene not found: ${sceneDirectory}`);
    }

    if (!scene.shots || scene.shots.length === 0) {
        broadcastConsole(`Error: Scene '${sceneDirectory}' has no shots defined.`, 'error');
        throw new Error(`Scene '${sceneDirectory}' has no shots.`);
    }

    // Find the shot by name or index
    const shotIndex = scene.shots.findIndex((shot, index) => {
        const identifier = shot.name || `shot_${index + 1}`;
        return identifier === shotIdentifier;
    });

    if (shotIndex === -1) {
        broadcastConsole(`Error: Shot '${shotIdentifier}' not found in scene '${sceneDirectory}'.`, 'error');
        throw new Error(`Shot '${shotIdentifier}' not found in scene '${sceneDirectory}'.`);
    }

    currentStageState.shotIndex = shotIndex; // Update the index
    const shotData = scene.shots[shotIndex];

    broadcastConsole(`Successfully initialized Scene: '${sceneDirectory}', Shot: '${shotIdentifier}' (Index: ${shotIndex})`, 'success');
    broadcastConsole(`Shot description: ${shotData.description || 'N/A'}`, 'info');

    // --- Perform camera description logging and collect descriptions for UI ---
    const shotCameraDescriptions = []; // Array to hold {name, description} for UI update
    if (shotData.cameras && Array.isArray(shotData.cameras)) {
        broadcastConsole(`--- Checking Shot Camera Definitions ---`, 'info');
        const managedCameras = cameraControl.getCameras();
        const managedCameraNames = managedCameras.map(c => c.name);
        broadcastConsole(`Managed cameras in cameraControl: [${managedCameraNames.join(', ') || 'None'}]`, 'info');

        shotData.cameras.forEach(shotCamera => {
            const cameraName = shotCamera.name;
            const cameraDescription = shotCamera.description || 'No description';
            broadcastConsole(`Checking shot camera: '${cameraName}'...`, 'info');
            const managedCamera = cameraControl.getCamera(cameraName);
            broadcastConsole(`Result of cameraControl.getCamera('${cameraName}'): ${managedCamera ? 'FOUND' : 'NOT FOUND'}`, 'info');
            if (managedCamera) {
                broadcastConsole(`-> MATCH FOUND: Logging description for '${cameraName}': ${cameraDescription}`, 'success');
                // Add to list for UI update
                shotCameraDescriptions.push({ name: cameraName, description: cameraDescription }); 
            } else {
                broadcastConsole(`-> NO MATCH: Camera '${cameraName}' (from shot file) is not currently managed. Description: ${cameraDescription}`, 'warn');
            }
        });
         broadcastConsole(`--- Finished Checking Shot Camera Definitions ---`, 'info');
    } else {
        broadcastConsole(`No 'cameras' array found in shot data for '${shotIdentifier}'.`, 'warn');
    }
    // Broadcast the collected descriptions
    if (shotCameraDescriptions.length > 0) {
        broadcast({ type: 'SHOT_CAMERA_DESCRIPTIONS', descriptions: shotCameraDescriptions });
    }
    // --- End camera description logic ---

    // Broadcast SHOT_INIT message (or reuse SCENE_INIT?)
    broadcast({ type: 'SHOT_INIT', scene: scene, shot: shotData, shotIndex: shotIndex }); 

    // TODO: Add any other logic needed when a shot starts, e.g.:
    // - Resetting actor readiness?
    // - Pre-loading character teleprompter videos?
    // - Speaking shot setup description?
    aiVoice.speak(`Please prepare for scene ${scene.description}, shot ${shotIndex + 1}: ${shotData.description || shotIdentifier}`);

    // Call actors for this specific shot?
    // We need to decide if actors are called per-scene or per-shot.
    // Assuming per-shot for now based on the refactor goal.
    setTimeout(() => {
        callActorsForShot(scene, shotIndex);
    }, config.waitTime / 2); // Maybe shorter wait time?

    return { scene: sceneDirectory, shot: shotIdentifier, shotIndex: shotIndex }; // Return status
}

async function callActorsForShot(scene, shotIndex) {
    if (!scene || !scene.shots || !scene.shots[shotIndex]) {
        broadcastConsole(`Cannot call actors: Invalid scene or shot index ${shotIndex}`, 'error');
        return;
    }
    const shot = scene.shots[shotIndex];
    broadcastConsole(`Calling actors for scene '${scene.description}', shot '${shot.name || shotIndex + 1}'`);

    // Get the characters object from the current shot
    const characters = shot.characters;
    if (!characters) {
         broadcastConsole(`No 'characters' defined for shot ${shotIndex} in scene '${scene.directory}'. Cannot call actors.`, 'warn');
         // Potentially broadcast ACTORS_CALLED anyway to allow proceeding?
         broadcast({ type: 'ACTORS_CALLED', scene: scene, shot: shot }); // Still send signal?
         return;
    }

    // Get the character names from the characters object
    const characterNames = Object.keys(characters);

    // find how many actors are needed for the scene
    const actorsNeeded = characterNames.length;

    broadcastConsole(`Actors needed: ${actorsNeeded} for characters: ${characterNames.join(', ')}`);

    // Get actors from callsheet service
    const actorsToCall = callsheetService.getActorsForScene(actorsNeeded);

    // Use appUrl from config for the base URL
    const baseUrl = config.appUrl || `http://localhost:${config.port || 3000}`; // Fallback just in case

    const actorCallData = []; // Array to hold data for the consolidated message

    // Call the actors (generate data, but don't broadcast individually)
    for (let index = 0; index < actorsToCall.length; index++) {
        const actor = actorsToCall[index];
        const characterName = characterNames[index];
        const characterData = characters[characterName]; // Get data for this character from the shot
        const propName = characterData ? characterData.prop : null; // Get the prop name

        // Construct teleprompter URL
        const characterUrl = `${baseUrl}/teleprompter/${encodeURIComponent(characterName)}`;
        const headshotUrl = `/database/actors/${encodeURIComponent(actor.id)}/headshot.jpg`;
        
        // Construct prop image URL (assuming .png extension, adjust if needed)
        const propImageUrl = propName ? `/database/props/${encodeURIComponent(propName)}.png` : null; 

        try {
            // Generate QR code as a Data URL
            const qrCodeDataUrl = await QRCode.toDataURL(characterUrl);

            // Add actor data to the array, including the prop image URL
            actorCallData.push({
                name: actor.name,
                id: actor.id, // Keep id if needed elsewhere, maybe for debugging
                character: characterName,
                headshotImage: headshotUrl,
                qrCodeImage: qrCodeDataUrl,
                propImage: propImageUrl // Add prop image URL
            });

            // Speak the call (keep this individual)
            aiVoice.speak(`Calling actor: ${actor.name} to play ${characterName}`);
            callsheetService.updateActorSceneCount(actor.name); // Update count here

        } catch (err) {
            broadcastConsole(`Error generating QR code or preparing message for ${characterName}: ${err}`, 'error');
            actorCallData.push({ // Add placeholder or error info
                name: actor.name,
                character: characterName,
                propImage: propImageUrl, // Include prop image even on QR error
                error: `Failed to generate QR code`
            });
        }
    }

    // Broadcast the consolidated actor call data
    if (actorCallData.length > 0) {
        broadcast({
            type: 'ACTOR_CALLS',
            actors: actorCallData,
            scene: scene.directory, // Include context
            shot: shot.name || `shot_${shotIndex+1}`
        });
        broadcastConsole(`Broadcasted ACTOR_CALLS for ${actorCallData.length} actor(s)`);
    }

    // Broadcast that actors are being called (Original ACTORS_CALLED - keep for other UI logic?)
    // Now maybe include shot info?
    broadcast({
        type: 'ACTORS_CALLED',
        scene: scene,
        shot: shot
    });
}
// --- END REFACTOR ---

function actorsReady() {
    if (!currentStageState.scene || currentStageState.shotIdentifier === null) {
        broadcastConsole('No scene/shot is currently active', 'error');
        return;
    }

    // use currentScene to get the setup
    const scene = scenes.find(s => s.directory === currentStageState.scene);
    if (!scene || !scene.shots || currentStageState.shotIndex < 0 || !scene.shots[currentStageState.shotIndex]) {
        broadcastConsole(`Scene/Shot data not found for ${currentStageState.scene} / ${currentStageState.shotIdentifier}`, 'error');
        return;
    }

    // Get the setup from the current shot
    const shot = scene.shots[currentStageState.shotIndex];
    const setup = shot.setup;
    if (!setup) {
        broadcastConsole(`No setup found for scene '${currentStageState.scene}', shot '${currentStageState.shotIdentifier}'`, 'warn');
        // Speak anyway?
        aiVoice.speak('Actors are ready.');
    } else {
        // aiSpeak the setup
        aiVoice.speak(setup);
    }

    broadcastConsole('Actors are ready to perform');
    broadcast({
        type: 'ACTORS_READY',
        scene: scene,
        shot: shot // Include shot data
    });
}

async function action(req, res) {
    broadcastConsole('Action function started.');
    if (!currentStageState.scene || currentStageState.shotIdentifier === null || currentStageState.shotIndex < 0) {
        const errorMsg = `Action aborted: No scene/shot active or index invalid. Scene: ${currentStageState.scene}, ShotIdentifier: ${currentStageState.shotIdentifier}, Index: ${currentStageState.shotIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
        // Optionally send response if called via HTTP
        if (res) return res.status(400).json({ success: false, message: errorMsg });
        return;
    }

    const scene = scenes.find(s => s.directory === currentStageState.scene);
    // Check if shot index is valid *before* accessing it
    if (!scene || !scene.shots || currentStageState.shotIndex >= scene.shots.length) {
        const errorMsg = `Action aborted: Scene/Shot data not found or index out of bounds for ${currentStageState.scene} / Shot Index: ${currentStageState.shotIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
         if (res) return res.status(404).json({ success: false, message: errorMsg });
        return;
    }
    const shot = scene.shots[currentStageState.shotIndex]; // Safe to access now

    // Ensure shot has a name or number for logging/reference
    const shotRef = shot.name || `Shot #${shot.number || currentStageState.shotIndex}`;

    broadcastConsole(`Initiating ACTION for Scene: '${currentStageState.scene}', Shot: '${shotRef}' (Index: ${currentStageState.shotIndex})`);

    let sessionDir;
    try {
        sessionDir = sessionService.getSessionDirectory();
    } catch (sessionError) {
        const errorMsg = `Action failed: Could not get session directory: ${sessionError.message}`;
        console.error("Action failed: Could not get session directory:", sessionError);
        broadcastConsole(errorMsg, 'error');
         if (res) return res.status(500).json({ success: false, message: errorMsg });
        return;
    }

    // Determine shot duration FIRST
    const shotDurationStr = shot.duration || '0:05'; // Default if not specified
    const durationParts = shotDurationStr.split(':').map(Number);
    const shotDurationSec = (durationParts.length === 2) ? (durationParts[0] * 60 + durationParts[1]) : (durationParts[0] || 5); // Default to 5s
    broadcastConsole(`Shot duration: ${shotDurationSec} seconds`);

    // --- Get Recording Settings ---
    const useFfmpeg = settingsService.shouldUseFfmpeg();
    const pipelineName = useFfmpeg ? 'FFmpeg' : 'GStreamer';
    broadcastConsole(`Using recording pipeline from settings: ${pipelineName}`, 'info');
    const resolution = settingsService.getRecordingResolution(); // Returns {width, height}
    broadcastConsole(`Using recording resolution from settings: ${resolution.width}x${resolution.height}`, 'info');

    // Define these outside the try block so they are accessible in catch
    const activeWorkers = []; // Track active workers { worker, name, exitPromise }
    const cameraMovementTimeouts = []; // Keep track of PTZ timeouts

    try { // Add try block here
        const workerExitPromises = []; // Store promises that resolve on worker exit

        if (!shot.cameras || shot.cameras.length === 0) {
            broadcastConsole('No cameras defined for this shot. Skipping video recording.', 'info');
            // No workers to start
        } else {
            // --- Setup and Start Recording Workers ---
            broadcastConsole(`Starting recording workers for ${shot.cameras.length} camera(s)...`, 'info');
            for (const shotCameraInfo of shot.cameras) {
                const recordingCameraName = shotCameraInfo.name; // Get camera name from shot file using .name
                // Get camera instance from CameraControl service
                const camera = cameraControl.getCamera(recordingCameraName);

                if (!camera) {
                    broadcastConsole(`Camera '${recordingCameraName}' (from shot) not found in cameraControl. Skipping.`, 'warn');
                    continue; // Skip this camera if not managed
                }

                // Determine recording pipeline and device path based on camera settings from cameraControl
                // Assuming methods like getStreamingMethod, getRecordingMethod, getDevicePath, getResolution exist on the camera object
                const recordingDevicePath = camera.getRecordingDevice(); // Use the correct method name

                // Check if device path is configured
                if (recordingDevicePath === null || recordingDevicePath === undefined || recordingDevicePath === '') {
                    const errorMsg = `Skipping recording: No recording device configured for camera '${recordingCameraName}'.`;
                    broadcastConsole(errorMsg, 'error');
                    continue; // Skip this camera
                }

                // Check if global resolution is valid (already fetched earlier)
                if (!resolution || typeof resolution.width !== 'number' || typeof resolution.height !== 'number') {
                     const errorMsg = `Skipping recording: Invalid or missing global recording resolution.`;
                    broadcastConsole(errorMsg, 'error');
                    // Maybe break the loop or return error? For now, skip camera
                    continue; 
                }

                const workerData = {
                    cameraName: recordingCameraName,
                    useFfmpeg: useFfmpeg,
                    resolution: resolution, // Use global resolution
                    devicePath: recordingDevicePath,
                    sessionDirectory: sessionDir, // Pass the absolute session directory
                    durationSec: shotDurationSec
                };

                console.log(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName} at ${resolution.width}x${resolution.height}...`); // Use global resolution
                broadcastConsole(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName} at ${resolution.width}x${resolution.height}...`, 'info'); // Use global resolution
                const worker = new Worker(path.resolve(__dirname, '../workers/recordingWorker.js'), { workerData });

                // Create a promise that resolves when this worker exits
                const exitPromise = new Promise((resolve) => {
                    worker.on('message', (message) => {
                        // Handle messages from worker (e.g., progress, completion, errors)
                         console.log(`[Worker ${recordingCameraName} MSG]:`, message);
                         // Broadcast relevant status updates
                         if(message.status === 'error') {
                            broadcastConsole(`[Worker ${recordingCameraName} ERROR]: ${message.message}`, 'error');
                         } else if (message.status === 'capture_complete') {
                             broadcastConsole(`[Worker ${recordingCameraName}]: Capture complete. Result: ${message.resultPath}`, 'success');
                         } else if (message.status) {
                             broadcastConsole(`[Worker ${recordingCameraName}]: ${message.status} - ${message.message || ''}`, 'info');
                         }
                    });
                    worker.on('error', (error) => {
                        console.error(`[Worker ${recordingCameraName} Error]:`, error);
                        broadcastConsole(`[Worker ${recordingCameraName} FATAL ERROR]: ${error.message}`, 'error');
                         // Remove worker from active list? Handle cleanup?
                         // Resolve the promise even on error to avoid deadlocks
                         resolve({ name: recordingCameraName, status: 'error', error });
                    });
                    worker.on('exit', (code) => {
                        if (code !== 0) {
                            console.error(`[Worker ${recordingCameraName}] exited with code ${code}`);
                            broadcastConsole(`[Worker ${recordingCameraName}] exited unexpectedly with code ${code}`, 'error');
                        } else {
                             console.log(`[Worker ${recordingCameraName}] exited successfully.`);
                             broadcastConsole(`[Worker ${recordingCameraName}] finished processing.`, 'info');
                        }
                        // Remove worker from active list (optional, as we wait for promises now)
                        const index = activeWorkers.findIndex(w => w.worker === worker);
                        if (index > -1) activeWorkers.splice(index, 1);
                        // Resolve the promise on exit
                        resolve({ name: recordingCameraName, status: 'exited', code });
                    });
                });

                workerExitPromises.push(exitPromise); // Add the promise to our list
                activeWorkers.push({ worker, name: recordingCameraName }); // Keep track if needed elsewhere

                // --- Schedule PTZ Movements for this camera ---
                if (shotCameraInfo.movements && shotCameraInfo.movements.length > 0) {
                    broadcastConsole(`Scheduling ${shotCameraInfo.movements.length} PTZ movements for ${recordingCameraName}...`, 'info');
                    shotCameraInfo.movements.forEach(move => {
                        if (typeof move.time !== 'number' || move.time < 0) {
                            broadcastConsole(`Invalid time (${move.time}) for movement in ${recordingCameraName}. Skipping.`, 'warn');
                            return; // Skip invalid time
                        }

                        const delayMs = move.time * 1000;

                        const timeoutId = setTimeout(async () => { // Make async for await inside
                            try {
                                const ptzPayload = {};
                                let logMsg = `Executing PTZ for ${recordingCameraName} at ${move.time}s:`;

                                if (typeof move.pan === 'number') {
                                    // Use imported mapping function
                                    ptzPayload.pan = mapPanDegreesToValue(move.pan);
                                    logMsg += ` Pan=${move.pan}°(${ptzPayload.pan})`;
                                }
                                if (typeof move.tilt === 'number') {
                                     // Use imported mapping function
                                    ptzPayload.tilt = mapTiltDegreesToValue(move.tilt);
                                    logMsg += ` Tilt=${move.tilt}°(${ptzPayload.tilt})`;
                                }
                                // Zoom is 0-100, passed directly
                                if (typeof move.zoom === 'number' && move.zoom >= 0 && move.zoom <= 100) {
                                    ptzPayload.zoom = move.zoom;
                                    logMsg += ` Zoom=${move.zoom}%`;
                                } else if (move.zoom !== undefined) {
                                     broadcastConsole(`Invalid zoom value (${move.zoom}) for ${recordingCameraName} at ${move.time}s. Must be 0-100. Ignoring zoom.`, 'warn');
                                }

                                if (Object.keys(ptzPayload).length > 0) {
                                    broadcastConsole(logMsg, 'info');
                                    await cameraControl.setPTZ(recordingCameraName, ptzPayload);
                                } else {
                                     broadcastConsole(`No valid PTZ values found for ${recordingCameraName} at ${move.time}s.`, 'warn');
                                }

                            } catch (ptzError) {
                                console.error(`Error executing PTZ for ${recordingCameraName} at time ${move.time}:`, ptzError);
                                broadcastConsole(`Error executing PTZ for ${recordingCameraName}: ${ptzError.message}`, 'error');
                            }
                        }, delayMs);
                        cameraMovementTimeouts.push(timeoutId); // Store timeout ID here
                    });
                } else {
                     broadcastConsole(`No PTZ movements defined for ${recordingCameraName} in this shot.`, 'info');
                }
                // --- END Scheduling PTZ Movements ---

            } // End for loop cameras
        } // End else (has cameras)

        // --- Start Audio Recording (AFTER starting video workers) ---
        broadcastConsole('Starting audio recording...', 'info');
        audioRecorder.startRecording(sessionDir, shotDurationSec); // Pass duration

        // --- Proceed with the rest of the action ---
        // broadcastConsole('Brief pause for recording(s) to initialize...'); // Maybe remove or shorten this pause?
        // await new Promise(resolve => setTimeout(resolve, 100)); // Shortened pause

        broadcastConsole('Proceeding with shot actions...');

        // --- Camera movement logic is now handled by scheduled setTimeouts above --- 

        // Speak action cue
        aiVoice.speak("Action!"); // TODO: Make this configurable or optional?

        // --- BROADCAST SHOT_START ---
        try {
            broadcast({ // Broadcast SHOT_START with scene and shot info
                type: 'SHOT_START',
                scene: { directory: currentStageState.scene }, // Send scene directory
                // shot: shot // Send full shot data - might be large, maybe send just identifier?
                shot: { name: shot.name, number: shot.number, duration: shotDurationSec } // Send essential info
            });
            broadcastConsole(`Broadcasted SHOT_START for Scene: ${currentStageState.scene}, Shot: ${shotRef}`, 'success');
        } catch (broadcastError) {
            broadcastConsole(`!!! ERROR Broadcasting SHOT_START: ${broadcastError.message}`, 'error');
            console.error("!!! ERROR Broadcasting SHOT_START:", broadcastError); // Log full error server-side
        }
        // --- END BROADCAST ---

        // --- Wait for the shot duration + a buffer ---
        // This wait is primarily for the *performance* timing, not necessarily for worker completion.
        const waitDurationMs = shotDurationSec * 1000 + 2000; // Add 2s buffer
        broadcastConsole(`Waiting ${waitDurationMs / 1000} seconds for shot performance duration...`);

        // We also need to potentially stop the PTZ commands if the action is cancelled early
        // or ensure they don't run past the intended shot duration if something goes wrong.
        // For now, we let them run. Consider adding cleanup logic if needed.

        await new Promise(resolve => setTimeout(resolve, waitDurationMs));
        broadcastConsole('Shot performance time elapsed.');

        // --- Wait for Video Workers to Finish ---
        // Video workers should stop based on their durationSec. Wait for them to exit.
        broadcastConsole('Waiting for video worker(s) to complete processing and exit...');
        if (workerExitPromises.length > 0) {
            try {
                const results = await Promise.all(workerExitPromises);
                broadcastConsole(`All ${results.length} video worker(s) have exited.`, 'info');
                // Optional: Check results for errors
                results.forEach(result => {
                    if (result.status === 'error') {
                        broadcastConsole(`Worker ${result.name} encountered an error during exit wait: ${result.error.message}`, 'warn');
                    } else if (result.status === 'exited' && result.code !== 0) {
                        broadcastConsole(`Worker ${result.name} exited with non-zero code ${result.code} during exit wait.`, 'warn');
                    }
                });
            } catch (waitError) {
                // This catch is unlikely with the current individual promise setup, but good practice
                console.error("Error waiting for worker promises:", waitError);
                broadcastConsole(`Error occurred while waiting for video workers: ${waitError.message}`, 'error');
            }
        } else {
            broadcastConsole('No active video workers to wait for.', 'info');
        }
        // --- END Worker Wait ---


        // --- BROADCAST SHOT_END ---
        try {
             broadcast({
                type: 'SHOT_END',
                scene: { directory: currentStageState.scene },
                shot: { name: shot.name, number: shot.number }
            });
            broadcastConsole(`Broadcasted SHOT_END for Scene: ${currentStageState.scene}, Shot: ${shotRef}`, 'success');
        } catch (broadcastError) {
            broadcastConsole(`!!! ERROR Broadcasting SHOT_END: ${broadcastError.message}`, 'error');
            console.error("!!! ERROR Broadcasting SHOT_END:", broadcastError);
        }
        // --- END BROADCAST ---


        // --- Clean up PTZ timeouts ---
        broadcastConsole('Clearing any pending PTZ movement timeouts.', 'info');
        cameraMovementTimeouts.forEach(clearTimeout);
        cameraMovementTimeouts.length = 0; // Clear the array

        // Stop audio recording (Allowing duration to handle it, but stop explicitly as fallback?)
        // Let's REMOVE the explicit stop and rely on duration passed to startRecording
        // broadcastConsole('Stopping audio recording explicitly...', 'info'); // Keep commented out for now
        // audioRecorder.stopRecording();

        // Video workers should stop based on their durationSec.
        // Wait for all workers to signal completion (or error/exit)

        // Force stop audio recording if it might still be running
        broadcastConsole('Force stopping audio recording (on error)...', 'warn');
        audioRecorder.stopRecording(); // Use explicit stop here

        // Signal workers to terminate immediately (if possible)
        activeWorkers.forEach(({ worker, name }) => {
            broadcastConsole(`Terminating worker ${name} due to error...`, 'warn');
            try {
                worker.terminate();
            } catch (terminateError) {
                console.error(`Error terminating worker ${name}:`, terminateError);
            }
        });

        // Optionally send success response if called via HTTP
        if (res) res.json({ success: true, message: `Action sequence initiated for shot ${shotRef}. Workers started.` });


    } catch (error) { // Catch block for the main try
        console.error("Error during action execution:", error);
        broadcastConsole(`Action failed: ${error.message}`, 'error');

        // --- Emergency Stop/Cleanup on Error ---
        broadcastConsole('Attempting emergency cleanup...', 'warn');
        cameraMovementTimeouts.forEach(clearTimeout); // Clear any pending movements
        cameraMovementTimeouts.length = 0;

        // Force stop audio recording if it might still be running
        broadcastConsole('Force stopping audio recording (on error)...', 'warn');
        audioRecorder.stopRecording(); // Use explicit stop here

        // Signal workers to terminate immediately (if possible)
        broadcastConsole('Attempting to terminate active video workers (on error)...', 'warn');
        activeWorkers.forEach(({ worker, name }) => {
            try {
                broadcastConsole(`Terminating worker for ${name}...`, 'warn');
                worker.terminate().then(() => {
                    broadcastConsole(`Worker for ${name} terminated.`, 'info');
                }).catch(termErr => {
                    console.error(`Error terminating worker ${name}:`, termErr);
                    broadcastConsole(`Error terminating worker ${name}: ${termErr.message}`, 'error');
                });
            } catch (termErr) {
                 console.error(`Exception terminating worker ${name}:`, termErr);
                 broadcastConsole(`Exception terminating worker ${name}: ${termErr.message}`, 'error');
            }
        });
        activeWorkers.length = 0; // Clear the array

        // TODO: Add any other necessary cleanup steps

        if (res) return res.status(500).json({ success: false, message: `Action failed: ${error.message}` });

    } finally {
        // Code here runs whether try succeeded or failed
        // Might be useful for final state updates
        console.log("Action function finally block reached.");
    }
}

module.exports = {
    initShot,
    actorsReady,
    action,
    getCurrentScene
};