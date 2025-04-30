const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement.getContext('2d');
const loadingElement = document.getElementById('loading');
const mainElement = document.getElementById('main');
const scoreElement = document.getElementById('score');

const maskImage = new Image();
let maskImageData = null;
let poseDetector = null;
let animationFrameId = null;

// Configuration (adjust as needed)
const videoWidth = 640;
const videoHeight = 480;
const maskPath = 'mask.jpg'; // Ensure this file exists in public/
const scoreThreshold = 0.1; // Lower threshold for better detection
const lineWidth = 5; // Adjusted for better visibility
const bodyFillColor = 'rgba(255, 255, 255, 0.8)'; // For drawing body shape
const overlapColor = 'green';
const nonOverlapColor = 'red';

// Define connections between keypoints for drawing lines (using COCO keypoint indices)
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [0, 2], [1, 3], [2, 4],
  // Torso
  [5, 6], [5, 7], [7, 9], [9, 11], [6, 8], [8, 10], [10, 12], [5, 11], [6, 12], [11, 12],
  // Arms
  [5, 13], [13, 15], [15, 17], // Left arm
  [6, 14], [14, 16], [16, 18], // Right arm
  // Legs
  [11, 19], [19, 21], [21, 23], // Left leg
  [12, 20], [20, 22], [22, 24]  // Right leg
];

// --- Helper Functions ---

/**
 * Loads the mask image and extracts its pixel data.
 */
async function loadMask() {
    return new Promise((resolve, reject) => {
        maskImage.onload = () => {
            console.log('Mask image loaded.');
            // Draw mask to a temporary canvas to get its imageData
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = videoWidth;
            tempCanvas.height = videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(maskImage, 0, 0, videoWidth, videoHeight);
            maskImageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight);
            resolve();
        };
        maskImage.onerror = (err) => {
            console.error('Error loading mask image:', err);
            loadingElement.textContent = 'Error loading mask image. Please ensure mask.jpg exists.';
            reject(err);
        };
        maskImage.src = maskPath;
    });
}

/**
 * Sets up the webcam stream.
 */
async function setupWebcam() {
    return new Promise((resolve, reject) => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: { width: videoWidth, height: videoHeight } })
                .then(stream => {
                    videoElement.srcObject = stream;
                    videoElement.addEventListener('loadeddata', () => {
                        console.log('Webcam stream loaded.');
                        resolve();
                    });
                })
                .catch(err => {
                    console.error('Error accessing webcam:', err);
                    loadingElement.textContent = 'Error accessing webcam. Please grant permission.';
                    reject(err);
                });
        } else {
            reject('getUserMedia not supported');
        }
    });
}

/**
 * Loads the TensorFlow.js MoveNet pose detector.
 */
async function loadPoseDetector() {
    try {
        console.log("Initializing TensorFlow.js backend...");
        await tf.setBackend('webgl');
        await tf.ready();
        console.log(`Using TensorFlow.js backend: ${tf.getBackend()}`);
        
        console.log("Loading MoveNet pose detector model...");
        const model = poseDetection.SupportedModels.MoveNet;
        const detectorConfig = {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            enableSmoothing: true
        };
        poseDetector = await poseDetection.createDetector(model, detectorConfig);
        console.log("MoveNet pose detector loaded successfully.");
        return true;
    } catch (err) {
        console.error(`Error loading pose detector: ${err.message}`);
        return false;
    }
}

/**
 * Draws the detected pose skeleton onto the canvas.
 */
