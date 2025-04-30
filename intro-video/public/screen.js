console.log("screen.js loaded");
const socket = io();

const videoPlayer = document.getElementById('videoPlayer');
const webcamVideo = document.getElementById('webcamVideo');
const faceOverlay = document.getElementById('faceOverlay');
const faceCanvas = document.getElementById('faceCanvas');
// Remove toggle button reference
// const toggleFaceOverlayButton = document.getElementById('toggleFaceOverlayButton');
// Remove startButton reference
// const startButton = document.getElementById('startButton');

const faceApiModelsPath = '/weights';
let faceDetectionInterval;
let showFaceIntervals = [
    { start: 1, end: 79 },
    { start: 85, end: 90 }, // 1:25 to 1:30
    { start: 128, end: 142 } // 2:08 to 2:22
];
let currentFaceInterval = null;
let isOverlayForcedVisible = false; // Flag to track manual toggle state
let isSettingUpWebcam = false; // Flag to prevent concurrent setup calls
let debugInfo = document.getElementById('debugInfo');
let detectFaceButton = document.getElementById('detectFaceButton');
let toggleDebugButton = document.getElementById('toggleDebugButton');

// --- Face Detection Setup ---
async function loadModels() {
    console.log("Loading face-api models from:", faceApiModelsPath);
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(faceApiModelsPath);
        console.log("Models loaded successfully.");
        // If video is already playing when models finish loading, start detection
        if (!videoPlayer.paused && webcamVideo.srcObject) {
            console.log("Models loaded after video started playing, starting detection now.");
            startFaceDetection();
        }
    } catch (error) {
        console.error("Error loading face-api models:", error);
    }
}

// --- Webcam Setup (Keep for processing, element is hidden) ---
async function setupWebcam() {
    if (isSettingUpWebcam) {
        console.log("Webcam setup already in progress. Skipping.");
        return;
    }
    isSettingUpWebcam = true;
    console.log("Setting up hidden webcam for processing...");
    console.time('getUserMedia'); // Start timer
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        console.timeEnd('getUserMedia'); // End timer and log duration
        webcamVideo.srcObject = stream;
        console.log("Webcam stream acquired.");
        webcamVideo.onloadedmetadata = () => {
            console.log("Webcam metadata loaded. Ready for face detection when video plays.");
            // Log the actual resolution
            console.log(`Webcam resolution: ${webcamVideo.videoWidth}x${webcamVideo.videoHeight}`); 
            // Check if video is playing and models are loaded, then start detection
            if (!videoPlayer.paused && faceapi.nets.tinyFaceDetector.params) {
                console.log("Webcam ready after video started playing and models loaded. Starting detection now.");
                startFaceDetection();
            }
            // Don't start detection here, wait for video play
            // startFaceDetection();
        };
    } catch (err) {
        console.error("Error accessing webcam:", err);
        console.timeEnd('getUserMedia'); // Ensure timer ends on error too
        // Don't alert on the screen page
        // alert("Could not access webcam. Please ensure permissions are granted.");
    } finally {
        isSettingUpWebcam = false; // Reset flag when done
    }
}

// --- Face Detection Logic (Keep as is) ---
async function startFaceDetection() {
    if (faceDetectionInterval) {
        console.log("Clearing existing face detection interval.");
        clearInterval(faceDetectionInterval);
    }
    console.log("Starting face detection interval.");

    faceDetectionInterval = setInterval(async () => {
        detectFaces();
    }, 100);
}

// Separate function for the actual face detection to allow manual triggering
async function detectFaces() {
    // Ensure models are loaded before trying to use them
    if (webcamVideo.paused || webcamVideo.ended) {
        // console.log("Detection check: Webcam paused or ended.");
        return;
    }
    if (!faceapi.nets.tinyFaceDetector.params) {
        console.log("Detection check: Models not ready yet.");
        return;
    }

    console.log("Attempting face detection..."); // Uncomment this line
    
    try {
        const detectionOptions = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.1 }); // Even lower threshold
        const detections = await faceapi.detectAllFaces(webcamVideo, detectionOptions);
        console.log(`Detected ${detections.length} faces.`);
        
        // Update debug info
        if (debugInfo.style.display !== 'none') {
            debugInfo.innerHTML = `
                <div>Timestamp: ${new Date().toLocaleTimeString()}</div>
                <div>Detected Faces: ${detections.length}</div>
                <div>Options: ${JSON.stringify(detectionOptions)}</div>
                <div>Webcam: ${webcamVideo.videoWidth}x${webcamVideo.videoHeight}</div>
                <div>Raw data: ${JSON.stringify(detections)}</div>
            `;
        }

        if (detections.length > 0 && currentFaceInterval) {
            console.log(`Face detected within interval [${currentFaceInterval.start}-${currentFaceInterval.end}]. Drawing overlay.`);
            const randomIndex = Math.floor(Math.random() * detections.length);
            const detection = detections[randomIndex];
            const box = detection.box;

            const faceCtx = faceCanvas.getContext('2d');
            const scaleFactor = 2;
            const drawWidth = box.width * scaleFactor;
            const drawHeight = box.height * scaleFactor;
            const drawX = (faceCanvas.width - drawWidth) / 2;
            const drawY = (faceCanvas.height - drawHeight) / 2;

            // Ensure canvas size matches video player size dynamically
            if (faceCanvas.width !== videoPlayer.clientWidth || faceCanvas.height !== videoPlayer.clientHeight) {
                faceCanvas.width = videoPlayer.clientWidth;
                faceCanvas.height = videoPlayer.clientHeight;
            }

            faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
            faceCtx.drawImage(
                webcamVideo,
                box.x, box.y, box.width, box.height,
                drawX, drawY, drawWidth, drawHeight
            );
            faceOverlay.style.display = 'flex';
        } else if (currentFaceInterval && detections.length === 0) {
            console.log("Inside interval, but no face detected.");
            if (!isOverlayForcedVisible) { // Check flag before hiding
                faceOverlay.style.display = 'none'; // Hide if no face detected within interval
            }
        } else if (!currentFaceInterval && faceOverlay.style.display !== 'none') {
            console.log("Outside interval, hiding overlay.");
            if (!isOverlayForcedVisible) { // Check flag before hiding
                faceOverlay.style.display = 'none';
            }
        }
    } catch (err) {
        console.error("Face detection error:", err);
        if (debugInfo.style.display !== 'none') {
            debugInfo.innerHTML += `<div style="color:red">Error: ${err.message}</div>`;
        }
    }
}

