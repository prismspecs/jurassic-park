// Utility functions (e.g., video loading, setup)

/**
 * Parses a resolution string (e.g., "640x480") and returns width and height.
 * @param {string} resolutionStr - The resolution string.
 * @returns {{width: number, height: number}}
 */
export function parseResolution(resolutionStr) {
    if (typeof resolutionStr !== 'string') {
        console.error('Invalid resolution string provided:', resolutionStr);
        return { width: 0, height: 0 }; // Return default/invalid state
    }
    const parts = resolutionStr.split('x');
    if (parts.length !== 2) {
        console.error('Resolution string must be in format \"WIDTHxHEIGHT\":', resolutionStr);
        return { width: 0, height: 0 };
    }
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        console.error('Invalid width or height parsed from resolution string:', resolutionStr);
        return { width: 0, height: 0 };
    }
    
    return { width, height };
}

/**
 * Checks if a video element has loaded metadata and valid dimensions.
 * @param {HTMLVideoElement} videoElement 
 * @returns {boolean} True if dimensions are valid, false otherwise.
 */
export function checkVideoDimensions(videoElement) {
    if (videoElement && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        // console.log(`Video dimensions ok: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
        return true;
    }
    // console.warn('Video dimensions not available or zero');
    return false;
}

/**
 * Sets up the webcam stream with specified constraints.
 * 
 * @param {HTMLVideoElement} videoElement - The video element to attach the stream to.
 * @param {object} [constraintsConfig={}] - Configuration for media constraints.
 * @param {string} [constraintsConfig.deviceId] - Specific camera device ID to use.
 * @param {string} [constraintsConfig.resolution='640x480'] - Desired resolution (e.g., '1280x720').
 * @returns {Promise<MediaStream>} A promise that resolves with the MediaStream object.
 */
