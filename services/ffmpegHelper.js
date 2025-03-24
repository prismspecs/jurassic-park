/*******************************************************
 * ffmpegHelper.js
 *   - Captures 3s video from Mac's webcam (avfoundation)
 *   - Extract frames to a folder
 *   - Re-encode frames into mp4
 *******************************************************/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
    /**
     * captureVideo:
     *   -f avfoundation => Mac
     *   -framerate 30 => Force 30 fps
     *   -i "0:1" => default camera and microphone
     *   -t 3 => record 3 seconds
     *   -c:v libx264, -pix_fmt yuv420p => standard h264
     *   -c:a aac => audio codec
     *   -b:a 192k => audio bitrate
     */
    captureVideo(outVideoName, durationSec) {
        return new Promise((resolve, reject) => {
            if (fs.existsSync(outVideoName)) {
                fs.unlinkSync(outVideoName);
            }

            const ffmpegArgs = [
                '-f', 'avfoundation',
                '-framerate', '30',
                '-i', '0:1',  // 0 is video, 1 is audio
                '-t', durationSec.toString(),
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',  // Use AAC codec for audio
                '-b:a', '192k', // Set audio bitrate to 192k
                outVideoName
            ];

            console.log(`Starting FFmpeg capture for ${durationSec} sec => ${outVideoName}`);
            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            ffmpeg.stderr.on('data', (data) => {
                console.log(`ffmpeg: ${data}`);
            });

            ffmpeg.on('error', (err) => reject(err));

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Captured video with audio: ${outVideoName}`);
                    resolve();
                } else {
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