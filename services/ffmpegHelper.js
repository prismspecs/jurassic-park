/*******************************************************
 * ffmpegHelper.js
 *   - Captures 3s video from Mac's webcam (avfoundation)
 *   - Extract frames to a folder
 *   - Re-encode frames into mp4
 *******************************************************/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    /**
     * captureVideo:
     *   -f avfoundation => Mac
     *   -f v4l2 => Linux
     *   -framerate 30 => Force 30 fps
     *   -i "0:1" => default camera and microphone
     *   -t 3 => record 3 seconds
     *   -c:v libx264, -pix_fmt yuv420p => standard h264
     *   -c:a aac => audio codec
     *   -b:a 192k => audio bitrate
     * @param {string} devicePath - Camera device path (Linux/macOS specific)
     * @param {object} [resolution] - Optional resolution object (unused by ffmpegHelper currently)
     * @returns {Promise} - Resolves when recording is complete
     */
    captureVideo(outVideoName, durationSec, devicePath = null, resolution = null) {
        // Note: The resolution parameter is accepted for consistency with gstreamerHelper 
        // but is not currently used in the ffmpeg commands below.
        // The video_size is hardcoded for Linux.
        return new Promise((resolve, reject) => {
            if (fs.existsSync(outVideoName)) {
                fs.unlinkSync(outVideoName);
            }

            const platform = os.platform();
            let ffmpegArgs;

            if (platform === 'darwin') {
                // macOS configuration
                ffmpegArgs = [
                    '-f', 'avfoundation',
                    '-framerate', '30',
                    '-i', '0:1',  // 0 is video, 1 is audio
                    '-t', durationSec.toString(),
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-crf', '17',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-ar', '48000',
                    '-ac', '2',
                    '-b:a', '320k',
                    '-af', 'aresample=async=1:first_pts=0',
                    '-thread_queue_size', '512',
                    '-max_muxing_queue_size', '2048',
                    '-vsync', 'vfr',
                    outVideoName
                ];
            } else {
                // Linux configuration - optimized for camera capture
                // Try MJPEG first as it's often less memory intensive
                ffmpegArgs = [
                    '-f', 'v4l2',
                    '-thread_queue_size', '512',
                    '-input_format', 'mjpeg', // Use MJPEG instead of yuyv422
                    '-video_size', '640x480',
                    '-i', devicePath || '/dev/video0',  // Use provided device path or default
                    '-t', durationSec.toString(),
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-crf', '17',
                    '-pix_fmt', 'yuv420p',
                    '-max_muxing_queue_size', '2048',
                    '-vsync', 'vfr',
                    '-fflags', '+nobuffer',
                    '-flags', 'low_delay',
                    '-strict', 'experimental',
                    outVideoName
                ];
            }

            console.log(`Starting FFmpeg capture for ${durationSec} sec from ${devicePath || 'default device'} => ${outVideoName}`);
            // Log the exact command being run
            const command = `ffmpeg ${ffmpegArgs.join(' ')}`;
            console.log('Running FFmpeg command:', command);
            
            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            let errorOutput = '';
            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`ffmpeg: ${output}`);
                errorOutput += output;
                
                // Check for specific error conditions and try alternative configurations
                if (output.includes('Cannot allocate memory') || 
                    output.includes('buf_len[0] = 0') || 
                    output.includes('Invalid argument') ||
                    output.includes('Inappropriate ioctl')) {
                    console.log('Detected capture issue, trying alternative configuration...');
                    ffmpeg.kill();  // Kill the current process
                    
                    // Try alternative configuration - maybe default format detection works better
                    // Let's try removing explicit input_format to let ffmpeg autodetect
                    const altFfmpegArgs = [
                        '-f', 'v4l2',
                        '-thread_queue_size', '512',
                       // '-input_format', 'yuyv422', // REMOVED - Let FFmpeg autodetect
                        '-video_size', '640x480',
                        '-i', devicePath || '/dev/video0',
                        '-t', durationSec.toString(),
                        '-c:v', 'libx264',
                        '-preset', 'ultrafast',
                        '-crf', '17',
                        '-pix_fmt', 'yuv420p',
                        '-max_muxing_queue_size', '2048',
                        '-vsync', 'vfr',
                        '-fflags', '+nobuffer',
                        '-flags', 'low_delay',
                        '-strict', 'experimental',
                        outVideoName
                    ];
                    
                    // Log the alternative command
                    const altCommand = `ffmpeg ${altFfmpegArgs.join(' ')}`;
                    console.log('Running alternative FFmpeg command:', altCommand);
                    
                    const altFfmpeg = spawn('ffmpeg', altFfmpegArgs);
                    altFfmpeg.stderr.on('data', (data) => {
                        console.log(`ffmpeg (alt): ${data}`);
                    });
                    
                    altFfmpeg.on('close', (code) => {
                        if (code === 0) {
                            console.log(`✅ Captured video with alternative configuration: ${outVideoName}`);
                            resolve();
                        } else {
                            reject(new Error(`FFmpeg exited with code ${code} using alternative configuration`));
                        }
                    });
                }
            });

            ffmpeg.on('error', (err) => reject(err));

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Captured video: ${outVideoName}`);
                    resolve();
                } else if (!errorOutput.includes('Cannot allocate memory') && !errorOutput.includes('Invalid argument')) {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });
        });
    },

    /**
     * extractFrames: from the input MP4 => outDir/frame_%03d.jpg
     */
    extractFrames(inVideoName, outDir) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            } else {
                fs.readdirSync(outDir).forEach(f => fs.unlinkSync(path.join(outDir, f)));
            }

            const ffmpegArgs = [
                '-i', inVideoName,
                '-qscale:v', '2',
                path.join(outDir, 'frame_%03d.jpg')
            ];

            console.log(`Extracting frames from ${inVideoName} => ${outDir}`);
            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            ffmpeg.stderr.on('data', data => {
                console.log(`ffmpeg: ${data}`);
            });

            ffmpeg.on('error', err => reject(err));

            ffmpeg.on('close', code => {
                if (code === 0) {
                    console.log(`✅ Frames extracted to ${outDir}`);
                    resolve();
                } else {
                    reject(new Error(`FFmpeg error code ${code} extracting frames`));
                }
            });
        });
    },

    /**
     * encodeVideo: from frames => outVideoName
     */
    encodeVideo(framesDir, outVideoName) {
        return new Promise((resolve, reject) => {
            if (fs.existsSync(outVideoName)) {
                fs.unlinkSync(outVideoName);
            }

            const ffmpegArgs = [
                '-framerate', '30',
                '-i', path.join(framesDir, 'frame_%03d.jpg'),
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                outVideoName
            ];

            console.log(`Encoding frames in ${framesDir} => ${outVideoName}`);
            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            ffmpeg.stderr.on('data', data => {
                console.log(`ffmpeg: ${data}`);
            });

            ffmpeg.on('error', err => reject(err));

            ffmpeg.on('close', code => {
                if (code === 0) {
                    console.log(`✅ Encoded video => ${outVideoName}`);
                    resolve();
                } else {
                    reject(new Error(`FFmpeg error code ${code} in encodeVideo`));
                }
            });
        });
    }
};