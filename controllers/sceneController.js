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

async function action() {
    broadcastConsole('Action function started.');
    if (!currentScene || currentShotIdentifier === null) {
        broadcastConsole('Action aborted: No scene/shot active.', 'error');
        return;
    }

    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene || !scene.shots || currentSceneTakeIndex < 0 || !scene.shots[currentSceneTakeIndex]) {
        broadcastConsole(`Action aborted: Scene/Shot data not found for ${currentScene} / ${currentShotIdentifier}`, 'error');
        return;
    }
    const shot = scene.shots[currentSceneTakeIndex];

    broadcastConsole('Initiating recording for shot cameras...');

    let sessionDir;
    try {
        sessionDir = sessionService.getSessionDirectory();
    } catch (sessionError) {
        console.error("Action failed: Could not get session directory:", sessionError);
        broadcastConsole(`Action failed: Could not get session directory: ${sessionError.message}`, 'error');
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

    const activeWorkers = [];

    try {
        // --- Start Recording Worker for EACH camera in the shot --- 
        if (!shot.cameras || shot.cameras.length === 0) {
            broadcastConsole(`Action warning: No cameras defined for shot '${currentShotIdentifier}' in scene '${currentScene}'. Cannot record.`, 'warn');
        } else {
            for (const shotCameraInfo of shot.cameras) {
                const recordingCameraName = shotCameraInfo.name;
                broadcastConsole(`Setting up recording for camera: ${recordingCameraName}`);

                const camera = cameraControl.getCamera(recordingCameraName);
                if (!camera) {
                    const errorMsg = `Skipping recording: Camera '${recordingCameraName}' (required by shot) is not currently managed.`;
                    broadcastConsole(errorMsg, 'error');
                    continue;
                }

                const recordingDevicePath = camera.getRecordingDevice();
                if (!recordingDevicePath && recordingDevicePath !== 0) {
                    const errorMsg = `Skipping recording: No recording device configured for camera '${recordingCameraName}'.`;
                    broadcastConsole(errorMsg, 'error');
                    continue;
                }

                // FIXME: resolution should ideally come from shotCameraInfo or global config
                const resolution = { width: 1920, height: 1080 }; // Still hardcoded

                // Ensure Camera-Specific Subdirectory Exists
                const cameraSubDir = path.join(sessionDir, recordingCameraName);
                try {
                    if (!fs.existsSync(cameraSubDir)) {
                        fs.mkdirSync(cameraSubDir, { recursive: true });
                        console.log(`[Action] Created camera subdirectory: ${cameraSubDir}`);
                    }
                } catch (mkdirError) {
                    console.error(`[Action] Error creating camera subdirectory ${cameraSubDir}:`, mkdirError);
                    broadcastConsole(`[Action] Error creating subdirectory for ${recordingCameraName}: ${mkdirError.message}`, 'error');
                    continue;
                }

                const workerData = {
                    cameraName: recordingCameraName,
                    useFfmpeg: useFfmpeg, // Use value from settingsService
                    resolution: resolution,
                    devicePath: recordingDevicePath,
                    sessionDirectory: sessionDir,
                    durationSec: shotDurationSec
                };

                console.log(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName}...`);
                broadcastConsole(`[Action] Starting worker for ${recordingCameraName} using ${pipelineName}...`, 'info');
                const worker = new Worker(path.resolve(__dirname, '../workers/recordingWorker.js'), { workerData });

                worker.on('message', (message) => {
                    console.log(`[Action Worker ${message.camera}] Message:`, message);
                    broadcastConsole(`[Worker ${message.camera}] ${message.status}: ${message.message || ''}`, message.status === 'error' ? 'error' : 'info');
                    // Look for 'capture_complete' now
                    if (message.status === 'capture_complete') {
                        broadcastConsole(`✅ [Worker ${message.camera}] Video capture complete! Output: ${message.resultPath}`, 'success');
                        // Post-processing is no longer done by worker
                    }
                });
                worker.on('error', (error) => {
                    console.error(`[Action Worker ${recordingCameraName}] Error:`, error);
                    broadcastConsole(`[Worker ${recordingCameraName}] Fatal error: ${error.message}`, 'error');
                });
                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`[Action Worker ${recordingCameraName}] Exited with code ${code}`);
                        broadcastConsole(`[Worker ${recordingCameraName}] Worker stopped unexpectedly (code ${code})`, 'error');
                    }
                    // Remove worker from active list or mark as complete
                    const index = activeWorkers.indexOf(worker);
                    if (index > -1) activeWorkers.splice(index, 1);
                    console.log(`[Action Worker ${recordingCameraName}] Exited after capture. Remaining workers: ${activeWorkers.length}`);
                    // Check if all workers are done if needed later
                });

                activeWorkers.push(worker);
                broadcastConsole(`[Action] Worker started for ${recordingCameraName}. Total active workers: ${activeWorkers.length}`);
            } // End loop
        } // End else

        // --- Proceed with the rest of the action IMMEDIATELY --- 
        // Don't wait for workers here

        broadcastConsole('Brief pause for recording(s) to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Short pause remains
        broadcastConsole('Proceeding with shot actions...');

        // --- Perform camera movements for this shot --- 
        // TODO: Implement camera movement logic - needs careful coordination if multiple cameras move
        broadcastConsole('Camera movement logic needs implementation.', 'warn');
        // --------------------------------------------

        // aiSpeak the action
        aiVoice.speak("action!");

        // Wait for the shot duration + a buffer
        // This wait is for the *performance* duration, not the recording process
        const waitDuration = shotDurationSec * 1000 + 2000; // Add 2s buffer
        broadcastConsole(`Waiting ${waitDuration / 1000} seconds for shot performance duration...`);
        await new Promise(resolve => setTimeout(resolve, waitDuration));
        broadcastConsole('Shot performance time elapsed.');

        // --- IMPORTANT: Post-processing is now handled *within* the worker --- 
        // The code previously here (extractFrames, processFrames, encodeVideo) is GONE.
        // The main 'action' function is now only responsible for *starting* the workers
        // and managing the live performance timing.

        broadcastConsole(`Shot '${currentShotIdentifier}' performance concluded. Recording/processing continues in background workers.`);

        // Broadcast SHOT_ENDED - maybe rename to SHOT_PERFORMANCE_ENDED?
        // The actual video files aren't ready yet.
        broadcast({ type: 'SHOT_PERFORMANCE_ENDED', scene: scene, shot: shot, shotIndex: currentSceneTakeIndex });

        // TODO: Logic for advancing. Should we wait for workers to finish before advancing?
        // For now, we advance immediately after performance time.
        // If we need to wait, we'd need to track worker completion (e.g., using Promise.all on worker exit promises)

    } catch (err) {
        // This catches errors during the setup phase (finding cameras, starting workers)
        broadcastConsole(`Error during action setup: ${err.message}`, 'error');
        console.error("Action Setup Error:", err);
        // Ensure any started workers are terminated?
        activeWorkers.forEach(worker => worker.terminate());
    }
    broadcastConsole('Action function finished dispatching tasks.');
}

module.exports = {
    initScene,
    initShot,
    actorsReady,
    action,
    getCurrentScene
}; 