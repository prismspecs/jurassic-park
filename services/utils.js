/**
 * Re-maps a number from one range to another.
 * Example: mapRange(5, 0, 10, 0, 100) // Output: 50
 *
 * @param {number} value The number to map.
 * @param {number} inMin The lower bound of the value's current range.
 * @param {number} inMax The upper bound of the value's current range.
 * @param {number} outMin The lower bound of the value's target range.
 * @param {number} outMax The upper bound of the value's target range.
 * @returns {number} The mapped value.
 */
function mapRange(value, inMin, inMax, outMin, outMax) {
  // Ensure value is within input range bounds to avoid division by zero or extrapolation issues
  const clampedValue = Math.max(inMin, Math.min(value, inMax));
  
  // Handle case where input range has zero width
  if (inMin === inMax) {
    return (outMin + outMax) / 2; // Return midpoint of output range or specific default
  }
  
  return ((clampedValue - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/**
 * Linearly interpolates between two values.
 * @param {number} a - The start value.
 * @param {number} b - The end value.
 * @param {number} t - The interpolation factor (0.0 to 1.0).
 * @returns {number} The interpolated value.
 */
function lerp(a, b, t) {
    // Clamp t to ensure it stays within [0, 1]
    const clampedT = Math.max(0, Math.min(t, 1));
    return a + (b - a) * clampedT;
}

module.exports = {
    mapRange,
    lerp
}; 