function drawBodyShape(pose, ctx) {
    // 1. Draw the webcam video frame
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Optional: Show the mask as a semi-transparent overlay for debugging
    if (maskImage.complete && maskImage.naturalWidth > 0) {
        ctx.globalAlpha = 0.2; // Make it very transparent
        ctx.drawImage(maskImage, 0, 0, canvasElement.width, canvasElement.height);
        ctx.globalAlpha = 1.0; // Reset alpha
    }

    if (!pose || !pose.keypoints) return; // Don't draw skeleton if no pose detected

    const keypoints = pose.keypoints;
    
    // Draw the skeleton with improved visibility
    ctx.strokeStyle = '#FF0000'; // Use bright red for visibility
    ctx.lineWidth = lineWidth; // Use configured line width
    
    // Draw the skeleton connections
    POSE_CONNECTIONS.forEach(([i, j]) => {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];

        // Check if keypoints and their scores are valid
        if (kp1 && kp2 && kp1.score > scoreThreshold && kp2.score > scoreThreshold) {
            // Scale keypoints if necessary
            const scaleX = canvasElement.width / videoElement.videoWidth;
            const scaleY = canvasElement.height / videoElement.videoHeight;

            const x1 = kp1.x * scaleX;
            const y1 = kp1.y * scaleY;
            const x2 = kp2.x * scaleX;
            const y2 = kp2.y * scaleY;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    });
    
    // Draw keypoints as circles
    keypoints.forEach((kp) => {
        if (kp.score > scoreThreshold) {
            const scaleX = canvasElement.width / videoElement.videoWidth;
            const scaleY = canvasElement.height / videoElement.videoHeight;
            const x = kp.x * scaleX;
            const y = kp.y * scaleY;

            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI); // Draw a small circle for each keypoint
            ctx.fillStyle = '#00FF00'; // Green dots
            ctx.fill();
        }
    });
    
    // Optional: Draw filled torso if all required keypoints are detected
    const torsoPoints = {
        leftShoulder: findKeypoint(keypoints, 'left_shoulder'),
        rightShoulder: findKeypoint(keypoints, 'right_shoulder'),
        leftHip: findKeypoint(keypoints, 'left_hip'),
        rightHip: findKeypoint(keypoints, 'right_hip')
    };
    
    if (torsoPoints.leftShoulder && torsoPoints.rightShoulder && 
        torsoPoints.leftHip && torsoPoints.rightHip) {
        // Draw filled torso
        const scaleX = canvasElement.width / videoElement.videoWidth;
        const scaleY = canvasElement.height / videoElement.videoHeight;
        
        ctx.beginPath();
        ctx.moveTo(torsoPoints.leftShoulder.x * scaleX, torsoPoints.leftShoulder.y * scaleY);
        ctx.lineTo(torsoPoints.rightShoulder.x * scaleX, torsoPoints.rightShoulder.y * scaleY);
        ctx.lineTo(torsoPoints.rightHip.x * scaleX, torsoPoints.rightHip.y * scaleY);
        ctx.lineTo(torsoPoints.leftHip.x * scaleX, torsoPoints.leftHip.y * scaleY);
        ctx.closePath();
        ctx.fillStyle = bodyFillColor;
        ctx.fill();
    }
}

// Helper to find a specific keypoint by name
function findKeypoint(keypoints, name) {
    const kp = keypoints.find(kp => kp.name === name);
    return kp && kp.score > scoreThreshold ? kp : null;
}

/**
 * Calculates the overlap score between the drawn body shape and the mask.
 * @returns {number} Score between 0 and 100.
 */
function calculateOverlapScore(bodyShapeImageData) {
    if (!maskImageData || !bodyShapeImageData) return 0;

    let overlapPixels = 0;
    let maskPixels = 0;
    let bodyPixels = 0;

    const maskData = maskImageData.data;
    const bodyData = bodyShapeImageData.data;
    const pixelCount = maskData.length / 4; // RGBA = 4 values per pixel

    // Compare each pixel
    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        
        // A pixel is white if its RGB values are high (close to 255)
        // Using a threshold to account for compression artifacts
        const isMaskPixel = maskData[offset] > 200; // Red channel > 200 in mask
        const isBodyPixel = bodyData[offset] > 100; // Red channel > 100 in body
        
        if (isMaskPixel) maskPixels++;
        if (isBodyPixel) bodyPixels++;
        
        // Pixel is in both
        if (isMaskPixel && isBodyPixel) overlapPixels++;
    }

    // If there are no mask or body pixels, return 0
    if (maskPixels === 0 || bodyPixels === 0) return 0;

    // Use Dice coefficient for scoring: 2 * overlap / (mask + body)
    const score = (2 * overlapPixels) / (maskPixels + bodyPixels);
    
    return Math.round(score * 100);
}

// --- Main Application Logic ---

/**
 * Main loop: Get pose, draw, calculate score, repeat.
 */
