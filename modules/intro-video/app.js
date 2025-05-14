// Required modules
const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 4000;

// Server-side state
let isControlPanelReady = false; // Track if control panel webcam is ready

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
  console.log('a user connected', socket.id);

  // Send current webcam status to newly connected client
  socket.emit('webcamStatus', isControlPanelReady);

  // Add handler for getWebcamStatus request
  socket.on('getWebcamStatus', () => {
    console.log('Received webcam status request from screen');
    socket.emit('webcamStatus', isControlPanelReady);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected', socket.id);
    // Optional: Add logic here if you need to know if the *control panel* specifically disconnected
    // For now, we assume it stays connected or the state doesn't reset on disconnect.
  });

  // Add event listeners for controlling video playback etc. later
  socket.on('startVideo', () => {
    console.log('Received startVideo command from control panel');
    io.emit('playVideoOnScreen');
  });

  // Remove listener for toggle face overlay command
  /*
  socket.on('toggleFaceOverlay', () => {
    console.log('Received toggleFaceOverlay command from control panel');
    io.emit('toggleFaceOverlay');
  });
  */

  // Add listener for toggle preview command
  socket.on('togglePreview', (data) => {
    console.log(`Received togglePreview command from control panel: ${data.show ? 'show' : 'hide'}`);
    io.emit('togglePreview', data);
  });

  // Add listener for face padding updates
  socket.on('setFacePadding', (paddingValue) => {
    console.log(`Received face padding update from control panel: ${paddingValue}%`);
    io.emit('setFacePadding', paddingValue);
  });

  // Add listener for webcamReady command
  socket.on('webcamReady', () => {
    console.log('Received webcamReady notification from control panel');
    if (!isControlPanelReady) {
      console.log('Setting control panel status to READY.');
      isControlPanelReady = true;
    }
    // Still broadcast to all clients in case they are already connected and waiting
    io.emit('webcamReady');
  });

  // Add listener for webcam frames (don't log each frame to avoid console spam)
  socket.on('webcamFrame', (frameData) => {
    // Relay frame to all other clients without logging
    socket.broadcast.emit('webcamFrame', frameData); // Use broadcast to avoid sending back to sender
  });

  // Relay face padding setting - REMOVED redundant and incorrect handler
  // socket.on('setFacePadding', (paddingValue) => {
  //   console.log(`Received face padding value: ${paddingValue}%`);
  //   // Broadcast to screen only
  //   if (screenSocket) {
  //     screenSocket.emit('setFacePadding', paddingValue);
  //   }
  // });
});

// Server listen
http.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
