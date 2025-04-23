import * as tf from '@tensorflow/tfjs-node';
import * as poseDetection from '@tensorflow-models/pose-detection';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import cliProgress from 'cli-progress';

export async function extractPeopleFromVideo(inputPath, outputPath, thickness = 20) {
    console.log('Initializing pose detector...');
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);

    // Extract frames from the video (high-res)
    const framesDir = './frames';
    const lowResFramesDir = './frames_lowres';
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);
    if (!fs.existsSync(lowResFramesDir)) fs.mkdirSync(lowResFramesDir);

    console.log('Extracting high-res frames from video...');
    await new Promise((resolve, reject) => {
        let lastFrame = 0;
        ffmpeg(inputPath)
            .outputOptions('-vf', 'fps=30')
            .outputOptions('-threads', '4')
            .save(`${framesDir}/frame%04d.png`)
            .on('progress', progress => {
                if (progress.frames && progress.frames !== lastFrame) {
                    lastFrame = progress.frames;
                    process.stdout.write(`\r  High-res frames extracted: ${progress.frames}`);
                }
            })
            .on('end', () => {
                process.stdout.write('\n');
                console.log('High-res frame extraction complete.');
                resolve();
            })
            .on('error', err => {
                console.log('\nError during high-res frame extraction.');
                reject(err);
            });
    });

    console.log('Extracting low-res frames for pose detection...');
    await new Promise((resolve, reject) => {
        let lastFrame = 0;
        ffmpeg(inputPath)
            .outputOptions('-vf', 'fps=30,scale=256:-1')
            .outputOptions('-threads', '4')
            .save(`${lowResFramesDir}/frame%04d.png`)
            .on('progress', progress => {
                if (progress.frames && progress.frames !== lastFrame) {
                    lastFrame = progress.frames;
                    process.stdout.write(`\r  Low-res frames extracted: ${progress.frames}`);
                }
            })
            .on('end', () => {
                process.stdout.write('\n');
                console.log('Low-res frame extraction complete.');
                resolve();
            })
            .on('error', err => {
                console.log('\nError during low-res frame extraction.');
                reject(err);
            });
    });

    const frameFiles = fs.readdirSync(framesDir).filter(file => file.endsWith('.png'));
    const lowResFrameFiles = fs.readdirSync(lowResFramesDir).filter(file => file.endsWith('.png'));

    console.log('Processing frames and applying skeletal mask...');
    // Progress bar setup
    const bar = new cliProgress.SingleBar({
        format: 'Processing frames [{bar}] {percentage}% | {value}/{total} frames',
        hideCursor: true
    }, cliProgress.Presets.shades_classic);
    bar.start(frameFiles.length, 0);

    for (let i = 0; i < frameFiles.length; i++) {
        const frameFile = frameFiles[i];
        const lowResFrameFile = lowResFrameFiles[i];
        const framePath = `${framesDir}/${frameFile}`;
        const lowResFramePath = `${lowResFramesDir}/${lowResFrameFile}`;

        // Load low-res image for pose detection
        const lowResImage = await loadImage(lowResFramePath);
        const lowResCanvas = createCanvas(lowResImage.width, lowResImage.height);
        const lowResCtx = lowResCanvas.getContext('2d');
        lowResCtx.drawImage(lowResImage, 0, 0);

        // Detect poses in the low-res frame
        const inputTensor = tf.browser.fromPixels(lowResCanvas);
        const poses = await detector.estimatePoses(inputTensor);

        // Create a low-res mask for detected people
        lowResCtx.clearRect(0, 0, lowResCanvas.width, lowResCanvas.height);
        lowResCtx.globalCompositeOperation = 'source-over';
        // Define skeleton connections for MoveNet (COCO order)
        const skeleton = [
            [0, 1], [0, 2], [1, 3], [2, 4], // Head/shoulders
            [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], // Arms
            [5, 11], [6, 12], [11, 12], // Torso
            [11, 13], [13, 15], [12, 14], [14, 16] // Legs
        ];
        poses.forEach(pose => {
            // Draw bones (lines between keypoints)
            skeleton.forEach(([i, j]) => {
                const kp1 = pose.keypoints[i];
                const kp2 = pose.keypoints[j];
                if (kp1 && kp2 && kp1.score > 0.5 && kp2.score > 0.5) {
                    lowResCtx.beginPath();
                    lowResCtx.moveTo(kp1.x, kp1.y);
                    lowResCtx.lineTo(kp2.x, kp2.y);
                    lowResCtx.strokeStyle = 'white';
                    lowResCtx.lineWidth = thickness * 1.2; // Slightly thicker for bones
                    lowResCtx.stroke();
                }
            });
            // Draw joints (circles)
            pose.keypoints.forEach(keypoint => {
                if (keypoint.score > 0.5) {
                    lowResCtx.beginPath();
                    lowResCtx.arc(keypoint.x, keypoint.y, thickness, 0, 2 * Math.PI);
                    lowResCtx.fillStyle = 'white';
                    lowResCtx.fill();
                }
            });
        });
        const lowResMask = lowResCtx.getImageData(0, 0, lowResCanvas.width, lowResCanvas.height);

        // Load high-res frame
        const image = await loadImage(framePath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // Upscale low-res mask to high-res
        const maskCanvas = createCanvas(image.width, image.height);
        const maskCtx = maskCanvas.getContext('2d');
        // Draw low-res mask upscaled to high-res
        const tmpMask = createCanvas(lowResCanvas.width, lowResCanvas.height);
        tmpMask.getContext('2d').putImageData(lowResMask, 0, 0);
        maskCtx.drawImage(tmpMask, 0, 0, image.width, image.height);
        // Use the upscaled mask as alpha channel
        const maskData = maskCtx.getImageData(0, 0, image.width, image.height);
        const imgData = ctx.getImageData(0, 0, image.width, image.height);
        for (let j = 0; j < imgData.data.length; j += 4) {
            // Set alpha to mask's R channel (white=255, black=0)
            imgData.data[j + 3] = maskData.data[j];
        }
        ctx.putImageData(imgData, 0, 0);

        const outputFramePath = `${framesDir}/masked_${frameFile}`;
        fs.writeFileSync(outputFramePath, canvas.toBuffer('image/png'));

        bar.increment();
    }
    bar.stop();
    console.log('Finished processing frames.');

    // Determine output format and file extension
    let outputExt = outputPath.split('.').pop().toLowerCase();
    let outputIsWebm = outputExt === 'webm';
    if (!outputIsWebm) {
        // Force .webm for transparency
        outputPath = outputPath.replace(/\.[^/.]+$/, '.webm');
        console.log('Note: Transparency is only supported in .webm. Output will be saved as', outputPath);
    }

    console.log('Combining processed frames into output video...');
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(`${framesDir}/masked_frame%04d.png`)
            .inputOptions('-framerate', '30')
            .outputOptions('-c:v', 'vp9') // Use VP9 for WebM with alpha
            .outputOptions('-pix_fmt', 'yuva420p') // Ensure alpha channel is preserved
            .outputOptions('-auto-alt-ref', '0') // Required for alpha in VP9
            .save(outputPath)
            .on('end', resolve)
            .on('error', reject);
    });

    console.log('Cleaning up temporary files...');
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(lowResFramesDir, { recursive: true, force: true });
    console.log('Done! Output saved to', outputPath);
}