async function detectionLoop() {
    if (!poseDetector || !videoElement.srcObject) {
        console.error("Cannot run detection loop: missing detector or video stream");
        return;
    }

    // Set canvas dimensions to match video
    if (canvasElement.width !== videoWidth || canvasElement.height !== videoHeight) {
        canvasElement.width = videoWidth;
        canvasElement.height = videoHeight;
        console.log(`Canvas resized to ${canvasElement.width}x${canvasElement.height}`);
    }

    try {
        // Debug logging
        console.log("Running pose estimation...");
        
        // Get pose estimation - explicitly set options for MoveNet
        const poses = await poseDetector.estimatePoses(videoElement, {
            flipHorizontal: true,  // Mirror for more natural interaction
            maxPoses: 1           // Only detect one person
        });
        
        // Debug logging
        console.log(`Detected ${poses.length} poses`);
        
        // Get the first detected pose (if any)
        const pose = poses && poses.length > 0 ? poses[0] : null;
        
        if (pose) {
            // Log keypoint counts for debugging
            const validKeypoints = pose.keypoints.filter(kp => kp.score > scoreThreshold);
            console.log(`Found ${validKeypoints.length} keypoints above threshold ${scoreThreshold}`);
            if (validKeypoints.length > 0) {
                console.log(`First keypoint: ${validKeypoints[0].name}, score: ${validKeypoints[0].score.toFixed(2)}`);
            }
        }
        
        // Draw the body shape with skeleton
        drawBodyShape(pose, canvasCtx);

        // Only calculate score if we have a pose
        if (pose && pose.keypoints.length > 0) {
            // Create a temporary canvas to store the drawn body shape for scoring
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasElement.width;
            tempCanvas.height = canvasElement.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvasElement, 0, 0);
            
            // Get body shape data for score calculation
            const bodyShapeImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

            // Calculate score
            const score = calculateOverlapScore(bodyShapeImageData);
            scoreElement.textContent = `Score: ${score}%`;
        }
    } catch (error) {
        console.error('Error in detection loop:', error);
    }

    // Request next frame
    animationFrameId = requestAnimationFrame(detectionLoop);
}

/**
 * Initializes the application: loads model, webcam, mask, and starts loop.
 */
async function main() {
    try {
        // Draw test pattern to verify canvas works
        drawTestPattern();
        
        // Check if TensorFlow.js is available
        if (!tf) {
            throw new Error('TensorFlow.js is not loaded. Check script includes in HTML.');
        }
        
        // Initialize TensorFlow.js and load pose detector
        loadingElement.textContent = 'Initializing TensorFlow.js...';
        const detectorLoaded = await loadPoseDetector();
        if (!detectorLoaded) {
            throw new Error('Failed to load pose detector.');
        }

        // Load mask image
        loadingElement.textContent = 'Loading mask image...';
        await loadMask();
        console.log('Mask image loaded successfully.');

        // Setup webcam
        loadingElement.textContent = 'Accessing webcam...';
        await setupWebcam();
        
        // Set video element properties
        videoElement.width = videoWidth;
        videoElement.height = videoHeight;
        videoElement.style.display = 'none'; // Hide original video but allow it to play
        
        // Start playing the video
        await videoElement.play(); // Ensure video is playing
        console.log('Webcam activated successfully.');

        // Start detection loop
        loadingElement.style.display = 'none';
        mainElement.style.display = 'block';
        detectionLoop();

    } catch (error) {
        console.error('Initialization failed:', error);
        loadingElement.textContent = `Error: ${error.message}. Check console for details.`;
    }
}

// Fix webcam display issues
window.addEventListener('load', () => {
    console.log("Page loaded, initializing...");
    // Check if TensorFlow is loaded
    if (typeof tf !== 'undefined' && typeof poseDetection !== 'undefined') {
        console.log("TensorFlow libraries found, starting application");
        main();
    } else {
        console.error("TensorFlow libraries not found!");
        loadingElement.textContent = "Error: TensorFlow libraries not loaded properly. Please check your internet connection and refresh.";
    }
});

// Draw a test rectangle on the canvas to verify it's working
function drawTestPattern() {
    if (!canvasElement || !canvasCtx) return;
    
    canvasElement.width = videoWidth;
    canvasElement.height = videoHeight;
    
    // Fill with dark background
    canvasCtx.fillStyle = '#333';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Draw a visible border
    canvasCtx.strokeStyle = '#0F0'; // Bright green
    canvasCtx.lineWidth = 10;
    canvasCtx.strokeRect(10, 10, canvasElement.width - 20, canvasElement.height - 20);
    
    // Draw text
    canvasCtx.fillStyle = '#FFF';
    canvasCtx.font = '20px sans-serif';
    canvasCtx.fillText('Canvas initialized. Waiting for pose detection...', 50, 50);
    
    console.log("Test pattern drawn on canvas");
}
