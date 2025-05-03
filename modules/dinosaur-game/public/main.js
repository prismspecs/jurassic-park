// Example usage script for the DinosaurGame module

// Import the main game class from the module entry point
// Adjust the path based on your server setup (e.g., using a bundler or direct path)
// Assuming direct path relative to index.html
import { DinosaurGame } from '../index.js'; 

// --- Get UI Elements ---
const scoreElement = document.getElementById('score');
const statusElement = document.getElementById('status');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const changeMaskButton = document.getElementById('change-mask-button');
const loadingElement = document.getElementById('loading');
const mainElement = document.getElementById('main');
// const fullscreenButton = document.getElementById('fullscreen-btn'); // If needed
// const canvasContainer = document.querySelector('.canvas-container'); // If needed

// --- Configuration for the Game Instance ---

// Callback to update the score UI
function updateScoreUI(score) {
    if (scoreElement) {
        scoreElement.textContent = `Score: ${score.toFixed(1)}%`;
    }
}

// Callback to update the status UI and button states
function updateStatusUI(gameState, errorMessage) {
    if (!statusElement || !startButton || !stopButton) return;

    let statusText = 'Unknown';
    let startEnabled = false;
    let stopEnabled = false;

    switch (gameState) {
        case 'initializing':
            statusText = `Initializing... ${errorMessage || ''}`;
            break;
        case 'ready':
            statusText = 'Ready to start!';
            startEnabled = true;
            break;
        case 'running':
            statusText = 'Running...';
            stopEnabled = true;
            break;
        case 'stopped':
            statusText = 'Stopped.';
            startEnabled = true; // Allow restarting
            break;
        case 'error':
            statusText = `Error: ${errorMessage || 'An unknown error occurred.'}`;
            // Depending on the error, might allow retry (start)
            startEnabled = false; // Safer default
            break;
        default:
            statusText = `Unknown state: ${gameState}`;
    }

    statusElement.textContent = statusText;
    startButton.disabled = !startEnabled;
    stopButton.disabled = !stopEnabled;

    // Show/hide loading indicator
    if (loadingElement && mainElement) {
        if (gameState === 'initializing' || gameState === 'error') {
             loadingElement.textContent = statusText; // Display status in loading div
             loadingElement.style.display = 'block';
             mainElement.style.display = 'none';
        } else {
            loadingElement.style.display = 'none';
            mainElement.style.display = 'block'; // Or your main game container
        }
    }
}

// Define the game configuration
const gameConfig = {
    webcamElementId: 'webcam', // ID of the video element for webcam
    outputCanvasId: 'output', // ID of the canvas for drawing (This ID doesn't exist in index.html, should it be base-canvas or another?)
    // ****** IMPORTANT: Update outputCanvasId if 'output' is not the correct ID in index.html ******
    // Using 'base-canvas' for now as it exists.
    // outputCanvasId: 'base-canvas', 
    // Correction: The DinosaurGame class uses *one* output canvas where it draws the final result.
    // The example HTML has multiple canvases. Let's use 'silhouette-canvas' as the target for DinosaurGame output.
    outputCanvasId: 'silhouette-canvas', 
    maskVideoElementId: 'mask-video', // ID for hidden mask video element
    maskVideoSrc: 'videos/walking-longneck.mp4', // Initial mask video path (relative to server root)

    // Provide the callbacks
    scoreUpdateCallback: updateScoreUI,
    gameStateUpdateCallback: updateStatusUI,

    // Optional: Override default configs if needed
    // webcamConfig: {
    //     resolution: '1280x720'
    // },
     drawingConfig: {
         drawSkeletonOverlay: false, // Set to true to see the skeleton
    //     // Example: Change colors
    //     overlapColor: '#00FF00', 
    //     nonOverlapColor: '#FF00FF',
         // Example: Make silhouette thicker
         silhouetteConfig: {
            limbThickness: 30, 
         }
     },
    // posenetModelConfig: {
    //     multiplier: 0.5 // Use a faster model if needed
    // }
};

// --- Initialize Game ---
let game = null;

try {
    game = new DinosaurGame(gameConfig);
} catch (error) {
    console.error("Failed to instantiate DinosaurGame:", error);
    updateStatusUI('error', `Initialization failed: ${error.message}`);
    // Handle critical failure - maybe display a message permanently
    if (loadingElement) loadingElement.textContent = `Error: ${error.message}`; 
    if (mainElement) mainElement.style.display = 'none';
}

// --- Setup and Event Listeners (only if instantiation succeeded) ---
if (game) {
    // Function to run the setup
    async function initializeGame() {
        if (!game) return;
        try {
            await game.setup(); // Loads models, webcam, video
        } catch (error) {
            console.error("Error during game setup:", error);
            // The gameStateUpdateCallback should handle displaying the error
        }
    }

    // Add event listeners to buttons
    startButton?.addEventListener('click', () => {
        if (game) {
            console.log("Start button clicked");
            game.start();
        }
    });

    stopButton?.addEventListener('click', () => {
        if (game) {
            console.log("Stop button clicked");
            game.stop();
        }
    });

    changeMaskButton?.addEventListener('click', () => {
        if (game) {
            console.log("Change Mask button clicked");
            const newVideoSrc = prompt(
                "Enter new mask video path (relative to server root, e.g., videos/new-mask.mp4):", 
                game.config.maskVideoSrc // Show current src as default
            );
            if (newVideoSrc && newVideoSrc !== game.config.maskVideoSrc) {
                try {
                     game.setConfig({ maskVideoSrc: newVideoSrc });
                     // UI state will be updated via gameStateUpdateCallback
                } catch (error) {
                     console.error("Failed to set new mask video config:", error);
                     alert(`Error setting video source: ${error.message}`); // Basic feedback
                }
            }
        }
    });

    // Initialize the game when the page loads
    window.addEventListener('load', initializeGame);

} // end if(game)
