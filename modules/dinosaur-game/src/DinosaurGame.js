// Main class encapsulating game logic

import * as posenetHandler from './posenet-handler.js';
import * as drawing from './drawing.js';
import * as scoring from './scoring.js';
import * as utils from './utils.js';

export class DinosaurGame {
    constructor(config = {}) {
        console.log('DinosaurGame constructor called with config:', config);

        // Default configuration
        const defaultConfig = {
            webcamElementId: 'webcam',
            outputCanvasId: 'output',
            maskVideoElementId: 'mask-video',
            maskVideoSrc: null, // Require user to provide src initially
            // --- PoseNet Config ---
            posenetModelConfig: {
                 architecture: 'MobileNetV1',
                 outputStride: 16,
                 inputResolution: { width: 640, height: 480 },
                 multiplier: 0.75
            },
            posenetEstimationConfig: {
                 flipHorizontal: false // Depends on webcam mirroring
            },
             // --- Webcam Config ---
             webcamConfig: {
                 resolution: '640x480', // Default webcam resolution request
                 deviceId: null // Default camera
             },
            // --- Drawing Config ---
            drawingConfig: {
                // Config for drawBodyWithOverlap
                overlapColor: 'lime',
                nonOverlapColor: 'red',
                silhouetteThreshold: 128,
                maskThreshold: 128,
                // Config for internal silhouette drawing (passed within drawBodyWithOverlap)
                silhouetteConfig: {
                    limbThickness: 25,
                    fillColor: 'white', // Internal silhouette drawn white
                    scoreThreshold: 0.2
                },
                 // Config for optional skeleton drawing
                 skeletonConfig: {
                    keypointColor: 'cyan',
                    keypointRadius: 4,
                    lineColor: 'cyan',
                    lineWidth: 2,
                    scoreThreshold: 0.2
                 },
                 drawSkeletonOverlay: false // Whether to draw the skeleton on top
            },
             // --- Scoring Config ---
             scoringConfig: {
                 // Thresholds passed to calculateOverlapScore (can mirror drawingConfig)
                 silhouetteThreshold: 128,
                 maskThreshold: 128
             },
            // --- Callbacks ---
            scoreUpdateCallback: (score) => { /* console.log(`Score: ${score}%`); */ }, // Default no-op
            gameStateUpdateCallback: (state) => { console.log(`Game State: ${state}`); } // 'initializing', 'ready', 'running', 'stopped', 'error'
        };

        // Merge user config with defaults (deep merge might be needed for nested objects)
        // Simple merge for now:
        this.config = {
            ...defaultConfig,
            ...config,
            posenetModelConfig: { ...defaultConfig.posenetModelConfig, ...config.posenetModelConfig },
            posenetEstimationConfig: { ...defaultConfig.posenetEstimationConfig, ...config.posenetEstimationConfig },
            webcamConfig: { ...defaultConfig.webcamConfig, ...config.webcamConfig },
            drawingConfig: {
                ...defaultConfig.drawingConfig,
                ...config.drawingConfig,
                silhouetteConfig: { ...defaultConfig.drawingConfig.silhouetteConfig, ...(config.drawingConfig?.silhouetteConfig || {}) },
                skeletonConfig: { ...defaultConfig.drawingConfig.skeletonConfig, ...(config.drawingConfig?.skeletonConfig || {}) },
            },
            scoringConfig: { ...defaultConfig.scoringConfig, ...config.scoringConfig },
        };

        // Validate essential config
        if (!this.config.maskVideoSrc) {
            throw new Error("DinosaurGame config requires 'maskVideoSrc'.");
        }

        // Get DOM elements
        this.webcamElement = document.getElementById(this.config.webcamElementId);
        this.outputCanvas = document.getElementById(this.config.outputCanvasId);
        this.maskVideoElement = document.getElementById(this.config.maskVideoElementId);

        if (!this.webcamElement || !(this.webcamElement instanceof HTMLVideoElement)) {
            throw new Error(`Webcam element with ID '${this.config.webcamElementId}' not found or not a video element.`);
        }
        if (!this.outputCanvas || !(this.outputCanvas instanceof HTMLCanvasElement)) {
            // Check if the configured ID exists, provide better error
            const el = document.getElementById(this.config.outputCanvasId);
            if (!el) {
                 throw new Error(`Output canvas element with ID '${this.config.outputCanvasId}' not found in the HTML.`);
            } else {
                 throw new Error(`Element with ID '${this.config.outputCanvasId}' was found, but it is not a canvas element.`);
            }
        }
        if (!this.maskVideoElement || !(this.maskVideoElement instanceof HTMLVideoElement)) {
            throw new Error(`Mask video element with ID '${this.config.maskVideoElementId}' not found or not a video element.`);
        }

        // Get canvas context
        this.outputCtx = this.outputCanvas.getContext('2d');
         if (!this.outputCtx) {
             throw new Error('Could not get 2D context from the output canvas.');
        }

        // Create hidden canvas for processing mask frames
        this.maskProcessCanvas = document.createElement('canvas');
        this.maskProcessCtx = this.maskProcessCanvas.getContext('2d', { willReadFrequently: true });
        if (!this.maskProcessCtx) {
             throw new Error('Could not create internal canvas context for mask processing.');
        }
        // Create hidden canvas for PoseNet input
        this.poseInputCanvas = document.createElement('canvas');
        this.poseInputCtx = this.poseInputCanvas.getContext('2d');
         if (!this.poseInputCtx) {
             throw new Error('Could not create internal canvas context for PoseNet input.');
        }
        // Create hidden canvas for low-res processing (silhouette + overlap)
        this.processingCanvas = document.createElement('canvas');
        this.processingCtx = this.processingCanvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently for scoring
        if (!this.processingCtx) {
            throw new Error('Could not create internal canvas context for processing.');
        }

        // State variables
        this.posenetModel = null;
        this.maskImageData = null;
        this.currentScore = 0;
        this.animationFrameId = null;
        this.gameState = 'initializing'; // 'initializing', 'ready', 'running', 'stopped', 'error'
        this.errorMessage = null;

        // Bind loops to this instance
        this._boundGameLoop = this._gameLoop.bind(this);
        this._boundDelayedStartLoop = this._delayedStartLoop.bind(this); // Bind the new function

        this._updateGameState('initializing');
    }

