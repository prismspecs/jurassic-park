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
}

async function callActors(scene) {
    broadcastConsole(`Calling actors for scene: ${scene.description}`);

    // Get the characters object from the current take
    const characters = scene.takes[sceneTakeIndex].characters;

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
            // Handle error - maybe add an error entry to actorCallData or broadcast separate error?
            // For now, just log it and continue.
            actorCallData.push({ // Add placeholder or error info
                name: actor.name,
                character: characterName,
                error: `Failed to generate QR code`
            });
            // Optionally broadcast an immediate error message?
            // broadcast({ type: 'TELEPROMPTER', text: `Error creating link for ${actor.name} playing ${characterName}`, style: 'error' });
        }
    }

    // Broadcast the consolidated actor call data
    if (actorCallData.length > 0) {
        broadcast({
            type: 'ACTOR_CALLS', // New message type
            actors: actorCallData
        });
        broadcastConsole(`Broadcasted ACTOR_CALLS for ${actorCallData.length} actor(s)`);
    }

    // Broadcast that actors are being called (Original ACTORS_CALLED - keep for other UI logic?)
    broadcast({
        type: 'ACTORS_CALLED',
        scene: scene
    });
}

function actorsReady() {
    if (!currentScene) {
        broadcastConsole('No scene is currently active', 'error');
        return;
    }

    // use currentScene to get the setup
    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene) {
        broadcastConsole(`Scene ${currentScene} not found`, 'error');
        return;
    }

    // Get the setup from the current take
    const setup = scene.takes[sceneTakeIndex].setup;
    if (!setup) {
        broadcastConsole(`No setup found for scene ${currentScene}`, 'error');
        return;
    }

    // aiSpeak the setup
    aiVoice.speak(setup);

    broadcastConsole('Actors are ready to perform');
    broadcast({
        type: 'ACTORS_READY',
        scene: scene
    });
}

async function action() {
    broadcastConsole('Action function started.');
    if (!currentScene) {
        broadcastConsole('Action aborted: No scene active.', 'error');
        return;
    }

    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene) {
        broadcastConsole(`Action aborted: Scene ${currentScene} not found.`, 'error');
        return;
    }

    // Define relative paths from config
    const RAW_DIR = config.framesRawDir;
    const OVERLAY_DIR = config.framesOverlayDir;
    const OUT_ORIG = config.videoOriginal;
    const OUT_OVER = config.videoOverlay;

    // start recording video
    broadcastConsole('Initiating video recording sequence...');

    let recordingPromise;
    try {
        // Determine which camera to use for recording
        // FIXME: This currently hardcodes 'Camera 1'. Need a better way to select the active camera.
        const recordingCameraName = 'Camera 1';
        broadcastConsole(`Attempting to get camera: ${recordingCameraName}`);
        const camera = cameraControl.getCamera(recordingCameraName);

        // === Specific Error Handling for Missing Camera ===
        if (!camera) {
            const errorMsg = `Error: Recording camera '${recordingCameraName}' is required but has not been added. Please add it via the Camera Controls section.`;
            broadcastConsole(errorMsg, 'error');
            return; // Stop the action function here
        }
        // ================================================

        broadcastConsole(`Found camera: ${camera.name}`);

        const recordingDevicePath = camera.getRecordingDevice();
        broadcastConsole(`Retrieved recording device path for ${camera.name}: ${recordingDevicePath}`); // Log retrieved path

        if (!recordingDevicePath) {
            const errorMsg = `Error: No recording device configured for camera '${recordingCameraName}'. Please configure it in the UI.`;
            broadcastConsole(errorMsg, 'error');
            // Throwing error here is okay, as the camera exists but isn't configured
            throw new Error(errorMsg);
        }

        broadcastConsole(`Attempting to record from: ${recordingCameraName} (${recordingDevicePath})`);

        // Record video for the duration of the scene
        const sceneDuration = scene.takes[sceneTakeIndex].duration || 10; // Default to 10 seconds if not specified
        broadcastConsole(`Scene duration: ${sceneDuration} seconds`);

        // Get selected pipeline and resolution (assuming these are set globally or passed differently)
        // For now, let's assume FFmpeg and default resolution for this specific call
        // FIXME: How should the pipeline/resolution be determined for the main scene recording?
        // Defaulting to FFmpeg and 1920x1080 for now.
        const useFfmpeg = true; // Or get from global state/config
        const resolution = { width: 1920, height: 1080 }; // Or get from global state/config
        const recordingHelper = useFfmpeg ? ffmpegHelper : gstreamerHelper;
        const pipelineName = useFfmpeg ? 'FFmpeg' : 'GStreamer';

        broadcastConsole(`Using pipeline: ${pipelineName}`);

        // Start FFmpeg recording using the selected device path and wait for it to be ready
        recordingPromise = recordingHelper.captureVideo(
            OUT_ORIG,
            sceneDuration,
            recordingDevicePath,
            resolution
        );

        // Wait a short moment to ensure FFmpeg/GStreamer has started recording
        broadcastConsole('Waiting briefly for recording process to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        broadcastConsole('Proceeding with scene...');

        // --- Broadcast SHOT_START to signal teleprompters etc. ---
        broadcast({
            type: 'SHOT_START',
            scene: scene, // Send the full scene object
        });
        broadcastConsole(`Broadcasted SHOT_START for scene: ${scene.directory}`);
        // ------------------------------------------------------

        // aiSpeak the action
        aiVoice.speak("action!");

        // wait for the scene duration + a buffer
        const waitDuration = sceneDuration * 1000 + 2000; // Add 2s buffer
        broadcastConsole(`Waiting ${waitDuration / 1000} seconds for scene completion...`);
        await new Promise(resolve => setTimeout(resolve, waitDuration));
        broadcastConsole('Scene time elapsed.');

        // Wait for the recording process to actually finish
        broadcastConsole('Ensuring recording process is complete...');
        await recordingPromise; // Wait here for ffmpeg/gstreamer to finish
        broadcastConsole('Recording process finished.');

        // --- Post-processing --- 
        broadcastConsole('Starting post-processing...');
        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (sessionError) {
            console.error("Action failed: Could not get session directory for post-processing:", sessionError);
            broadcastConsole(`Action failed: Could not get session directory: ${sessionError.message}`, 'error');
            return; // Stop if we can't get session dir
        }

        broadcastConsole('Extracting frames...');
        await ffmpegHelper.extractFrames(OUT_ORIG, RAW_DIR);

        broadcastConsole('Processing frames for pose tracking...');
        const absoluteRawDir = path.join(sessionDir, RAW_DIR);
        const absoluteOverlayDir = path.join(sessionDir, OVERLAY_DIR);
        await poseTracker.processFrames(absoluteRawDir, absoluteOverlayDir);

        broadcastConsole('Encoding final overlay video...');
        await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);
        // --- End Post-processing ---

        broadcastConsole(`✅ Scene ${currentScene} completed. Overlay video: ${OUT_OVER}`);

        // TODO: Maybe increment sceneTakeIndex here or handle scene completion logic

    } catch (err) {
        // Catch errors from camera setup (like missing device path) or the recording/processing steps
        broadcastConsole(`Error during scene recording sequence: ${err.message}`, 'error');
        console.error("Scene Recording Error:", err); // Log full error to server console
        // Optionally, try to clean up if needed
    }
    broadcastConsole('Action function finished.');
}

module.exports = {
    initScene,
    actorsReady,
    action,
    getCurrentScene
}; 