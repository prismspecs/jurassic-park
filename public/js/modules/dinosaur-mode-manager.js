import { logToConsole } from './logger.js';

let cameraManager = null;
let isDinosaurModeActive = false;
let dinosaurGameModule = null; // To hold the loaded module/functions

// Assuming the dinosaur game script is at this path relative to public/js
// We might need to adjust this based on the actual dinosaur-game structure
const DINOSAUR_GAME_SCRIPT_PATH = '../../modules/dinosaur-game/public/script.js'; // Adjusted path

/**
 * Initializes the Dinosaur Mode Manager with the CameraManager instance.
 * @param {object} cameraManagerInstance 
 */
function init(cameraManagerInstance) {
    cameraManager = cameraManagerInstance;
    logToConsole("Dinosaur Mode Manager initialized.", "info");
}

/**
 * Activates the Dinosaur Game mode.
 * Fetches required elements, loads the game script, and initializes it.
 * @param {object} shotData - The shot data object for the dinosaur shot.
 */
async function activate(shotData) {
    if (!cameraManager) {
        logToConsole("DinosaurModeManager not initialized with CameraManager.", "error");
        return;
    }
    if (isDinosaurModeActive) {
        logToConsole("Dinosaur mode already active.", "warn");
        return;
    }

    logToConsole(`Activating Dinosaur Mode for shot: ${shotData.name}`, "info");

    const videoElement = cameraManager.getVideoElement('Camera_1'); // Hardcoded for now as per request
    const outputElement = document.getElementById('dinosaur-game-output');
    const cameraGridElement = document.getElementById('camera-grid');

    if (!videoElement) {
        logToConsole("Could not find video element for Camera_1.", "error");
        return;
    }
    if (!outputElement) {
        logToConsole("Could not find dinosaur-game-output element.", "error");
        return;
    }
    if (!cameraGridElement) {
        logToConsole("Could not find camera-grid element.", "warn");
        // Continue activation even if camera grid isn't found?
    }

    // Prepare UI
    outputElement.style.display = 'block'; // Or 'flex', 'grid' depending on desired layout
    if (cameraGridElement) {
        cameraGridElement.style.display = 'none';
    }

    isDinosaurModeActive = true;

    try {
        // Dynamically import the script
        // Note: Dynamic import() returns a promise resolving to the module namespace object.
        // The dinosaur game script MUST export the functions we need (e.g., init, cleanup).
        dinosaurGameModule = await import(DINOSAUR_GAME_SCRIPT_PATH);

        if (dinosaurGameModule && typeof dinosaurGameModule.init === 'function') {
            logToConsole("Dinosaur game script loaded. Initializing...", "info");
            // Call the init function exported by the dinosaur game script
            dinosaurGameModule.init(videoElement, outputElement);
            logToConsole("Dinosaur game initialized.", "success");
        } else {
            throw new Error('Dinosaur game script loaded, but `init` function not found or not exported.');
        }
    } catch (error) {
        logToConsole(`Failed to load or initialize dinosaur game script: ${error}`, "error");
        isDinosaurModeActive = false; // Reset state on failure
        // Reset UI? Maybe call deactivate?
        deactivate(); // Attempt to clean up UI on error
    }
}

/**
 * Deactivates the Dinosaur Game mode.
 * Cleans up UI and calls the game script's cleanup function.
 */
function deactivate() {
    if (!isDinosaurModeActive) {
        return; // Not active, nothing to do
    }
    logToConsole("Deactivating Dinosaur Mode.", "info");

    const outputElement = document.getElementById('dinosaur-game-output');
    const cameraGridElement = document.getElementById('camera-grid');

    if (outputElement) {
        outputElement.style.display = 'none';
        // Optional: Clear the content if the game script doesn't do it
        // outputElement.innerHTML = ''; 
    }
    if (cameraGridElement) {
        cameraGridElement.style.display = 'grid'; // Or 'flex', restore original display property
    }

    // Call cleanup function in the loaded module if it exists
    if (dinosaurGameModule && typeof dinosaurGameModule.cleanup === 'function') {
        try {
            logToConsole("Calling dinosaur game cleanup...", "info");
            dinosaurGameModule.cleanup();
        } catch (error) {
            logToConsole(`Error during dinosaur game cleanup: ${error}`, "error");
        }
    }

    dinosaurGameModule = null; // Release reference
    isDinosaurModeActive = false;
}

// Export the public functions
export const dinosaurModeManager = {
    init,
    activate,
    deactivate
}; 