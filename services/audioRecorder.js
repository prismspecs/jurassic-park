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
        this.recordingProcesses = new Map(); // deviceId -> { process: ChildProcess, filePath: string, stopping: boolean }
        this.testRecordingProcesses = new Map(); // Separate map for test recordings: deviceId -> { process: ChildProcess, filePath: string, stopping: boolean, timeoutId: Timeout }
        this.deviceConfigs = new Map(); // deviceId -> { gainDb: number | null, channels: number[] | null }
        // this.recordingCounter = 0; // Removed: Not needed anymore
        console.log('AudioRecorder initialized for platform:', this.platform);
    }

    static getInstance() {
        if (!AudioRecorder.instance) {
            new AudioRecorder();
        }
        return AudioRecorder.instance;
    }

    async detectAudioInputDevices() {
        // TODO: Enhance device detection to include channelCount
        // Linux: Parse 'arecord -L' or 'sox --info -t alsa DEVICEID -n'
        // macOS: Parse 'system_profiler SPAudioDataType' (coreaudio_device_input?) or 'sox --info -t coreaudio DEVICENAME -n'
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
                                    name: `${cardName} - ${deviceName}`,
                                    // channelCount: null // Placeholder for future enhancement
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
                                name: device._name || `Unknown macOS Audio Input ${index}`,
                                // channelCount: parseInt(device.coreaudio_device_input, 10) || null // Attempt to get channel count
                                // TODO: Verify if coreaudio_device_input is reliable for channel count
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
        const fileName = 'original.wav'; // Fixed filename
        const filePath = path.join(outputBasePath, fileName);

        // --- Get Device Config ---
        const config = this.deviceConfigs.get(deviceId) || { gainDb: null, channels: null };
        console.log(`Using config for ${deviceId}:`, config);
        // --- End Get Config ---

        // Ensure the output directory exists (outputBasePath is now e.g. .../Audio_1)
        try {
            if (!fs.existsSync(outputBasePath)) {
                fs.mkdirSync(outputBasePath, { recursive: true });
                console.log(`[AudioRecorder] Created output directory: ${outputBasePath}`);
            }
        } catch (dirError) {
            console.error(`[AudioRecorder] Error creating directory ${outputBasePath}:`, dirError);
            return; // Cannot proceed without the directory
        }

        // Platform-specific SoX command setup
        const command = 'sox';
        const isLinux = this.platform === 'linux';
        const isMac = this.platform === 'darwin';

        // Base SoX arguments
        const soxArgs = [
            '-q', // Suppress non-error messages from SoX itself
            '-t', isLinux ? 'alsa' : (isMac ? 'coreaudio' : ''), // Platform-specific type
            deviceId, // Input device ID
            '-t', 'wav', // Output type
            filePath // Output file path
        ];

        // Add duration if specified
        if (durationSec && durationSec > 0) {
            soxArgs.push('trim', '0', String(durationSec));
        }

        // --- Add Gain and Channel Effects based on Config ---
        if (typeof config.gainDb === 'number') {
            soxArgs.push('vol', `${config.gainDb}dB`);
            console.log(`Applied gain for ${deviceId}: ${config.gainDb}dB`);
        }
        if (Array.isArray(config.channels) && config.channels.length > 0) {
            // Validate channels are positive integers
            const validChannels = config.channels.filter(ch => Number.isInteger(ch) && ch >= 1);
            if (validChannels.length > 0) {
                soxArgs.push('remix', validChannels.join(','));
                console.log(`Applied channel selection for ${deviceId}: ${validChannels.join(',')}`);
            } else {
                console.warn(`Invalid channel selection ignored for ${deviceId}: ${JSON.stringify(config.channels)}`);
            }
        }
        // --- End Config Application ---

        let recProcess;

        try {
            if (isLinux) {
                console.log(`[AudioRecorder] Starting SoX recording for ${deviceId} on Linux: ${command} ${soxArgs.join(' ')}`);
                recProcess = spawn(command, soxArgs);
            } else if (isMac) {
                console.log(`[AudioRecorder] Starting SoX recording for ${deviceData.name} on macOS: ${command} ${soxArgs.join(' ')}`);
                recProcess = spawn(command, soxArgs);
            } else {
                console.error(`[AudioRecorder] Recording not supported on platform: ${this.platform} for device ${deviceId}`);
                return;
            }
        } catch (spawnError) {
            console.error(`[AudioRecorder] Failed to spawn SoX on ${this.platform} for ${deviceId}:`, spawnError);
            return;
        }

        if (!recProcess) {
            console.error(`[AudioRecorder] SoX process not spawned for device ${deviceId}.`);
            return;
        }

        // Store the process and file path, mark as not stopping initially
        this.recordingProcesses.set(deviceId, { process: recProcess, filePath: filePath, stopping: false });

        let stderrOutput = ''; // Accumulate stderr

        recProcess.stdout.on('data', (data) => {
            console.log(`[AudioRecorder SoX stdout - ${deviceId}]: ${data.toString().trim()}`);
        });

        recProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            stderrOutput += message + '\n'; // Append message
            // SoX often prints stats to stderr, filter noise unless it looks like an error
            if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fail') || message.toLowerCase().includes('warn')) {
                console.log(`[AudioRecorder SoX stderr - ${deviceId}]: ${message}`);
            } else {
                // console.debug(`[AudioRecorder SoX stderr (info) - ${deviceId}]: ${message}`); // Optional: log info messages if needed
            }
        });

        recProcess.on('error', (err) => {
            console.error(`[AudioRecorder] Error with SoX process for ${deviceId}:`, err);
            this.recordingProcesses.delete(deviceId); // Clean up on error
        });

        recProcess.on('close', (code, signal) => {
            const processData = this.recordingProcesses.get(deviceId);
            // Only process exit if it wasn't intentionally stopped (stopping flag is false)
            // and the process object matches the one we stored (prevents handling old processes)
            if (processData && processData.process === recProcess && !processData.stopping) {
                if (code === 0) {
                    console.log(`[AudioRecorder] SoX recording completed successfully for ${deviceId}. File: ${filePath}`);
                } else {
                    console.error(`[AudioRecorder] SoX process for ${deviceId} exited with code ${code}, signal ${signal}. File may be incomplete or invalid: ${filePath}`);
                    console.error(`[AudioRecorder SoX stderr output for ${deviceId} on exit]:\n${stderrOutput}`);
                }
                this.recordingProcesses.delete(deviceId); // Clean up map entry
            } else if (processData && processData.process === recProcess && processData.stopping) {
                console.log(`[AudioRecorder] SoX process for ${deviceId} was intentionally stopped (signal: ${signal}, code: ${code}). File: ${filePath}`);
                // Already handled in _stopDeviceRecording, just ensure it's removed if somehow still present
                this.recordingProcesses.delete(deviceId);
            }

        });

        console.log(`[AudioRecorder] SoX recording process started for ${deviceId} (PID: ${recProcess.pid}). Output to: ${filePath}`);
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
        return new Promise(async (resolve, reject) => {
            if (!this.activeDevices.has(deviceId)) {
                return reject(new Error(`Device ${deviceId} is not active.`));
            }

            // Remove existing entry if test is restarted for the same device
            if (this.testRecordingProcesses.has(deviceId)) {
                console.log(`Stopping existing test recording for ${deviceId}...`);
                this.stopTestRecording(deviceId);
                // Wait a short moment to allow cleanup before starting new test
                await new Promise(res => setTimeout(res, 200));
            }

            // --- Get Device Config ---
            const config = this.deviceConfigs.get(deviceId) || { gainDb: null, channels: null };
            console.log(`Using config for test recording ${deviceId}:`, config);
            // --- End Get Config ---

            // Generate temporary file path within the session's temp directory
            const tempDir = sessionPath; // Use the provided sessionPath directly as the target directory
            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
            } catch (dirError) {
                console.error(`Failed to create temp audio directory ${tempDir}:`, dirError);
                return reject(new Error(`Failed to create temp directory: ${dirError.message}`));
            }
            const tempFilePath = path.join(tempDir, `test_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.wav`);

            // Platform-specific SoX command setup
            const command = 'sox';
            const isLinux = this.platform === 'linux';
            const isMac = this.platform === 'darwin';

            // Base SoX arguments for testing (short duration)
            const duration = 5; // seconds
            const soxArgs = [
                '-q', // Suppress non-error messages
                '-t', isLinux ? 'alsa' : (isMac ? 'coreaudio' : ''),
                deviceId,
                '-t', 'wav',
                tempFilePath,
                'trim', '0', String(duration) // Record for fixed duration
            ];

            // --- Add Gain and Channel Effects based on Config ---
            if (typeof config.gainDb === 'number') {
                soxArgs.push('vol', `${config.gainDb}dB`);
                console.log(`[Test] Applied gain for ${deviceId}: ${config.gainDb}dB`);
            }
            if (Array.isArray(config.channels) && config.channels.length > 0) {
                // Validate channels are positive integers
                const validChannels = config.channels.filter(ch => Number.isInteger(ch) && ch >= 1);
                if (validChannels.length > 0) {
                    soxArgs.push('remix', validChannels.join(','));
                    console.log(`[Test] Applied channel selection for ${deviceId}: ${validChannels.join(',')}`);
                } else {
                    console.warn(`[Test] Invalid channel selection ignored for ${deviceId}: ${JSON.stringify(config.channels)}`);
                }
            }
            // --- End Config Application ---

            let testProcess;
            try {
                if (isLinux) {
                    console.log(`[AudioRecorder Test] Starting SoX for ${deviceId} on Linux: ${command} ${soxArgs.join(' ')}`);
                    testProcess = spawn(command, soxArgs);
                } else if (isMac) {
                    console.log(`[AudioRecorder Test] Starting SoX for ${deviceId} on macOS: ${command} ${soxArgs.join(' ')}`);
                    testProcess = spawn(command, soxArgs);
                } else {
                    console.error(`[AudioRecorder Test] Recording not supported on platform: ${this.platform}`);
                    return reject(new Error(`Recording not supported on platform: ${this.platform}`));
                }
            } catch (spawnError) {
                console.error(`[AudioRecorder Test] Failed to spawn SoX on ${this.platform} for ${deviceId}:`, spawnError);
                return reject(new Error(`Failed to spawn SoX: ${spawnError.message}`));
            }

            if (!testProcess) {
                console.error(`[AudioRecorder Test] SoX process not spawned for device ${deviceId}.`);
                return reject(new Error('SoX process failed to start'));
            }

            // Store process, path, stopping flag, and timeout ID
            const processData = { process: testProcess, filePath: tempFilePath, stopping: false, timeoutId: null };
            this.testRecordingProcesses.set(deviceId, processData); // Track the test process

            console.log(`[AudioRecorder Test] SoX recording process started for ${deviceId} (PID: ${testProcess.pid}), duration: ${duration}s`);

            let testStderrOutput = ''; // Accumulate stderr

            testProcess.stdout.on('data', (data) => {
                console.log(`[AudioRecorder SoX Test stdout - ${deviceId}]: ${data.toString().trim()}`);
            });

            testProcess.stderr.on('data', (data) => {
                const message = data.toString().trim();
                testStderrOutput += message + '\n';
                // Filter excessive noise from SoX stderr during tests
                if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fail') || message.toLowerCase().includes('warn')) {
                    console.log(`[AudioRecorder SoX Test stderr - ${deviceId}]: ${message}`);
                } else {
                    // console.debug(`[AudioRecorder SoX Test stderr (info) - ${deviceId}]: ${message}`);
                }
            });

            testProcess.on('error', (err) => {
                console.error(`[AudioRecorder Test] Error with SoX process for ${deviceId}:`, err);
                // Ensure cleanup even on spawn error
                if (processData.timeoutId) clearTimeout(processData.timeoutId);
                this.testRecordingProcesses.delete(deviceId);
                reject(new Error(`SoX process error: ${err.message}`)); // Reject promise on error
            });

            testProcess.on('close', (code, signal) => {
                const currentProcessData = this.testRecordingProcesses.get(deviceId);
                // Check if the processData exists and belongs to this specific process instance
                if (currentProcessData && currentProcessData.process === testProcess) {
                    // Clear the automatic stop timeout if the process exits beforehand
                    if (currentProcessData.timeoutId) {
                        clearTimeout(currentProcessData.timeoutId);
                    }

                    if (!currentProcessData.stopping) {
                        // Process exited on its own (completed or crashed)
                        if (code === 0) {
                            console.log(`[AudioRecorder Test] SoX recording completed successfully for ${deviceId}. File: ${tempFilePath}`);
                            // Optionally resolve here if needed, or rely on timeout/stopTestRecording
                        } else {
                            console.error(`[AudioRecorder Test] SoX process for ${deviceId} exited with code ${code}, signal ${signal}. File may be incomplete: ${tempFilePath}`);
                            console.error(`[AudioRecorder SoX Test stderr output for ${deviceId} on exit]:\n${testStderrOutput}`);
                            // Optionally reject here if crash is critical
                        }
                    } else {
                        // Process was intentionally stopped
                        console.log(`[AudioRecorder Test] SoX process for ${deviceId} was intentionally stopped.`);
                        // Attempt to clean up the temporary file generated during the stopped test
                        fs.unlink(tempFilePath, (unlinkErr) => {
                            if (unlinkErr) console.error(`[AudioRecorder Test] Error deleting partial test file ${tempFilePath}: ${unlinkErr.message}`);
                            else console.log(`[AudioRecorder Test] Deleted partial test file ${tempFilePath} after stop.`);
                        });
                    }
                    // Clean up the map entry regardless of how it exited
                    this.testRecordingProcesses.delete(deviceId);
                }
            });

            // Add timeout to automatically stop recording after 'duration' seconds + buffer
            const stopTimeoutId = setTimeout(() => {
                console.log(`[AudioRecorder Test] Test duration (${duration}s) reached for ${deviceId}. Stopping recording.`);
                const currentProcessData = this.testRecordingProcesses.get(deviceId);
                // Only stop if the process is still associated with this timeout
                if (currentProcessData && currentProcessData.timeoutId === stopTimeoutId) {
                    this.stopTestRecording(deviceId); // Call the unified stop method
                } else {
                    console.log(`[AudioRecorder Test] Stop timeout for ${deviceId} skipped, process likely already exited or stopped.`);
                }
            }, (duration + 0.5) * 1000); // Reduce buffer slightly

            // Store the timeoutId
            processData.timeoutId = stopTimeoutId;

            resolve({ success: true, message: `Test recording started for ${duration} seconds.`, pid: testProcess.pid, filePath: tempFilePath });
        });
    }

    // --- NEW: Method to update device configuration ---
    updateDeviceConfig(deviceId, config) {
        if (!this.activeDevices.has(deviceId)) {
            console.warn(`Cannot update config for inactive device: ${deviceId}`);
            return false; // Or throw error?
        }
        const currentConfig = this.deviceConfigs.get(deviceId) || {};
        const newConfig = { ...currentConfig, ...config }; // Merge updates

        // Basic validation (can be enhanced)
        if (newConfig.gainDb !== undefined && typeof newConfig.gainDb !== 'number') {
            console.warn(`Invalid gainDb value provided for ${deviceId}: ${newConfig.gainDb}. Must be a number or null.`);
            newConfig.gainDb = null; // Reset or ignore? Resetting for safety.
        }
        if (newConfig.channels !== undefined && (!Array.isArray(newConfig.channels) || newConfig.channels.some(ch => typeof ch !== 'number' || ch < 1))) {
            console.warn(`Invalid channels value provided for ${deviceId}: ${JSON.stringify(newConfig.channels)}. Must be an array of positive integers or null.`);
            newConfig.channels = null; // Reset or ignore? Resetting for safety.
        }
        // Only store null if explicitly passed, otherwise keep existing or default
        if (config.gainDb === null) newConfig.gainDb = null;
        if (config.channels === null) newConfig.channels = null;


        this.deviceConfigs.set(deviceId, newConfig);
        console.log(`Updated config for device ${deviceId}:`, newConfig);
        return true;
    }
    // --- END NEW ---
}

module.exports = AudioRecorder;