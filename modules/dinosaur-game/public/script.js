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
const processResolutionSelect = document.getElementById('process-resolution-select');
const applyCameraButton = document.getElementById('apply-camera-settings');
const maskVideoElement = document.getElementById('mask-video');
const fullscreenButton = document.getElementById('fullscreen-btn');
const canvasContainer = document.querySelector('.canvas-container');

let maskImageData = null;
let poseDetector = null;
let animationFrameId = null;
let currentStream = null;
let defaultConfig = {}; // To store loaded config

// Configuration (adjust as needed)
let videoWidth = 640;
let videoHeight = 480;
let displayWidth = 1920;  // Output/display resolution width
let displayHeight = 1080; // Output/display resolution height

// Current settings (will be controlled by UI)
let settings = {}; // Initialize as empty, will be populated from config

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
 * Updates the mask image data from the current frame of the mask video
 * to match current canvas dimensions. Call this whenever the canvas size changes
 * or you need the latest frame data.
 */
function updateMaskImageData() {
    // Check if mask video is ready
    if (!maskVideoElement || maskVideoElement.readyState < 2) { // readyState 2 (HAVE_CURRENT_DATA) or higher
        console.warn('Cannot update mask image data: mask video not ready');
        maskImageData = null; // Ensure data is cleared if video not ready
        return;
    }

    try {
        // Get current canvas dimensions
        const canvasWidth = baseCanvas.width;
        const canvasHeight = baseCanvas.height;

        // Only update if dimensions are valid
        if (canvasWidth <= 0 || canvasHeight <= 0) {
             console.warn(`Skipping mask update due to invalid dimensions: ${canvasWidth}x${canvasHeight}`);
             maskImageData = null;
             return;
        }

        console.log(`Updating mask image data from video frame to ${canvasWidth}x${canvasHeight}`);

        // Draw current mask video frame to a temporary canvas to get its imageData
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasWidth;
        tempCanvas.height = canvasHeight;
        const tempCtx = tempCanvas.getContext('2d');

        // Draw the video frame onto the temp canvas
        // Make sure the video has dimensions before drawing
        if (maskVideoElement.videoWidth > 0 && maskVideoElement.videoHeight > 0) {
            // Calculate proper scaling to maintain aspect ratio
            const maskAspect = maskVideoElement.videoWidth / maskVideoElement.videoHeight;
            const canvasAspect = canvasWidth / canvasHeight;
            
            let drawWidth = canvasWidth;
            let drawHeight = canvasHeight;
            let drawX = 0;
            let drawY = 0;
            
            // Calculate dimensions to maintain aspect ratio while filling canvas
            if (maskAspect > canvasAspect) {
                // Mask video is wider than canvas
                drawHeight = canvasWidth / maskAspect;
                drawY = (canvasHeight - drawHeight) / 2;
            } else {
                // Mask video is taller than canvas
                drawWidth = canvasHeight * maskAspect;
                drawX = (canvasWidth - drawWidth) / 2;
            }
            
            tempCtx.drawImage(maskVideoElement, drawX, drawY, drawWidth, drawHeight);
            maskImageData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            console.log(`Mask image data updated from video frame: ${maskImageData.width}x${maskImageData.height}`);
        } else {
             console.warn('Mask video dimensions are zero, cannot draw frame.');
             maskImageData = null;
        }
    } catch (err) {
        console.error("Error updating mask image data from video:", err);
        maskImageData = null;
    }
}

