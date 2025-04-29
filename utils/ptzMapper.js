/**
 * ptzMapper.js
 * Utility functions for mapping PTZ degrees/percentages to camera software values.
 */

const PAN_TILT_STEP = 3600;

/**
 * Maps a value from one range to another.
 * @param {number} value - The input value to map.
 * @param {number} inMin - The minimum of the input range.
 * @param {number} inMax - The maximum of the input range.
 * @param {number} outMin - The minimum of the output range.
 * @param {number} outMax - The maximum of the output range.
 * @returns {number} The mapped value.
 */
function mapRange(value, inMin, inMax, outMin, outMax) {
  // Clamp value to input range
  const clampedValue = Math.max(inMin, Math.min(value, inMax));
  return outMin + ((clampedValue - inMin) * (outMax - outMin)) / (inMax - inMin);
}

/**
 * Maps pan degrees (-140 to +140) to camera software value (-468000 to 468000),
 * snapping to the nearest step (3600).
 * @param {number} degrees - Pan value in degrees.
 * @returns {number} Mapped and snapped software value for pan.
 */
function mapPanDegreesToValue(degrees) {
    const PAN_DEG_MIN = -140;
    const PAN_DEG_MAX = 140;
    const PAN_VAL_MIN = -468000;
    const PAN_VAL_MAX = 468000;

    // 1. Map degrees to the continuous value range
    const rawValue = mapRange(degrees, PAN_DEG_MIN, PAN_DEG_MAX, PAN_VAL_MIN, PAN_VAL_MAX);

    // 2. Snap to the nearest step
    const snappedValue = Math.round(rawValue / PAN_TILT_STEP) * PAN_TILT_STEP;

    // 3. Clamp the snapped value to the min/max bounds
    const finalValue = Math.max(PAN_VAL_MIN, Math.min(snappedValue, PAN_VAL_MAX));

    return finalValue;
}

/**
 * Maps tilt degrees (-70 to +30) to camera software value (-324000 to 324000),
 * snapping to the nearest step (3600).
 * @param {number} degrees - Tilt value in degrees.
 * @returns {number} Mapped and snapped software value for tilt.
 */
function mapTiltDegreesToValue(degrees) {
    const TILT_DEG_MIN = -70; // Downward
    const TILT_DEG_MAX = 30;  // Upward
    const TILT_VAL_MIN = -324000; // Corresponds to -70 deg
    const TILT_VAL_MAX = 324000; // Corresponds to +30 deg

    // IMPORTANT: The mapping might be inverted depending on camera hardware/v4l2 interpretation.
    // Assuming -70 deg maps to min value and +30 deg maps to max value. Adjust if needed.

    // 1. Map degrees to the continuous value range
    const rawValue = mapRange(degrees, TILT_DEG_MIN, TILT_DEG_MAX, TILT_VAL_MIN, TILT_VAL_MAX);

    // 2. Snap to the nearest step
    const snappedValue = Math.round(rawValue / PAN_TILT_STEP) * PAN_TILT_STEP;

    // 3. Clamp the snapped value to the min/max bounds
    const finalValue = Math.max(TILT_VAL_MIN, Math.min(snappedValue, TILT_VAL_MAX));

    return finalValue;
}

module.exports = {
    mapPanDegreesToValue,
    mapTiltDegreesToValue
    // mapRange is internal, no need to export unless needed elsewhere
}; 