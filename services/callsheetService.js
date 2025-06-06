const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { broadcast, broadcastConsole } = require('../websocket/broadcaster');

let callsheet = [];
let characterAssignments = { fixedAssignments: [] };

// Initialize the callsheet from file
function initCallsheet() {
    try {
        const callsheetPath = path.join(__dirname, '..', config.callsheet);
        console.log('Loading callsheet from:', callsheetPath);

        if (!fs.existsSync(callsheetPath)) {
            console.log('Callsheet file does not exist, creating empty callsheet');
            callsheet = [];
            saveCallsheet();
            return;
        }

        const data = fs.readFileSync(callsheetPath, 'utf8');
        callsheet = JSON.parse(data);
        console.log('Loaded callsheet:', callsheet);
    } catch (err) {
        console.error('Error loading callsheet:', err);
        callsheet = [];
    }

    // Also load character assignments when initializing callsheet
    loadCharacterAssignments();
}

// Load character assignments from JSON file
function loadCharacterAssignments() {
    try {
        const assignmentsPath = path.join(__dirname, '..', config.characterAssignments);
        console.log('Loading character assignments from:', assignmentsPath);

        if (!fs.existsSync(assignmentsPath)) {
            console.log('Character assignments file does not exist, using default empty assignments');
            characterAssignments = { fixedAssignments: [] };
            return;
        }

        const data = fs.readFileSync(assignmentsPath, 'utf8');
        characterAssignments = JSON.parse(data);
        console.log('Loaded character assignments:', characterAssignments);
    } catch (err) {
        console.error('Error loading character assignments:', err);
        broadcastConsole('Error loading character assignments: ' + err.message, 'error');
        characterAssignments = { fixedAssignments: [] };
    }
}

// Get actors for a scene based on number of characters needed
function getActorsForScene(numActorsNeeded) {
    console.log('Getting actors for scene. Needed:', numActorsNeeded);

    // Filter available actors
    const availableActors = callsheet.filter(actor => actor.available);

    if (availableActors.length < numActorsNeeded) {
        broadcastConsole(`Not enough available actors to fill all roles. Needed: ${numActorsNeeded}, Available: ${availableActors.length}. Proceeding with available actors.`, 'warn');
        // Intentionally proceed with the available actors, even if fewer than needed.
        // The draftActorsForShot logic will handle assigning who it can and logging further warnings if roles remain unfilled.
    }

    // Return all actors that are currently available, without sorting by sceneCount here, and without slicing.
    // The draftActorsForShot function in sceneController will handle fixed assignments first,
    // and then fill remaining roles.
    return availableActors;
}

// Get fixed assignments for characters
function getFixedCharacterAssignments(characterNames) {
    const assignments = [];

    console.log('Looking for fixed assignments for characters:', characterNames);
    console.log('Current character assignments:', JSON.stringify(characterAssignments));

    if (!characterAssignments.fixedAssignments || !Array.isArray(characterAssignments.fixedAssignments)) {
        console.log('No fixedAssignments array found in characterAssignments');
        return assignments;
    }

    console.log('Fixed assignments available:', characterAssignments.fixedAssignments);

    // For each character, check if there's a fixed assignment
    characterNames.forEach((charName, index) => {
        console.log(`Checking for fixed assignment for character: ${charName}`);

        const fixedAssignment = characterAssignments.fixedAssignments.find(
            assignment => assignment.characterName.toLowerCase() === charName.toLowerCase()
        );

        if (fixedAssignment) {
            console.log(`Found fixed assignment: ${fixedAssignment.actorName} for ${charName}`);
            assignments.push({
                actorName: fixedAssignment.actorName,
                characterIndex: index,
                characterName: charName
            });
        } else {
            console.log(`No fixed assignment found for ${charName}`);
        }
    });

    console.log('Returning assignments:', assignments);
    return assignments;
}

