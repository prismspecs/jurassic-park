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
                            // Use 'id' for consistency, value is the path
                            id: devicePath,
                            name: `${cameraName} (${devicePath})`
                        };
                    });

                console.log('Linux - Found video devices:', videoDevices);
                return videoDevices;
            } catch (err) {
                console.error('Error detecting video devices on Linux:', err);
                return [];
            }
        } else if (this.platform === 'darwin') {
            try {
                // Use system_profiler to get camera list and model names
                const stdout = await new Promise((resolve, reject) => {
                    // Using -json gives structured output, easier to parse
                    exec('system_profiler SPCameraDataType -json', (error, stdout, stderr) => {
                        if (error) {
                            // Fallback if -json fails or isn't supported?
                            console.warn("system_profiler -json failed, falling back to text parsing:", stderr);
                            exec('system_profiler SPCameraDataType', (fallBackError, fallBackStdout) => {
                                if (fallBackError) reject(fallBackError);
                                else resolve(fallBackStdout);
                            });
                            return;
                        }
                        resolve(stdout);
                    });
                });

                let devices = [];
                try {
                    // Attempt to parse JSON output
                    const profile = JSON.parse(stdout);
                    const cameraData = profile["SPCameraDataType"];
                    if (cameraData && Array.isArray(cameraData)) {
                        devices = cameraData.map((device, index) => ({
                            id: index,
                            name: device["_name"] || device["spcamera_model-id"] || `Unknown Camera ${index}`
                        }));
                    } else {
                        // Handle case where JSON structure is unexpected but doesn't throw error
                        console.warn("Parsed system_profiler JSON but SPCameraDataType format was unexpected. Falling back to text parsing.");
                        throw new Error("Unexpected JSON structure"); // Force fallback
                    }
                } catch (jsonError) {
                    console.warn("Failed to parse system_profiler JSON, attempting text parsing:", jsonError);

                    // Fallback: Simple text parsing based on common output format
                    try {
                        // Split by device blocks (often separated by blank lines or specific headers)
                        // This is fragile and depends on system_profiler output format
                        const deviceBlocks = stdout.split(/\n\s*\n|(?=^\s*[^\s:]+:$)/m); // Split on blank lines or lines starting with Name:
                        let deviceIndex = 0;
                        devices = [];
                        for (const block of deviceBlocks) {
                            if (!block.trim()) continue; // Skip empty blocks
                            // Look for Model ID or a general name line
                            const nameMatch = block.match(/Model ID:\s*(.*)/i) ||
                                block.match(/Camera:\s*(.*)/i) || // Another common format
                                block.match(/^\s*([^:]+):$/m); // First line might be the name

                            if (nameMatch && nameMatch[1] && nameMatch[1].trim()) {
                                const potentialName = nameMatch[1].trim();
                                // Basic filtering to avoid adding non-camera entries if possible
                                if (!potentialName.toLowerCase().includes("unknown") && block.toLowerCase().includes("camera")) {
                                    devices.push({ id: deviceIndex, name: potentialName });
                                    deviceIndex++;
                                }
                            }
                        }
                        // If still no devices found after parsing, log it
                        if (devices.length === 0) {
                            console.warn("Fallback text parsing did not find any camera devices.");
                        }
                    } catch (textParseError) {
                        console.error("Fallback text parsing also failed:", textParseError);
                        devices = []; // Ensure devices is an empty array on complete failure
                    }
                }

                console.log('macOS - Found video devices:', devices);
                return devices;

            } catch (err) {
                console.error('Error detecting video devices on macOS:', err);
                return [];
            }
        }
        console.warn(`Unsupported platform for device detection: ${this.platform} `);
        return [];
    }

    async scanPTZDevices() {
        // Simply return all video devices as potential PTZ devices
        return this.detectVideoDevices();
    }

    async addCamera(name, previewDevice = "", recordingDevice = "", ptzDevice = "") {
        if (!this.cameras.has(name)) {
            const camera = new Camera(name);
            this.cameras.set(name, camera);

            // Set up devices from defaults if provided
            if (previewDevice) {
                await camera.setPreviewDevice(previewDevice);
            }
            if (recordingDevice) {
                camera.setRecordingDevice(recordingDevice);
            }
            if (ptzDevice) {
                camera.setPTZDevice(ptzDevice);
            }

            console.log(`Added camera: ${name} with devices: `, {
                preview: previewDevice,
                recording: recordingDevice,
                ptz: ptzDevice
            });
            return true;
        }
        return false;
    }

    removeCamera(name) {
        const camera = this.cameras.get(name);
        if (camera) {
            camera.stopPreview();
            this.cameras.delete(name);
            console.log(`Removed camera: ${name} `);
            return true;
        }
        return false;
    }

    getCamera(name) {
        console.log(`[CameraControl] getCamera called for: ${name}`); // Log call
        const instance = this.cameras.get(name);
        console.log(`[CameraControl] getCamera returning instance:`, instance); // Log instance state
        return instance;
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
                            const cmd = `v4l2 - ctl--device = ${device} --set - ctrl=${control}=${value} `;
                            console.log(`Executing: ${cmd} `);
                            exec(cmd, (error, stdout, stderr) => {
                                if (error) {
                                    console.error(`Error setting ${control}: `, error.message);
                                }
                                resolve(true);
                            });
                        });
                    } catch (err) {
                        console.error(`Error executing PTZ command for ${control}: `, err);
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

    // Rename parameter for clarity, it holds the server-native ID now
    setRecordingDevice(cameraName, serverDeviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            // Store the server-native ID (path on Linux, index on Mac)
            camera.setRecordingDevice(serverDeviceId);
            console.log(`Set recording device for camera ${cameraName} to internal ID: `, serverDeviceId);
        } else {
            console.error(`Cannot set recording device: Camera ${cameraName} not found`);
        }
    }

    setPTZDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (camera) {
            // Only set the PTZ device, don't touch the other devices
            camera.setPTZDevice(deviceId);
            console.log(`Set PTZ device for camera ${cameraName} to: `, deviceId);
        } else {
            console.error(`Cannot set PTZ device: Camera ${cameraName} not found`);
        }
    }
}

// Export the class itself, not an instance
module.exports = CameraControl;
