import { logToConsole } from './logger.js';

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

        logToConsole(`VideoCompositor initialized for canvas '#${canvasId}'.`, 'info');
    }

    // Sets the main video source to be drawn
    setPrimaryVideoSource(videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            logToConsole('VideoCompositor: Invalid video element provided.', 'error');
            return;
        }
        logToConsole(`VideoCompositor: Setting primary video source (${videoElement.id || 'no id'}).`, 'info');
        this.primaryVideoSource = videoElement;

        // Ensure canvas is initially sized correctly if video is ready
        if (this.primaryVideoSource.readyState >= 2) { // HAVE_CURRENT_DATA or higher
            this._sizeCanvasToVideo();
        }

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

    _drawFrame() {
        if (!this.isDrawing) return;

        // Ensure the next frame is requested even if we return early
        this.animationFrameId = requestAnimationFrame(() => this._drawFrame());

        if (!this.primaryVideoSource) return;

        // Check if video is ready to draw
        if (this.primaryVideoSource.paused || this.primaryVideoSource.ended || this.primaryVideoSource.readyState < 2) {
            return; // Skip drawing if video not ready
        }

        // Ensure canvas size matches video
        this._sizeCanvasToVideo();

        // Clear canvas (important for compositing multiple layers later)
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw the primary video source
        this.ctx.drawImage(this.primaryVideoSource, 0, 0, this.canvas.width, this.canvas.height);

        // --- TODO: Draw other layers (overlays, effects) here --- 

    }

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