// Add a new actor to the callsheet if they don't exist
function addActor(actorData) {
    if (!actorData || !actorData.id || !actorData.name) {
        console.error('Invalid actor data provided to addActor', actorData);
        return false; // Indicate failure
    }

    // Check if actor already exists by ID or name
    const existingActor = callsheet.find(a => a.id === actorData.id || a.name === actorData.name);
    if (existingActor) {
        console.log(`Actor with ID ${actorData.id} or name ${actorData.name} already exists. Not adding.`);
        return false; // Indicate duplicate/failure
    }

    // Add the new actor
    const newActor = {
        id: actorData.id,
        name: actorData.name,
        available: actorData.available !== undefined ? actorData.available : true, // Default to true
        sceneCount: actorData.sceneCount !== undefined ? actorData.sceneCount : 0 // Default to 0
    };
    callsheet.push(newActor);
    console.log('Added new actor:', newActor);
    return true; // Indicate success
}

// Update actor's scene count
function updateActorSceneCount(actorName) {
    console.log('Updating scene count for actor:', actorName);
    const actor = callsheet.find(a => a.name === actorName);
    if (actor) {
        actor.sceneCount = (actor.sceneCount || 0) + 1;
        console.log('Updated actor:', actor);
        saveCallsheet();
    } else {
        console.error('Actor not found in callsheet:', actorName);
    }
}

// Save the callsheet back to file
function saveCallsheet() {
    try {
        const callsheetPath = path.join(__dirname, '..', config.callsheet);
        console.log('Saving callsheet to:', callsheetPath);

        fs.writeFileSync(callsheetPath, JSON.stringify(callsheet, null, 2));
        broadcastConsole('Updated callsheet saved');
    } catch (err) {
        console.error('Error saving callsheet:', err);
        broadcastConsole('Error saving callsheet: ' + err.message, 'error');
    }
}

// Get the current callsheet
function getCallsheet() {
    return callsheet;
}

