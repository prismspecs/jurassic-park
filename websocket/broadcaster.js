const WebSocket = require('ws');

function broadcast(data) {
    const msg = JSON.stringify(data);
    global.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

function broadcastConsole(message, level = 'info') {
    broadcast({
        type: 'CONSOLE',
        message,
        level
    });
}

module.exports = { broadcast, broadcastConsole }; 