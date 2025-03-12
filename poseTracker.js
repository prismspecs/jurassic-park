// poseTracker.js
const NodeWebcam = require('node-webcam');
const tf = require('@tensorflow/tfjs-node');
const poseDetection = require('@tensorflow-models/pose-detection');
const path = require('path');
const fs = require('fs');

const { createCanvas, loadImage } = require('canvas');

const aiVoice = require('./aiVoice');
const WebSocket = require('ws');
const WS_SERVER = 'ws://localhost:3000';

let detector = null;

// Initialize WebSocket to local server
const ws = new WebSocket(WS_SERVER);
ws.on('open', () => console.log('📡 Connected to WebSocket server for pose tracking.'));
ws.on('error', (err) => console.error('❌ WebSocket error:', err));

/** Load the MoveNet model */
async function loadModels() {
    console.log("🧠 Loading pose detection model...");
    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    console.log("✅ Pose detection model loaded!");
}

/**
 * Capture a single photo from webcam, run pose detection,
 * then draw the skeleton on a new image & speak the result.
 */
async function captureAndTrackPose() {
    console.log('📷 Capturing webcam image...');

    return new Promise((resolve, reject) => {
        const webcam = NodeWebcam.create({ width: 1920, height: 1080, quality: 100, output: 'jpeg' });
        const outFile = path.join(__dirname, 'latest_pose.jpg');

        webcam.capture(outFile, async (err, data) => {
            if (err) {
                console.error("❌ Error capturing webcam image:", err);
                return reject(err);
            }
            console.log(`✅ Photo captured: ${data}`);

            if (!detector) {
                console.error("❌ Pose detector is null. Did you call loadModels() first?");
                return reject(new Error("Detector not initialized"));
            }

            try {
                const imageBuffer = fs.readFileSync(outFile);
                const tfimage = tf.node.decodeImage(imageBuffer);
                const poses = await detector.estimatePoses(tfimage, { flipHorizontal: false });

                console.log("📡 Detected pose:", JSON.stringify(poses, null, 2));

                if (poses.length > 0 && poses[0].keypoints) {
                    const keypoints = poses[0].keypoints
                        .filter(kp => kp.score > 0.5)
                        .map(kp => ({ name: kp.name, x: kp.x, y: kp.y, confidence: kp.score }));

                    // Send to WebSocket
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "POSE_DATA", payload: keypoints }));
                        console.log("✅ Sent POSE_DATA over WebSocket.");
                    }

                    // Draw skeleton overlay
                    await processPoseData('latest_pose.jpg', keypoints);

                    // Speak the number of keypoints
                    aiVoice.speak(`Detected ${keypoints.length} key points in the pose.`);
                } else {
                    console.log("⚠️ No pose detected.");
                    aiVoice.speak("No pose detected.");
                }
                resolve(poses);
            } catch (detectErr) {
                console.error("❌ Error during pose detection:", detectErr);
                reject(detectErr);
            }
        });
    });
}

/**
 * Draws circles & lines on the image to visualize the pose,
 * then saves it as `latest_pose_overlay.jpg`.
 */
async function processPoseData(imageFilename, keypoints) {
    try {
        const imgPath = path.join(__dirname, imageFilename);
        if (!fs.existsSync(imgPath)) {
            console.warn("Image not found for overlay:", imgPath);
            return;
        }

        // Load the image into canvas
        const image = await loadImage(imgPath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        // Draw the original image
        ctx.drawImage(image, 0, 0);

        // Draw keypoints (small circles)
        ctx.fillStyle = 'red';
        keypoints.forEach(kp => {
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
            ctx.fill();
        });

        // Optionally, draw lines connecting keypoints:
        // For MoveNet, you can define pairs, e.g., leftShoulder->leftElbow->leftWrist
        const pairs = [
            ['left_shoulder', 'left_elbow'],
            ['left_elbow', 'left_wrist'],
            ['right_shoulder', 'right_elbow'],
            ['right_elbow', 'right_wrist'],
            ['left_shoulder', 'right_shoulder'],
            ['left_hip', 'right_hip'],
            ['left_shoulder', 'left_hip'],
            ['right_shoulder', 'right_hip'],
            // etc. You can define more pairs as you like
        ];

        ctx.strokeStyle = 'blue';
        ctx.lineWidth = 2;

        function findPoint(name) {
            return keypoints.find(kp => kp.name === name);
        }

        pairs.forEach(([p1, p2]) => {
            const pt1 = findPoint(p1);
            const pt2 = findPoint(p2);
            if (pt1 && pt2) {
                ctx.beginPath();
                ctx.moveTo(pt1.x, pt1.y);
                ctx.lineTo(pt2.x, pt2.y);
                ctx.stroke();
            }
        });

        // Save new image
        const outFile = path.join(__dirname, 'latest_pose_overlay.jpg');
        const buffer = canvas.toBuffer('image/jpeg');
        fs.writeFileSync(outFile, buffer);
        console.log(`✅ Pose overlay saved as ${outFile}`);
    } catch (err) {
        console.error("Error in processPoseData:", err);
    }
}

module.exports = {
    loadModels,
    captureAndTrackPose,
    processPoseData
};