// New function to get all actor headshot paths
function getAllActorHeadshotPaths() {
    const actorsDirPath = path.join(__dirname, '..', config.actorsDir);
    try {
        if (!fs.existsSync(actorsDirPath)) {
            console.warn(`Actors directory not found: ${actorsDirPath}`);
            broadcastConsole(`Actors directory not found: ${actorsDirPath}`, 'warn');
            return [];
        }

        const actorDirs = fs.readdirSync(actorsDirPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        const headshotPaths = actorDirs.map(actorId => {
            // Construct path relative to the web server root for client access
            // Assuming actorsDir in config is relative to project root, e.g., "./database/actors"
            // And headshots are consistently named 'headshot.jpg'
            const relativeActorsDir = config.actorsDir.startsWith('./') ? config.actorsDir.substring(2) : config.actorsDir;
            return path.posix.join('/', relativeActorsDir, actorId, 'headshot.jpg');
        });

        console.log('Found headshot paths:', headshotPaths);
        return headshotPaths;
    } catch (error) {
        console.error('Error reading actor headshot paths:', error);
        broadcastConsole(`Error fetching all actor headshots: ${error.message}`, 'error');
        return [];
    }
}

// Save character assignments to file
function saveCharacterAssignments() {
    try {
        const assignmentsPath = path.join(__dirname, '..', config.characterAssignments);
        console.log('Saving character assignments to:', assignmentsPath);

        fs.writeFileSync(assignmentsPath, JSON.stringify(characterAssignments, null, 2));
        broadcastConsole('Updated character assignments saved');
        return true;
    } catch (err) {
        console.error('Error saving character assignments:', err);
        broadcastConsole('Error saving character assignments: ' + err.message, 'error');
        return false;
    }
}

// Add a fixed character assignment
function addFixedCharacterAssignment(actorName, characterName) {
    if (!actorName || !characterName) {
        console.error('Invalid actor or character name provided to addFixedCharacterAssignment');
        return false;
    }

    // Ensure fixedAssignments exists
    if (!characterAssignments.fixedAssignments) {
        characterAssignments.fixedAssignments = [];
    }

    // Check if assignment already exists
    const existingIndex = characterAssignments.fixedAssignments.findIndex(
        a => a.actorName === actorName && a.characterName === characterName
    );

    if (existingIndex >= 0) {
        console.log(`Assignment for ${actorName} as ${characterName} already exists`);
        return false;
    }

    // Add the new assignment
    characterAssignments.fixedAssignments.push({
        actorName,
        characterName
    });

    // Save the updated assignments
    return saveCharacterAssignments();
}

// Remove a fixed character assignment
function removeFixedCharacterAssignment(actorName, characterName) {
    if (!characterAssignments.fixedAssignments) {
        return false;
    }

    const initialLength = characterAssignments.fixedAssignments.length;

    // Filter out the matching assignment
    characterAssignments.fixedAssignments = characterAssignments.fixedAssignments.filter(
        a => !(a.actorName === actorName && a.characterName === characterName)
    );

    if (characterAssignments.fixedAssignments.length < initialLength) {
        return saveCharacterAssignments();
    }

    return false;
}

// Refresh callsheet based on actors directory contents
function refreshCallsheet() {
    try {
        const actorsDirPath = path.join(__dirname, '..', config.actorsDir);
        console.log('Refreshing callsheet based on actors directory:', actorsDirPath);

        // Check if actors directory exists
        if (!fs.existsSync(actorsDirPath)) {
            console.warn(`Actors directory not found: ${actorsDirPath}`);
            broadcastConsole(`Actors directory not found: ${actorsDirPath}`, 'warn');
            return { success: false, message: 'Actors directory not found' };
        }

        // Create a map of existing actors in the callsheet for easy lookup
        const existingActorsMap = {};
        callsheet.forEach(actor => {
            existingActorsMap[actor.id] = actor;
        });

        // Get all actor directories
        const actorDirs = fs.readdirSync(actorsDirPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // Track metrics for the result
        const added = [];
        const unchanged = [];
        const removed = [];

        // Process each actor directory
        const newCallsheet = [];
        for (const actorDirName of actorDirs) {
            const infoPath = path.join(actorsDirPath, actorDirName, 'info.json');

            // Skip if no info.json exists
            if (!fs.existsSync(infoPath)) continue;

            try {
                const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

                if (existingActorsMap[actorDirName]) {
                    // Actor already exists in callsheet
                    newCallsheet.push(existingActorsMap[actorDirName]);
                    unchanged.push(info.name);
                } else {
                    // New actor, add to callsheet
                    const newActor = {
                        id: actorDirName,
                        name: info.name,
                        available: true,
                        sceneCount: 0
                    };
                    newCallsheet.push(newActor);
                    added.push(info.name);
                }
            } catch (e) {
                console.error(`Error processing actor directory ${actorDirName}:`, e);
            }
        }

        // Find removed actors
        callsheet.forEach(actor => {
            const actorExists = actorDirs.includes(actor.id);
            if (!actorExists) {
                removed.push(actor.name);
            }
        });

        // Update callsheet
        callsheet = newCallsheet;
        saveCallsheet();

        // Return results
        const resultsMessage = `Callsheet refreshed: ${added.length} actors added, ${unchanged.length} unchanged, ${removed.length} removed`;
        broadcastConsole(resultsMessage);

        return {
            success: true,
            message: resultsMessage,
            added,
            unchanged,
            removed
        };
    } catch (error) {
        console.error('Error refreshing callsheet:', error);
        broadcastConsole('Error refreshing callsheet: ' + error.message, 'error');
        return { success: false, message: 'Error refreshing callsheet: ' + error.message };
    }
}

// Get character assignments object
function getCharacterAssignments() {
    return characterAssignments;
}

// New function to get actor details including headshot URLs
function getActorsWithDetails() {
    const actorsDirPath = path.join(__dirname, '..', config.actorsDir);
    const relativeActorsDirForClient = config.actorsDir.startsWith('./') ? config.actorsDir.substring(2) : config.actorsDir;
    const actorsWithDetails = [];

    if (!fs.existsSync(actorsDirPath)) {
        console.warn(`Actors directory not found for getActorsWithDetails: ${actorsDirPath}`);
        return [];
    }

    callsheet.forEach(actor => {
        const actorId = actor.id;
        const actorName = actor.name;
        let headshotUrl = null;

        if (actorId) {
            const currentActorPath = path.join(actorsDirPath, actorId);
            if (fs.existsSync(currentActorPath)) {
                // Try to find a headshot image
                const potentialHeadshots = ['headshot.jpg', 'headshot.png', 'headshot.jpeg'];
                let foundHeadshotFile = null;

                for (const hsFile of potentialHeadshots) {
                    if (fs.existsSync(path.join(currentActorPath, hsFile))) {
                        foundHeadshotFile = hsFile;
                        break;
                    }
                }

                // If not found by common names, try to find the first image file
                if (!foundHeadshotFile) {
                    try {
                        const files = fs.readdirSync(currentActorPath);
                        foundHeadshotFile = files.find(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
                    } catch (e) {
                        console.error(`Error reading directory ${currentActorPath}:`, e);
                    }
                }

                if (foundHeadshotFile) {
                    headshotUrl = path.posix.join('/', relativeActorsDirForClient, actorId, foundHeadshotFile);
                }
            }
        }
        actorsWithDetails.push({
            id: actorId,
            name: actorName,
            headshotUrl: headshotUrl
        });
    });

    return actorsWithDetails;
}

// Function to completely remove an actor and their files
function removeActorCompletely(actorId) {
    if (!actorId) {
        return { success: false, message: 'Actor ID is required.' };
    }

    const actorIndex = callsheet.findIndex(a => a.id === actorId);
    if (actorIndex === -1) {
        return { success: false, message: `Actor with ID ${actorId} not found in callsheet.` };
    }

    const actorToRemove = callsheet[actorIndex];
    const actorName = actorToRemove.name;
    const actorDirectoryPath = path.join(__dirname, '..', config.actorsDir, actorId);

    try {
        // 1. Delete actor's directory
        if (fs.existsSync(actorDirectoryPath)) {
            fs.rmSync(actorDirectoryPath, { recursive: true, force: true });
            console.log(`Successfully deleted directory: ${actorDirectoryPath}`);
        } else {
            console.warn(`Actor directory not found, but proceeding to remove from callsheet: ${actorDirectoryPath}`);
        }

        // 2. Remove actor from callsheet
        callsheet.splice(actorIndex, 1);
        saveCallsheet(); // Save updated callsheet

        // 3. Remove any fixed character assignments for this actor
        if (characterAssignments.fixedAssignments && actorName) {
            const initialAssignmentsCount = characterAssignments.fixedAssignments.length;
            characterAssignments.fixedAssignments = characterAssignments.fixedAssignments.filter(
                assignment => assignment.actorName !== actorName
            );
            if (characterAssignments.fixedAssignments.length < initialAssignmentsCount) {
                saveCharacterAssignments(); // Save if assignments changed
                console.log(`Removed fixed character assignments for actor: ${actorName}`);
            }
        }

        const message = `Successfully removed actor ${actorName} (ID: ${actorId}) and their files.`;
        broadcastConsole(message);
        return { success: true, message };

    } catch (error) {
        console.error(`Error removing actor ${actorName} (ID: ${actorId}):`, error);
        broadcastConsole(`Error removing actor ${actorName}: ${error.message}`, 'error');
        // Attempt to restore callsheet to prevent inconsistent state if part of the process failed
        // This is a simple rollback; more complex scenarios might need more robust transactions.
        initCallsheet(); // Reload original callsheet and assignments
        return { success: false, message: `Error removing actor ${actorName}: ${error.message}` };
    }
}

module.exports = {
    initCallsheet,
    getActorsForScene,
    updateActorSceneCount,
    getCallsheet,
    addActor,
    saveCallsheet,
    getAllActorHeadshotPaths,
    getFixedCharacterAssignments,
    loadCharacterAssignments,
    saveCharacterAssignments,
    addFixedCharacterAssignment,
    removeFixedCharacterAssignment,
    getCharacterAssignments,
    refreshCallsheet,
    getActorsWithDetails,
    removeActorCompletely
};