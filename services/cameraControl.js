const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

class CameraControl {
    constructor() {
        this.platform = os.platform();
        this.cameras = {};
        this.currentCamera = null;
        this.uvcUtilPath = path.join(__dirname, '..', config.uvcDir, 'uvc-util');
        console.log('CameraControl initialized:', {
            platform: this.platform,
            ...(this.platform === 'darwin' && { uvcUtilPath: this.uvcUtilPath })
        });

    }

    initCameras() {
        console.log('Initializing cameras...');
        return this.scanForCameras();
    }

    async scanForCameras() {
        console.log('Starting camera scan...');
        try {
            if (this.platform === 'darwin') {
                console.log('Scanning cameras on macOS...');
                // First get the UVC device list
                return new Promise((resolve, reject) => {
                    console.log('Running uvc-util --list-devices...');
                    exec(`${this.uvcUtilPath} --list-devices`, (error, stdout) => {
                        if (error) {
                            console.error('Error running uvc-util --list-devices:', error);
                            resolve(this.cameras);
                            return;
                        }

                        console.log('uvc-util --list-devices output:', stdout);
                        // Parse the device list to get UVC IDs and names
                        const lines = stdout.split('\n');
                        let foundHeader = false;

                        lines.forEach(line => {
                            // Skip empty lines and separator lines
                            if (!line.trim() || line.startsWith('--')) {
                                return;
                            }

                            // Skip the header line
                            if (line.includes('Index') && line.includes('Device name')) {
                                foundHeader = true;
                                return;
                            }

                            // Only process lines after we've found the header
                            if (foundHeader) {
                                // Split the line by whitespace and get the index and name
                                const parts = line.trim().split(/\s+/);
                                if (parts.length >= 5) {
                                    const deviceId = parts[0];
                                    // Join all parts after the first 4 columns to get the full name
                                    const cameraName = parts.slice(4).join(' ').trim();
                                    this.cameras[cameraName] = deviceId;
                                    console.log('Found UVC camera:', cameraName, 'with device ID:', deviceId);
                                }
                            }
                        });

                        console.log('Final camera list:', this.cameras);
                        resolve(this.cameras);
                    });
                });
            } else if (this.platform === 'linux') {
                // On Linux, check /dev/video* devices
                const videoDevices = fs.readdirSync('/dev')
                    .filter(file => file.startsWith('video'));

                const promises = videoDevices.map(device => {
                    const devicePath = `/dev/${device}`;
                    return new Promise((resolve) => {
                        exec(`v4l2-ctl --device=${devicePath} --all`, (error, stdout) => {
                            if (!error) {
                                const nameMatch = stdout.match(/Card type\s*:\s*(.*)/);
                                if (nameMatch) {
                                    const cameraName = nameMatch[1].trim();
                                    this.cameras[cameraName] = devicePath;
                                }
                            }
                            resolve();
                        });
                    });
                });

                await Promise.all(promises);
                return this.cameras;
            }
        } catch (err) {
            console.error('Error scanning for cameras:', err);
            return this.cameras;
        }
    }

    setCamera(deviceName) {
        if (this.cameras[deviceName]) {
            this.currentCamera = deviceName;
            console.log(`Selected camera: ${deviceName} (${this.cameras[deviceName]})`);
            return true;
        }
        return false;
    }

    setPTZ({ pan = null, tilt = null, zoom = null }) {
        if (!this.currentCamera || !this.cameras[this.currentCamera]) {
            console.log('No camera selected for PTZ control');
            return;
        }

        const device = this.cameras[this.currentCamera];
        console.log('Setting PTZ for device:', device);

        try {
            if (this.platform === 'linux') {
                // Linux: use v4l2-ctl with absolute values
                if (pan !== null) {
                    // there is a strange bug where pan:0 puts the camera in a weird position
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=pan_absolute=${pan === 0 ? 3600 : pan}`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }
                if (tilt !== null) {
                    // same bug as pan
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=tilt_absolute=${tilt === 0 ? 3600 : tilt}`;
                    //console.log('Executing:', cmd);
                    exec(cmd);
                }
                if (zoom !== null) {
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=zoom_absolute=${zoom}`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }
            } else if (this.platform === 'darwin') {
                // macOS: use uvc-util with the correct command format
                if (pan !== null || tilt !== null) {
                    // Use exact values but ensure they're rounded to the step value of 3600
                    const roundedPan = pan !== null ? Math.round(pan / 3600) * 3600 : 0;
                    const roundedTilt = tilt !== null ? Math.round(tilt / 3600) * 3600 : 0;

                    const cmd = `${this.uvcUtilPath} -I ${device} -s pan-tilt-abs="{${roundedPan},${roundedTilt}}"`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }

                if (zoom !== null) {
                    // Round zoom to nearest integer (step = 1)
                    const roundedZoom = Math.round(zoom);
                    const cmd = `${this.uvcUtilPath} -I ${device} -s zoom-abs=${roundedZoom}`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }
            }
        } catch (err) {
            console.error('Camera control error:', err);
            throw err;
        }
    }

    getCameras() {
        console.log('Getting camera list:', this.cameras);
        return Object.keys(this.cameras);
    }

    getCurrentCamera() {
        return this.currentCamera;
    }

    getDevicePath(camera) {
        return this.cameras[camera];
    }

    isPTZSupported() {
        return this.platform === 'linux' || this.platform === 'darwin';
    }
}

module.exports = new CameraControl();
