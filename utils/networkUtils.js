const os = require('os');

/**
 * Gets a non-internal IPv4 address of the machine.
 * @returns {string} The local IP address or 'localhost' as a fallback.
 */
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    console.warn('[getLocalIpAddress] Could not find non-internal IPv4 address, falling back to localhost.');
    return 'localhost'; // Fallback
}

module.exports = {
    getLocalIpAddress
}; 