    // Helper to update and notify state changes
    _updateGameState(newState, error = null) {
        if (newState !== this.gameState || error !== this.errorMessage) {
            this.gameState = newState;
            this.errorMessage = error ? String(error) : null;
            console.log(`Game state changed to: ${this.gameState}${this.errorMessage ? ` (${this.errorMessage})` : ''}`);
            if (this.config.gameStateUpdateCallback) {
                try {
                     this.config.gameStateUpdateCallback(this.gameState, this.errorMessage);
                } catch(callbackError) {
                    console.error('Error in gameStateUpdateCallback:', callbackError);
                }
            }
        }
    }

    async setup() {
        console.log('DinosaurGame setup starting...');
        this._updateGameState('initializing');

        try {
            // 1. Load PoseNet model
            console.log('Loading PoseNet model...');
            this.posenetModel = await posenetHandler.loadPosenetModel(this.config.posenetModelConfig);
            console.log('PoseNet model loaded.');

            // 2. Setup Webcam (get stream first)
            console.log('Setting up webcam...');
            await utils.setupWebcam(this.webcamElement, this.config.webcamConfig);
            console.log('Webcam setup complete.');

            // 3. Load Mask Video (wait for metadata)
            console.log('Loading mask video...');
            await utils.loadVideo(this.maskVideoElement, this.config.maskVideoSrc);
            if (!utils.checkVideoDimensions(this.maskVideoElement)) {
                 throw new Error('Mask video failed to load or has invalid dimensions.');
            }
            this.maskVideoElement.loop = true;
            this.maskVideoElement.muted = true;
            this.maskVideoElement.playsInline = true;
            await this.maskVideoElement.play();
            console.log('Mask video loaded and playing.');

            // 4. Calculate and Set Canvas Dimensions
            const MAX_PROCESSING_WIDTH = 640;
            const MAX_PROCESSING_HEIGHT = 640; // Give height some room

            const maskWidth = this.maskVideoElement.videoWidth;
            const maskHeight = this.maskVideoElement.videoHeight;
            const maskAspect = maskWidth / maskHeight;
            
            // Calculate processing dimensions based on mask aspect, capped by MAX values
            let processingWidth, processingHeight;
            if (maskAspect >= 1) { // Wider or square
                processingWidth = Math.min(maskWidth, MAX_PROCESSING_WIDTH);
                processingHeight = processingWidth / maskAspect;
            } else { // Taller
                processingHeight = Math.min(maskHeight, MAX_PROCESSING_HEIGHT);
                processingWidth = processingHeight * maskAspect;
            }
             // Ensure integer values
             processingWidth = Math.round(processingWidth);
             processingHeight = Math.round(processingHeight);

            console.log(`Calculated Processing dimensions (from mask aspect): ${processingWidth}x${processingHeight}`);

            // Set final output canvas size (visual display) - Use container or default like 1920x1080
            // Ensure this happens *before* setting hidden canvas sizes if they depend on it
            const displayWidth = this.outputCanvas.clientWidth || 1920;
            const displayHeight = this.outputCanvas.clientHeight || 1080;
            this.outputCanvas.width = displayWidth; 
            this.outputCanvas.height = displayHeight;
            console.log(`Output canvas dimensions set to: ${this.outputCanvas.width}x${this.outputCanvas.height}`);

            // Set dimensions for ALL hidden canvases to processing resolution
            this.poseInputCanvas.width = processingWidth;
            this.poseInputCanvas.height = processingHeight;
            this.maskProcessCanvas.width = processingWidth;
            this.maskProcessCanvas.height = processingHeight;
            this.processingCanvas.width = processingWidth;
            this.processingCanvas.height = processingHeight;

            // 5. Setup complete
             this._updateGameState('ready');
             console.log('DinosaurGame setup complete.');

        } catch (error) {
            console.error('Error during DinosaurGame setup:', error);
             this._updateGameState('error', error);
             // Re-throw the error so the caller knows setup failed
             throw error;
        }
    }

