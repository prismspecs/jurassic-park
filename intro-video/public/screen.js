console.log("screen.js loaded");
const socket = io();

const videoPlayer = document.getElementById('videoPlayer');
// Also remove webcamVideo reference as it's not being used anymore
// const webcamVideo = document.getElementById('webcamVideo');
const faceOverlay = document.getElementById('faceOverlay');
const faceCanvas = document.getElementById('faceCanvas');
// Remove toggle button reference
// const toggleFaceOverlayButton = document.getElementById('toggleFaceOverlayButton');
// Remove startButton reference
// const startButton = document.getElementById('startButton');

const faceApiModelsPath = '/weights';
let faceDetectionInterval;
let showFaceIntervals = [
    { start: 1, end: 35 },
    { start: 85, end: 90 }, // 1:25 to 1:30
    { start: 128, end: 142 } // 2:08 to 2:22
];
let currentFaceInterval = null;
let isOverlayForcedVisible = false; // Flag to track manual toggle state
let isControlPanelWebcamReady = false; // Flag to track if control panel webcam is ready
let latestFrameDataUrl = null; // Store the latest frame data URL
let currentFaceBox = null; // Store the current detected face box
let frameCounter = 0;
const DETECTION_INTERVAL = 15; // Run detection every 15 frames (about 3 times per second with 5 FPS)
let lastFaceSwitchTime = 0; // Track when we last switched faces
const FACE_SWITCH_INTERVAL = 1000; // Switch faces every 1000ms (1 second)
let allDetectedFaces = []; // Store all detected faces

// --- Face Detection Setup ---
async function loadModels() {
    console.log("Loading face-api models from:", faceApiModelsPath);
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(faceApiModelsPath);
        console.log("Models loaded successfully.");
        // If video is already playing when models finish loading, start detection
        if (!videoPlayer.paused && isControlPanelWebcamReady) {
            console.log("Models loaded after video started playing, starting detection now.");
            startFaceDetection();
        }
    } catch (error) {
        console.error("Error loading face-api models:", error);
    }
}

// --- Webcam Setup (Keep for processing, element is hidden) ---
// async function setupWebcam() { ... }

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
    if (!faceapi.nets.tinyFaceDetector.params) {
        console.log("Detection check: Models not ready yet.");
        return;
    }

    try {
        // Use latest frame data URL directly for detection if available
        if (latestFrameDataUrl) {
            // Create an image element for detection
            const img = new Image();
            img.src = latestFrameDataUrl;
            
            // Wait for image to load
            await new Promise(resolve => {
                img.onload = resolve;
            });
            
            // Use a lower threshold to increase detection chances
            const detectionOptions = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.1 });
            const detections = await faceapi.detectAllFaces(img, detectionOptions);
            console.log(`Detected ${detections.length} faces.`);
            
            // Store all detected faces
            allDetectedFaces = detections.map(detection => detection.box);
            
            // Should we show a face? Either we're in an interval or forced visible
            const shouldShowFace = (currentFaceInterval !== null) || isOverlayForcedVisible;
            
            if (allDetectedFaces.length > 0 && shouldShowFace) {
                // If we don't have a current face or it's time to switch, pick a new one
                const now = Date.now();
                if (currentFaceBox === null || (allDetectedFaces.length > 1 && now - lastFaceSwitchTime > FACE_SWITCH_INTERVAL)) {
                    const randomIndex = Math.floor(Math.random() * allDetectedFaces.length);
                    currentFaceBox = allDetectedFaces[randomIndex];
                    lastFaceSwitchTime = now;
                    console.log(`Switched to face ${randomIndex + 1} of ${allDetectedFaces.length}`);
                }
                
                // Don't draw here - we'll draw in the updateFaceDisplay function
                // that runs on every frame update
                faceOverlay.style.display = 'flex';
            } else if (faceOverlay.style.display !== 'none' && !isOverlayForcedVisible) {
                // Hide overlay only if not forced visible
                currentFaceBox = null; // Clear the current face box
                faceOverlay.style.display = 'none';
                console.log(`Hiding face overlay. Detected faces: ${allDetectedFaces.length}, In interval: ${currentFaceInterval !== null}`);
            }
        } else {
            console.log("No frame data available yet.");
        }
    } catch (err) {
        console.error("Face detection error:", err);
    }
}

