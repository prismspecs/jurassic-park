const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename'); // Use a library for robust sanitization

let currentSessionId = null;
const recordingsBaseDir = path.join(__dirname, '..', 'recordings'); // Assumes services/ is one level down from root

/**
 * Generates a timestamp prefix for session IDs.
 * Format: YYYY-MM-DD_HH-MM
 * @returns {string} The generated timestamp prefix.
 */
function generateTimestampPrefix() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    // No seconds
    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

/**
 * Creates a new session, including its directory.
 * @param {string} userProvidedName - The name provided by the user for the session.
 * @returns {string} The full session ID of the newly created session.
 * @throws {Error} If directory creation fails or name is invalid.
 */
function createNewSession(userProvidedName) {
    if (!userProvidedName || typeof userProvidedName !== 'string' || userProvidedName.trim().length === 0) {
        throw new Error("Invalid session name provided.");
    }

    const timestampPrefix = generateTimestampPrefix();
    // Sanitize user input to prevent directory traversal or invalid characters
    const sanitizedName = sanitize(userProvidedName.trim().replace(/\s+/g, '_')); // Replace spaces with underscores first
    
    if (!sanitizedName) {
        throw new Error("Session name is invalid after sanitization.");
    }

    const newSessionId = `${timestampPrefix}_${sanitizedName}`;
    const sessionDir = path.join(recordingsBaseDir, newSessionId);

    try {
        // Ensure the base recordings directory exists
        if (!fs.existsSync(recordingsBaseDir)) {
            fs.mkdirSync(recordingsBaseDir, { recursive: true });
            console.log(`Created base recordings directory: ${recordingsBaseDir}`);
        }
        
        // Create the specific session directory
        if (fs.existsSync(sessionDir)) {
            // Optional: Handle case where directory already exists (e.g., rapid creation)
            console.warn(`Session directory already exists: ${sessionDir}. Re-using.`);
        } else {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log(`Created directory for new session: ${sessionDir}`);
        }
        
        // Set this new session as the current one
        setCurrentSessionId(newSessionId); 
        return newSessionId;

    } catch (error) {
        console.error(`Error creating directory or setting session ${newSessionId}:`, error);
        throw new Error(`Failed to create session directory: ${error.message}`);
    }
}

/**
 * Sets the current session ID in memory. DOES NOT create directory.
 * @param {string|null} id - The session ID to set as active, or null.
 */
function setCurrentSessionId(id) {
    // Allow setting to null if needed (e.g., on startup if no sessions exist)
    if (id === null) {
        currentSessionId = null;
        console.log("Current session cleared.");
        return;
    }
    
    if (!id || typeof id !== 'string') {
         console.error("Attempted to set an invalid session ID type:", id);
         return; // Or throw? For now, just log and return.
    }
    // Basic check for safety, though creation logic should ensure format.
    // Allow any string now, as format is YYYY-MM-DD_HH-MM_name
    // if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}_.+$/.test(id)) {
    //     console.warn(`Attempting to set session ID with potentially unexpected format: ${id}`);
    // }
    currentSessionId = id;
    console.log(`Current session set to: ${id}`);
}

/**
 * Gets the currently active session ID.
 * @returns {string|null} The current session ID, or null if not set.
 */
function getCurrentSessionId() {
    // It's now valid for currentSessionId to be null if none is selected/exists yet
    // if (!currentSessionId) {
    //     console.warn("getCurrentSessionId called when no session is active.");
    // }
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
        throw new Error("Cannot get session directory: No session is currently active.");
    }
    const sessionDir = path.join(recordingsBaseDir, sessionId);

    // IMPORTANT: Ensure the directory exists before returning it, 
    // as recordings might rely on it. This covers edge cases where a session ID
    // might be set but the directory was somehow deleted.
    try {
        if (!fs.existsSync(sessionDir)) {
            console.warn(`Session directory ${sessionDir} did not exist for active session ${sessionId}. Recreating.`);
            fs.mkdirSync(sessionDir, { recursive: true });
        }
    } catch (error) {
         console.error(`Error ensuring session directory exists for ${sessionId}:`, error);
         throw new Error(`Failed to access or create session directory: ${error.message}`);
    }
    
    return sessionDir;
}

/**
 * Lists existing session IDs by reading subdirectory names in the recordings directory.
 * Filters based on the new naming convention and sorts reverse chronologically.
 * @returns {string[]} An array of existing session IDs, sorted newest first.
 */
function listExistingSessions() {
    try {
        if (!fs.existsSync(recordingsBaseDir)) {
            console.log(`Recordings directory not found: ${recordingsBaseDir}. No sessions to list.`);
            // Optionally create it here? For listing, just return empty makes sense.
            // fs.mkdirSync(recordingsBaseDir, { recursive: true });
            return [];
        }
        const entries = fs.readdirSync(recordingsBaseDir, { withFileTypes: true });
        // Match YYYY-MM-DD_HH-MM_ followed by one or more characters
        const sessionRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}_.+$/;
        
        return entries
            .filter(dirent => dirent.isDirectory() && sessionRegex.test(dirent.name))
            .map(dirent => dirent.name)
            .sort() // Sorts alphabetically/chronologically by YYYY-MM-DD_HH-MM prefix
            .reverse(); // Newest first
    } catch (error) {
        console.error("Error listing existing sessions:", error);
        return []; // Return empty list on error
    }
}

/**
 * Gets the ID of the most recent session based on directory listing.
 * @returns {string|null} The ID of the latest session, or null if none exist.
 */
function getLatestSessionId() {
    const sessions = listExistingSessions();
    return sessions.length > 0 ? sessions[0] : null;
}

module.exports = {
    // generateTimestampPrefix, // Expose if needed elsewhere, maybe not
    createNewSession,
    setCurrentSessionId,
    getCurrentSessionId,
    getSessionDirectory,
    listExistingSessions,
    getLatestSessionId
    // generateSessionId is removed as it's replaced by createNewSession
}; 