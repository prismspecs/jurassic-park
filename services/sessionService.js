const fs = require('fs');
const path = require('path');

let currentSessionId = null;
const recordingsBaseDir = path.join(__dirname, '..', 'recordings'); // Assumes services/ is one level down from root

/**
 * Generates a unique session ID based on the current timestamp.
 * Format: YYYY-MM-DD_HH-MM-SS
 * @returns {string} The generated session ID.
 */
function generateSessionId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    // Use dashes for readability
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Sets the current session ID in memory.
 * Does NOT create the directory here; directory is created on first write.
 * @param {string} id - The session ID to set as active.
 */
function setCurrentSessionId(id) {
    if (!id) {
        console.error("Attempted to set an empty session ID.");
        return;
    }
    // Validate format (optional but good)
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(id)) {
        console.warn(`Attempting to set session ID with unexpected format: ${id}`);
    }
    currentSessionId = id;
    console.log(`Current session set to: ${id}`);

    // Ensure the directory exists when the session is set
    const sessionDir = path.join(recordingsBaseDir, id);
    try {
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log(`Created directory for new session: ${sessionDir}`);
        }
    } catch (error) {
        console.error(`Error creating directory for session ${id}:`, error);
        // Decide if we should proceed or throw error
    }
}

/**
 * Gets the currently active session ID.
 * @returns {string|null} The current session ID, or null if not set.
 */
function getCurrentSessionId() {
    if (!currentSessionId) {
        // This case should ideally be avoided by setting it at startup
        console.warn("getCurrentSessionId called before session was initialized.");
    }
    return currentSessionId;
}

/**
 * Gets the absolute path to the directory for the current session.
 * @returns {string} The absolute path to the current session's recording directory.
 * @throws {Error} If the session ID has not been set.
 */
function getSessionDirectory() {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
        throw new Error("Cannot get session directory: Session ID not set.");
    }
    return path.join(recordingsBaseDir, sessionId);
}

/**
 * Lists existing session IDs by reading subdirectory names in the recordings directory.
 * Only lists directories that seem to contain data (non-empty).
 * @returns {string[]} An array of existing session IDs, sorted reverse chronologically (newest first).
 */
function listExistingSessions() {
    try {
        if (!fs.existsSync(recordingsBaseDir)) {
            console.log(`Recordings directory not found, creating: ${recordingsBaseDir}`);
            fs.mkdirSync(recordingsBaseDir, { recursive: true });
            return [];
        }
        const entries = fs.readdirSync(recordingsBaseDir, { withFileTypes: true });
        return entries
            .filter(dirent => {
                if (!dirent.isDirectory()) return false;
                // Check if directory name matches the new format
                if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(dirent.name)) return false;
                return true; // Keep directory if it matches format
            })
            .map(dirent => dirent.name)
            .sort() // Sorts alphabetically/chronologically
            .reverse(); // Newest first
    } catch (error) {
        console.error("Error listing existing sessions:", error);
        return []; // Return empty list on error
    }
}

module.exports = {
    generateSessionId,
    setCurrentSessionId,
    getCurrentSessionId,
    getSessionDirectory,
    listExistingSessions
}; 