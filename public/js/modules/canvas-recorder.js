import { logToConsole } from './logger.js';

let mainMediaRecorder;
let mainRecordedChunks = [];
let isMainCanvasRecording = false;

// mainOutputCanvasElement and mainRecordingCompositor will need to be passed or accessed.
export function initializeCanvasRecorder(mainOutputCanvasElement, mainRecordingCompositor) {
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
                const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
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
                    a.download = `main_output_${new Date().toISOString().replace(/[:.]/g, '-')}.${selectedMimeType.split('/')[1].split(';')[0]}`;
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