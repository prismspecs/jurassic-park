import { logToConsole } from './logger.js';

// --- DOM Elements ---
const currentSessionSpan = document.getElementById('current-session-id');
const noSessionWarningSpan = document.getElementById('no-session-warning');
const sessionListSelect = document.getElementById('session-list');
const selectSessionBtn = document.getElementById('select-session-btn');
const newSessionNameInput = document.getElementById('new-session-name');
const createSessionBtn = document.getElementById('create-session-btn');
const sessionErrorDiv = document.getElementById('session-error');

// --- Core Functions (Exported for WebSocket handler) ---

/**
 * Update the display of the current session ID in the UI.
 * @param {string | null} sessionId - The current session ID or null.
 */
export function updateCurrentSessionDisplay(sessionId) {
    if (currentSessionSpan && noSessionWarningSpan) {
        if (sessionId) {
            currentSessionSpan.textContent = sessionId;
            currentSessionSpan.style.display = 'inline';
            noSessionWarningSpan.style.display = 'none';
        } else {
            currentSessionSpan.textContent = ''; // Clear it
            currentSessionSpan.style.display = 'none';
            noSessionWarningSpan.style.display = 'inline';
        }
    } else {
        console.error('Could not find session display elements');
        logToConsole('Error: Session display elements missing.', 'error');
    }
    // Clear any previous errors when session updates
    clearSessionError();
}

/**
 * Populate the session dropdown list in the UI.
 * @param {string[]} sessions - An array of session IDs.
 */
export function populateSessionList(sessions) {
    if (!sessionListSelect) return;
    sessionListSelect.innerHTML = ''; // Clear existing options
    if (!sessions || sessions.length === 0) {
        sessionListSelect.innerHTML = '<option value="">No sessions available</option>';
        return;
    }
    // Add a placeholder/default option
    sessionListSelect.innerHTML = '<option value="">-- Select a Session --</option>'; 
    sessions.forEach(sessionId => {
        const option = document.createElement('option');
        option.value = sessionId;
        option.textContent = sessionId; // Display the full ID for now
        sessionListSelect.appendChild(option);
    });
}

// --- Internal Helper Functions ---

/**
 * Show session-related error messages in the UI.
 * @param {string} message - The error message to display.
 */
function showSessionError(message) {
    if (sessionErrorDiv) {
        sessionErrorDiv.textContent = message;
        sessionErrorDiv.style.display = 'block';
    }
}

/**
 * Clear session-related error messages from the UI.
 */
function clearSessionError() {
    if (sessionErrorDiv) {
        sessionErrorDiv.textContent = '';
        sessionErrorDiv.style.display = 'none';
    }
}

// --- Actions Triggered by UI ---

/**
 * Fetch the list of sessions from the server and populate the dropdown.
 */
async function fetchSessionList() {
    try {
        const response = await fetch('/api/sessions');
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const sessions = await response.json();
        populateSessionList(sessions);
        // Try to select the current session in the dropdown after loading
        const currentId = currentSessionSpan ? currentSessionSpan.textContent : null;
         if (sessionListSelect && currentId && currentId !== 'Loading...' && currentId !== '(No session selected)') {
            sessionListSelect.value = currentId;
         }
    } catch (error) {
        console.error('Error fetching session list:', error);
        logToConsole(`Error fetching session list: ${error.message}`, 'error');
        if (sessionListSelect) {
            sessionListSelect.innerHTML = '<option value="">Error loading sessions</option>';
        }
        showSessionError('Failed to load session list.');
    }
}

/**
 * Fetch and display the currently active session from the server.
 */
async function fetchCurrentSession() {
    try {
        const response = await fetch('/api/sessions/current');
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        updateCurrentSessionDisplay(data.sessionId);
    } catch (error) {
        console.error('Error fetching current session:', error);
        logToConsole(`Error fetching current session: ${error.message}`, 'error');
        updateCurrentSessionDisplay(null); // Indicate error or no session
        showSessionError('Failed to fetch current session.');
    }
}

/**
 * Handle creating a new session via API call.
 */
async function createSession() {
    clearSessionError();
    const name = newSessionNameInput ? newSessionNameInput.value.trim() : '';
    if (!name) {
        showSessionError('Please enter a name for the new session.');
        return;
    }
    if (!createSessionBtn) return;
    
    createSessionBtn.disabled = true;
    createSessionBtn.textContent = 'Creating...';
    logToConsole(`Creating new session: ${name}`, 'info');

    try {
        const response = await fetch('/api/sessions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || result.error || `HTTP error ${response.status}`);
        }
        logToConsole(`Successfully created session: ${result.sessionId}`, 'success');
        if (newSessionNameInput) newSessionNameInput.value = ''; // Clear input
        // UI update (current session, list) is handled by SESSION_UPDATE and SESSION_LIST_UPDATE WebSocket broadcasts
        
    } catch (error) {
        console.error('Error creating session:', error);
        logToConsole(`Error creating session: ${error.message}`, 'error');
        showSessionError(`Failed to create session: ${error.message}`);
    } finally {
        if(createSessionBtn) {
           createSessionBtn.disabled = false;
           createSessionBtn.textContent = 'Create & Load';
        }
    }
}

/**
 * Handle selecting an existing session via API call.
 */
async function selectSession() {
     clearSessionError();
     const selectedId = sessionListSelect ? sessionListSelect.value : null;
     if (!selectedId) {
         showSessionError('Please select a session from the list.');
         return;
     }
     if(!selectSessionBtn) return;
     
     selectSessionBtn.disabled = true;
     selectSessionBtn.textContent = 'Loading...';
     logToConsole(`Attempting to switch to session: ${selectedId}`, 'info');
     
     try {
        const response = await fetch('/api/select-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: selectedId })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || result.error || `HTTP error ${response.status}`);
        }
        logToConsole(`Successfully requested switch to session: ${selectedId}`, 'success');
        // Current session display update is handled by SESSION_UPDATE WebSocket broadcast
    } catch (error) {
        console.error('Error selecting session:', error);
        logToConsole(`Error selecting session: ${error.message}`, 'error');
        showSessionError(`Failed to load session: ${error.message}`);
    } finally {
        if(selectSessionBtn) {
          selectSessionBtn.disabled = false;
          selectSessionBtn.textContent = 'Load Session';
        }
    }
}

// --- Initialization ---

/**
 * Fetches initial session state and attaches event listeners for session controls.
 */
export async function initializeSessionManagement() {
    await fetchCurrentSession();
    await fetchSessionList();

    // Attach Event Listeners
    if (createSessionBtn && newSessionNameInput) {
      createSessionBtn.addEventListener('click', createSession);
      newSessionNameInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
              createSession();
          }
      });
    }
    
    if (selectSessionBtn && sessionListSelect) {
        selectSessionBtn.addEventListener('click', selectSession);
    }

    logToConsole("Session management initialized.", "info");
} 