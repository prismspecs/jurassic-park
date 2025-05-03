# Dinosaur Body Mask Game Module

A JavaScript module using TensorFlow.js PoseNet to create an interactive game where the player tries to match their body shape to a target video mask.

## Installation

```bash
npm install <path-to-this-module>
# or
npm install dinosaur-body-mask-game # If published to npm
```

## Usage

```javascript
import { DinosaurGame } from "dinosaur-body-mask-game";

// Ensure you have the necessary HTML elements (video#webcam, canvas#output, video#mask-video)
const config = {
  webcamElementId: "webcam",
  outputCanvasId: "output",
  maskVideoElementId: "mask-video",
  maskVideoSrc: "/path/to/your/mask-video.mp4", // Or use the default from public/videos
  scoreUpdateCallback: (score) => {
    console.log(`Current Score: ${score.toFixed(1)}%`);
    // Update your UI score element here
  },
};

const game = new DinosaurGame(config);

async function run() {
  try {
    await game.setup(); // Initialize webcam, load models, load mask video
    game.start(); // Start the game loop
  } catch (error) {
    console.error("Failed to start game:", error);
  }
}

run();

// To stop the game:
// game.stop();

// To change configuration (e.g., mask video):
// game.setConfig({ maskVideoSrc: '/new/video.mp4' });
// Note: You might need to call setup() again or restart the game after changing some configs.
```

## Required HTML Structure

Your HTML page needs at least these elements:

- `<video id="webcam" playsinline style="display: none;"></video>` (Used for webcam input)
- `<canvas id="output"></canvas>` (Where the game visuals are drawn)
- `<video id="mask-video" playsinline loop muted autoplay style="display: none;"></video>` (Used for the mask shape)

## Configuration Options

(Details TBD - list available constructor options here)

## Development (Example)

Clone the repository and run:

```bash
npm install
npm run dev # Starts the example server with nodemon
```

Access the example at `http://localhost:3000` (or the configured port).
