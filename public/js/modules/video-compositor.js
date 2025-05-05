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
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            logToConsole(`VideoCompositor: Canvas element with ID '${canvasId}' not found.`, 'error');
            throw new Error(`Canvas element with ID '${canvasId}' not found.`);
        }

        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            logToConsole(`VideoCompositor: Failed to get 2D context for canvas '${canvasId}'.`, 'error');
            throw new Error(`Failed to get 2D context for canvas '${canvasId}'.`);
        }

        // For now, just one source. Later, this will be a list/map of layers.
        this.primaryVideoSource = null;
        this.animationFrameId = null;
        this.isDrawing = false;

        // --- New/Modified Pose Detection State ---
        this.poseDetector = null;
        this.tfjsBackendReady = false;
        this.enablePoseDetection = false; // Controls if detection runs
        this.drawSkeletonOverlay = false; // Controls skeleton drawing
        this.drawBoundingBoxMask = false; // Controls mask drawing
        this.lastDetectedPoses = [];
        this._initializeTfjsAndDetector();
        // --- End New/Modified State ---

        logToConsole(`VideoCompositor initialized for canvas '#${canvasId}'.`, 'info');
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
            // await tf.setBackend('webgl'); // Switch to WebGPU
            await tf.setBackend('webgpu');
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
            if (this.isDrawing) this._drawFrame(true);
        }
    }

    setDrawSkeletonOverlay(enabled) {
        const changed = this.drawSkeletonOverlay !== !!enabled;
        this.drawSkeletonOverlay = !!enabled;
        logToConsole(`VideoCompositor: Skeleton overlay set to ${this.drawSkeletonOverlay}.`, 'info');
        // Trigger redraw if state changed and detection is active
        if (changed && this.enablePoseDetection && this.isDrawing) this._drawFrame(true);
    }

    setDrawBoundingBoxMask(enabled) {
        const changed = this.drawBoundingBoxMask !== !!enabled;
        this.drawBoundingBoxMask = !!enabled;
        logToConsole(`VideoCompositor: Bounding box mask set to ${this.drawBoundingBoxMask}.`, 'info');
        // Trigger redraw if state changed and detection is active
        if (changed && this.enablePoseDetection && this.isDrawing) this._drawFrame(true);
    }
    // --- End Control Methods ---

    // Sets the main video source to be drawn
    setPrimaryVideoSource(videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            logToConsole('VideoCompositor: Invalid video element provided.', 'error');
            return;
        }
        logToConsole(`VideoCompositor: Setting primary video source (${videoElement.id || 'no id'}).`, 'info');
        this.primaryVideoSource = videoElement;

        // Ensure canvas is initially sized correctly if video is ready
        const checkVideoReady = () => {
            if (this.primaryVideoSource.readyState >= 2) { // HAVE_CURRENT_DATA or higher
                const width = this.primaryVideoSource.videoWidth;
                const height = this.primaryVideoSource.videoHeight;
                if (width > 0 && height > 0) {
                    logToConsole(`VideoCompositor: Source video ready with resolution ${width}x${height}.`, 'info');
                    this._sizeCanvasToVideo();
                } else {
                    logToConsole(`VideoCompositor: Source video ready but resolution is ${width}x${height}. Retrying...`, 'warn');
                    setTimeout(checkVideoReady, 100); // Retry shortly
                }
            } else {
                logToConsole('VideoCompositor: Waiting for video source to become ready...', 'debug');
                setTimeout(checkVideoReady, 100); // Retry shortly
            }
        };

        checkVideoReady(); // Initial check

        if (!this.isDrawing) {
            this.startDrawingLoop();
        }
    }

    _sizeCanvasToVideo() {
        if (!this.primaryVideoSource) return;

        const videoWidth = this.primaryVideoSource.videoWidth;
        const videoHeight = this.primaryVideoSource.videoHeight;

        if (videoWidth > 0 && videoHeight > 0) {
            if (this.canvas.width !== videoWidth || this.canvas.height !== videoHeight) {
                this.canvas.width = videoWidth;
                this.canvas.height = videoHeight;
                logToConsole(`VideoCompositor: Resized canvas to ${videoWidth}x${videoHeight}`, 'debug');
            }
        } else {
            logToConsole(`VideoCompositor: Video source has zero dimensions (${videoWidth}x${videoHeight}), canvas not resized.`, 'warn');
        }
    }

    _drawFrame(forceClearEffects = false) {
        if (!this.isDrawing) return;
        this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
        if (!this.primaryVideoSource) return;
        if (this.primaryVideoSource.paused || this.primaryVideoSource.ended || this.primaryVideoSource.readyState < 2) {
            // Clear canvas if video stops?
            // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        this._sizeCanvasToVideo();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // --- Refactored Drawing Logic ---
        let posesToDraw = null;
        let drawPlainVideo = true; // Assume plain video draw initially

        // 1. Estimate Poses (if enabled)
        if (this.enablePoseDetection && this.poseDetector && !forceClearEffects) {
            // Use last frame's poses for immediate drawing to reduce lag
            posesToDraw = this.lastDetectedPoses;
            // Start estimation for the *next* frame (don't await)
            this.poseDetector.estimatePoses(this.primaryVideoSource)
                .then(poses => { this.lastDetectedPoses = poses; })
                .catch(err => {
                    logToConsole(`VideoCompositor: Error estimating poses: ${err.message}`, 'error');
                    this.lastDetectedPoses = [];
                });
        } else {
            this.lastDetectedPoses = []; // Clear poses if detection off
            posesToDraw = [];
        }

        // 2. Draw Base Video Frame
        this.ctx.drawImage(this.primaryVideoSource, 0, 0, this.canvas.width, this.canvas.height);
        drawPlainVideo = false; // Video has been drawn

        // 3. Apply Mask (if enabled and poses exist)
        if (this.drawBoundingBoxMask && posesToDraw && posesToDraw.length > 0) {
            this._applyMaskShapes(posesToDraw); // Apply mask shapes
            drawPlainVideo = false; // Mask was applied, no need for plain draw
        }

        // 4. Draw Skeleton Overlay (if enabled and poses exist)
        // Note: Draw skeleton *after* potential masking
        if (this.drawSkeletonOverlay && posesToDraw && posesToDraw.length > 0) {
            this._drawSkeleton(posesToDraw);
            drawPlainVideo = false; // Skeleton drawn, no need for plain draw
        }

        // Redundant check, drawImage is always called above now.
        // if (drawPlainVideo) {
        //     this.ctx.drawImage(this.primaryVideoSource, 0, 0, this.canvas.width, this.canvas.height);
        // }
        // --- End Refactored Logic ---
    }

    // --- Refactored Masking Method (Applies shapes only) ---
    _applyMaskShapes(poses) {
        if (!poses || poses.length === 0) return;

        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const scaleX = canvasWidth / this.primaryVideoSource.videoWidth;
        const scaleY = canvasHeight / this.primaryVideoSource.videoHeight;

        if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX === 0 || scaleY === 0) return;

        ctx.save();
        ctx.fillStyle = 'black'; // Color doesn't matter
        ctx.globalCompositeOperation = 'destination-in';

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
                ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            }
        });
        ctx.restore(); // Restore globalCompositeOperation
    }
    // --- End Refactored Masking Method ---

    // --- Restored Skeleton Drawing Method ---
    _drawSkeleton(poses) { // UNCOMMENTED
        if (!poses || poses.length === 0) return;
        const ctx = this.ctx;
        const scaleX = this.canvas.width / this.primaryVideoSource.videoWidth;
        const scaleY = this.canvas.height / this.primaryVideoSource.videoHeight;
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
        if (!this.primaryVideoSource) {
            logToConsole('VideoCompositor: Cannot start drawing loop - no primary video source.', 'warn');
            return;
        }
        logToConsole('VideoCompositor: Starting drawing loop.', 'info');
        this.isDrawing = true;
        this._drawFrame();
    }

    stopDrawingLoop() {
        if (!this.isDrawing) return;
        logToConsole('VideoCompositor: Stopping drawing loop.', 'info');
        this.isDrawing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // Method to potentially add other layers later
    addLayer(config) {
        logToConsole('VideoCompositor: addLayer not implemented yet.', 'warn', config);
    }
} 