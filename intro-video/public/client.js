const socket = io();

const videoPlayer = document.getElementById('videoPlayer');
const webcamVideo = document.getElementById('webcamVideo');
const faceOverlay = document.getElementById('faceOverlay');
const faceCanvas = document.getElementById('faceCanvas');
const startButton = document.getElementById('startButton');

const faceApiModelsPath = '/weights'; // Update path to load models from the public/weights directory
let faceDetectionInterval;
let showFaceIntervals = [
    { start: 2, end: 11 },
    { start: 85, end: 90 }, // 1:25 to 1:30
    { start: 128, end: 142 } // 2:08 to 2:22
];
let currentFaceInterval = null;

// --- Face Detection Setup ---
async function loadModels() {
    console.log("Loading face-api models from:", faceApiModelsPath); // Log the path
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(faceApiModelsPath);
        // await faceapi.nets.ssdMobilenetv1.loadFromUri(faceApiModelsPath); // Alternative, more accurate but heavier
        console.log("Models loaded.");
        setupWebcam(); // Setup webcam after models are loaded
    } catch (error) {
        console.error("Error loading face-api models:", error);
    }
}

// --- Webcam Setup ---
async function setupWebcam() {
    console.log("Setting up webcam...");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        webcamVideo.srcObject = stream;
        console.log("Webcam setup complete.");
        // Start face detection once webcam is ready
        webcamVideo.onloadedmetadata = () => {
            console.log("Webcam metadata loaded. Starting face detection loop.");
            startFaceDetection();
        };
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Could not access webcam. Please ensure permissions are granted.");
    }
}

// --- Face Detection Logic ---
async function startFaceDetection() {
    if (faceDetectionInterval) clearInterval(faceDetectionInterval); // Clear existing interval if any

    faceDetectionInterval = setInterval(async () => {
        if (webcamVideo.paused || webcamVideo.ended || !faceapi.nets.tinyFaceDetector.params) {
            // console.log("Webcam not ready or models not loaded, skipping detection.");
            return;
        }

        const detections = await faceapi.detectAllFaces(webcamVideo, new faceapi.TinyFaceDetectorOptions());

        if (detections.length > 0 && currentFaceInterval) {
            // Randomly select one detected face
            const randomIndex = Math.floor(Math.random() * detections.length);
            const detection = detections[randomIndex];
            const box = detection.box;

            // Draw the cropped and zoomed face onto the overlay canvas
            const faceCtx = faceCanvas.getContext('2d');
            const scaleFactor = 2; // Zoom factor
            const drawWidth = box.width * scaleFactor;
            const drawHeight = box.height * scaleFactor;
            // Center the zoomed face in the canvas
            const drawX = (faceCanvas.width - drawWidth) / 2;
            const drawY = (faceCanvas.height - drawHeight) / 2;

            faceCanvas.width = videoPlayer.clientWidth; // Match overlay size
            faceCanvas.height = videoPlayer.clientHeight;

            faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height); // Clear previous frame
            faceCtx.drawImage(
                webcamVideo,
                box.x, box.y, box.width, box.height, // Source rectangle (detected face)
                drawX, drawY, drawWidth, drawHeight // Destination rectangle (scaled and centered)
            );
            faceOverlay.style.display = 'flex'; // Show overlay
        } else if (!currentFaceInterval) {
            faceOverlay.style.display = 'none'; // Hide overlay if not in a face interval
        }
    }, 100); // Detect faces roughly 10 times per second
}


// --- Video Playback Logic ---
function checkFaceOverlayTime() {
    const currentTime = videoPlayer.currentTime;
    let shouldShowFace = false;

    for (const interval of showFaceIntervals) {
        if (currentTime >= interval.start && currentTime <= interval.end) {
            shouldShowFace = true;
            currentFaceInterval = interval; // Mark that we are in an interval
            break;
        }
    }

    if (!shouldShowFace) {
        currentFaceInterval = null; // Mark that we are outside any interval
        if (faceOverlay.style.display !== 'none') {
            faceOverlay.style.display = 'none'; // Hide if we just exited an interval
        }
    }
    // Face detection loop will handle showing the overlay when currentFaceInterval is set
}

// --- Event Listeners ---
startButton.addEventListener('click', () => {
    console.log('Start button clicked');
    // Request server to start (optional, could just start client-side)
    socket.emit('startVideo');
    // Start video playback locally
    videoPlayer.play().catch(e => console.error("Error playing video:", e));
    // Load models and setup webcam when video starts
    loadModels();
});

videoPlayer.addEventListener('timeupdate', checkFaceOverlayTime);

videoPlayer.addEventListener('play', () => {
    console.log("Video playing");
    // Ensure face detection is running if webcam is ready
    if (webcamVideo.srcObject) {
        startFaceDetection();
    }
});

videoPlayer.addEventListener('pause', () => {
    console.log("Video paused");
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval); // Stop detection when paused
        faceDetectionInterval = null;
    }
    faceOverlay.style.display = 'none'; // Hide overlay when paused
});

videoPlayer.addEventListener('ended', () => {
    console.log("Video ended");
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval); // Stop detection when ended
        faceDetectionInterval = null;
    }
    faceOverlay.style.display = 'none'; // Hide overlay when ended
});

// Socket.IO listeners (optional for now)
socket.on('videoStarted', () => {
    console.log('Video start acknowledged by server.');
    // Could potentially sync playback across multiple clients here
});

// Initial setup
faceOverlay.style.display = 'none'; // Ensure overlay is hidden initially
