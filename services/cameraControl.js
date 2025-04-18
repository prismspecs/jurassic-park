const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const Camera = require('./camera');

class CameraControl {
    constructor() {
        this.platform = os.platform();
        this.cameras = new Map(); // Map of camera name to Camera instance
        this.uvcUtilPath = path.join(__dirname, '..', config.uvcDir, 'uvc-util');
        console.log('CameraControl initialized:', {
            platform: this.platform,
            ...(this.platform === 'darwin' && { uvcUtilPath: this.uvcUtilPath })
        });
    }

    async validateVideoDevice(devicePath) {
        if (this.platform === 'linux') {
            try {
                // Check if device exists and is readable
                await fs.promises.access(devicePath, fs.constants.R_OK);
                
                // Get device capabilities
                const stdout = await new Promise((resolve, reject) => {
                    exec(`v4l2-ctl --device=${devicePath} --list-formats`, (error, stdout) => {
                        if (error) reject(error);
                        else resolve(stdout);
                    });
                });

                if (!stdout.includes('Video Capture')) {
                    console.log(`Device ${devicePath} does not support video capture`);
                    return false;
                }

                // Check if device is already in use
                const lsof = await new Promise((resolve) => {
                    exec(`lsof ${devicePath}`, (error) => {
                        resolve(!error); // If no error, device is in use
                    });
                });

                if (lsof) {
                    console.log(`Device ${devicePath} is already in use`);
                    return false;
                }

                return true;
            } catch (err) {
                console.error(`Error validating device ${devicePath}:`, err);
                return false;
            }
        }
        return true; // Skip validation for non-Linux platforms
    }

    async detectVideoDevices() {
        if (this.platform === 'linux') {
            try {
                const videoDevices = fs.readdirSync('/dev')
                    .filter(file => file.startsWith('video'))
                    .map(device => ({
                        path: `/dev/${device}`,
                        name: `Camera ${device}`
                    }));

                // Validate each device
                const validDevices = [];
                for (const device of videoDevices) {
                    const isValid = await this.validateVideoDevice(device.path);
                    if (isValid) {
                        validDevices.push(device);
                        console.log(`Found valid video device: ${device.path}`);
                    }
                }
                return validDevices;
            } catch (err) {
                console.error('Error detecting video devices:', err);
                return [];
            }
        } else if (this.platform === 'darwin') {
            // For macOS, we'll use the system_profiler command
            try {
                const stdout = await new Promise((resolve, reject) => {
                    exec('system_profiler SPCameraDataType', (error, stdout) => {
                        if (error) reject(error);
                        else resolve(stdout);
                    });
                });
                
                const devices = [];
                const lines = stdout.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('Camera:')) {
                        const name = lines[i].split('Camera:')[1].trim();
                        devices.push({
                            path: `0:${devices.length}`, // macOS uses index-based device IDs
                            name: name
                        });
                    }
                }
                return devices;
            } catch (err) {
                console.error('Error detecting video devices on macOS:', err);
                return [];
            }
        }
        return [];
    }

    async scanPTZDevices() {
        if (this.platform !== 'linux') {
            return [];
        }

        try {
            const videoDevices = fs.readdirSync('/dev')
                .filter(file => file.startsWith('video'));

            const ptzDevices = [];
            for (const device of videoDevices) {
                const devicePath = `/dev/${device}`;
                try {
                    const stdout = await new Promise((resolve, reject) => {
                        exec(`v4l2-ctl --device=${devicePath} --all`, (error, stdout) => {
                            if (error) reject(error);
                            else resolve(stdout);
                        });
                    });

                    if (stdout.includes('pan_absolute') || 
                        stdout.includes('tilt_absolute') || 
                        stdout.includes('zoom_absolute')) {
                        ptzDevices.push({
                            path: devicePath,
                            name: `PTZ Camera ${device}`
                        });
                    }
                } catch (err) {
                    console.log(`Device ${devicePath} is not accessible or not a camera`);
                }
            }
            return ptzDevices;
        } catch (err) {
            console.error('Error scanning for PTZ devices:', err);
            return [];
        }
    }

    async addCamera(name) {
        if (!this.cameras.has(name)) {
            const camera = new Camera(name);
            this.cameras.set(name, camera);
            
            // Detect and set up available devices
            const devices = await this.detectVideoDevices();
            console.log('Detected video devices:', devices);
            
            if (devices.length > 0) {
                // Use the first available device for both preview and recording
                const device = devices[0];
                const isValid = await this.validateVideoDevice(device.path);
                
                if (isValid) {
                    camera.setPreviewDevice(device.path);
                    camera.setRecordingDevice(device.path);
                    console.log(`Set up camera ${name} with device:`, device);
                } else {
                    console.error(`Device ${device.path} is not valid for camera ${name}`);
                }
            } else {
                console.error('No valid video devices found for camera:', name);
            }
            
            console.log(`Added camera: ${name}`);
            return true;
        }
        return false;
    }

    removeCamera(name) {
        const camera = this.cameras.get(name);
        if (camera) {
            camera.stopPreview();
            this.cameras.delete(name);
            console.log(`Removed camera: ${name}`);
            return true;
        }
        return false;
    }

    getCamera(name) {
        return this.cameras.get(name);
    }

    getCameras() {
        return Array.from(this.cameras.values()).map(camera => ({
            name: camera.name,
            previewDevice: camera.getPreviewDevice(),
            recordingDevice: camera.getRecordingDevice(),
            ptzDevice: camera.getPTZDevice()
        }));
    }

    async setPTZ(cameraName, { pan = null, tilt = null, zoom = null }) {
        const camera = this.getCamera(cameraName);
        if (!camera) {
            console.log('No camera found with name:', cameraName);
            return;
        }

        const device = camera.getPTZDevice();
        if (!device) {
            console.log('No PTZ device configured for camera:', cameraName);
            return;
        }

        console.log('Setting PTZ for device:', device);

        try {
            if (this.platform === 'linux') {
                if (pan !== null) {
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=pan_absolute=${pan === 0 ? 3600 : pan}`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }
                if (tilt !== null) {
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=tilt_absolute=${tilt === 0 ? 3600 : tilt}`;
                    console.log('Executing tilt command:', cmd);
                    exec(cmd, (error, stdout, stderr) => {
                        if (error) {
                            console.error('Tilt command error:', error);
                        }
                        if (stderr) {
                            console.error('Tilt command stderr:', stderr);
                        }
                        if (stdout) {
                            console.log('Tilt command stdout:', stdout);
                        }
                    });
                }
                if (zoom !== null) {
                    const cmd = `v4l2-ctl --device=${device} --set-ctrl=zoom_absolute=${zoom}`;
                    console.log('Executing:', cmd);
                    exec(cmd);
                }
            }
        } catch (err) {
            console.error('Error setting PTZ:', err);
        }
    }

    setPreviewDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            camera.setPreviewDevice(deviceId);
        }
    }

    setRecordingDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            camera.setRecordingDevice(deviceId);
        }
    }

    setPTZDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            camera.setPTZDevice(deviceId);
        }
    }
}

module.exports = new CameraControl();
