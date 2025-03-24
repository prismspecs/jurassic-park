const path = require('path');
const config = require('../config.json');
const scenes = require(path.join(__dirname, '..', config.scenes));
const callsheet = require(path.join(__dirname, '..', config.callsheet));

module.exports = { scenes, callsheet }; 