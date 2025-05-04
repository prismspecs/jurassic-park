import * as poseDetection from '@tensorflow-models/pose-detection';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';
import { Readable } from 'stream';

// Import the standard CPU/Metal TensorFlow backend directly
import * as tf from '@tensorflow/tfjs-node';

// Explicitly try setting the backend to 'tensorflow' (native C++/Metal)
// This might be necessary if auto-detection isn't picking up Metal.
tf.setBackend('tensorflow').then(() => {
    console.log('TensorFlow backend explicitly set to tensorflow (native C++/Metal).');
}).catch(err => {
    console.error('Failed to explicitly set TensorFlow backend to tensorflow:', err);
    console.log('Falling back to default backend selection.');
});

// Promisify ffprobe
import { promisify } from 'util';
const ffprobe = promisify(ffmpeg.ffprobe);

// --- Custom Readable Stream for Processing Frames ---
class FrameProcessingStream extends Readable {
    constructor(options) {
        super(options);
        this.frameFiles = options.frameFiles;
        this.framesDir = options.framesDir;
        this.lowResFramesDir = options.lowResFramesDir;
        this.detector = options.detector;
        this.thickness = options.thickness;
        this.currentIndex = 0;
        this.totalFrames = this.frameFiles.length;
        this.processedCounter = 0; // For progress reporting
        console.log('Processing frames and applying skeletal mask (streaming to ffmpeg)...');
    }