// --- Video Playback Logic (Keep as is) ---
function checkFaceOverlayTime() {
    const currentTime = videoPlayer.currentTime;
    let shouldShowFace = false;

    for (const interval of showFaceIntervals) {
        if (currentTime >= interval.start && currentTime <= interval.end) {
            shouldShowFace = true;
            currentFaceInterval = interval;
            break;
        }
    }

    if (!shouldShowFace) {
        currentFaceInterval = null;
        if (faceOverlay.style.display !== 'none') {
            if (!isOverlayForcedVisible) { // Check flag before hiding
                faceOverlay.style.display = 'none';
            }
        }
    }
}

// --- Event Listeners ---
// Remove listener for the toggle button
/*
toggleFaceOverlayButton.addEventListener('click', () => {
    if (faceOverlay.style.display === 'none') {
        console.log('Debug: Forcing face overlay ON');
        faceOverlay.style.display = 'flex'; // Or the display value used when visible
    } else {
        console.log('Debug: Forcing face overlay OFF');
        faceOverlay.style.display = 'none';
    }
});
*/

// Remove startButton listener
// startButton.addEventListener('click', () => { ... });

videoPlayer.addEventListener('timeupdate', checkFaceOverlayTime);

videoPlayer.addEventListener('play', () => {
    console.log("Video play event triggered on screen");
    // Ensure face detection starts only when video plays and webcam is ready and models are loaded
    if (webcamVideo.srcObject && faceapi.nets.tinyFaceDetector.params) {
        console.log("Webcam ready and models loaded, starting detection.");
        startFaceDetection();
    } else if (!webcamVideo.srcObject) {
        console.log("Play event: Webcam not ready yet.");
    } else {
        console.log("Play event: Models not loaded yet. Detection will start once models load.");
    }
});

videoPlayer.addEventListener('pause', () => {
    console.log("Video paused on screen");
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    if (!isOverlayForcedVisible) { // Check flag before hiding
        faceOverlay.style.display = 'none';
    }
});

videoPlayer.addEventListener('ended', () => {
    console.log("Video ended on screen");
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    if (!isOverlayForcedVisible) { // Check flag before hiding
        faceOverlay.style.display = 'none';
    }
});

// Socket.IO listeners
socket.on('playVideoOnScreen', async () => {
    console.log('Received request to play video on screen.');
    // Ensure webcam is ready before loading models and playing
    if (!webcamVideo.srcObject && !isSettingUpWebcam) { // Check flag
        console.log("Waiting for webcam setup before proceeding...");
        await setupWebcam(); // Make sure webcam is set up
    } else if (isSettingUpWebcam) {
        console.log("Webcam setup is in progress, will play after it completes (if needed).");
        // We might need a more robust way to queue the play action here
        // For now, just log. The user might need to click start again if setup finishes
        // before the play event listener is ready.
    }
    // Load models first
    await loadModels();
    // Then play the video
    console.log("Attempting to play video...");
    videoPlayer.play().catch(e => console.error("Error playing video on screen:", e));
    // Face detection will start via the 'play' event listener or the loadModels callback.
});

// Add listener for toggle command from server
socket.on('toggleFaceOverlay', () => {
    if (faceOverlay.style.display === 'none') {
        console.log('Received toggle command: Forcing face overlay ON');
        faceOverlay.style.display = 'flex';
        isOverlayForcedVisible = true;
    } else {
        console.log('Received toggle command: Forcing face overlay OFF');
        faceOverlay.style.display = 'none';
        isOverlayForcedVisible = false;
        // Re-run time check in case it should be on due to video time
        checkFaceOverlayTime(); 
    }
});

// Add button event listeners
detectFaceButton.addEventListener('click', () => {
    console.log("Manual face detection triggered");
    detectFaces();
});

toggleDebugButton.addEventListener('click', () => {
    if (debugInfo.style.display === 'none') {
        debugInfo.style.display = 'block';
    } else {
        debugInfo.style.display = 'none';
    }
});

// Initial setup
faceOverlay.style.display = 'none';
if (!isSettingUpWebcam) { // Check flag
    setupWebcam(); // Setup hidden webcam on load
}
