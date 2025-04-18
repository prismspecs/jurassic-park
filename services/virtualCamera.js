const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

class VirtualCamera {
    constructor() {
        this.platform = os.platform();
        this.isLinux = this.platform === 'linux';
        this.isMac = this.platform === 'darwin';
        this.virtualDevice = this.isLinux ? '/dev/video10' : null;
        this.streamProcess = null;
    }

    async ensureDevice() {
        if (this.isLinux) {
            // Check if device exists
            if (!fs.existsSync(this.virtualDevice)) {
                throw new Error(`Virtual camera device ${this.virtualDevice} does not exist. Please load v4l2loopback module.`);
            }

            // Check device permissions
            try {
                fs.accessSync(this.virtualDevice, fs.constants.R_OK | fs.constants.W_OK);
            } catch (err) {
                throw new Error(`Insufficient permissions for ${this.virtualDevice}. Please ensure user is in the 'video' group.`);
            }

            // Set up the virtual device format
            try {
                await new Promise((resolve, reject) => {
                    const v4l2ctl = spawn('v4l2-ctl', [
                        '--device', this.virtualDevice,
                        '--set-fmt-video', 'width=640,height=480,pixelformat=YUYV'
                    ]);

                    v4l2ctl.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Failed to set device format: ${code}`));
                        }
                    });
                });
            } catch (err) {
                console.error('Error setting device format:', err);
            }
        }
    }

    async startStream(sourceDevice) {
        await this.ensureDevice();

        if (this.streamProcess) {
            await this.stopStream();
        }

        // First check if the source device exists and is readable
        if (this.isLinux && !fs.existsSync(sourceDevice)) {
            throw new Error(`Source device ${sourceDevice} does not exist`);
        }

        try {
            if (this.isLinux) {
                fs.accessSync(sourceDevice, fs.constants.R_OK);
            }
        } catch (err) {
            throw new Error(`Cannot read from source device ${sourceDevice}`);
        }

        let ffmpegArgs;
        if (this.isLinux) {
            ffmpegArgs = [
                '-f', 'v4l2',
                '-input_format', 'yuyv422',
                '-video_size', '640x480',
                '-i', sourceDevice,
                '-f', 'rawvideo',
                '-pix_fmt', 'yuyv422',
                '-video_size', '640x480',
                '-thread_queue_size', '512',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-strict', 'experimental',
                '-vsync', '0',
                '-f', 'v4l2',
                this.virtualDevice
            ];
        } else if (this.isMac) {
            // On macOS, we'll create a named pipe and stream to it
            const pipePath = path.join(os.tmpdir(), 'camera_pipe');
            try {
                if (fs.existsSync(pipePath)) {
                    fs.unlinkSync(pipePath);
                }
                fs.mkfifoSync(pipePath);
            } catch (err) {
                console.error('Error creating named pipe:', err);
            }

            ffmpegArgs = [
                '-f', 'avfoundation',
                '-framerate', '30',
                '-video_size', '1280x720',
                '-i', sourceDevice,
                '-f', 'mpegts',
                '-codec', 'copy',
                '-pix_fmt', 'yuv420p',
                pipePath
            ];
        }

        console.log('Starting virtual camera stream:', ffmpegArgs.join(' '));
        
        return new Promise((resolve, reject) => {
            this.streamProcess = spawn('ffmpeg', ffmpegArgs);

            let errorOutput = '';

            this.streamProcess.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`Virtual camera stream: ${output}`);
                errorOutput += output;
            });

            this.streamProcess.on('error', (err) => {
                console.error('Virtual camera stream error:', err);
                reject(err);
            });

            this.streamProcess.on('close', (code) => {
                console.log(`Virtual camera stream exited with code ${code}`);
                this.streamProcess = null;
                if (code !== 0) {
                    reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
                }
            });

            // Wait for stream to initialize
            setTimeout(() => {
                if (this.streamProcess) {
                    resolve();
                }
            }, 2000);
        });
    }

    async stopStream() {
        if (this.streamProcess) {
            this.streamProcess.kill('SIGTERM');
            this.streamProcess = null;
            // Wait a moment for the device to be released
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    getVirtualDevice() {
        if (this.isLinux) {
            return this.virtualDevice;
        } else if (this.isMac) {
            // On macOS, return the source device directly since we're not using a virtual device
            return this.streamProcess ? this.streamProcess.spawnargs[this.streamProcess.spawnargs.indexOf('-i') + 1] : null;
        }
        return null;
    }
}

module.exports = new VirtualCamera(); 