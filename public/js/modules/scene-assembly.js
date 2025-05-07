import { logToConsole } from './logger.js';

let currentSceneData = null; // Module-level variable to store current scene data for assembly

export function updateAssemblyUI(sceneData, sceneDisplayName) {
    const assemblySection = document.getElementById('scene-assembly-section');
    const sceneNameSpan = document.getElementById('assembly-scene-name');
    const takeSelectionArea = document.getElementById('take-selection-area');
    const assembleButton = document.getElementById('assemble-scene-button');

    if (!assemblySection || !sceneNameSpan || !takeSelectionArea || !assembleButton) {
        logToConsole("Assembly UI elements not found for scene assembly module", "error");
        return;
    }

    // Reset UI elements
    takeSelectionArea.innerHTML = '<p><em>Loading assembly info...</em></p>';
    assembleButton.disabled = true;
    assemblySection.style.display = 'none';
    sceneNameSpan.textContent = '';
    currentSceneData = sceneData; // Store the passed sceneData

    if (sceneData && sceneData.assembly && Array.isArray(sceneData.assembly) && sceneData.assembly.length > 0) {
        logToConsole(`Found assembly data for scene: ${sceneDisplayName}`, 'info');
        sceneNameSpan.textContent = sceneDisplayName;
        takeSelectionArea.innerHTML = ''; // Clear loading message

        sceneData.assembly.forEach((segment, index) => {
            const segmentDiv = document.createElement('div');
            segmentDiv.className = 'assembly-segment mb-2 p-2 border rounded';
            segmentDiv.dataset.index = index;

            const description = `Segment ${index + 1}: Shot "${segment.shot}", Cam "${segment.camera}", In Frame: ${segment.in}, Out Frame: ${segment.out}`;
            const label = document.createElement('label');
            label.textContent = `${description} - Take #:`;
            label.htmlFor = `take-input-${index}`;
            label.className = 'form-label me-2';

            const input = document.createElement('input');
            input.type = 'number';
            input.id = `take-input-${index}`;
            input.className = 'form-control form-control-sm d-inline-block take-input';
            input.style.width = '80px';
            input.min = '1';
            input.value = '1'; // Default to take 1
            input.required = true;
            // Store segment data on the input for easy access during assembly
            input.dataset.shot = segment.shot;
            input.dataset.camera = segment.camera;
            input.dataset.inFrame = segment.in;
            input.dataset.outFrame = segment.out;

            segmentDiv.appendChild(label);
            segmentDiv.appendChild(input);
            takeSelectionArea.appendChild(segmentDiv);
        });

        assembleButton.disabled = false;
        assemblySection.style.display = 'block';
    } else {
        logToConsole(`No assembly data found or scene not loaded for: ${sceneDisplayName || 'selected scene'}`, 'warn');
        takeSelectionArea.innerHTML = '<p><em>No assembly definition found for this scene.</em></p>';
        assemblySection.style.display = 'block'; // Show the section to display the message
        assembleButton.disabled = true;
    }
}

export function initializeSceneAssembly() {
    const assembleBtn = document.getElementById('assemble-scene-button');
    if (assembleBtn) {
        assembleBtn.addEventListener('click', async () => {
            if (!currentSceneData || !currentSceneData.directory || !currentSceneData.assembly) {
                logToConsole('Cannot assemble: No valid scene data or assembly loaded.', 'error');
                alert('Error: Scene data is missing or invalid. Please select a scene with assembly info.');
                return;
            }

            const takeInputs = document.querySelectorAll('#take-selection-area .take-input');
            const assemblyTakes = [];
            let isValid = true;

            takeInputs.forEach(input => {
                const takeNumber = parseInt(input.value, 10);
                if (isNaN(takeNumber) || takeNumber < 1) {
                    isValid = false;
                    input.classList.add('is-invalid'); // Bootstrap class for invalid input
                } else {
                    input.classList.remove('is-invalid');
                    assemblyTakes.push({
                        shot: input.dataset.shot,
                        camera: input.dataset.camera,
                        inFrame: parseInt(input.dataset.inFrame, 10),
                        outFrame: parseInt(input.dataset.outFrame, 10),
                        take: takeNumber
                    });
                }
            });

            if (!isValid) {
                logToConsole('Assembly cancelled: Invalid take number entered.', 'warn');
                alert('Please enter a valid take number (>= 1) for all segments.');
                return;
            }

            const assemblyPayload = {
                sceneDirectory: currentSceneData.directory,
                takes: assemblyTakes
            };

            logToConsole('Initiating scene assembly with payload:', 'info', assemblyPayload);
            assembleBtn.disabled = true;
            assembleBtn.textContent = 'Assembling...';

            try {
                const response = await fetch('/api/assemble-scene', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(assemblyPayload)
                });
                if (!response.ok) {
                    let errorMsg = `Assembly request failed with status: ${response.status}`;
                    try {
                        const errorResult = await response.json();
                        errorMsg = errorResult.message || errorMsg;
                    } catch (e) { /* Ignore if response body is not JSON */ }
                    throw new Error(errorMsg);
                }
                const result = await response.json();
                logToConsole('Assembly request successful:', 'success', result);
                alert(result.message || 'Scene assembly process initiated successfully!');
            } catch (error) {
                logToConsole(`Error during scene assembly request: ${error.message}`, 'error', error); // Log full error object
                alert(`Error starting assembly: ${error.message}`);
            } finally {
                assembleBtn.disabled = false;
                assembleBtn.textContent = 'Assemble Scene';
            }
        });
    } else {
        logToConsole('assemble-scene-button not found. Scene assembly listener not attached.', 'warn');
    }
} 