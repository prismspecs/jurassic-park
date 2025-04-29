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
    shotContainer.addEventListener('click', (event) => {
      // Find the closest ancestor which is a shot-card
      const shotCard = event.target.closest('.shot-card');
      if (shotCard) {
        const sceneDir = shotCard.dataset.sceneDir; // Access data-* attributes
        const shotId = shotCard.dataset.shotId;
        if (sceneDir && shotId) {
          initShot(sceneDir, shotId); // Use imported function
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

  // Initialize Resizers
  initializeResizers();

}); // End DOMContentLoaded 