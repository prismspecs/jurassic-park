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
    { start: 1, end: 5 },
    { start: 10, end: 15 }, // 1:25 to 1:30
    { start: 128, end: 142 } // 2:08 to 2:22
];
let currentFaceInterval = null;
let isControlPanelWebcamReady = false; // Flag to track if control panel webcam is ready
let latestFrameDataUrl = null; // Store the latest frame data URL
let currentFaceBox = null; // Store the current detected face box
let frameCounter = 0;
const DETECTION_INTERVAL = 15; // Run detection every 15 frames (about 3 times per second with 5 FPS)
let lastFaceSwitchTime = 0; // Track when we last switched faces
const FACE_SWITCH_INTERVAL = 1000; // Switch faces every 1000ms (1 second)
let allDetectedFaces = []; // Store all detected faces
const FACE_TRACKING_THRESHOLD_PERCENT = 0.3; // Max distance (as % of video width) to consider a face the "same"
let facePaddingPercent = 5; // Default padding percentage

// --- Helper Functions ---
function getBoxCenter(box) {
    return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2
    };
}

function distance(point1, point2) {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// --- Face Detection Setup ---
async function loadModels() {
    console.log("Loading face-api models from:", faceApiModelsPath);
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(faceApiModelsPath);
        console.log("Models loaded successfully.");
        // Try starting video/detection now that models are loaded
        tryStartVideoAndDetection();
    } catch (error) {
        console.error("Error loading face-api models:", error);
    }
}

// Function to potentially start video/detection if ready
function tryStartVideoAndDetection() {
    // Only start detection if video is already playing, do NOT call videoPlayer.play() here
    if (isControlPanelWebcamReady && faceapi.nets.tinyFaceDetector.params && !videoPlayer.paused) {
        console.log("Conditions met (webcam ready, models loaded, video playing), starting detection.");
        startFaceDetection();
    } else {
        console.log("Conditions not yet met for starting detection.");
        if (!isControlPanelWebcamReady) console.log("- Webcam not ready");
        if (!faceapi.nets.tinyFaceDetector.params) console.log("- Models not loaded");
        if (videoPlayer.paused) console.log("- Video is paused");
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
        // Only run detection if we are supposed to be showing a face
        if (currentFaceInterval) {
            detectFaces(); // Update face position
        } else {
            // Explicitly hide overlay if not in an interval
            if (faceOverlay.style.display !== 'none') {
                // console.log('Hiding face overlay (detection interval)'); // Optional: for debugging
                faceOverlay.style.display = 'none';
            }
        }
    }, 100); // Check ~10 times per second
}

// Separate function for the actual face detection to allow manual triggering
async function detectFaces() {
    // Ensure models are loaded before trying to use them
    if (!faceapi.nets.tinyFaceDetector.params || !videoPlayer) {
        // console.log("Detection check: Models not ready or video player not found."); // Less verbose
        return;
    }

    try {
        // Use latest frame data URL directly for detection if available
        if (latestFrameDataUrl) {
            const img = new Image();
            img.src = latestFrameDataUrl;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject; // Add error handling for image load
            });

            const detectionOptions = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.1 });
            const detections = await faceapi.detectAllFaces(img, detectionOptions);
            allDetectedFaces = detections.map(detection => detection.box); // Update all detected faces

            // --- Face Tracking Logic ---
            let trackedFaceBox = null;
            const trackingThreshold = (videoPlayer?.clientWidth || 640) * FACE_TRACKING_THRESHOLD_PERCENT; // Use video width for threshold
            if (currentFaceBox && allDetectedFaces.length > 0) {
                const currentCenter = getBoxCenter(currentFaceBox);
                let closestDistance = Infinity;
                let closestFace = null;

                allDetectedFaces.forEach(box => {
                    const newCenter = getBoxCenter(box);
                    const dist = distance(currentCenter, newCenter);
                    if (dist < closestDistance && dist < trackingThreshold) {
                        closestDistance = dist;
                        closestFace = box;
                    }
                });
                trackedFaceBox = closestFace; // Will be null if no close face found
            }
            // --- End Tracking Logic ---

            const now = Date.now();
            const shouldSwitch = !trackedFaceBox || (allDetectedFaces.length > 1 && now - lastFaceSwitchTime > FACE_SWITCH_INTERVAL);

            if (trackedFaceBox && !shouldSwitch) {
                // Continue tracking the same face
                currentFaceBox = trackedFaceBox;
            } else if (allDetectedFaces.length > 0) {
                // Time to switch or pick a new face
                let faceToSelect = null;
                if (shouldSwitch && allDetectedFaces.length > 1) {
                    const otherFaces = allDetectedFaces.filter(box => box !== trackedFaceBox); // Use trackedFaceBox here
                    faceToSelect = otherFaces.length > 0
                        ? otherFaces[Math.floor(Math.random() * otherFaces.length)]
                        : allDetectedFaces[Math.floor(Math.random() * allDetectedFaces.length)]; // Fallback if only one face or same face is closest
                } else {
                    // Pick any available face if not switching or only one face exists
                    faceToSelect = allDetectedFaces[Math.floor(Math.random() * allDetectedFaces.length)];
                }
                currentFaceBox = faceToSelect;
                lastFaceSwitchTime = now;
            } else {
                // No faces detected at all
                currentFaceBox = null;
            }

            // REMOVED overlay display logic from here

        } else {
            // No frame data available yet
            currentFaceBox = null; // Ensure face box is cleared if no frame data
        }
    } catch (err) {
        console.error("Face detection error:", err);
        currentFaceBox = null; // Clear face on error
        // REMOVED overlay display logic from here
    }
}

