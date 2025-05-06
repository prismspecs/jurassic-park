import { logToConsole } from './modules/logger.js';
import { initializeResizers } from './modules/layout-resizer.js';
import { CameraManager } from './modules/camera-manager.js';
import {
  initializeSessionManagement,
  updateCurrentSessionDisplay,
  populateSessionList
} from './modules/session-manager.js';
import { initializeWebSocket, sendWebSocketMessage } from './modules/websocket-handler.js';
import {
  toggleVoiceBypass,
  openTeleprompter,
  openCharacterTeleprompter,
  testTeleprompter,
  testTeleprompterVideo,
  clearTeleprompter,
  initShot,
  actorsReady,
  action,
  testConsole,
  pauseAllTeleprompters,
  playAllTeleprompters,
  handlePipelineChange,
  handleResolutionChange
} from './modules/control-actions.js';
import { AudioManager } from './modules/audio-manager.js';
import { VideoCompositor } from './modules/video-compositor.js';

// --- Globals ---
let currentSceneData = null;
let cameraManager;
let mainRecordingCompositor;
let teleprompterOutputCompositor;
let teleprompterStreamActive = false;
let currentTeleprompterSourceCanvas = null;
let voiceBypassEnabled = true; // Moved to global for access by control-actions if needed


document.addEventListener('DOMContentLoaded', () => {
  logToConsole("DOM loaded. Initializing components...", "info");

  // --- Compositor Initializations ---
  const mainOutputCanvasElement = document.getElementById('main-output-canvas');
  if (mainOutputCanvasElement) {
    mainRecordingCompositor = new VideoCompositor('main-output-canvas');
    logToConsole('Main recording compositor initialized.', 'info');
  } else {
    logToConsole('main-output-canvas not found. Main recording compositor NOT initialized.', 'error');
  }

  const teleprompterDisplaySourceCanvasElement = document.getElementById('teleprompter-display-source-canvas');
  if (teleprompterDisplaySourceCanvasElement) {
    teleprompterOutputCompositor = new VideoCompositor('teleprompter-display-source-canvas');
    logToConsole('Teleprompter output compositor initialized.', 'info');
  } else {
    logToConsole('#teleprompter-display-source-canvas not found. Teleprompter output compositor NOT initialized.', 'warn');
  }

  // --- UI Update Functions (Local to DOMContentLoaded) ---
  function updateVoiceBypassButton() {
    const btn = document.getElementById("voiceBypassBtn");
    if (btn) {
      btn.textContent = voiceBypassEnabled ? "Disable Voice Bypass" : "Enable Voice Bypass";
      btn.style.backgroundColor = voiceBypassEnabled ? "#ff4444" : "#4CAF50";
    }
  }
  updateVoiceBypassButton(); // Initial state

  // --- Core Event Listeners for Buttons etc. ---
  // (Assuming control-actions.js handles the actual logic for these buttons)
  document.getElementById('voiceBypassBtn')?.addEventListener('click', async () => {
    voiceBypassEnabled = await toggleVoiceBypass(voiceBypassEnabled);
    updateVoiceBypassButton();
  });
  document.getElementById('openTeleprompterBtn')?.addEventListener('click', openTeleprompter);
  document.getElementById('openAlanTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('alan'));
  document.getElementById('openEllieTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('ellie'));
  document.getElementById('testTeleprompterBtn')?.addEventListener('click', testTeleprompter);
  document.getElementById('testTeleprompterVideoBtn')?.addEventListener('click', testTeleprompterVideo);
  document.getElementById('clearTeleprompterBtn')?.addEventListener('click', clearTeleprompter);
  document.getElementById('pauseTeleprompterBtn')?.addEventListener('click', pauseAllTeleprompters);
  document.getElementById('playTeleprompterBtn')?.addEventListener('click', playAllTeleprompters);
  document.getElementById('testConsoleBtn')?.addEventListener('click', testConsole);
  document.getElementById('actionBtn')?.addEventListener('click', action);
  document.getElementById('actorsReadyBtn')?.addEventListener('click', actorsReady);
  document.getElementById('recording-pipeline')?.addEventListener('change', (e) => handlePipelineChange(e.target.value));
  document.getElementById('recording-resolution')?.addEventListener('change', (e) => {
    handleResolutionChange(e.target.value);
    if (cameraManager) cameraManager.updateAllPreviewsResolution();
  });
  document.getElementById('addCameraBtn')?.addEventListener('click', () => cameraManager?.addCamera());
  document.getElementById('addAudioDeviceBtn')?.addEventListener('click', () => audioManager?.addDeviceCard());

  // Shot container listener (delegated)
  const shotContainer = document.querySelector('.shot-container');
  if (shotContainer) {
    shotContainer.addEventListener('click', async (event) => {
      const shotCard = event.target.closest('.shot-card');
      if (shotCard && shotCard.dataset.sceneDir && shotCard.dataset.shotId) {
        initShot(shotCard.dataset.sceneDir, shotCard.dataset.shotId);
        // ... (rest of scene detail fetching and assembly UI update as before) ...
      }
    });
  }
  // Actor Loading (assuming this references elements within a specific section)
  const loadActorsBtn = document.getElementById('loadActorsBtn');
  const actorFilesInput = document.getElementById('actorFiles');
  const loadActorsStatus = document.getElementById('loadActorsStatus');
  if (loadActorsBtn && actorFilesInput && loadActorsStatus) {
    loadActorsBtn.addEventListener('click', async () => { /* ... loadActors logic ... */ });
  }

  // --- Source Selector Logic ---
  const recordingSourceSelector = document.getElementById('recording-source-selector');
  const teleprompterSourceSelector = document.getElementById('teleprompter-source-selector');

  function populateSelector(selectorElement, type) {
    if (!selectorElement || !cameraManager || !cameraManager.cameras) return;
    const currentVal = selectorElement.value;
    selectorElement.innerHTML = `<option value="">Select Camera for ${type}</option>`;
    cameraManager.cameras.forEach(camera => {
      const option = document.createElement('option');
      option.value = camera.name;
      option.textContent = camera.name.replace(/_/g, ' ');
      selectorElement.appendChild(option);
    });
    if (cameraManager.cameras.some(cam => cam.name === currentVal)) {
      selectorElement.value = currentVal;
    } else {
      // If previous selection invalid, clear relevant compositor/source
      if (type === 'Recording' && mainRecordingCompositor) mainRecordingCompositor.removeFrameSource();
      if (type === 'Teleprompter') {
        if (teleprompterOutputCompositor) teleprompterOutputCompositor.removeFrameSource();
        currentTeleprompterSourceCanvas = null;
      }
    }
  }

  function populateAllSourceSelectors() {
    populateSelector(recordingSourceSelector, 'Recording');
    populateSelector(teleprompterSourceSelector, 'Teleprompter');
  }

  if (recordingSourceSelector) {
    recordingSourceSelector.addEventListener('change', () => {
      const selectedCameraName = recordingSourceSelector.value;
      if (mainRecordingCompositor && cameraManager) {
        const processedCanvas = selectedCameraName ? cameraManager.getProcessedCanvas(selectedCameraName) : null;
        if (processedCanvas) mainRecordingCompositor.setCurrentFrameSource(processedCanvas);
        else mainRecordingCompositor.removeFrameSource();
      }
    });
  }

  if (teleprompterSourceSelector) {
    teleprompterSourceSelector.addEventListener('change', () => {
      const selectedCameraName = teleprompterSourceSelector.value;
      currentTeleprompterSourceCanvas = null; // Reset
      if (teleprompterOutputCompositor) teleprompterOutputCompositor.removeFrameSource();

      if (cameraManager && selectedCameraName) {
        const processedCanvas = cameraManager.getProcessedCanvas(selectedCameraName);
        if (processedCanvas) {
          if (teleprompterOutputCompositor) {
            teleprompterOutputCompositor.setCurrentFrameSource(processedCanvas);
            currentTeleprompterSourceCanvas = teleprompterDisplaySourceCanvasElement;
          } else {
            currentTeleprompterSourceCanvas = processedCanvas;
          }
        }
      }
      if (teleprompterStreamActive) logToConsole('Teleprompter source changed while stream active. WebRTC stream needs update.', 'info');
    });
  }

  const sendToTeleprompterBtn = document.getElementById('sendToTeleprompterBtn');
  if (sendToTeleprompterBtn) {
    sendToTeleprompterBtn.addEventListener('click', () => {
      if (currentTeleprompterSourceCanvas) {
        if (!teleprompterStreamActive) alert('WebRTC streaming to teleprompter not yet implemented.');
        else alert('Stream already active. Change source via dropdown.');
      } else {
        alert('Please select a camera source for the teleprompter first.');
      }
    });
  }

  // --- Manager Initializations ---
  cameraManager = new CameraManager();
  cameraManager.initialize().then(() => {
    logToConsole('CameraManager initialized.', 'info');
    populateAllSourceSelectors();
    document.addEventListener('cameramanagerupdate', () => {
      logToConsole('cameramanagerupdate event received.', 'info');
      populateAllSourceSelectors();
    });
  }).catch(error => logToConsole(`CameraManager initialization failed: ${error}`, 'error'));

  const audioManager = new AudioManager();
  audioManager.initialize().catch(err => logToConsole(`AudioManager initialization failed: ${err}`, 'error'));

  // --- Main Canvas Recording Logic (for 'main-output-canvas') ---
  const recordCanvasBtn = document.getElementById('recordCanvasBtn');
  let mainMediaRecorder;
  let mainRecordedChunks = [];
  let isMainCanvasRecording = false;

  if (recordCanvasBtn) {
    recordCanvasBtn.addEventListener('click', async () => {
      if (!mainOutputCanvasElement) {
        logToConsole('Error: Main output canvas for recording not found!', 'error'); return;
      }
      if (!mainRecordingCompositor || !mainRecordingCompositor.currentFrameSource) {
        alert('Please select a camera source for recording from the dropdown.'); return;
      }

      if (!isMainCanvasRecording) {
        logToConsole('Starting main canvas recording (main-output-canvas)...', 'info');
        const stream = mainOutputCanvasElement.captureStream(30);
        const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
        if (!selectedMimeType) {
          alert('Error: Browser does not support common video recording formats for canvas.'); return;
        }
        try {
          mainMediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
        } catch (e) {
          alert(`Error starting recorder: ${e.message}`); return;
        }
        mainRecordedChunks = [];
        mainMediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) mainRecordedChunks.push(event.data); };
        mainMediaRecorder.onstop = () => {
          const blob = new Blob(mainRecordedChunks, { type: selectedMimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `main_output_${new Date().toISOString().replace(/[:.]/g, '-')}.${selectedMimeType.split('/')[1].split(';')[0]}`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
          logToConsole('Main canvas recording stopped. File downloaded.', 'success');
          recordCanvasBtn.textContent = 'Record Output Canvas';
          recordCanvasBtn.classList.remove('btn-danger'); recordCanvasBtn.classList.add('btn-success');
          isMainCanvasRecording = false;
        };
        mainMediaRecorder.start();
        recordCanvasBtn.textContent = 'Stop Recording Output';
        recordCanvasBtn.classList.remove('btn-success'); recordCanvasBtn.classList.add('btn-danger');
        isMainCanvasRecording = true;
      } else {
        if (mainMediaRecorder) mainMediaRecorder.stop();
      }
    });
  }

  // --- WebSocket Initialization ---
  const handleWebSocketOpen = () => {
    fetch("/getVoiceBypass") // Example: fetch initial state if needed
      .then((res) => res.json())
      .then((data) => { voiceBypassEnabled = data.enabled; updateVoiceBypassButton(); })
      .catch((err) => console.error("Error fetching voice bypass state:", err));
  };
  const wsUrl = `ws://${window.location.host}`;
  initializeWebSocket(wsUrl, cameraManager /* or null if not directly needed by handler */, handleWebSocketOpen);

  // --- Other UI Initializations ---
  initializeResizers();
  initializeSessionManagement();
  initializeCollapsibleSections();
  initializeFullscreenToggles();
  initializeSecretPanel();

  logToConsole("Jurassic Park AI Director UI Initialized (Corrected Structure)", "success");
}); // End DOMContentLoaded

// --- Initialize Collapsible Sections ---
function initializeCollapsibleSections() {
  document.querySelectorAll('.collapsible-header').forEach(header => {
    const section = header.closest('.collapsible-section');
    const content = section.querySelector('.collapsible-content');

    // Determine initial state (assume expanded unless 'start-collapsed' class is present)
    const startCollapsed = section.classList.contains('start-collapsed');
    if (!startCollapsed) {
      header.classList.add('expanded'); // Add 'expanded' class if not starting collapsed
      if (content) content.style.display = ''; // Ensure content is shown
    } else {
      if (content) content.style.display = 'none'; // Ensure content is hidden
    }

    header.addEventListener('click', () => {
      // Toggle 'expanded' class directly on the header
      const isExpanding = !header.classList.contains('expanded');
      header.classList.toggle('expanded', isExpanding);

      if (content) {
        content.style.display = isExpanding ? '' : 'none'; // Toggle content display
      }
    });
  });
}

// --- Initialize Fullscreen Toggles ---
function initializeFullscreenToggles() {
  document.querySelectorAll('.fullscreen-toggle-btn').forEach(button => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      const targetPanel = document.getElementById(targetId);
      const pageLayout = targetPanel.closest('.page-layout');

      if (!targetPanel || !pageLayout) return;

      const isCurrentlyFullscreen = targetPanel.classList.contains('fullscreen');

      // Get all direct children of page-layout (panels and resizers)
      const children = Array.from(pageLayout.children);

      if (isCurrentlyFullscreen) {
        // Exit fullscreen
        targetPanel.classList.remove('fullscreen');
        children.forEach(child => {
          if (child !== targetPanel) {
            child.classList.remove('panel-hidden');
          }
        });
      } else {
        // Enter fullscreen
        targetPanel.classList.add('fullscreen');
        children.forEach(child => {
          if (child !== targetPanel) {
            child.classList.add('panel-hidden');
          }
        });
      }
    });
  });
}

