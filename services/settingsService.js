/**
 * settingsService.js
 * Simple service to hold application-wide settings.
 */

let currentSettings = {
    recordingPipeline: 'gstreamer' // Default to gstreamer
};

function setRecordingPipeline(pipeline) {
    if (pipeline === 'ffmpeg' || pipeline === 'gstreamer') {
        currentSettings.recordingPipeline = pipeline;
        console.log(`[SettingsService] Recording pipeline set to: ${pipeline}`);
        return true;
    } else {
        console.error(`[SettingsService] Invalid pipeline value: ${pipeline}`);
        return false;
    }
}

function getRecordingPipeline() {
    return currentSettings.recordingPipeline;
}

function shouldUseFfmpeg() {
    return currentSettings.recordingPipeline === 'ffmpeg';
}

module.exports = {
    setRecordingPipeline,
    getRecordingPipeline,
    shouldUseFfmpeg,
    // Expose the whole object if needed elsewhere, though getters are safer
    // getCurrentSettings: () => currentSettings 
}; 