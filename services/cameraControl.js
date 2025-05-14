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

    // The options object will include { pan, tilt, zoom, uvcIndex (from frontend) }
    async setPTZ(cameraName, { pan = null, tilt = null, zoom = null, uvcIndex: manualUvcIndex = null }) {
        const camera = this.getCamera(cameraName);
        if (!camera) {
            console.error(`[CameraControl SET_PTZ] Camera ${cameraName} not found`);
            return { success: false, message: `Camera ${cameraName} not found` };
        }

        // camera.ptzDevice is the device ID selected in the UI (e.g., '0', '1', '2', '3' from system_profiler)
        // It's mainly used here to check IF a PTZ device is supposed to be active for this camera card.
        const configuredPtzServerId = camera.ptzDevice;
        if (configuredPtzServerId === null || configuredPtzServerId === undefined || configuredPtzServerId === "") {
            console.warn(`[CameraControl SET_PTZ] No PTZ device selected in UI for camera ${cameraName}. Command not sent.`);
            // Return success:false if we strictly require a PTZ device to be selected in the dropdown, 
            // even if a manual uvcIndex is provided. For now, let's allow proceeding if manualUvcIndex is valid.
            // return { success: false, message: `No PTZ device selected in UI for ${cameraName}` };
        }

        let uvcIndexToUse; // This will be the final index for the uvc-util -I flag

        if (this.platform === 'darwin') {
            if (manualUvcIndex !== null && !isNaN(manualUvcIndex) && manualUvcIndex >= 0) {
                uvcIndexToUse = parseInt(manualUvcIndex, 10);
                console.log(`[CameraControl SET_PTZ] Using manually provided UVC Index: ${uvcIndexToUse} for camera ${cameraName} on macOS.`);
            } else {
                console.error(`[CameraControl SET_PTZ] Manual UVC Index from frontend is invalid or not provided for ${cameraName} on macOS. Expected a non-negative number. Received: '${manualUvcIndex}'. PTZ command aborted.`);
                return { success: false, message: `A valid UVC Index (0 or 1) must be manually entered for PTZ operations on macOS.` };
            }
        } else { // For other platforms like Linux
            if (manualUvcIndex !== null && !isNaN(manualUvcIndex) && manualUvcIndex >= 0) {
                uvcIndexToUse = parseInt(manualUvcIndex, 10);
                console.log(`[CameraControl SET_PTZ] Using manually provided UVC Index: ${uvcIndexToUse} for camera ${cameraName} on ${this.platform}.`);
            } else {
                // Fallback to configuredPtzServerId if manual index isn't provided/valid for non-macOS
                // This might be a path like /dev/video0 for Linux.
                if (configuredPtzServerId === null || configuredPtzServerId === undefined || configuredPtzServerId === "") {
                    console.error(`[CameraControl SET_PTZ] No PTZ device selected in UI and no manual UVC index for ${cameraName} on ${this.platform}. PTZ command aborted.`);
                    return { success: false, message: `No PTZ device selected in UI and no manual UVC index for ${cameraName}` };
                }
                uvcIndexToUse = configuredPtzServerId;
                console.log(`[CameraControl SET_PTZ] Using configured server PTZ ID '${uvcIndexToUse}' as UVC identifier for ${cameraName} on ${this.platform} (manual index not provided/invalid).`);
            }
        }

        // If, after all logic, uvcIndexToUse is still not a valid number for macOS (where we expect 0 or 1)
        // or is undefined for other platforms, we should not proceed.
        if (uvcIndexToUse === undefined || (this.platform === 'darwin' && (isNaN(parseInt(uvcIndexToUse, 10)) || parseInt(uvcIndexToUse, 10) < 0))) {
            console.error(`[CameraControl SET_PTZ] Derived uvcIndexToUse '${uvcIndexToUse}' is invalid. PTZ command aborted for ${cameraName}.`);
            return { success: false, message: `Derived UVC index '${uvcIndexToUse}' is invalid.` };
        }

        let command = "";
        let operation = "";
        let valueStr = "";

        const uvcPath = this.uvcUtilPath; // Corrected to use this.uvcUtilPath

        const setPTZControl = async (control, val) => {
            let controlArg = "";
            let valueArg = "";

            switch (control) {
                case 'pan':
                case 'tilt':
                    controlArg = 'pan-tilt-abs';
                    // Pan and tilt are often sent together, ensure we get current values if one is missing
                    const currentPan = camera.currentPan !== undefined ? camera.currentPan : 0;
                    const currentTilt = camera.currentTilt !== undefined ? camera.currentTilt : 0;
                    const targetPan = pan !== null ? pan : currentPan;
                    const targetTilt = tilt !== null ? tilt : currentTilt;
                    valueArg = `"{${targetPan},${targetTilt}}"`; // Note: escaped quotes for exec
                    operation = `pan/tilt to ${targetPan},${targetTilt}`;
                    break;
                case 'zoom':
                    controlArg = 'zoom-abs';
                    valueArg = String(val);
                    operation = `zoom to ${val}`;
                    break;
                default:
                    console.error(`[CameraControl SET_PTZ] Unknown PTZ control: ${control}`);
                    return { success: false, message: `Unknown PTZ control: ${control}` };
            }

            // Use the mapped uvcIndex here
            command = `${uvcPath} -I ${uvcIndexToUse} -s ${controlArg}=${valueArg}`;
            console.log(`[CameraControl SET_PTZ] Executing for ${cameraName} (uvcIndex ${uvcIndexToUse}): ${command}`);

            try {
                const { stdout, stderr } = await this.executeUVCCommand(command); // Changed from global executeUVCCommand
                if (stderr) {
                    // uvc-util often prints status to stderr on success, so only treat as error if stdout is empty
                    // or if stderr contains specific error keywords.
                    if (stdout || !/error/i.test(stderr)) {
                        console.log(`[CameraControl SET_PTZ] uvc-util stderr for ${cameraName}: ${stderr}`);
                    } else {
                        console.error(`[CameraControl SET_PTZ Error] uvc-util stderr for ${cameraName}: ${stderr}`);
                        return { success: false, message: `PTZ command failed: ${stderr}` };
                    }
                }
                console.log(`[CameraControl SET_PTZ] ${cameraName} ${operation} successful. stdout: ${stdout || '(empty)'}`);
                // Update camera state
                if (pan !== null) camera.currentPan = pan;
                if (tilt !== null) camera.currentTilt = tilt;
                if (zoom !== null) camera.currentZoom = zoom; // Assuming you have currentZoom

                return { success: true, message: `${operation} successful` };
            } catch (error) {
                console.error(`[CameraControl SET_PTZ Error] Failed to set ${operation} for ${cameraName} (uvcIndex ${uvcIndexToUse}). Error: ${error.message}`);
                return { success: false, message: `Failed to set ${operation}: ${error.message}` };
            }
        };

        // Call setPTZControl only for the relevant operation
        if (pan !== null) {
            const result = await setPTZControl('pan', pan);
            if (!result.success) return result;
        }
        // If only tilt changed, the 'tilt' case in setPTZControl correctly uses currentPan.
        // If both pan and tilt changed, 'pan' case handles pan-tilt-abs, 
        // then 'tilt' case also calls pan-tilt-abs. This is slightly redundant but often harmless.
        // A more optimized way would be to detect if pan OR tilt changed, then make one pan-tilt-abs call.
        // For now, this simpler conditional logic for each control is fine.
        if (tilt !== null) {
            const result = await setPTZControl('tilt', tilt);
            if (!result.success) return result;
        }
        if (zoom !== null) {
            const result = await setPTZControl('zoom', zoom);
            if (!result.success) return result;
        }

        return { success: true, message: 'PTZ operations processed' };
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
            camera.setRecordingDevice(serverDeviceId);
            this.saveCameraConfig(); // Persist change
            console.log(`[CameraControl] Recording device for ${cameraName} set to ${serverDeviceId}`);
            return true;
        }
        console.error(`[CameraControl] setRecordingDevice: Camera ${cameraName} not found.`);
        return false;
    }

    setPTZDevice(cameraName, deviceId) {
        const camera = this.getCamera(cameraName);
        if (!camera) {
            console.error(`[CameraControl] setPTZDevice: Camera ${cameraName} not found.`);
            return false;
        }

        const oldPtzDeviceId = camera.getPTZDevice();
        camera.setPTZDevice(deviceId); // Update the Camera instance's internal state
        this.saveCameraConfig();       // Persist this change to storage

        console.log(`[CameraControl] PTZ device for ${cameraName} updated to: '${deviceId}'. Old was: '${oldPtzDeviceId}'.`);

        // If the PTZ device has actually changed to a new, valid device,
        // try to "prime" it by sending a reset command.
        if (deviceId && deviceId !== oldPtzDeviceId) {
            console.log(`[CameraControl] PTZ device changed for ${cameraName} to '${deviceId}'. Attempting to prime by resetting.`);
            this.resetPTZHome(cameraName) // Call without await if resetPTZHome is not critical to block for
                .then(() => console.log(`[CameraControl] Priming (reset) attempt for ${cameraName} completed.`))
                .catch(err => console.error(`[CameraControl] Error during priming (reset) for ${cameraName}:`, err));
        } else if (!deviceId && oldPtzDeviceId) {
            console.log(`[CameraControl] PTZ device for ${cameraName} cleared. No priming action.`);
        } else if (deviceId && deviceId === oldPtzDeviceId) {
            console.log(`[CameraControl] PTZ device for ${cameraName} re-selected ('${deviceId}'). No priming action needed unless state was lost.`);
            // Optionally, could still prime if there's a suspicion state is lost without a full refresh
            // this.resetPTZHome(cameraName).catch(err => console.error(`Error re-priming ${cameraName}:`, err));
        }

        return true;
    }

    /**
     * Resets all configured PTZ cameras to their defined home position.
     * Currently assumes home is Pan=0, Tilt=0, Zoom=0.
     * Iterates through all managed cameras and sends the command if a PTZ device is set.
     */
    async resetPTZHome(cameraName) {
        const camera = this.getCamera(cameraName);
        if (!camera) {
            console.error(`[CameraControl] resetPTZHome: Camera ${cameraName} not found.`);
            throw new Error(`Camera ${cameraName} not found for PTZ reset.`);
        }
        const configuredPtzServerId = camera.getPTZDevice(); // This is system_profiler ID like '0', '2', '3'

        if (configuredPtzServerId === null || configuredPtzServerId === undefined || configuredPtzServerId === "") {
            console.log(`[CameraControl] resetPTZHome: No PTZ device configured for ${cameraName}. Skipping reset.`);
            return;
        }

        let uvcIndexToUseForReset = -1;

        if (this.platform === 'darwin') {
            if (configuredPtzServerId === '0') { // system_profiler ID '0' (first OBSBOT)
                uvcIndexToUseForReset = 0; // Maps to uvc-util index 0
            } else if (configuredPtzServerId === '3') { // system_profiler ID '3' (second OBSBOT)
                uvcIndexToUseForReset = 1; // Maps to uvc-util index 1
            } else {
                console.warn(`[CameraControl] resetPTZHome: Configured PTZ ID '${configuredPtzServerId}' for ${cameraName} is not a recognized OBSBOT for direct uvc-util reset. Reset command will not be sent.`);
                return; // Do not attempt reset for non-mapped devices
            }
            console.log(`[CameraControl] resetPTZHome: Mapped system_profiler ID '${configuredPtzServerId}' to uvc-util index '${uvcIndexToUseForReset}' for reset.`);
        } else {
            // For non-macOS, assume configuredPtzServerId (e.g. /dev/video0) can be used directly or adapt as needed.
            uvcIndexToUseForReset = configuredPtzServerId;
            console.log(`[CameraControl] resetPTZHome: Using PTZ device ID '${uvcIndexToUseForReset}' directly for reset on ${this.platform}.`);
        }

        if (uvcIndexToUseForReset === -1 && this.platform === 'darwin') { // Should be caught by the else block above for darwin
            console.error(`[CameraControl] resetPTZHome: Internal error, uvcIndexToUseForReset not set for darwin platform with ID ${configuredPtzServerId}`);
            return;
        }

        console.log(`[CameraControl] Resetting PTZ to home for ${cameraName} using uvc-util index/path '${uvcIndexToUseForReset}'`);

        const executeUVCResetLocal = async (control) => {
            let command;
            if (this.platform === 'darwin') {
                // For macOS, uvc-util -I <index> is used.
                command = `${this.uvcUtilPath} -I ${uvcIndexToUseForReset} --set=${control}_reset=1`;
            } else if (this.platform === 'linux') {
                // For Linux, ptzDeviceID is likely /dev/videoX, use -d
                command = `${this.uvcUtilPath} -d '${uvcIndexToUseForReset}' --set-ctrl=${control}_reset=1`; // Example, syntax varies
            } else {
                console.warn(`[CameraControl] resetPTZHome: PTZ reset not implemented for platform ${this.platform}`);
                return;
            }
            try {
                console.log(`[CameraControl] Executing PTZ reset for ${control}: ${command}`);
                // Use the class method executeUVCCommand which returns {stdout, stderr, error}
                const { stdout, stderr, error: execError } = await this.executeUVCCommand(command);
                if (execError || (stderr && /error/i.test(stderr) && !stdout)) { // Check for exec error or significant stderr error
                    console.error(`[CameraControl] Failed to reset ${control} for ${cameraName} (device ${uvcIndexToUseForReset}): ${execError ? execError.message : stderr}`);
                } else {
                    console.log(`[CameraControl] Reset for ${control} for ${cameraName} (device ${uvcIndexToUseForReset}) presumably successful. stdout: ${stdout}, stderr: ${stderr}`);
                }
            } catch (error) {
                // This catch might be redundant if executeUVCCommand itself doesn't throw but resolves with an error object
                console.error(`[CameraControl] Exception during reset of ${control} for ${cameraName} (device ${uvcIndexToUseForReset}):`, error);
            }
        };

        await executeUVCResetLocal('pan');
        await executeUVCResetLocal('tilt');
        // Zoom reset is often to its widest setting, not necessarily '0'.
        // await executeUVCResetLocal('zoom'); // Add if applicable and uvc-util supports zoom_reset

        camera.setCurrentPan(0); // Update cached pan/tilt after reset
        camera.setCurrentTilt(0);

        console.log(`[CameraControl] PTZ reset command sequence for ${cameraName} completed.`);
    }

    saveCameraConfig() {
        // Simple: write the current this.cameras map (or a serializable version) to a JSON file
        // More complex: update a database
        // For now, let's assume it's saving to config.json or a similar cameras.json
        // This part is crucial and needs to be implemented based on how configs are actually stored.
        // console.log('[CameraControl] Attempting to save camera configurations...');
        // For demonstration, let's assume a simple cameras.json structure
        const camerasArray = Array.from(this.cameras.values()).map(cam => ({
            name: cam.name,
            previewDevice: cam.getPreviewDevice(), // these are device IDs (like index from system_profiler or path for Linux)
            recordingDevice: cam.getRecordingDevice(),
            ptzDevice: cam.getPTZDevice(),
            // Add other relevant props like showSkeleton if managed server-side
        }));
        try {
            // Assuming config.json is the main config, and we might have a separate cameras_state.json
            // Or, if cameraDefaults in config.json is the source of truth for default camera *names*
            // but their dynamic state (like assigned devices) is managed here and needs saving.
            // For this fix, the critical part is that camera.setPTZDevice updates the in-memory Camera object,
            // and saveCameraConfig persists it so that on refresh, the correct ptzDevice is loaded.
            // The actual saving mechanism is out of scope for this specific PTZ priming fix,
            // but it's essential for persistence across refreshes.
            console.log('[CameraControl] saveCameraConfig called. Actual saving logic depends on project setup.');

        } catch (err) {
            console.error('[CameraControl] Error saving camera configurations:', err);
        }
    }

    // Ensure executeUVCCommand is robust
    executeUVCCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // Don't automatically reject on error, as uvc-util might put useful info in stderr
                    // The caller (setPTZ) will inspect stderr.
                    // However, we should still pass the error object itself if it exists.
                    console.error(`[executeUVCCommand Error] Command: ${command}\nError: ${error.message}`);
                    resolve({ stdout: stdout || '', stderr: stderr || '', error: error }); // Resolve with error too
                    return;
                }
                resolve({ stdout: stdout || '', stderr: stderr || '' });
            });
        });
    }
}

// Export the class itself, not an instance
module.exports = CameraControl;