// New function to update face display with latest frame
function updateFaceDisplay() {
    // Only update if the overlay is supposed to be visible
    if (faceOverlay.style.display === 'none') {
        return; // Don't draw if overlay is hidden
    }

    // Only draw if we have a face box and frame data
    if (currentFaceBox && latestFrameDataUrl) {
        const img = new Image();
        img.onload = () => {
            // ... existing drawing logic ...
            const faceCtx = faceCanvas.getContext('2d');

            // Ensure canvas size matches video player size dynamically
            if (faceCanvas.width !== videoPlayer.clientWidth || faceCanvas.height !== videoPlayer.clientHeight) {
                faceCanvas.width = videoPlayer.clientWidth;
                faceCanvas.height = videoPlayer.clientHeight;
            }

            faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);

            // --- Calculate expanded source rectangle with dynamic padding ---
            const paddingFactor = facePaddingPercent / 100.0;
            const paddingX = currentFaceBox.width * paddingFactor;
            const paddingY = currentFaceBox.height * paddingFactor;

            let sx = currentFaceBox.x - paddingX;
            let sy = currentFaceBox.y - paddingY;
            let sWidth = currentFaceBox.width + 2 * paddingX;
            let sHeight = currentFaceBox.height + 2 * paddingY;

            // Clamp source rectangle to image bounds
            sx = Math.max(0, sx);
            sy = Math.max(0, sy);
            sWidth = Math.min(img.width - sx, sWidth);
            sHeight = Math.min(img.height - sy, sHeight);
            // --- End source rectangle calculation ---

            // Calculate scaling to fill the canvas based on the *expanded* source dimensions
            const scaleWidth = faceCanvas.width / sWidth;
            const scaleHeight = faceCanvas.height / sHeight;

            // Use the larger scale factor to ensure the expanded face area fills the entire canvas
            const scaleFactor = Math.max(scaleWidth, scaleHeight) * 1.2; // Keep the 20% extra zoom

            // Calculate destination dimensions based on the expanded source and scale factor
            const drawWidth = sWidth * scaleFactor;
            const drawHeight = sHeight * scaleFactor;

            // Center the expanded face area in the canvas
            const drawX = (faceCanvas.width - drawWidth) / 2;
            const drawY = (faceCanvas.height - drawHeight) / 2;

            // Draw the face with nice smooth scaling
            faceCtx.imageSmoothingEnabled = true;
            faceCtx.imageSmoothingQuality = 'high';

            // Draw the expanded source region from the latest image
            faceCtx.drawImage(
                img,
                sx, sy, sWidth, sHeight, // Source rectangle (expanded and clamped)
                drawX, drawY, drawWidth, drawHeight // Destination rectangle
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
            faceCtx.globalCompositeOperation = 'source-over'; // Reset composite operation

        };
        img.onerror = () => {
            console.error("Error loading image for face display:", latestFrameDataUrl);
        };
        // Set the source to the latest frame
        img.src = latestFrameDataUrl;
    } else {
        // If no face box, clear the canvas (optional, but good practice)
        const faceCtx = faceCanvas.getContext('2d');
        faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
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
    currentFaceInterval = null; // Reset before checking

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

    // Directly control overlay visibility based on time interval
    if (shouldShowFace) {
        if (faceOverlay.style.display === 'none') {
            console.log('Showing face overlay (checkFaceOverlayTime)');
            faceOverlay.style.display = 'flex';
            // Optionally trigger an immediate detection when interval starts
            // detectFaces(); 
        }
    } else {
        if (faceOverlay.style.display !== 'none') {
            console.log('Hiding face overlay (checkFaceOverlayTime)');
            faceOverlay.style.display = 'none';
            currentFaceBox = null; // Clear face box when hiding
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
    if (faceOverlay.style.display !== 'none') {
        faceOverlay.style.display = 'none';
    }
});

videoPlayer.addEventListener('ended', () => {
    console.log("Video ended on screen");
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    if (faceOverlay.style.display !== 'none') {
        faceOverlay.style.display = 'none';
    }
});

// Socket.IO listeners
socket.on('playVideoOnScreen', async () => {
    console.log('Received request to play video on screen.');

    // Load models first (if not already loaded)
    if (!faceapi.nets.tinyFaceDetector.params) {
        console.log("Loading models before playing...");
        await loadModels();
    } else {
        console.log("Models already loaded.");
    }

    // Start video playback
    videoPlayer.play().catch(e => console.error("Error playing video:", e));
    // Detection will start via the 'play' event listener
});

// Listen for status update from server on connect or later
socket.on('webcamStatus', (isReady) => {
    console.log(`Received webcamStatus from server: ${isReady}`);
    if (isReady && !isControlPanelWebcamReady) {
        console.log('Setting screen webcam ready state to TRUE based on server status.');
        isControlPanelWebcamReady = true;
        // If models are already loaded and video is paused, try starting now
        tryStartVideoAndDetection();
    }
});

// Add listener for webcam ready broadcast (in case status changes later)
socket.on('webcamReady', () => {
    console.log('Received webcamReady broadcast');
    if (!isControlPanelWebcamReady) {
        console.log('Setting screen webcam ready state to TRUE based on broadcast.');
        isControlPanelWebcamReady = true;
        // If models are already loaded and video is paused, try starting now
        tryStartVideoAndDetection();
    }
});

// Add listener for preview toggle command from server
socket.on('togglePreview', (data) => { // Add data parameter
    const faceIndicator = document.getElementById('faceIndicator');
    if (faceIndicator) {
        // Use the 'show' property from the data to set the display style
        if (data.show) {
            console.log('Received togglePreview command: Showing preview');
            faceIndicator.style.display = 'block'; // Or 'flex', depending on CSS
        } else {
            console.log('Received togglePreview command: Hiding preview');
            faceIndicator.style.display = 'none';
        }
    } else {
        console.error('faceIndicator element not found!');
    }
});

// Initial setup
faceOverlay.style.display = 'none';
// Initialize face-api models
loadModels();

// Check webcam status immediately on connection
socket.on('connect', () => {
    console.log('Screen connected to server, requesting webcam status');
    socket.emit('getWebcamStatus');
});

socket.on('webcamFrame', (frameDataUrl) => {
    // Don't log this to prevent console spam
    updateWebcamPreview(frameDataUrl);

    // Increment frame counter
    frameCounter++;

    // REMOVED periodic detectFaces call from here - it's handled by startFaceDetection interval
    // if (frameCounter % DETECTION_INTERVAL === 0) {
    //     if (currentFaceInterval !== null) {
    //         detectFaces();
    //     }
    // }
});

// Listen for face padding updates
socket.on('setFacePadding', (paddingValue) => {
    console.log(`Screen received face padding update: ${paddingValue}%`);
    facePaddingPercent = paddingValue;
    // No need to redraw immediately, it will be applied on the next updateFaceDisplay call
});