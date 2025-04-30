const videoElement = document.getElementById('webcam');
const baseCanvas = document.getElementById('base-canvas');
const silhouetteCanvas = document.getElementById('silhouette-canvas');
const differenceCanvas = document.getElementById('difference-canvas');
const skeletonCanvas = document.getElementById('skeleton-canvas');
const baseCtx = baseCanvas.getContext('2d');
const silhouetteCtx = silhouetteCanvas.getContext('2d');
const differenceCtx = differenceCanvas.getContext('2d');
const skeletonCtx = skeletonCanvas.getContext('2d');
const loadingElement = document.getElementById('loading');
const mainElement = document.getElementById('main');
const scoreElement = document.getElementById('score');
const cameraSelect = document.getElementById('camera-select');
const resolutionSelect = document.getElementById('resolution-select');
const applyCameraButton = document.getElementById('apply-camera-settings');

const maskImage = new Image();
let maskImageData = null;
let poseDetector = null;
let animationFrameId = null;
let currentStream = null;

// Configuration (adjust as needed)
let videoWidth = 640;
let videoHeight = 480;
const maskPath = 'mask.jpg'; // Ensure this file exists in public/
const DEFAULT_SETTINGS = {
    scoreThreshold: 0.1,
    // Skeleton settings
    lineWidth: 5,
    lineColor: '#FF0000',
    keypointSize: 5,
    keypointColor: '#00FF00',
    // Silhouette settings
    silhouetteColor: '#FFFFFF',
    silhouetteThickness: 50,
    silhouetteOpacity: 1.0,
    silhouettePixelation: 16, // Default to chunky pixelation (16x)
    silhouetteHeadSize: 1.0, // Head size multiplier (1.0 = normal)
    // Mask settings
    maskOpacity: 1.0, // Default mask overlay opacity (100%)
    // Layer visibility
    showWebcam: false,
    showMaskOverlay: true,
    showSilhouette: true,
    showSkeleton: false,
    showDifference: true,
    // Camera settings
    selectedCamera: '', // Will be populated with default camera
    selectedResolution: '640x480' // Default resolution
};

// Current settings (will be controlled by UI)
let settings = { ...DEFAULT_SETTINGS };

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

// Body part definitions for silhouette (groups of connected keypoints)
const BODY_PARTS = {
    head: [0, 1, 2, 3, 4], // Nose, eyes, ears
    torso: [5, 6, 11, 12], // Shoulders and hips
    leftArm: [5, 7, 9], // Left shoulder to left wrist
    rightArm: [6, 8, 10], // Right shoulder to right wrist
    leftLeg: [11, 13, 15], // Left hip to left ankle 
    rightLeg: [12, 14, 16]  // Right hip to right ankle
};

// --- Helper Functions ---

/**
 * Loads the mask image and extracts its pixel data.
 */
