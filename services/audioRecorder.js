const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
// TODO: Choose and import an audio recording library (e.g., node-record-lpcm16)
// const record = require('node-record-lpcm16');

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
                                id: device.coreaudio_device_uid || `mac_audio_${index}`,
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
            const { process, filePath } = this.recordingProcesses.get(deviceId);
            console.log(`Stopping recording for device ${deviceId}...`);
            
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
        } else {
            console.log(`No active recording process found for device ${deviceId} to stop.`);
        }
    }

    startRecording(sessionPath, durationSec = null) {
        if (this.activeDevices.size === 0) {
            console.log("No active audio devices selected for recording.");
            return;
        }

        if (!fs.existsSync(sessionPath)) {
            console.error(`Session path does not exist: ${sessionPath}`);
            // Optionally create it? fs.mkdirSync(sessionPath, { recursive: true });
            return;
        }

        console.log(`Starting audio recording for ${this.activeDevices.size} devices in session: ${sessionPath}`);
        this.recordingCounter++; // Increment for this recording session (Action!)

        this.activeDevices.forEach((deviceData, deviceId) => {
            // First, ensure we stop any existing recording for this device
            if (this.recordingProcesses.has(deviceId)) {
                console.warn(`Device ${deviceId} is already recording. Stopping the current recording first.`);
                this._stopDeviceRecording(deviceId);
                // Wait a moment to ensure cleanup and pass duration, use sessionPath directly
                setTimeout(() => this._startDeviceRecording(deviceId, deviceData, sessionPath, durationSec), 500);
            } else {
                // Pass duration, use sessionPath directly
                this._startDeviceRecording(deviceId, deviceData, sessionPath, durationSec);
            }
        });
    }
    
    _startDeviceRecording(deviceId, deviceData, sessionPath, durationSec = null) {
        // Format a proper device number for the filename
        const deviceNumber = this.activeDevices.size > 1 ? 
            Array.from(this.activeDevices.keys()).indexOf(deviceId) + 1 : 1;
        
        // Create device-specific directory directly under sessionPath
        const deviceAudioDir = path.join(sessionPath, `Audio_${deviceNumber}`);
        if (!fs.existsSync(deviceAudioDir)) {
            fs.mkdirSync(deviceAudioDir, { recursive: true });
            console.log(`Created device audio directory: ${deviceAudioDir}`);
        }
        
        const fileName = `original.wav`; // Set fixed filename
        const filePath = path.join(deviceAudioDir, fileName);

        console.log(`Starting recording for ${deviceData.name} (${deviceId}) -> ${filePath}`);

        let recorderProcess;
        // Build arecord command with optional duration
        let command = `arecord -D ${deviceId} -f cd -t wav`;
        if (durationSec && durationSec > 0) {
            command += ` -d ${Math.ceil(durationSec)}`; // Use ceil to ensure full duration
            console.log(`Recording duration set to ${Math.ceil(durationSec)} seconds.`);
        } else {
             console.warn(`No duration specified for recording ${filePath}. It may run indefinitely until manually stopped.`);
        }
        command += ` "${filePath}"`; // Add file path at the end, quoted
        
        if (this.platform === 'linux') {
            console.log(`Executing: ${command}`);
            recorderProcess = exec(command, (error, stdout, stderr) => {
                // This callback executes when the process *finishes* or errors *during* execution.
                // We rely on the 'exit' event for cleanup after explicit stopping.
                if (error && !recorderProcess.killed) { // Check !killed because we expect an error on SIGTERM/SIGKILL
                    console.error(`arecord process error for ${deviceId}: ${stderr || error.message}`);
                    if (this.recordingProcesses.has(deviceId) && !this.recordingProcesses.get(deviceId).stopping) {
                        this.recordingProcesses.delete(deviceId); // Clean up if startup failed, but only if not already stopping
                    }
                }
            });
        } else if (this.platform === 'darwin') {
            // Example using 'sox' or 'ffmpeg'. Requires installation.
            // ffmpeg -f avfoundation -i ":<device_index_or_uid>" -ar 44100 -ac 1 output.wav
            // Finding the correct index/UID mapping might need more work from detectAudioInputDevices
            console.warn(`Recording implementation for macOS needs specific library/tool setup (e.g., ffmpeg, sox). Device ID used: ${deviceId}`);
            // Placeholder: Replace with actual command using ffmpeg or sox and the correct device identifier
            let macCommand = `ffmpeg -f avfoundation -i ":${deviceId}" -ar 44100 -ac 1`;
            if (durationSec && durationSec > 0) {
                macCommand += ` -t ${Math.ceil(durationSec)}`;
                console.log(`Recording duration set to ${Math.ceil(durationSec)} seconds.`);
            } else {
                 console.warn(`No duration specified for recording ${filePath}. It may run indefinitely until manually stopped.`);
            }
            macCommand += ` "${filePath}"`;
            console.log(`Executing (Placeholder for macOS): ${macCommand}`);
            // recorderProcess = exec(macCommand, ...);
            // For now, create a mock process to allow testing flow
            recorderProcess = exec(`sleep 3600`); // Mock long-running process
        } else {
            console.error(`Recording not supported on platform: ${this.platform}`);
            return; // Skip this device
        }

        // Store the process handle and file path
        this.recordingProcesses.set(deviceId, { process: recorderProcess, filePath, stopping: false });

        // Set exit handler early to ensure we catch any unexpected exits
        recorderProcess.on('exit', (code, signal) => {
            const recordingData = this.recordingProcesses.get(deviceId);
            // Only handle exits if the process is still tracked and wasn't manually stopped
            if (recordingData && !recordingData.stopping) {
                if (code === 0) {
                    // Process likely finished due to duration - this is expected, not an error
                    console.log(`Recording process for ${deviceId} finished cleanly (duration reached?). Code: ${code}, Signal: ${signal}`);
                } else {
                    // Non-zero exit code indicates a potential problem
                    console.warn(`Recording process for ${deviceId} exited unexpectedly with code ${code}, signal ${signal}.`);
                }
                // Clean up since it exited on its own
                this.recordingProcesses.delete(deviceId);
            }
            // If recordingData.stopping is true, the exit is handled by _stopDeviceRecording
        });

        recorderProcess.on('error', (err) => {
            console.error(`Failed to start recording process for ${deviceId}:`, err);
            if (this.recordingProcesses.has(deviceId) && !this.recordingProcesses.get(deviceId).stopping) {
                this.recordingProcesses.delete(deviceId); // Clean up on startup error
            }
        });

        console.log(`Recording process started for ${deviceId} with PID: ${recorderProcess.pid}`);
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
         console.log(`Starting 3-second test recording for device: ${deviceId}`);
         if (!this.activeDevices.has(deviceId)) {
             return { success: false, message: `Device ${deviceId} is not selected as an active device.` };
         }
         const deviceData = this.activeDevices.get(deviceId);
         const tempFileName = `test_audio_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.wav`;
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

             if (this.platform === 'linux') {
                  testProcess = exec(`arecord -D ${deviceId} -f cd -t wav -d ${duration} ${tempFilePath}`);
             } else if (this.platform === 'darwin') {
                  console.warn(`Test recording implementation for macOS needs specific library/tool setup (e.g., ffmpeg, sox). Device ID used: ${deviceId}`);
                 // Placeholder: Replace with actual command using ffmpeg or sox
                 // testProcess = exec(`ffmpeg -f avfoundation -i ":${deviceId}" -t ${duration} -ar 44100 -ac 1 ${tempFilePath}`);
                  testProcess = exec(`sleep ${duration}`); // Mock process

             } else {
                 console.error(`Test recording not supported on platform: ${this.platform}`);
                 return reject(new Error(`Test recording not supported on platform: ${this.platform}`));
             }

             this.recordingProcesses.set(deviceId, { process: testProcess, filePath: tempFilePath }); // Track test recording temporarily

             testProcess.on('error', (err) => {
                 console.error(`Failed to start test recording process for ${deviceId}:`, err);
                 this.recordingProcesses.delete(deviceId); // Clean up
                 reject(new Error(`Failed to start test recording: ${err.message}`));
             });

             testProcess.on('exit', (code, signal) => {
                 this.recordingProcesses.delete(deviceId); // Clean up tracker
                 if (code === 0 || signal === 'SIGTERM') { // arecord might exit with code 0 on duration end
                     console.log(`Test recording for ${deviceId} completed successfully. File: ${tempFilePath}`);
                     resolve({ success: true, message: `Test recording saved to ${tempFilePath}`, filePath: tempFilePath });
                 } else {
                     console.error(`Test recording process for ${deviceId} failed with code ${code}, signal ${signal}.`);
                     // Optionally delete the file
                     // fs.unlink(tempFilePath, ()=>{});
                     reject(new Error(`Test recording failed (code: ${code}, signal: ${signal})`));
                 }
             });

             console.log(`Test recording process started for ${deviceId} with PID: ${testProcess.pid}, duration: ${duration}s`);
         });
     }

}

module.exports = AudioRecorder; 