// --- Initialize Secret Panel ---
function initializeSecretPanel() {
  const toggleBtn = document.getElementById('secret-panel-toggle-btn');
  const secretPanel = document.getElementById('secret-panel');
  const toggleHeadersCheckbox = document.getElementById('hideHeadersToggle');
  const body = document.body;
  const invertColorsBtn = document.getElementById('invertColorsBtn');

  if (!toggleBtn || !secretPanel || !toggleHeadersCheckbox) {
    logToConsole('Secret panel elements not found. Cannot initialize.', 'warn');
    return;
  }

  // Function to toggle header visibility and sync checkbox
  function toggleHeadersVisibility() {
    const headersHidden = body.classList.toggle('hide-headers');
    toggleHeadersCheckbox.checked = headersHidden;
    logToConsole(`Headers ${headersHidden ? 'hidden' : 'visible'}`, 'info');
  }

  // Toggle panel visibility on button click
  toggleBtn.addEventListener('click', () => {
    secretPanel.classList.toggle('secret-panel-visible');
    logToConsole(`Secret panel ${secretPanel.classList.contains('secret-panel-visible') ? 'shown' : 'hidden'}`, 'info');
  });

  // Toggle headers on checkbox change
  toggleHeadersCheckbox.addEventListener('change', toggleHeadersVisibility);

  // Toggle headers on 'H' key press
  document.addEventListener('keydown', (event) => {
    // Ignore if typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
      return;
    }
    if (event.key === 'h' || event.key === 'H') {
      toggleHeadersVisibility();
    }
  });

  // Handle Invert Colors Button Click
  if (invertColorsBtn) {
    invertColorsBtn.addEventListener('click', () => {
      document.body.classList.toggle('color-scheme-inverted');
      console.log('Toggled inverted color scheme.'); // Optional: Log action
      // You might want to save this preference in localStorage
      if (document.body.classList.contains('color-scheme-inverted')) {
        localStorage.setItem('colorScheme', 'inverted');
      } else {
        localStorage.removeItem('colorScheme');
      }
    });
  }

  // Restore color scheme preference on load
  if (localStorage.getItem('colorScheme') === 'inverted') {
    document.body.classList.add('color-scheme-inverted');
  }

  logToConsole('Secret panel initialized.', 'info');
}

