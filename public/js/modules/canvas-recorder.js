import { logToConsole } from './logger.js';

let mainMediaRecorder;
let mainRecordedChunks = [];
let isMainCanvasRecording = false;
let appConfig = {}; // Store fetched config

// Function to fetch app configuration
async function fetchAppConfig() {
    try {
        const response = await fetch('/api/app-config');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        appConfig = await response.json();
        logToConsole('App configuration loaded for canvas recorder.', 'info', appConfig);
    } catch (e) {
        logToConsole(`Failed to fetch app configuration: ${e.message}`, 'error', e);
        // Default values if config fails to load, matching the user's request
        appConfig = {
            videoFormat: 'mp4',
            videoBackground: [255, 0, 255, 255] // Magenta, full opacity
        };
        logToConsole('Using default videoFormat and videoBackground for canvas recorder.', 'warn', appConfig);
    }
}

// mainOutputCanvasElement and mainRecordingCompositor will need to be passed or accessed.
export async function initializeCanvasRecorder(mainOutputCanvasElement, mainRecordingCompositor) {
    await fetchAppConfig(); // Load config first

    const recordCanvasBtn = document.getElementById('recordCanvasBtn');

    if (recordCanvasBtn) {
        recordCanvasBtn.addEventListener('click', async () => {
            if (!mainOutputCanvasElement) {
                logToConsole('Error: Main output canvas for recording not found!', 'error'); return;
            }
            // Ensure mainRecordingCompositor is passed and used if the check is still relevant
            if (!mainRecordingCompositor || !mainRecordingCompositor.currentFrameSource) {
                alert('Please select a camera source for recording from the dropdown.'); return;
            }

            if (!isMainCanvasRecording) {
                logToConsole('Starting main canvas recording (main-output-canvas)...', 'info');
                const stream = mainOutputCanvasElement.captureStream(30); // FPS

                const videoFormat = appConfig.videoFormat || 'mp4'; // Default to mp4
                let mimeTypes = [];
                if (videoFormat === 'mp4') {
                    mimeTypes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
                } else { // webm or any other case
                    mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
                }

                let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

                if (!selectedMimeType) {
                    alert('Error: Browser does not support common video recording formats for canvas.');
                    logToConsole('No supported MIME type found for MediaRecorder.', 'error');
                    return;
                }
                try {
                    mainMediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
                } catch (e) {
                    alert(`Error starting recorder: ${e.message}`);
                    logToConsole(`MediaRecorder instantiation error: ${e.message}`, 'error', e);
                    return;
                }

                mainRecordedChunks = [];
                mainMediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        mainRecordedChunks.push(event.data);
                    }
                };

                mainMediaRecorder.onstop = () => {
                    const blob = new Blob(mainRecordedChunks, { type: selectedMimeType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // Use configured format for extension, fallback to parsed mime if somehow different
                    const fileExtension = videoFormat === 'mp4' ? 'mp4' : 'webm';
                    a.download = `main_output_${new Date().toISOString().replace(/[:.]/g, '-')}.${fileExtension}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    logToConsole('Main canvas recording stopped. File downloaded.', 'success');
                    recordCanvasBtn.textContent = 'Record Output Canvas';
                    recordCanvasBtn.classList.remove('btn-danger');
                    recordCanvasBtn.classList.add('btn-success');
                    isMainCanvasRecording = false;
                };

                // Apply background color based on config
                const videoFormatFromConfig = appConfig.videoFormat || 'mp4';
                const videoBackground = appConfig.videoBackground; // Should be an array [R, G, B, A]

                if (mainOutputCanvasElement && videoBackground && videoBackground.length === 4) {
                    const [r, g, b, aGui] = videoBackground; // a is 0-255 from config
                    const aNormalized = aGui / 255; // alpha for canvas is 0-1

                    // Apply background if MP4, or if WEBM with non-transparent background
                    if (videoFormatFromConfig === 'mp4' || (videoFormatFromConfig === 'webm' && aNormalized > 0)) {
                        logToConsole(`Applying background color to canvas: rgba(${r},${g},${b},${aNormalized})`, 'info');
                        const ctx = mainOutputCanvasElement.getContext('2d');
                        if (ctx) {
                            // Save current state if needed for complex drawing, for simple background fill it's okay
                            // ctx.save(); 
                            ctx.fillStyle = `rgba(${r},${g},${b},${aNormalized})`;
                            // Ensure background is drawn under existing content if any (though usually canvas is cleared each frame)
                            // For a single application before recording, this sets the base layer.
                            // If the canvas is actively being drawn to, this background needs to be part of that drawing loop.
                            ctx.globalCompositeOperation = 'destination-over';
                            ctx.fillRect(0, 0, mainOutputCanvasElement.width, mainOutputCanvasElement.height);
                            ctx.globalCompositeOperation = 'source-over'; // Reset to default
                            // ctx.restore();
                            logToConsole('Background color applied. Note: If canvas is redrawn per frame, this background must be integrated into the drawing loop.', 'warn');
                        } else {
                            logToConsole('Could not get 2D context from mainOutputCanvasElement to apply background.', 'error');
                        }
                    } else if (videoFormatFromConfig === 'webm' && aNormalized === 0) {
                        logToConsole('WebM format with transparent background selected. Canvas will be recorded as is (transparent).', 'info');
                        // Forcing transparent background if not already: clearRect, but usually canvas is transparent by default or cleared by app
                        // const ctx = mainOutputCanvasElement.getContext('2d');
                        // if (ctx) ctx.clearRect(0, 0, mainOutputCanvasElement.width, mainOutputCanvasElement.height);
                    }
                } else if (videoBackground && videoBackground.length !== 4) {
                    logToConsole('videoBackground in config is not a valid RGBA array. Skipping background color application.', 'warn');
                }

                mainMediaRecorder.start();
                recordCanvasBtn.textContent = 'Stop Recording Output';
                recordCanvasBtn.classList.remove('btn-success');
                recordCanvasBtn.classList.add('btn-danger');
                isMainCanvasRecording = true;
            } else {
                if (mainMediaRecorder) {
                    mainMediaRecorder.stop();
                }
            }
        });
    } else {
        logToConsole('recordCanvasBtn not found. Canvas recorder not initialized.', 'warn');
    }
} 