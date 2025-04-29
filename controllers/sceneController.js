const fs = require('fs');
const config = require('../config.json');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast, broadcastConsole, broadcastTeleprompterStatus } = require('../websocket/broadcaster');
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const sessionService = require('../services/sessionService');
const settingsService = require('../services/settingsService');
const callsheetService = require('../services/callsheetService');
const CameraControl = require('../services/cameraControl');
const cameraControl = CameraControl.getInstance();
const poseTracker = require('../services/poseTracker');
const path = require('path');
const QRCode = require('qrcode');
const { Worker } = require('worker_threads');
const { mapPanDegreesToValue, mapTiltDegreesToValue } = require('../utils/ptzMapper'); // Import mapping functions

// globals
let sceneTakeIndex = 0;
let currentScene = null;
let currentSceneTakeIndex = 0; // Track takes within a scene
let currentShotIdentifier = null; // NEW: Track the identifier (name or index) of the current shot

/** Get the current scene */
function getCurrentScene() {
    console.log('getCurrentScene called, currentScene:', currentScene);
    return currentScene;
}

/** Scene initialization */
async function initScene(directory) {
    console.log('initScene called with directory:', directory);
    sceneTakeIndex = 0;
    currentScene = directory;
    currentSceneTakeIndex = 0; // Reset take index when initializing a new scene
    console.log('currentScene set to:', currentScene);

    // Initialize the callsheet
    callsheetService.initCallsheet();

    const scene = scenes.find(s => s.directory === directory);
    if (!scene) {
        broadcastConsole(`Scene ${directory} not found`, 'error');
        return;
    }
    broadcastConsole(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);

    // Broadcast "Initializing scene..." to the main teleprompter
    broadcast({
        type: 'TELEPROMPTER',
        text: 'Initializing scene...'
    });
    broadcastConsole('Broadcasted TELEPROMPTER: Initializing scene...');

    aiVoice.speak(`Please prepare for scene ${scene.description}`);

    // wait 5 seconds before calling actors
    setTimeout(() => {
        callActors(scene);
    }, config.waitTime);

    // Broadcast status update to character teleprompters (keep this for character screens)
    broadcastTeleprompterStatus('Scene Initializing...');
    broadcastConsole(`Broadcasted TELEPROMPTER_STATUS: Scene Initializing...`);

    // --- ADDED: Log camera descriptions from scene data if camera exists --- 
    broadcastConsole("--- Checking Scene Camera Definitions ---", "info"); // Debug Header
    
    // Log currently managed cameras for comparison
    const managedCameras = cameraControl.getCameras(); // Get the array of camera objects
    const managedCameraNames = managedCameras.map(c => c.name); // Map to names
    broadcastConsole(`Managed cameras in cameraControl: [${managedCameraNames.join(', ') || 'None'}]`, "info");

    // Check if the FIRST take has a cameras array
    const firstTake = scene.takes && scene.takes.length > 0 ? scene.takes[0] : null;
    if (firstTake && firstTake.cameras && Array.isArray(firstTake.cameras)) {
        broadcastConsole(`Cameras found in first take for ${directory}:`);
        firstTake.cameras.forEach(sceneCamera => { // Iterate through cameras in the first take
            const cameraName = sceneCamera.name;
            const cameraDescription = sceneCamera.description || 'No description'; // Default description
            broadcastConsole(`Checking scene camera: '${cameraName}'...`, "info"); // Log which scene camera we are checking
            
            // Check if this camera exists in our camera control
            const managedCamera = cameraControl.getCamera(cameraName);
            broadcastConsole(`Result of cameraControl.getCamera('${cameraName}'): ${managedCamera ? 'FOUND' : 'NOT FOUND'}`, "info"); // Log the result of the lookup
            
            if (managedCamera) {
                // Log description from the scene file for the existing managed camera
                broadcastConsole(`-> MATCH FOUND: Logging description for '${cameraName}': ${cameraDescription}`, 'success');
            } else {
                 broadcastConsole(`-> NO MATCH: Camera '${cameraName}' (from scene file) is not currently managed. Description: ${cameraDescription}`, 'warn');
            }
        });
    } else {
        broadcastConsole(`No 'cameras' array found in the first take data for ${directory}.`, 'warn');
    }
    broadcastConsole("--- Finished Checking Scene Camera Definitions ---", "info"); // Debug Footer
    // --- END ADDED --- 

    // Broadcast the full scene object (or necessary parts) for potential use by clients
    broadcast({ type: 'SCENE_INIT', scene: scene });
    broadcastConsole(`Scene ${directory} initialized. Ready for actors.`, 'success');
}

