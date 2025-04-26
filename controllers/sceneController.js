const fs = require('fs');
const config = require('../config.json');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast, broadcastConsole, broadcastTeleprompterStatus } = require('../websocket/broadcaster');
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const sessionService = require('../services/sessionService');
const callsheetService = require('../services/callsheetService');
const CameraControl = require('../services/cameraControl');
const cameraControl = CameraControl.getInstance();
const poseTracker = require('../services/poseTracker');
const path = require('path');
const QRCode = require('qrcode');

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

    // Define relative paths from config (these might need to be per-shot now?)
    // For now, assume they are per-session/scene
    const RAW_DIR = config.framesRawDir;
    const OVERLAY_DIR = config.framesOverlayDir;
    const OUT_ORIG = config.videoOriginal; // e.g., original.mp4
    const OUT_OVER = config.videoOverlay; // e.g., overlay.mp4

    // Modify output filenames to include shot info
    const shotNameSafe = (shot.name || `shot_${currentSceneTakeIndex + 1}`).replace(/W+/g, '_'); // Sanitize shot name
    const outOrigShot = `${shotNameSafe}_${OUT_ORIG}`;
    const outOverShot = `${shotNameSafe}_${OUT_OVER}`;

    // start recording video
    broadcastConsole('Initiating video recording sequence for shot...');

    let recordingPromise;
    try {
        // Determine which camera(s) to use based on the current shot data
        // FIXME: Assuming only ONE recording camera per shot for now, using the first one defined
        if (!shot.cameras || shot.cameras.length === 0) {
             broadcastConsole(`Action aborted: No cameras defined for shot '${currentShotIdentifier}' in scene '${currentScene}'.`, 'error');
             return;
        }
        const shotCameraInfo = shot.cameras[0]; // Use the first camera in the shot's list
        const recordingCameraName = shotCameraInfo.name;

        broadcastConsole(`Attempting to get camera: ${recordingCameraName} (defined in shot)`);
        const camera = cameraControl.getCamera(recordingCameraName);

        if (!camera) {
            const errorMsg = `Error: Recording camera '${recordingCameraName}' (required by shot) is not currently managed. Please add/configure it via the Camera Controls section.`;
            broadcastConsole(errorMsg, 'error');
            return; 
        }

        broadcastConsole(`Found camera: ${camera.name}`);
        const recordingDevicePath = camera.getRecordingDevice();
        broadcastConsole(`Retrieved recording device path for ${camera.name}: ${recordingDevicePath}`); 

        if (!recordingDevicePath) {
            const errorMsg = `Error: No recording device configured for camera '${recordingCameraName}'. Please configure it in the UI.`;
            broadcastConsole(errorMsg, 'error');
            throw new Error(errorMsg);
        }

        broadcastConsole(`Attempting to record from: ${recordingCameraName} (${recordingDevicePath})`);

        // Record video for the duration of the shot
        const shotDurationStr = shot.duration || '0:05'; // Default if not specified
        const durationParts = shotDurationStr.split(':').map(Number);
        const shotDurationSec = (durationParts.length === 2) ? (durationParts[0] * 60 + durationParts[1]) : (durationParts[0] || 5); // Default to 5s if parse fails
        broadcastConsole(`Shot duration: ${shotDurationSec} seconds`);

        // Get pipeline/resolution (How is this selected now? Per shot? Global?)
        // FIXME: Still hardcoding FFmpeg/1080p
        const useFfmpeg = true; 
        const resolution = { width: 1920, height: 1080 }; 
        const recordingHelper = useFfmpeg ? ffmpegHelper : gstreamerHelper;
        const pipelineName = useFfmpeg ? 'FFmpeg' : 'GStreamer';

        broadcastConsole(`Using pipeline: ${pipelineName}`);

        // Start recording using the shot-specific output filename
        recordingPromise = recordingHelper.captureVideo(
            outOrigShot, 
            shotDurationSec,
            recordingDevicePath,
            resolution
        );

        broadcastConsole('Waiting briefly for recording process to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        broadcastConsole('Proceeding with shot...');

        // --- Broadcast SHOT_START (already done in initShot? Maybe rename SHOT_INIT?) --
        // We might not need this specific SHOT_START if SHOT_INIT serves the purpose
        // broadcast({ type: 'SHOT_START', scene: scene, shot: shot });
        // --------------------------------------------------------------------------

        // --- Perform camera movements for this shot --- 
        // TODO: Implement camera movement logic based on shotCameraInfo.movements
        broadcastConsole('Camera movement logic needs implementation.', 'warn');
        // --------------------------------------------

        // aiSpeak the action
        aiVoice.speak("action!");

        // wait for the shot duration + a buffer
        const waitDuration = shotDurationSec * 1000 + 2000; // Add 2s buffer
        broadcastConsole(`Waiting ${waitDuration / 1000} seconds for shot completion...`);
        await new Promise(resolve => setTimeout(resolve, waitDuration));
        broadcastConsole('Shot time elapsed.');

        // Wait for the recording process to actually finish
        broadcastConsole('Ensuring recording process is complete...');
        await recordingPromise; 
        broadcastConsole('Recording process finished.');

        // --- Post-processing (using shot-specific filenames) --- 
        broadcastConsole('Starting post-processing...');
        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (sessionError) {
            console.error("Action failed: Could not get session directory for post-processing:", sessionError);
            broadcastConsole(`Action failed: Could not get session directory: ${sessionError.message}`, 'error');
            return; 
        }

        broadcastConsole('Extracting frames...');
        await ffmpegHelper.extractFrames(outOrigShot, RAW_DIR); // Use shot-specific input

        broadcastConsole('Processing frames for pose tracking...');
        const absoluteRawDir = path.join(sessionDir, RAW_DIR);
        const absoluteOverlayDir = path.join(sessionDir, OVERLAY_DIR);
        await poseTracker.processFrames(absoluteRawDir, absoluteOverlayDir);

        broadcastConsole('Encoding final overlay video...');
        await ffmpegHelper.encodeVideo(OVERLAY_DIR, outOverShot); // Use shot-specific output
        // --- End Post-processing ---

        broadcastConsole(`✅ Shot '${currentShotIdentifier}' completed. Overlay video: ${outOverShot}`);

        // Broadcast SHOT_ENDED ?
        broadcast({ type: 'SHOT_ENDED', scene: scene, shot: shot, shotIndex: currentSceneTakeIndex });

        // TODO: Logic for advancing to the next shot or scene completion

    } catch (err) {
        broadcastConsole(`Error during shot recording sequence: ${err.message}`, 'error');
        console.error("Shot Recording Error:", err); 
    }
    broadcastConsole('Action function finished.');
}

module.exports = {
    initScene,
    initShot,
    actorsReady,
    action,
    getCurrentScene
}; 