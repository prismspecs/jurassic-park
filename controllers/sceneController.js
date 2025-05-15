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
const os = require('os');
const fs = require('fs'); // Ensure fs is required
const { assembleSceneFFmpeg } = require('../services/sceneAssembler'); // Import the new assembler function
const { getLocalIpAddress } = require('../utils/networkUtils');
const sanitize = require('sanitize-filename'); // Ensure sanitize-filename is required

// Active workers and timeouts tracking
let activeWorkers = [];
let cameraMovementTimeouts = [];

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

    const serverIp = getLocalIpAddress();
    const port = config.port || 3000;
    const baseUrl = `http://${serverIp}:${port}`;
    console.log(`[sceneController][initShot] Using server's detected IP for QR code baseUrl (if needed by SHOT_INIT): ${baseUrl}`);

    currentStageState.scene = sceneDirectory;
    currentStageState.shotIdentifier = shotIdentifier;
    currentStageState.shotIndex = -1;

    const scene = scenes.find(s => s.directory === sceneDirectory);
    if (!scene) {
        broadcastConsole(`Error: Scene not found for directory: ${sceneDirectory}`, 'error');
        throw new Error(`Scene not found: ${sceneDirectory}`);
    }

    if (!scene.shots || scene.shots.length === 0) {
        broadcastConsole(`Error: Scene '${sceneDirectory}' has no shots defined.`, 'error');
        throw new Error(`Scene '${sceneDirectory}' has no shots.`);
    }

    const shotIndex = scene.shots.findIndex((shot, index) => {
        const identifier = shot.name || `shot_${index + 1}`;
        return identifier === shotIdentifier;
    });

    if (shotIndex === -1) {
        broadcastConsole(`Error: Shot '${shotIdentifier}' not found in scene '${sceneDirectory}'.`, 'error');
        throw new Error(`Shot '${shotIdentifier}' not found in scene '${sceneDirectory}'.`);
    }

    currentStageState.shotIndex = shotIndex;
    const shotData = scene.shots[shotIndex];

    broadcastConsole(`Successfully initialized Scene: '${sceneDirectory}', Shot: '${shotIdentifier}' (Index: ${shotIndex})`, 'success');
    broadcastConsole(`Shot description: ${shotData.description || 'N/A'}`, 'info');

    const shotCameraDescriptions = [];
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
                shotCameraDescriptions.push({ name: cameraName, description: cameraDescription });
            } else {
                broadcastConsole(`-> NO MATCH: Camera '${cameraName}' (from shot file) is not currently managed. Description: ${cameraDescription}`, 'warn');
            }
        });
        broadcastConsole(`--- Finished Checking Shot Camera Definitions ---`, 'info');
    } else {
        broadcastConsole(`No 'cameras' array found in shot data for '${shotIdentifier}'.`, 'warn');
    }
    if (shotCameraDescriptions.length > 0) {
        broadcast({ type: 'SHOT_CAMERA_DESCRIPTIONS', descriptions: shotCameraDescriptions });
    }

    broadcast({ type: 'SHOT_INIT', scene: scene, shot: shotData, shotIndex: shotIndex });
    aiVoice.speak(`Please prepare for scene ${scene.description}, shot ${shotIndex + 1}: ${shotData.description || shotIdentifier}`);

    return { scene: scene, shot: shotData, shotIndex: shotIndex };
}

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

    const { recordingType = 'camera' } = req.body || {}; // Get recordingType, default to 'camera'
    broadcastConsole(`Recording type specified: ${recordingType}`, 'info');

    if (!currentStageState.scene || currentStageState.shotIndex === -1) {
        const errorMsg = `Action aborted: No scene/shot active or index invalid. Scene: ${currentStageState.scene}, ShotIdentifier: ${currentStageState.shotIdentifier}, Index: ${currentStageState.shotIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
        if (res) return res.status(400).json({ success: false, message: errorMsg });
        return;
    }

    const scene = scenes.find(s => s.directory === currentStageState.scene);
    if (!scene || !scene.shots || currentStageState.shotIndex >= scene.shots.length) {
        const errorMsg = `Action aborted: Scene/Shot data not found or index out of bounds for ${currentStageState.scene} / Shot Index: ${currentStageState.shotIndex}`;
        console.error(errorMsg);
        broadcastConsole(errorMsg, 'error');
        if (res) return res.status(404).json({ success: false, message: errorMsg });
        return;
    }
    const shot = scene.shots[currentStageState.shotIndex]; // Safe to access now

    // Ensure shot has a name or number for logging/reference
    const safeShotName = sanitize(shot.name || `shot_${currentStageState.shotIndex + 1}`);
    const shotRef = shot.name || `Shot #${shot.number || currentStageState.shotIndex}`;

    broadcastConsole(`Initiating ACTION for Scene: '${currentStageState.scene}', Shot: '${shotRef}' (Index: ${currentStageState.shotIndex})`);

    // activeWorkers and cameraMovementTimeouts are already module-level, so they are accessible.
    // Reset them here before the try block for this action.
    activeWorkers = [];
    cameraMovementTimeouts = [];

    try { // Start of the main try block
        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (sessionError) {
            const errorMsg = `Action failed: Could not get session directory: ${sessionError.message}`;
            console.error("Action failed: Could not get session directory:", sessionError);
            broadcastConsole(errorMsg, 'error');
            if (res) return res.status(500).json({ success: false, message: errorMsg });
            return; // This return is inside the try, but it's for a specific failure condition.
        }

        const sceneDirectory = currentStageState.scene;
        const scenePathForTakes = path.join(sessionDir, sceneDirectory);
        let highestTake = 0;

        try {
            if (!fs.existsSync(scenePathForTakes)) {
                fs.mkdirSync(scenePathForTakes, { recursive: true });
                broadcastConsole(`Created scene directory for takes: ${scenePathForTakes}`, 'info');
            }
            const entries = fs.readdirSync(scenePathForTakes, { withFileTypes: true });
            const shotTakeRegex = new RegExp(`^${safeShotName}_(\\d+)$`);
            entries.forEach(entry => {
                if (entry.isDirectory()) {
                    const match = entry.name.match(shotTakeRegex);
                    if (match) {
                        const takeNum = parseInt(match[1], 10);
                        if (!isNaN(takeNum) && takeNum > highestTake) {
                            highestTake = takeNum;
                        }
                    }
                }
            });
            broadcastConsole(`Highest existing take for ${safeShotName} found: ${highestTake}`, 'info');
        } catch (readError) {
            console.error(`Error reading directory for take calculation ${scenePathForTakes}:`, readError);
            broadcastConsole(`Error checking existing takes for ${safeShotName}. Assuming Take 1. Error: ${readError.message}`, 'warn');
            highestTake = 0;
        }

        const takeNumber = highestTake + 1;
        broadcastConsole(`Recording Take #${takeNumber} for ${safeShotName}`);
        const shotTakeIdentifier = `${safeShotName}_${takeNumber}`;
        const outputBasePath = path.join(sessionDir, sceneDirectory, shotTakeIdentifier);
        broadcastConsole(`Output base path set to: ${outputBasePath}`);

        if (!fs.existsSync(outputBasePath)) {
            fs.mkdirSync(outputBasePath, { recursive: true });
            broadcastConsole(`Created output base directory: ${outputBasePath}`, 'info');
        } else {
            broadcastConsole(`Output base directory already exists: ${outputBasePath}`, 'warn');
        }

        const shotDurationStr = shot.duration || '0:05';
        const durationParts = shotDurationStr.split(':').map(Number);
        const shotDurationSec = (durationParts.length === 2) ? (durationParts[0] * 60 + durationParts[1]) : (durationParts[0] || 5);
        broadcastConsole(`Shot duration: ${shotDurationSec} seconds`);

        const useFfmpeg = settingsService.shouldUseFfmpeg();
        const pipelineName = useFfmpeg ? 'FFmpeg' : 'GStreamer';
        broadcastConsole(`Using recording pipeline from settings: ${pipelineName}`, 'info');
        const resolution = settingsService.getRecordingResolution();
        broadcastConsole(`Using recording resolution from settings: ${resolution.width}x${resolution.height}`, 'info');

        // --- Refactor Worker Launching --- 
        const workersToCreateDetails = []; // Store details for workers to be created

        if (shot.cameras && shot.cameras.length > 0) {
            broadcastConsole(`Preparing video recording for ${shot.cameras.length} camera(s) in shot '${shotRef}'`, 'info');
            for (const shotCameraInfo of shot.cameras) {
                const recordingCameraName = shotCameraInfo.name;
                broadcastConsole(`Processing camera for recording: ${recordingCameraName}`, 'info');

                const managedCamera = cameraControl.getCamera(recordingCameraName);
                if (!managedCamera) {
                    broadcastConsole(`Camera ${recordingCameraName} not found in managed cameras. Skipping recording for this camera.`, 'warn');
                    continue;
                }

                const recordingDeviceSetting = managedCamera.recordingDevice;
                broadcastConsole(`Checking recording device for ${recordingCameraName}. Found setting: '${recordingDeviceSetting}' (type: ${typeof recordingDeviceSetting})`, 'info');

                if (recordingDeviceSetting === null || recordingDeviceSetting === undefined || recordingDeviceSetting === '') {
                    broadcastConsole(`Recording device *not set* for camera ${recordingCameraName}. Skipping.`, 'warn');
                    continue;
                }
                const recordingDevicePath = recordingDeviceSetting;
                broadcastConsole(`Using recording device for ${recordingCameraName}: ${recordingDevicePath}`, 'info');

                if (!resolution || typeof resolution.width !== 'number' || typeof resolution.height !== 'number') {
                    broadcastConsole(`Skipping recording for ${recordingCameraName}: Invalid global resolution.`, 'error');
                    continue;
                }

                if (recordingType === 'camera') { // Only create server-side workers if type is 'camera'
                    workersToCreateDetails.push({
                        cameraName: recordingCameraName,
                        workerData: {
                            cameraName: recordingCameraName,
                            useFfmpeg: useFfmpeg,
                            resolution: resolution,
                            devicePath: recordingDevicePath,
                            outputBasePath: outputBasePath,
                            durationSec: shotDurationSec
                        },
                        movements: shotCameraInfo.movements // Also pass movements here for later processing
                    });
                } else if (recordingType === 'canvas') {
                    broadcastConsole(`[Action] Canvas recording mode for ${recordingCameraName}. Server will NOT start a video worker.`, 'info');
                }
            }
        } else {
            broadcastConsole('No cameras in shot. Skipping video recording.', 'info');
        }

        // Now, create and manage workers from the collected details
        // activeWorkers was reset before the try block.
        workersToCreateDetails.forEach(detail => {
            const { cameraName, workerData, movements } = detail;

            console.log(`[Action] Preparing to start worker for ${cameraName}...`);
            broadcastConsole(`[Action] Preparing to start worker for ${cameraName}...`, 'info');

            let worker;
            try {
                worker = new Worker(path.resolve(__dirname, '../workers/recordingWorker.js'), { workerData });
                console.log(`[Action] Worker instance CREATED for ${cameraName}.`);
            } catch (workerError) {
                console.error(`[Action] FAILED TO CREATE Worker instance for ${cameraName}:`, workerError);
                broadcastConsole(`[Action] FAILED TO CREATE Worker instance for ${cameraName}: ${workerError.message}`, 'error');
                return; // Skip this camera if worker creation fails (use continue if this was in a direct loop)
            }

            activeWorkers.push({ name: cameraName, worker: worker });
            console.log(`[Action] Worker for ${cameraName} ADDED to activeWorkers. Count: ${activeWorkers.length}`);
            broadcastConsole(`[Action] Worker for ${cameraName} added to pool.`, 'debug');

            worker.on('message', (msg) => {
                console.log(`[Action][Worker MSG ${cameraName}]:`, msg);
                broadcastConsole(`Worker [${cameraName}] message: ${msg.status || JSON.stringify(msg)}`, msg.type || 'info');
                if (msg.status === 'completed') {
                    const initialLength = activeWorkers.length;
                    activeWorkers = activeWorkers.filter(w => w.worker !== worker);
                    console.log(`[Action][Worker COMPLETED ${cameraName}]: Removed from activeWorkers. Before: ${initialLength}, After: ${activeWorkers.length}`);
                    broadcastConsole(`Worker for ${cameraName} completed. Active workers: ${activeWorkers.length}`, 'info');
                }
            });
            worker.on('error', (err) => {
                console.error(`[Action][Worker ERR ${cameraName}]:`, err);
                broadcastConsole(`Worker [${cameraName}] error: ${err.message}`, 'error');
                const initialLength = activeWorkers.length;
                activeWorkers = activeWorkers.filter(w => w.worker !== worker);
                console.log(`[Action][Worker ERR ${cameraName}]: Removed from activeWorkers. Before: ${initialLength}, After: ${activeWorkers.length}`);
            });
            worker.on('exit', (code) => {
                console.log(`[Action][Worker EXIT ${cameraName}]: Code ${code}`);
                broadcastConsole(`Worker [${cameraName}] exited code ${code}`, code !== 0 ? 'warn' : 'info');
                const initialLength = activeWorkers.length;
                activeWorkers = activeWorkers.filter(w => w.worker !== worker);
                console.log(`[Action][Worker EXIT ${cameraName}]: Removed from activeWorkers. Before: ${initialLength}, After: ${activeWorkers.length}`);
                if (code !== 0) {
                    // Handle non-zero exit code
                }
            });

            // Handle PTZ movements for this camera
            if (movements && movements.length > 0) {
                broadcastConsole(`Scheduling ${movements.length} PTZ for ${cameraName}...`, 'info');
                movements.forEach(move => {
                    if (typeof move.time !== 'number' || move.time < 0) {
                        broadcastConsole(`Invalid time for PTZ in ${cameraName}. Skipping.`, 'warn');
                        return;
                    }
                    const delayMs = move.time * 1000;
                    const timeoutId = setTimeout(async () => {
                        try {
                            const ptzPayload = {};
                            let logMsg = `PTZ ${cameraName} @${move.time}s:`;
                            if (typeof move.pan === 'number') {
                                ptzPayload.pan = mapPanDegreesToValue(move.pan);
                                logMsg += ` P=${move.pan}°`;
                            }
                            if (typeof move.tilt === 'number') {
                                ptzPayload.tilt = mapTiltDegreesToValue(move.tilt);
                                logMsg += ` T=${move.tilt}°`;
                            }
                            if (typeof move.zoom === 'number' && move.zoom >= 0 && move.zoom <= 100) {
                                ptzPayload.zoom = move.zoom;
                                logMsg += ` Z=${move.zoom}%`;
                            }
                            if (Object.keys(ptzPayload).length > 0) {
                                broadcastConsole(logMsg, 'info');
                                await cameraControl.setPTZ(cameraName, ptzPayload);
                            }
                        } catch (ptzError) {
                            broadcastConsole(`PTZ Error ${cameraName}: ${ptzError.message}`, 'error');
                        }
                    }, delayMs);
                    cameraMovementTimeouts.push(timeoutId);
                });
            } else {
                broadcastConsole(`No PTZ movements for ${cameraName}.`, 'info');
            }
        });
        // --- End Refactor Worker Launching ---

        broadcastConsole('Starting audio recording...', 'info');
        audioRecorder.startRecording(outputBasePath, shotDurationSec);

        broadcastConsole('Proceeding with shot actions...');
        aiVoice.speak("Action!");

        try {
            broadcast({
                type: 'SHOT_START',
                scene: { directory: currentStageState.scene },
                shot: { name: shot.name, number: shot.number, duration: shotDurationSec, take: takeNumber }
            });
            broadcastConsole(`Broadcasted SHOT_START for ${currentStageState.scene}, ${shotRef}`, 'success');
        } catch (broadcastError) {
            broadcastConsole(`ERROR Broadcasting SHOT_START: ${broadcastError.message}`, 'error');
        }

        // --- Wait for the shot duration ---
        const waitDurationMs = shotDurationSec * 1000;
        broadcastConsole(`Waiting ${waitDurationMs / 1000}s for shot performance...`);
        await new Promise(resolve => setTimeout(resolve, waitDurationMs));
        broadcastConsole('Shot performance time elapsed.');

        // --- Stop Client Canvas Recorders (if applicable) ---
        // We only need to send this if the recording type was canvas.
        // Need access to the recordingType variable from the start of the function.
        // Let's retrieve it again or pass it down. For now, let's assume we might 
        // need to send it regardless, and clients only act if they are recording.
        // Alternatively, check if recordingType was canvas earlier in the function
        // and set a flag.
        // Simpler approach: Send it, client ignores if not relevant.
        broadcastConsole('Broadcasting STOP_CANVAS_RECORDING to clients...', 'info');
        try {
            broadcast({ type: 'STOP_CANVAS_RECORDING' });
        } catch (broadcastError) {
            broadcastConsole(`ERROR Broadcasting STOP_CANVAS_RECORDING: ${broadcastError.message}`, 'error');
        }
        // --- End Stop Client Canvas Recorders ---

        // --- Wait for Video Workers to Finish ---
        broadcastConsole('Waiting for video worker(s) to complete...');
        if (activeWorkers.length > 0) {
            console.log(`[Action] Waiting for ${activeWorkers.length} workers:`, activeWorkers.map(w => w.name)); // Added log
            await new Promise((resolve, reject) => { // Added reject
                const checkInterval = setInterval(() => {
                    console.log(`[Action] Worker wait check: activeWorkers.length = ${activeWorkers.length}`); // Added log
                    if (activeWorkers.length === 0) {
                        clearInterval(checkInterval);
                        console.log('[Action] Worker wait finished: activeWorkers is empty.'); // Added log
                        resolve();
                    }
                }, 500);
                // Add a timeout to prevent hanging indefinitely
                const waitTimeout = setTimeout(() => {
                    clearInterval(checkInterval);
                    console.error(`[Action] Worker wait TIMED OUT after ${config.workerWaitTimeout || 30000}ms! Active workers remaining:`, activeWorkers.map(w => w.name));
                    broadcastConsole(`[Action] Worker wait TIMED OUT! Some recordings may be incomplete.`, 'error');
                    // Decide whether to resolve or reject. Rejecting might stop the flow.
                    // Resolving allows flow to continue but recordings might be missing/partial.
                    // Let's resolve for now, but log the error clearly.
                    resolve(); // Or reject(new Error('Worker wait timed out'))
                }, config.workerWaitTimeout || 30000); // Default 30 seconds timeout

                // Ensure timeout is cleared if resolved normally
                const originalResolve = resolve;
                resolve = () => {
                    clearTimeout(waitTimeout);
                    originalResolve();
                }
            });
            broadcastConsole('All active video worker(s) seem to have exited.', 'info');
        } else {
            broadcastConsole('No active video workers to wait for (or canvas recording mode).', 'info');
        }

        try {
            broadcast({
                type: 'SHOT_END',
                scene: { directory: currentStageState.scene },
                shot: { name: shot.name, number: shot.number }
            });
            broadcastConsole(`Broadcasted SHOT_END for ${currentStageState.scene}, ${shotRef}`, 'success');
        } catch (broadcastError) {
            broadcastConsole(`ERROR Broadcasting SHOT_END: ${broadcastError.message}`, 'error');
        }

        if (res) res.json({ success: true, message: `Action sequence initiated for shot ${shotRef}.` });

    } catch (error) { // Catch block for the main try
        console.error("Error during action execution:", error);
        broadcastConsole(`Action failed: ${error.message}`, 'error');

        // --- Emergency Stop/Cleanup on Error ---
        broadcastConsole('Attempting emergency cleanup...', 'warn');
        cameraMovementTimeouts.forEach(clearTimeout);
        cameraMovementTimeouts.length = 0;

        broadcastConsole('Force stopping audio recording (on error)...', 'warn');
        audioRecorder.stopRecording();

        broadcastConsole('Attempting to terminate active video workers (on error)...', 'warn');
        activeWorkers.forEach(({ worker, name }) => {
            try {
                broadcastConsole(`Terminating worker for ${name}...`, 'warn');
                worker.terminate().catch(termErr => { // Add catch for terminate promise
                    console.error(`Error during worker.terminate() for ${name}:`, termErr);
                    broadcastConsole(`Error terminating worker ${name} (async): ${termErr.message}`, 'error');
                });
            } catch (termErr) {
                console.error(`Exception terminating worker ${name}:`, termErr);
                broadcastConsole(`Exception terminating worker ${name}: ${termErr.message}`, 'error');
            }
        });
        activeWorkers.length = 0;

        if (res) return res.status(500).json({ success: false, message: `Action failed: ${error.message}` });

    } finally {
        // Code here runs whether try succeeded or failed
        console.log("Action function finally block reached.");
        // Ensure timeouts are cleared if not already
        cameraMovementTimeouts.forEach(clearTimeout);
        cameraMovementTimeouts.length = 0;
        // Ensure activeWorkers is cleared (might be redundant if error handling already did it)
        activeWorkers.forEach(({ worker, name }) => {
            try { worker.terminate().catch(() => { }); } catch (e) { } // Best effort
        });
        activeWorkers.length = 0;
    }
}

