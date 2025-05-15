import { logToConsole } from './logger.js';

// Define connections between keypoints for drawing lines (using COCO keypoint indices)
const POSE_CONNECTIONS = [
    // Face
    [0, 1], [0, 2], [1, 3], [2, 4],
    // Torso
    [5, 6], [5, 7], [7, 9], [9, 11], [6, 8], [8, 10], [10, 12], [5, 11], [6, 12], [11, 12],
    // Arms
    [5, 13], [13, 15], [15, 17], // Left arm (from observer's perspective)
    [6, 14], [14, 16], [16, 18], // Right arm
    // Legs
    [11, 19], [19, 21], [21, 23], // Left leg
    [12, 20], [20, 22], [22, 24]  // Right leg
];
// Define a color palette for different poses if needed
const POSE_COLORS = ['lime', 'cyan', 'magenta', 'yellow', 'orange', 'red'];

const DIFFERENCE_MASK_SCALEDOWN_FACTOR = 4; // e.g., 4 means 1/4 width & height (1/16th pixels)
const TORSO_EXPANSION_FACTOR = 1.8; // Existing: Factor to expand the torso polygon
const HEAD_EXPANSION_FACTOR = 1.0;  // New: Factor for head size. Note: A negative value will likely cause errors for arc radius.
const ARM_EXPANSION_FACTOR = 1.0;   // New: Factor for arm thickness.
const LEG_EXPANSION_FACTOR = 1.0;   // New: Factor for leg thickness.

/**
 * Manages drawing multiple video/image sources and effects onto a target canvas.
 * Initially handles only one primary video source.
 */
export class VideoCompositor {
    constructor(canvasIdOrElement) {
        if (typeof canvasIdOrElement === 'string') {
            this.canvas = document.getElementById(canvasIdOrElement);
            if (!this.canvas) {
                logToConsole(`VideoCompositor: Canvas element with ID '${canvasIdOrElement}' not found.`, 'error');
                throw new Error(`Canvas element with ID '${canvasIdOrElement}' not found.`);
            }
        } else if (canvasIdOrElement instanceof HTMLCanvasElement) {
            this.canvas = canvasIdOrElement;
        } else {
            logToConsole('VideoCompositor: Invalid constructor argument. Must provide canvas ID string or HTMLCanvasElement.', 'error');
            throw new Error('Invalid constructor argument for VideoCompositor.');
        }

        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            logToConsole(`VideoCompositor: Failed to get 2D context for canvas '${this.canvas.id || '[no id]'}'.`, 'error');
            throw new Error(`Failed to get 2D context for canvas '${this.canvas.id || '[no id]'}'.`);
        }

        this.currentFrameSource = null; // Can be HTMLVideoElement or HTMLCanvasElement
        this.sourceType = null; // 'video' or 'canvas'
        this.animationFrameId = null;
        this.isDrawing = false;
        this.frameCount = 0; // Add frame counter

        // App configuration
        this.appConfig = {
            videoFormat: 'mp4',
            videoBackground: [255, 0, 255, 255] // Default Magenta
        };
        this.configFetched = false;
        this._fetchAppConfig(); // Initialize config

        // --- New/Modified Pose Detection State ---
        this.poseDetector = null;
        this.tfjsBackendReady = false;
        this.enablePoseDetection = false; // Controls if detection runs
        this.drawSkeletonOverlay = false; // Controls skeleton drawing
        this.drawBoundingBoxMask = false; // Controls mask drawing
        this.drawBodySegmentMask = false; // Controls body segment mask drawing
        this.drawDifferenceMask = false; // CONTROLS THE NEW DIFFERENCE MASK DRAWING
        this.lastDetectedPoses = [];
        this.differenceScore = 0; // Initialize score for difference mask
        this._initializeTfjsAndDetector();
        // --- End New/Modified State ---

        this.dinosaurVideoMask = null; // Video element for the dinosaur mask
        this.dinosaurMaskActive = false; // Is the dinosaur mask currently active?

        // Offscreen canvas for processing luma matte
        this.lumaMaskCanvas = document.createElement('canvas');
        this.lumaMaskCtx = this.lumaMaskCanvas.getContext('2d', { willReadFrequently: true }); // Optimize for frequent readback
        if (!this.lumaMaskCtx) {
            logToConsole('VideoCompositor: Failed to get 2D context for lumaMaskCanvas.', 'error');
            // Potentially throw an error or disable masking if this fails
        }

        // Offscreen canvas for scaled dinosaur shape (for difference mask)
        this.scaledDinoShapeCanvas = document.createElement('canvas');
        this.scaledDinoShapeCtx = this.scaledDinoShapeCanvas.getContext('2d');
        if (!this.scaledDinoShapeCtx) {
            logToConsole('VideoCompositor: Failed to get 2D context for scaledDinoShapeCanvas.', 'error');
        }

        // Offscreen canvases for low-resolution difference mask processing
        this.lowResPersonCanvas = document.createElement('canvas');
        this.lowResPersonCtx = this.lowResPersonCanvas.getContext('2d', { willReadFrequently: true });
        if (!this.lowResPersonCtx) {
            logToConsole('VideoCompositor: Failed to get 2D context for lowResPersonCanvas.', 'error');
        }
        this.lowResDinoCanvas = document.createElement('canvas');
        this.lowResDinoCtx = this.lowResDinoCanvas.getContext('2d', { willReadFrequently: true });
        if (!this.lowResDinoCtx) {
            logToConsole('VideoCompositor: Failed to get 2D context for lowResDinoCanvas.', 'error');
        }

        this.isMirrored = false; // Added for mirror toggle
        this.boundDinosaurMaskEndedHandler = null; // For manual looping of dino mask

        // Offscreen canvas for body segment mask
        this.segmentMaskCanvas = document.createElement('canvas');
        this.segmentMaskCtx = this.segmentMaskCanvas.getContext('2d');
        if (!this.segmentMaskCtx) {
            logToConsole('VideoCompositor: Failed to get 2D context for segmentMaskCanvas.', 'error');
            // Fallback or disable feature if critical
        }

