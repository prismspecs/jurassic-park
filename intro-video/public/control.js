console.log("control.js loaded");
const socket = io();

// Restore webcam references
const webcamVideo = document.getElementById('webcamVideo');
const startButton = document.getElementById('startButton');
// Remove toggleFaceOverlayButton reference
// const toggleFaceOverlayButton = document.getElementById('toggleFaceOverlayButton');
const togglePreviewButton = document.getElementById('togglePreviewButton');
const resyncButton = document.getElementById('resyncButton');
// Add new UI element references
const webcamSelect = document.getElementById('webcamSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const qualitySelect = document.getElementById('qualitySelect');
const applySettingsButton = document.getElementById('applySettingsButton');
const facePaddingSlider = document.getElementById('facePaddingSlider');
const facePaddingValueSpan = document.getElementById('facePaddingValue');

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
    // Check readyState first
    if (webcamVideo.readyState < webcamVideo.HAVE_METADATA) { // Use HAVE_METADATA (2) or higher
        // console.warn("Webcam not ready enough to capture frame (readyState: " + webcamVideo.readyState + ")");
        return;
    }

    // Ensure video dimensions are available and positive
    if (!webcamVideo.videoWidth || !webcamVideo.videoHeight) {
        console.warn("Video dimensions not available yet, skipping frame capture.");
        return;
    }

    // Set canvas size to match webcam if needed
    if (captureCanvas.width !== webcamVideo.videoWidth ||
        captureCanvas.height !== webcamVideo.videoHeight) {
        console.log(`Adjusting canvas size to ${webcamVideo.videoWidth}x${webcamVideo.videoHeight}`);
        captureCanvas.width = webcamVideo.videoWidth;
        captureCanvas.height = webcamVideo.videoHeight;
    }

    // Double-check canvas dimensions are valid after setting
    if (!captureCanvas.width || !captureCanvas.height) {
        console.warn("Canvas dimensions are zero after attempting resize, skipping frame capture.");
        return;
    }

    try {
        // Draw the current frame to canvas
        captureContext.drawImage(webcamVideo, 0, 0, captureCanvas.width, captureCanvas.height);

        // Get frame as data URL with selected quality
        const quality = getSelectedQuality();
        const frameDataUrl = captureCanvas.toDataURL('image/jpeg', quality);

        // Send to server
        socket.emit('webcamFrame', frameDataUrl);
    } catch (e) {
        console.error("Error capturing or sending frame:", e);
        // Consider stopping transmission if errors persist
        // stopFrameTransmission(); 
    }
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
    console.log(`Attempting to setup webcam. Device: ${deviceId}, Resolution: ${resolution ? resolution.width + 'x' + resolution.height : 'default'}`);

    // Stop any existing stream
    if (currentStream) {
        console.log("Stopping existing stream.");
        currentStream.getTracks().forEach(track => track.stop());
        webcamVideo.srcObject = null;
    }

    // Stop any existing frame transmission
    stopFrameTransmission();

    // Build constraints object
    const constraints = {
        video: {}
    };
    if (deviceId) {
        constraints.video.deviceId = { exact: deviceId };
    }
    if (resolution) {
        constraints.video.width = { ideal: resolution.width };
        constraints.video.height = { ideal: resolution.height };
    }
    console.log("Using webcam constraints:", JSON.stringify(constraints));

    try {
        console.log("Calling getUserMedia...");
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("getUserMedia successful. Stream ID:", stream.id);
        currentStream = stream;
        webcamVideo.srcObject = stream;
        console.log("webcamVideo.srcObject assigned.");

        // Try explicitly playing the video as autoplay might be restricted
        console.log("Attempting to play webcam video element...");
        await webcamVideo.play();
        console.log("webcamVideo.play() promise resolved.");

        // Set up metadata loaded handler
        webcamVideo.onloadedmetadata = () => {
            console.log(`Webcam metadata loaded. Resolution: ${webcamVideo.videoWidth}x${webcamVideo.videoHeight}`);
            startFrameTransmission(); // Start transmission after metadata loaded
            console.log("Emitting webcamReady event AFTER metadata loaded and transmission started.");
            socket.emit('webcamReady'); // Notify screen page *NOW*
        };

        // For cases where the metadata might already be loaded
        if (webcamVideo.readyState >= 2) { // HAVE_CURRENT_DATA or higher
            console.log("Webcam already has metadata, starting transmission immediately");
            startFrameTransmission();
            socket.emit('webcamReady');
        }

        webcamVideo.onerror = (e) => {
            console.error("Error on webcamVideo element:", e);
        };

    } catch (err) {
        console.error("Error accessing webcam in setupWebcam:", err.name, err.message, err);
        alert(`Could not access webcam: ${err.message}. Please ensure permissions are granted and the device is not in use.`);
        // Clear stream if failed
        currentStream = null;
        webcamVideo.srcObject = null;
    }
}

