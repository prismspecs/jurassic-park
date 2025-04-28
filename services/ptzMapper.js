const { mapRange } = require('./utils.js'); // Use require for CommonJS

// Constants based on camera specifications and scenes.json conventions
const PAN_DEGREES_MIN = -140;
const PAN_DEGREES_MAX = 140;
const PAN_SOFTWARE_MIN = -468000;
const PAN_SOFTWARE_MAX = 468000;

const TILT_DEGREES_MIN = -70; // Downward
const TILT_DEGREES_MAX = 30;  // Upward
const TILT_SOFTWARE_MIN = -324000;
const TILT_SOFTWARE_MAX = 324000;

// Zoom is assumed to be 0-100 for both scenes.json and camera control

/**
 * Maps pan degrees (-140 to 140) to the camera's software value range.
 * @param {number} degrees - Pan value in degrees.
 * @returns {number} - Corresponding software value, rounded to the nearest step (3600).
 */
function mapPanDegreesToSoftware(degrees) {
  const mappedValue = mapRange(degrees, PAN_DEGREES_MIN, PAN_DEGREES_MAX, PAN_SOFTWARE_MIN, PAN_SOFTWARE_MAX);
  // Round to the nearest step value (3600 for pan)
  return Math.round(mappedValue / 3600) * 3600;
}

/**
 * Maps tilt degrees (-70 to 30) to the camera's software value range.
 * @param {number} degrees - Tilt value in degrees.
 * @returns {number} - Corresponding software value, rounded to the nearest step (3600).
 */
function mapTiltDegreesToSoftware(degrees) {
  const mappedValue = mapRange(degrees, TILT_DEGREES_MIN, TILT_DEGREES_MAX, TILT_SOFTWARE_MIN, TILT_SOFTWARE_MAX);
  // Round to the nearest step value (3600 for tilt)
  return Math.round(mappedValue / 3600) * 3600;
}

/**
 * Maps zoom percentage (0-100) directly. Included for consistency.
 * @param {number} percentage - Zoom value (0-100).
 * @returns {number} - Corresponding software value (0-100).
 */
function mapZoomToSoftware(percentage) {
    // Clamp the value between 0 and 100
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    return Math.round(clampedPercentage); // Ensure integer value
}

module.exports = {
    mapPanDegreesToSoftware,
    mapTiltDegreesToSoftware,
    mapZoomToSoftware
}; 