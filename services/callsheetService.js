const fs = require('fs');
const config = require('../config.json');
const { broadcast, broadcastConsole } = require('../websocket/broadcaster');

let callsheet = [];

// Initialize the callsheet from file
function initCallsheet() {
    try {
        const data = fs.readFileSync(config.callsheet, 'utf8');
        callsheet = JSON.parse(data);
    } catch (err) {
        broadcastConsole('Error loading callsheet:', err.message, 'error');
        callsheet = [];
    }
}

// Get actors for a scene based on number of characters needed
function getActorsForScene(numActorsNeeded) {
    // Sort the callsheet by sceneCount
    const sortedCallsheet = [...callsheet].sort((a, b) => a.sceneCount - b.sceneCount);

    // Get the top actorsNeeded actors
    return sortedCallsheet.slice(0, numActorsNeeded);
}

// Update actor's scene count
function updateActorSceneCount(actorName) {
    const actor = callsheet.find(a => a.name === actorName);
    if (actor) {
        actor.sceneCount++;
        saveCallsheet();
    }
}

// Save the callsheet back to file
function saveCallsheet() {
    try {
        fs.writeFileSync(config.callsheet, JSON.stringify(callsheet, null, 4));
        broadcastConsole('Updated callsheet saved');
    } catch (err) {
        broadcastConsole('Error saving callsheet:', err.message, 'error');
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
    getCallsheet
}; 