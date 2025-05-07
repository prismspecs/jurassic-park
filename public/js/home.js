import { logToConsole } from './modules/logger.js';
import { initializeResizers } from './modules/layout-resizer.js';
import { CameraManager } from './modules/camera-manager.js';
import {
  initializeSessionManagement,
  updateCurrentSessionDisplay,
  populateSessionList
} from './modules/session-manager.js';
import { initializeWebSocket, sendWebSocketMessage } from './modules/websocket-handler.js';
import { initializeTeleprompterStreaming } from './modules/teleprompter-handler.js';
import { initializeActorLoader } from './modules/actor-loader.js';
import { initializeSourceSelector, populateAllSourceSelectors } from './modules/source-selector.js';
import { initializeCanvasRecorder } from './modules/canvas-recorder.js';
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
  document.getElementById('clearTeleprompterBtn')?.addEventListener('click', clearTeleprompter);
  document.getElementById('actionBtn')?.addEventListener('click', () => action(cameraManager));
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
      logToConsole('cameramanagerupdate event received.', 'info');
      populateAllSourceSelectors();
    });
  }).catch(error => logToConsole(`CameraManager initialization failed: ${error}`, 'error'));

  const audioManager = new AudioManager();
  audioManager.initialize().catch(err => logToConsole(`AudioManager initialization failed: ${err}`, 'error'));

  // --- Main Canvas Recording Logic (for 'main-output-canvas') ---
  const mainOutputCanvasForRecording = document.getElementById('main-output-canvas');
  initializeCanvasRecorder(mainOutputCanvasForRecording, mainRecordingCompositor);

  // --- Stream Main Output to Teleprompter Logic (Reverted to use /teleprompter and setupTeleprompterStream) ---
  const mainOutputCanvasElementForTeleprompter = document.getElementById('main-output-canvas'); // Ensure this is the correct element
  initializeTeleprompterStreaming(mainOutputCanvasElementForTeleprompter, mainRecordingCompositor);
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

  logToConsole("Jurassic Park AI Director UI Initialized (Corrected Structure)", "success");
}); // End DOMContentLoaded