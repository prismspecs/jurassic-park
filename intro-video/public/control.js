console.log("control.js loaded");
const socket = io();

// Remove videoPlayer, faceOverlay, faceCanvas references
// const videoPlayer = document.getElementById('videoPlayer');
// const faceOverlay = document.getElementById('faceOverlay');
// const faceCanvas = document.getElementById('faceCanvas');
// Remove webcamVideo reference
// const webcamVideo = document.getElementById('webcamVideo');
const startButton = document.getElementById('startButton');
const toggleFaceOverlayButton = document.getElementById('toggleFaceOverlayButton');

// Remove faceApiModelsPath and related variables
// const faceApiModelsPath = '/weights';
// let faceDetectionInterval;
// let showFaceIntervals = [...];
// let currentFaceInterval = null;

// --- Remove Face Detection Setup ---
// async function loadModels() { ... }

// --- Remove Webcam Setup ---
/*
async function setupWebcam() {
    console.log("Setting up webcam for control panel...");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        webcamVideo.srcObject = stream;
        console.log("Webcam setup complete.");
        // Remove face detection start
        // webcamVideo.onloadedmetadata = () => { ... };
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Could not access webcam. Please ensure permissions are granted.");
    }
}
*/

// --- Remove Face Detection Logic ---
// async function startFaceDetection() { ... }

// --- Remove Video Playback Logic ---
// function checkFaceOverlayTime() { ... }

// --- Event Listeners ---
startButton.addEventListener('click', () => {
    console.log('Start button clicked on control panel');
    // Request server to start video on screen
    socket.emit('startVideo');
    // Remove local video play and model loading
    // videoPlayer.play().catch(e => console.error("Error playing video:", e));
    // loadModels();
});

// Add listener for the toggle button
toggleFaceOverlayButton.addEventListener('click', () => {
    console.log('Toggle Face Overlay button clicked on control panel');
    // We will add socket.emit here
    socket.emit('toggleFaceOverlay'); // Emit event to server
});

// Remove videoPlayer event listeners
// videoPlayer.addEventListener('timeupdate', checkFaceOverlayTime);
// videoPlayer.addEventListener('play', () => { ... });
// videoPlayer.addEventListener('pause', () => { ... });
// videoPlayer.addEventListener('ended', () => { ... });

// Remove Socket.IO listeners for videoStarted
// socket.on('videoStarted', () => { ... });

// Initial setup
// Remove setupWebcam call
// setupWebcam(); 
// faceOverlay.style.display = 'none'; // Remove