// --- NEW: Scene Assembly Controller ---

async function assembleScene(req, res) {
    const { sceneDirectory, takes } = req.body;
    const currentSessionId = sessionService.getCurrentSessionId();

    // Basic validation (remains in controller)
    if (!currentSessionId) {
        return res.status(400).json({ success: false, message: "No active session selected." });
    }
    if (!sceneDirectory || typeof sceneDirectory !== 'string') {
        return res.status(400).json({ success: false, message: "Missing or invalid sceneDirectory." });
    }
    if (!takes || !Array.isArray(takes) || takes.length === 0) {
        return res.status(400).json({ success: false, message: "Missing or invalid takes array." });
    }
    // Further validation of takes array contents (shot, camera, in, out, take)
    for (const take of takes) {
        // Check for frame numbers instead of in/out time
        if (!take.shot || !take.camera || take.inFrame == null || take.outFrame == null || !take.take) {
            return res.status(400).json({ success: false, message: `Invalid take data provided (missing frame info?): ${JSON.stringify(take)}` });
        }
        // Validate frame numbers are integers and inFrame < outFrame
        if (!Number.isInteger(take.inFrame) || !Number.isInteger(take.outFrame) || take.inFrame < 0 || take.outFrame <= take.inFrame) {
            return res.status(400).json({ success: false, message: `Invalid frame numbers (inFrame >= outFrame or negative?): ${JSON.stringify(take)}` });
        }
        if (typeof take.take !== 'number' || take.take < 1) {
            return res.status(400).json({ success: false, message: `Invalid take number: ${JSON.stringify(take)}` });
        }
    }

    console.log(`[Controller] Received assembly request for session: ${currentSessionId}, scene: ${sceneDirectory}`);
    broadcastConsole(`Assembly request received for scene: ${sceneDirectory}. Starting process...`, 'info');

    // Immediately respond to the client that the process has started
    const sanitizedSceneDir = sceneDirectory.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.status(202).json({
        success: true,
        message: `Assembly process initiated for ${sceneDirectory}. Monitor console/UI for updates.`
    });

    // Call the actual assembly function asynchronously (don't await here)
    assembleSceneFFmpeg(sceneDirectory, takes, currentSessionId)
        .then(outputPath => {
            // Success is handled by the assembler via broadcast
            console.log(`[Controller] Assembly for ${sceneDirectory} completed successfully. Output: ${outputPath}`);
            // Optionally do something else here on completion if needed
        })
        .catch(error => {
            // Error is handled by the assembler via broadcast
            console.error(`[Controller] Assembly for ${sceneDirectory} failed:`, error);
            // Optionally do something else here on failure if needed
        });
}

