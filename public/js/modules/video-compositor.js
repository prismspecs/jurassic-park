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

        // --- New/Modified Pose Detection State ---
        this.poseDetector = null;
        this.tfjsBackendReady = false;
        this.enablePoseDetection = false; // Controls if detection runs
        this.drawSkeletonOverlay = false; // Controls skeleton drawing
        this.drawBoundingBoxMask = false; // Controls mask drawing
        this.drawBodySegmentMask = false; // Controls body segment mask drawing
        this.lastDetectedPoses = [];
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

        this.isMirrored = false; // Added for mirror toggle
        this.boundDinosaurMaskEndedHandler = null; // For manual looping of dino mask

        // Visibility API
        this._boundHandleVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundHandleVisibilityChange);

        logToConsole(`VideoCompositor initialized for canvas '#${this.canvas.id || '(no ID yet)'}'.`, 'info');
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
        const shouldEnablePose = this.drawSkeletonOverlay || this.drawBoundingBoxMask || this.drawBodySegmentMask;
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
                try {
                    this.ctx.drawImage(this.currentFrameSource, 0, 0, this.canvas.width, this.canvas.height);
                } catch (e) {
                    logToConsole(`Error drawing source image: ${e}`, 'error');
                }
            }

            // APPLY DINOSAUR VIDEO MASK (if active)
            if (this.dinosaurMaskActive && this.dinosaurVideoMask &&
                this.dinosaurVideoMask.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                !this.dinosaurVideoMask.paused && this.lumaMaskCtx) { // Check lumaMaskCtx

                const maskVideo = this.dinosaurVideoMask;
                const maskWidth = maskVideo.videoWidth;
                const maskHeight = maskVideo.videoHeight;

                if (maskWidth > 0 && maskHeight > 0) {
                    if (this.lumaMaskCanvas.width !== maskWidth) this.lumaMaskCanvas.width = maskWidth;
                    if (this.lumaMaskCanvas.height !== maskHeight) this.lumaMaskCanvas.height = maskHeight;

                    try {
                        // 1. Draw B&W video frame to offscreen lumaMaskCanvas
                        this.lumaMaskCtx.drawImage(maskVideo, 0, 0, maskWidth, maskHeight);

                        // 2. Get imageData and process for luma matte
                        const imageData = this.lumaMaskCtx.getImageData(0, 0, maskWidth, maskHeight);
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            // Assuming B&W, R=G=B. Use Red channel as luma value.
                            // White (255) = opaque mask (alpha=255)
                            // Black (0)   = transparent mask (alpha=0)
                            data[i + 3] = data[i]; // Set alpha to the red channel value
                        }
                        this.lumaMaskCtx.putImageData(imageData, 0, 0);

                        // 3. Apply the processed lumaMaskCanvas as the mask
                        this.ctx.save();
                        this.ctx.globalCompositeOperation = 'destination-in';
                        // Draw lumaMaskCanvas onto the main canvas, scaled to main canvas size
                        this.ctx.drawImage(this.lumaMaskCanvas, 0, 0, this.canvas.width, this.canvas.height);
                        this.ctx.restore();

                    } catch (e) {
                        logToConsole(`Error processing or drawing luma matte dinosaur mask: ${e.message}`, 'error');
                    }
                }
            } else if (this.dinosaurMaskActive && this.dinosaurVideoMask) {
                logToConsole(`DinoMask luma processing SKIPPED: Time=${this.dinosaurVideoMask.currentTime.toFixed(2)}, RS=${this.dinosaurVideoMask.readyState}, Paused=${this.dinosaurVideoMask.paused}`, 'debug');
            }

            let posesToDraw = null;

            if (this.enablePoseDetection && this.poseDetector && !forceClearEffects) {
                // Always use the last available poses for drawing
                posesToDraw = this.lastDetectedPoses;

                // Only run estimation every other frame (or adjust N as needed)
                const ESTIMATION_INTERVAL = 2; // Run every 2 frames
                if (this.frameCount % ESTIMATION_INTERVAL === 0) {
                    try {
                        // console.debug(`[${this.canvas.id}] Running pose estimation (frame ${this.frameCount})...`); // Uncomment for verbose debug
                        this.poseDetector.estimatePoses(this.currentFrameSource)
                            .then(poses => {
                                this.lastDetectedPoses = poses; // Update last poses when estimation runs
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

            // Apply Mask (using last detected poses)
            if (this.drawBoundingBoxMask && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                try { this._applyMaskShapes(posesToDraw); }
                catch (maskError) { logToConsole(`Error applying mask shapes: ${maskError}`, 'error'); }
            }

            // Apply Body Segment Mask (using last detected poses)
            if (this.drawBodySegmentMask && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                try { this._applyBodySegmentMask(posesToDraw); }
                catch (segmentError) { logToConsole(`Error applying body segment mask: ${segmentError}`, 'error'); }
            }

            // Draw Skeleton Overlay (using last detected poses)
            if (this.drawSkeletonOverlay && posesToDraw && posesToDraw.length > 0 && !forceClearEffects) {
                try { this._drawSkeleton(posesToDraw); }
                catch (skeletonError) { logToConsole(`Error drawing skeleton: ${skeletonError}`, 'error'); }
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

    _applyBodySegmentMask(poses) {
        if (!poses || poses.length === 0 || !this.currentFrameSource) return;

        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        const sourceWidth = (this.sourceType === 'video') ? this.currentFrameSource.videoWidth : this.currentFrameSource.width;
        const sourceHeight = (this.sourceType === 'video') ? this.currentFrameSource.videoHeight : this.currentFrameSource.height;

        if (!sourceWidth || !sourceHeight) {
            logToConsole('BodySegmentMask: Source dimensions are invalid for scaling.', 'warn');
            return;
        }

        const scaleX = canvasWidth / sourceWidth;
        const scaleY = canvasHeight / sourceHeight;

        // Create or reuse an offscreen canvas for the mask
        // For simplicity, creating a new one each time. Could be optimized by reusing a member canvas.
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = canvasWidth;
        maskCanvas.height = canvasHeight;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) {
            logToConsole('BodySegmentMask: Failed to get context for mask canvas.', 'error');
            return;
        }

        maskCtx.fillStyle = 'white'; // Mask color, opaque areas will keep video pixels

        poses.forEach(pose => {
            if (!pose || !pose.keypoints) return;
            const keypoints = pose.keypoints;
            const confidenceThreshold = 0.2;

            const kp = (index) => {
                if (keypoints[index] && keypoints[index].score > confidenceThreshold) {
                    // Return coordinates already scaled to the destination canvas dimensions
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
            // const lAnkle = kp(15);
            // const rAnkle = kp(16);

            // Torso
            if (lShoulder && rShoulder && rHip && lHip) {
                maskCtx.beginPath();
                maskCtx.moveTo(lShoulder.x, lShoulder.y);
                maskCtx.lineTo(rShoulder.x, rShoulder.y);
                maskCtx.lineTo(rHip.x, rHip.y);
                maskCtx.lineTo(lHip.x, lHip.y);
                maskCtx.closePath();
                maskCtx.fill();
            }

            // Head
            if (nose) {
                let headRadius = 15; // Default radius in pixels on the canvas
                if (lShoulder && rShoulder) {
                    headRadius = Math.abs(rShoulder.x - lShoulder.x) / 2.5; // Estimate from shoulder width
                }
                headRadius = Math.max(headRadius, 10); // Minimum size
                maskCtx.beginPath();
                maskCtx.arc(nose.x, nose.y, headRadius, 0, 2 * Math.PI);
                maskCtx.closePath();
                maskCtx.fill();
            }

            const limbThickness = Math.max(15, (lShoulder && rShoulder ? Math.abs(rShoulder.x - lShoulder.x) / 5 : 15)); // Dynamic thickness

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

            fillLimbPoly(lShoulder, lElbow, limbThickness);
            fillLimbPoly(lElbow, lWrist, limbThickness);
            fillLimbPoly(rShoulder, rElbow, limbThickness);
            fillLimbPoly(rElbow, rWrist, limbThickness);
            fillLimbPoly(lHip, lKnee, limbThickness);
            // fillLimbPoly(lKnee, lAnkle, limbThickness * 0.8); // Ankles could be thinner
            fillLimbPoly(rHip, rKnee, limbThickness);
            // fillLimbPoly(rKnee, rAnkle, limbThickness * 0.8);
        });

        // Apply the mask: current video frame (already on ctx) is kept where maskCanvas is opaque.
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, 0, 0, canvasWidth, canvasHeight);
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
        }
        // If the new videoElement is the same as the old one, no need to re-add listeners if already active.
        // However, home.js logic typically creates a new element, so this might be rare.
        // If it's the same element and we are effectively just re-triggering, clearVideoMask might have already run.

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
} 