    start() {
        if (this.gameState === 'running') {
            console.warn('Game is already running.');
            return;
        }
        if (this.gameState !== 'ready' && this.gameState !== 'stopped') { // Allow restarting from stopped state
            console.error('Game setup must be completed successfully before starting.');
            this._updateGameState('error', 'Attempted to start game before setup was complete or while in error state.');
            return;
        }

        console.log('DinosaurGame starting (will delay first loop by one frame)...');
        this._updateGameState('running');

        // Make sure mask video is playing (might have been stopped)
        if (this.maskVideoElement.paused) {
             this.maskVideoElement.play().catch(e => console.error("Error restarting mask video:", e));
        }

        // Clear any previous animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        // Start the loop via the delayed starter
        this.animationFrameId = requestAnimationFrame(this._boundDelayedStartLoop);
    }

    // Intermediate function to delay the first game loop by one frame
    _delayedStartLoop() {
         console.log('Running delayed start loop, requesting actual game loop now.');
         // Now request the actual game loop
         this.animationFrameId = requestAnimationFrame(this._boundGameLoop);
    }

    stop() {
        if (this.gameState !== 'running') {
            console.warn('Game is not running.');
            // Still might want to ensure cleanup, e.g. if stopped during setup
        }

        console.log('DinosaurGame stopping...');
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Clear the canvas
        this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);

        // Stop webcam tracks (optional, could leave running for faster restart)
        // if (this.webcamElement.srcObject) {
        //     this.webcamElement.srcObject.getTracks().forEach(track => track.stop());
        //     console.log('Stopped webcam tracks.');
        // }

        // Pause mask video
        if (this.maskVideoElement) {
            this.maskVideoElement.pause();
        }

