const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
    /**
     * captureVideo: Records video using GStreamer
     * @param {string} outVideoName - Output video file path
     * @param {number} durationSec - Duration in seconds
     * @param {string} devicePath - Camera device path
     * @param {object} [resolution={width: 1920, height: 1080}] - Optional resolution object
     * @returns {Promise} - Resolves when recording is complete
     */
    captureVideo(outVideoName, durationSec, devicePath, resolution = { width: 1920, height: 1080 }) {
        return new Promise((resolve, reject) => {
            if (fs.existsSync(outVideoName)) {
                fs.unlinkSync(outVideoName);
            }

            // Ensure resolution has valid defaults if partially provided or invalid
            const resWidth = (resolution && resolution.width) ? resolution.width : 1920;
            const resHeight = (resolution && resolution.height) ? resolution.height : 1080;

            // Build the GStreamer pipeline using the provided resolution
            const pipeline = [
                'v4l2src',
                `device=${devicePath}`,
                '!',
                // Request MJPEG at the specified resolution
                `image/jpeg,width=${resWidth},height=${resHeight},framerate=30/1`,
                '!',
                'jpegdec', // Decode the JPEG stream
                '!',
                'videoconvert',
                '!',
                'videorate',
                '!',
                'x264enc',
                'tune=zerolatency',
                'bitrate=8000',
                'speed-preset=ultrafast',
                'key-int-max=30',
                '!',
                'mp4mux',
                '!',
                `filesink location=${outVideoName}`
            ].join(' ');

            console.log(`Starting GStreamer capture for ${durationSec} sec from ${devicePath} => ${outVideoName}`);
            console.log(`GStreamer pipeline: ${pipeline}`);

            const gst = spawn('gst-launch-1.0', ['-e', ...pipeline.split(' ')]);

            let errorOutput = '';
            gst.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`gstreamer: ${output}`);
                errorOutput += output;
            });

            gst.on('error', (err) => {
                console.error('GStreamer error:', err);
                reject(err);
            });

            gst.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Captured video with GStreamer: ${outVideoName}`);
                    resolve();
                } else {
                    reject(new Error(`GStreamer exited with code ${code}: ${errorOutput}`));
                }
            });

            // Set a timeout to stop recording after durationSec
            setTimeout(() => {
                gst.kill('SIGINT');
            }, durationSec * 1000);
        });
    }
}; 