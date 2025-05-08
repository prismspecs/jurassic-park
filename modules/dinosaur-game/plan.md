A node.js game (running on node v12~). It uses a webcam input and skeletal tracking via tf js pose net. It creates a white mask on a black background of the persons body/skeleton. (In order to do this it should have the ability to have thicker lines and fill in bones to create a solid torso, for example). There is also a mask image (mask.jpg) which is also white on black. The idea of this game is to occupy the shape/pixels of the mask object as closely as possible with your body/skeleton.

The parts of the body which are overlapping with the mask should be drawn in green. The parts of body which are not overlapping should be red. It should draw a score on top which has a percentage of correctness. It should also draw the tf js skeleton to make it look cool.

---

## Project Structure (Initial)

```
modules/dinosaur-game/
├── node_modules/
├── public/
│   ├── index.html       # Main application page
│   ├── script.js        # Client-side JS (webcam, posenet, drawing)
│   ├── style.css        # Basic styling
│   └── mask.jpg         # Target shape mask (NEEDS TO BE PROVIDED BY USER - currently empty)
├── .gitignore
├── package.json
├── package-lock.json
├── plan.md            # This file
└── server.js          # Node.js/Express server
```

## Dependencies

- `express`: Web server framework
- `@tensorflow/tfjs`: TensorFlow.js core library (browser)
- `@tensorflow-models/posenet`: Pre-trained PoseNet model
- `nodemon` (dev): Utility for auto-restarting the server during development

## Database Schema

_(No database planned for this module)_

## TODO / Next Steps

1.  **Use Video Mask**: The mask is now a video element (`#mask-video`) in `index.html`, sourced from `public/videos/walking-longneck.mp4`. `script.js` reads frames from this video.
2.  **Implement `drawBodyShape`**: Refine the drawing logic in `script.js` to draw thicker lines and potentially fill areas (e.g., torso) based on keypoints. Color segments green/red based on mask overlap.
3.  **Implement `calculateOverlapScore`**: Develop a robust pixel-based overlap calculation between the drawn body shape and the current `maskImageData` (from the video frame).
4.  **Refine Styling/UI**: Improve visual feedback, potentially drawing the score directly on the canvas, adjusting layout, etc.
5.  **Error Handling**: Add more robust error handling (e.g., if webcam access is denied, video loading fails).
6.  **Configuration**: Make parameters like colors, line widths, and model configuration easily adjustable. **Add Mask Video Selection**: Allow changing the mask video source via the UI.

## New Feature: Masked Webcam Video Output (Implemented)

The game now has the capability to output a secondary video stream. This video consists of the live webcam feed, but with the background masked out, effectively showing only the player's body against a transparent background. This uses the same body silhouette generated for the game's primary synthesized canvas.

### How it Works:

1.  **Offscreen Canvas**: A dedicated offscreen canvas is used to prepare frames for this new video output.
2.  **Webcam Frame**: In each game loop iteration, the current raw webcam frame is drawn onto this offscreen canvas.
3.  **Mask Application**: The player's silhouette (derived from `processingCanvas`, which is also used for the main game display on `silhouette-canvas`) acts as a mask. Pixels on the offscreen webcam canvas corresponding to the background (i.e., not part of the player's silhouette) are made transparent.
4.  **MediaRecorder API**: The browser's `MediaRecorder` API is used to capture a video stream from this continuously updated offscreen canvas.
5.  **Video Output**: When the game is stopped (or the recording is otherwise ended), the recorded video data is compiled into a single video file (typically `.webm`) and a download is automatically triggered for the user.

### Configuration:

This feature is configured within the `gameConfig` object passed to the `DinosaurGame` constructor (typically in `public/main.js`):

-   `outputMaskedVideo` (boolean): Set to `true` to enable this feature. Defaults to `false`.
-   `outputMaskedVideoFilename` (string): Specifies the filename for the downloaded video. Defaults to `'masked_webcam_feed.webm'`.
-   `outputMaskedVideoMimeType` (string): Specifies the MIME type (and codecs) for the recording. Defaults to `'video/webm; codecs=vp9'`. Ensure the browser supports the chosen type.

Example in `public/main.js`:

```javascript
const gameConfig = {
    // ... other existing configurations ...
    outputMaskedVideo: true, // Enable the feature
    outputMaskedVideoFilename: 'my_player_video.webm', // Custom filename
    // ... other existing configurations ...
};
```

This allows for capturing the player's performance directly from the webcam, with the background removed, synchronized with the game play. The existing synthesized canvas output (showing green/red overlap with the target mask) remains the primary game display.
