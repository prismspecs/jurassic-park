const socket = io();

// Keep basic elements if needed for other potential uses, but remove video/face logic
// const videoPlayer = document.getElementById('videoPlayer');
// const webcamVideo = document.getElementById('webcamVideo');
// const faceOverlay = document.getElementById('faceOverlay');
// const faceCanvas = document.getElementById('faceCanvas');
// const startButton = document.getElementById('startButton');

// Remove face-api related variables and functions
// const faceApiModelsPath = '/weights';
// let faceDetectionInterval;
// let showFaceIntervals = [...];
// let currentFaceInterval = null;

// Remove Face Detection Setup
// async function loadModels() { ... }

// Remove Webcam Setup
// async function setupWebcam() { ... }

// Remove Face Detection Logic
// async function startFaceDetection() { ... }

// Remove Video Playback Logic
// function checkFaceOverlayTime() { ... }

// Remove Event Listeners related to video/face
// startButton.addEventListener('click', () => { ... });
// videoPlayer.addEventListener('timeupdate', checkFaceOverlayTime);
// videoPlayer.addEventListener('play', () => { ... });
// videoPlayer.addEventListener('pause', () => { ... });
// videoPlayer.addEventListener('ended', () => { ... });

// Keep basic Socket.IO listeners if needed, remove video-specific ones
socket.on('connect', () => {
    console.log('Client.js connected to server (if used).');
});

socket.on('disconnect', () => {
    console.log('Client.js disconnected from server (if used).');
});

// Remove videoStarted listener
// socket.on('videoStarted', () => { ... });

// Remove initial setup related to face overlay
// faceOverlay.style.display = 'none';

console.log("client.js loaded (minimal version).");
