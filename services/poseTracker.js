/*******************************************************
 * poseTracker.js
 *  - load MoveNet
 *  - processFrames: for each frame, detect pose, draw skeleton
 *******************************************************/
const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const poseDetection = require('@tensorflow-models/pose-detection');
const { createCanvas, loadImage } = require('canvas');

let detector = null;

/** loadModels => MoveNet */
async function loadModels() {
    if (detector) {
        console.log("🧠 Pose detection model already loaded.");
        return;
    }
    console.log("🧠 Loading pose detection model (MoveNet)... This might take a moment.");
    try {
        console.log("   Attempting poseDetection.createDetector...");
        const startTime = Date.now();
        detector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );
        const duration = (Date.now() - startTime) / 1000;
        console.log(`✅ Pose detection model loaded successfully in ${duration.toFixed(2)} seconds!`);
    } catch (error) {
        console.error("❌ FAILED to load pose detection model:", error);
        // Re-throw the error so the initialization process knows it failed
        throw error;
    }
}

/**
 * processFrames: from rawDir => overlayDir
 * Detect pose in each .jpg, draw skeleton, save overlay
 */
async function processFrames(rawDir, overlayDir) {
    if (!detector) {
        throw new Error("Detector not initialized. Call loadModels() first.");
    }

    if (!fs.existsSync(overlayDir)) {
        fs.mkdirSync(overlayDir, { recursive: true });
    } else {
        fs.readdirSync(overlayDir).forEach(f => fs.unlinkSync(path.join(overlayDir, f)));
    }

    const frames = fs.readdirSync(rawDir).filter(f => f.endsWith('.jpg'));
    console.log(`Processing ${frames.length} frames for pose...`);

    for (const frameName of frames) {
        const inPath = path.join(rawDir, frameName);
        const outPath = path.join(overlayDir, frameName);

        const buffer = fs.readFileSync(inPath);
        const tfimg = tf.node.decodeImage(buffer);
        const poses = await detector.estimatePoses(tfimg, { flipHorizontal: false });

        if (poses.length > 0 && poses[0].keypoints) {
            const keypoints = poses[0].keypoints.filter(kp => kp.score > 0.5);
            await drawSkeletonOnFrame(inPath, outPath, keypoints);
        } else {
            // No confident pose => copy frame
            fs.copyFileSync(inPath, outPath);
        }

        tfimg.dispose();
    }

    console.log(`✅ Pose overlays done => ${overlayDir}`);
}

/** drawSkeletonOnFrame: draws red circles, blue lines, saves outPath */
async function drawSkeletonOnFrame(inPath, outPath, keypoints) {
    const image = await loadImage(inPath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // original
    ctx.drawImage(image, 0, 0);

    // draw keypoints
    ctx.fillStyle = 'red';
    keypoints.forEach(kp => {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
        ctx.fill();
    });

    // connect lines
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 2;
    const pairs = [
        ['left_shoulder', 'left_elbow'],
        ['left_elbow', 'left_wrist'],
        ['right_shoulder', 'right_elbow'],
        ['right_elbow', 'right_wrist'],
        // ...
    ];

    function find(name) {
        return keypoints.find(kp => kp.name === name);
    }

    pairs.forEach(([a, b]) => {
        const pa = find(a), pb = find(b);
        if (pa && pb) {
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
        }
    });

    const outBuf = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(outPath, outBuf);
}

module.exports = {
    loadModels,
    processFrames
};