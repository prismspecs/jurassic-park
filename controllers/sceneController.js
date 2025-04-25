const fs = require('fs');
const config = require('../config.json');
const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast, broadcastConsole, broadcastTeleprompterStatus } = require('../websocket/broadcaster');
const ffmpegHelper = require('../services/ffmpegHelper');
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

    // Call the actors
    for (let index = 0; index < actorsToCall.length; index++) {
        const actor = actorsToCall[index];
        const characterName = characterNames[index];
        const characterUrl = `${baseUrl}/teleprompter/${encodeURIComponent(characterName)}`;
        const headshotUrl = `/database/actors/${encodeURIComponent(actor.id)}/headshot.jpg`;

        try {
            // Generate QR code as a Data URL
            const qrCodeDataUrl = await QRCode.toDataURL(characterUrl);

            // Update the teleprompter text with headshot and QR code
            broadcast({
                type: 'TELEPROMPTER',
                text: `Calling actor: ${actor.name} to play ${characterName}`,
                headshotImage: headshotUrl,    // Send headshot URL
                qrCodeImage: qrCodeDataUrl     // Send QR code data URL
            });
            broadcastConsole(`Broadcasted TELEPROMPTER: Calling ${actor.name} as ${characterName} with headshot and QR code`);

            callsheetService.updateActorSceneCount(actor.name);
            aiVoice.speak(`Calling actor: ${actor.name} to play ${characterName}`);

        } catch (err) {
            broadcastConsole(`Error generating QR code or preparing message for ${characterName}: ${err}`, 'error');
            broadcast({
                type: 'TELEPROMPTER',
                text: `Error creating link for ${actor.name} playing ${characterName}`,
                style: 'error'
                // Optionally send headshot even if QR fails?
                // headshotImage: headshotUrl 
            });
        }
    }

    // Broadcast that actors are being called
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
            config.videoOriginal,
            sceneDuration,
            recordingDevicePath, // Pass the selected device path
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

        // Get the current take's characters
        const characters = scene.takes[sceneTakeIndex].characters;

        // Create a timeline of all events (lines and directions) from all characters
        const timeline = [];

        // Process each character's lines and directions
        Object.entries(characters).forEach(([character, data]) => {
            // Add lines to timeline
            if (data.lines) {
                data.lines.forEach(line => {
                    timeline.push({
                        timeIn: line['time-in'],
                        timeOut: line['time-out'],
                        type: 'line',
                        character: character,
                        text: line.text,
                        style: 'italic' // Lines are denoted with _
                    });
                });
            }

            // Add directions to timeline
            if (data.directions) {
                data.directions.forEach(direction => {
                    timeline.push({
                        timeIn: direction['time-in'],
                        timeOut: direction['time-out'],
                        type: 'direction',
                        character: character,
                        text: direction.text,
                        style: 'bold' // Directions are denoted with *
                    });
                });
            }
        });

        // Sort timeline by timeIn
        timeline.sort((a, b) => a.timeIn - b.timeIn);

        // Play through the timeline
        broadcastConsole('Starting scene timeline playback...');
        let currentTime = 0;
        timeline.forEach(event => {
            setTimeout(() => {
                // Broadcast the event to the frontend
                broadcast({
                    type: 'SCENE_EVENT',
                    event: {
                        character: event.character,
                        text: event.text,
                        style: event.type === 'line' ? 'actor' : 'direction'
                    }
                });

                // If it's a line, use AI voice to speak it
                if (event.type === 'line') {
                    aiVoice.speak(event.text);
                }
            }, event.timeIn * 1000); // Convert seconds to milliseconds
        });

        // Wait for the recording to complete
        broadcastConsole('Waiting for video recording process to finish...');
        await recordingPromise; // Now we await the promise
        broadcastConsole('Video recording process finished successfully.');

        // ---- Add Pose Processing Steps ----
        broadcastConsole('Starting pose processing...');
        const RAW_DIR = path.join(__dirname, '..', config.framesRawDir);
        const OVERLAY_DIR = path.join(__dirname, '..', config.framesOverlayDir);
        const OUT_ORIG = config.videoOriginal; // Already defined in config
        const OUT_OVER = config.videoOverlay; // Already defined in config

        await ffmpegHelper.extractFrames(OUT_ORIG, RAW_DIR);
        broadcastConsole('Frames extracted.');
        await poseTracker.processFrames(RAW_DIR, OVERLAY_DIR);
        broadcastConsole('Pose tracking complete.');
        await ffmpegHelper.encodeVideo(OVERLAY_DIR, OUT_OVER);
        broadcastConsole(`Overlay video created: ${OUT_OVER}`);
        // ---- End Pose Processing Steps ----

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