const path = require('path');
const config = require('../config.json');
const scenes = require(path.join(__dirname, '..', config.scenes));

module.exports = {
    scenes
}; 