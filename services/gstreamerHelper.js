const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os'); // Import os module
const sessionService = require('./sessionService'); // Added

module.exports = {
    /**
     * captureVideo: Records video using GStreamer
     * @param {string} outVideoName - Relative path within session/camera dir
     * @param {number} durationSec - Duration in seconds
     * @param {string|number} serverDeviceId - Camera device path (Linux) or index (macOS)
     * @param {object} [resolution={width: 1920, height: 1080}] - Optional resolution object
     * @param {string} [baseSessionDir] - Optional: Absolute path to the session dir (for workers)
     * @returns {Promise} - Resolves when recording is complete
     */
    captureVideo(outVideoName, durationSec, serverDeviceId, resolution = { width: 1920, height: 1080 }, baseSessionDir = null) {
        return new Promise((resolve, reject) => {
            const platform = os.platform();
            let fullOutVideoName;

            try {
                const sessionDir = baseSessionDir || sessionService.getSessionDirectory();
                fullOutVideoName = path.join(sessionDir, outVideoName);
                 // Ensure the full output directory exists (including camera sub-dir)
                const outputDir = path.dirname(fullOutVideoName);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                    console.log(`[gstreamerHelper] Created output directory: ${outputDir}`);
                }
            } catch (error) {
                console.error("Error determining GStreamer output path:", error);
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
                // Add capsfilter for resolution
                const caps = `video/x-raw,width=${resWidth},height=${resHeight}`; 
                pipelineElements = [
                    `${sourceElementName} device=${serverDeviceId}`,
                    '!',
                    'queue',
                    '!',
                    'jpegdec',
                    '!',
                    'videoconvert',
                    '!',
                    'videoscale method=bilinear',
                    '!',
                    caps,
                    '!',
                    'videorate',
                    '!',
                    'queue',
                    '!',
                    'x264enc tune=zerolatency bitrate=8000 speed-preset=ultrafast key-int-max=60',
                    '!',
                    'queue',
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
                // Add capsfilter for resolution
                const caps = `video/x-raw,width=${resWidth},height=${resHeight}`; 
                pipelineElements = [
                    `${sourceElementName} device-index=${serverDeviceId}`,
                    '!',
                    'queue',
                    '!',
                    'videoconvert',
                    '!',
                    'videoscale method=bilinear',
                    '!',
                    caps,
                    '!',
                    'videorate',
                    '!',
                    'queue',
                    '!',
                    'x264enc tune=zerolatency bitrate=8000 speed-preset=ultrafast key-int-max=60',
                    '!',
                    'queue',
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

            // Split carefully, considering potential spaces in paths/options if any were added (shouldn't be now)
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