import { logToConsole } from './logger.js';

export class CanvasRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            logToConsole(`Canvas element with ID '${canvasId}' not found.`, 'error');
            throw new Error(`Canvas element with ID '${canvasId}' not found.`);
        }

        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            logToConsole(`Failed to get 2D context for canvas '${canvasId}'.`, 'error');
            throw new Error(`Failed to get 2D context for canvas '${canvasId}'.`);
        }

        this.videoSource = null; // The <video> element to draw
        this.animationFrameId = null;
        this.isDrawing = false;

        logToConsole(`CanvasRenderer initialized for canvas '#${canvasId}'.`, 'info');
    }

    addVideoSource(videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            logToConsole('Invalid video element provided to addVideoSource.', 'error');
            return;
        }
        logToConsole(`Adding video source (${videoElement.id || 'no id'}) to CanvasRenderer.`, 'info');
        this.videoSource = videoElement;

        // Ensure canvas is initially sized correctly if video is ready
        if (this.videoSource.readyState >= 2) { // HAVE_CURRENT_DATA or higher
            this._sizeCanvasToVideo();
        }

        if (!this.isDrawing) {
            this.startDrawingLoop();
        }
    }

    _sizeCanvasToVideo() {
        if (!this.videoSource) return;

        const videoWidth = this.videoSource.videoWidth;
        const videoHeight = this.videoSource.videoHeight;

        if (videoWidth > 0 && videoHeight > 0) {
            if (this.canvas.width !== videoWidth || this.canvas.height !== videoHeight) {
                this.canvas.width = videoWidth;
                this.canvas.height = videoHeight;
                logToConsole(`CanvasRenderer resized canvas to ${videoWidth}x${videoHeight}`, 'debug');
            }
        } else {
            // Don't resize if video dimensions are zero
            logToConsole(`Video source has zero dimensions (${videoWidth}x${videoHeight}), canvas not resized.`, 'warn');
        }
    }

    _drawFrame() {
        // Check if still drawing and source exists
        if (!this.isDrawing || !this.videoSource) {
            return;
        }

        // Check if video is ready to draw
        if (this.videoSource.paused || this.videoSource.ended || this.videoSource.readyState < 2) {
            // Video not ready, maybe clear canvas or show placeholder?
            // For now, just skip drawing and request next frame
            this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
            return;
        }

        // Ensure canvas size matches video (handles dynamic changes)
        this._sizeCanvasToVideo();

        // Draw the video frame to the canvas
        this.ctx.drawImage(this.videoSource, 0, 0, this.canvas.width, this.canvas.height);

        // Request the next frame
        this.animationFrameId = requestAnimationFrame(() => this._drawFrame());
    }

    startDrawingLoop() {
        if (this.isDrawing) {
            logToConsole('Drawing loop already running.', 'info');
            return;
        }
        if (!this.videoSource) {
            logToConsole('Cannot start drawing loop: No video source set.', 'warn');
            return;
        }

        logToConsole('Starting canvas drawing loop.', 'info');
        this.isDrawing = true;
        this._drawFrame(); // Start the loop
    }

    stopDrawingLoop() {
        if (!this.isDrawing) {
            logToConsole('Drawing loop is not running.', 'info');
            return;
        }

        logToConsole('Stopping canvas drawing loop.', 'info');
        this.isDrawing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Optionally clear the canvas when stopped
        // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    removeVideoSource() {
        logToConsole('Removing video source from CanvasRenderer.', 'info');
        this.stopDrawingLoop();
        this.videoSource = null;
        // Optionally clear the canvas
        if (this.canvas.width > 0 && this.canvas.height > 0) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
} 