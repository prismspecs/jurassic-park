# Jurassic Park Intro Video with Live Face Detection

This Node.js application creates an interactive media experience that combines a video playback with live facial recognition. The software provides a dual-interface system:

## Overview

The application allows a user to start playing a video file while simultaneously performing live facial recognition on a webcam feed. At specific intervals during the video playback, the system displays randomly selected faces (cropped and zoomed) as an overlay on top of the video. The video never pauses; the face feed is simply overlaid at predetermined timestamps.

## Architecture

### Control Panel (`localhost:3000/`)

The control panel page provides the following features:

- Webcam selection controls (choose from multiple connected cameras)
- Resolution selection (320x240, 640x480, 720p, 1080p)
- Live webcam preview
- "Start Video" button to begin playback on the screen page
- "Toggle Face Overlay" button to manually show/hide face display

The control panel captures frames from the selected webcam and transmits them to the screen page via Socket.IO, allowing the webcam to be accessed from only one browser context.

### Screen Page (`localhost:3000/screen`)

The screen page displays:

- The main video (movie.mp4)
- A small preview of the webcam feed in the corner
- Faces detected from the webcam feed overlaid on the video at specific intervals

### Face Detection System

The face detection system:

- Uses face-api.js with TinyFaceDetector model for lightweight, fast detection
- Processes frames transmitted from the control panel
- Detects multiple faces and randomly switches between them (approximately every second)
- Crops and zooms the selected faces with a subtle vignette effect
- Displays faces during these intervals:
  - 1 to 35 seconds: First face overlay
  - 85 to 90 seconds (1:25 to 1:30): Second face overlay
  - 128 to 142 seconds (2:08 to 2:22): Final face overlay

### Communication

The system uses Socket.IO for real-time communication between the control and screen pages:

- Webcam frame transmission from control panel to screen
- Control commands (start video, toggle face overlay)
- Synchronization notifications (webcam ready)

## Technical Implementation

- Node.js backend with Express for routing
- Socket.IO for real-time communication
- HTML5 Video for playback
- Canvas API for frame manipulation and display
- face-api.js for face detection
- Responsive layout with appropriate styling for both interfaces

Possible bonus features:
When a face is detected it "freezes" in that position on the webcam output. So when the face moves, the webcam is still stuck on that position. It would be nice to have the camera follow the face it is attached to.
