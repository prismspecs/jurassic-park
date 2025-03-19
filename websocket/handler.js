function initializeWebSocket(wss) {
    wss.on('connection', (ws) => {
        console.log('📡 New WebSocket client connected.');
        ws.send(JSON.stringify({
            type: 'WELCOME',
            message: 'Connected to AI Director System.'
        }));
    });
}

module.exports = { initializeWebSocket }; 