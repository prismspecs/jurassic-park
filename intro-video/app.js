// Required modules
const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;

// Serve static files (HTML, CSS, client-side JS, models, etc.)
app.use(express.static(path.join(__dirname, 'public')));
// Remove the specific routes for node_modules as they are incorrect
// app.use('/node_modules/face-api.js/weights', express.static(path.join(__dirname, 'node_modules/face-api.js/weights')));
// app.use('/node_modules/face-api.js/dist', express.static(path.join(__dirname, 'node_modules/face-api.js/dist')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add route for the screen display
app.get('/screen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

// Socket communication for browser control
io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });

  // Add event listeners for controlling video playback etc. later
  socket.on('startVideo', () => {
    console.log('Received startVideo command from control panel');
    io.emit('playVideoOnScreen');
  });

  // Add listener for toggle command
  socket.on('toggleFaceOverlay', () => {
    console.log('Received toggleFaceOverlay command from control panel');
    io.emit('toggleFaceOverlay');
  });
});

// Server listen
http.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
