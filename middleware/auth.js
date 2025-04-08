const config = require('../config.json');

function authMiddleware(req, res, next) {
    // If auth is disabled in config, allow all requests
    if (!config.auth.enabled) {
        return next();
    }

    // Check if user is authenticated via basic auth
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('Authentication required');
    }

    // Get credentials from auth header
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [username, password] = auth.split(':');

    // Check against config credentials
    if (username === config.auth.username && password === config.auth.password) {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic');
        res.status(401).send('Invalid credentials');
    }
}

module.exports = authMiddleware; 