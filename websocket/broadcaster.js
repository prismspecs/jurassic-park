const WebSocket = require('ws');

function broadcast(data) {
    const msg = JSON.stringify(data);
    // console.log('Broadcasting message:', data);
    if (!global.wss) {
        console.error('WebSocket server not initialized!');
        return;
    }
    // console.log(`Broadcasting to ${global.wss.clients.size} clients`);
    global.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            // console.log('Sending to client:', msg);
            client.send(msg);
        } else {
            console.log('Client not ready, state:', client.readyState);
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