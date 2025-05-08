// Depends on cameraManager and mainRecordingCompositor being available in the scope where it's initialized.
// These will be passed during initialization.

let localCameraManager;
let localMainRecordingCompositor;

function populateSelector(selectorElement, type) {
    if (!selectorElement || !localCameraManager || !localCameraManager.cameras) return;

    const currentVal = selectorElement.value;
    selectorElement.innerHTML = `<option value="">Select Camera for ${type}</option>`;
    localCameraManager.cameras.forEach(camera => {
        const option = document.createElement('option');
        option.value = camera.name;
        option.textContent = camera.name.replace(/_/g, ' ');
        selectorElement.appendChild(option);
    });
    if (localCameraManager.cameras.some(cam => cam.name === currentVal)) {
        selectorElement.value = currentVal;
    } else {
        if (type === 'Recording' && localMainRecordingCompositor) {
            localMainRecordingCompositor.removeFrameSource();
        }
    }
}

export function populateAllSourceSelectors() {
    const recordingSourceSelector = document.getElementById('recording-source-selector');
    populateSelector(recordingSourceSelector, 'Recording');
}

export function initializeSourceSelector(cameraManager, mainRecordingCompositor) {
    localCameraManager = cameraManager;
    localMainRecordingCompositor = mainRecordingCompositor;

    const recordingSourceSelector = document.getElementById('recording-source-selector');

    if (recordingSourceSelector) {
        recordingSourceSelector.addEventListener('change', () => {
            const selectedCameraName = recordingSourceSelector.value;
            if (localMainRecordingCompositor && localCameraManager) {
                // Clear any active dinosaur mask on the main compositor before changing its source
                if (localMainRecordingCompositor.isDinosaurMaskActive()) {
                    localMainRecordingCompositor.clearVideoMask();
                    // Note: This will also trigger the UI update for the button if the event dispatch is added
                }

                const processedCanvas = selectedCameraName ? localCameraManager.getProcessedCanvas(selectedCameraName) : null;
                if (processedCanvas) {
                    localMainRecordingCompositor.setCurrentFrameSource(processedCanvas);
                } else {
                    localMainRecordingCompositor.removeFrameSource();
                }
            }
        });
    }
    // Initial population is handled by CameraManager.initialize().then() in home.js
    // and the 'cameramanagerupdate' event listener.
} 