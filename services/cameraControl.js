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
                // First find all potential video devices
                const videoDevices = fs.readdirSync('/dev')
                    .filter(file => file.startsWith('video'));
                
                const mappedDevices = [];
                
                // Try to get more detailed information from sysfs
                for (const device of videoDevices) {
                    const devicePath = `/dev/${device}`;
                    const deviceNum = device.replace('video', '');
                    
                    // Try to read device name from sysfs
                    let cameraName = `Camera ${device}`;
                    try {
                        const sysfsPath = `/sys/class/video4linux/${device}/name`;
                        if (fs.existsSync(sysfsPath)) {
                            const nameData = fs.readFileSync(sysfsPath, 'utf8').trim();
                            if (nameData) {
                                cameraName = nameData;
                            }
                        }
                    } catch (err) {
                        // If we can't read the device name, stick with the default
                        console.log(`Couldn't read name for ${devicePath}`);
                    }
                    
                    mappedDevices.push({
                        path: devicePath,
                        name: `${cameraName} (${devicePath})`,
                        isMainDevice: parseInt(deviceNum) % 2 === 0 // Even numbered devices are typically main video
                    });
                }
                
                // Log found devices
                mappedDevices.forEach(device => {
                    console.log(`Found video device: ${device.name}`);
                });
                
                return mappedDevices;
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
                            name: name,
                            isMainDevice: true
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
            // Use the same devices we already found for cameras
            const videoDevices = await this.detectVideoDevices();
            const ptzDevices = [];
            
            // For each video device, check if it's likely to be a PTZ device
            // Use the device name as a hint (many PTZ cameras have recognizable names)
            for (const device of videoDevices) {
                if (
                    // Common PTZ camera models/brands
                    device.name.includes('OBSBOT') ||
                    device.name.includes('PTZ') ||
                    device.name.includes('Logitech') ||
                    device.name.includes('Pro Webcam C920') || // Many C920s support basic panning
                    device.name.includes('C615') ||
                    device.name.includes('Brio') ||
                    device.name.includes('RALLY') ||
                    device.name.includes('ConferenceCam') ||
                    device.name.includes('Meetup')
                ) {
                    ptzDevices.push({
                        path: device.path,
                        name: device.name
                    });
                }
            }
            
            // Always add at least the first video device as a potential PTZ device
            // if we couldn't detect any explicitly
            if (ptzDevices.length === 0 && videoDevices.length > 0) {
                const firstDevice = videoDevices.find(d => d.isMainDevice) || videoDevices[0];
                ptzDevices.push({
                    path: firstDevice.path,
                    name: `${firstDevice.name} (Potential PTZ)`
                });
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
                // Find the best device to use
                
                // First try to find a known webcam brand - they usually give the best results
                const knownWebcams = devices.filter(device => 
                    device.name.includes('HD Pro Webcam C920') || 
                    device.name.includes('Logitech') ||
                    device.name.includes('OBSBOT') ||
                    device.name.includes('Webcam')
                );
                
                // Next, look for main video devices (as opposed to metadata devices)
                const mainDevices = devices.filter(device => device.isMainDevice);
                
                // Select the best device, prioritizing known webcams that are main devices
                let selectedDevice;
                
                if (knownWebcams.length > 0 && knownWebcams.some(d => d.isMainDevice)) {
                    // Known webcam that's a main device - best option
                    selectedDevice = knownWebcams.find(d => d.isMainDevice);
                } else if (knownWebcams.length > 0) {
                    // Any known webcam
                    selectedDevice = knownWebcams[0];
                } else if (mainDevices.length > 0) {
                    // Any main device
                    selectedDevice = mainDevices[0];
                } else {
                    // Fall back to the first device
                    selectedDevice = devices[0];
                }
                
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