// --- NEW: Initialize a specific shot --- 
function initShot(sceneDirectory, shotIdentifier) {
    broadcastConsole(`Attempting to initialize Scene: '${sceneDirectory}', Shot: '${shotIdentifier}'`, 'info');
    currentScene = sceneDirectory;
    currentShotIdentifier = shotIdentifier;
    currentSceneTakeIndex = -1; // Reset/Indicate invalid index until found

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

    currentSceneTakeIndex = shotIndex; // Update the index (using the old variable name for now)
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
// --- END NEW --- 

// --- REFACTOR: Modify callActors to be called per shot --- 
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
        // Construct teleprompter URL using scene dir and shot name/id?
        // For now, character name is likely enough, assuming teleprompter route handles it.
        const characterUrl = `${baseUrl}/teleprompter/${encodeURIComponent(characterName)}`; 
        const headshotUrl = `/database/actors/${encodeURIComponent(actor.id)}/headshot.jpg`;

        try {
            // Generate QR code as a Data URL
            const qrCodeDataUrl = await QRCode.toDataURL(characterUrl);

            // Add actor data to the array
            actorCallData.push({
                name: actor.name,
                id: actor.id, // Keep id if needed elsewhere, maybe for debugging
                character: characterName,
                headshotImage: headshotUrl,
                qrCodeImage: qrCodeDataUrl
            });

            // Speak the call (keep this individual)
            aiVoice.speak(`Calling actor: ${actor.name} to play ${characterName}`);
            callsheetService.updateActorSceneCount(actor.name); // Update count here

        } catch (err) {
            broadcastConsole(`Error generating QR code or preparing message for ${characterName}: ${err}`, 'error');
            actorCallData.push({ // Add placeholder or error info
                name: actor.name,
                character: characterName,
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

// Remove or refactor the old callActors function if it's no longer used
/*
async function callActors(scene) {
    // ... old logic ...
}
*/

function actorsReady() {
    if (!currentScene || currentShotIdentifier === null) {
        broadcastConsole('No scene/shot is currently active', 'error');
        return;
    }

    // use currentScene to get the setup
    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene || !scene.shots || currentSceneTakeIndex < 0 || !scene.shots[currentSceneTakeIndex]) {
        broadcastConsole(`Scene/Shot data not found for ${currentScene} / ${currentShotIdentifier}`, 'error');
        return;
    }

    // Get the setup from the current shot
    const shot = scene.shots[currentSceneTakeIndex];
    const setup = shot.setup;
    if (!setup) {
        broadcastConsole(`No setup found for scene '${currentScene}', shot '${currentShotIdentifier}'`, 'warn');
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
    if (!currentScene || currentShotIdentifier === null || currentSceneTakeIndex < 0) {
        const errorMsg = `Action aborted: No scene/shot active or index invalid. Scene: ${currentScene}, ShotIdentifier: ${currentShotIdentifier}, Index: ${currentSceneTakeIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
        // Optionally send response if called via HTTP
        if (res) return res.status(400).json({ success: false, message: errorMsg });
        return;
    }

    const scene = scenes.find(s => s.directory === currentScene);
    // Check if shot index is valid *before* accessing it
    if (!scene || !scene.shots || currentSceneTakeIndex >= scene.shots.length) {
        const errorMsg = `Action aborted: Scene/Shot data not found or index out of bounds for ${currentScene} / Shot Index: ${currentSceneTakeIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
         if (res) return res.status(404).json({ success: false, message: errorMsg });
        return;
    }
    const shot = scene.shots[currentSceneTakeIndex]; // Safe to access now

    // Ensure shot has a name or number for logging/reference
    const shotRef = shot.name || `Shot #${shot.number || currentSceneTakeIndex}`;

    broadcastConsole(`Initiating ACTION for Scene: '${currentScene}', Shot: '${shotRef}' (Index: ${currentSceneTakeIndex})`);

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

    // Determine shot duration
    const shotDurationStr = shot.duration || '0:05'; // Default if not specified
    const durationParts = shotDurationStr.split(':').map(Number);
    const shotDurationSec = (durationParts.length === 2) ? (durationParts[0] * 60 + durationParts[1]) : (durationParts[0] || 5); // Default to 5s
    broadcastConsole(`Shot duration: ${shotDurationSec} seconds`);

    // Get the currently selected recording pipeline from settings service
    const useFfmpeg = settingsService.shouldUseFfmpeg();
    const pipelineName = useFfmpeg ? 'FFmpeg' : 'GStreamer';
    broadcastConsole(`Using recording pipeline from settings: ${pipelineName}`, 'info');

    // Get the currently selected recording resolution from settings service
    const resolution = settingsService.getRecordingResolution(); // Returns {width, height}
    broadcastConsole(`Using recording resolution from settings: ${resolution.width}x${resolution.height}`, 'info');

    const activeWorkers = [];
    const cameraMovementTimeouts = []; // Keep track of timeouts

    try {
        // --- Start Recording Worker for EACH camera in the shot ---
        if (!shot.cameras || shot.cameras.length === 0) {
            broadcastConsole(`Action warning: No cameras defined for shot '${shotRef}' in scene '${currentScene}'. Cannot record.`, 'warn');
        } else {
            for (const shotCameraInfo of shot.cameras) {
                const recordingCameraName = shotCameraInfo.name;
                if (!recordingCameraName) {
                     broadcastConsole(`Action warning: Shot camera info missing 'name'. Skipping.`, 'warn');
                     continue;
                }
                broadcastConsole(`Setting up recording for camera: ${recordingCameraName}`);

                const camera = cameraControl.getCamera(recordingCameraName);
                if (!camera) {
                    const errorMsg = `Skipping recording: Camera '${recordingCameraName}' (required by shot) is not currently managed.`;
                    broadcastConsole(errorMsg, 'error');
                    continue; // Skip this camera
                }

                const recordingDevicePath = camera.getRecordingDevice();
                // Treat device ID 0 as valid (common for first device on Linux/macOS)
                if (recordingDevicePath === null || recordingDevicePath === undefined || recordingDevicePath === '') {
                    const errorMsg = `Skipping recording: No recording device configured for camera '${recordingCameraName}'.`;
                    broadcastConsole(errorMsg, 'error');
                    continue; // Skip this camera
                }

                // Ensure Camera-Specific Subdirectory Exists within Session Directory
                const cameraSubDir = path.join(sessionDir, recordingCameraName);
                try {
                    if (!fs.existsSync(cameraSubDir)) {
                        fs.mkdirSync(cameraSubDir, { recursive: true });
                        console.log(`[Action] Created camera subdirectory: ${cameraSubDir}`);
                    }
                } catch (mkdirError) {
                    const errorMsg = `[Action] Error creating subdirectory for ${recordingCameraName}: ${mkdirError.message}`;
                    console.error(`[Action] Error creating camera subdirectory ${cameraSubDir}:`, mkdirError);
                    broadcastConsole(errorMsg, 'error');
                    continue; // Skip this camera if dir creation fails
                }

                const workerData = {
                    cameraName: recordingCameraName,
                    useFfmpeg: useFfmpeg,
                    resolution: resolution, // Use resolution object from settingsService
                    devicePath: recordingDevicePath,
                    sessionDirectory: sessionDir, // Pass the absolute session directory
                    durationSec: shotDurationSec
                };

                console.log(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName} at ${resolution.width}x${resolution.height}...`);
                broadcastConsole(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName} at ${resolution.width}x${resolution.height}...`, 'info');
                const worker = new Worker(path.resolve(__dirname, '../workers/recordingWorker.js'), { workerData });

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
                });
                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`[Worker ${recordingCameraName}] exited with code ${code}`);
                        broadcastConsole(`[Worker ${recordingCameraName}] exited unexpectedly with code ${code}`, 'error');
                    } else {
                         console.log(`[Worker ${recordingCameraName}] exited successfully.`);
                         broadcastConsole(`[Worker ${recordingCameraName}] finished processing.`, 'info');
                    }
                    // Remove worker from active list
                    const index = activeWorkers.findIndex(w => w.worker === worker);
                    if (index > -1) activeWorkers.splice(index, 1);
                });

                activeWorkers.push({ worker, name: recordingCameraName });

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
                        cameraMovementTimeouts.push(timeoutId); // Store timeout ID for potential clearing
                    });
                } else {
                     broadcastConsole(`No PTZ movements defined for ${recordingCameraName} in this shot.`, 'info');
                }
                // --- END Scheduling PTZ Movements ---

            } // End for loop cameras
        } // End else (has cameras)

        // --- Proceed with the rest of the action ---
        // Don't wait for workers here, but maybe wait for PTZ scheduling? (No, setTimeout is non-blocking)

        broadcastConsole('Brief pause for recording(s) to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Short pause remains

        broadcastConsole('Proceeding with shot actions...');

        // --- Camera movement logic is now handled by scheduled setTimeouts above --- 

        // Speak action cue
        aiVoice.speak("Action!"); // TODO: Make this configurable or optional?

        // --- BROADCAST SHOT_START ---
        try {
            broadcast({ // Broadcast SHOT_START with scene and shot info
                type: 'SHOT_START',
                scene: { directory: currentScene }, // Send scene directory
                // shot: shot // Send full shot data - might be large, maybe send just identifier?
                shot: { name: shot.name, number: shot.number, duration: shotDurationSec } // Send essential info
            });
            broadcastConsole(`Broadcasted SHOT_START for Scene: ${currentScene}, Shot: ${shotRef}`, 'success');
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

        // --- BROADCAST SHOT_END ---
        try {
             broadcast({
                type: 'SHOT_END',
                scene: { directory: currentScene },
                shot: { name: shot.name, number: shot.number }
            });
            broadcastConsole(`Broadcasted SHOT_END for Scene: ${currentScene}, Shot: ${shotRef}`, 'success');
        } catch (broadcastError) {
            broadcastConsole(`!!! ERROR Broadcasting SHOT_END: ${broadcastError.message}`, 'error');
            console.error("!!! ERROR Broadcasting SHOT_END:", broadcastError);
        }
        // --- END BROADCAST ---


        // --- Clean up PTZ timeouts ---
        broadcastConsole('Clearing any pending PTZ movement timeouts.', 'info');
        cameraMovementTimeouts.forEach(clearTimeout);
        cameraMovementTimeouts.length = 0; // Clear the array


        // --- Signal Workers to Stop (if necessary) ---
        // Currently, workers stop based on durationSec passed in workerData.
        // If we needed manual stopping, we'd post a message here.
        broadcastConsole('Workers will stop based on their duration. Waiting for worker completion messages...');

        // Optional: Wait for workers to finish?
        // This might block the controller for too long.
        // The current approach lets workers finish asynchronously.

        // TODO: Implement logic for when recording *actually* finishes.
        // Workers send 'capture_complete' or 'error'. We might need to track this.

        // Optionally send success response if called via HTTP
        if (res) res.json({ success: true, message: `Action sequence initiated for shot ${shotRef}. Workers started.` });


    } catch (error) {
        // Catch synchronous errors during setup (e.g., worker creation issues)
        const errorMsg = `[Action] Top-level error during action setup for shot ${shotRef}: ${error.message}`;
        console.error(errorMsg, error); // Log full error
        broadcastConsole(errorMsg, 'error');

        // Clean up any started workers and timeouts
        activeWorkers.forEach(({ worker, name }) => {
            broadcastConsole(`Terminating worker ${name} due to error...`, 'warn');
            worker.terminate();
        });
        activeWorkers.length = 0; // Clear array
        cameraMovementTimeouts.forEach(clearTimeout);
        cameraMovementTimeouts.length = 0;

        // Optionally send error response if called via HTTP
        if (res) return res.status(500).json({ success: false, message: errorMsg });
    }
}

function getCurrentSceneState() {
    // ... existing code ...
}

module.exports = {
    initScene,
    initShot,
    actorsReady,
    action,
    getCurrentScene
}; 