// --- Event Listeners ---
startButton.addEventListener('click', () => {
    console.log('Start button clicked on control panel');
    // Request server to start video on screen
    socket.emit('startVideo');
});

// Remove listener for the toggle face overlay button
/*
toggleFaceOverlayButton.addEventListener('click', () => {
    console.log('Toggle Face Overlay button clicked on control panel');
    socket.emit('toggleFaceOverlay');
});
*/

// Add listener for the preview toggle button
togglePreviewButton.addEventListener('click', () => {
    console.log('Toggle Preview button clicked on control panel');
    // Toggle button text between "Show Preview" and "Hide Preview"
    const isShowing = togglePreviewButton.textContent === 'Hide Preview';
    togglePreviewButton.textContent = isShowing ? 'Show Preview' : 'Hide Preview';
    socket.emit('togglePreview', { show: !isShowing });
});

// Add listener for the resync button
resyncButton.addEventListener('click', () => {
    console.log('Resync button clicked on control panel');
    // Notify the screen page that the webcam is ready (forced resync)
    socket.emit('webcamReady');
    // Briefly change button text to provide feedback
    const originalText = resyncButton.textContent;
    resyncButton.textContent = 'Resync Sent!';
    setTimeout(() => {
        resyncButton.textContent = originalText;
    }, 2000);
});

// Add apply settings button listener
applySettingsButton.addEventListener('click', async () => {
    const deviceId = webcamSelect.value;
    const resolution = getSelectedResolution();

    console.log(`Applying settings - Device: ${deviceId}, Resolution: ${resolution.width}x${resolution.height}`);
    await setupWebcam(deviceId, resolution);
});

// Event listener for the face padding slider
facePaddingSlider.addEventListener('input', () => {
    const paddingValue = facePaddingSlider.value;
    facePaddingValueSpan.textContent = paddingValue;
    socket.emit('setFacePadding', parseInt(paddingValue, 10)); // Send padding value to server
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
        // Also send webcamReady signal when reconnecting with active stream
        socket.emit('webcamReady');
    }
});

// Modified initial setup to populate device list first and automatically setup webcam
(async function init() {
    console.log("Control panel init started.");
    try {
        console.log("Requesting initial permissions...");
        // Ensure we have permission before listing devices to get labels
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
        console.log("Initial permissions granted.");
        initialStream.getTracks().forEach(track => track.stop());
        console.log("Initial stream stopped.");

        console.log("Listing webcam devices...");
        await listWebcamDevices();
        console.log("Webcam devices listed.");

        // Check if any devices were found
        if (webcamSelect.value) {
            const deviceId = webcamSelect.value;
            const resolution = getSelectedResolution();
            console.log(`Auto-initializing webcam with Device ID: ${deviceId}, Resolution: ${resolution.width}x${resolution.height}`);
            await setupWebcam(deviceId, resolution);
            console.log("Initial webcam setup completed automatically.");
        } else {
            console.warn("No webcam devices found or selected. Skipping initial setupWebcam call.");
            alert("No webcam devices found. Please connect a camera and reload.");
        }

    } catch (err) {
        console.error("Error during initialization:", err.name, err.message, err);
        alert(`Initialization failed: ${err.message}. Please ensure permissions are granted and reload.`);
    }
    console.log("Control panel init finished.");
})();
