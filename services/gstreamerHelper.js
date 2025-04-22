const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
    /**
     * captureVideo: Records video using GStreamer
     * @param {string} outVideoName - Output video file path
     * @param {number} durationSec - Duration in seconds
     * @param {string} devicePath - Camera device path
     * @returns {Promise} - Resolves when recording is complete
     */
    captureVideo(outVideoName, durationSec, devicePath) {
        return new Promise((resolve, reject) => {
            if (fs.existsSync(outVideoName)) {
                fs.unlinkSync(outVideoName);
            }

            // Build the GStreamer pipeline with improved settings
            const pipeline = [
                'v4l2src',
                `device=${devicePath}`,
                '!',
                'video/x-raw,format=I420,width=3840,height=2160,framerate=30/1',
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