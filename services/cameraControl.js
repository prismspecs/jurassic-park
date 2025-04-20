const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const Camera = require('./camera');

class CameraControl {
    constructor() {
        if (CameraControl.instance) {
            return CameraControl.instance;
        }
        CameraControl.instance = this;
        
        this.platform = os.platform();
        this.cameras = new Map(); // Map of camera name to Camera instance
        this.uvcUtilPath = path.join(__dirname, '..', config.uvcDir, 'uvc-util');
        console.log('CameraControl initialized:', {
            platform: this.platform,
            ...(this.platform === 'darwin' && { uvcUtilPath: this.uvcUtilPath })
        });
    }

    static getInstance() {
        if (!CameraControl.instance) {
            new CameraControl();
        }
        return CameraControl.instance;
    }

    async validateVideoDevice(devicePath) {
        // Simply return true to skip validation
        // This avoids any potential device locking issues
        return true;
    }

    async detectVideoDevices() {
        if (this.platform === 'linux') {
            try {
                const videoDevices = fs.readdirSync('/dev')
                    .filter(file => file.startsWith('video'))
                    .map(device => {
                        const devicePath = `/dev/${device}`;
                        let cameraName = `Camera ${device}`;
                        
                        // Try to get device name from sysfs if available
                        const sysfsPath = `/sys/class/video4linux/${device}/name`;
                        if (fs.existsSync(sysfsPath)) {
                            try {
                                const nameData = fs.readFileSync(sysfsPath, 'utf8').trim();
                                if (nameData) {
                                    cameraName = nameData;
                                }
                            } catch (err) {
                                console.log(`Couldn't read name for ${devicePath}`);
                            }
                        }
                        
                        return {
                            path: devicePath,
                            name: `${cameraName} (${devicePath})`
                        };
                    });
                
                console.log('Found video devices:', videoDevices);
                return videoDevices;
            } catch (err) {
                console.error('Error detecting video devices:', err);
                return [];
            }
        } else if (this.platform === 'darwin') {
            try {
                const stdout = await new Promise((resolve, reject) => {
                    exec('system_profiler SPCameraDataType', (error, stdout) => {
                        if (error) reject(error);
                        else resolve(stdout);
                    });
                });
                
                return stdout.split('\n')
                    .filter(line => line.includes('Camera:'))
                    .map((line, index) => ({
                        path: `0:${index}`,
                        name: line.split('Camera:')[1].trim()
                    }));
            } catch (err) {
                console.error('Error detecting video devices on macOS:', err);
                return [];
            }
        }
        return [];
    }

    async scanPTZDevices() {
        // Simply return all video devices as potential PTZ devices
        return this.detectVideoDevices();
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
                const selectedDevice = devices[0];
                camera.setPreviewDevice(selectedDevice.path);
                camera.setRecordingDevice(selectedDevice.path);
                console.log(`Set up camera ${name} with device:`, selectedDevice);
            } else {
                console.error('No video devices found for camera:', name);
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
                // Use more robust error handling for v4l2-ctl commands
                const setPTZControl = async (control, value) => {
                    try {
                        return new Promise((resolve) => {
                            const cmd = `v4l2-ctl --device=${device} --set-ctrl=${control}=${value}`;
                            console.log(`Executing: ${cmd}`);
                            exec(cmd, (error, stdout, stderr) => {
                                if (error) {
                                    console.error(`Error setting ${control}:`, error.message);
                                }
                                resolve(true);
                            });
                        });
                    } catch (err) {
                        console.error(`Error executing PTZ command for ${control}:`, err);
                        return false;
                    }
                };

                // Execute each control separately with error handling
                if (pan !== null) {
                    const panValue = pan === 0 ? 3600 : pan;
                    await setPTZControl('pan_absolute', panValue);
                }
                
                if (tilt !== null) {
                    const tiltValue = tilt === 0 ? 3600 : tilt;
                    await setPTZControl('tilt_absolute', tiltValue);
                }
                
                if (zoom !== null) {
                    await setPTZControl('zoom_absolute', zoom);
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

    setRecordingDevice(cameraName, devicePath) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            camera.setRecordingDevice(devicePath);
            console.log(`Set recording device for camera ${cameraName} to:`, devicePath);
        } else {
            console.error(`Cannot set recording device: Camera ${cameraName} not found`);
        }
    }

    setPTZDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            // Only set the PTZ device, don't touch the other devices
            camera.setPTZDevice(deviceId);
            console.log(`Set PTZ device for camera ${cameraName} to:`, deviceId);
        } else {
            console.error(`Cannot set PTZ device: Camera ${cameraName} not found`);
        }
    }
}

// Export the class itself, not an instance
module.exports = CameraControl;
