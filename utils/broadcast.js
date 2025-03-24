const WebSocket = require('ws');

/** Utility: broadcast JSON to connected WS clients */
function broadcast(data) {
    const msg = JSON.stringify(data);
    global.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

/** Utility: broadcast console message to connected WS clients */
function broadcastConsole(message, level = 'info') {
    broadcast({
        type: 'CONSOLE',
        message,
        level
    });
}

module.exports = {
    broadcast,
    broadcastConsole
}; 