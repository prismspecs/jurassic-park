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

1.  **Provide `mask.jpg`**: The user needs to add a valid white-on-black mask image to `public/mask.jpg` (recommended size: 640x480 or matching webcam resolution).
2.  **Implement `drawBodyShape`**: Refine the drawing logic in `script.js` to draw thicker lines and potentially fill areas (e.g., torso) based on keypoints. Color segments green/red based on mask overlap.
3.  **Implement `calculateOverlapScore`**: Develop a robust pixel-based overlap calculation between the drawn body shape and the `maskImageData`.
4.  **Refine Styling/UI**: Improve visual feedback, potentially drawing the score directly on the canvas, adjusting layout, etc.
5.  **Error Handling**: Add more robust error handling (e.g., if webcam access is denied).
6.  **Configuration**: Make parameters like colors, line widths, and model configuration easily adjustable.
