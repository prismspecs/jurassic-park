const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const Camera = require('./camera');

// PLEASE UPDATE THIS PATTERN to match the name of your actual PTZ camera
// as reported by 'system_profiler SPCameraDataType'
// For example, if your camera is "Logitech PTZ Pro 2", you might use /Logitech PTZ Pro 2/i
// const ACTUAL_PTZ_CAMERA_NAME_PATTERN = /PLEASE_UPDATE_THIS_PATTERN/i;

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
        this.detectedServerDevices = null; // Cache for detected devices
        this.detectingDevicesPromise = null; // To prevent concurrent detection
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
        // Prevent concurrent executions
        if (this.detectingDevicesPromise) {
            return this.detectingDevicesPromise;
        }
        // Return cached result if available
        // if (this.detectedServerDevices) {
        //     console.log('Returning cached server devices:', this.detectedServerDevices);
        //     return this.detectedServerDevices;
        // }

        console.log('[CameraControl] Detecting server video devices...');
        this.detectingDevicesPromise = this._internalDetectVideoDevices();
        try {
            this.detectedServerDevices = await this.detectingDevicesPromise;
            console.log('[CameraControl] Finished detecting server video devices.');
            return this.detectedServerDevices;
        } finally {
            this.detectingDevicesPromise = null; // Clear promise after completion
        }
    }

    async _internalDetectVideoDevices() { // Renamed original function
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

    async addCamera(name, previewDeviceName = "", recordingDeviceName = "", ptzDeviceName = "") {
        if (this.cameras.has(name)) {
            console.warn(`[CameraControl Add] Camera ${name} already exists.`);
            return false; // Indicate camera already exists
        }

        // --- Ensure server devices are detected before proceeding ---
        if (!this.detectedServerDevices) {
            console.log('[CameraControl Add] Server devices not yet detected, calling detectVideoDevices...');
            await this.detectVideoDevices(); // Await detection if not already done
        }
        const serverDevices = this.detectedServerDevices || [];
        console.log('[CameraControl Add] Using detected server devices: ', serverDevices);
        // -----------------------------------------------------------

        const camera = new Camera(name);
        this.cameras.set(name, camera);
        console.log(`[CameraControl Add] Created Camera instance for ${name}.`);

        // Helper to find server device ID by name
        const findDeviceIdByName = (deviceName) => {
            if (!deviceName) return null;
            const device = serverDevices.find(d => d.name === deviceName);
            if (device) {
                console.log(`[CameraControl Add] Found device ID ${device.id} for name '${deviceName}'`);
                return device.id; // Return the numerical ID (or path for Linux)
            } else {
                console.warn(`[CameraControl Add] Could not find server device matching name: '${deviceName}'`);
                return null;
            }
        };

        // Set devices using their detected IDs
        const previewDeviceId = findDeviceIdByName(previewDeviceName);
        if (previewDeviceId !== null) {
            console.log(`[CameraControl Add] Calling camera.setPreviewDevice(${previewDeviceId}) for ${name}.`);
            // Use await only if setPreviewDevice is async (it's not currently)
            camera.setPreviewDevice(previewDeviceId); // Pass numerical ID
        }

        const recordingDeviceId = findDeviceIdByName(recordingDeviceName);
        if (recordingDeviceId !== null) {
            console.log(`[CameraControl Add] Calling camera.setRecordingDevice(${recordingDeviceId}) for ${name}.`);
            camera.setRecordingDevice(recordingDeviceId); // Pass numerical ID or path
        }

        const ptzDeviceId = findDeviceIdByName(ptzDeviceName);
        if (ptzDeviceId !== null) {
            console.log(`[CameraControl Add] Calling camera.setPTZDevice(${ptzDeviceId}) for ${name}.`);
            camera.setPTZDevice(ptzDeviceId); // Pass numerical ID or path
        }

        console.log(`Added camera: ${name} with resolved device IDs: `, {
            preview: previewDeviceId,      // Log the ID used
            recording: recordingDeviceId,  // Log the ID used
            ptz: ptzDeviceId           // Log the ID used
        });
        return true;
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
            ptzDevice: camera.getPTZDevice(),
            showSkeleton: camera.getShowSkeleton() // Include skeleton state
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
                            const cmd = `v4l2-ctl --device ${device} --set-ctrl ${control}=${value}`;
                            console.log(`Executing: ${cmd}`);
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
            } else if (this.platform === 'darwin') {
                // Use uvc-util for macOS

                const executeUVCCommand = (command) => {
                    console.log(`[macOS PTZ] Executing: ${command}`);
                    return new Promise((resolve, reject) => {
                        exec(command, (error, stdout, stderr) => {
                            if (error) {
                                console.error(`[macOS PTZ Error] Command failed: ${command}`, error);
                                console.error(`[macOS PTZ Error] stderr: ${stderr}`);
                                reject(error);
                            } else {
                                console.log(`[macOS PTZ Success] stdout: ${stdout}`);
                                resolve(stdout);
                            }
                        });
                    });
                };

                // VV NEW LOGIC TO DETERMINE THE CORRECT uvc-util DEVICE INDEX VV
                let uvcDeviceIndexToUse;
                const systemProfilerDeviceId = typeof device === 'string' ? parseInt(device, 10) : device; // Ensure it's a number

                const allDetectedDevices = await this.detectVideoDevices(); // Always get fresh list
                const selectedDeviceForPtz = allDetectedDevices.find(d => d.id === systemProfilerDeviceId);

                if (selectedDeviceForPtz) {
                    // uvcDeviceIndexToUse = 0; // Always use uvc-util index 0 for macOS PTZ operations
                    uvcDeviceIndexToUse = systemProfilerDeviceId; // Use the ID from system_profiler directly
                    console.log(`[macOS PTZ] User selected device '${selectedDeviceForPtz.name}' (System Profiler ID: ${systemProfilerDeviceId}).`);
                    console.log(`[macOS PTZ] Attempting to use this ID directly as uvc-util device index: -I ${uvcDeviceIndexToUse}`);
                    // The ACTUAL_PTZ_CAMERA_NAME_PATTERN check is less critical if names are identical or if uvc-util only sees one PTZ cam at index 0.
                    // It can be retained for specific logging if desired, but the core logic is to use uvcDeviceIndexToUse = 0.
                    // if (String(ACTUAL_PTZ_CAMERA_NAME_PATTERN) !== String(/PLEASE_UPDATE_THIS_PATTERN/i) && !ACTUAL_PTZ_CAMERA_NAME_PATTERN.test(selectedDeviceForPtz.name)) {
                    //      console.warn(`[macOS PTZ] Note: The selected device '${selectedDeviceForPtz.name}' does not match the configured ACTUAL_PTZ_CAMERA_NAME_PATTERN. PTZ commands will still target uvc-util index 0.`);
                    // }
                } else {
                    console.error(`[macOS PTZ Error] Could not find details for the UI-selected PTZ device (System Profiler ID: ${systemProfilerDeviceId}) in the list of currently detected video devices.`);
                    console.error(`[macOS PTZ Error] This means no PTZ command will be sent.`);
                    console.error(`[macOS PTZ Debug] System Profiler ID used for lookup: ${systemProfilerDeviceId} (type: ${typeof systemProfilerDeviceId})`);
                    console.error(`[macOS PTZ Debug] List of devices detected by system_profiler at this moment:`, JSON.stringify(allDetectedDevices, null, 2));
                    return; // Cannot proceed
                }
                // ^^ END OF NEW LOGIC ^^

                const cameraInstance = this.getCamera(cameraName); // Get the specific camera instance

                if (!cameraInstance) {
                    console.error(`[macOS PTZ Error] Could not find camera instance for ${cameraName} to get/set cached state.`);
                    return; // Cannot proceed without the instance
                }

                // Determine values to send, using cache as fallback
                const currentPan = cameraInstance.getCurrentPan();
                const currentTilt = cameraInstance.getCurrentTilt();

                const panToSend = pan !== null ? pan : currentPan;
                const tiltToSend = tilt !== null ? tilt : currentTilt;

                // Pan/Tilt command - always send both components
                if (pan !== null || tilt !== null) { // Only send if at least one changed
                    // Use -s and add quotes around the value, matching user's working CLI command
                    const cmd = `${this.uvcUtilPath} -I ${uvcDeviceIndexToUse} -s pan-tilt-abs="{${panToSend},${tiltToSend}}"`;
                    try {
                        await executeUVCCommand(cmd);
                        // Update cache on success
                        if (pan !== null) cameraInstance.setCurrentPan(panToSend);
                        if (tilt !== null) cameraInstance.setCurrentTilt(tiltToSend);
                    } catch (ptError) {
                        console.error(`[macOS PTZ Error] Failed to set pan/tilt. Error: ${ptError.message}`);
                        // Avoid updating cache if command failed
                    }
                }

                // Separate Zoom command (assuming control name 'zoom-abs')
                if (zoom !== null) {
                    // Also use -s and add quotes for zoom value
                    const cmd = `${this.uvcUtilPath} -I ${uvcDeviceIndexToUse} -s zoom-abs="${zoom}"`; // Guessed control name
                    try {
                        await executeUVCCommand(cmd);
                        // Note: Zoom caching not implemented yet
                    } catch (zoomError) {
                        console.error(`[macOS PTZ Error] Failed to set zoom. Error: ${zoomError.message}`);
                    }
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
            camera.setPTZDevice(deviceId); // deviceId here is the system_profiler index
            console.log(`Set PTZ device target for camera ${cameraName} to system_profiler device ID: `, deviceId);
        } else {
            console.error(`Cannot set PTZ device target: Camera ${cameraName} not found`);
        }
    }

    /**
     * Resets all configured PTZ cameras to their defined home position.
     * Currently assumes home is Pan=0, Tilt=0, Zoom=0.
     * Iterates through all managed cameras and sends the command if a PTZ device is set.
     */
    async resetPTZHome() {
        console.log("Resetting all PTZ cameras to home position...");
        for (const camera of this.cameras.values()) {
            if (camera.getPTZDevice()) {
                console.log(`Resetting PTZ for camera: ${camera.name}`);
                try {
                    // Assuming home is 0, 0, 0 for pan, tilt, zoom
                    // Adjust if specific cameras have different home positions
                    await this.setPTZ(camera.name, { pan: 0, tilt: 0, zoom: 0 });
                } catch (error) {
                    console.error(`Failed to reset PTZ for camera ${camera.name}:`, error);
                }
            } else {
                console.log(`Skipping PTZ reset for camera ${camera.name}: No PTZ device configured.`);
            }
        }
        console.log("Finished resetting PTZ cameras.");
    }
}

// Export the class itself, not an instance
module.exports = CameraControl;