// New function to update face display with latest frame
function updateFaceDisplay() {
    // Only update if we have a face box and frame data
    if (currentFaceBox && latestFrameDataUrl && faceOverlay.style.display !== 'none') {
        const img = new Image();
        img.onload = () => {
            const faceCtx = faceCanvas.getContext('2d');
            
            // Ensure canvas size matches video player size dynamically
            if (faceCanvas.width !== videoPlayer.clientWidth || faceCanvas.height !== videoPlayer.clientHeight) {
                faceCanvas.width = videoPlayer.clientWidth;
                faceCanvas.height = videoPlayer.clientHeight;
            }
            
            faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
            
            // Calculate scaling to fill the canvas - we'll use the larger dimension
            // to ensure face completely fills the screen
            const scaleWidth = faceCanvas.width / currentFaceBox.width;
            const scaleHeight = faceCanvas.height / currentFaceBox.height;
            
            // Use the larger scale factor to ensure the face fills the entire canvas
            const scaleFactor = Math.max(scaleWidth, scaleHeight) * 1.2; // Add 20% extra zoom for more dramatic effect
            
            // Calculate dimensions
            const drawWidth = currentFaceBox.width * scaleFactor;
            const drawHeight = currentFaceBox.height * scaleFactor;
            
            // Center the face in the canvas
            const drawX = (faceCanvas.width - drawWidth) / 2;
            const drawY = (faceCanvas.height - drawHeight) / 2;
            
            // Draw the face with nice smooth scaling
            faceCtx.imageSmoothingEnabled = true;
            faceCtx.imageSmoothingQuality = 'high';
            
            // Draw from the latest image instead of a saved one
            faceCtx.drawImage(
                img,
                currentFaceBox.x, currentFaceBox.y, 
                currentFaceBox.width, currentFaceBox.height,  // Source rectangle
                drawX, drawY, drawWidth, drawHeight           // Destination rectangle
            );
            
            // Apply a subtle vignette effect
            const gradient = faceCtx.createRadialGradient(
                faceCanvas.width / 2, faceCanvas.height / 2, faceCanvas.height * 0.3,
                faceCanvas.width / 2, faceCanvas.height / 2, faceCanvas.height * 0.7
            );
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(1, 'rgba(0,0,0,0.7)');
            
            faceCtx.fillStyle = gradient;
            faceCtx.globalCompositeOperation = 'source-over';
            faceCtx.fillRect(0, 0, faceCanvas.width, faceCanvas.height);
        };
        
        // Set the source to the latest frame
        img.src = latestFrameDataUrl;
    }
}

// Function to update webcam preview from received frame
function updateWebcamPreview(frameDataUrl) {
    // Update latest frame data URL
    latestFrameDataUrl = frameDataUrl;
    
    // Update the face display with the new frame
    updateFaceDisplay();
    
    // Display the frame in the faceIndicator element 
    const faceIndicator = document.getElementById('faceIndicator');
    if (faceIndicator) {
        faceIndicator.style.backgroundImage = `url(${frameDataUrl})`;
        faceIndicator.style.backgroundSize = 'cover';
        faceIndicator.style.backgroundPosition = 'center';
        
        // Clear any text in the indicator
        faceIndicator.innerHTML = '';
    }
}

// --- Video Playback Logic (Keep as is) ---
function checkFaceOverlayTime() {
    const currentTime = videoPlayer.currentTime;
    let shouldShowFace = false;
    let previousInterval = currentFaceInterval;
    currentFaceInterval = null;

    for (const interval of showFaceIntervals) {
        if (currentTime >= interval.start && currentTime <= interval.end) {
            shouldShowFace = true;
            currentFaceInterval = interval;
            break;
        }
    }

    // Log when we enter or exit an interval
    if (previousInterval === null && currentFaceInterval !== null) {
        console.log(`Entered face interval: ${currentFaceInterval.start}s to ${currentFaceInterval.end}s`);
    } else if (previousInterval !== null && currentFaceInterval === null) {
        console.log('Exited face interval');
    }

    // If we're in an interval but not showing a face yet, trigger face detection
    if (shouldShowFace && faceOverlay.style.display === 'none' && !isOverlayForcedVisible) {
        console.log('In face interval - attempting immediate detection');
        detectFaces(); // Try to detect and show face immediately
    }
    
    // If we're not in an interval and the overlay is visible (and not forced)
    if (!shouldShowFace && faceOverlay.style.display !== 'none' && !isOverlayForcedVisible) {
        faceOverlay.style.display = 'none';
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
    // Ensure face detection starts only when video plays
    if (isControlPanelWebcamReady && faceapi.nets.tinyFaceDetector.params) {
        console.log("Webcam ready and models loaded, starting detection.");
        startFaceDetection();
    } else if (!isControlPanelWebcamReady) {
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
    
    // Wait for webcam to be ready on control panel
    if (!isControlPanelWebcamReady) {
        console.log("Waiting for control panel webcam to be ready...");
        // Will proceed when webcamReady event is received
        return;
    }
    
    // Load models first
    await loadModels();
    // Then play the video
    console.log("Attempting to play video...");
    videoPlayer.play().catch(e => console.error("Error playing video on screen:", e));
    // Face detection will start via the 'play' event listener or the loadModels callback.
});

// Add listener for webcam ready on control panel
socket.on('webcamReady', () => {
    console.log('Control panel webcam is ready');
    isControlPanelWebcamReady = true;
    
    // If loadModels has been called but video hasn't started, start it now
    if (faceapi.nets.tinyFaceDetector.params && videoPlayer.paused) {
        console.log("Starting video now that webcam is ready");
        videoPlayer.play().catch(e => console.error("Error playing video after webcam ready:", e));
    }
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

// Initial setup
faceOverlay.style.display = 'none';
console.log("Waiting for control panel to set up webcam...");

socket.on('webcamFrame', (frameDataUrl) => {
    // Don't log this to prevent console spam
    updateWebcamPreview(frameDataUrl);
    
    // Increment frame counter
    frameCounter++;
    
    // Run face detection periodically even if not in an interval
    // This helps ensure we have an updated face position 
    if (frameCounter % DETECTION_INTERVAL === 0) {
        // Only trigger detection if in an interval or overlay is forced visible
        if (currentFaceInterval !== null || isOverlayForcedVisible) {
            detectFaces();
        }
    }
});