// Add this new function to check if video dimensions are valid
function checkVideoDimensions() {
    if (videoElement && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        console.log(`Video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
        return true;
    }
    console.warn('Video dimensions not available or zero');
    return false;
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
            // Parse the selected resolution from config
            const { width, height } = parseResolution(settings.selectedResolution);

            // Build constraints based on settings from config
            const constraints = {
                video: {
                    width: { ideal: width },
                    height: { ideal: height }
                }
            };

            // Add device ID if one is specified in the config
            if (settings.selectedCamera) {
                constraints.video.deviceId = { exact: settings.selectedCamera };
            } else {
                // If no camera is specified in config, log a warning
                console.warn("No 'selectedCamera' specified in config.json. Attempting default camera.");
                // Let the browser choose the default camera by not specifying deviceId
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
 * Draws the base layer with webcam and mask overlay (now from video)
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
        ctx.save(); // Save context state
        if (settings.flipWebcam) {
            ctx.scale(-1, 1);
            ctx.translate(-width, 0);
        }
        
        // Scale up from process resolution to display resolution
        // Use video element's actual dimensions to calculate correct scaling
        const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
        const canvasAspect = width / height;
        
        let drawWidth = width;
        let drawHeight = height;
        let drawX = 0;
        let drawY = 0;
        
        // Calculate dimensions to maintain aspect ratio while filling canvas
        if (videoAspect > canvasAspect) {
            // Video is wider than canvas
            drawHeight = width / videoAspect;
            drawY = (height - drawHeight) / 2;
        } else {
            // Video is taller than canvas
            drawWidth = height * videoAspect;
            drawX = (width - drawWidth) / 2;
        }
        
        // Draw the video with correct scaling
        ctx.drawImage(videoElement, drawX, drawY, drawWidth, drawHeight);
        ctx.restore(); // Restore context state
    }

    // Draw mask overlay if enabled (using the mask video)
    // Check if video is ready (at least metadata loaded)
    if (settings.showMaskOverlay && maskVideoElement.readyState >= 1) { // HAVE_METADATA
        ctx.globalAlpha = settings.maskOpacity; // Use the mask opacity setting
        try {
            // Scale mask video to fit canvas properly
            const maskAspect = maskVideoElement.videoWidth / maskVideoElement.videoHeight;
            const canvasAspect = width / height;
            
            let drawWidth = width;
            let drawHeight = height;
            let drawX = 0;
            let drawY = 0;
            
            // Calculate dimensions to maintain aspect ratio while filling canvas
            if (maskAspect > canvasAspect) {
                // Video is wider than canvas
                drawHeight = width / maskAspect;
                drawY = (height - drawHeight) / 2;
            } else {
                // Video is taller than canvas
                drawWidth = height * maskAspect;
                drawX = (width - drawWidth) / 2;
            }
            
            ctx.drawImage(maskVideoElement, drawX, drawY, drawWidth, drawHeight);
        } catch (e) {
            // Catch potential errors if the video state changes unexpectedly
            console.warn("Could not draw mask video frame to base layer:", e);
        }
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
        // Scale based on processing resolution to display resolution
        const scaleFactorX = width / videoWidth;
        const scaleFactorY = height / videoHeight;
        drawSilhouetteToContext(pose, tempCtx, smallWidth / videoWidth, smallHeight / videoHeight);

        // Now draw the pixelated silhouette back to the main canvas
        // Turn OFF image smoothing to keep the chunky pixelated look
        ctx.imageSmoothingEnabled = false;
        ctx.save(); // Save context state
        if (settings.flipWebcam) {
            // Flip the target canvas if webcam is flipped
            ctx.scale(-1, 1);
            ctx.translate(-width, 0);
        }
        ctx.drawImage(tempCanvas, 0, 0, smallWidth, smallHeight, 0, 0, width, height);
        ctx.restore(); // Restore context state

        // Reset alpha
        ctx.globalAlpha = 1.0;
    } else {
        // Regular drawing with no pixelation
        // Scale based on processing resolution to display resolution
        const scaleX = width / videoWidth;
        const scaleY = height / videoHeight;

        // Set silhouette style
        ctx.fillStyle = settings.silhouetteColor;
        ctx.globalAlpha = settings.silhouetteOpacity;

        // Disable smoothing
        ctx.imageSmoothingEnabled = false;

        // Draw the silhouette directly to the main canvas
        ctx.save(); // Save context state
        if (settings.flipWebcam) {
            // Flip the target canvas if webcam is flipped
            ctx.scale(-1, 1);
            ctx.translate(-width, 0);
        }
        drawSilhouetteToContext(pose, ctx, scaleX, scaleY);
        ctx.restore(); // Restore context state

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
    // Scale based on processing resolution to display resolution
    const scaleX = width / videoWidth;
    const scaleY = height / videoHeight;

    // Save context state before potential flip
    ctx.save();

    // Apply flip transformation if needed
    if (settings.flipWebcam) {
        ctx.scale(-1, 1);
        ctx.translate(-width, 0);
    }

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

    // Restore context state after drawing
    ctx.restore();
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
    const pixelCount = Math.min(maskData.length, bodyData.length) / 4; // RGBA = 4 values per pixel

    // Compare each pixel
    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;

        // A pixel is considered a mask pixel if it's bright (white mask)
        const isMaskPixel = maskData[offset] > 200; // Red channel > 200 in mask

        // A pixel from the silhouette is active if it has any opacity
        const isBodyPixel = bodyData[offset + 3] > 30; // Alpha threshold

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
    // Get the actual canvas dimensions (display resolution)
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // Clear the canvas first
    ctx.clearRect(0, 0, width, height);

    // If difference layer is disabled, just return
    if (!settings.showDifference) {
        return;
    }

    // Check if the mask video is ready to provide data
    if (!maskVideoElement || maskVideoElement.readyState < 2) { // HAVE_CURRENT_DATA
        console.log("Mask video not ready - can't draw difference layer");
        scoreElement.textContent = `Score: Waiting for mask...`; // Provide feedback
        return;
    }

    // Update the mask image data with the current video frame at display resolution
    updateMaskImageData();

    // If still no mask data after trying to update, we can't proceed
    if (!maskImageData) {
        console.error("Failed to create mask image data from video frame");
        scoreElement.textContent = `Score: Error getting mask frame`;
        return;
    }

    try {
        // Create a temporary canvas to generate the silhouette data at display resolution
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // Use the current pose data from the main detection loop
        if (currentPose) {
            // Draw the silhouette to the temp canvas at display resolution
            drawSilhouette(currentPose, tempCtx);
        } else {
            // Draw a simple debug circle if no pose is detected
            tempCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            tempCtx.beginPath();
            tempCtx.arc(width / 2, height / 2, 20, 0, Math.PI * 2);
            tempCtx.fill();
        }

        // Get the silhouette data from the temp canvas at display resolution
        const silhouetteData = tempCtx.getImageData(0, 0, width, height);

        // Direct pixel manipulation for maximum performance and reliability
        const diffImageData = ctx.createImageData(width, height);
        const diffData = diffImageData.data;
        const maskData = maskImageData.data;
        const silData = silhouetteData.data;

        // Pixel count for scoring
        let overlapCount = 0;
        let maskCount = 0;
        let silhouetteCount = 0;

        // Process each pixel
        for (let i = 0; i < diffData.length; i += 4) {
            // A pixel from the mask is considered active if it's bright (white mask)
            // Use the same logic assuming the video mask is white on black
            const isMaskPixel = maskData[i] > 200;

            // A pixel from the silhouette is active if it has any opacity
            const isSilhouettePixel = silData[i + 3] > 30; // Alpha channel with threshold

            if (isMaskPixel) maskCount++;
            if (isSilhouettePixel) silhouetteCount++;

            // If both are active, we have an overlap
            if (isMaskPixel && isSilhouettePixel) {
                // Set to bright green for overlap
                diffData[i] = 0;       // R
                diffData[i + 1] = 255; // G
                diffData[i + 2] = 0;   // B
                diffData[i + 3] = 255; // A (fully opaque)
                overlapCount++;
            } else {
                // No overlap - transparent
                diffData[i] = 0;
                diffData[i + 1] = 0;
                diffData[i + 2] = 0;
                diffData[i + 3] = 0;
            }
        }

        // Put the difference data directly onto the canvas
        ctx.putImageData(diffImageData, 0, 0);

        // Calculate and update score (if mask has any pixels)
        if (maskCount > 0 && silhouetteCount > 0) {
            // Calculate how much of the mask is covered by silhouette
            const coverageScore = Math.round((overlapCount / maskCount) * 100);
            scoreElement.textContent = `Score: ${coverageScore}%`;
            
            // Log detailed scores for debugging/tuning
            console.log(`Score: ${coverageScore}% (Overlap: ${overlapCount}, Mask: ${maskCount}, Silhouette: ${silhouetteCount}, Resolution: ${width}x${height})`);
        } else if (maskCount === 0 && silhouetteCount > 0) {
             scoreElement.textContent = `Score: 0% (No mask pixels detected)`;
        } else {
            scoreElement.textContent = `Score: 0%`;
        }

    } catch (err) {
        console.error("Error drawing difference layer:", err);
        scoreElement.textContent = `Score: Error`;
    }
}

// Variable to store the current pose data for sharing between functions
let currentPose = null;

/**
 * Updates UI controls to match current settings.
 */
function updateControlsUI() {
    // Keep updates for controls that still exist (if any)
    // Example: Update flip checkbox if it remains
    // Ensure element exists before accessing .checked
    const flipWebcamCheckbox = document.getElementById('flip-webcam');
    if (flipWebcamCheckbox) {
        flipWebcamCheckbox.checked = settings.flipWebcam;
    }
    // Update camera/resolution selects if needed (though typically done on load/apply)
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
        settings.processResolution = processResolutionSelect.value;

        // Restart webcam with new settings
        await setupWebcam();

        // Update canvas dimensions for display resolution
        const { width: displayWidth, height: displayHeight } = parseResolution(settings.selectedResolution);
        
        // Set process dimensions for CV operations
        const { width: processWidth, height: processHeight } = parseResolution(settings.processResolution);
        videoWidth = processWidth;
        videoHeight = processHeight;
        
        // Update all dimensions
        updateCanvasDimensions(processWidth, processHeight);

        // Restart detection loop
        detectionLoop();

        // Hide loading screen
        loadingElement.style.display = 'none';
        mainElement.style.display = 'block';
        
        console.log(`Applied settings - Display: ${displayWidth}x${displayHeight}, Process: ${processWidth}x${processHeight}`);
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
    
    // Set internal canvas resolution to display width/height
    canvases.forEach(canvas => {
        canvas.width = displayWidth;  // Always use display resolution for canvases
        canvas.height = displayHeight;
        
        // Do NOT set CSS dimensions - let CSS handle the scaling
        // This allows canvas to properly scale down within its container
        // Remove any inline styles that might interfere with CSS scaling
        canvas.style.width = '';
        canvas.style.height = '';
    });

    // Update global variables
    videoWidth = width;  // Processing resolution
    videoHeight = height;

    // Recreate mask image data (since dimensions might have changed)
    updateMaskImageData();
    
    console.log(`Canvas dimensions set to: ${displayWidth}x${displayHeight} (internal resolution)`);
}

/**
 * Initialize control panel event listeners.
 */
function setupControlListeners() {
    // Fullscreen toggle
    if (fullscreenButton) {
        fullscreenButton.addEventListener('click', toggleFullscreen);
    }
    
    // REMOVED: Camera controls listeners
    /*
    applyCameraButton.addEventListener('click', () => {
        applyCameraSettings();
    });
    
    // Process resolution controls
    processResolutionSelect.addEventListener('change', (e) => {
        // Just store the value, it will be applied when the Apply button is clicked
        console.log(`Process resolution selection changed to: ${e.target.value}`);
    });
    */

    // Layer visibility toggles - REMOVED
    /*
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
    */

    // Flip webcam toggle - REMOVED as element is gone
    /*
    const flipWebcamCheckbox = document.getElementById('flip-webcam');
    if (flipWebcamCheckbox) {
        flipWebcamCheckbox.addEventListener('change', (e) => {
            settings.flipWebcam = e.target.checked;
            // No immediate redraw needed, loop will handle it
        });
    }
    */

    // Mask opacity control - REMOVED
    /*
    document.getElementById('mask-opacity').addEventListener('input', (e) => {
        settings.maskOpacity = parseInt(e.target.value) / 100;
        document.getElementById('mask-opacity-value').textContent = `${e.target.value}%`;
    });
    */

    // Skeleton style controls - REMOVED
    /*
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
    */

    // Silhouette style controls - REMOVED
    /*
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
    */

    // Reset button - REMOVED
    /*
    document.getElementById('reset-controls').addEventListener('click', () => {
        settings = { ...defaultConfig }; // Reset to the loaded default config
        updateControlsUI();
        // Update canvas visibility for all layers
        silhouetteCanvas.style.display = settings.showSilhouette ? 'block' : 'none';
        skeletonCanvas.style.display = settings.showSkeleton ? 'block' : 'none';
        differenceCanvas.style.display = settings.showDifference ? 'block' : 'none';
    });
    */
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
    
    // Check if video dimensions are available and valid
    if (!checkVideoDimensions()) {
        // If dimensions aren't available yet, try again in the next frame
        animationFrameId = requestAnimationFrame(detectionLoop);
        return;
    }

    // Get display dimensions
    const canvasWidth = displayWidth;
    const canvasHeight = displayHeight;

    // Set canvas dimensions for all canvases if they don't match display dimensions
    const canvases = [baseCanvas, silhouetteCanvas, differenceCanvas, skeletonCanvas];
    let dimensionsChanged = false;

    canvases.forEach(canvas => {
        if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            dimensionsChanged = true;
        }
    });

    // Make sure difference canvas is visible
    differenceCanvas.style.display = settings.showDifference ? 'block' : 'none';

    // If dimensions changed, update the mask data
    if (dimensionsChanged) {
        console.log(`Canvas dimensions updated to ${canvasWidth}x${canvasHeight}`);
        updateMaskImageData();
    }

    try {
        // Create a temporary scaled-down canvas for pose detection
        // This improves performance while maintaining high display resolution
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = videoWidth;  // Processing width
        tempCanvas.height = videoHeight; // Processing height
        const tempCtx = tempCanvas.getContext('2d');
        
        // Calculate scaling factors to maintain aspect ratio when drawing the video
        const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
        const canvasAspect = videoWidth / videoHeight;
        
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = videoElement.videoWidth;
        let sourceHeight = videoElement.videoHeight;
        
        // Crop the video to match the target aspect ratio
        if (videoAspect > canvasAspect) {
            // Video is wider, crop sides
            sourceWidth = videoElement.videoHeight * canvasAspect;
            sourceX = (videoElement.videoWidth - sourceWidth) / 2;
        } else if (videoAspect < canvasAspect) {
            // Video is taller, crop top/bottom
            sourceHeight = videoElement.videoWidth / canvasAspect;
            sourceY = (videoElement.videoHeight - sourceHeight) / 2;
        }
        
        // Draw the video onto the temp canvas (scaling down if needed)
        tempCtx.drawImage(
            videoElement, 
            sourceX, sourceY, sourceWidth, sourceHeight, // Source rectangle
            0, 0, videoWidth, videoHeight                // Destination rectangle
        );
        
        // Get pose estimation from the scaled-down image
        const poses = await poseDetector.estimatePoses(tempCanvas, {
            flipHorizontal: false, // Let the drawing functions handle flipping based on settings.flipWebcam
            maxPoses: 1           // Only detect one person
        });

        // Get the first detected pose (if any)
        currentPose = poses && poses.length > 0 ? poses[0] : null;

        // Draw on each canvas layer
        drawBaseLayer(baseCtx);

        if (settings.showSilhouette && currentPose) {
            drawSilhouette(currentPose, silhouetteCtx);
        } else {
            silhouetteCtx.clearRect(0, 0, canvasWidth, canvasHeight);
        }

        if (settings.showSkeleton && currentPose) {
            drawSkeleton(currentPose, skeletonCtx);
        } else {
            skeletonCtx.clearRect(0, 0, canvasWidth, canvasHeight);
        }

        // Make sure difference layer gets drawn last and independently
        if (settings.showDifference) {
            drawDifferenceLayer(differenceCtx);
        } else {
            differenceCtx.clearRect(0, 0, canvasWidth, canvasHeight);
        }
    } catch (error) {
        console.error('Error in detection loop:', error);
    }

    // Request next frame
    animationFrameId = requestAnimationFrame(detectionLoop);
}

/**
 * Initializes the application: loads model, webcam, mask video, and starts loop.
 */
async function main() {
    try {
        // Set initial display dimensions immediately
        displayWidth = 1920;
        displayHeight = 1080;

        // Apply dimensions to all canvases
        const canvases = [baseCanvas, silhouetteCanvas, differenceCanvas, skeletonCanvas];
        canvases.forEach(canvas => {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            // Don't set inline styles - let CSS handle visual scaling
            canvas.style.width = '';
            canvas.style.height = '';
        });

        // Draw test pattern to verify canvas works
        drawTestPattern(baseCtx);

        // Check if TensorFlow.js is available
        if (!tf) {
            throw new Error('TensorFlow.js is not loaded. Check script includes in HTML.');
        }

        // Load configuration first
        loadingElement.textContent = 'Loading configuration...';
        const configLoaded = await loadConfig();
        if (!configLoaded) {
            // Stop initialization if config fails to load
            return;
        }

        // Setup control panel
        setupControlListeners();
        updateControlsUI();

        // Initialize TensorFlow.js and load pose detector
        loadingElement.textContent = 'Initializing TensorFlow.js...';
        const detectorLoaded = await loadPoseDetector();
        if (!detectorLoaded) {
            throw new Error('Failed to load pose detector.');
        }

        // Wait for the mask video to be ready instead of loading mask image
        loadingElement.textContent = 'Waiting for mask video...';
        await waitForMaskVideoReady(); // Add this new helper function
        console.log('Mask video ready.');

        // Setup webcam with current settings (now loaded from config)
        loadingElement.textContent = 'Accessing webcam using config settings...';
        await setupWebcam();

        // REMOVED: UI dropdown setup logic
        /*
        // Set process resolution dropdown from config
        processResolutionSelect.value = settings.processResolution;
        
        // Set resolution dropdown to match actual video dimensions or config default
        const actualResolution = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
        const resolutionExists = Array.from(resolutionSelect.options).some(option => option.value === actualResolution);
        if (!resolutionExists) {
            const option = document.createElement('option');
            option.value = actualResolution;
            option.text = `${actualResolution} (Current)`;
            resolutionSelect.add(option, 0);
            // Use actual resolution if it's different from config and wasn't listed
            resolutionSelect.value = actualResolution;
            settings.selectedResolution = actualResolution;
        } else {
            // If actual resolution exists, use it; otherwise, use config value
            resolutionSelect.value = actualResolution;
            if (resolutionSelect.value !== actualResolution) {
                 resolutionSelect.value = settings.selectedResolution;
            }
            settings.selectedResolution = resolutionSelect.value;
        }
        
        // Ensure initial camera selection matches config or first available
        if (settings.selectedCamera && Array.from(cameraSelect.options).some(opt => opt.value === settings.selectedCamera)) {
            cameraSelect.value = settings.selectedCamera;
        } else if (cameraSelect.options.length > 0) {
            settings.selectedCamera = cameraSelect.value; // Update setting if config value wasn't valid
        }

        // Update UI controls to reflect loaded config/initial state
        updateControlsUI();
        */
        
        // Ensure canvas dimensions are set to display resolution (from config)
        const { width: displayWidthConf, height: displayHeightConf } = parseResolution(settings.selectedResolution);
        displayWidth = displayWidthConf;
        displayHeight = displayHeightConf;

        // Update videoWidth/Height based on processResolution from config
        const { width: processWidth, height: processHeight } = parseResolution(settings.processResolution);
        videoWidth = processWidth;
        videoHeight = processHeight;
        updateCanvasDimensions(videoWidth, videoHeight);

        // Start detection loop
        loadingElement.style.display = 'none';
        mainElement.style.display = 'block';
        detectionLoop();

        // --- ADDED: Explicitly try to play mask video again after setup ---
        console.log('Attempting final mask video play...');
        maskVideoElement.play()
            .then(() => console.log('Final mask video play() successful.'))
            .catch(err => console.warn('Final mask video play() failed (might already be playing or blocked): ', err));
        // --- END ADDED --- 

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

    // Use display dimensions for test pattern
    ctx.canvas.width = displayWidth;
    ctx.canvas.height = displayHeight;

    // Fill with dark background
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw a visible border
    ctx.strokeStyle = '#0F0'; // Bright green
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, ctx.canvas.width - 20, ctx.canvas.height - 20);

    // Draw text
    ctx.fillStyle = '#FFF';
    ctx.font = '30px sans-serif'; // Increased font size for larger canvas
    ctx.fillText(`Canvas initialized at ${displayWidth}x${displayHeight}. Waiting for setup...`, 50, 50);
    ctx.fillText(`Processing will occur at ${videoWidth}x${videoHeight} for better performance.`, 50, 90);

    console.log(`Test pattern drawn on canvas at ${displayWidth}x${displayHeight}`);
}

// Add a helper function to wait for the mask video
async function waitForMaskVideoReady() {
    console.log(`Initial mask video readyState: ${maskVideoElement.readyState}`);
    return new Promise((resolve, reject) => {
        // Check if already ready
        if (maskVideoElement.readyState >= 2) { // HAVE_CURRENT_DATA or more
             console.log('Mask video already ready (readyState >= 2).');
            // Ensure it's playing if already ready
            if (maskVideoElement.paused) {
                console.log("Mask video was ready but paused, attempting play...");
                maskVideoElement.play().then(resolve).catch(e => {
                    console.warn("Play attempt failed in ready check:", e);
                    // Resolve anyway if data is available, but log warning
                    resolve(); 
                });
            } else {
                resolve();
            }
            return;
        }

        // Add event listeners
        const onCanPlay = () => {
             console.log(`Mask video 'canplay' event. readyState: ${maskVideoElement.readyState}`);
             // Try to play just in case autoplay failed or was blocked
             maskVideoElement.play()
                .then(() => {
                    console.log("Mask video play() successful in onCanPlay.");
                    resolve();
                })
                .catch(e => {
                    console.warn("Mask video play() failed in onCanPlay (might be okay if already playing):", e);
                    // Resolve even if play fails here, as data might still be drawable
                    resolve(); 
                });
            removeListeners();
        };

        const onError = (e) => {
            console.error('Error loading mask video:', e);
            const error = maskVideoElement.error;
            let errorMsg = 'Failed to load mask video.';
            if (error) {
                 errorMsg += ` Code: ${error.code}, Message: ${error.message}`;
            }
            reject(new Error(errorMsg + ' Check console and video path.'));
            removeListeners();
        };
        
        // Log other potentially useful events
        const onLoadedData = () => console.log(`Mask video 'loadeddata' event. readyState: ${maskVideoElement.readyState}`);
        const onPlaying = () => console.log(`Mask video 'playing' event.`);
        const onWaiting = () => console.log(`Mask video 'waiting' event.`);
        const onStalled = () => console.log(`Mask video 'stalled' event.`);

        const removeListeners = () => {
            maskVideoElement.removeEventListener('canplay', onCanPlay);
            maskVideoElement.removeEventListener('error', onError);
            maskVideoElement.removeEventListener('loadeddata', onLoadedData);
            maskVideoElement.removeEventListener('playing', onPlaying);
            maskVideoElement.removeEventListener('waiting', onWaiting);
            maskVideoElement.removeEventListener('stalled', onStalled);
        };

        maskVideoElement.addEventListener('canplay', onCanPlay);
        maskVideoElement.addEventListener('error', onError);
        maskVideoElement.addEventListener('loadeddata', onLoadedData);
        maskVideoElement.addEventListener('playing', onPlaying);
        maskVideoElement.addEventListener('waiting', onWaiting);
        maskVideoElement.addEventListener('stalled', onStalled);

         // Optional: Set a timeout in case 'canplay' never fires
         // Increased timeout slightly
         const timeoutDuration = 15000; // 15 seconds
         setTimeout(() => {
             if (maskVideoElement.readyState < 2) {
                 console.warn(`Mask video readyState (${maskVideoElement.readyState}) did not reach 2 within ${timeoutDuration / 1000}s.`);
                 // Resolve if metadata is available, reject otherwise
                 if (maskVideoElement.readyState >= 1) { // HAVE_METADATA
                    console.log("Mask video has metadata, proceeding with caution.");
                    resolve(); // Allow proceeding if at least metadata is loaded
                 } else {
                    reject(new Error('Mask video did not become ready in time (readyState < 1).'));
                 }
                 removeListeners();
             }
         }, timeoutDuration); 
    });
}

/**
 * Toggles fullscreen mode for the canvas container
 */
function toggleFullscreen() {
    if (!canvasContainer) return;
    
    if (canvasContainer.classList.contains('fullscreen')) {
        // Exit fullscreen
        canvasContainer.classList.remove('fullscreen');
        fullscreenButton.textContent = '⤢'; // Expand icon
        
        // Check if browser is in fullscreen mode and exit
        if (document.fullscreenElement) {
            document.exitFullscreen()
                .catch(err => console.error('Error exiting fullscreen:', err));
        }
    } else {
        // Enter fullscreen
        canvasContainer.classList.add('fullscreen');
        fullscreenButton.textContent = '⤡'; // Collapse icon
        
        // Try to request fullscreen on the container
        try {
            if (canvasContainer.requestFullscreen) {
                canvasContainer.requestFullscreen()
                    .catch(err => console.warn('Fullscreen request was rejected:', err));
            }
        } catch (err) {
            console.warn('Fullscreen API not supported, using CSS fallback');
        }
    }
    
    // Force a resize event to make sure canvas dimensions update
    window.dispatchEvent(new Event('resize'));
}

async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        defaultConfig = await response.json();
        settings = { ...defaultConfig }; // Initialize current settings with defaults
        console.log('Configuration loaded:', defaultConfig);
        return true;
    } catch (error) {
        console.error('Failed to load config.json:', error);
        loadingElement.textContent = 'Error: Could not load configuration file (config.json).';
        // Optionally: fallback to some hardcoded minimal settings
        settings = { /* provide minimal fallback settings here if needed */ };
        return false;
    }
}