// --- New: Function to Update Assembly UI ---
function updateAssemblyUI(sceneData, sceneDisplayName) {
  const assemblySection = document.getElementById('scene-assembly-section');
  const sceneNameSpan = document.getElementById('assembly-scene-name');
  const takeSelectionArea = document.getElementById('take-selection-area');
  const assembleButton = document.getElementById('assemble-scene-button');

  if (!assemblySection || !sceneNameSpan || !takeSelectionArea || !assembleButton) {
    logToConsole("Assembly UI elements not found", "error");
    return;
  }

  // Reset and hide by default
  takeSelectionArea.innerHTML = '<p><em>Loading assembly info...</em></p>';
  assembleButton.disabled = true;
  assemblySection.style.display = 'none';
  sceneNameSpan.textContent = '';
  currentSceneData = sceneData; // Update global reference

  if (sceneData && sceneData.assembly && Array.isArray(sceneData.assembly) && sceneData.assembly.length > 0) {
    logToConsole(`Found assembly data for scene: ${sceneDisplayName}`, 'info');
    sceneNameSpan.textContent = sceneDisplayName;
    takeSelectionArea.innerHTML = ''; // Clear loading message

    sceneData.assembly.forEach((segment, index) => {
      const segmentDiv = document.createElement('div');
      segmentDiv.className = 'assembly-segment mb-2 p-2 border rounded';
      segmentDiv.dataset.index = index; // Store original index

      const description = `Segment ${index + 1}: Shot "${segment.shot}", Cam "${segment.camera}", In Frame: ${segment.in}, Out Frame: ${segment.out}`;
      const label = document.createElement('label');
      label.textContent = `${description} - Take #:`;
      label.htmlFor = `take-input-${index}`;
      label.className = 'form-label me-2';

      const input = document.createElement('input');
      input.type = 'number';
      input.id = `take-input-${index}`;
      input.className = 'form-control form-control-sm d-inline-block take-input';
      input.style.width = '80px'; // Adjust width as needed
      input.min = '1';
      input.value = '1'; // Default to Take 1
      input.required = true;
      input.dataset.shot = segment.shot; // Store segment data on input for easier access later
      input.dataset.camera = segment.camera;
      input.dataset.inFrame = segment.in;
      input.dataset.outFrame = segment.out;

      segmentDiv.appendChild(label);
      segmentDiv.appendChild(input);
      takeSelectionArea.appendChild(segmentDiv);
    });

    assembleButton.disabled = false; // Enable the button
    assemblySection.style.display = 'block'; // Show the section
  } else {
    logToConsole(`No assembly data found or scene not loaded for: ${sceneDisplayName || 'selected scene'}`, 'warn');
    takeSelectionArea.innerHTML = '<p><em>No assembly definition found for this scene.</em></p>';
    assemblySection.style.display = 'block'; // Show section but with message
    assembleButton.disabled = true;
  }
}

