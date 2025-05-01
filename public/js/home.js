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

  // --- Audio Manager ---
  const audioManager = new AudioManager();
  document.getElementById('addAudioDeviceBtn')?.addEventListener('click', () => audioManager.addDeviceCard());

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