console.log("control.js loaded");
const socket = io();

// Restore webcam references
const webcamVideo = document.getElementById('webcamVideo');
const startButton = document.getElementById('startButton');
const toggleFaceOverlayButton = document.getElementById('toggleFaceOverlayButton');
// Add new UI element references
const webcamSelect = document.getElementById('webcamSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const qualitySelect = document.getElementById('qualitySelect');
const applySettingsButton = document.getElementById('applySettingsButton');

// Add canvas for frame capture
const captureCanvas = document.createElement('canvas');
const captureContext = captureCanvas.getContext('2d');
let frameTransmissionInterval = null;
const FRAME_RATE = 5; // Frames per second to transmit (lower = less bandwidth)

// Current settings
let currentDeviceId = '';
let currentStream = null;

// Parse selected resolution
function getSelectedResolution() {
    const [width, height] = resolutionSelect.value.split('x').map(Number);
    return { width, height };
}

// Get selected quality
function getSelectedQuality() {
    return parseFloat(qualitySelect.value);
}

// Populate webcam device list
async function listWebcamDevices() {
    try {
        // Get list of available media devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Filter to only video input devices (webcams)
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        // Clear the select options
        webcamSelect.innerHTML = '';
        
        if (videoDevices.length === 0) {
            const option = document.createElement('option');
            option.text = 'No cameras found';
            option.value = '';
            webcamSelect.add(option);
        } else {
            // Add each device as an option
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.text = device.label || `Camera ${index + 1}`;
                option.value = device.deviceId;
                webcamSelect.add(option);
                
                // If this is the first device or matches current, select it
                if (index === 0 && !currentDeviceId) {
                    option.selected = true;
                } else if (device.deviceId === currentDeviceId) {
                    option.selected = true;
                }
            });
        }
    } catch (err) {
        console.error("Error listing webcam devices:", err);
        alert("Could not list available cameras. Please ensure permissions are granted.");
    }
}

// Capture and send a frame
function captureAndSendFrame() {
    if (webcamVideo.readyState !== webcamVideo.HAVE_ENOUGH_DATA) {
        return; // Not enough data to capture
    }
    
    // Set canvas size to match webcam
    if (captureCanvas.width !== webcamVideo.videoWidth || 
        captureCanvas.height !== webcamVideo.videoHeight) {
        captureCanvas.width = webcamVideo.videoWidth;
        captureCanvas.height = webcamVideo.videoHeight;
    }
    
    // Draw the current frame to canvas
    captureContext.drawImage(webcamVideo, 0, 0);
    
    // Get frame as data URL with selected quality
    const quality = getSelectedQuality();
    const frameDataUrl = captureCanvas.toDataURL('image/jpeg', quality);
    
    // Send to server
    socket.emit('webcamFrame', frameDataUrl);
}

// Start/stop frame transmission
function startFrameTransmission() {
    if (frameTransmissionInterval) {
        return;
    }
    console.log("Starting webcam frame transmission");
    frameTransmissionInterval = setInterval(captureAndSendFrame, 1000 / FRAME_RATE);
}

function stopFrameTransmission() {
    if (frameTransmissionInterval) {
        console.log("Stopping webcam frame transmission");
        clearInterval(frameTransmissionInterval);
        frameTransmissionInterval = null;
    }
}

// Update webcam setup to support device selection and resolution
async function setupWebcam(deviceId = null, resolution = null) {
    console.log("Setting up webcam for control panel...");
    
    // Stop any existing stream
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        webcamVideo.srcObject = null;
    }
    
    // Stop any existing frame transmission
    stopFrameTransmission();
    
    // Build constraints object
    const constraints = {
        video: {}
    };
    
    // Add deviceId if specified
    if (deviceId) {
        constraints.video.deviceId = { exact: deviceId };
        currentDeviceId = deviceId;
    }
    
    // Add resolution if specified
    if (resolution) {
        constraints.video.width = { ideal: resolution.width };
        constraints.video.height = { ideal: resolution.height };
    }
    
    console.log("Using webcam constraints:", constraints);
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        webcamVideo.srcObject = stream;
        console.log("Webcam setup complete on control panel.");
        
        // Notify the screen page that the webcam is ready on the control panel
        socket.emit('webcamReady');
        
        webcamVideo.onloadedmetadata = () => {
            console.log(`Webcam resolution: ${webcamVideo.videoWidth}x${webcamVideo.videoHeight}`);
            // Start frame transmission after metadata loaded
            startFrameTransmission();
        };
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Could not access webcam. Please ensure permissions are granted.");
    }
}

// --- Event Listeners ---
startButton.addEventListener('click', () => {
    console.log('Start button clicked on control panel');
    // Request server to start video on screen
    socket.emit('startVideo');
});

// Add listener for the toggle button
toggleFaceOverlayButton.addEventListener('click', () => {
    console.log('Toggle Face Overlay button clicked on control panel');
    socket.emit('toggleFaceOverlay');
});

// Add apply settings button listener
applySettingsButton.addEventListener('click', async () => {
    const deviceId = webcamSelect.value;
    const resolution = getSelectedResolution();
    
    console.log(`Applying settings - Device: ${deviceId}, Resolution: ${resolution.width}x${resolution.height}`);
    await setupWebcam(deviceId, resolution);
});

// Socket event listeners
socket.on('disconnect', () => {
    console.log('Disconnected from server, stopping frame transmission');
    stopFrameTransmission();
});

socket.on('connect', () => {
    console.log('Connected to server');
    if (webcamVideo.readyState >= 2) { // HAVE_CURRENT_DATA or higher
        startFrameTransmission();
    }
});

// Modified initial setup to populate device list first
(async function init() {
    // Request camera permissions first to get device labels
    try {
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Stop the initial stream once we have permissions
        initialStream.getTracks().forEach(track => track.stop());
        
        // List available devices
        await listWebcamDevices();
        
        // Setup webcam with default settings
        const deviceId = webcamSelect.value;
        const resolution = getSelectedResolution();
        await setupWebcam(deviceId, resolution);
    } catch (err) {
        console.error("Error during initialization:", err);
        alert("Failed to access webcam. Please ensure permissions are granted and reload the page.");
    }
})();
