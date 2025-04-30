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

  // Add listener for toggle preview command
  socket.on('togglePreview', (data) => {
    console.log(`Received togglePreview command from control panel: ${data.show ? 'show' : 'hide'}`);
    io.emit('togglePreview', data);
  });

  // Add listener for webcamReady command
  socket.on('webcamReady', () => {
    console.log('Received webcamReady notification from control panel');
    io.emit('webcamReady'); // Broadcast to all clients (specifically the screen)
  });

  // Add listener for webcam frames (don't log each frame to avoid console spam)
  socket.on('webcamFrame', (frameData) => {
    // Relay frame to all other clients without logging
    socket.broadcast.emit('webcamFrame', frameData); // Use broadcast to avoid sending back to sender
  });
});

// Server listen
http.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
