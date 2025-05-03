// Handles PoseNet setup and estimation 

/**
 * Loads the TensorFlow.js PoseNet pose detector model.
 * Assumes tf and poseDetection are loaded globally (e.g., via CDN).
 * @param {object} modelConfig - Configuration options for PoseNet.
 *                                See PoseNet documentation for details.
 *                                Example: {architecture: 'MobileNetV1', outputStride: 16, inputResolution: { width: 640, height: 480 }, multiplier: 0.75}
 * @returns {Promise<poseDetection.PoseDetector>} A promise that resolves with the loaded detector.
 */
export async function loadPosenetModel(modelConfig = {}) {
    console.log("Loading PoseNet model...");
    if (typeof poseDetection === 'undefined' || typeof tf === 'undefined') {
        console.error('TensorFlow.js or PoseDetection libraries not found. Make sure they are loaded before calling this function.');
        throw new Error('TensorFlow.js or PoseDetection libraries not loaded.');
    }

    // Default configuration if none provided
    const defaultConfig = {
        architecture: 'MobileNetV1',
        outputStride: 16,
        inputResolution: { width: 640, height: 480 }, // Adjust based on performance needs
        multiplier: 0.75 // Can be 0.50, 0.75, or 1.00 (MobileNetV1 only)
        // Add other PoseNet specific configurations if needed
    };

    const finalConfig = { ...defaultConfig, ...modelConfig };

    try {
        // Select the PoseNet model
        const model = poseDetection.SupportedModels.PoseNet;
        const detector = await poseDetection.createDetector(model, finalConfig);
        console.log("PoseNet model loaded successfully.");
        return detector;
    } catch (error) {
        console.error("Error loading PoseNet model:", error);
        throw error; // Re-throw the error for the caller to handle
    }
}

/**
 * Estimates poses from an input source (video or canvas) using the loaded PoseNet detector.
 * @param {HTMLVideoElement | HTMLCanvasElement} inputSource - The video or canvas element containing the input feed.
 * @param {poseDetection.PoseDetector} detector - The loaded PoseNet detector instance.
 * @param {object} estimationConfig - Configuration for the estimation (e.g., flipHorizontal).
 * @returns {Promise<Array<poseDetection.Pose>>} A promise that resolves with an array of detected poses.
 *                                                 Usually, contains a single pose for single-person detection.
 */
export async function estimatePose(inputSource, detector, estimationConfig = {}) {
    if (!detector) {
        console.error("Pose detector is not loaded.");
        throw new Error("Pose detector not available.");
    }
    
    // Check input source validity
    let inputReady = false;
    if (inputSource instanceof HTMLVideoElement) {
        // Check video readiness and dimensions
        if (inputSource.readyState >= inputSource.HAVE_ENOUGH_DATA && inputSource.videoWidth > 0 && inputSource.videoHeight > 0) {
            inputReady = true;
        } else {
             console.warn(`Video element not ready for pose estimation (readyState: ${inputSource?.readyState}, dimensions: ${inputSource?.videoWidth}x${inputSource?.videoHeight}). Skipping estimation.`);
        }
    } else if (inputSource instanceof HTMLCanvasElement) {
        // Check canvas dimensions
        if (inputSource.width > 0 && inputSource.height > 0) {
             inputReady = true;
        } else {
             console.warn(`Canvas input has invalid dimensions (${inputSource?.width}x${inputSource?.height}). Skipping estimation.`);
        }
    } else {
         console.error('Invalid inputSource type provided to estimatePose. Must be HTMLVideoElement or HTMLCanvasElement.');
         return [];
    }

    if (!inputReady) {
        return []; // Return empty array if input not ready
    }

    const defaultEstimationConfig = {
        flipHorizontal: false // Adjust based on webcam mirroring
        // maxPoses: 1, // If using multi-pose detection
        // scoreThreshold: 0.5, // Confidence score threshold
        // nmsRadius: 20 // Non-maximum suppression radius
    };

    const finalConfig = { ...defaultEstimationConfig, ...estimationConfig };

    try {
        // Explicitly try to read pixels into a tensor first to potentially force sync
        // Requires tf (TensorFlow core) to be available globally or imported
        if (typeof tf !== 'undefined' && typeof tf.browser !== 'undefined') {
             try {
                 // console.log('Attempting tf.browser.fromPixels...');
                 const tempTensor = await tf.browser.fromPixels(inputSource);
                 tempTensor.dispose();
                 // console.log('Temporary tensor created and disposed.');
             } catch (tensorError) {
                 console.warn('Could not create temporary tensor from input source:', tensorError);
                 // Don't halt execution, but log a warning, as estimation might still fail
             }
        } else {
            console.warn('tf.browser.fromPixels not available, skipping pre-estimation tensor creation.');
        }
        
        const poses = await detector.estimatePoses(inputSource, finalConfig);
        // For single pose detection, PoseNet often returns an array, we might want just the first pose
        // return poses.length > 0 ? poses[0] : null; // Or return the whole array depending on need
        return poses; // Returning the array allows flexibility
    } catch (error) {
        console.error("Error during pose estimation:", error);
        return []; // Return empty array on error
    }
} 