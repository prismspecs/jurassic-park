const WebSocket = require('ws');

function broadcast(data) {
    const msg = JSON.stringify(data);
    global.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

module.exports = { broadcast }; 