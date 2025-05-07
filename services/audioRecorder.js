const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
// const record = require('node-record-lpcm16'); // Reverted: Commenting out node-record-lpcm16

// Add a note about SoX dependency:
// IMPORTANT: This module now uses SoX for audio recording.
// Please ensure SoX is installed and accessible in your system's PATH.
// For Linux, typically: sudo apt-get install sox
// For macOS, typically: brew install sox

class AudioRecorder {
    constructor() {
        if (AudioRecorder.instance) {
            return AudioRecorder.instance;
        }
        AudioRecorder.instance = this;
        this.platform = os.platform();
        this.activeDevices = new Map(); // deviceId -> { name: string, process: ChildProcess | null, filePath: string | null }
        this.recordingProcesses = new Map(); // Simple map to track ongoing recordings by deviceId
        this.recordingCounter = 0; // To generate unique file names like Audio_1, Audio_2
        console.log('AudioRecorder initialized for platform:', this.platform);
    }

    static getInstance() {
        if (!AudioRecorder.instance) {
            new AudioRecorder();
        }
        return AudioRecorder.instance;
    }

    async detectAudioInputDevices() {
        return new Promise((resolve, reject) => {
            if (this.platform === 'linux') {
                // Use arecord -l to list capture devices
                exec('arecord -l', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error detecting audio devices on Linux (arecord -l):', stderr || error.message);
                        return reject(new Error(`Failed to list audio devices: ${stderr || error.message}`));
                    }

                    const devices = [];
                    // Split lines safely, handling potential Windows/Unix line endings
                    const lines = stdout.split(/\r?\n/);

                    // Regex to capture relevant info from lines like:
                    // card 1: C920 [HD Pro Webcam C920], device 0: USB Audio [USB Audio]
                    const deviceLineRegex = /^card\s+(\d+):\s+([^\[]+)\s+\[.*?],\s+device\s+(\d+):\s+([^\[]+)\s+\[.*?]/;

                    lines.forEach(line => {
                        const match = line.match(deviceLineRegex);
                        if (match) {
                            const cardNum = match[1];
                            const cardName = match[2].trim();
                            const deviceNum = match[3];
                            const deviceName = match[4].trim();
                            // Construct the standard ALSA device ID (e.g., hw:1,0)
                            const deviceId = `hw:${cardNum},${deviceNum}`;

                            // Basic filtering to exclude likely output devices
                            if (!deviceName.toLowerCase().includes('playback') && !deviceName.toLowerCase().includes('hdmi')) {
                                devices.push({
                                    id: deviceId,
                                    // Combine card and device name for a more descriptive label
                                    name: `${cardName} - ${deviceName}`
                                });
                            }
                        }
                    });

                    if (devices.length === 0) {
                        // Log the raw output only if parsing fails, to aid debugging
                        console.warn("arecord -l parsing yielded no devices. Full output was:\n", stdout);
                    }

                    console.log('Linux - Found audio input devices:', devices);
                    resolve(devices);
                });
            } else if (this.platform === 'darwin') {
                // Example using system_profiler SPAudioDataType
                exec('system_profiler SPAudioDataType -json', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error detecting audio devices on macOS (system_profiler):', stderr || error.message);
                        return reject(new Error(`Failed to list audio devices: ${stderr || error.message}`));
                    }
                    try {
                        const data = JSON.parse(stdout);
                        // Replace optional chaining with standard checks
                        const spAudioData = data && data.SPAudioDataType;
                        const items = spAudioData && spAudioData.length > 0 ? spAudioData[0]["_items"] : null;
                        const audioDevices = items || []; // Default to empty array if items is null/undefined

                        const inputDevices = audioDevices
                            .filter(device => device && device.coreaudio_device_input && parseInt(device.coreaudio_device_input, 10) > 0) // Add checks for device and property existence
                            .map((device, index) => ({
                                // Use the device name (_name) as the ID, fallback if name is missing
                                id: device._name || `Unknown macOS Audio Input ${index}`,
                                name: device._name || `Unknown macOS Audio Input ${index}`
                            }));
                        console.log('macOS - Found audio input devices:', inputDevices);
                        resolve(inputDevices);
                    } catch (parseError) {
                        console.error('Error parsing macOS audio device list:', parseError);
                        reject(new Error('Failed to parse audio device list on macOS'));
                    }
                });
            } else {
                console.warn(`Audio device detection not implemented for platform: ${this.platform}`);
                resolve([]); // Resolve with empty array for unsupported platforms
            }
        });
    }

    addActiveDevice(deviceId, deviceName) {
        if (!this.activeDevices.has(deviceId)) {
            this.activeDevices.set(deviceId, { name: deviceName, process: null, filePath: null });
            console.log(`Added active audio device: ${deviceName} (${deviceId})`);
            return true;
        }
        console.log(`Audio device already active: ${deviceName} (${deviceId})`);
        return false;
    }

    removeActiveDevice(deviceId) {
        if (this.activeDevices.has(deviceId)) {
            const device = this.activeDevices.get(deviceId);
            if (device.process) {
                console.warn(`Removing active device ${deviceId} while recording is in progress. Stopping recording.`);
                this._stopDeviceRecording(deviceId); // Stop recording if active
            }
            this.activeDevices.delete(deviceId);
            console.log(`Removed active audio device: ${deviceId}`);
            return true;
        }
        console.log(`Audio device not found in active list: ${deviceId}`);
        return false;
    }

    getActiveDevices() {
        return Array.from(this.activeDevices.entries()).map(([id, data]) => ({ id, name: data.name }));
    }

    // Internal helper to stop a specific device's recording
    _stopDeviceRecording(deviceId) {
        if (this.recordingProcesses.has(deviceId)) {
            const { process, filePath, stopping } = this.recordingProcesses.get(deviceId); // Removed type, re-added stopping
            console.log(`Stopping recording for device ${deviceId}...`);

            // If already stopping (e.g. kill signal sent), don't try again
            if (stopping) {
                console.log(`Device ${deviceId} recording is already in the process of stopping.`);
                return;
            }

            // For command-line processes (ffmpeg, arecord)
            if (process && typeof process.kill === 'function') {
                // Mark the process as being stopped so we don't double-handle cleanup
                this.recordingProcesses.set(deviceId, { process, filePath, stopping: true });

                // Send SIGTERM first for graceful shutdown
                try {
                    process.kill('SIGTERM');

                    // Set a timeout to forcefully kill if it doesn't terminate
                    const killTimeout = setTimeout(() => {
                        try {
                            if (!process.killed) {
                                console.warn(`Recording process for ${deviceId} did not exit gracefully, sending SIGKILL.`);
                                process.kill('SIGKILL');
                            }
                        } catch (killError) {
                            console.error(`Error sending SIGKILL to process for ${deviceId}:`, killError);
                        }
                        // Ensure we clean up even if there's a problem with the kill
                        this.recordingProcesses.delete(deviceId);
                    }, 2000); // 2 seconds grace period

                    // Ensure timeout is cleared if process exits normally
                    process.once('exit', (code, signal) => {
                        clearTimeout(killTimeout);
                        if (code === 0 || signal === 'SIGTERM') {
                            console.log(`Recording stopped successfully for device ${deviceId}. File saved to: ${filePath}`);
                        } else {
                            console.error(`Recording process for ${deviceId} exited with code ${code}, signal ${signal}. File might be incomplete: ${filePath}`);
                        }
                        this.recordingProcesses.delete(deviceId); // Remove from tracking
                    });

                    process.once('error', (err) => {
                        clearTimeout(killTimeout);
                        console.error(`Error in recording process for ${deviceId}:`, err);
                        this.recordingProcesses.delete(deviceId);
                    });
                } catch (error) {
                    console.error(`Failed to stop recording for ${deviceId}:`, error);
                    this.recordingProcesses.delete(deviceId);
                }
            }
        } else {
            console.log(`No active recording process found for device ${deviceId} to stop.`);
        }
    }

    startRecording(outputBasePath, durationSec = null) {
        if (this.activeDevices.size === 0) {
            console.log("No active audio devices selected for recording.");
            return;
        }

        // Check if the base path exists, create if not (should generally exist from sceneController)
        if (!fs.existsSync(outputBasePath)) {
            console.warn(`AudioRecorder: Output base path did not exist, creating: ${outputBasePath}`);
            try {
                fs.mkdirSync(outputBasePath, { recursive: true });
            } catch (error) {
                console.error(`Failed to create output base path ${outputBasePath}:`, error);
                return; // Cannot proceed without the directory
            }
        }

        console.log(`Starting audio recording for ${this.activeDevices.size} devices in base path: ${outputBasePath}`);
        // this.recordingCounter++; // Removed: No longer using global counter for Audio_X.wav filenames directly

        let deviceAudioIndex = 0;
        this.activeDevices.forEach((deviceData, deviceId) => {
            deviceAudioIndex++;
            const deviceSubDirName = `Audio_${deviceAudioIndex}`;
            const deviceSpecificAudioBasePath = path.join(outputBasePath, deviceSubDirName);

            // First, ensure we stop any existing recording for this device
            if (this.recordingProcesses.has(deviceId)) {
                console.warn(`Device ${deviceId} is already recording. Stopping the current recording first.`);
                this._stopDeviceRecording(deviceId);
                // Wait a moment to ensure cleanup and pass duration, use deviceSpecificAudioBasePath
                setTimeout(() => this._startDeviceRecording(deviceId, deviceData, deviceSpecificAudioBasePath, durationSec), 500);
            } else {
                // Pass duration, use deviceSpecificAudioBasePath
                this._startDeviceRecording(deviceId, deviceData, deviceSpecificAudioBasePath, durationSec);
            }
        });
    }

    _startDeviceRecording(deviceId, deviceData, outputBasePath, durationSec = null) {
        // this.recordingCounter++; // Removed: outputBasePath is now device-specific (e.g., .../Audio_1)
        const fileName = 'original.wav'; // Fixed filename
        const filePath = path.join(outputBasePath, fileName);

        // Ensure the output directory exists (outputBasePath is now e.g. .../Audio_1)
        try {
            if (!fs.existsSync(outputBasePath)) {
                fs.mkdirSync(outputBasePath, { recursive: true });
                console.log(`[AudioRecorder] Created output directory: ${outputBasePath}`);
            }
        } catch (dirError) {
            console.error(`[AudioRecorder] Error creating directory ${outputBasePath}:`, dirError);
            // Optionally, post a message back to the parent or handle error appropriately
            this.activeDevices.get(deviceId).process = null; // Ensure process is cleared
            // this.parentPort.postMessage({ type: 'error', message: `Failed to create directory: ${outputBasePath}` });
            return;
        }

        let recProcess;
        const commonArgs = [
            '-r', '48000', // Sample rate 48kHz
            '-c', '1',     // Mono
            '-b', '16',    // 16-bit
            // '--buffer', '8192', // Optional: SoX buffer size
            // '-V1', // Optional: SoX verbosity
            filePath
        ];

        if (durationSec && durationSec > 0) {
            commonArgs.push('trim', '0', durationSec.toString());
        }
        // If durationSec is null or 0, SoX will record until stopped by _stopDeviceRecording.

        if (this.platform === 'linux') {
            // deviceId for Linux is expected to be like 'hw:0,0'
            const soxArgs = ['-t', 'alsa', deviceId, ...commonArgs];
            console.log(`[AudioRecorder] Starting SoX recording for ${deviceId} on Linux: sox ${soxArgs.join(' ')}`);
            try {
                recProcess = spawn('sox', soxArgs);
            } catch (spawnError) {
                console.error(`[AudioRecorder] Failed to spawn SoX on Linux for ${deviceId}:`, spawnError);
                // this.parentPort.postMessage({ type: 'error', message: `Failed to spawn SoX for ${deviceId}` });
                return;
            }
        } else if (this.platform === 'darwin') {
            // deviceData.name for macOS is the device name like "MacBook Pro Microphone"
            const soxArgs = ['-t', 'coreaudio', deviceData.name, ...commonArgs];
            console.log(`[AudioRecorder] Starting SoX recording for ${deviceData.name} on macOS: sox ${soxArgs.join(' ')}`);
            try {
                recProcess = spawn('sox', soxArgs);
            } catch (spawnError) {
                console.error(`[AudioRecorder] Failed to spawn SoX on macOS for ${deviceData.name}:`, spawnError);
                // this.parentPort.postMessage({ type: 'error', message: `Failed to spawn SoX for ${deviceData.name}` });
                return;
            }
        } else {
            console.error(`[AudioRecorder] Recording not supported on platform: ${this.platform} for device ${deviceId}`);
            // this.parentPort.postMessage({ type: 'error', message: `Recording not supported on platform: ${this.platform}` });
            return;
        }

        if (!recProcess) {
            console.error(`[AudioRecorder] SoX process not spawned for device ${deviceId}.`);
            return;
        }

        // Store the process and file path
        this.activeDevices.get(deviceId).process = recProcess;
        this.activeDevices.get(deviceId).filePath = filePath;
        this.recordingProcesses.set(deviceId, { process: recProcess, filePath, stopping: false });


        recProcess.stdout.on('data', (data) => {
            console.log(`[AudioRecorder SoX stdout - ${deviceId}]: ${data.toString().trim()}`);
        });

        let stderrOutput = '';
        recProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            // SoX can be quite verbose on stderr even for normal operations.
            // We'll log it but might need to filter for actual errors if it's too noisy.
            console.log(`[AudioRecorder SoX stderr - ${deviceId}]: ${message}`);
            stderrOutput += message + '\n';
        });

        recProcess.on('error', (err) => {
            console.error(`[AudioRecorder] Error with SoX process for ${deviceId}:`, err);
            // this.parentPort.postMessage({ type: 'error', message: `Error with SoX for ${deviceId}: ${err.message}` });
            this.recordingProcesses.delete(deviceId);
            if (this.activeDevices.has(deviceId)) {
                this.activeDevices.get(deviceId).process = null;
            }
        });

        recProcess.on('exit', (code, signal) => {
            const currentProcessData = this.recordingProcesses.get(deviceId);
            if (currentProcessData && currentProcessData.stopping) {
                console.log(`[AudioRecorder] SoX process for ${deviceId} was intentionally stopped (signal: ${signal}, code: ${code}). File: ${filePath}`);
            } else if (code === 0) {
                console.log(`[AudioRecorder] SoX recording completed successfully for ${deviceId}. File: ${filePath}`);
            } else {
                console.error(`[AudioRecorder] SoX process for ${deviceId} exited with code ${code}, signal ${signal}. File may be incomplete or invalid: ${filePath}`);
                console.error(`[AudioRecorder SoX stderr output for ${deviceId} on exit]:\n${stderrOutput}`);
                // this.parentPort.postMessage({ type: 'error', message: `SoX for ${deviceId} exited with code ${code}, signal ${signal}.` });
            }
            // Clean up whether stopping was intentional or not, if not already handled by _stopDeviceRecording
            if (this.recordingProcesses.has(deviceId) && !(currentProcessData && currentProcessData.stopping)) {
                this.recordingProcesses.delete(deviceId);
            }
            if (this.activeDevices.has(deviceId)) {
                this.activeDevices.get(deviceId).process = null;
            }
        });

        console.log(`[AudioRecorder] SoX recording process started for ${deviceId} (PID: ${recProcess.pid}). Output to: ${filePath}`);
        // this.parentPort.postMessage({ type: 'started', deviceId, filePath });
    }

    stopRecording() {
        console.log(`Stopping all active audio recordings (${this.recordingProcesses.size} found)...`);
        this.recordingProcesses.forEach((_, deviceId) => {
            this._stopDeviceRecording(deviceId);
        });
        // Reset counter or handle it differently if needed per Action! press
        // this.recordingCounter = 0;
    }

    async startTestRecording(deviceId, sessionPath) {
        // TODO: Decide if test recordings should also use the new structure or a simpler temp path.
        // For now, keeping the existing logic which uses sessionPath or ./temp
        console.log(`Starting 3-second SoX test recording for device: ${deviceId}`);
        if (!this.activeDevices.has(deviceId)) {
            return { success: false, message: `Device ${deviceId} is not selected as an active device.` };
        }
        const deviceData = this.activeDevices.get(deviceId); // We have deviceData if needed, but deviceId is the name for macOS
        const tempFileName = `test_sox_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.wav`;
        const tempFilePath = path.join(sessionPath || './temp', tempFileName); // Use temp dir if no session path

        // Ensure temp directory exists
        const tempDir = path.dirname(tempFilePath);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Ensure device is not already recording
        if (this.recordingProcesses.has(deviceId)) {
            console.warn(`Device ${deviceId} is already recording. Cannot start test.`);
            return { success: false, message: `Device ${deviceId} is already recording.` };
        }

        return new Promise((resolve, reject) => {
            let testProcess;
            const duration = 3; // seconds
            const soxCommonArgs = [
                '-r', '48000',
                '-c', '1',
                '-b', '16',
                tempFilePath,
                'trim', '0', duration.toString()
            ];

            if (this.platform === 'linux') {
                // deviceId for Linux is expected to be like 'hw:0,0'
                const soxArgs = ['-t', 'alsa', deviceId, ...soxCommonArgs];
                console.log(`[AudioRecorder Test] Starting SoX for ${deviceId} on Linux: sox ${soxArgs.join(' ')}`);
                try {
                    testProcess = spawn('sox', soxArgs);
                } catch (spawnError) {
                    console.error(`[AudioRecorder Test] Failed to spawn SoX on Linux for ${deviceId}:`, spawnError);
                    return reject(new Error(`Failed to start test recording (SoX spawn error Linux): ${spawnError.message}`));
                }
            } else if (this.platform === 'darwin') {
                // For macOS, deviceId in this context (from getActiveDevices/addActiveDevice) IS the device name.
                const soxArgs = ['-t', 'coreaudio', deviceId, ...soxCommonArgs];
                console.log(`[AudioRecorder Test] Starting SoX for ${deviceId} on macOS: sox ${soxArgs.join(' ')}`);
                try {
                    testProcess = spawn('sox', soxArgs);
                } catch (spawnError) {
                    console.error(`[AudioRecorder Test] Failed to spawn SoX on macOS for ${deviceId}:`, spawnError);
                    return reject(new Error(`Failed to start test recording (SoX spawn error macOS): ${spawnError.message}`));
                }
            } else {
                console.error(`[AudioRecorder Test] Recording not supported on platform: ${this.platform}`);
                return reject(new Error(`Test recording not supported on platform: ${this.platform}`));
            }

            if (!testProcess) {
                console.error(`[AudioRecorder Test] SoX process not spawned for device ${deviceId}.`);
                return reject(new Error('SoX process failed to spawn for test.'));
            }

            this.recordingProcesses.set(deviceId, { process: testProcess, filePath: tempFilePath, stopping: false });

            let testStderrOutput = '';
            testProcess.stdout.on('data', (data) => {
                console.log(`[AudioRecorder SoX Test stdout - ${deviceId}]: ${data.toString().trim()}`);
            });
            testProcess.stderr.on('data', (data) => {
                const message = data.toString().trim();
                console.log(`[AudioRecorder SoX Test stderr - ${deviceId}]: ${message}`);
                testStderrOutput += message + '\n';
            });

            testProcess.on('error', (err) => {
                console.error(`[AudioRecorder Test] Error with SoX process for ${deviceId}:`, err);
                this.recordingProcesses.delete(deviceId);
                reject(new Error(`Test recording SoX process failed: ${err.message}`));
            });

            testProcess.on('exit', (code, signal) => {
                this.recordingProcesses.delete(deviceId);
                const currentProcessData = this.recordingProcesses.get(deviceId); // Should be undefined now
                if (currentProcessData && currentProcessData.stopping) { // Check if it was an intentional stop
                    console.log(`[AudioRecorder Test] SoX process for ${deviceId} was intentionally stopped.`);
                    // If it was intentionally stopped, maybe resolve differently or ensure file is cleaned up if partial.
                    fs.unlink(tempFilePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`[AudioRecorder Test] Error deleting partial test file ${tempFilePath}: ${unlinkErr.message}`);
                        else console.log(`[AudioRecorder Test] Deleted partial test file ${tempFilePath} after stop.`);
                    });
                    resolve({ success: false, message: 'Test recording stopped early.' });
                } else if (code === 0) {
                    console.log(`[AudioRecorder Test] SoX recording completed successfully for ${deviceId}. File: ${tempFilePath}`);
                    resolve({ success: true, message: `Test recording saved to ${tempFilePath}`, filePath: tempFilePath });
                } else {
                    console.error(`[AudioRecorder Test] SoX process for ${deviceId} exited with code ${code}, signal ${signal}. File may be incomplete: ${tempFilePath}`);
                    console.error(`[AudioRecorder SoX Test stderr output for ${deviceId} on exit]:\n${testStderrOutput}`);
                    fs.unlink(tempFilePath, () => { }); // Attempt to clean up failed/partial test file
                    reject(new Error(`Test recording failed (SoX code: ${code}, signal: ${signal})`));
                }
            });
            console.log(`[AudioRecorder Test] SoX recording process started for ${deviceId} (PID: ${testProcess.pid}), duration: ${duration}s`);
        });
    }
}

module.exports = AudioRecorder;