    async _read() {
        if (this.currentIndex >= this.totalFrames) {
            process.stdout.write('\nFinished processing frames.\n');
            this.push(null); // Signal end of stream
            return;
        }

        const frameIndex = this.currentIndex++;
        const frameFile = this.frameFiles[frameIndex];
        const framePath = `${this.framesDir}/${frameFile}`;
        const lowResFramePath = `${this.lowResFramesDir}/${frameFile}`;

        try {
            if (!fs.existsSync(lowResFramePath) || !fs.existsSync(framePath)) {
                console.warn(`\nSkipping frame ${frameIndex + 1}: Original frame file(s) not found.`);
                this._read(); // Immediately try reading the next frame
                return;
            }

            // Load low-res image for pose detection
            const lowResImage = await loadImage(lowResFramePath);
            const lowResCanvas = createCanvas(lowResImage.width, lowResImage.height);
            const lowResCtx = lowResCanvas.getContext('2d');
            lowResCtx.drawImage(lowResImage, 0, 0);

            // --- Pose Detection with Manual Tensor Management --- 
            let poses = [];
            const inputTensor = tf.browser.fromPixels(lowResCanvas);
            try {
                poses = await this.detector.estimatePoses(inputTensor);
            } catch (estimationError) {
                console.error(`\nError during pose estimation for frame ${frameIndex + 1}:`, estimationError);
            } finally {
                inputTensor.dispose(); // Dispose the tensor
            }
            // --- End Pose Detection ---

            // Create low-res mask
            lowResCtx.clearRect(0, 0, lowResCanvas.width, lowResCanvas.height);
            lowResCtx.globalCompositeOperation = 'source-over';
            const skeleton = [
                [0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
                [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
            ];

            if (Array.isArray(poses)) {
                poses.forEach(pose => {
                    skeleton.forEach(([i, j]) => {
                        const kp1 = pose.keypoints[i]; const kp2 = pose.keypoints[j];
                        if (kp1 && kp2 && kp1.score > 0.5 && kp2.score > 0.5) {
                            lowResCtx.beginPath(); lowResCtx.moveTo(kp1.x, kp1.y); lowResCtx.lineTo(kp2.x, kp2.y);
                            lowResCtx.strokeStyle = 'white'; lowResCtx.lineWidth = this.thickness * 1.2; lowResCtx.stroke();
                        }
                    });
                    pose.keypoints.forEach(keypoint => {
                        if (keypoint.score > 0.5) {
                            lowResCtx.beginPath(); lowResCtx.arc(keypoint.x, keypoint.y, this.thickness, 0, 2 * Math.PI);
                            lowResCtx.fillStyle = 'white'; lowResCtx.fill();
                        }
                    });
                    const [ls, rs, lh, rh] = [pose.keypoints[5], pose.keypoints[6], pose.keypoints[11], pose.keypoints[12]];
                    if (ls?.score > 0.5 && rs?.score > 0.5 && lh?.score > 0.5 && rh?.score > 0.5) {
                        lowResCtx.beginPath(); lowResCtx.moveTo(ls.x, ls.y); lowResCtx.lineTo(rs.x, rs.y);
                        lowResCtx.lineTo(rh.x, rh.y); lowResCtx.lineTo(lh.x, lh.y); lowResCtx.closePath();
                        lowResCtx.fillStyle = 'white'; lowResCtx.fill();
                    }
                });
            }
            const lowResMask = lowResCtx.getImageData(0, 0, lowResCanvas.width, lowResCanvas.height);

            // Load high-res frame
            const image = await loadImage(framePath);
            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);

            // Upscale mask and apply
            const maskCanvas = createCanvas(image.width, image.height);
            const maskCtx = maskCanvas.getContext('2d');
            const tmpMask = createCanvas(lowResCanvas.width, lowResCanvas.height);
            tmpMask.getContext('2d').putImageData(lowResMask, 0, 0);
            maskCtx.drawImage(tmpMask, 0, 0, image.width, image.height);
            const maskData = maskCtx.getImageData(0, 0, image.width, image.height);
            const imgData = ctx.getImageData(0, 0, image.width, image.height);
            for (let j = 0; j < imgData.data.length; j += 4) {
                imgData.data[j + 3] = maskData.data[j]; // Use mask R channel for alpha
            }
            ctx.putImageData(imgData, 0, 0);

            // Get buffer and push to stream
            const buffer = canvas.toBuffer('image/png');
            this.push(buffer);

            // Optional: Delete original frames after processing
            // await fs.promises.unlink(framePath);
            // await fs.promises.unlink(lowResFramePath);

            this.processedCounter++;
            process.stdout.write(`\r  Processing frame ${this.processedCounter} / ${this.totalFrames}`);

        } catch (error) {
            console.error(`\nError processing frame ${frameIndex + 1} (${frameFile}):`, error);
            // Signal error to the stream
            this.destroy(error);
        }
    }
}
// --- End Custom Stream ---

export async function extractPeopleFromVideo(
    inputPath,
    outputPath,
    thickness = 10,
    threadUsagePercentage = 90
) {
    // Ensure the TensorFlow backend is ready (already set globally)
    await tf.ready();
    console.log(`TensorFlow backend ready: ${tf.getBackend()}`);

    console.log('Initializing pose detector...');
    // Use MULTIPOSE_LIGHTNING for potentially better performance on multiple figures
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING });

    // Calculate available threads based on percentage
    const totalCores = os.cpus().length;
    const safePercentage = Math.max(1, Math.min(100, threadUsagePercentage)); // Clamp between 1 and 100
    const calculatedThreads = Math.max(1, Math.floor(totalCores * (safePercentage / 100))); // Use at least 1 thread
    console.log(`Using ${calculatedThreads} threads (${safePercentage}% of ${totalCores} available cores) for ffmpeg.`);

    // Define temporary directories
    const framesDir = './frames';
    const lowResFramesDir = './frames_lowres';

    // Clean up temporary directories from previous runs using fs.promises.rm
    console.log('Cleaning up any existing temporary frame directories...');
    try {
        await fs.promises.rm(framesDir, { recursive: true, force: true }); // Use rm with force: true
    } catch (err) {
        console.warn(`Warning: Could not remove directory ${framesDir}:`, err.message);
    }
    try {
        await fs.promises.rm(lowResFramesDir, { recursive: true, force: true }); // Use rm with force: true
    } catch (err) {
        console.warn(`Warning: Could not remove directory ${lowResFramesDir}:`, err.message);
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

    const totalFramesToProcess = frameFiles.length;

    // --- Remove old frame processing loop --- 
    // console.log('Processing frames and applying skeletal mask...');
    // for (let i = 0; i < totalFramesToProcess; i++) { ... }
    // console.log('Finished processing frames.');

    // Determine output format and ensure .webm for transparency
    let outputExt = outputPath.split('.').pop().toLowerCase();
    if (outputExt !== 'webm') {
        outputPath = outputPath.replace(/\.[^/.]+$/, '.webm');
        console.log('Note: Transparency is only supported in .webm. Output will be saved as', outputPath);
    }

    // --- Setup Frame Processing Stream --- 
    const frameProcessingStream = new FrameProcessingStream({
        frameFiles,
        framesDir,
        lowResFramesDir,
        detector,
        thickness
    });

    // --- Combine frames using ffmpeg reading from the stream --- 
    console.log('Combining processed frames into output video via stream...');
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(frameProcessingStream) // Input the stream
            .inputOptions([
                '-f image2pipe',    // Indicate input is a pipe of images
                '-framerate 30',    // Match the source framerate
                '-vcodec png'       // Specify the codec of the piped images
            ])
            .outputOptions([
                '-c:v vp9',         // Use VP9 for WebM with alpha
                '-pix_fmt yuva420p', // Ensure alpha channel is preserved
                '-auto-alt-ref 0',  // Required for alpha in VP9
                '-deadline realtime', // May help with stream processing, adjust if needed
                '-cpu-used 4'       // Adjust based on system, balances speed/quality
            ])
            .output(outputPath)
            .on('progress', progress => {
                // Progress reporting from ffmpeg might be less reliable with streams
                // We rely on the stream's progress logging
                if (progress.frames) {
                    // Optional: Log ffmpeg frame encoding progress if needed
                    // process.stdout.write(`\r  Encoding frame ${progress.frames}`);
                }
            })
            .on('end', () => {
                process.stdout.write('\nVideo encoding complete.\n');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                process.stdout.write('\nError during video encoding.\n');
                console.error('FFmpeg Error:', err.message);
                console.error('FFmpeg stderr:', stderr);
                reject(err);
            })
            .run(); // Start the ffmpeg process
    });

    // --- Remove old ffmpeg command --- 
    // await new Promise((resolve, reject) => { ffmpeg().input(`${framesDir}/masked_frame%04d.png`) ... });

    console.log('Cleaning up temporary files...');
    // Use fs.promises.rm instead of deprecated rmdir
    await fs.promises.rm(framesDir, { recursive: true, force: true });
    await fs.promises.rm(lowResFramesDir, { recursive: true, force: true });
    console.log('Done! Output saved to', outputPath);
}

