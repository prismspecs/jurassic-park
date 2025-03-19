const { scenes } = require('../services/sceneService');
const aiVoice = require('../services/aiVoice');
const { broadcast } = require('../websocket/broadcaster');

function initScene(directory) {
    const scene = scenes.find(s => s.directory === directory);
    if (!scene) {
        console.log(`Scene ${directory} not found`);
        return;
    }
    console.log(`Initializing scene: ${scene.directory}. Description: ${scene.description}`);
    aiVoice.speak(`Please prepare for scene ${scene.description}`);

    broadcast({
        type: 'SHOT_START',
        scene: scene,
    });
}

module.exports = { initScene }; 