        this._updateGameState('stopped');
        console.log('DinosaurGame stopped.');
    }

    // Internal game loop method
    async _gameLoop() {
        // Ensure the game is still supposed to be running
        if (this.gameState !== 'running') {
            console.log('Game loop called but state is not running. Exiting loop.');
            return;
        }

        try {
            // Log dimensions right before estimation
            console.log(`_gameLoop: Checking dimensions before pose estimation - Width: ${this.webcamElement?.videoWidth}, Height: ${this.webcamElement?.videoHeight}, ReadyState: ${this.webcamElement?.readyState}`);
            
            // Draw webcam frame to hidden canvas for pose input
            if (utils.checkVideoDimensions(this.webcamElement)) {
                this.poseInputCtx.drawImage(this.webcamElement, 0, 0, this.poseInputCanvas.width, this.poseInputCanvas.height);
            } else {
                // If dimensions still bad here, skip estimation
                console.warn('_gameLoop: Webcam dimensions invalid just before drawing to poseInputCanvas. Skipping frame.');
                this.animationFrameId = requestAnimationFrame(this._boundGameLoop); // Continue loop
                return;
            }
            
            // 1. Estimate Pose (passing the canvas, not the video element)
            const poses = await posenetHandler.estimatePose(this.poseInputCanvas, this.posenetModel, this.config.posenetEstimationConfig);
            const pose = poses && poses.length > 0 ? poses[0] : null; // Assuming single pose detection for now

            // 2. Get current mask frame data *at processing resolution*
            this.maskImageData = utils.getVideoFrameImageData(this.maskVideoElement, this.processingCanvas.width, this.processingCanvas.height);

            // 3. Draw Body / Overlap onto the low-res processing canvas
            let score = 0;
            if (pose && this.maskImageData) {
                 // Draw the colored silhouette to the processing canvas
                 drawing.drawBodyWithOverlap(this.processingCtx, pose, this.maskImageData, this.config.drawingConfig);

                 // --- Scoring Step (can now potentially use processingCtx directly) ---
                 // Get silhouette data from the processing canvas for scoring
                 const silhouetteImageData = this.processingCtx.getImageData(0, 0, this.processingCanvas.width, this.processingCanvas.height);
                 score = scoring.calculateOverlapScore(silhouetteImageData, this.maskImageData, this.config.scoringConfig);
            
            } else {
                 // If no pose or mask data, clear the processing canvas and score is 0
                 this.processingCtx.clearRect(0, 0, this.processingCanvas.width, this.processingCanvas.height);
                 score = 0;
            }

            // 4. Clear the final output canvas
            this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);

            // 4b. Draw the mask video onto the final output canvas (background layer)
            // Define mask drawing variables within this block's scope
            if (utils.checkVideoDimensions(this.maskVideoElement)) {
                const mask_displayWidth = this.outputCanvas.width;
                const mask_displayHeight = this.outputCanvas.height;
                const maskWidth = this.maskVideoElement.videoWidth;
                const maskHeight = this.maskVideoElement.videoHeight;
                
                const mask_displayAspect = mask_displayWidth / mask_displayHeight;
                const maskAspect = maskWidth / maskHeight;
                
                let mask_drawWidth = mask_displayWidth;
                let mask_drawHeight = mask_displayHeight;
                let mask_drawX = 0;
                let mask_drawY = 0;

                if (maskAspect > mask_displayAspect) {
                    mask_drawHeight = mask_displayWidth / maskAspect;
                    mask_drawY = (mask_displayHeight - mask_drawHeight) / 2;
                } else {
                    mask_drawWidth = mask_displayHeight * maskAspect;
                    mask_drawX = (mask_displayWidth - mask_drawWidth) / 2;
                }
                
                this.outputCtx.drawImage(
                    this.maskVideoElement,
                    0, 0, maskWidth, maskHeight, // Source rect
                    mask_drawX, mask_drawY, mask_drawWidth, mask_drawHeight // Destination rect
                );
            } else {
                console.warn("Cannot draw mask video background - video dimensions invalid.");
            }
            
            // 5. Draw the (low-res) processed canvas onto the (high-res) output canvas, scaling it up *while preserving aspect ratio*
            // Define variables for this specific drawing step
            const outputWidth = this.outputCanvas.width;
            const outputHeight = this.outputCanvas.height;
            const procWidth = this.processingCanvas.width;
            const procHeight = this.processingCanvas.height;

            // Ensure processing dimensions are valid before calculating aspect ratios
            if (procWidth > 0 && procHeight > 0) {
                const outputAspect = outputWidth / outputHeight;
                const procAspect = procWidth / procHeight;
                
                let destWidth = outputWidth;
                let destHeight = outputHeight;
                let destX = 0;
                let destY = 0;

                if (procAspect > outputAspect) {
                    destHeight = outputWidth / procAspect;
                    destY = (outputHeight - destHeight) / 2;
                } else {
                    destWidth = outputHeight * procAspect;
                    destX = (outputWidth - destWidth) / 2;
                }

                this.outputCtx.imageSmoothingEnabled = true;
                this.outputCtx.imageSmoothingQuality = 'high'; 

                this.outputCtx.drawImage(
                    this.processingCanvas, 
                    0, 0, procWidth, procHeight, // Source rect
                    destX, destY, destWidth, destHeight // Destination rect
                );
            } else {
                console.warn(`Cannot draw processing canvas - invalid dimensions ${procWidth}x${procHeight}`);
            }

            // 6. Optional: Draw skeleton overlay *on the output canvas*, scaling the pose points
            if (pose && this.config.drawingConfig.drawSkeletonOverlay) {
                // Pass processing dimensions directly (which are procWidth, procHeight)
                drawing.drawSkeleton(
                    this.outputCtx, 
                    pose, 
                    this.config.drawingConfig.skeletonConfig, 
                    procWidth, 
                    procHeight
                );
            }

            // 7. Update Score and call callback
            this.currentScore = score;
            if (this.config.scoreUpdateCallback) {
                 try {
                    this.config.scoreUpdateCallback(this.currentScore);
                 } catch (callbackError) {
                     console.error('Error in scoreUpdateCallback:', callbackError);
                 }
            }

            // 8. Loop
            this.animationFrameId = requestAnimationFrame(this._boundGameLoop);

        } catch (error) {
            console.error('Error in game loop:', error);
            this._updateGameState('error', error);
            // Stop the game on loop error
            this.stop();
        }
    }

    // Method to update configuration dynamically
    setConfig(newConfig) {
        console.log('DinosaurGame updating config:', newConfig);
        const oldConfig = { ...this.config }; // Keep old config for comparison

        // Merge new config (simple merge, consider deep merge for production)
         this.config = {
            ...this.config,
            ...newConfig,
            // Ensure nested objects are merged correctly if provided
            posenetModelConfig: { ...this.config.posenetModelConfig, ...(newConfig.posenetModelConfig || {}) },
            posenetEstimationConfig: { ...this.config.posenetEstimationConfig, ...(newConfig.posenetEstimationConfig || {}) },
            webcamConfig: { ...this.config.webcamConfig, ...(newConfig.webcamConfig || {}) },
            drawingConfig: {
                ...this.config.drawingConfig,
                ...(newConfig.drawingConfig || {}),
                silhouetteConfig: { ...this.config.drawingConfig.silhouetteConfig, ...(newConfig.drawingConfig?.silhouetteConfig || {}) },
                skeletonConfig: { ...this.config.drawingConfig.skeletonConfig, ...(newConfig.drawingConfig?.skeletonConfig || {}) },
            },
            scoringConfig: { ...this.config.scoringConfig, ...(newConfig.scoringConfig || {}) },
        };

        console.log('DinosaurGame config updated.');

        // Handle specific config changes that require action
        // Example: Changing the mask video source
        if (newConfig.maskVideoSrc && newConfig.maskVideoSrc !== oldConfig.maskVideoSrc) {
            console.log(`Mask video source changed to: ${newConfig.maskVideoSrc}`);
            // Stop the game if running
            const wasRunning = this.gameState === 'running';
            if (wasRunning) {
                this.stop();
            }

            // Update state to indicate reloading is needed
            this._updateGameState('initializing', 'Reloading mask video...');

            // Load the new video
            utils.loadVideo(this.maskVideoElement, this.config.maskVideoSrc)
                .then(() => {
                     console.log('New mask video loaded.');
                     // Set state back to ready (or stopped if it wasn't running)
                     this._updateGameState(wasRunning ? 'ready' : 'stopped');
                     // Optionally auto-restart if it was running before
                     // if (wasRunning) this.start();
                     // For now, require manual restart after changing video
                     if(this.maskVideoElement.paused) { // Ensure it plays if stopped
                        this.maskVideoElement.play().catch(e => console.error("Error playing new mask video:", e));
                     }
                })
                .catch(error => {
                    console.error('Failed to load new mask video:', error);
                    this._updateGameState('error', `Failed to load mask video: ${error.message}`);
                    // Restore old video src? Or leave in error state?
                    // this.config.maskVideoSrc = oldConfig.maskVideoSrc;
                });
        }

        // Add handlers for other dynamic config changes if needed (e.g., webcam resolution)
        if (newConfig.webcamConfig && JSON.stringify(newConfig.webcamConfig) !== JSON.stringify(oldConfig.webcamConfig)){
             console.warn('Dynamically changing webcam config requires stopping and re-running setup(). Not implemented automatically.');
             // Could implement this by calling stop(), then setup(), then optionally start()
        }

        // Add similar checks for posenet config changes if they need model reloading
    }
} // End of DinosaurGame class