// --- Command Line Execution --- 

// Helper function to check if the script is run directly
function isMainScript() {
    // This check works for ES Modules
    // It compares the file URL of the current module with the script path argument
    const scriptPath = process.argv[1];
    const moduleUrl = import.meta.url;
    // Need to convert file URL to path, handling potential differences (e.g., file:// prefix)
    const modulePath = new URL(moduleUrl).pathname;
    // Basic check, might need refinement depending on OS and how node is invoked
    return scriptPath === modulePath;
}

if (isMainScript()) {
    const args = process.argv.slice(2); // Remove 'node' and script path

    if (args.length < 2) {
        console.error('Usage: node app.js <inputPath> <outputPath> [thickness] [threadUsagePercentage]');
        process.exit(1);
    }

    const inputPath = args[0];
    const outputPath = args[1];
    const thickness = args[2] ? parseInt(args[2], 10) : undefined; // Use default if not provided
    const threadUsagePercentage = args[3] ? parseInt(args[3], 10) : undefined; // Use default if not provided

    console.log(`Starting processing:`);
    console.log(`  Input: ${inputPath}`);
    console.log(`  Output: ${outputPath}`);
    if (thickness !== undefined) console.log(`  Thickness: ${thickness}`);
    if (threadUsagePercentage !== undefined) console.log(`  Thread Usage: ${threadUsagePercentage}%`);

    extractPeopleFromVideo(inputPath, outputPath, thickness, threadUsagePercentage)
        .then(() => console.log('Script finished successfully.'))
        .catch(err => {
            console.error('\n--- Script execution failed! ---');
            console.error(err);
            process.exit(1);
        });
}