const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { broadcast, broadcastConsole } = require('../websocket/broadcaster');

let callsheet = [];

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
        broadcastConsole('Error loading callsheet: ' + err.message, 'error');
        callsheet = [];
    }
}

// Get actors for a scene based on number of characters needed
function getActorsForScene(numActorsNeeded) {
    console.log('Getting actors for scene. Needed:', numActorsNeeded);

    // Filter available actors
    const availableActors = callsheet.filter(actor => actor.available);

    if (availableActors.length < numActorsNeeded) {
        broadcastConsole(`Not enough available actors. Needed: ${numActorsNeeded}, Available: ${availableActors.length}`, 'error');
        return [];
    }

    // Sort the available actors by sceneCount
    const sortedActors = [...availableActors].sort((a, b) => a.sceneCount - b.sceneCount);

    // Get the top actorsNeeded actors
    const selectedActors = sortedActors.slice(0, numActorsNeeded);
    return selectedActors;
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

module.exports = {
    initCallsheet,
    getActorsForScene,
    updateActorSceneCount,
    getCallsheet,
    addActor, // Export the new function
    saveCallsheet // Ensure saveCallsheet is exported if not already
};