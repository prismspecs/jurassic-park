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
    console.log('Current callsheet:', callsheet);

    // Filter available actors
    const availableActors = callsheet.filter(actor => actor.available);
    console.log('Available actors:', availableActors);

    if (availableActors.length < numActorsNeeded) {
        broadcastConsole(`Not enough available actors. Needed: ${numActorsNeeded}, Available: ${availableActors.length}`, 'error');
        return [];
    }

    // Sort the available actors by sceneCount
    const sortedActors = [...availableActors].sort((a, b) => a.sceneCount - b.sceneCount);
    console.log('Sorted actors:', sortedActors);

    // Get the top actorsNeeded actors
    const selectedActors = sortedActors.slice(0, numActorsNeeded);
    console.log('Selected actors:', selectedActors);
    return selectedActors;
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
        console.log('Callsheet data:', callsheet);

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

// Initialize the callsheet when the module is loaded
initCallsheet();

module.exports = {
    initCallsheet,
    getActorsForScene,
    updateActorSceneCount,
    getCallsheet
}; 