// --- NEW: Controller function for canvas video uploads ---
async function uploadCanvasVideo(req, res) {
    broadcastConsole('Received canvas video upload request.', 'info');
    try {
        if (!req.file || !req.file.buffer) {
            broadcastConsole('Canvas upload error: No file buffer received.', 'error');
            return res.status(400).json({ success: false, message: 'No video file received.' });
        }

        const { sceneDirectory, shotName, takeNumber, cameraName, filename: clientFilename } = req.body;
        const videoBuffer = req.file.buffer;

        if (!sceneDirectory || !shotName || !takeNumber || !cameraName || !clientFilename) {
            broadcastConsole('Canvas upload error: Missing metadata (scene, shot, take, cameraName, or filename).', 'error');
            return res.status(400).json({ success: false, message: 'Missing required metadata or filename.' });
        }

        const sessionDir = sessionService.getSessionDirectory();
        if (!sessionDir) {
            broadcastConsole('Canvas upload error: Could not get session directory.', 'error');
            return res.status(500).json({ success: false, message: 'Session directory not found.' });
        }

        const safeShotName = sanitize(shotName || 'unknown_shot');
        const takeNumStr = takeNumber.toString(); // Ensure it's a string for path construction
        const shotTakeIdentifier = `${safeShotName}_${takeNumStr}`;

        const sceneRecordingsPath = path.join(sessionDir, sceneDirectory);
        const baseShotTakePath = path.join(sceneRecordingsPath, shotTakeIdentifier);
        const cameraSpecificPath = path.join(baseShotTakePath, cameraName); // Create path for camera-specific folder

        // Ensure the full camera-specific path exists
        if (!fs.existsSync(cameraSpecificPath)) {
            fs.mkdirSync(cameraSpecificPath, { recursive: true });
            broadcastConsole(`Created directory for canvas recording: ${cameraSpecificPath}`, 'info');
        }

        // Use the filename (including extension) provided by the client, after sanitizing it.
        const serverFilename = sanitize(clientFilename);
        const finalFilePath = path.join(cameraSpecificPath, serverFilename);

        fs.writeFileSync(finalFilePath, videoBuffer);
        broadcastConsole(`Canvas video for ${cameraName} (Shot: ${shotName}, Take: ${takeNumber}) saved to: ${finalFilePath}`, 'success');

        res.json({
            success: true,
            message: `Canvas video for ${cameraName} uploaded and saved.`,
            filePath: finalFilePath
        });

    } catch (error) {
        console.error("Error during canvas video upload:", error);
        broadcastConsole(`Canvas video upload failed: ${error.message}`, 'error');
        res.status(500).json({ success: false, message: `Canvas video upload failed: ${error.message}` });
    }
}