export async function setupWebcam(videoElement, constraintsConfig = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported by this browser.');
    }

    const { deviceId, resolution = '640x480' } = constraintsConfig;
    const { width, height } = parseResolution(resolution);

    if (width === 0 || height === 0) {
        throw new Error(`Invalid resolution specified: ${resolution}`);
    }

    // Stop any existing stream on the video element
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        console.log('Stopped previous webcam stream.');
    }

    const constraints = {
        video: {
            width: { ideal: width },
            height: { ideal: height },
        },
        audio: false // Explicitly disable audio
    };

    if (deviceId) {
        constraints.video.deviceId = { exact: deviceId };
        console.log(`Attempting to use camera: ${deviceId}`);
    } else {
        console.log('No specific camera deviceId provided, attempting default camera.');
    }

    console.log(`Requesting webcam with constraints:`, constraints);

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Webcam access granted.');
        videoElement.srcObject = stream;
        videoElement.playsInline = true; // Ensure playback on mobile
        // We need to wait for the video metadata to load to get dimensions
        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                console.log(`Webcam metadata loaded. Resolution: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                 // Attempt to play the video
                 videoElement.play().then(() => { 
                    console.log('Webcam video playback started.');
                    resolve(); 
                 }).catch(playError => {
                     console.error('Error trying to play webcam video:', playError);
                     reject(playError);
                 });
            };
            videoElement.onerror = (e) => {
                console.error('Error loading webcam video metadata:', e);
                reject(new Error('Error loading video metadata.'));
            };
        });
        return stream;
    } catch (err) {
        console.error('Error accessing webcam:', err);
        // Provide more specific feedback if possible
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            throw new Error(`Camera not found. ${deviceId ? `Device ID ${deviceId} might be incorrect.` : 'No camera detected.'}`);
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            throw new Error('Permission denied for webcam access. Please grant permission in browser settings.');
        } else if (err.name === 'ConstraintNotSatisfiedError' || err.name === 'OverconstrainedError') {
            throw new Error(`Constraints not satisfied. The requested resolution (${width}x${height}) or camera might not be supported.`);
        } else {
            throw new Error(`Failed to access webcam: ${err.message}`);
        }
    }
}

/**
 * Waits for a video element to reach a state where it can be played or processed.
 * Resolves once the video has enough data (HAVE_ENOUGH_DATA) or is already playing.
 * Rejects on error or if the video source is invalid.
 * @param {HTMLVideoElement} videoElement - The video element to wait for.
 * @param {number} [timeout=10000] - Maximum time to wait in milliseconds.
 * @returns {Promise<void>} A promise that resolves when the video is ready, or rejects on error/timeout.
 */
export function waitForVideoReady(videoElement, timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            return reject(new Error('Invalid video element provided.'));
        }
        if (!videoElement.src && !videoElement.srcObject) {
            return reject(new Error('Video element has no source.'));
        }

        // Check initial state
        if (videoElement.readyState >= videoElement.HAVE_ENOUGH_DATA) {
            console.log(`Video already ready (readyState: ${videoElement.readyState}).`);
            return resolve();
        }
        if (videoElement.error) {
             console.error('Video already in error state:', videoElement.error);
            return reject(videoElement.error);
        }

        let timeoutId = null;

        const onCanPlayThrough = () => {
            console.log(`Video 'canplaythrough' event. ReadyState: ${videoElement.readyState}`);
            cleanup();
            resolve();
        };

        const onPlaying = () => {
            console.log(`Video 'playing' event. ReadyState: ${videoElement.readyState}`);
            cleanup();
            resolve();
        }

        // Fallback: HAVE_METADATA might be enough for dimensions, HAVE_CURRENT_DATA for first frame
        // HAVE_ENOUGH_DATA is safer for smooth playback/processing
        const onLoadedData = () => {
             console.log(`Video 'loadeddata' event. ReadyState: ${videoElement.readyState}`);
             if (videoElement.readyState >= videoElement.HAVE_ENOUGH_DATA) {
                 cleanup();
                 resolve();
             }
        };

        const onError = (e) => {
            console.error('Video error event:', e, videoElement.error);
            cleanup();
            reject(videoElement.error || new Error('Video loading failed.'));
        };
        
        const onStalled = () => {
            console.warn('Video stalled event. Network issues?');
            // Don't reject immediately on stall, might recover
        };
        
        const onTimeout = () => {
            console.error(`Video readiness timeout (${timeout}ms) exceeded. State: ${videoElement.readyState}`);
            cleanup();
            reject(new Error('Timeout waiting for video readiness.'));
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            videoElement.removeEventListener('canplaythrough', onCanPlayThrough);
            videoElement.removeEventListener('playing', onPlaying);
            videoElement.removeEventListener('loadeddata', onLoadedData);
            videoElement.removeEventListener('error', onError);
            videoElement.removeEventListener('stalled', onStalled);
        };

        // Attach listeners
        videoElement.addEventListener('canplaythrough', onCanPlayThrough);
        videoElement.addEventListener('playing', onPlaying);
        videoElement.addEventListener('loadeddata', onLoadedData); // Catch cases where canplaythrough doesn't fire
        videoElement.addEventListener('error', onError);
        videoElement.addEventListener('stalled', onStalled);

        // Set timeout
        timeoutId = setTimeout(onTimeout, timeout);

        // Explicitly load if needed (e.g., if src was set but preload=none)
        if (videoElement.preload === 'none' && videoElement.readyState < videoElement.HAVE_METADATA) {
             console.log('Triggering video load()...');
             videoElement.load();
        }
    });
}

/**
 * Helper specifically for loading a video source into a video element and waiting for it.
 * @param {HTMLVideoElement} videoElement
 * @param {string} videoSrc
 * @param {number} [timeout=10000]
 * @returns {Promise<void>}
 */
export async function loadVideo(videoElement, videoSrc, timeout = 10000) {
    if (!videoElement || !videoSrc) {
        throw new Error('Video element and source URL are required.');
    }
    console.log(`Loading video source: ${videoSrc}`);
    videoElement.src = videoSrc;
    videoElement.load(); // Explicitly call load after changing src
    await waitForVideoReady(videoElement, timeout);
    console.log(`Video source ${videoSrc} loaded successfully.`);
}

/**
 * Creates ImageData from the current frame of a video element, scaled to target dimensions.
 * Maintains the video's aspect ratio, letterboxing/pillarboxing as needed.
 * 
 * @param {HTMLVideoElement} videoElement - The source video element.
 * @param {number} targetWidth - The desired width of the ImageData.
 * @param {number} targetHeight - The desired height of the ImageData.
 * @returns {ImageData | null} The ImageData object or null if video is not ready or dimensions are invalid.
 */
export function getVideoFrameImageData(videoElement, targetWidth, targetHeight) {
    // Check if video is ready and dimensions are valid
    if (!videoElement || videoElement.readyState < 2) { // readyState 2 (HAVE_CURRENT_DATA) or higher
        console.warn('Cannot get video frame: video not ready');
        return null;
    }
    if (targetWidth <= 0 || targetHeight <= 0) {
        console.warn(`Cannot get video frame: invalid target dimensions ${targetWidth}x${targetHeight}`);
        return null;
    }
    if (!checkVideoDimensions(videoElement)) {
        console.warn('Cannot get video frame: video dimensions are zero.');
        return null;
    }

    try {
        // Use a temporary canvas to draw the frame and get ImageData
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        // Get context with willReadFrequently for potential performance boost
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

        // Calculate drawing dimensions to maintain aspect ratio (fit within target)
        const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
        const targetAspect = targetWidth / targetHeight;
        
        let drawWidth = targetWidth;
        let drawHeight = targetHeight;
        let drawX = 0;
        let drawY = 0;
        
        if (videoAspect > targetAspect) {
            // Video is wider than target canvas, fit to width, calculate height
            drawHeight = targetWidth / videoAspect;
            drawY = (targetHeight - drawHeight) / 2;
        } else {
            // Video is taller than target canvas, fit to height, calculate width
            drawWidth = targetHeight * videoAspect;
            drawX = (targetWidth - drawWidth) / 2;
        }
        
        // Clear context (optional, depending on whether transparency matters)
        // tempCtx.clearRect(0, 0, targetWidth, targetHeight);

        // Draw the video frame onto the temp canvas
        tempCtx.drawImage(videoElement, drawX, drawY, drawWidth, drawHeight);
        
        // Get the image data
        const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
        // console.log(`Got video frame ImageData: ${imageData.width}x${imageData.height}`);
        return imageData;

    } catch (err) {
        console.error("Error getting video frame image data:", err);
        return null;
    }
} 