/**
 * settingsService.js
 * Simple service to hold application-wide settings.
 */

let currentSettings = {
    recordingPipeline: 'gstreamer', // Default to gstreamer
    recordingResolution: { width: 1920, height: 1080 } // Default to 1080p
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

// --- Resolution Settings --- 
function setRecordingResolution(resolutionString) {
    if (typeof resolutionString === 'string' && resolutionString.includes('x')) {
        const parts = resolutionString.split('x');
        const width = parseInt(parts[0], 10);
        const height = parseInt(parts[1], 10);

        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
            currentSettings.recordingResolution = { width, height };
            console.log(`[SettingsService] Recording resolution set to: ${width}x${height}`);
            return true;
        } else {
            console.error(`[SettingsService] Invalid resolution dimensions parsed from: ${resolutionString}`);
            return false;
        }
    } else {
        console.error(`[SettingsService] Invalid resolution string format: ${resolutionString}`);
        return false;
    }
}

function getRecordingResolution() {
    // Return a copy to prevent accidental modification
    return { ...currentSettings.recordingResolution };
}

module.exports = {
    setRecordingPipeline,
    getRecordingPipeline,
    shouldUseFfmpeg,
    setRecordingResolution,
    getRecordingResolution
}; 