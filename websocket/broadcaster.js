const WebSocket = require('ws');

function broadcast(data) {
    const msg = JSON.stringify(data);
    // console.log('Broadcasting message:', data);
    if (!global.wss) {
        console.error('WebSocket server not initialized!');
        return;
    }
    const isShotStart = data.type === 'SHOT_START';
    if (isShotStart) {
        console.log(`[BROADCASTER] Attempting to broadcast SHOT_START to ${global.wss.clients.size} clients. Message: ${msg}`);
    }
    // console.log(`Broadcasting to ${global.wss.clients.size} clients`);
    global.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            if (isShotStart) {
                console.log(`[BROADCASTER] Sending SHOT_START to client.`);
            }
            // console.log('Sending to client:', msg);
            client.send(msg);
        } else {
            if (isShotStart) {
                console.log(`[BROADCASTER] Client not ready for SHOT_START, state: ${client.readyState}`);
            }
            console.log('Client not ready, state:', client.readyState);
        }
    });
    if (isShotStart) {
        console.log(`[BROADCASTER] Finished broadcasting SHOT_START.`);
    }
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

function broadcastTeleprompterStatus(message) {
    console.log(`Broadcasting teleprompter status: ${message}`);
    broadcast({
        type: 'TELEPROMPTER_STATUS',
        message: message
    });
}

module.exports = { broadcast, broadcastConsole, broadcastTeleprompterStatus }; 