// --- New: Add listener for the Assemble Scene button ---
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
        input.classList.add('is-invalid'); // Add validation feedback
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
    assembleBtn.disabled = true; // Disable button during processing
    assembleBtn.textContent = 'Assembling...';

    try {
      // TODO: Replace log with actual API call
      // console.log("--- WOULD SEND TO BACKEND ---", assemblyPayload);
      // alert(`Assembly requested for scene: ${currentSceneData.directory}\nTakes: ${JSON.stringify(assemblyTakes, null, 2)}`);
      // Simulating backend call delay
      // await new Promise(resolve => setTimeout(resolve, 1500));

      // --- UNCOMMENT THIS BLOCK TO SEND TO BACKEND ---
      const response = await fetch('/api/assemble-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assemblyPayload)
      });
      if (!response.ok) {
        // Try to get error message from backend response body
        let errorMsg = `Assembly request failed with status: ${response.status}`;
        try {
          const errorResult = await response.json();
          errorMsg = errorResult.message || errorMsg;
        } catch (e) { /* Ignore if response body is not JSON */ }
        throw new Error(errorMsg);
      }
      const result = await response.json(); // Get success message
      logToConsole('Assembly request successful:', 'success', result);
      alert(result.message || 'Scene assembly process initiated successfully!'); // Show backend message
      // --- END UNCOMMENT ---

      // logToConsole('Simulated assembly request finished.', 'info');
      // alert('Simulated assembly request finished.'); // Placeholder

    } catch (error) {
      logToConsole(`Error during scene assembly request: ${error}`, 'error');
      alert(`Error starting assembly: ${error.message}`);
    } finally {
      assembleBtn.disabled = false; // Re-enable button
      assembleBtn.textContent = 'Assemble Scene';
    }
  });
}