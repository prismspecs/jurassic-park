const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os'); // Import os module
const sessionService = require('./sessionService'); // Added

module.exports = {
    /**
     * captureVideo: Records video using GStreamer
     * @param {string} outVideoName - Output video file path
     * @param {number} durationSec - Duration in seconds
     * @param {string|number} serverDeviceId - Camera device path (Linux) or index (macOS)
     * @param {object} [resolution={width: 1920, height: 1080}] - Optional resolution object
     * @returns {Promise} - Resolves when recording is complete
     */
    captureVideo(outVideoName, durationSec, serverDeviceId, resolution = { width: 1920, height: 1080 }) {
        return new Promise((resolve, reject) => {
            const platform = os.platform();
            let fullOutVideoName;

            try {
                const sessionDir = sessionService.getSessionDirectory();
                fullOutVideoName = path.join(sessionDir, outVideoName);
                // Ensure session dir exists
                if (!fs.existsSync(sessionDir)) {
                    fs.mkdirSync(sessionDir, { recursive: true });
                }
            } catch (error) {
                console.error("Error getting session directory for GStreamer capture:", error);
                return reject(error);
            }

            if (fs.existsSync(fullOutVideoName)) {
                fs.unlinkSync(fullOutVideoName);
            }

            const resWidth = (resolution && resolution.width) ? resolution.width : 1920;
            const resHeight = (resolution && resolution.height) ? resolution.height : 1080;

            let pipelineElements = [];
            let sourceElementName = '';

            // --- Platform specific pipeline construction ---
            if (platform === 'linux') {
                sourceElementName = 'v4l2src';
                if (typeof serverDeviceId !== 'string' || !serverDeviceId.startsWith('/dev/video')) {
                    return reject(new Error(`Invalid Linux device path provided to GStreamer: ${serverDeviceId}`));
                }
                pipelineElements = [
                    `${sourceElementName} device=${serverDeviceId}`,
                    '!',
                    // Request MJPEG at the specified resolution (Common for webcams)
                    `image/jpeg,width=${resWidth},height=${resHeight},framerate=30/1`,
                    '!',
                    'jpegdec',
                    '!',
                    'videoconvert',
                    '!',
                    'videorate',
                    '!',
                    'x264enc tune=zerolatency bitrate=8000 speed-preset=ultrafast key-int-max=30',
                    '!',
                    'mp4mux',
                    '!',
                    `filesink location=${fullOutVideoName}`
                ];
            } else if (platform === 'darwin') {
                sourceElementName = 'avfvideosrc';
                if (typeof serverDeviceId !== 'number') {
                    const potentialIndex = parseInt(serverDeviceId);
                    if (isNaN(potentialIndex)) {
                        return reject(new Error(`Invalid macOS device index provided to GStreamer: ${serverDeviceId}. Expected a number.`));
                    }
                    serverDeviceId = potentialIndex;
                }
                // Simplify pipeline for macOS: Remove strict caps after avfvideosrc
                // Let GStreamer negotiate the format with videoconvert.
                pipelineElements = [
                    `${sourceElementName} device-index=${serverDeviceId}`,
                    '!',
                    'videoconvert', // Convert pixel format if necessary
                    '!',
                    'videorate', // Ensure correct frame rate
                    '!',
                    'x264enc tune=zerolatency bitrate=8000 speed-preset=ultrafast key-int-max=30',
                    '!',
                    'mp4mux',
                    '!',
                    `filesink location=${fullOutVideoName}`
                ];
            } else {
                return reject(new Error(`Unsupported platform for GStreamer recording: ${platform}`));
            }
            // --- End Platform specific pipeline construction ---

            const pipelineString = pipelineElements.join(' ');

            console.log(`(${platform}) Starting GStreamer capture for ${durationSec} sec from ${sourceElementName} (ID: ${serverDeviceId}) => ${fullOutVideoName}`);
            console.log(`(${platform}) GStreamer pipeline: ${pipelineString}`);

            // Split carefully, considering potential spaces in paths/options if any were added
            const gstArgs = pipelineString.split(/\s+/).filter(arg => arg.length > 0);

            const gst = spawn('gst-launch-1.0', ['-e', ...gstArgs]);

            let errorOutput = '';
            gst.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`(${platform}) gstreamer stderr: ${output}`);
                errorOutput += output;
            });

            gst.stdout.on('data', (data) => {
                console.log(`(${platform}) gstreamer stdout: ${data.toString()}`);
            });

            gst.on('error', (err) => {
                console.error(`(${platform}) GStreamer spawn error:`, err);
                reject(err);
            });

            gst.on('close', (code) => {
                // Also check for specific error messages if code is non-zero
                if (errorOutput.toLowerCase().includes('error') || code !== 0) {
                    console.error(`(${platform}) GStreamer process exited with code ${code}.`);
                    reject(new Error(`GStreamer exited with code ${code}: ${errorOutput}`));
                } else {
                    console.log(`✅ (${platform}) Captured video with GStreamer: ${fullOutVideoName}`);
                    resolve();
                }
            });

            // Set a timeout to stop recording after durationSec
            setTimeout(() => {
                console.log(`(${platform}) Sending SIGINT to GStreamer process...`);
                gst.kill('SIGINT');
            }, durationSec * 1000);
        });
    }
}; 