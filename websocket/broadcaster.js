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
    // Log to real console with appropriate level
    switch (level) {
        case 'error':
            console.error(message);
            break;
        case 'warn':
            console.warn(message);
            break;
        default:
            console.log(message);
    }

    // Broadcast to WebSocket clients
    broadcast({
        type: 'CONSOLE',
        message,
        level
    });
}

module.exports = { broadcast, broadcastConsole }; 