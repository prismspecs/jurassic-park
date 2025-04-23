import * as poseDetection from '@tensorflow-models/pose-detection';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';

// Promisify ffprobe
import { promisify } from 'util';
const ffprobe = promisify(ffmpeg.ffprobe);

let tf; // Declare tf here to be accessible within the function scope

export async function extractPeopleFromVideo(
    inputPath,
    outputPath,
    thickness = 20,
    threadUsagePercentage = 90
) {
    // Conditionally load TensorFlow backend inside the async function
    if (!tf) { // Load only once
        try {
            tf = await import('@tensorflow/tfjs-node-gpu');
            console.log('Attempting to use @tensorflow/tfjs-node-gpu backend.');
            try {
                // Try to initialize the GPU backend
                await tf.ready();
                if (tf.getBackend() === 'tensorflow' && tf.env().features['IS_GPU_AVAILABLE']) {
                    console.log('Successfully initialized GPU backend.');
                } else {
                     // GPU package loaded but acceleration isn't available/verified
                    console.warn('GPU backend loaded, but GPU acceleration could not be verified. Falling back to CPU.');
                    throw new Error('GPU acceleration verification failed'); // Force fallback
                }
            } catch (initError) {
                 // Catch errors during tf.ready() or the check
                console.error('Error initializing GPU backend:', initError.message);
                console.warn('Falling back to @tensorflow/tfjs-node (CPU/Metal).');
                // Force loading the CPU backend
                tf = await import('@tensorflow/tfjs-node');
                console.log('Using @tensorflow/tfjs-node backend after GPU init failure.');
                await tf.ready(); // Ensure CPU backend is ready
            }
        } catch (importError) {
             // Catch errors during the initial import() call
            console.warn('Could not load @tensorflow/tfjs-node-gpu, falling back to @tensorflow/tfjs-node (CPU/Metal).');
            tf = await import('@tensorflow/tfjs-node');
            console.log('Using @tensorflow/tfjs-node backend.');
            await tf.ready();
        }
    }

    console.log('Initializing pose detector...');
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);

    // Calculate available threads based on percentage
    const totalCores = os.cpus().length;
    const safePercentage = Math.max(1, Math.min(100, threadUsagePercentage)); // Clamp between 1 and 100
    const calculatedThreads = Math.max(1, Math.floor(totalCores * (safePercentage / 100))); // Use at least 1 thread
    console.log(`Using ${calculatedThreads} threads (${safePercentage}% of ${totalCores} available cores) for ffmpeg.`);

    // Define temporary directories
    const framesDir = './frames';
    const lowResFramesDir = './frames_lowres';

    // Clean up temporary directories from previous runs using fs.promises.rmdir
    console.log('Cleaning up any existing temporary frame directories...');
    try {
        await fs.promises.rmdir(framesDir, { recursive: true });
    } catch (err) {
        if (err.code !== 'ENOENT') throw err; // Ignore if directory doesn't exist
    }
    try {
        await fs.promises.rmdir(lowResFramesDir, { recursive: true });
    } catch (err) {
        if (err.code !== 'ENOENT') throw err; // Ignore if directory doesn't exist
    }

    // Ensure temporary directories exist
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);
    if (!fs.existsSync(lowResFramesDir)) fs.mkdirSync(lowResFramesDir);

    // Get video duration to estimate total output frames at target FPS
    let totalOutputFrames = 0;
    const targetFps = 30;
    try {
        const metadata = await ffprobe(inputPath);
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (videoStream && videoStream.duration) {
            const duration = parseFloat(videoStream.duration);
            totalOutputFrames = Math.ceil(duration * targetFps);
            console.log(`Video duration: ${duration}s. Expecting ~${totalOutputFrames} frames at ${targetFps}fps.`);
        } else {
            console.warn('Could not determine video duration from metadata. Progress will not show total.');
        }
    } catch (err) {
        console.error('Error getting video metadata:', err);
        console.warn('Could not determine total frames. Progress will not show total.');
    }

    // Extract frames from the video (high-res)
    console.log('Extracting high-res frames from video...');
    await new Promise((resolve, reject) => {
        let lastFrame = 0;
        ffmpeg(inputPath)
            .outputOptions('-vf', 'fps=30')
            .outputOptions('-threads', `${calculatedThreads}`)
            .save(`${framesDir}/frame%04d.png`)
            .on('progress', progress => {
                if (progress.frames && progress.frames !== lastFrame) {
                    lastFrame = progress.frames;
                    const progressMessage = totalOutputFrames > 0
                        ? `\r  Extracting high-res frame: ${progress.frames} / ${totalOutputFrames}`
                        : `\r  Extracting high-res frame: ${progress.frames}`;
                    process.stdout.write(progressMessage);
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
            .outputOptions('-threads', `${calculatedThreads}`)
            .save(`${lowResFramesDir}/frame%04d.png`)
            .on('progress', progress => {
                if (progress.frames && progress.frames !== lastFrame) {
                    lastFrame = progress.frames;
                    process.stdout.write(`\r  Extracting low-res frame: ${progress.frames}`);
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

    const frameFiles = fs.readdirSync(framesDir).filter(file => file.endsWith('.png')).sort(); // Sort files

    console.log('Processing frames and applying skeletal mask...');
    const totalFramesToProcess = frameFiles.length;
    for (let i = 0; i < totalFramesToProcess; i++) {
        const frameFile = frameFiles[i]; // Get high-res filename (e.g., frame0001.png)
        const framePath = `${framesDir}/${frameFile}`;
        const lowResFramePath = `${lowResFramesDir}/${frameFile}`; // Construct corresponding low-res path

        // Check if the corresponding low-res frame exists
        if (!fs.existsSync(lowResFramePath)) {
            console.warn(`\nSkipping frame ${i + 1}: Corresponding low-res frame not found at ${lowResFramePath}`);
            continue; // Skip this iteration if low-res frame is missing
        }

        let lowResImage, image;
        try {
            // Load low-res image for pose detection
            lowResImage = await loadImage(lowResFramePath);
        } catch (error) {
            console.error(`\nError loading low-res image: ${lowResFramePath}`);
            console.error(error);
            throw error; // Re-throw to stop execution
        }

        const lowResCanvas = createCanvas(lowResImage.width, lowResImage.height);
        const lowResCtx = lowResCanvas.getContext('2d');
        lowResCtx.drawImage(lowResImage, 0, 0);

        // Detect poses in the low-res frame
        const inputTensor = tf.browser.fromPixels(lowResCanvas);
        const poses = await detector.estimatePoses(inputTensor);
        inputTensor.dispose(); // Dispose tensor

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

            // Fill the torso area if all keypoints are detected
            const leftShoulder = pose.keypoints[5];
            const rightShoulder = pose.keypoints[6];
            const leftHip = pose.keypoints[11];
            const rightHip = pose.keypoints[12];

            if (
                leftShoulder && leftShoulder.score > 0.5 &&
                rightShoulder && rightShoulder.score > 0.5 &&
                leftHip && leftHip.score > 0.5 &&
                rightHip && rightHip.score > 0.5
            ) {
                lowResCtx.beginPath();
                lowResCtx.moveTo(leftShoulder.x, leftShoulder.y);
                lowResCtx.lineTo(rightShoulder.x, rightShoulder.y);
                lowResCtx.lineTo(rightHip.x, rightHip.y);
                lowResCtx.lineTo(leftHip.x, leftHip.y);
                lowResCtx.closePath();
                lowResCtx.fillStyle = 'white';
                lowResCtx.fill();
            }
        });
        const lowResMask = lowResCtx.getImageData(0, 0, lowResCanvas.width, lowResCanvas.height);

        try {
            // Load high-res frame
            image = await loadImage(framePath);
        } catch (error) {
            console.error(`\nError loading high-res image: ${framePath}`);
            console.error(error);
            throw error; // Re-throw to stop execution
        }

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

        process.stdout.write(`\r  Processing frame ${i + 1} / ${totalFramesToProcess}`);
    }
    process.stdout.write('\n');
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
        let lastFrame = 0;
        const totalFramesToCombine = frameFiles.length;

        ffmpeg()
            .input(`${framesDir}/masked_frame%04d.png`)
            .inputOptions('-framerate', '30')
            .outputOptions('-c:v', 'vp9') // Use VP9 for WebM with alpha
            .outputOptions('-pix_fmt', 'yuva420p') // Ensure alpha channel is preserved
            .outputOptions('-auto-alt-ref', '0') // Required for alpha in VP9
            .save(outputPath)
            .on('progress', progress => {
                if (progress.frames && progress.frames !== lastFrame) {
                    lastFrame = progress.frames;
                    process.stdout.write(`\r  Combining frame ${lastFrame} / ${totalFramesToCombine}`);
                }
            })
            .on('end', () => {
                process.stdout.write('\n');
                resolve();
            })
            .on('error', err => {
                process.stdout.write('\n');
                reject(err);
            });
    });

    console.log('Cleaning up temporary files...');
    await fs.promises.rmdir(framesDir, { recursive: true });
    await fs.promises.rmdir(lowResFramesDir, { recursive: true });
    console.log('Done! Output saved to', outputPath);
}