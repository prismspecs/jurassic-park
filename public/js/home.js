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
let voiceBypassEnabled = true;

// Helper function to set up the stream in the teleprompter window
function setupTeleprompterStream(win, streamToPlay) {
  logToConsole(`Teleprompter window details: URL='${win.location.href}', readyState='${win.document.readyState}'`, 'debug');
  try {
    const bodySnippet = win.document.body ? win.document.body.innerHTML.substring(0, 500) : "document.body is null";
    logToConsole(`Teleprompter window body (snippet): ${bodySnippet}`, 'debug');

    const liveFeedEl = win.document.getElementById('teleprompterLiveFeed');
    if (liveFeedEl) {
      logToConsole('Found teleprompterLiveFeed element in teleprompter window.', 'info', liveFeedEl);
      liveFeedEl.srcObject = streamToPlay;
      logToConsole('srcObject assigned to teleprompterLiveFeed element. Attempting to play after a short delay...', 'debug');

      setTimeout(() => {
        if (!win || win.closed) {
          logToConsole('Teleprompter window closed before delayed play could execute.', 'warn');
          return;
        }
        logToConsole('Attempting to play teleprompter live feed now...', 'info');
        liveFeedEl.currentTime = 0;
        liveFeedEl.play()
          .then(() => {
            logToConsole('Teleprompter live feed playing successfully (after delay).', 'success');
          })
          .catch(e => {
            logToConsole(`Error playing teleprompter live feed (after delay): ${e.message}. Video muted: ${liveFeedEl.muted}`, 'error', e);
            alert(`Could not automatically play the video feed in the teleprompter (after delay): ${e.message}.`);
          });
      }, 100);

    } else {
      logToConsole('teleprompterLiveFeed element NOT FOUND in teleprompter window. Expected id "teleprompterLiveFeed".', 'error');
      alert('Could not find the video player element (teleprompterLiveFeed) in the teleprompter window. Check console for details.');
    }
  } catch (err) {
    logToConsole(`Error in setupTeleprompterStream: ${err.message}`, 'error', err);
    alert(`An error occurred while trying to set up the video in the teleprompter: ${err.message}`);
  }
}

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

  // --- UI Update Functions (Local to DOMContentLoaded) ---
  function updateVoiceBypassButton() {
    const btn = document.getElementById("voiceBypassBtn");
    if (btn) {
      btn.textContent = voiceBypassEnabled ? "Disable Voice Bypass" : "Enable Voice Bypass";
      btn.style.backgroundColor = voiceBypassEnabled ? "#ff4444" : "#4CAF50";
    }
  }
  updateVoiceBypassButton();

  // --- Core Event Listeners for Buttons etc. ---
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
      }
    });
  }
  // Actor Loading 
  const loadActorsBtn = document.getElementById('loadActorsBtn');
  const actorFilesInput = document.getElementById('actorFiles');
  const loadActorsStatus = document.getElementById('loadActorsStatus');
  if (loadActorsBtn && actorFilesInput && loadActorsStatus) {
    loadActorsBtn.addEventListener('click', async () => { /* ... loadActors logic ... */ });
  }

  // --- Source Selector Logic ---
  const recordingSourceSelector = document.getElementById('recording-source-selector');

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
      if (type === 'Recording' && mainRecordingCompositor) {
        mainRecordingCompositor.removeFrameSource();
      }
    }
  }

  function populateAllSourceSelectors() {
    populateSelector(recordingSourceSelector, 'Recording');
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

  // --- Stream Main Output to Teleprompter Logic (Reverted to use /teleprompter and setupTeleprompterStream) ---
  const streamMainOutputToTeleprompterBtn = document.getElementById('streamMainOutputToTeleprompterBtn');
  if (streamMainOutputToTeleprompterBtn && mainOutputCanvasElement && mainRecordingCompositor) {
    streamMainOutputToTeleprompterBtn.addEventListener('click', () => {
      logToConsole('Attempting to stream main output canvas to /teleprompter page...', 'info');
      if (!mainRecordingCompositor.currentFrameSource) {
        alert('Please select a camera source for the main output first.');
        logToConsole('Streaming to /teleprompter aborted: No source for mainRecordingCompositor.', 'warn');
        return;
      }

      try {
        const teleprompterWin = window.open('/teleprompter', 'TeleprompterView'); // Changed from MinimalTeleprompterView, back to TeleprompterView or a unique name for /teleprompter
        if (!teleprompterWin) {
          alert('Failed to open teleprompter window. Please check popup blocker settings.');
          logToConsole('Failed to open /teleprompter window.', 'error');
          return;
        }

        const stream = mainOutputCanvasElement.captureStream(25);
        logToConsole('Captured stream from mainOutputCanvasElement for /teleprompter.', 'debug', stream);

        teleprompterWin.onerror = (eventOrMessage, source, lineno, colno, error) => {
          const errorMessage = error ? error.message : eventOrMessage;
          logToConsole(`Teleprompter window onerror: ${errorMessage}`, 'error', { eventOrMessage, source, lineno, colno, error });
          alert('The teleprompter window encountered an error while loading its content. Check its console.');
        };

        logToConsole('Setting up onload listener for /teleprompter window.', 'debug');
        teleprompterWin.onload = () => {
          logToConsole('Teleprompter (/teleprompter) window ONLOAD event fired. Current URL: ' + (teleprompterWin ? teleprompterWin.location.href : 'teleprompterWin is null/closed'), 'info');
          if (!teleprompterWin || teleprompterWin.closed) {
            logToConsole('Teleprompter (/teleprompter) window was closed before onload handler could fully execute.', 'warn');
            return;
          }
          if (teleprompterWin.location.href === 'about:blank') {
            logToConsole('Teleprompter (/teleprompter) window onload fired but URL is still about:blank.', 'error');
            return;
          }
          setupTeleprompterStream(teleprompterWin, stream); // Use the helper function
        };

        if (!teleprompterWin || teleprompterWin.closed) {
          logToConsole('Teleprompter (/teleprompter) window was not opened or was closed immediately.', 'error');
          if (teleprompterWin === null) {
            alert('Popup window for /teleprompter failed to open. Please check your browser\'s popup blocker settings.');
          }
          return;
        }

      } catch (error) {
        logToConsole(`Error initiating stream to /teleprompter: ${error.message}`, 'error', error);
        alert(`Error setting up /teleprompter stream: ${error.message}`);
      }
    });
  } else {
    if (!streamMainOutputToTeleprompterBtn) logToConsole('streamMainOutputToTeleprompterBtn not found.', 'warn');
    if (!mainOutputCanvasElement) logToConsole('mainOutputCanvasElement not found (for minimal test).', 'warn');
    if (!mainRecordingCompositor) logToConsole('mainRecordingCompositor not found (for minimal test).', 'warn');
  }

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
    fetch("/getVoiceBypass")
      .then((res) => res.json())
      .then((data) => { voiceBypassEnabled = data.enabled; updateVoiceBypassButton(); })
      .catch((err) => console.error("Error fetching voice bypass state:", err));
  };
  const wsUrl = `ws://${window.location.host}`;
  initializeWebSocket(wsUrl, cameraManager, handleWebSocketOpen);

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

    const startCollapsed = section.classList.contains('start-collapsed');
    if (!startCollapsed) {
      header.classList.add('expanded');
      if (content) content.style.display = '';
    } else {
      if (content) content.style.display = 'none';
    }

    header.addEventListener('click', () => {
      const isExpanding = !header.classList.contains('expanded');
      header.classList.toggle('expanded', isExpanding);

      if (content) {
        content.style.display = isExpanding ? '' : 'none';
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
      const children = Array.from(pageLayout.children);

      if (isCurrentlyFullscreen) {
        targetPanel.classList.remove('fullscreen');
        children.forEach(child => {
          if (child !== targetPanel) {
            child.classList.remove('panel-hidden');
          }
        });
      } else {
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

  function toggleHeadersVisibility() {
    const headersHidden = body.classList.toggle('hide-headers');
    toggleHeadersCheckbox.checked = headersHidden;
    logToConsole(`Headers ${headersHidden ? 'hidden' : 'visible'}`, 'info');
  }

  toggleBtn.addEventListener('click', () => {
    secretPanel.classList.toggle('secret-panel-visible');
    logToConsole(`Secret panel ${secretPanel.classList.contains('secret-panel-visible') ? 'shown' : 'hidden'}`, 'info');
  });

  toggleHeadersCheckbox.addEventListener('change', toggleHeadersVisibility);

  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
      return;
    }
    if (event.key === 'h' || event.key === 'H') {
      toggleHeadersVisibility();
    }
  });

  if (invertColorsBtn) {
    invertColorsBtn.addEventListener('click', () => {
      document.body.classList.toggle('color-scheme-inverted');
      console.log('Toggled inverted color scheme.');
      if (document.body.classList.contains('color-scheme-inverted')) {
        localStorage.setItem('colorScheme', 'inverted');
      } else {
        localStorage.removeItem('colorScheme');
      }
    });
  }

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

  takeSelectionArea.innerHTML = '<p><em>Loading assembly info...</em></p>';
  assembleButton.disabled = true;
  assemblySection.style.display = 'none';
  sceneNameSpan.textContent = '';
  currentSceneData = sceneData;

  if (sceneData && sceneData.assembly && Array.isArray(sceneData.assembly) && sceneData.assembly.length > 0) {
    logToConsole(`Found assembly data for scene: ${sceneDisplayName}`, 'info');
    sceneNameSpan.textContent = sceneDisplayName;
    takeSelectionArea.innerHTML = '';

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
      input.value = '1';
      input.required = true;
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
    assemblySection.style.display = 'block';
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
        input.classList.add('is-invalid');
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
      logToConsole(`Error during scene assembly request: ${error}`, 'error');
      alert(`Error starting assembly: ${error.message}`);
    } finally {
      assembleBtn.disabled = false;
      assembleBtn.disabled = false; // Re-enable button
      assembleBtn.textContent = 'Assemble Scene';
    }
  });
}