async function loadMask() {
    return new Promise((resolve, reject) => {
        maskImage.onload = () => {
            console.log('Mask image loaded.');
            updateMaskImageData();
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
 * Updates the mask image data to match current canvas dimensions.
 * Call this whenever the canvas size changes.
 */
function updateMaskImageData() {
    if (!maskImage.complete || maskImage.naturalWidth === 0) {
        console.warn('Cannot update mask image data: mask not loaded');
        return;
    }
    
    // Get current canvas dimensions
    const canvasWidth = baseCanvas.width;
    const canvasHeight = baseCanvas.height;
    
    // Draw mask to a temporary canvas to get its imageData
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasWidth;
    tempCanvas.height = canvasHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(maskImage, 0, 0, canvasWidth, canvasHeight);
    maskImageData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    
    console.log(`Mask image data updated to ${canvasWidth}x${canvasHeight}`);
}

/**
 * Enumerates available video input devices and populates the camera selection dropdown.
 */
async function enumerateVideoDevices() {
    try {
        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.error('MediaDevices API not supported in this browser.');
            cameraSelect.innerHTML = '<option value="">Camera selection not supported</option>';
            return [];
        }

        // Get the list of all media devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Filter for video input devices (cameras)
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        // Clear the select element
        cameraSelect.innerHTML = '';
        
        // Add option for each video device
        if (videoDevices.length === 0) {
            cameraSelect.innerHTML = '<option value="">No cameras detected</option>';
        } else {
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                
                // Use device label if available, otherwise use generic name with index
                option.text = device.label || `Camera ${index + 1}`;
                
                cameraSelect.appendChild(option);
            });
            
            // Set the first camera as default if none is set
            if (!settings.selectedCamera && videoDevices.length > 0) {
                settings.selectedCamera = videoDevices[0].deviceId;
                cameraSelect.value = settings.selectedCamera;
            }
        }
        
        return videoDevices;
    } catch (error) {
        console.error('Error enumerating video devices:', error);
        cameraSelect.innerHTML = '<option value="">Error loading cameras</option>';
        return [];
    }
}

/**
 * Parses a resolution string (e.g., "640x480") and returns width and height.
 */
function parseResolution(resolutionStr) {
    const [width, height] = resolutionStr.split('x').map(num => parseInt(num, 10));
    return { width, height };
}

/**
 * Sets up the webcam stream with the specified constraints.
 */
async function setupWebcam() {
    // Stop any existing stream
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    return new Promise((resolve, reject) => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            // Parse the selected resolution
            const { width, height } = parseResolution(settings.selectedResolution);
            
            // Build constraints based on settings
            const constraints = {
                video: {
                    width: { ideal: width },
                    height: { ideal: height }
                }
            };
            
            // Add device ID if one is selected
            if (settings.selectedCamera) {
                constraints.video.deviceId = { exact: settings.selectedCamera };
            }
            
            navigator.mediaDevices.getUserMedia(constraints)
                .then(stream => {
                    currentStream = stream;
                    videoElement.srcObject = stream;
                    
                    // Make sure video element is properly configured
                    videoElement.width = width;
                    videoElement.height = height;
                    videoElement.style.display = 'none'; // Hide original video but allow it to play
                    
                    videoElement.addEventListener('loadeddata', () => {
                        console.log('Webcam stream loaded.');
                        console.log(`Actual video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                        
                        // Ensure video is playing
                        videoElement.play()
                            .then(() => {
                                console.log('Video playback started');
                                resolve();
                            })
                            .catch(err => {
                                console.error('Error starting video playback:', err);
                                reject(err);
                            });
                    });
                })
                .catch(err => {
                    console.error('Error accessing webcam:', err);
                    loadingElement.textContent = 'Error accessing webcam. Please grant permission or try a different camera.';
                    
                    // If the error is due to constraints, try again with default constraints
                    if (err.name === 'ConstraintNotSatisfiedError' || err.name === 'OverconstrainedError') {
                        console.log('Retrying with default constraints...');
                        navigator.mediaDevices.getUserMedia({ video: true })
                            .then(stream => {
                                currentStream = stream;
                                videoElement.srcObject = stream;
                                videoElement.style.display = 'none';
                                
                                videoElement.addEventListener('loadeddata', () => {
                                    console.log('Webcam stream loaded with default constraints.');
                                    
                                    // Ensure video is playing
                                    videoElement.play()
                                        .then(() => {
                                            console.log('Video playback started with fallback constraints');
                                            resolve();
                                        })
                                        .catch(playErr => {
                                            console.error('Error starting video playback with fallback:', playErr);
                                            reject(playErr);
                                        });
                                });
                            })
                            .catch(fallbackErr => {
                                console.error('Error accessing webcam with fallback constraints:', fallbackErr);
                                reject(fallbackErr);
                            });
                    } else {
                        reject(err);
                    }
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
 * Draws the base layer with webcam and mask overlay
 */
function drawBaseLayer(ctx) {
    // Get the actual canvas dimensions
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    // Clear the canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw black background if webcam is hidden
    if (!settings.showWebcam) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
    } else {
        // Draw webcam frame
        ctx.drawImage(videoElement, 0, 0, width, height);
    }
    
    // Draw mask overlay if enabled (regardless of webcam visibility)
    if (settings.showMaskOverlay && maskImage.complete && maskImage.naturalWidth > 0) {
        ctx.globalAlpha = settings.maskOpacity; // Use the mask opacity setting
        ctx.drawImage(maskImage, 0, 0, width, height);
        ctx.globalAlpha = 1.0; // Reset alpha
    }
}

/**
 * Draws the human silhouette based on pose data
 */
function drawSilhouette(pose, ctx) {
    // Get actual canvas dimensions
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    if (!pose || !pose.keypoints || !settings.showSilhouette) {
        ctx.clearRect(0, 0, width, height);
        return;
    }
    
    // Clear the canvas first
    ctx.clearRect(0, 0, width, height);
    
    // If pixelation is enabled, use a scaled-down canvas
    if (settings.silhouettePixelation > 1) {
        // Create a smaller temporary canvas for pixelation
        const tempCanvas = document.createElement('canvas');
        const pixelSize = settings.silhouettePixelation;
        const smallWidth = Math.floor(width / pixelSize);
        const smallHeight = Math.floor(height / pixelSize);
        
        tempCanvas.width = smallWidth;
        tempCanvas.height = smallHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Set the silhouette style on the temp context
        tempCtx.fillStyle = settings.silhouetteColor;
        tempCtx.globalAlpha = settings.silhouetteOpacity;
        
        // Disable smoothing for pixelated look
        tempCtx.imageSmoothingEnabled = false;
        
        // Draw the scaled-down silhouette
        drawSilhouetteToContext(pose, tempCtx, smallWidth / videoElement.videoWidth, smallHeight / videoElement.videoHeight);
        
        // Now draw the pixelated silhouette back to the main canvas
        // Turn OFF image smoothing to keep the chunky pixelated look
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tempCanvas, 0, 0, smallWidth, smallHeight, 0, 0, width, height);
        
        // Reset alpha
        ctx.globalAlpha = 1.0;
    } else {
        // Regular drawing with no pixelation
        const scaleX = width / videoElement.videoWidth;
        const scaleY = height / videoElement.videoHeight;
        
        // Set silhouette style
        ctx.fillStyle = settings.silhouetteColor;
        ctx.globalAlpha = settings.silhouetteOpacity;
        
        // Disable smoothing
        ctx.imageSmoothingEnabled = false;
        
        // Draw the silhouette directly to the main canvas
        drawSilhouetteToContext(pose, ctx, scaleX, scaleY);
        
        // Reset alpha
        ctx.globalAlpha = 1.0;
    }
}

/**
 * Helper function to draw the silhouette to a given context with scaling
 */
function drawSilhouetteToContext(pose, ctx, scaleX, scaleY) {
    const keypoints = pose.keypoints;
    
    // Draw torso (always start with torso as it's the most reliable)
    const torsoPoints = {
        leftShoulder: findKeypoint(keypoints, 'left_shoulder'),
        rightShoulder: findKeypoint(keypoints, 'right_shoulder'),
        leftHip: findKeypoint(keypoints, 'left_hip'),
        rightHip: findKeypoint(keypoints, 'right_hip')
    };
    
    if (torsoPoints.leftShoulder && torsoPoints.rightShoulder && 
        torsoPoints.leftHip && torsoPoints.rightHip) {
        // Draw filled torso
        drawBodySegment(
            ctx,
            [
                [torsoPoints.leftShoulder.x * scaleX, torsoPoints.leftShoulder.y * scaleY],
                [torsoPoints.rightShoulder.x * scaleX, torsoPoints.rightShoulder.y * scaleY],
                [torsoPoints.rightHip.x * scaleX, torsoPoints.rightHip.y * scaleY],
                [torsoPoints.leftHip.x * scaleX, torsoPoints.leftHip.y * scaleY]
            ],
            settings.silhouetteThickness * Math.min(scaleX, scaleY)
        );
    }
    
    // Draw head
    const nose = findKeypoint(keypoints, 'nose');
    const leftEye = findKeypoint(keypoints, 'left_eye');
    const rightEye = findKeypoint(keypoints, 'right_eye');
    
    if (nose && (leftEye || rightEye)) {
        // Calculate head size based on distance between eyes or default size
        let headSize = settings.silhouetteThickness * 2 * Math.min(scaleX, scaleY);
        if (leftEye && rightEye) {
            const eyeDistance = Math.sqrt(
                Math.pow((leftEye.x - rightEye.x) * scaleX, 2) + 
                Math.pow((leftEye.y - rightEye.y) * scaleY, 2)
            );
            headSize = Math.max(eyeDistance * 2, headSize);
        }
        
        // Apply the head size multiplier
        headSize *= settings.silhouetteHeadSize;
        
        // Draw head as a circle
        ctx.beginPath();
        ctx.arc(
            nose.x * scaleX, 
            nose.y * scaleY, 
            headSize, 
            0, 2 * Math.PI
        );
        ctx.fill();
    }
    
    // Draw limbs
    // Left arm
    const leftShoulder = findKeypoint(keypoints, 'left_shoulder');
    const leftElbow = findKeypoint(keypoints, 'left_elbow');
    const leftWrist = findKeypoint(keypoints, 'left_wrist');
    
    if (leftShoulder && leftElbow && leftWrist) {
        drawLimb(ctx, [leftShoulder, leftElbow, leftWrist], scaleX, scaleY, 
                settings.silhouetteThickness * Math.min(scaleX, scaleY));
    }
    
    // Right arm
    const rightShoulder = findKeypoint(keypoints, 'right_shoulder');
    const rightElbow = findKeypoint(keypoints, 'right_elbow');
    const rightWrist = findKeypoint(keypoints, 'right_wrist');
    
    if (rightShoulder && rightElbow && rightWrist) {
        drawLimb(ctx, [rightShoulder, rightElbow, rightWrist], scaleX, scaleY, 
                settings.silhouetteThickness * Math.min(scaleX, scaleY));
    }
    
    // Left leg
    const leftHip = findKeypoint(keypoints, 'left_hip');
    const leftKnee = findKeypoint(keypoints, 'left_knee');
    const leftAnkle = findKeypoint(keypoints, 'left_ankle');
    
    if (leftHip && leftKnee && leftAnkle) {
        drawLimb(ctx, [leftHip, leftKnee, leftAnkle], scaleX, scaleY, 
                settings.silhouetteThickness * Math.min(scaleX, scaleY));
    }
    
    // Right leg
    const rightHip = findKeypoint(keypoints, 'right_hip');
    const rightKnee = findKeypoint(keypoints, 'right_knee');
    const rightAnkle = findKeypoint(keypoints, 'right_ankle');
    
    if (rightHip && rightKnee && rightAnkle) {
        drawLimb(ctx, [rightHip, rightKnee, rightAnkle], scaleX, scaleY, 
                settings.silhouetteThickness * Math.min(scaleX, scaleY));
    }
}

/**
 * Helper to draw a limb segment from multiple keypoints
 */
function drawLimb(ctx, points, scaleX, scaleY, thickness) {
    // Create a path for the limb
    ctx.beginPath();
    
    // Create a series of points for the limb centerline
    const centerPoints = points.map(point => ({
        x: point.x * scaleX,
        y: point.y * scaleY
    }));
    
    // Draw the path with thickness
    drawThickPath(ctx, centerPoints, thickness);
}

/**
 * Draws a thick path from an array of points
 */
function drawThickPath(ctx, points, thickness) {
    if (points.length < 2) return;
    
    // Draw a circle at each joint
    points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, thickness / 2, 0, 2 * Math.PI);
        ctx.fill();
    });
    
    // Draw thick lines between points
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        // Calculate the vector from p1 to p2
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Normalize the vector
        const nx = dx / distance;
        const ny = dy / distance;
        
        // Create perpendicular vectors for thickness
        const px = -ny * (thickness / 2);
        const py = nx * (thickness / 2);
        
        // Draw a quadrilateral
        ctx.beginPath();
        ctx.moveTo(p1.x + px, p1.y + py);
        ctx.lineTo(p2.x + px, p2.y + py);
        ctx.lineTo(p2.x - px, p2.y - py);
        ctx.lineTo(p1.x - px, p1.y - py);
        ctx.closePath();
        ctx.fill();
    }
}

/**
 * Draw a body segment as a filled polygon with thickness
 */
function drawBodySegment(ctx, points, thickness) {
    if (points.length < 3) return;
    
    // Draw the main filled polygon
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    
    // Draw joints as circles at each point
    points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point[0], point[1], thickness / 2, 0, 2 * Math.PI);
        ctx.fill();
    });
    
    // Draw thick lines between points to smooth the edges
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length]; // Connect back to the first point
        
        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle; // Set stroke color to match fill color
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
    }
}

/**
 * Draws the skeleton on the top canvas layer
 */
function drawSkeleton(pose, ctx) {
    // Get the actual canvas dimensions
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    if (!pose || !pose.keypoints || !settings.showSkeleton) {
        ctx.clearRect(0, 0, width, height);
        return;
    }
    
    // Clear the canvas
    ctx.clearRect(0, 0, width, height);
    
    const keypoints = pose.keypoints;
    const scaleX = width / videoElement.videoWidth;
    const scaleY = height / videoElement.videoHeight;
    
    // Draw the skeleton connections
    ctx.strokeStyle = settings.lineColor;
    ctx.lineWidth = settings.lineWidth;
    
    // Draw the skeleton connections
    POSE_CONNECTIONS.forEach(([i, j]) => {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];

        // Check if keypoints and their scores are valid
        if (kp1 && kp2 && kp1.score > settings.scoreThreshold && kp2.score > settings.scoreThreshold) {
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
    ctx.fillStyle = settings.keypointColor;
    keypoints.forEach((kp) => {
        if (kp.score > settings.scoreThreshold) {
            const x = kp.x * scaleX;
            const y = kp.y * scaleY;

            ctx.beginPath();
            ctx.arc(x, y, settings.keypointSize, 0, 2 * Math.PI); // Draw a circle for each keypoint
            ctx.fill();
        }
    });
}

// Helper to find a specific keypoint by name
function findKeypoint(keypoints, name) {
    const kp = keypoints.find(kp => kp.name === name);
    return kp && kp.score > settings.scoreThreshold ? kp : null;
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

/**
 * Draws the difference layer showing where the silhouette overlaps with the mask
 */
function drawDifferenceLayer(ctx) {
    // Get the actual canvas dimensions
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    if (!settings.showDifference || !maskImageData) {
        ctx.clearRect(0, 0, width, height);
        return;
    }
    
    // Get the silhouette data
    const silhouetteData = silhouetteCtx.getImageData(0, 0, width, height);
    
    // Create a new ImageData for the difference layer
    const differenceData = new ImageData(width, height);
    
    // Compare each pixel to find overlaps
    for (let i = 0; i < maskImageData.data.length; i += 4) {
        // Check if both the mask and silhouette have visible pixels at this position
        // For mask, we consider it "on" if it's mostly white (R > 200)
        // For silhouette, we consider it "on" if it has any opacity
        const isMaskPixel = maskImageData.data[i] > 200;
        const isSilhouettePixel = silhouetteData.data[i + 3] > 0; // Check alpha channel
        
        if (isMaskPixel && isSilhouettePixel) {
            // Overlap - set to green
            differenceData.data[i] = 0;       // R
            differenceData.data[i + 1] = 255; // G
            differenceData.data[i + 2] = 0;   // B
            differenceData.data[i + 3] = 255; // A (fully opaque)
        } else {
            // No overlap - transparent
            differenceData.data[i] = 0;
            differenceData.data[i + 1] = 0;
            differenceData.data[i + 2] = 0;
            differenceData.data[i + 3] = 0;
        }
    }
    
    // Put the difference data onto the canvas
    ctx.putImageData(differenceData, 0, 0);
}

/**
 * Updates UI controls to match current settings.
 */
function updateControlsUI() {
    // Update color pickers
    document.getElementById('line-color').value = settings.lineColor;
    document.getElementById('keypoint-color').value = settings.keypointColor;
    document.getElementById('silhouette-color').value = settings.silhouetteColor;
    
    // Update range inputs
    document.getElementById('line-width').value = settings.lineWidth;
    document.getElementById('line-width-value').textContent = settings.lineWidth;
    
    document.getElementById('keypoint-size').value = settings.keypointSize;
    document.getElementById('keypoint-size-value').textContent = settings.keypointSize;
    
    document.getElementById('silhouette-thickness').value = settings.silhouetteThickness;
    document.getElementById('silhouette-thickness-value').textContent = settings.silhouetteThickness;
    
    document.getElementById('silhouette-opacity').value = Math.round(settings.silhouetteOpacity * 100);
    document.getElementById('silhouette-opacity-value').textContent = `${Math.round(settings.silhouetteOpacity * 100)}%`;
    
    document.getElementById('silhouette-pixelation').value = settings.silhouettePixelation;
    document.getElementById('silhouette-pixelation-value').textContent = `${settings.silhouettePixelation}x`;
    
    document.getElementById('silhouette-head-size').value = settings.silhouetteHeadSize;
    document.getElementById('silhouette-head-size-value').textContent = `${settings.silhouetteHeadSize.toFixed(1)}x`;
    
    document.getElementById('mask-opacity').value = Math.round(settings.maskOpacity * 100);
    document.getElementById('mask-opacity-value').textContent = `${Math.round(settings.maskOpacity * 100)}%`;
    
    // Update checkboxes
    document.getElementById('show-webcam').checked = settings.showWebcam;
    document.getElementById('show-mask-overlay').checked = settings.showMaskOverlay;
    document.getElementById('show-silhouette').checked = settings.showSilhouette;
    document.getElementById('show-skeleton').checked = settings.showSkeleton;
    document.getElementById('show-difference').checked = settings.showDifference;
}

/**
 * Applies the camera settings (device and resolution).
 */
async function applyCameraSettings() {
    // Show loading state
    loadingElement.textContent = 'Applying camera settings...';
    loadingElement.style.display = 'block';
    mainElement.style.display = 'none';
    
    // Cancel the animation frame to pause rendering
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    try {
        // Update settings from UI
        settings.selectedCamera = cameraSelect.value;
        settings.selectedResolution = resolutionSelect.value;
        
        // Restart webcam with new settings
        await setupWebcam();
        
        // Update canvas dimensions if resolution changed
        const { width, height } = parseResolution(settings.selectedResolution);
        updateCanvasDimensions(width, height);
        
        // Restart detection loop
        detectionLoop();
        
        // Hide loading screen
        loadingElement.style.display = 'none';
        mainElement.style.display = 'block';
    } catch (error) {
        console.error('Error applying camera settings:', error);
        loadingElement.textContent = `Error: ${error.message}. Please try different settings.`;
    }
}

/**
 * Updates canvas dimensions to match the new resolution.
 */
function updateCanvasDimensions(width, height) {
    const canvases = [baseCanvas, silhouetteCanvas, differenceCanvas, skeletonCanvas];
    canvases.forEach(canvas => {
        canvas.width = width;
        canvas.height = height;
    });
    
    // Update global variables
    videoWidth = width;
    videoHeight = height;
    
    // Recreate mask image data (since dimensions might have changed)
    updateMaskImageData();
}

/**
 * Initialize control panel event listeners.
 */
function setupControlListeners() {
    // Camera controls
    applyCameraButton.addEventListener('click', () => {
        applyCameraSettings();
    });
    
    // Layer visibility toggles
    document.getElementById('show-webcam').addEventListener('change', (e) => {
        settings.showWebcam = e.target.checked;
    });
    
    document.getElementById('show-mask-overlay').addEventListener('change', (e) => {
        settings.showMaskOverlay = e.target.checked;
    });
    
    document.getElementById('show-silhouette').addEventListener('change', (e) => {
        settings.showSilhouette = e.target.checked;
        // Update canvas visibility
        silhouetteCanvas.style.display = e.target.checked ? 'block' : 'none';
    });
    
    document.getElementById('show-skeleton').addEventListener('change', (e) => {
        settings.showSkeleton = e.target.checked;
        // Update canvas visibility
        skeletonCanvas.style.display = e.target.checked ? 'block' : 'none';
    });
    
    document.getElementById('show-difference').addEventListener('change', (e) => {
        settings.showDifference = e.target.checked;
        // Update canvas visibility
        differenceCanvas.style.display = e.target.checked ? 'block' : 'none';
    });
    
    // Mask opacity control
    document.getElementById('mask-opacity').addEventListener('input', (e) => {
        settings.maskOpacity = parseInt(e.target.value) / 100;
        document.getElementById('mask-opacity-value').textContent = `${e.target.value}%`;
    });
    
    // Skeleton style controls
    document.getElementById('line-color').addEventListener('input', (e) => {
        settings.lineColor = e.target.value;
    });
    
    document.getElementById('line-width').addEventListener('input', (e) => {
        settings.lineWidth = parseInt(e.target.value);
        document.getElementById('line-width-value').textContent = settings.lineWidth;
    });
    
    document.getElementById('keypoint-color').addEventListener('input', (e) => {
        settings.keypointColor = e.target.value;
    });
    
    document.getElementById('keypoint-size').addEventListener('input', (e) => {
        settings.keypointSize = parseInt(e.target.value);
        document.getElementById('keypoint-size-value').textContent = settings.keypointSize;
    });
    
    // Silhouette style controls
    document.getElementById('silhouette-color').addEventListener('input', (e) => {
        settings.silhouetteColor = e.target.value;
    });
    
    document.getElementById('silhouette-thickness').addEventListener('input', (e) => {
        settings.silhouetteThickness = parseInt(e.target.value);
        document.getElementById('silhouette-thickness-value').textContent = settings.silhouetteThickness;
    });
    
    document.getElementById('silhouette-opacity').addEventListener('input', (e) => {
        const opacity = parseInt(e.target.value);
        settings.silhouetteOpacity = opacity / 100;
        document.getElementById('silhouette-opacity-value').textContent = `${opacity}%`;
    });
    
    document.getElementById('silhouette-pixelation').addEventListener('input', (e) => {
        settings.silhouettePixelation = parseInt(e.target.value);
        document.getElementById('silhouette-pixelation-value').textContent = `${settings.silhouettePixelation}x`;
    });
    
    document.getElementById('silhouette-head-size').addEventListener('input', (e) => {
        settings.silhouetteHeadSize = parseFloat(e.target.value);
        document.getElementById('silhouette-head-size-value').textContent = `${settings.silhouetteHeadSize.toFixed(1)}x`;
    });
    
    // Reset button
    document.getElementById('reset-controls').addEventListener('click', () => {
        settings = { ...DEFAULT_SETTINGS };
        updateControlsUI();
        // Update canvas visibility
        silhouetteCanvas.style.display = settings.showSilhouette ? 'block' : 'none';
        skeletonCanvas.style.display = settings.showSkeleton ? 'block' : 'none';
        differenceCanvas.style.display = settings.showDifference ? 'block' : 'none';
    });
}

/**
 * Main loop: Get pose, draw, calculate score, repeat.
 */
async function detectionLoop() {
    if (!poseDetector || !videoElement.srcObject) {
        console.error("Cannot run detection loop: missing detector or video stream");
        return;
    }

    // Ensure video is playing
    if (videoElement.paused || videoElement.ended) {
        try {
            await videoElement.play();
            console.log("Restarted video playback in detection loop");
        } catch (err) {
            console.error("Failed to play video in detection loop:", err);
        }
    }

    // Get dimensions from video element if available
    const actualWidth = videoElement.videoWidth || videoWidth;
    const actualHeight = videoElement.videoHeight || videoHeight;
    
    // Set canvas dimensions for all canvases
    const canvases = [baseCanvas, silhouetteCanvas, differenceCanvas, skeletonCanvas];
    let dimensionsChanged = false;
    
    canvases.forEach(canvas => {
        if (canvas.width !== actualWidth || canvas.height !== actualHeight) {
            canvas.width = actualWidth;
            canvas.height = actualHeight;
            dimensionsChanged = true;
        }
    });
    
    // If dimensions changed, update the mask data
    if (dimensionsChanged) {
        updateMaskImageData();
    }

    try {
        // Get pose estimation - explicitly set options for MoveNet
        const poses = await poseDetector.estimatePoses(videoElement, {
            flipHorizontal: true,  // Mirror for more natural interaction
            maxPoses: 1           // Only detect one person
        });
        
        // Get the first detected pose (if any)
        const pose = poses && poses.length > 0 ? poses[0] : null;
        
        // Log for debugging
        if (pose) {
            console.log("Pose detected with", pose.keypoints.length, "keypoints");
        } else {
            console.log("No pose detected");
        }
        
        // Draw on each canvas layer
        drawBaseLayer(baseCtx);
        drawSilhouette(pose, silhouetteCtx);
        drawDifferenceLayer(differenceCtx);
        drawSkeleton(pose, skeletonCtx);

        // Calculate score if we have a pose
        if (pose && pose.keypoints.length > 0) {
            // Create a temporary canvas to combine all layers for scoring
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = actualWidth;
            tempCanvas.height = actualHeight;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw only the silhouette on black background for scoring
            tempCtx.fillStyle = '#000000';
            tempCtx.fillRect(0, 0, actualWidth, actualHeight);
            tempCtx.drawImage(silhouetteCanvas, 0, 0);
            
            // Get combined image data for score calculation
            const combinedImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

            // Calculate score
            const score = calculateOverlapScore(combinedImageData);
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
        drawTestPattern(baseCtx);
        
        // Check if TensorFlow.js is available
        if (!tf) {
            throw new Error('TensorFlow.js is not loaded. Check script includes in HTML.');
        }
        
        // Setup control panel
        setupControlListeners();
        updateControlsUI();
        
        // Enumerate available cameras
        loadingElement.textContent = 'Detecting cameras...';
        const videoDevices = await enumerateVideoDevices();
        
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

        // Setup webcam with current settings
        loadingElement.textContent = 'Accessing webcam...';
        await setupWebcam();
        
        // Set resolution dropdown to match actual video dimensions
        const actualResolution = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
        const resolutionExists = Array.from(resolutionSelect.options).some(option => option.value === actualResolution);
        if (!resolutionExists) {
            const option = document.createElement('option');
            option.value = actualResolution;
            option.text = `${actualResolution} (Current)`;
            resolutionSelect.add(option, 0);
        }
        resolutionSelect.value = actualResolution;
        settings.selectedResolution = actualResolution;
        
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
function drawTestPattern(ctx) {
    if (!ctx) return;
    
    ctx.canvas.width = videoWidth;
    ctx.canvas.height = videoHeight;
    
    // Fill with dark background
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Draw a visible border
    ctx.strokeStyle = '#0F0'; // Bright green
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, ctx.canvas.width - 20, ctx.canvas.height - 20);
    
    // Draw text
    ctx.fillStyle = '#FFF';
    ctx.font = '20px sans-serif';
    ctx.fillText('Canvas initialized. Waiting for pose detection...', 50, 50);
    
    console.log("Test pattern drawn on canvas");
}
