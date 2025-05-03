// Canvas drawing functions (skeleton, mask overlap) 

// --- Constants for Drawing ---

// Define connections between keypoints for drawing lines (using COCO keypoint indices)
// Exporting in case it's useful for consumers of the module
export const POSE_CONNECTIONS = [
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
// Not exporting this by default, as it's an internal detail of drawSilhouette
const BODY_PARTS = {
    head: [0, 1, 2, 3, 4], // Nose, eyes, ears
    torso: [5, 6, 11, 12], // Shoulders and hips
    leftArm: [5, 7, 9], // Left shoulder to left wrist
    rightArm: [6, 8, 10], // Right shoulder to right wrist
    leftLeg: [11, 13, 15], // Left hip to left ankle
    rightLeg: [12, 14, 16]  // Right hip to right ankle
};

// Confidence score threshold for drawing keypoints/limbs
const DEFAULT_SCORE_THRESHOLD = 0.2;

// --- Internal Helper Functions ---

/**
 * Finds a specific keypoint by name from the pose keypoints array.
 * @param {Array<object>} keypoints - Array of keypoints from the pose.
 * @param {string} name - The name of the keypoint to find (e.g., 'left_shoulder').
 * @returns {object|null} The keypoint object or null if not found.
 */
function findKeypoint(keypoints, name) {
    return keypoints.find(kp => kp.name === name) || null;
} 

// --- Exported Drawing Functions ---

/**
 * Draws the pose skeleton (keypoints and connecting lines) onto a canvas,
 * scaling the pose from its original processing dimensions to the target canvas size.
 * 
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context to draw on (likely high-res output canvas).
 * @param {poseDetection.Pose} pose - The detected pose object (with keypoints relative to processing dimensions).
 * @param {object} [config={}] - Drawing configuration.
 * @param {string} [config.keypointColor='red'] - Color for keypoints.
 * @param {number} [config.keypointRadius=3] - Radius for keypoints.
 * @param {string} [config.lineColor='white'] - Color for skeleton lines.
 * @param {number} [config.lineWidth=2] - Width for skeleton lines.
 * @param {number} [config.scoreThreshold=DEFAULT_SCORE_THRESHOLD] - Minimum confidence score to draw a keypoint/line.
 * @param {number} processingWidth - The width the pose coordinates are relative to.
 * @param {number} processingHeight - The height the pose coordinates are relative to.
 */
export function drawSkeleton(ctx, pose, config = {}, processingWidth, processingHeight) {
    const { keypoints } = pose;
    const { 
        keypointColor = 'red', 
        keypointRadius = 3, 
        lineColor = 'white', 
        lineWidth = 2, 
        scoreThreshold = DEFAULT_SCORE_THRESHOLD 
    } = config;

    // Get target canvas dimensions
    const displayWidth = ctx.canvas.width;
    const displayHeight = ctx.canvas.height;
    
    // Calculate scaling factors
    const scaleX = (processingWidth > 0) ? displayWidth / processingWidth : 1;
    const scaleY = (processingHeight > 0) ? displayHeight / processingHeight : 1;

    // Draw keypoints
    ctx.fillStyle = keypointColor;
    keypoints.forEach(keypoint => {
        if (keypoint.score >= scoreThreshold) {
            ctx.beginPath();
            // Scale keypoint position
            ctx.arc(keypoint.x * scaleX, keypoint.y * scaleY, keypointRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    });

    // Draw lines (skeleton)
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    POSE_CONNECTIONS.forEach(([i, j]) => {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        if (kp1 && kp2 && kp1.score >= scoreThreshold && kp2.score >= scoreThreshold) {
            ctx.beginPath();
            // Scale line points
            ctx.moveTo(kp1.x * scaleX, kp1.y * scaleY);
            ctx.lineTo(kp2.x * scaleX, kp2.y * scaleY);
            ctx.stroke();
        }
    });
} 

/**
 * Draws a thick path connecting a series of points.
 * Uses quadratic curves for smoother connections.
 * @param {CanvasRenderingContext2D} ctx - The drawing context.
 * @param {Array<object>} points - Array of {x, y} points.
 * @param {number} thickness - The desired thickness (line width).
 */
function drawThickPath(ctx, points, thickness) {
    if (points.length < 2) return;

    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    // Draw the last segment
    if (points.length > 1) {
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }

    ctx.stroke();
}

/**
 * Draws a single limb segment using a thick path.
 * @param {CanvasRenderingContext2D} ctx - The drawing context.
 * @param {Array<object>} keypoints - The pose keypoints array.
 * @param {Array<number>} keypointIndices - Indices of keypoints forming the limb.
 * @param {number} thickness - The thickness for the limb.
 * @param {number} scoreThreshold - Minimum score for a keypoint to be included.
 */
function drawLimb(ctx, keypoints, keypointIndices, thickness, scoreThreshold) {
    const limbPoints = keypointIndices
        .map(index => keypoints[index])
        .filter(kp => kp && kp.score >= scoreThreshold) // Ensure keypoint exists and is confident
        .map(kp => ({ x: kp.x, y: kp.y }));

    if (limbPoints.length >= 2) {
        drawThickPath(ctx, limbPoints, thickness);
    }
}

/**
 * Draws a filled polygon representing a body segment (like the torso).
 * @param {CanvasRenderingContext2D} ctx - The drawing context.
 * @param {Array<object>} keypoints - The pose keypoints array.
 * @param {Array<number>} keypointIndices - Indices forming the polygon vertices.
 * @param {number} scoreThreshold - Minimum score for a vertex to be included.
 */
function drawBodySegment(ctx, keypoints, keypointIndices, scoreThreshold) {
    const segmentPoints = keypointIndices
        .map(index => keypoints[index])
        .filter(kp => kp && kp.score >= scoreThreshold);

    if (segmentPoints.length >= 3) { // Need at least 3 points for a polygon
        ctx.beginPath();
        ctx.moveTo(segmentPoints[0].x, segmentPoints[0].y);
        for (let i = 1; i < segmentPoints.length; i++) {
            ctx.lineTo(segmentPoints[i].x, segmentPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();
        // Optionally stroke for definition
        // ctx.stroke(); 
    }
}

/**
 * Draws the main body silhouette based on detected keypoints onto a given context.
 * This function handles the drawing logic internally.
 * @param {poseDetection.Pose} pose - The detected pose object.
 * @param {CanvasRenderingContext2D} ctx - The context to draw onto.
 * @param {object} config - Drawing configuration.
 * @param {number} [config.limbThickness=20] - Thickness for arms and legs.
 * @param {string} [config.fillColor='white'] - Color to fill the silhouette.
 * @param {number} [config.scoreThreshold=DEFAULT_SCORE_THRESHOLD] - Min confidence score.
 */
function drawSilhouetteToContext(pose, ctx, config) {
    const { keypoints } = pose;
    const { 
        limbThickness = 20, 
        fillColor = 'white', 
        scoreThreshold = DEFAULT_SCORE_THRESHOLD 
    } = config;

    // Set drawing styles
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor; // Stroke with the same color for thicker lines

    // Draw Torso (filled polygon)
    drawBodySegment(ctx, keypoints, BODY_PARTS.torso, scoreThreshold);

    // Draw Limbs (thick lines)
    drawLimb(ctx, keypoints, BODY_PARTS.leftArm, limbThickness, scoreThreshold);
    drawLimb(ctx, keypoints, BODY_PARTS.rightArm, limbThickness, scoreThreshold);
    drawLimb(ctx, keypoints, BODY_PARTS.leftLeg, limbThickness, scoreThreshold);
    drawLimb(ctx, keypoints, BODY_PARTS.rightLeg, limbThickness, scoreThreshold);

    // Optionally draw head (e.g., a circle)
    const nose = findKeypoint(keypoints, 'nose');
    const leftEar = findKeypoint(keypoints, 'left_ear');
    const rightEar = findKeypoint(keypoints, 'right_ear');
    if (nose && nose.score >= scoreThreshold) {
        // Approximate head radius based on ear distance or default size
        let headRadius = limbThickness * 1.5;
        if (leftEar && rightEar && leftEar.score >= scoreThreshold && rightEar.score >= scoreThreshold) {
            headRadius = Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y) / 2 * 1.5; // A bit larger than half ear dist
        }
        ctx.beginPath();
        ctx.arc(nose.x, nose.y, Math.max(headRadius, limbThickness / 2), 0, 2 * Math.PI);
        ctx.fill();
    }
}

/**
 * Exported function to draw the body silhouette.
 * This might draw onto a temporary canvas first if complex compositing is needed.
 * For now, draws directly onto the provided context.
 * @param {CanvasRenderingContext2D} ctx - The main canvas context to draw the final silhouette on.
 * @param {poseDetection.Pose} pose - The detected pose object.
 * @param {object} [config={}] - Drawing configuration (passed to drawSilhouetteToContext).
 */
export function drawSilhouette(ctx, pose, config = {}) {
    if (!pose || !pose.keypoints) {
        console.warn('drawSilhouette called without valid pose data.');
        return;
    }
    // For now, draw directly onto the context. 
    // Could be modified to draw on a temporary canvas if needed.
    drawSilhouetteToContext(pose, ctx, config);
}

/**
 * Draws the base video feed onto a canvas, optionally flipped.
 * @param {CanvasRenderingContext2D} ctx - The canvas context to draw on.
 * @param {HTMLVideoElement} videoElement - The video element source.
 * @param {boolean} [flipHorizontal=false] - Whether to flip the video horizontally.
 */
export function drawBaseLayer(ctx, videoElement, flipHorizontal = false) {
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight); // Clear previous frame

    if (videoElement && videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
        if (flipHorizontal) {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.translate(-canvasWidth, 0);
            ctx.drawImage(videoElement, 0, 0, canvasWidth, canvasHeight);
            ctx.restore();
        } else {
            ctx.drawImage(videoElement, 0, 0, canvasWidth, canvasHeight);
        }
    } else {
        console.warn('drawBaseLayer: Video element not ready.');
        // Optionally draw a placeholder or background
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText('Webcam not available', canvasWidth / 2, canvasHeight / 2);
    }
}

/**
 * Draws the body silhouette colored based on overlap with a mask.
 * It iterates through pixels to compare the drawn silhouette against mask data.
 * 
 * @param {CanvasRenderingContext2D} ctx - The main canvas context to draw the final result on.
 * @param {poseDetection.Pose} pose - The detected pose object.
 * @param {ImageData | null} maskImageData - The ImageData object for the current mask frame.
 * @param {object} [config={}] - Drawing configuration.
 * @param {string} [config.overlapColor='lime'] - Color for body parts overlapping the mask.
 * @param {string} [config.nonOverlapColor='red'] - Color for body parts not overlapping.
 * @param {number} [config.silhouetteThreshold=128] - Alpha threshold to consider a silhouette pixel 'on'.
 * @param {number} [config.maskThreshold=128] - Value threshold to consider a mask pixel 'on' (assuming grayscale).
 * @param {boolean} [config.drawBackground=false] - If true, draws non-silhouette pixels transparent, otherwise uses colors.
 * @param {object} [config.silhouetteConfig] - Configuration passed to drawSilhouetteToContext (thickness, etc.)
 */
export function drawBodyWithOverlap(ctx, pose, maskImageData, config = {}) {
    const { 
        overlapColor = 'lime', 
        nonOverlapColor = 'red', 
        silhouetteThreshold = 128, // Alpha value threshold
        maskThreshold = 128,     // Color value threshold (e.g., for white mask on black bg)
        drawBackground = false, // If false, only draws silhouette parts
        silhouetteConfig = {} // Config for drawSilhouetteToContext (limbThickness etc)
    } = config;

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    if (!pose || !pose.keypoints || !maskImageData) {
        // console.warn('drawBodyWithOverlap: Missing pose or maskImageData.');
        // Optionally clear or draw a default state
        // ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return; // Exit if essential data is missing
    }

    if (maskImageData.width !== canvasWidth || maskImageData.height !== canvasHeight) {
        console.warn(`Mask dimensions (${maskImageData.width}x${maskImageData.height}) mismatch canvas (${canvasWidth}x${canvasHeight}). Cannot accurately compare.`);
        // Optionally draw only the non-colored silhouette or return
        ctx.fillStyle = nonOverlapColor;
        drawSilhouetteToContext(pose, ctx, { ...silhouetteConfig, fillColor: nonOverlapColor });
        return;
    }

    // 1. Create a temporary canvas for the silhouette
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasWidth;
    tempCanvas.height = canvasHeight;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    // 2. Draw the silhouette onto the temporary canvas
    // Ensure silhouette is drawn with a consistent color (e.g., white) for easy thresholding
    const internalSilhouetteConfig = { ...silhouetteConfig, fillColor: 'white' };
    drawSilhouetteToContext(pose, tempCtx, internalSilhouetteConfig);

    // 3. Get the ImageData for the drawn silhouette
    const silhouetteImageData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight);

    // 4. Prepare the output ImageData (or draw directly)
    // Drawing directly might be faster than creating/putting ImageData
    // Clear the main context before drawing the colored result
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    const silhouetteData = silhouetteImageData.data;
    const maskData = maskImageData.data;

    // Pre-calculate colors to avoid parsing strings repeatedly
    // Note: This basic approach doesn't handle color parsing robustly (e.g. hex, rgba)
    // A more robust solution would use a helper to parse colors to [r, g, b]
    const overlapCol = { r: 0, g: 255, b: 0 }; // Example: lime
    const nonOverlapCol = { r: 255, g: 0, b: 0 }; // Example: red
    
    // If drawing directly, set fill styles
    ctx.fillStyle = overlapColor;
    const overlapFill = ctx.fillStyle; // Capture the parsed color style
    ctx.fillStyle = nonOverlapColor;
    const nonOverlapFill = ctx.fillStyle; // Capture the parsed color style

    // 5. Iterate through pixels and draw colored rectangles
    for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
            const index = (y * canvasWidth + x) * 4;

            // Check silhouette pixel (using alpha channel)
            const isSilhouettePixelOn = silhouetteData[index + 3] >= silhouetteThreshold;

            if (isSilhouettePixelOn) {
                 // Check mask pixel (assuming grayscale: check R, G, or B component)
                const isMaskPixelOn = maskData[index] >= maskThreshold; // Check Red channel
                
                // Set fill color based on overlap
                ctx.fillStyle = isMaskPixelOn ? overlapFill : nonOverlapFill;
                ctx.fillRect(x, y, 1, 1); // Draw a 1x1 rectangle for the pixel
            }
            // else: If drawBackground is false, do nothing for non-silhouette pixels (leave transparent/previous content)
        }
    }
    // If using ImageData approach:
    // const outputImageData = ctx.createImageData(canvasWidth, canvasHeight);
    // const outputData = outputImageData.data;
    // ... fill outputData based on logic ...
    // ctx.putImageData(outputImageData, 0, 0);
} 