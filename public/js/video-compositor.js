class VideoCompositor {
    constructor(canvasId) {
        this.canvas = document.querySelector(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.currentSource = null;
        this.isDrawing = false;
        this.detector = null;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.lastFpsUpdate = 0;
        this.fpsUpdateInterval = 1000; // Update FPS every second
    }

    async _initializeTfjsAndDetector() {
        try {
            // Check if TensorFlow.js is already initialized
            if (!tf.ready) {
                throw new Error('TensorFlow.js not found');
            }

            // Get current backend
            const currentBackend = tf.getBackend();
            console.log('Current TensorFlow.js backend:', currentBackend);

            // If we're already using WebGL, don't try to switch
            if (currentBackend === 'webgl') {
                console.log('Already using WebGL backend');
                return;
            }

            // Try to set WebGL backend
            try {
                await tf.setBackend('webgl');
                await tf.ready();
                console.log('Successfully set WebGL backend');
            } catch (error) {
                console.error('Error setting WebGL backend:', error);
                throw error;
            }

            // Verify we're using WebGL
            const backend = tf.getBackend();
            if (backend !== 'webgl') {
                throw new Error(`Failed to set WebGL backend, got ${backend} instead`);
            }

            // Initialize pose detector
            try {
                this.poseDetector = await poseDetection.createDetector(
                    poseDetection.SupportedModels.MoveNet,
                    {
                        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
                        enableSmoothing: true
                    }
                );
                console.log('MoveNet pose detector loaded successfully.');
            } catch (error) {
                console.error('Error loading pose detector:', error);
                throw error;
            }
        } catch (error) {
            console.error('Error initializing TensorFlow.js:', error);
            throw error;
        }
    }

    async initialize() {
        try {
            await this._initializeTfjsAndDetector();
        } catch (error) {
            console.error('Error initializing pose detector:', error);
            throw error;
        }
    }

    setFrameSource(source) {
        if (this.currentSource === source) return;

        this.currentSource = source;
        if (source instanceof HTMLVideoElement) {
            this.canvas.width = source.videoWidth;
            this.canvas.height = source.videoHeight;
        } else if (source instanceof HTMLCanvasElement) {
            this.canvas.width = source.width;
            this.canvas.height = source.height;
        }

        if (!this.isDrawing) {
            this.startDrawing();
        }
    }

    async startDrawing() {
        if (this.isDrawing) return;
        this.isDrawing = true;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.lastFpsUpdate = this.lastFrameTime;

        const drawFrame = async () => {
            if (!this.isDrawing) return;

            const now = performance.now();
            this.frameCount++;

            if (now - this.lastFpsUpdate >= this.fpsUpdateInterval) {
                this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
                this.frameCount = 0;
                this.lastFpsUpdate = now;
            }

            if (this.currentSource) {
                this.ctx.drawImage(this.currentSource, 0, 0, this.canvas.width, this.canvas.height);

                if (this.poseDetector) {
                    const poses = await this.poseDetector.estimatePoses(this.canvas);
                    this.drawPoses(poses);
                }
            }

            requestAnimationFrame(drawFrame);
        };

        requestAnimationFrame(drawFrame);
    }

    stopDrawing() {
        this.isDrawing = false;
    }

    drawPoses(poses) {
        for (const pose of poses) {
            for (const keypoint of pose.keypoints) {
                if (keypoint.score > 0.3) {
                    this.ctx.beginPath();
                    this.ctx.arc(keypoint.x, keypoint.y, 5, 0, 2 * Math.PI);
                    this.ctx.fillStyle = 'red';
                    this.ctx.fill();
                }
            }

            for (const connection of pose.keypointsConnections) {
                const [start, end] = connection;
                const startPoint = pose.keypoints[start];
                const endPoint = pose.keypoints[end];

                if (startPoint.score > 0.3 && endPoint.score > 0.3) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(startPoint.x, startPoint.y);
                    this.ctx.lineTo(endPoint.x, endPoint.y);
                    this.ctx.strokeStyle = 'red';
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
            }
        }
    }
} 