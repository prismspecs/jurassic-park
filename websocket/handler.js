const WebSocket = require('ws');

function initializeWebSocket(wss) {
    console.log('Initializing WebSocket server...');

    wss.on('connection', (ws) => {
        console.log('📡 New WebSocket client connected.');

        // Send welcome message
        const welcomeMsg = {
            type: 'WELCOME',
            message: 'Connected to AI Director System.'
        };
        // console.log('Sending welcome message:', welcomeMsg);
        ws.send(JSON.stringify(welcomeMsg));

        // Handle client messages
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Received WebSocket message from client:', data);

                // Handle teleprompter control messages
                if (data.type === 'TELEPROMPTER_CONTROL') {
                    // Broadcast the control message to all clients
                    global.wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(message.toString());
                        }
                    });
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        });

        // Handle client errors
        ws.on('error', (error) => {
            console.error('WebSocket client error:', error);
        });

        // Handle client disconnection
        ws.on('close', () => {
            console.log('📡 WebSocket client disconnected.');
        });
    });
}

module.exports = { initializeWebSocket }; 