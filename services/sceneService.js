const path = require('path');
const config = require('../config.json');
const scenes = require(path.join(__dirname, '..', config.scenes));
const callsheetService = require('./callsheetService');

// Initialize the callsheet
callsheetService.initCallsheet();

module.exports = {
    scenes,
    getCallsheet: () => callsheetService.getCallsheet()
}; 