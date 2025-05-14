import { logToConsole } from './modules/logger.js';
import { initializeResizers } from './modules/layout-resizer.js';
import { CameraManager } from './modules/camera-manager.js';
import {
  initializeSessionManagement,
  updateCurrentSessionDisplay,
  populateSessionList
} from './modules/session-manager.js';
import { initializeWebSocket, sendWebSocketMessage } from './modules/websocket-handler.js';
import { initializeTeleprompterStreaming, updateTeleprompterMirrorState, openAndStreamToTeleprompter } from './modules/teleprompter-handler.js';
import { initializeActorLoader } from './modules/actor-loader.js';
import { initializeSourceSelector, populateAllSourceSelectors } from './modules/source-selector.js';
import { initializeCanvasRecorder } from './modules/canvas-recorder.js';
import {
  toggleVoiceBypass,
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
  handleResolutionChange,
  currentDinosaurName,
  setMainCompositor,
  draftActorsAction
} from './modules/control-actions.js';
import { AudioManager } from './modules/audio-manager.js';
import { VideoCompositor } from './modules/video-compositor.js';
import {
  initializeCollapsibleSections,
  initializeFullscreenToggles,
  initializeSecretPanel
} from './modules/ui-initializer.js';
import { initializeSceneAssembly, updateAssemblyUI as updateAssemblyUIFromModule } from './modules/scene-assembly.js';

// --- Globals ---
let cameraManager;
let mainRecordingCompositor;
let voiceBypassEnabled = true;
let shouldAttemptTeleprompterResume = false; // Flag for pending teleprompter resume

