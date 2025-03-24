const fs = require('fs');
const config = require('../config.json');
const { scenes, callsheet } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast, broadcastConsole } = require('../websocket/broadcaster');

// globals
let sceneTakeIndex = 0;
let currentScene = null;

/** Scene initialization */
function initScene(directory) {
    sceneTakeIndex = 0;
    currentScene = directory;

    const scene = scenes.find(s => s.directory === directory);
    if (!scene) {
        broadcastConsole(`Scene ${directory} not found`, 'error');
        return;
    }
    broadcastConsole(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);
    aiVoice.speak(`Please prepare for scene ${scene.description}`);

    // wait 5 seconds
    setTimeout(() => {
        callActors(scene);
    }, config.waitTime);

    broadcast({
        type: 'SHOT_START',
        scene: scene,
    });
}

function callActors(scene) {
    broadcastConsole(`Calling actors for scene: ${scene.description}`);

    // Get the actors object from the current take
    const actors = scene.takes[sceneTakeIndex].actors;

    // Get the character names from the actors object
    const characterNames = Object.keys(actors);

    // find how many actors are needed for the scene
    const actorsNeeded = characterNames.length;

    broadcastConsole(`Actors needed: ${actorsNeeded} for characters: ${characterNames.join(', ')}`);

    // sort the callsheet by sceneCount
    const sortedCallsheet = callsheet.sort((a, b) => a.sceneCount - b.sceneCount);

    // get the top actorsNeeded actors
    const actorsToCall = sortedCallsheet.slice(0, actorsNeeded);

    // Call the actors
    actorsToCall.forEach((actor, index) => {
        // Update the teleprompter text
        broadcast({
            type: 'TELEPROMPTER',
            text: `Calling actor: ${actor.name} to play ${characterNames[index]}`,
            image: `/database/actors/${actor.name}/headshot.jpg`
        });

        actor.sceneCount++;
        broadcastConsole(`Calling actor: ${actor.name} to play ${characterNames[index]}`);
        aiVoice.speak(`Calling actor: ${actor.name} to play ${characterNames[index]}`);
    });

    // Save the updated callsheet back to the JSON file
    fs.writeFileSync(config.callsheet, JSON.stringify(callsheet, null, 4));
    broadcastConsole('Updated callsheet saved');

    // Broadcast that actors are being called
    broadcast({
        type: 'ACTORS_CALLED',
        scene: scene
    });
}

function actorsReady() {
    if (!currentScene) {
        broadcastConsole('No scene is currently active', 'error');
        return;
    }

    // use currentScene to get the setup
    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene) {
        broadcastConsole(`Scene ${currentScene} not found`, 'error');
        return;
    }

    // Get the setup from the current take
    const setup = scene.takes[sceneTakeIndex].setup;
    if (!setup) {
        broadcastConsole(`No setup found for scene ${currentScene}`, 'error');
        return;
    }

    // aiSpeak the setup
    aiVoice.speak(setup);

    broadcastConsole('Actors are ready to perform');
    broadcast({
        type: 'ACTORS_READY',
        scene: scene
    });
}

function action() {
    if (!currentScene) {
        broadcastConsole('No scene is currently active', 'error');
        return;
    }

    const scene = scenes.find(s => s.directory === currentScene);
    if (!scene) {
        broadcastConsole(`Scene ${currentScene} not found`, 'error');
        return;
    }

    // aiSpeak the action
    aiVoice.speak("action!");

    // Get the current take's actors
    const actors = scene.takes[sceneTakeIndex].actors;

    // Create a timeline of all events (lines and directions) from all actors
    const timeline = [];

    // Process each actor's lines and directions
    Object.entries(actors).forEach(([character, data]) => {
        // Add lines to timeline
        if (data.lines) {
            data.lines.forEach(line => {
                timeline.push({
                    timeIn: line['time-in'],
                    timeOut: line['time-out'],
                    type: 'line',
                    character: character,
                    text: line.text,
                    style: 'italic' // Lines are denoted with _
                });
            });
        }

        // Add directions to timeline
        if (data.directions) {
            data.directions.forEach(direction => {
                timeline.push({
                    timeIn: direction['time-in'],
                    timeOut: direction['time-out'],
                    type: 'direction',
                    character: character,
                    text: direction.text,
                    style: 'bold' // Directions are denoted with *
                });
            });
        }
    });

    // Sort timeline by timeIn
    timeline.sort((a, b) => a.timeIn - b.timeIn);

    // Play through the timeline
    let currentTime = 0;
    timeline.forEach(event => {
        setTimeout(() => {
            // Broadcast the event to the frontend
            broadcast({
                type: 'SCENE_EVENT',
                event: {
                    character: event.character,
                    text: event.text,
                    style: event.type === 'line' ? 'actor' : 'direction'
                }
            });

            // If it's a line, use AI voice to speak it
            if (event.type === 'line') {
                aiVoice.speak(event.text);
            }
        }, event.timeIn * 1000); // Convert seconds to milliseconds
    });
}

module.exports = {
    initScene,
    actorsReady,
    action
}; 