// Renamed from callActorsForShot and will be exported
async function draftActorsForShot(sceneDirectory, shotIdentifier) {
    broadcastConsole(`Drafting actors for Scene: '${sceneDirectory}', Shot: '${shotIdentifier}'`, 'info');

    const serverIp = getLocalIpAddress();
    const port = config.port || 3000;
    const baseUrl = `http://${serverIp}:${port}`;
    console.log(`[sceneController][draftActorsForShot] Using server's detected IP for QR code baseUrl: ${baseUrl}`);

    const scene = scenes.find(s => s.directory === sceneDirectory);
    if (!scene) {
        broadcastConsole(`Error: Scene not found for directory: ${sceneDirectory} (drafting)`, 'error');
        throw new Error(`Scene not found: ${sceneDirectory}`);
    }

    if (!scene.shots || scene.shots.length === 0) {
        broadcastConsole(`Error: Scene '${sceneDirectory}' has no shots defined (drafting).`, 'error');
        throw new Error(`Scene '${sceneDirectory}' has no shots.`);
    }

    const shotIndex = scene.shots.findIndex((shot, index) => {
        const identifier = shot.name || `shot_${index + 1}`;
        return identifier === shotIdentifier;
    });

    if (shotIndex === -1) {
        broadcastConsole(`Error: Shot '${shotIdentifier}' not found in scene '${sceneDirectory}' (drafting).`, 'error');
        throw new Error(`Shot '${shotIdentifier}' not found in scene '${sceneDirectory}'.`);
    }

    const shot = scene.shots[shotIndex]; // Use consistent 'shot' variable name
    broadcastConsole(`Calling actors for scene '${scene.description}', shot '${shot.name || shotIndex + 1}'`);

    const characters = shot.characters;
    if (!characters) {
        broadcastConsole(`No 'characters' defined for shot ${shotIdentifier} in scene '${scene.directory}'. Cannot call actors.`, 'warn');
        broadcast({ type: 'ACTORS_CALLED', scene: scene, shot: shot }); // Still send signal to potentially show "Actors Ready"
        return { message: "No characters defined for shot, but proceeding." }; // Return a message
    }

    const characterNames = Object.keys(characters);
    const actorsNeeded = characterNames.length;
    broadcastConsole(`Actors needed: ${actorsNeeded} for characters: ${characterNames.join(', ')}`);
    const actorsToCall = callsheetService.getActorsForScene(actorsNeeded);

    const actorCallData = [];

    for (let index = 0; index < actorsToCall.length; index++) {
        const actor = actorsToCall[index];
        const characterName = characterNames[index];
        const characterData = characters[characterName];
        const propsValue = characterData ? characterData.props : null;

        const characterFullName = characterData ? characterData['full-name'] : characterName; // Get full name, fallback to key

        const characterUrl = `${baseUrl}/teleprompter/${encodeURIComponent(characterName)}`;
        const headshotUrl = `/database/actors/${encodeURIComponent(actor.id)}/headshot.jpg`;

        let propImageUrls = [];
        if (propsValue) {
            if (Array.isArray(propsValue)) {
                propImageUrls = propsValue.map(propName => `/database/props/${encodeURIComponent(propName)}.png`);
            } else if (typeof propsValue === 'string' && propsValue.toLowerCase() !== 'none') {
                propImageUrls.push(`/database/props/${encodeURIComponent(propsValue)}.png`);
            }
        }
        console.log(`[sceneController] Processing actor: ${actor.name}, Character: ${characterName}, Props Value: ${JSON.stringify(propsValue)}, Prop Image URLs: ${JSON.stringify(propImageUrls)}`);

        let qrCodeDataUrl = null; // Initialize qrCodeDataUrl to null

        // Only generate QR code if the shot type is 'normal'
        if (shot.type === 'normal') {
            try {
                qrCodeDataUrl = await QRCode.toDataURL(characterUrl);
            } catch (err) {
                broadcastConsole(`Error generating QR code for ${characterName} in normal shot: ${err}`, 'error');
                // actorCallData entry below will use null for qrCodeImage
            }
        }

        // Always push actor data, qrCodeImage will be null if not a normal shot or if QR generation failed
        actorCallData.push({
            name: actor.name,
            id: actor.id,
            character: characterName,
            characterFullName: characterFullName,
            headshotImage: headshotUrl,
            qrCodeImage: qrCodeDataUrl, // This will be null for non-normal shots or if QR generation failed
            propImages: propImageUrls,
            // Include an error field ONLY if QR generation failed AND it was a normal shot
            error: (shot.type === 'normal' && !qrCodeDataUrl) ? `Failed to generate QR code` : undefined
        });

        // Speak and update count regardless of QR code generation for the character.
        aiVoice.speak(`Calling actor: ${actor.name} to play ${characterName}`);
        callsheetService.updateActorSceneCount(actor.name);
    }

    console.log('>>> [sceneController] Preparing ACTOR_CALLS data:', actorCallData);

    if (actorCallData.length > 0) {
        broadcast({
            type: 'ACTOR_CALLS', // This message type includes actor details for teleprompter
            actors: actorCallData,
            scene: scene.directory,
            shot: shot.name || `shot_${shotIndex + 1}`
        });
    }

    // Also explicitly send ACTORS_CALLED so client UI (ActorsReady button) updates.
    // This is what the client-side websocket handler expects to show actorsReadyBtn
    broadcast({ type: 'ACTORS_CALLED', scene: scene, shot: shot });

    return { message: "Actors called successfully for shot." };
}

module.exports = {
    initShot,
    actorsReady,
    action,
    getCurrentScene,
    assembleScene,
    uploadCanvasVideo,
    draftActorsForShot,
};