document.addEventListener('DOMContentLoaded', () => {
  logToConsole("DOM loaded. Initializing components...", "info");

  // --- Compositor Initializations ---
  const mainOutputCanvasElement = document.getElementById('main-output-canvas');
  if (mainOutputCanvasElement) {
    mainRecordingCompositor = new VideoCompositor('main-output-canvas');
    logToConsole('Main recording compositor initialized.', 'info');
    setMainCompositor(mainRecordingCompositor);

    // Set mirrored state to true by default on initialization
    mainRecordingCompositor.setMirrored(true);
    logToConsole('Main output canvas mirroring set to true by default.', 'info');
    updateTeleprompterMirrorState(true); // Ensure teleprompter also mirrors by default
    logToConsole('Teleprompter mirror state updated to true by default.', 'info');

    // Event listener for the new mirror toggle for main-output-canvas
    if (mainRecordingCompositor) {
      const mirrorToggle = document.getElementById('mirror-main-output-toggle');
      if (mirrorToggle) {
        mirrorToggle.addEventListener('change', (event) => {
          if (mainRecordingCompositor) {
            mainRecordingCompositor.setMirrored(event.target.checked);
            logToConsole(`Main output canvas mirroring set to: ${event.target.checked}`, 'info');
            updateTeleprompterMirrorState(event.target.checked);
          }
        });
      } else {
        logToConsole('Mirror toggle for main output canvas not found.', 'warn');
      }
    }

    // Listen for when the video mask is cleared on the main compositor
    mainOutputCanvasElement.addEventListener('videomaskcleared', () => {
      const testDinoMaskBtn = document.getElementById('test-dinosaur-mask-btn');
      if (testDinoMaskBtn) {
        testDinoMaskBtn.textContent = 'Test Dinosaur Mask';
        testDinoMaskBtn.classList.remove('btn-danger');
        testDinoMaskBtn.classList.add('btn-warning');
        logToConsole('Test Dinosaur Mask button UI reset due to videomaskcleared event.', 'debug');
      }

      // Perform cleanup of the video element itself
      if (currentTestDinoVideoElement) {
        logToConsole('Cleaning up currentTestDinoVideoElement due to videomaskcleared event.', 'debug');
        currentTestDinoVideoElement.pause();
        currentTestDinoVideoElement.onerror = null; // Detach event handlers
        currentTestDinoVideoElement.oncanplay = null;
        currentTestDinoVideoElement.onloadedmetadata = null; // Add any other relevant handlers
        currentTestDinoVideoElement.onended = null;
        currentTestDinoVideoElement.src = ''; // Empty src to release resources
        currentTestDinoVideoElement.removeAttribute('src'); // Fully remove src attribute

        // Attempt to remove from DOM if it has a parent
        if (currentTestDinoVideoElement.parentNode) {
          try {
            currentTestDinoVideoElement.remove();
          } catch (e) {
            logToConsole(`Error removing currentTestDinoVideoElement from DOM: ${e.message}`, 'warn');
          }
        }
        currentTestDinoVideoElement = null; // Nullify the reference
      }
    });

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

  // Modified event listener for openTeleprompterBtn
  const openTeleprompterBtn = document.getElementById('openTeleprompterBtn');
  if (openTeleprompterBtn) {
    openTeleprompterBtn.addEventListener('click', () => {
      const toggleBtn = document.getElementById('toggleTeleprompterFeedBtn');
      if (mainOutputCanvasElement && mainRecordingCompositor) {
        openAndStreamToTeleprompter(mainOutputCanvasElement, mainRecordingCompositor, toggleBtn, false);
      } else {
        logToConsole('Cannot open and stream teleprompter: main output canvas or compositor not ready.', 'error');
        alert('Main output canvas or compositor not ready to stream to teleprompter.');
      }
    });
  }

  document.getElementById('openAlanTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('alan'));
  document.getElementById('openEllieTeleprompterBtn')?.addEventListener('click', () => openCharacterTeleprompter('ellie'));
  document.getElementById('clearTeleprompterBtn')?.addEventListener('click', clearTeleprompter);
  document.getElementById('actionBtn')?.addEventListener('click', () => action(cameraManager));
  document.getElementById('actorsReadyBtn')?.addEventListener('click', actorsReady);
  document.getElementById('draftActorsBtn')?.addEventListener('click', draftActorsAction);
  document.getElementById('recording-pipeline')?.addEventListener('change', (e) => handlePipelineChange(e.target.value));
  document.getElementById('recording-resolution')?.addEventListener('change', (e) => {
    handleResolutionChange(e.target.value);
    if (cameraManager) cameraManager.updateAllPreviewsResolution();
  });
  document.getElementById('addCameraBtn')?.addEventListener('click', () => cameraManager?.addCamera());
  document.getElementById('addAudioDeviceBtn')?.addEventListener('click', () => audioManager?.addDeviceCard());

  // Test Dinosaur Mask Button
  const testDinoMaskBtn = document.getElementById('test-dinosaur-mask-btn');
  let currentTestDinoVideoElement = null; // Keep a reference if we create it

  testDinoMaskBtn?.addEventListener('click', () => {
    if (mainRecordingCompositor && mainRecordingCompositor.isDinosaurMaskActive()) {
      // Mask is active, button wants to clear it.
      // VideoCompositor.clearVideoMask() will be called.
      // This will dispatch 'videomaskcleared'.
      // The 'videomaskcleared' listener in home.js will handle button UI reset and video element cleanup.
      mainRecordingCompositor.clearVideoMask();
      logToConsole('Clear Dinosaur Mask button clicked. Compositor mask clear initiated.', 'info');
      // No need to directly clean currentTestDinoVideoElement or button UI here, the event handler does it.
    } else if (currentDinosaurName) {
      const videoPath = `/database/dinosaurs/${currentDinosaurName}.mp4`;
      logToConsole(`Test Dinosaur Mask clicked. Video path: ${videoPath}`, 'info');

      // If a mask is currently active on the compositor, clear it first.
      // This will trigger the 'videomaskcleared' event, cleaning up the *old* currentTestDinoVideoElement.
      if (mainRecordingCompositor && mainRecordingCompositor.isDinosaurMaskActive()) {
        logToConsole('An old mask is active on compositor. Clearing it before applying new one.', 'debug');
        mainRecordingCompositor.clearVideoMask();
        // At this point, the 'videomaskcleared' event should have fired and cleaned up
        // the old currentTestDinoVideoElement. currentTestDinoVideoElement in this scope might be null now.
      }

      // Explicitly clean up any *existing* currentTestDinoVideoElement reference in home.js 
      // This handles cases where an element might exist here but isn't active on the compositor, 
      // or as a safeguard if the event didn't nullify it as expected for some reason.
      if (currentTestDinoVideoElement) {
        logToConsole('Preemptively cleaning up existing currentTestDinoVideoElement in home.js before creating a new one.', 'debug');
        currentTestDinoVideoElement.pause();
        currentTestDinoVideoElement.onerror = null;
        currentTestDinoVideoElement.oncanplay = null;
        currentTestDinoVideoElement.onloadedmetadata = null;
        currentTestDinoVideoElement.onended = null;
        currentTestDinoVideoElement.src = '';
        currentTestDinoVideoElement.removeAttribute('src');
        if (currentTestDinoVideoElement.parentNode) {
          try {
            currentTestDinoVideoElement.remove();
          } catch (e) {
            logToConsole(`Error preemptively removing currentTestDinoVideoElement: ${e.message}`, 'warn');
          }
        }
        currentTestDinoVideoElement = null;
      }

      const videoPlayer = document.createElement('video');
      currentTestDinoVideoElement = videoPlayer; // Store reference

      videoPlayer.id = 'dinosaur-mask-source-video'; // For potential debugging, not displayed
      videoPlayer.src = videoPath;
      videoPlayer.crossOrigin = 'anonymous'; // Important if source is different origin and for some canvas operations
      videoPlayer.loop = false; // Explicitly set to false for manual looping by VideoCompositor
      videoPlayer.muted = true; // Autoplay usually requires muted
      videoPlayer.playsinline = true; // Good practice for video elements
      // videoPlayer.style.display = 'none'; // Hide it - it's a source, not for display
      // No need to append to body if VideoCompositor handles it

      videoPlayer.oncanplay = () => {
        logToConsole(`Dinosaur mask video '${currentDinosaurName}.mp4' can play. Attempting to set as mask.`, 'success');
        videoPlayer.play().then(() => {
          if (mainRecordingCompositor) {
            mainRecordingCompositor.setVideoMask(videoPlayer);
            testDinoMaskBtn.textContent = 'Clear Dinosaur Mask';
            testDinoMaskBtn.classList.remove('btn-warning');
            testDinoMaskBtn.classList.add('btn-danger');
          }
        }).catch(e => {
          logToConsole(`Error playing dinosaur video for mask: ${e}`, 'error');
          if (mainRecordingCompositor) mainRecordingCompositor.clearVideoMask();
          testDinoMaskBtn.textContent = 'Test Dinosaur Mask'; // Reset button
          testDinoMaskBtn.classList.remove('btn-danger');
          testDinoMaskBtn.classList.add('btn-warning');
          currentTestDinoVideoElement = null; // Clear reference
        });
      };

      videoPlayer.onerror = (e) => {
        logToConsole(`Error loading dinosaur mask video '${currentDinosaurName}.mp4': ${e.target?.error?.message || 'Unknown error'}`, 'error');
        if (mainRecordingCompositor) mainRecordingCompositor.clearVideoMask(); // Attempt to clear if it was somehow set
        testDinoMaskBtn.textContent = 'Test Dinosaur Mask'; // Reset button
        testDinoMaskBtn.classList.remove('btn-danger');
        testDinoMaskBtn.classList.add('btn-warning');
        currentTestDinoVideoElement = null; // Clear reference
      };

      // It might be necessary to append the video to the DOM for it to load/play reliably, even if hidden.
      // Let's append it and hide it.
      videoPlayer.style.display = 'none';
      document.body.appendChild(videoPlayer);

    } else {
      logToConsole('Test Dinosaur Mask clicked, but no currentDinosaurName is set.', 'warn');
    }
  });

  // Difference Mask Button
  const toggleDifferenceMaskBtn = document.getElementById('toggleDifferenceMaskBtn');
  let isDifferenceMaskActive = false;
  if (toggleDifferenceMaskBtn && mainRecordingCompositor) {
    toggleDifferenceMaskBtn.addEventListener('click', () => {
      isDifferenceMaskActive = !isDifferenceMaskActive;
      mainRecordingCompositor.setDrawDifferenceMask(isDifferenceMaskActive);
      toggleDifferenceMaskBtn.textContent = isDifferenceMaskActive ? 'Hide Difference Mask' : 'Show Difference Mask';
      toggleDifferenceMaskBtn.classList.toggle('btn-danger', isDifferenceMaskActive);
      toggleDifferenceMaskBtn.classList.toggle('btn-warning', !isDifferenceMaskActive);
      logToConsole(`Difference Mask toggled. Active: ${isDifferenceMaskActive}`, 'info');
    });
  } else {
    if (!toggleDifferenceMaskBtn) logToConsole('toggleDifferenceMaskBtn not found.', 'warn');
    if (!mainRecordingCompositor) logToConsole('mainRecordingCompositor not found for Difference Mask button.', 'warn');
  }

  // Shot container listener (delegated)
  const shotContainer = document.querySelector('.shot-container');
  if (shotContainer) {
    shotContainer.addEventListener('click', async (event) => {
      const shotCard = event.target.closest('.shot-card');
      if (shotCard && shotCard.dataset.sceneDir && shotCard.dataset.shotId) {
        // Remove 'active' class from all other shot cards
        const allShotCards = shotContainer.querySelectorAll('.shot-card');
        allShotCards.forEach(card => card.classList.remove('active'));
        // Add 'active' class to the clicked card
        shotCard.classList.add('active');
        initShot(shotCard.dataset.sceneDir, shotCard.dataset.shotId);
      }
    });
  }

  // --- Manager Initializations ---
  cameraManager = new CameraManager();
  initializeSourceSelector(cameraManager, mainRecordingCompositor);

  cameraManager.initialize().then(() => {
    logToConsole('CameraManager initialized.', 'info');
    populateAllSourceSelectors();
    // ---- START: Set default recording source ----
    const recordingSourceSelector = document.getElementById('recording-source-selector');
    if (recordingSourceSelector && recordingSourceSelector.options.length > 1) { // Ensure there's more than the "Select..." option
      let firstCameraOptionValue = null;
      // Find the first actual camera option (value is not empty)
      for (let i = 0; i < recordingSourceSelector.options.length; i++) {
        if (recordingSourceSelector.options[i].value) {
          firstCameraOptionValue = recordingSourceSelector.options[i].value;
          break;
        }
      }
      if (firstCameraOptionValue) {
        logToConsole(`Setting default recording source to: ${firstCameraOptionValue}`, 'info');
        recordingSourceSelector.value = firstCameraOptionValue;
        // Dispatch change event to trigger source update for compositor
        recordingSourceSelector.dispatchEvent(new Event('change'));
      } else {
        logToConsole('No suitable first camera option found to set as default recording source.', 'warn');
      }
    } else {
      logToConsole('Recording source selector not ready or no cameras available for default selection.', 'warn');
    }
    // ---- END: Set default recording source ----

    document.addEventListener('cameramanagerupdate', () => {
      logToConsole('cameramanagerupdate event received in home.js.', 'info');
      populateAllSourceSelectors();

      if (shouldAttemptTeleprompterResume) {
        logToConsole('cameramanagerupdate: Attempting to resume teleprompter stream now.', 'info');
        const toggleBtn = document.getElementById('toggleTeleprompterFeedBtn');
        if (mainOutputCanvasElement && mainRecordingCompositor && mainRecordingCompositor.currentFrameSource) {
          logToConsole('cameramanagerupdate: Conditions met, calling openAndStreamToTeleprompter for resume.', 'info');
          openAndStreamToTeleprompter(mainOutputCanvasElement, mainRecordingCompositor, toggleBtn, true);
          shouldAttemptTeleprompterResume = false;
        } else {
          logToConsole('cameramanagerupdate: Could not auto-resume teleprompter: main canvas, compositor, or frame source not ready. Flag remains for next update.', 'warn');
        }
      }
    });

  }).catch(error => logToConsole(`CameraManager initialization failed: ${error}`, 'error'));

  const audioManager = new AudioManager();
  audioManager.initialize().catch(err => logToConsole(`AudioManager initialization failed: ${err}`, 'error'));

  // --- Main Canvas Recording Logic (for 'main-output-canvas') ---
  const mainOutputCanvasForRecording = document.getElementById('main-output-canvas');
  initializeCanvasRecorder(mainOutputCanvasForRecording, mainRecordingCompositor);

  // --- Stream Main Output to Teleprompter Logic (Reverted to use /teleprompter and setupTeleprompterStream) ---
  initializeTeleprompterStreaming(mainOutputCanvasElement, mainRecordingCompositor);
  // --- End of moved Teleprompter Streaming Logic ---

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

  // Actor Loading
  initializeActorLoader();
  // Scene Assembly Initialization
  initializeSceneAssembly();

  // --- Check if teleprompter stream should be resumed (after other initializations) ---
  if (localStorage.getItem('teleprompterShouldBeStreaming') === 'true') {
    logToConsole('Teleprompter stream was active. Setting flag to attempt resume after camera manager is ready.', 'info');
    shouldAttemptTeleprompterResume = true;
    // The actual call to openAndStreamToTeleprompter is now handled by the 'cameramanagerupdate' event listener.
  } else {
    logToConsole('No teleprompterShouldBeStreaming flag, or not true. No auto-resume planned.', 'debug');
  }

  logToConsole("Jurassic Park AI Director UI Initialized (Corrected Structure)", "success");
}); // End DOMContentLoaded