        // Visibility API
        this._boundHandleVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundHandleVisibilityChange);

        logToConsole(`VideoCompositor initialized for canvas '#${this.canvas.id || '(no ID yet)'}'.`, 'info');
    }

    // Fetch app configuration from the server
    async _fetchAppConfig() {
        if (this.configFetched) return;

        try {
            const response = await fetch('/api/app-config');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.appConfig = await response.json();
            this.configFetched = true;
            logToConsole('App configuration loaded for video-compositor.', 'info', this.appConfig);
        } catch (e) {
            logToConsole(`Failed to fetch app configuration for video-compositor: ${e.message}. Using defaults.`, 'warn', e);
            // Default values are already set in constructor, no need to reset
            this.configFetched = true; // Mark as fetched to avoid retry
        }
    }

    // --- New TFJS/Detector Methods (from CameraManager) ---
    async _initializeTfjsAndDetector() {
        try {
            // Check if tf is globally available (loaded via CDN)
            if (typeof tf === 'undefined') {
                logToConsole('VideoCompositor: TensorFlow.js (tf) not found globally!', 'error');
                return;
            }
            logToConsole("VideoCompositor: Initializing TensorFlow.js backend...", "info");
            await tf.setBackend('webgpu'); // Switch back to WebGPU
            await tf.ready();
            this.tfjsBackendReady = true;
            logToConsole(`VideoCompositor: TensorFlow.js backend ready (${tf.getBackend()}).`, "success");
            await this._loadPoseDetector();
        } catch (err) {
            logToConsole(`VideoCompositor: Error initializing TensorFlow.js: ${err.message}`, "error");
        }
    }

    async _loadPoseDetector() {
        if (!this.tfjsBackendReady) {
            logToConsole("VideoCompositor: TF.js backend not ready, cannot load pose detector.", "warn");
            return;
        }
        if (this.poseDetector) {
            logToConsole("VideoCompositor: Pose detector already loaded.", "info");
            return;
        }
        try {
            // Check if poseDetection is globally available
            if (typeof poseDetection === 'undefined') {
                logToConsole('VideoCompositor: Pose-Detection library (poseDetection) not found globally!', 'error');
                return;
            }
            logToConsole("VideoCompositor: Loading MoveNet pose detector model...", "info");
            const model = poseDetection.SupportedModels.MoveNet;
            const detectorConfig = {
                modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
                enableSmoothing: true,
            };
            this.poseDetector = await poseDetection.createDetector(model, detectorConfig);
            logToConsole("VideoCompositor: MoveNet pose detector loaded successfully.", "success");
        } catch (err) {
            logToConsole(`VideoCompositor: Error loading pose detector: ${err.message}`, "error");
            this.poseDetector = null;
        }
    }
    // --- End New TFJS/Detector Methods ---

    // --- Control Methods --- 
    setPoseDetectionEnabled(enabled) {
        logToConsole(`VideoCompositor: Setting pose detection enabled to ${enabled}`, 'info');
        const changed = this.enablePoseDetection !== !!enabled;
        this.enablePoseDetection = !!enabled;
        if (changed && this.enablePoseDetection && !this.poseDetector) {
            logToConsole('VideoCompositor: Enabling pose detection, but detector is not loaded yet. Attempting load...', 'warn');
            this._loadPoseDetector();
        }
        if (changed && !this.enablePoseDetection) {
            this.lastDetectedPoses = []; // Clear poses when disabling
            // Trigger a redraw without effects if needed
            if (this.isDrawing) this._drawFrame(true); // force a clear redraw
        }
    }

    _updatePoseDetectionState() {
        const shouldEnablePose = this.drawSkeletonOverlay || this.drawBoundingBoxMask || this.drawBodySegmentMask || this.drawDifferenceMask;
        // Only call setPoseDetectionEnabled if the state actually needs to change
        if (shouldEnablePose && !this.enablePoseDetection) {
            this.setPoseDetectionEnabled(true);
        } else if (!shouldEnablePose && this.enablePoseDetection) {
            this.setPoseDetectionEnabled(false);
        }
    }

    setDrawSkeletonOverlay(enabled) {
        const changed = this.drawSkeletonOverlay !== !!enabled;
        this.drawSkeletonOverlay = !!enabled;
        logToConsole(`VideoCompositor: Skeleton overlay set to ${this.drawSkeletonOverlay}.`, 'info');

        this._updatePoseDetectionState();

        if (changed && this.isDrawing) {
            this._drawFrame(true);
        }
    }

    setDrawBoundingBoxMask(enabled) {
        const changed = this.drawBoundingBoxMask !== !!enabled;
        this.drawBoundingBoxMask = !!enabled;
        logToConsole(`VideoCompositor: Bounding box mask set to ${this.drawBoundingBoxMask}.`, 'info');

        this._updatePoseDetectionState();

        if (changed && this.isDrawing) {
            this._drawFrame(true);
        }
    }

    setDrawBodySegmentMask(enabled) {
        const changed = this.drawBodySegmentMask !== !!enabled;
        this.drawBodySegmentMask = !!enabled;
        logToConsole(`VideoCompositor: Body Segment Mask set to ${this.drawBodySegmentMask}.`, 'info');

        this._updatePoseDetectionState();

        if (changed && this.isDrawing) {
            // Force a redraw, potentially clearing previous effects if this one is disabled
            // or ensuring it's drawn if enabled.
            this._drawFrame(true);
        }
    }

    setDrawDifferenceMask(enabled) {
        const changed = this.drawDifferenceMask !== !!enabled;
        this.drawDifferenceMask = !!enabled;
        logToConsole(`VideoCompositor: Difference Mask set to ${this.drawDifferenceMask}.`, 'info');

        this._updatePoseDetectionState(); // Difference mask requires pose detection for body segments

        if (changed && this.isDrawing) {
            // Force a redraw, potentially clearing previous effects if this one is disabled
            // or ensuring it's drawn if enabled.
            this._drawFrame(true);
        }
    }

    // --- End Control Methods ---

    // Sets the main video/canvas source to be drawn
    setCurrentFrameSource(sourceElement) {
        if (!sourceElement ||
            (!(sourceElement instanceof HTMLVideoElement) && !(sourceElement instanceof HTMLCanvasElement))) {
            logToConsole('VideoCompositor: Invalid source element provided. Must be HTMLVideoElement or HTMLCanvasElement.', 'error');
            this.removeFrameSource(); // Clear existing source if invalid one is provided
            return;
        }

        const sourceId = sourceElement.id || 'no id';
        logToConsole(`VideoCompositor: Setting current frame source (${sourceId}).`, 'info');

        if (sourceElement instanceof HTMLVideoElement) {
            this.sourceType = 'video';
            logToConsole(`VideoCompositor: Source type is HTMLVideoElement.`, 'info');
        } else if (sourceElement instanceof HTMLCanvasElement) {
            this.sourceType = 'canvas';
            logToConsole(`VideoCompositor: Source type is HTMLCanvasElement.`, 'info');
        }

        this.currentFrameSource = sourceElement;

        // Ensure canvas is initially sized correctly
        const checkSourceReady = () => {
            if (!this.currentFrameSource) return; // Source might have been removed

            let width = 0;
            let height = 0;
            let ready = false;

            if (this.sourceType === 'video') {
                if (this.currentFrameSource.readyState >= 2) { // HAVE_CURRENT_DATA or higher
                    width = this.currentFrameSource.videoWidth;
                    height = this.currentFrameSource.videoHeight;
                    ready = true;
                }
            } else if (this.sourceType === 'canvas') {
                width = this.currentFrameSource.width;
                height = this.currentFrameSource.height;
                ready = true; // Canvas is always considered ready in terms of dimensions
            }

            if (ready) {
                if (width > 0 && height > 0) {
                    logToConsole(`VideoCompositor: Source ready with resolution ${width}x${height}.`, 'info');
                    this._sizeCanvasToSource();
                } else {
                    logToConsole(`VideoCompositor: Source ready but resolution is ${width}x${height}. Retrying...`, 'warn');
                    if (this.currentFrameSource) setTimeout(checkSourceReady, 100); // Retry shortly only if source still exists
                }
            } else {
                logToConsole('VideoCompositor: Waiting for video source to become ready...', 'debug');
                if (this.currentFrameSource) setTimeout(checkSourceReady, 100); // Retry shortly
            }
        };

        checkSourceReady(); // Initial check

        if (!this.isDrawing) {
            this.startDrawingLoop();
        }
    }

    _sizeCanvasToSource() {
        if (!this.currentFrameSource) return;

        let sourceWidth = 0;
        let sourceHeight = 0;

        if (this.sourceType === 'video') {
            sourceWidth = this.currentFrameSource.videoWidth;
            sourceHeight = this.currentFrameSource.videoHeight;
        } else if (this.sourceType === 'canvas') {
            sourceWidth = this.currentFrameSource.width;
            sourceHeight = this.currentFrameSource.height;
        }

        if (sourceWidth > 0 && sourceHeight > 0) {
            if (this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
                this.canvas.width = sourceWidth;
                this.canvas.height = sourceHeight;
                logToConsole(`VideoCompositor: Resized target canvas '${this.canvas.id}' to ${sourceWidth}x${sourceHeight} to match source.`, 'debug');
            }
        } else {
            logToConsole(`VideoCompositor: Source has zero dimensions (${sourceWidth}x${sourceHeight}), target canvas not resized.`, 'warn');
        }
    }

    _drawFrame(forceClearEffects = false) {
        this.frameCount = (this.frameCount + 1) % 1000; // Increment and wrap frame counter

        if (!this.isDrawing || !this.currentFrameSource) {
            if (!this.currentFrameSource && this.isDrawing) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
            if (this.isDrawing) {
                this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
            }
            return;
        }

        let sourceIsReady = false;
        try {
            if (this.sourceType === 'video') {
                const video = this.currentFrameSource;
                if (!video.paused && !video.ended && video.readyState >= 2) {
                    sourceIsReady = true;
                }
            } else if (this.sourceType === 'canvas') {
                sourceIsReady = true;
            }
        } catch (e) {
            logToConsole(`Error checking source readiness: ${e}`, 'error');
            sourceIsReady = false;
        }

        if (!sourceIsReady) {
            this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
            return;
        }

        try {
            this._sizeCanvasToSource();
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            if (this.canvas.width > 0 && this.canvas.height > 0) {
                // If Difference Mask is active, it handles its own drawing entirely.
                // Otherwise, draw the standard source image.
                if (!this.drawDifferenceMask) {
                    try {
                        this.ctx.drawImage(this.currentFrameSource, 0, 0, this.canvas.width, this.canvas.height);
                    } catch (e) {
                        logToConsole(`Error drawing source image: ${e}`, 'error');
                    }
                }
            }

            let posesToDraw = null;
            let bodySegmentShapeRendered = false; // Track if body segment data is ready

            if (this.enablePoseDetection && this.poseDetector && !forceClearEffects) {
                posesToDraw = this.lastDetectedPoses;
                const ESTIMATION_INTERVAL = 2;
                if (this.frameCount % ESTIMATION_INTERVAL === 0) {
                    try {
                        this.poseDetector.estimatePoses(this.currentFrameSource)
                            .then(poses => {
                                this.lastDetectedPoses = poses;
                            })
                            .catch(err => {
                                logToConsole(`[${this.canvas.id}] Error during pose estimation: ${err.message}`, 'error');
                                this.lastDetectedPoses = [];
                            });
                    } catch (estimationError) {
                        logToConsole(`[${this.canvas.id}] Synchronous error calling estimatePoses: ${estimationError}`, 'error');
                    }
                }
            } else {
                this.lastDetectedPoses = [];
                posesToDraw = [];
            }

            // --- Logic to prepare segmentMaskCanvas ---
            let bodySegmentShapeRenderedForStandardMask = false; // Flag for standard path
            const shouldRenderForDiffMask = this.drawDifferenceMask && posesToDraw && posesToDraw.length > 0 && this.segmentMaskCtx;
            const shouldRenderForStdMask = this.drawBodySegmentMask && !this.drawDifferenceMask && posesToDraw && posesToDraw.length > 0 && !forceClearEffects && this.segmentMaskCtx;

            if (shouldRenderForDiffMask || shouldRenderForStdMask) {
                // Ensure segmentMaskCanvas is sized correctly (e.g., to match the main canvas)
                if (this.segmentMaskCanvas.width !== this.canvas.width) {
                    this.segmentMaskCanvas.width = this.canvas.width;
                }
                if (this.segmentMaskCanvas.height !== this.canvas.height) {
                    this.segmentMaskCanvas.height = this.canvas.height;
                }
                this._renderBodySegmentShapeOnMaskCanvas(posesToDraw);

                if (shouldRenderForStdMask) { // Set flag if rendered specifically for standard mask conditions
                    bodySegmentShapeRenderedForStandardMask = true;
                }
            } else if (this.segmentMaskCtx &&
                (this.drawDifferenceMask || (this.drawBodySegmentMask && !forceClearEffects))) {
                // If segmentMaskCanvas would have been used, but no poses or other conditions failed for rendering,
                // ensure it's cleared to prevent using stale data.
                if (this.segmentMaskCanvas.width > 0 && this.segmentMaskCanvas.height > 0) {
                    this.segmentMaskCtx.clearRect(0, 0, this.segmentMaskCanvas.width, this.segmentMaskCanvas.height);
                }
            }
            // --- End logic to prepare segmentMaskCanvas ---

            // MAIN DRAWING LOGIC BRANCH
            // Difference Mask takes precedence if active and its specific inputs are ready
            if (this.drawDifferenceMask && this.currentFrameSource &&
                this.dinosaurVideoMask && this.dinosaurVideoMask.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !this.dinosaurVideoMask.paused &&
                this.lumaMaskCtx && this.scaledDinoShapeCtx) {
                try {
                    this._drawDifferenceMaskLayer(); // No longer passes posesToDraw
                } catch (differenceError) {
                    logToConsole(`Error drawing difference mask layer: ${differenceError.message}`, 'error');
                    // Fallback or clear if error is critical
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); // Clear to avoid corrupted frame
                }
            } else {
                // IF 'drawDifferenceMask' IS TRUE but we are in this 'else' block, it means one of its specific conditions failed.
                if (this.drawDifferenceMask) {
                    logToConsole(`VideoCompositor: Difference Mask is ON but prerequisites not met. Falling back to standard draw. Details:`, 'warn');
                    logToConsole(`  - this.currentFrameSource available: ${!!this.currentFrameSource}`, 'warn');
                    if (this.currentFrameSource instanceof HTMLCanvasElement || this.currentFrameSource instanceof HTMLVideoElement) {
                        logToConsole(`    - currentFrameSource dimensions: ${this.currentFrameSource.width}x${this.currentFrameSource.height}`, 'warn');
                    } else if (this.currentFrameSource) {
                        logToConsole(`    - currentFrameSource type: ${typeof this.currentFrameSource}`, 'warn');
                    }
                    logToConsole(`  - dinosaurVideoMask exists: ${!!this.dinosaurVideoMask}`, 'warn');
                    if (this.dinosaurVideoMask) {
                        // Check if the dino mask is simply at the beginning of a loop
                        const isLoopRestart = this.dinosaurVideoMask.readyState === HTMLMediaElement.HAVE_METADATA && this.dinosaurVideoMask.currentTime === 0 && !this.dinosaurVideoMask.paused;
                        const logLevel = isLoopRestart ? 'debug' : 'warn'; // Less alarming if it's just a loop restart
                        const logMessageSuffix = isLoopRestart ? ' (normal for loop restart)' : '';

                        logToConsole(`    - dino.readyState: ${this.dinosaurVideoMask.readyState} (expected >= ${HTMLMediaElement.HAVE_CURRENT_DATA})${logMessageSuffix}`, logLevel);
                        logToConsole(`    - dino.paused: ${this.dinosaurVideoMask.paused} (expected false)${logMessageSuffix}`, logLevel);
                    }
                    logToConsole(`  - lumaMaskCtx exists: ${!!this.lumaMaskCtx}`, 'warn');
                    logToConsole(`  - scaledDinoShapeCtx exists: ${!!this.scaledDinoShapeCtx}`, 'warn');
                }
                // --- Standard Drawing Path (when Difference Mask is OFF or its prerequisites failed) ---
                // Base image is already drawn (or not, if drawDifferenceMask was true but failed conditions)
                // For safety, ensure source is drawn if not in an active difference mask path:
                if (!this.drawDifferenceMask) { // Re-ensure source is drawn if not handled by diff mask
                    if (this.canvas.width > 0 && this.canvas.height > 0 && this.currentFrameSource) { // Check currentFrameSource exists
                        try {
                            // Check if it was already drawn; avoid double draw if possible.
                            // The clearRect and drawImage earlier should handle it, this is a safeguard.
                            // If this.ctx.drawImage was inside an if(!this.drawDifferenceMask) block, this is not needed here.
                            // Current structure: clearRect, then if(!drawDifferenceMask) drawImage. So it's fine.
                        } catch (e) {
                            // logToConsole(`Error re-drawing source image: ${e}`, 'error'); // Covered by initial draw
                        }
                    }
                }

                // Apply DINOSAUR LUMA MASK (already has !this.drawDifferenceMask condition)
                if (this.dinosaurMaskActive && this.dinosaurVideoMask &&
                    this.dinosaurVideoMask.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                    !this.dinosaurVideoMask.paused && this.lumaMaskCtx && !this.drawDifferenceMask) { // Added !this.drawDifferenceMask again for clarity

                    const maskVideo = this.dinosaurVideoMask;
                    const maskWidth = maskVideo.videoWidth;
                    const maskHeight = maskVideo.videoHeight;

                    if (maskWidth > 0 && maskHeight > 0) {
                        if (this.lumaMaskCanvas.width !== maskWidth) this.lumaMaskCanvas.width = maskWidth;
                        if (this.lumaMaskCanvas.height !== maskHeight) this.lumaMaskCanvas.height = maskHeight;
                        try {
                            this.lumaMaskCtx.drawImage(maskVideo, 0, 0, maskWidth, maskHeight);
                            const imageData = this.lumaMaskCtx.getImageData(0, 0, maskWidth, maskHeight);
                            const data = imageData.data;
                            for (let i = 0; i < data.length; i += 4) {
                                data[i + 3] = data[i];
                            }
                            this.lumaMaskCtx.putImageData(imageData, 0, 0);
                            this.ctx.save();
                            this.ctx.globalCompositeOperation = 'destination-in';
                            this.ctx.drawImage(this.lumaMaskCanvas, 0, 0, this.canvas.width, this.canvas.height);
                            this.ctx.restore();
                        } catch (e) {
                            logToConsole(`Error processing or drawing luma matte dinosaur mask: ${e.message}`, 'error');
                        }
                    }
                } else if (this.dinosaurMaskActive && this.dinosaurVideoMask && !this.drawDifferenceMask) {
                    logToConsole(`DinoMask luma processing SKIPPED (standard path): Time=${this.dinosaurVideoMask.currentTime.toFixed(2)}, RS=${this.dinosaurVideoMask.readyState}, Paused=${this.dinosaurVideoMask.paused}`, 'debug');
                }

                // Apply Bounding Box Mask
                if (this.drawBoundingBoxMask && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                    try { this._applyMaskShapes(posesToDraw); }
                    catch (maskError) { logToConsole(`Error applying mask shapes: ${maskError}`, 'error'); }
                }

                // Apply Body Segment Mask (visual effect, using the already prepared this.segmentMaskCanvas)
                // This is the standard body segment mask, not related to the difference mask input.
                if (this.drawBodySegmentMask && bodySegmentShapeRenderedForStandardMask && !this.drawDifferenceMask && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                    try {
                        // this.segmentMaskCanvas was populated by _renderBodySegmentShapeOnMaskCanvas if conditions were met
                        this.ctx.save();
                        this.ctx.globalCompositeOperation = 'destination-in';
                        this.ctx.drawImage(this.segmentMaskCanvas, 0, 0, this.canvas.width, this.canvas.height);
                        this.ctx.restore();
                    }
                    catch (segmentError) { logToConsole(`Error applying body segment mask effect: ${segmentError}`, 'error'); }
                }

                // Draw Skeleton Overlay
                if (this.drawSkeletonOverlay && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                    try { this._drawSkeleton(posesToDraw); }
                    catch (skeletonError) { logToConsole(`Error drawing skeleton: ${skeletonError}`, 'error'); }
                }
                // --- End Standard Drawing Path ---
            }

            // Add background color at the end of all drawing operations 
            // (after all masks and overlays have been applied)
            if (!this.drawDifferenceMask && // Skip background color when difference mask is active
                this.appConfig && this.appConfig.videoBackground &&
                this.appConfig.videoBackground.length === 4 &&
                this.canvas.width > 0 && this.canvas.height > 0) {

                const [r, g, b, aGui] = this.appConfig.videoBackground;
                const aNormalized = aGui / 255;

                // For MP4 always apply background, for WebM only if not fully transparent
                const needsBackground =
                    (this.appConfig.videoFormat === 'mp4') ||
                    (this.appConfig.videoFormat === 'webm' && aNormalized > 0);

                if (needsBackground) {
                    this.ctx.save();
                    this.ctx.fillStyle = `rgba(${r},${g},${b},${aNormalized})`;
                    this.ctx.globalCompositeOperation = 'destination-over';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.restore();
                }
            }

        } catch (drawError) {
            logToConsole(`[${this.canvas.id}] Error during main drawing block: ${drawError}`, 'error');
        }

        if (this.isDrawing) {
            this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
        }
    }

    // --- Refactored Masking Method (Applies shapes only) ---
    _applyMaskShapes(poses) {
        if (!poses || poses.length === 0) return;

        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const scaleX = canvasWidth / this.currentFrameSource.videoWidth;
        const scaleY = canvasHeight / this.currentFrameSource.videoHeight;

        if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX === 0 || scaleY === 0) return;

        ctx.save();

        // 1. Build a path containing all bounding boxes
        ctx.beginPath();

        poses.forEach(pose => {
            if (!pose || !pose.keypoints) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            pose.keypoints.forEach(kp => {
                if (kp && kp.score > 0.1) {
                    const x = kp.x * scaleX;
                    const y = kp.y * scaleY;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            });
            if (isFinite(minX)) {
                const padding = 20;
                const boxX = Math.max(0, minX - padding);
                const boxY = Math.max(0, minY - padding);
                const boxWidth = Math.min(canvasWidth - boxX, (maxX - minX) + padding * 2);
                const boxHeight = Math.min(canvasHeight - boxY, (maxY - minY) + padding * 2);
                // Add this box to the path, don't fill yet
                ctx.rect(boxX, boxY, boxWidth, boxHeight);
            }
        });

        // 2. Set composite operation to mask
        ctx.globalCompositeOperation = 'destination-in';

        // 3. Fill the combined path to apply the mask
        // (Video was already drawn in _drawFrame)
        ctx.fillStyle = 'black'; // Color doesn't matter for the mask shape
        ctx.fill();

        ctx.restore(); // Restore globalCompositeOperation
    }
    // --- End Refactored Masking Method ---

    // New method to render the body segment shape onto this.segmentMaskCanvas
    _renderBodySegmentShapeOnMaskCanvas(poses) {
        if (!poses || poses.length === 0 || /*!this.currentFrameSource ||*/ !this.segmentMaskCtx) {
            // logToConsole('Skipping body segment shape rendering: no poses, source, or segmentMaskCtx', 'debug');
            if (this.segmentMaskCtx && this.segmentMaskCanvas.width > 0 && this.segmentMaskCanvas.height > 0) {
                this.segmentMaskCtx.clearRect(0, 0, this.segmentMaskCanvas.width, this.segmentMaskCanvas.height); // Clear if no poses
            }
            return;
        }
        // Ensure currentFrameSource is available for scaling references
        if (!this.currentFrameSource) {
            logToConsole('Skipping body segment shape rendering: no currentFrameSource for scaling.', 'warn');
            if (this.segmentMaskCtx && this.segmentMaskCanvas.width > 0 && this.segmentMaskCanvas.height > 0) {
                this.segmentMaskCtx.clearRect(0, 0, this.segmentMaskCanvas.width, this.segmentMaskCanvas.height);
            }
            return;
        }

        // const canvasWidth = this.segmentMaskCanvas.width; // Use segmentMaskCanvas dimensions
        // const canvasHeight = this.segmentMaskCanvas.height;
        // Ensure offscreen mask canvas has correct dimensions (it should match the main canvas for accurate mapping)
        // This is now handled in _drawFrame before this is called, ensuring it's sized like this.canvas
        const currentCanvasWidth = this.segmentMaskCanvas.width;
        const currentCanvasHeight = this.segmentMaskCanvas.height;

        const maskCtx = this.segmentMaskCtx;
        maskCtx.clearRect(0, 0, currentCanvasWidth, currentCanvasHeight); // Clear before drawing new mask

        const sourceWidth = (this.sourceType === 'video') ? this.currentFrameSource.videoWidth : this.currentFrameSource.width;
        const sourceHeight = (this.sourceType === 'video') ? this.currentFrameSource.videoHeight : this.currentFrameSource.height;

        if (!sourceWidth || !sourceHeight) {
            logToConsole('BodySegmentMask: Source dimensions are invalid for scaling for shape rendering.', 'warn');
            return;
        }

        const scaleX = currentCanvasWidth / sourceWidth;
        const scaleY = currentCanvasHeight / sourceHeight;

        maskCtx.fillStyle = 'white'; // Mask color, opaque areas will keep video pixels

        poses.forEach(pose => {
            if (!pose || !pose.keypoints) return;
            const keypoints = pose.keypoints;
            const confidenceThreshold = this.dinosaurMaskActive ? 0.05 : 0.12; // Lower threshold for dino mode

            const kp = (index) => {
                if (keypoints[index] && keypoints[index].score > confidenceThreshold) {
                    return { x: keypoints[index].x * scaleX, y: keypoints[index].y * scaleY };
                }
                return null;
            };

            const lShoulder = kp(5);
            const rShoulder = kp(6);
            const lHip = kp(11);
            const rHip = kp(12);
            const nose = kp(0);
            const lElbow = kp(7);
            const rElbow = kp(8);
            const lWrist = kp(9);
            const rWrist = kp(10);
            const lKnee = kp(13);
            const rKnee = kp(14);
            const lAnkle = kp(15);
            const rAnkle = kp(16);

            // Torso
            if (lShoulder && rShoulder && rHip && lHip) {
                // Calculate centroid of the torso
                const centroidX = (lShoulder.x + rShoulder.x + rHip.x + lHip.x) / 4;
                const centroidY = (lShoulder.y + rShoulder.y + rHip.y + lHip.y) / 4;

                // Expand points from centroid
                const expandedLShoulder = {
                    x: centroidX + (lShoulder.x - centroidX) * TORSO_EXPANSION_FACTOR,
                    y: centroidY + (lShoulder.y - centroidY) * TORSO_EXPANSION_FACTOR
                };
                const expandedRShoulder = {
                    x: centroidX + (rShoulder.x - centroidX) * TORSO_EXPANSION_FACTOR,
                    y: centroidY + (rShoulder.y - centroidY) * TORSO_EXPANSION_FACTOR
                };
                const expandedRHip = {
                    x: centroidX + (rHip.x - centroidX) * TORSO_EXPANSION_FACTOR,
                    y: centroidY + (rHip.y - centroidY) * TORSO_EXPANSION_FACTOR
                };
                const expandedLHip = {
                    x: centroidX + (lHip.x - centroidX) * TORSO_EXPANSION_FACTOR,
                    y: centroidY + (lHip.y - centroidY) * TORSO_EXPANSION_FACTOR
                };

                maskCtx.beginPath();
                maskCtx.moveTo(expandedLShoulder.x, expandedLShoulder.y);
                maskCtx.lineTo(expandedRShoulder.x, expandedRShoulder.y);
                maskCtx.lineTo(expandedRHip.x, expandedRHip.y);
                maskCtx.lineTo(expandedLHip.x, expandedLHip.y);
                maskCtx.closePath();
                maskCtx.fill();
            }

            // Head
            if (nose) {
                let headRadius = 15;
                if (lShoulder && rShoulder) {
                    headRadius = Math.abs(rShoulder.x - lShoulder.x) / 2.5;
                }
                headRadius = Math.max(headRadius, 10);
                maskCtx.beginPath();
                // Apply HEAD_EXPANSION_FACTOR to headRadius
                // Note: If headRadius * HEAD_EXPANSION_FACTOR is negative, arc() will throw an error.
                maskCtx.arc(nose.x, nose.y, headRadius * HEAD_EXPANSION_FACTOR, 0, 2 * Math.PI);
                maskCtx.closePath();
                maskCtx.fill();
            }

            // Neck/Upper Chest Area
            if (nose && lShoulder && rShoulder) {
                maskCtx.beginPath();
                maskCtx.moveTo(nose.x, nose.y);
                maskCtx.lineTo(lShoulder.x, lShoulder.y);
                maskCtx.lineTo(rShoulder.x, rShoulder.y);
                maskCtx.closePath();
                maskCtx.fill();
            }

            const baseLimbThickness = Math.max(48, (lShoulder && rShoulder ? Math.abs(rShoulder.x - lShoulder.x) * 0.6 : 48));
            const limbThickness = baseLimbThickness;

            const fillLimbPoly = (p1, p2, thickness) => {
                if (!p1 || !p2) return;
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const offsetX = Math.sin(angle) * thickness / 2;
                const offsetY = Math.cos(angle) * thickness / 2;

                maskCtx.beginPath();
                maskCtx.moveTo(p1.x - offsetX, p1.y + offsetY);
                maskCtx.lineTo(p2.x - offsetX, p2.y + offsetY);
                maskCtx.lineTo(p2.x + offsetX, p2.y - offsetY);
                maskCtx.lineTo(p1.x + offsetX, p1.y - offsetY);
                maskCtx.closePath();
                maskCtx.fill();
            };

            // Arms
            fillLimbPoly(lShoulder, lElbow, limbThickness * ARM_EXPANSION_FACTOR);
            fillLimbPoly(lElbow, lWrist, limbThickness * ARM_EXPANSION_FACTOR);
            fillLimbPoly(rShoulder, rElbow, limbThickness * ARM_EXPANSION_FACTOR);
            fillLimbPoly(rElbow, rWrist, limbThickness * ARM_EXPANSION_FACTOR);

            // Hands
            if (lWrist && lElbow) {
                const handLength = limbThickness * 1.0; // Base hand length relative to limbThickness
                const angle = Math.atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
                const handEndX = lWrist.x + handLength * Math.cos(angle);
                const handEndY = lWrist.y + handLength * Math.sin(angle);
                fillLimbPoly(lWrist, { x: handEndX, y: handEndY }, limbThickness * ARM_EXPANSION_FACTOR);
            }
            if (rWrist && rElbow) {
                const handLength = limbThickness * 1.0; // Base hand length relative to limbThickness
                const angle = Math.atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
                const handEndX = rWrist.x + handLength * Math.cos(angle);
                const handEndY = rWrist.y + handLength * Math.sin(angle);
                fillLimbPoly(rWrist, { x: handEndX, y: handEndY }, limbThickness * ARM_EXPANSION_FACTOR);
            }

            // Legs
            fillLimbPoly(lHip, lKnee, limbThickness * LEG_EXPANSION_FACTOR);
            fillLimbPoly(lKnee, lAnkle, limbThickness * 0.9 * LEG_EXPANSION_FACTOR);
            fillLimbPoly(rHip, rKnee, limbThickness * LEG_EXPANSION_FACTOR);
            fillLimbPoly(rKnee, rAnkle, limbThickness * 0.9 * LEG_EXPANSION_FACTOR);

            // Feet
            if (lAnkle && lKnee) {
                const footLength = limbThickness * 0.75; // Base foot length relative to limbThickness
                const angle = Math.atan2(lAnkle.y - lKnee.y, lAnkle.x - lKnee.x);
                const footEndX = lAnkle.x + footLength * Math.cos(angle);
                const footEndY = lAnkle.y + footLength * Math.sin(angle);
                fillLimbPoly(lAnkle, { x: footEndX, y: footEndY }, limbThickness * 0.7 * LEG_EXPANSION_FACTOR);
            }
            if (rAnkle && rKnee) {
                const footLength = limbThickness * 0.75; // Base foot length relative to limbThickness
                const angle = Math.atan2(rAnkle.y - rKnee.y, rAnkle.x - rKnee.x);
                const footEndX = rAnkle.x + footLength * Math.cos(angle);
                const footEndY = rAnkle.y + footLength * Math.sin(angle);
                fillLimbPoly(rAnkle, { x: footEndX, y: footEndY }, limbThickness * 0.7 * LEG_EXPANSION_FACTOR);
            }
        });
    }

    _applyBodySegmentMask(poses) {
        if (!poses || poses.length === 0 || !this.currentFrameSource || !this.segmentMaskCtx) return; // Added check for segmentMaskCtx

        // Step 1: Ensure the segment mask canvas is populated with the latest pose
        // This method will now handle sizing and drawing the white shape on this.segmentMaskCanvas
        this._renderBodySegmentShapeOnMaskCanvas(poses);

        // Step 2: Apply this.segmentMaskCanvas to the main canvas (this.ctx)
        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.segmentMaskCanvas, 0, 0, canvasWidth, canvasHeight); // Use this.segmentMaskCanvas
        ctx.globalCompositeOperation = 'source-over'; // Reset for subsequent drawing (e.g., skeleton overlay)
    }

    // --- Restored Skeleton Drawing Method ---
    _drawSkeleton(poses) { // UNCOMMENTED
        if (!poses || poses.length === 0) return;
        const ctx = this.ctx;
        const scaleX = this.canvas.width / this.currentFrameSource.videoWidth;
        const scaleY = this.canvas.height / this.currentFrameSource.videoHeight;
        if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX === 0 || scaleY === 0) {
            return;
        }
        poses.forEach((pose, poseIndex) => {
            if (!pose || !pose.keypoints) return;
            const keypoints = pose.keypoints;
            const color = POSE_COLORS[poseIndex % POSE_COLORS.length];
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2;
            POSE_CONNECTIONS.forEach(([i, j]) => {
                const kp1 = keypoints[i];
                const kp2 = keypoints[j];
                if (kp1 && kp2 && kp1.score > 0.1 && kp2.score > 0.1) {
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
            keypoints.forEach((kp) => {
                if (kp && kp.score > 0.1) {
                    const x = kp.x * scaleX;
                    const y = kp.y * scaleY;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });
        });
    }
    // --- End Restored Skeleton Drawing Method ---

    startDrawingLoop() {
        if (this.isDrawing) return;
        if (!this.currentFrameSource) {
            logToConsole('VideoCompositor: Cannot start drawing loop - no current frame source.', 'warn');
            return;
        }
        logToConsole('VideoCompositor: Starting drawing loop.', 'info');
        this.isDrawing = true;
        this._drawFrame();
    }

    stopDrawingLoop() {
        logToConsole(`VideoCompositor: Stopping drawing loop for canvas '${this.canvas.id}'.`, 'info');
        this.isDrawing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Optionally clear the canvas when stopping
        // if (this.canvas.width > 0 && this.canvas.height > 0) { 
        //     this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // }
    }

    removeFrameSource() {
        logToConsole(`VideoCompositor: Removing frame source from canvas '${this.canvas.id}'.`, 'info');
        // this.stopDrawingLoop(); // Stop loop before clearing source
        this.currentFrameSource = null;
        this.sourceType = null;
        // Clear the canvas when source is removed
        if (this.canvas.width > 0 && this.canvas.height > 0) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        // If drawing loop was active, it will now skip drawing due to no source
        // and continue to request frames until explicitly stopped by stopDrawingLoop(),
        // or a new source is set which would restart meaningful drawing.
        // Consider if stopDrawingLoop should always be called here or if it's okay for it to idle.
        // For now, let it idle. If a new source is set, drawing will resume.
        // If we want to explicitly stop drawing until a new source, call stopDrawingLoop() then startDrawingLoop() in setCurrentFrameSource.
    }

    // Method to potentially add other layers later
    addLayer(config) {
        logToConsole('VideoCompositor: addLayer not implemented yet.', 'warn', config);
    }

    setVideoMask(videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            logToConsole('VideoCompositor: Invalid video element provided for mask.', 'error');
            // If an invalid element is given, ensure any existing mask is truly cleared.
            if (this.dinosaurMaskActive || this.dinosaurVideoMask) {
                this.clearVideoMask();
            }
            return;
        }

        // If there's an existing and *different* video mask, remove its specific listener.
        // The actual DOM element cleanup is handled by home.js via the videomaskcleared event or preemptively.
        if (this.dinosaurVideoMask && this.dinosaurVideoMask !== videoElement && this.boundDinosaurMaskEndedHandler) {
            this.dinosaurVideoMask.removeEventListener('ended', this.boundDinosaurMaskEndedHandler);
            logToConsole('VideoCompositor: Removed ended listener from previous, different dinosaur mask.', 'debug');
            // We don't call full clearVideoMask() here to avoid the event chain that destroys the *new* videoElement.
        } else if (this.dinosaurVideoMask && this.dinosaurVideoMask === videoElement && this.boundDinosaurMaskEndedHandler) {
            // If it's the SAME video element, ensure any existing bound listener is removed before re-adding
            // This can happen if home.js re-calls setVideoMask with the same element after an error or specific sequence.
            this.dinosaurVideoMask.removeEventListener('ended', this.boundDinosaurMaskEndedHandler);
            logToConsole('VideoCompositor: Removed ended listener from THE SAME dinosaur mask element before re-attaching.', 'debug');
        }

        this.dinosaurVideoMask = videoElement;
        // Ensure attributes are set on the new element
        this.dinosaurVideoMask.setAttribute('playsinline', '');
        this.dinosaurVideoMask.setAttribute('muted', '');
        this.dinosaurVideoMask.muted = true;
        this.dinosaurVideoMask.loop = false; // Manual loop

        this.boundDinosaurMaskEndedHandler = () => {
            if (!this.dinosaurVideoMask) return;
            logToConsole(`VideoCompositor: Dinosaur mask video '${this.dinosaurVideoMask.src.split('/').pop()}' ended. Attempting to replay.`, 'info');
            this.dinosaurVideoMask.currentTime = 0;

            if (document.hidden) {
                logToConsole('VideoCompositor: Tab is hidden, deferring dinosaur mask replay until visible.', 'info');
                return; // Don't attempt to play if hidden; _handleVisibilityChange will manage it.
            }

            const playPromise = this.dinosaurVideoMask.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    logToConsole(`Error re-playing dinosaur mask video in ended handler: ${error.name} - ${error.message}`, 'error');
                    // Avoid recursive setVideoMask. Visibility handler will attempt to fix.
                });
            }
        };
        this.dinosaurVideoMask.addEventListener('ended', this.boundDinosaurMaskEndedHandler);

        if (typeof this.dinosaurVideoMask.canPlayType === 'function' && this.dinosaurVideoMask.canPlayType('video/mp4')) {
            logToConsole(`Dinosaur mask video '${this.dinosaurVideoMask.src.split('/').pop()}' can play. Attempting to set as mask.`, 'info');

            // Defer initial play if tab is hidden, visibility handler will pick it up
            if (document.hidden) {
                logToConsole('VideoCompositor: Tab is hidden. Initial play of dinosaur mask deferred until visible.', 'info');
                // Mark as active so visibility handler knows to play it, but it's not playing yet.
                // It will become truly active once play() succeeds in visibility handler or here.
                this.dinosaurMaskActive = true;
                // We still need to attach the ended listener.
                logToConsole('VideoCompositor: Dinosaur video mask ready, manual loop handler attached (deferred play).', 'info');
                return; // Don't play yet
            }

            const playPromise = this.dinosaurVideoMask.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    this.dinosaurMaskActive = true;
                    logToConsole('VideoCompositor: Dinosaur video mask set and manual loop handler attached.', 'success');
                }).catch(error => {
                    logToConsole(`VideoCompositor: Error initially playing dinosaur mask video: ${error.name} - ${error.message}`, 'error');
                    this.dinosaurMaskActive = false; // Failed to start
                    if (document.hidden) {
                        logToConsole('VideoCompositor: Initial play failed while tab hidden. Will attempt on visibility.', 'info');
                        // If it failed because it's hidden, mark as active so visibility handler can try
                        this.dinosaurMaskActive = true;
                    }
                });
            } else {
                // Very old browser, or unexpected state, assume play if no promise.
                this.dinosaurVideoMask.play(); // Attempt direct play
                this.dinosaurMaskActive = true;
                logToConsole('VideoCompositor: Dinosaur video mask set (no play promise). Manual loop handler attached.', 'info');
            }
        } else {
            logToConsole(`Dinosaur mask video '${this.dinosaurVideoMask.src.split('/').pop()}' cannot play type 'video/mp4'. Mask not set.`, 'warn');
            this.clearVideoMask();
        }
    }

    clearVideoMask() {
        logToConsole('VideoCompositor: Clearing dinosaur video mask.', 'info');
        if (this.dinosaurVideoMask && this.boundDinosaurMaskEndedHandler) {
            this.dinosaurVideoMask.removeEventListener('ended', this.boundDinosaurMaskEndedHandler);
            logToConsole('VideoCompositor: Removed ended listener from dinosaur mask.', 'debug');
        }
        this.dinosaurVideoMask = null;
        this.dinosaurMaskActive = false;
        this.boundDinosaurMaskEndedHandler = null;
        if (this.isDrawing) this._drawFrame(true); // Force redraw to clear mask immediately

        // Dispatch an event so other modules can react (e.g., UI updates)
        if (this.canvas) { // Ensure canvas exists
            try {
                this.canvas.dispatchEvent(new CustomEvent('videomaskcleared', { bubbles: true }));
                logToConsole('VideoCompositor: Dispatched videomaskcleared event.', 'debug');
            } catch (e) {
                logToConsole(`VideoCompositor: Error dispatching videomaskcleared event: ${e.message}`, 'error');
            }
        }
    }

    isDinosaurMaskActive() {
        return this.dinosaurMaskActive && this.dinosaurVideoMask;
    }

    setDinosaurMaskActive(isActive) {
        this.dinosaurMaskActive = !!isActive;
        logToConsole(`VideoCompositor: Dinosaur mask explicitly set to ${this.dinosaurMaskActive}.`, 'info');
        // If we are activating it and it's paused (and visible), try to play.
        if (this.dinosaurMaskActive && this.dinosaurVideoMask && this.dinosaurVideoMask.paused && !document.hidden) {
            logToConsole('VideoCompositor: Attempting to play dinosaur mask due to explicit activation.', 'info');
            this.dinosaurVideoMask.play().catch(err => {
                logToConsole(`VideoCompositor: Error playing dinosaur mask on explicit activation: ${err.message}`, 'error');
            });
        }
        // If deactivating, pause it.
        else if (!this.dinosaurMaskActive && this.dinosaurVideoMask && !this.dinosaurVideoMask.paused) {
            this.dinosaurVideoMask.pause();
            logToConsole('VideoCompositor: Paused dinosaur mask due to explicit deactivation.', 'info');
        }
    }

    setMirrored(mirrored) {
        this.isMirrored = mirrored;
        if (this.canvas) {
            this.canvas.style.transform = this.isMirrored ? 'scaleX(-1)' : 'none';
            logToConsole(`VideoCompositor: Canvas mirroring set to ${this.isMirrored}. Transform: ${this.canvas.style.transform}`, 'info');
        } else {
            logToConsole('VideoCompositor: setMirrored called but canvas is not available.', 'warn');
        }
    }

    // --- New Visibility Change Handler ---
    _handleVisibilityChange() {
        if (this.dinosaurVideoMask && this.dinosaurMaskActive) { // Check if mask is supposed to be active
            if (document.hidden) {
                // Video is likely paused by the browser automatically.
                // We could explicitly pause:
                // if (!this.dinosaurVideoMask.paused) {
                //     this.dinosaurVideoMask.pause();
                //     logToConsole('VideoCompositor: Dinosaur mask explicitly paused due to tab hidden.', 'info');
                // }
            } else {
                // Tab is visible
                if (this.dinosaurVideoMask.paused) {
                    logToConsole('VideoCompositor: Tab became visible, attempting to resume dinosaur mask video.', 'info');
                    const playPromise = this.dinosaurVideoMask.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            logToConsole(`VideoCompositor: Error resuming dinosaur mask video on visibility change: ${error.name} - ${error.message}`, 'error');
                        });
                    }
                }
            }
        }
    }

    destroy() {
        logToConsole('VideoCompositor: Destroying VideoCompositor instance.', 'info');
        this.stopDrawingLoop();
        this.removeFrameSource(); // This should also stop any video source if it's playing
        this.clearVideoMask();    // This handles removing the 'ended' listener from the dinosaur mask

        if (this.poseDetector && typeof this.poseDetector.dispose === 'function') {
            this.poseDetector.dispose();
            this.poseDetector = null;
            logToConsole('VideoCompositor: Disposed of pose detector model.', 'info');
        }

        if (this._boundHandleVisibilityChange) {
            document.removeEventListener('visibilitychange', this._boundHandleVisibilityChange);
            logToConsole('VideoCompositor: Removed visibilitychange listener.', 'info');
            this._boundHandleVisibilityChange = null; // Clear the bound function reference
        }

        // Nullify other properties if needed
        this.canvas = null;
        this.ctx = null;
        this.currentFrameSource = null;
        this.dinosaurVideoMask = null;
        // ... any other resources
        logToConsole('VideoCompositor: Instance destroyed.', 'info');
    }

    // NEW METHOD FOR DIFFERENCE MASK
    _drawDifferenceMaskLayer() {
        if (!this.currentFrameSource || /*!this.scaledDinoShapeCanvas ||*/ !this.lumaMaskCanvas ||
            !this.dinosaurVideoMask || !this.lowResPersonCtx || !this.lowResDinoCtx) {
            logToConsole('Difference Mask: Missing one or more required inputs (currentFrameSource, lumaMaskCanvas, dinosaurVideoMask, lowRes ctxs).', 'warn');
            return;
        }

        const fullWidth = this.canvas.width;
        const fullHeight = this.canvas.height;

        if (fullWidth === 0 || fullHeight === 0) {
            logToConsole('Difference Mask: Main canvas has zero dimensions.', 'warn');
            return;
        }

        const lowResWidth = Math.floor(fullWidth / DIFFERENCE_MASK_SCALEDOWN_FACTOR);
        const lowResHeight = Math.floor(fullHeight / DIFFERENCE_MASK_SCALEDOWN_FACTOR);

        if (lowResWidth === 0 || lowResHeight === 0) {
            logToConsole('Difference Mask: Low resolution dimensions are zero. Scaledown factor might be too high for current canvas size.', 'warn');
            this.ctx.clearRect(0, 0, fullWidth, fullHeight); // Clear main canvas
            return;
        }

        // Ensure currentFrameSource has dimensions and is ready if it's a video
        let personSourceReady = false;
        if (this.currentFrameSource instanceof HTMLVideoElement) {
            const vid = this.currentFrameSource;
            if (vid.readyState >= vid.HAVE_CURRENT_DATA && !vid.paused && vid.videoWidth > 0 && vid.videoHeight > 0) {
                personSourceReady = true;
            }
        } else if (this.currentFrameSource instanceof HTMLCanvasElement) {
            if (this.currentFrameSource.width > 0 && this.currentFrameSource.height > 0) {
                personSourceReady = true;
            }
        } else {
            logToConsole('Difference Mask: currentFrameSource is not a Video or Canvas element.', 'error');
            return;
        }

        if (!personSourceReady) {
            logToConsole('Difference Mask: Person source (currentFrameSource) not ready or has no dimensions.', 'warn');
            this.ctx.clearRect(0, 0, fullWidth, fullHeight); // Clear main canvas to avoid stale frame
            return;
        }

        // 1. Prepare Low-Resolution Person Shape Data (from segmentMaskCanvas)
        if (this.lowResPersonCanvas.width !== lowResWidth) this.lowResPersonCanvas.width = lowResWidth;
        if (this.lowResPersonCanvas.height !== lowResHeight) this.lowResPersonCanvas.height = lowResHeight;
        this.lowResPersonCtx.clearRect(0, 0, lowResWidth, lowResHeight);

        let personData; // This will hold the image data for the person shape

        // Ensure segmentMaskCanvas is valid and draw it to the low-resolution person canvas
        if (this.segmentMaskCanvas && this.segmentMaskCanvas.width > 0 && this.segmentMaskCanvas.height > 0) {
            this.lowResPersonCtx.drawImage(this.segmentMaskCanvas, 0, 0, lowResWidth, lowResHeight);
            const segMaskLowResImageData = this.lowResPersonCtx.getImageData(0, 0, lowResWidth, lowResHeight);
            personData = segMaskLowResImageData.data;
        } else {
            logToConsole('Difference Mask: segmentMaskCanvas not ready or empty. Person shape will be empty.', 'warn');
            // Create dummy transparent image data if segment mask is not available
            const emptyImageData = this.lowResPersonCtx.createImageData(lowResWidth, lowResHeight);
            personData = emptyImageData.data; // All pixels will have alpha 0, so isPerson will be false.
        }

        // 2. Prepare Low-Resolution Dinosaur Shape Data
        const dinoVideo = this.dinosaurVideoMask;
        const dinoVideoWidth = dinoVideo.videoWidth;
        const dinoVideoHeight = dinoVideo.videoHeight;

        if (dinoVideoWidth === 0 || dinoVideoHeight === 0) {
            logToConsole('Difference Mask: Dinosaur video has zero dimensions.', 'warn');
            this.ctx.clearRect(0, 0, fullWidth, fullHeight); // Clear main canvas
            return;
        }

        // Draw current dino frame to lumaMaskCanvas (original size) & process luma to alpha
        if (this.lumaMaskCanvas.width !== dinoVideoWidth) this.lumaMaskCanvas.width = dinoVideoWidth;
        if (this.lumaMaskCanvas.height !== dinoVideoHeight) this.lumaMaskCanvas.height = dinoVideoHeight;
        this.lumaMaskCtx.clearRect(0, 0, dinoVideoWidth, dinoVideoHeight);
        this.lumaMaskCtx.drawImage(dinoVideo, 0, 0, dinoVideoWidth, dinoVideoHeight);
        const dinoLumaImageData = this.lumaMaskCtx.getImageData(0, 0, dinoVideoWidth, dinoVideoHeight);
        const dinoLumaData = dinoLumaImageData.data;
        for (let i = 0; i < dinoLumaData.length; i += 4) {
            dinoLumaData[i + 3] = dinoLumaData[i];
        }
        this.lumaMaskCtx.putImageData(dinoLumaImageData, 0, 0);

        // Scale processed lumaMaskCanvas (with alpha matte) down to lowResDinoCanvas
        if (this.lowResDinoCanvas.width !== lowResWidth) this.lowResDinoCanvas.width = lowResWidth;
        if (this.lowResDinoCanvas.height !== lowResHeight) this.lowResDinoCanvas.height = lowResHeight;
        this.lowResDinoCtx.clearRect(0, 0, lowResWidth, lowResHeight);
        this.lowResDinoCtx.drawImage(this.lumaMaskCanvas, 0, 0, lowResWidth, lowResHeight);
        const dinoShapeImageData = this.lowResDinoCtx.getImageData(0, 0, lowResWidth, lowResHeight);
        const dinoData = dinoShapeImageData.data;

        // 3. Create Low-Resolution Difference Mask Pixels
        const outputImageData = this.lowResPersonCtx.createImageData(lowResWidth, lowResHeight); // Create low-res image data
        const outputData = outputImageData.data;

        let matchedPixelCount = 0;
        let dinoPixelCount = 0;

        for (let i = 0; i < outputData.length; i += 4) {
            const personAlpha = personData[i + 3]; // Alpha from segmentMaskCanvas (or 0 if not ready)
            const isPerson = personAlpha > 128; // Check alpha channel from segment mask
            const isDino = dinoData[i + 3] > 128;

            if (isDino) {
                dinoPixelCount++;
            }

            if (isPerson && isDino) {
                matchedPixelCount++;
                outputData[i] = 0;     // R - Green
                outputData[i + 1] = 255; // G
                outputData[i + 2] = 0;     // B
                outputData[i + 3] = 255; // A
            } else if (isPerson && !isDino) {
                outputData[i] = 255; // R - Red
                outputData[i + 1] = 0;   // G
                outputData[i + 2] = 0;   // B
                outputData[i + 3] = 255; // A
            } else if (!isPerson && isDino) {
                outputData[i] = 255; // R - White
                outputData[i + 1] = 255; // G
                outputData[i + 2] = 255; // B
                outputData[i + 3] = 255; // A
            } else {
                outputData[i + 3] = 0; // Transparent
            }
        }
        this.differenceScore = (dinoPixelCount > 0) ? (matchedPixelCount / dinoPixelCount) * 100 : 0;

        // Put the low-res result onto the lowResPersonCanvas (or any lowRes canvas, just to hold it)
        this.lowResPersonCtx.putImageData(outputImageData, 0, 0);

        // 4. Draw the low-resolution result (now on lowResPersonCanvas) up to the main canvas
        this.ctx.clearRect(0, 0, fullWidth, fullHeight); // Clear main canvas

        const oldSmoothing = this.ctx.imageSmoothingEnabled;
        this.ctx.imageSmoothingEnabled = false; // For pixelated effect
        this.ctx.mozImageSmoothingEnabled = false;
        this.ctx.webkitImageSmoothingEnabled = false;
        this.ctx.msImageSmoothingEnabled = false;

        this.ctx.drawImage(this.lowResPersonCanvas, 0, 0, fullWidth, fullHeight);

        this.ctx.imageSmoothingEnabled = oldSmoothing; // Restore smoothing setting
        this.ctx.mozImageSmoothingEnabled = oldSmoothing;
        this.ctx.webkitImageSmoothingEnabled = oldSmoothing;
        this.ctx.msImageSmoothingEnabled = oldSmoothing;

        // Draw the score
        this.ctx.font = '200px monospace'; // Larger, monospace font
        this.ctx.fillStyle = 'yellow';
        this.ctx.textAlign = 'center'; // Centered horizontally
        this.ctx.textBaseline = 'middle'; // Centered vertically

        // Save context for potential mirroring
        this.ctx.save();

        if (this.isMirrored) {
            // Flip horizontally
            this.ctx.scale(-1, 1);
            // Adjust position to draw on the other side
            this.ctx.fillText(`Match: ${this.differenceScore.toFixed(1)}%`, -this.canvas.width / 2, this.canvas.height / 2);
        } else {
            this.ctx.fillText(`Match: ${this.differenceScore.toFixed(1)}%`, this.canvas.width / 2, this.canvas.height / 2);
        }

        // Restore context
        this.ctx.restore();
    }
} 