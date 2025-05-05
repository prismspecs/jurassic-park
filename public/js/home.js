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
// import { CanvasRenderer } from './modules/canvas-renderer.js'; // Old renderer
import { VideoCompositor } from './modules/video-compositor.js'; // Import the new compositor

// --- Globals ---
let currentSceneData = null; // Store loaded scene data

// Wrap everything in an event listener to ensure the DOM is ready,
// especially if the script tag doesn't use 'defer'.
// Using 'defer' is generally better.
document.addEventListener('DOMContentLoaded', () => {

  // --- Global Variables ---
  let voiceBypassEnabled = true;

  // --- UI Update Functions ---
  function updateVoiceBypassButton() {
    const btn = document.getElementById("voiceBypassBtn");
    if (btn) {
      btn.textContent = voiceBypassEnabled ? "Disable Voice Bypass" : "Enable Voice Bypass";
      btn.style.backgroundColor = voiceBypassEnabled ? "#ff4444" : "#4CAF50";
    }
  }

  // --- Event Listeners ---
  // Attach listener to the shot container for delegation
  const shotContainer = document.querySelector('.shot-container');
  if (shotContainer) {
    shotContainer.addEventListener('click', async (event) => {
      // Find the closest ancestor which is a shot-card
      const shotCard = event.target.closest('.shot-card');
      if (shotCard) {
        const sceneDir = shotCard.dataset.sceneDir; // Access data-* attributes
        const shotId = shotCard.dataset.shotId;
        const sceneName = shotCard.dataset.sceneName; // Assuming scene name is available as data attribute

        if (sceneDir && shotId) {
          logToConsole(`Shot card clicked: Scene: ${sceneDir}, Shot: ${shotId}`, 'info');
          initShot(sceneDir, shotId); // Existing call

          // --- New: Fetch full scene details ---
          try {
            const response = await fetch(`/api/scene-details?sceneDir=${sceneDir}`);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            currentSceneData = await response.json(); // Store scene data globally
            logToConsole(`Loaded scene details for: ${sceneDir}`, 'info', currentSceneData);

            // Update the assembly UI
            updateAssemblyUI(currentSceneData, sceneName || sceneDir); // Pass scene name if available

          } catch (error) {
            logToConsole(`Error fetching scene details for ${sceneDir}: ${error}`, 'error');
            // Hide assembly section if fetch fails
            updateAssemblyUI(null, '');
          }
          // --- End New ---
        }
      }
    });
  }

  // Attach listeners for other control buttons by ID
  document.getElementById('actionBtn')?.addEventListener('click', action);
  document.getElementById('actorsReadyBtn')?.addEventListener('click', actorsReady);
  document.getElementById('voiceBypassBtn')?.addEventListener('click', async () => {
    // Update state based on the returned value from the async function
    voiceBypassEnabled = await toggleVoiceBypass(voiceBypassEnabled);
    updateVoiceBypassButton(); // Update UI after state change
  });
  document.getElementById('testConsoleBtn')?.addEventListener('click', testConsole);
  document.getElementById('openTeleprompterBtn')?.addEventListener('click', openTeleprompter);
  document.getElementById('openAlanTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('alan'));
  document.getElementById('openEllieTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('ellie'));
  document.getElementById('testTeleprompterBtn')?.addEventListener('click', testTeleprompter);
  document.getElementById('testTeleprompterVideoBtn')?.addEventListener('click', testTeleprompterVideo);
  document.getElementById('clearTeleprompterBtn')?.addEventListener('click', clearTeleprompter);
  document.getElementById('pauseTeleprompterBtn')?.addEventListener('click', pauseAllTeleprompters);
  document.getElementById('playTeleprompterBtn')?.addEventListener('click', playAllTeleprompters);
  // Listener for recording pipeline dropdown
  document.getElementById('recording-pipeline')?.addEventListener('change', (e) => handlePipelineChange(e.target.value));
  // Listener for recording resolution dropdown
  document.getElementById('recording-resolution')?.addEventListener('change', (e) => handleResolutionChange(e.target.value));

  // --- OLD Session Functions (Keep for reference/potential reuse if needed) ---
  /*
  async function selectSession_OLD(sessionId) {
    // ... old implementation ... 
  }
  */

  /*
  async function deleteSession(sessionId) {
    // ... old implementation ...
  }
  */

  // --- Control Button Functions ---
  // REMOVE ALL FUNCTION DEFINITIONS FROM HERE...
  /*
  function toggleVoiceBypass() { ... }
  function openTeleprompter() { ... }
  function openCharacterTeleprompter(character) { ... }
  function testTeleprompter() { ... }
  function testTeleprompterVideo() { ... }
  function clearTeleprompter() { ... }
  function initShot(sceneDirectory, shotIdentifier) { ... }
  function actorsReady() { ... }
  function action() { ... }
  function testConsole() { ... }
  function pauseAllTeleprompters() { ... }
  function playAllTeleprompters() { ... }
  function handlePipelineChange(pipeline) { ... }
  function handleResolutionChange(resolution) { ... }
  */
  // ... TO HERE

  // --- Actor Loading Logic ---
  const loadActorsBtn = document.getElementById('loadActorsBtn');
  const actorFilesInput = document.getElementById('actorFiles');
  const loadActorsStatus = document.getElementById('loadActorsStatus');
  if (loadActorsBtn && actorFilesInput && loadActorsStatus) {
    loadActorsBtn.addEventListener('click', async () => {
      const files = actorFilesInput.files;
      if (!files || files.length === 0) {
        loadActorsStatus.textContent = 'Please select files to load.';
        loadActorsStatus.className = 'status-error'; return;
      }
      const formData = new FormData();
      for (const file of files) { formData.append('files', file); }
      loadActorsStatus.textContent = 'Loading...';
      loadActorsStatus.className = 'status-info';
      try {
        const response = await fetch('/loadActors', { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message || `HTTP error ${response.status}`);
        }
        loadActorsStatus.textContent = result.message || 'Actors loaded!';
        loadActorsStatus.className = 'status-success';
        actorFilesInput.value = ''; // Clear file input
      } catch (error) {
        console.error("Actor Load Error:", error);
        loadActorsStatus.textContent = `Error: ${error.message}`;
        loadActorsStatus.className = 'status-error';
      }
    });
  }

  // --- Camera Manager ---
  const cameraManager = new CameraManager();
  document.getElementById('addCameraBtn')?.addEventListener('click', () => cameraManager.addCamera());

  // --- Audio Manager ---
  const audioManager = new AudioManager();
  document.getElementById('addAudioDeviceBtn')?.addEventListener('click', () => audioManager.addDeviceCard());

  // --- Canvas Recording Logic ---
  const recordCanvasBtn = document.getElementById('recordCanvasBtn');
  let mediaRecorder;
  let recordedChunks = [];
  let isCanvasRecording = false;

  if (recordCanvasBtn) {
    recordCanvasBtn.addEventListener('click', async () => {
      const canvas = document.getElementById('main-output-canvas');
      if (!canvas) {
        logToConsole('Error: Main output canvas not found!', 'error');
        return;
      }

      if (!isCanvasRecording) {
        // Start recording
        logToConsole('Starting canvas recording...', 'info');
        const stream = canvas.captureStream(30); // Capture at 30 FPS

        // Try common WebM VP9/VP8 codecs first, fall back to default
        const mimeTypes = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
          'video/mp4' // Might not support transparency
        ];
        let selectedMimeType = '';
        for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            break;
          }
        }

        if (!selectedMimeType) {
          logToConsole('No suitable mimeType found for MediaRecorder.', 'error');
          alert('Error: Your browser does not support common video recording formats (WebM/MP4) for canvas.');
          return;
        }

        logToConsole(`Using mimeType: ${selectedMimeType}`, 'info');

        try {
          mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
        } catch (e) {
          logToConsole(`Error creating MediaRecorder: ${e}`, 'error');
          alert(`Error starting recorder: ${e.message}`);
          return;
        }

        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          logToConsole('Canvas recording stopped. Processing video...', 'info');
          const blob = new Blob(recordedChunks, {
            type: selectedMimeType
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          document.body.appendChild(a);
          a.style = 'display: none';
          a.href = url;
          const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
          a.download = `canvas_recording_${timestamp}.${selectedMimeType.split('/')[1].split(';')[0]}`; // e.g., canvas_recording_....webm
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          logToConsole('Canvas recording download initiated.', 'success');
        };

        mediaRecorder.start();
        recordCanvasBtn.textContent = 'Stop Canvas Recording';
        recordCanvasBtn.style.backgroundColor = '#ff4444'; // Red for recording
        isCanvasRecording = true;

      } else {
        // Stop recording
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        recordCanvasBtn.textContent = 'Record Output Canvas';
        recordCanvasBtn.style.backgroundColor = ''; // Reset color
        isCanvasRecording = false;
      }
    });
  } else {
    logToConsole('Record Canvas button not found.', 'warn');
  }
  // --- End Canvas Recording Logic ---

  // --- Initialize Components ---
  logToConsole("DOM loaded. Initializing components...", "info");

  // Define the callback for WebSocket open
  const handleWebSocketOpen = () => {
    fetch("/getVoiceBypass")
      .then((res) => res.json())
      .then((data) => {
        voiceBypassEnabled = data.enabled;
        updateVoiceBypassButton();
      })
      .catch((err) => {
        console.error("Error fetching voice bypass state:", err);
        logToConsole("Error fetching voice bypass state", "error");
      });
  };

  // Initialize WebSocket and get instance (though we primarily use sendWebSocketMessage now)
  const ws = initializeWebSocket(cameraManager, handleWebSocketOpen);

  // Initialize Session Management 
  initializeSessionManagement();

  // Initialize Camera Manager
  if (cameraManager.initialize) {
    cameraManager.initialize().catch(err => {
      logToConsole(`CameraManager initialization failed: ${err}`, 'error');
    });
  } else {
    logToConsole("CameraManager or initialize method not found", 'error');
  }

  // Initialize Audio Manager
  if (audioManager.initialize) {
    audioManager.initialize().catch(err => {
      logToConsole(`AudioManager initialization failed: ${err}`, 'error');
    });
  } else {
    logToConsole("AudioManager or initialize method not found", 'warn');
  }

  // Initialize Resizers
  initializeResizers();

  // --- Initialize Video Compositor ---
  let mainCompositor = null;
  try {
    mainCompositor = new VideoCompositor('main-output-canvas');
  } catch (error) {
    logToConsole(`Failed to initialize VideoCompositor: ${error.message}`, 'error');
    // If compositor fails, the rest of the dependent code might not work
  }
  // Expose compositor for CameraManager to use (simple approach for now)
  window.mainCompositor = mainCompositor;

  // Find Camera 1 video element and add it as the primary source
  // Using a timeout again, still not ideal but functional for now
  setTimeout(() => {
    logToConsole('setTimeout: Checking for compositor and video element...', 'debug'); // Added log
    if (mainCompositor) {
      logToConsole('setTimeout: mainCompositor found. Looking for video element...', 'debug'); // Added log
      const camera1Video = document.getElementById('preview-Camera_1');
      if (camera1Video) {
        logToConsole(`setTimeout: Found video element: ${camera1Video.id}. Adding source to compositor.`, 'info'); // Modified log
        try {
          mainCompositor.setPrimaryVideoSource(camera1Video);
        } catch (e) {
          logToConsole(`setTimeout: Error calling setPrimaryVideoSource: ${e.message}`, 'error'); // Added error catch
        }
      } else {
        logToConsole('setTimeout: Could not find video element with ID preview-Camera_1.', 'warn'); // Modified log
      }
    } else {
      logToConsole('setTimeout: mainCompositor object not found.', 'warn'); // Added log
    }
  }, 1500); // Same delay as before
  // --- End Compositor Init ---

  // Initialize Collapsible Sections
  initializeCollapsibleSections();

  // Initialize Fullscreen Toggles
  initializeFullscreenToggles();

  // --- Initialize Secret Panel ---
  initializeSecretPanel();

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