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
                // Example using arecord -l. Might need refinement based on output format.
                // Consider alternatives like pactl list sources for PulseAudio.
                exec('arecord -l', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error detecting audio devices on Linux (arecord -l):', stderr || error.message);
                        // Fallback or alternative method could be tried here
                        return reject(new Error(`Failed to list audio devices: ${stderr || error.message}`));
                    }
                    // Extremely basic parsing, needs improvement for robustness
                    const devices = [];
                    const lines = stdout.split('\\n');
                    let currentCard = null;
                    let currentDevice = null;
                    const deviceRegex = /^card\\s+(\\d+):.*?\\((.*?)\\), device\\s+(\\d+): (.*?)\\s+\\[.*\\]$/;
                    const subdeviceRegex = /^\\s+Subdevice #(\\d+): (subdevice #\\d+)$/;

                    lines.forEach(line => {
                         const cardMatch = line.match(/^card (\d+): (.*?) \[(.*?)\]/);
                        const deviceMatch = line.match(/^\s*device (\d+): (.*?) \[(.*?)\]/);

                        if (cardMatch) {
                            currentCard = { id: `hw:${cardMatch[1]}`, name: cardMatch[2].trim(), driver: cardMatch[3].trim() };
                        } else if (deviceMatch && currentCard) {
                             // Filter for capture devices explicitly if possible, or assume all listed might be inputs
                            // The naming convention 'hw:card,device' is typical for ALSA.
                             const deviceId = `hw:${currentCard.id.split(':')[1]},${deviceMatch[1]}`;
                             const deviceName = deviceMatch[2].trim();
                             // Basic filtering: Avoid devices with 'Playback' or known output names
                             if (!deviceName.toLowerCase().includes('playback') && !deviceName.toLowerCase().includes('hdmi')) {
                                 devices.push({
                                    id: deviceId, // e.g., hw:0,0
                                    name: `${currentCard.name} - ${deviceName}` // e.g., HDA Intel PCH - ALC295 Analog
                                 });
                             }
                        }
                    });


                    if (devices.length === 0) {
                         console.warn("arecord -l parsing yielded no devices. Output was:", stdout);
                         // Consider trying pactl list sources if pactl is likely available
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
            // Send SIGTERM first for graceful shutdown
            process.kill('SIGTERM');

            // Set a timeout to forcefully kill if it doesn't terminate
            const killTimeout = setTimeout(() => {
                if (!process.killed) {
                    console.warn(`Recording process for ${deviceId} did not exit gracefully, sending SIGKILL.`);
                    process.kill('SIGKILL');
                }
            }, 2000); // 2 seconds grace period

            process.on('exit', (code, signal) => {
                clearTimeout(killTimeout);
                if (code === 0 || signal === 'SIGTERM') {
                    console.log(`Recording stopped successfully for device ${deviceId}. File saved to: ${filePath}`);
                } else {
                    console.error(`Recording process for ${deviceId} exited with code ${code}, signal ${signal}. File might be incomplete: ${filePath}`);
                    // Optionally, attempt to delete the potentially corrupt file
                    // fs.unlink(filePath, (err) => { if (err) console.error(`Failed to delete incomplete file ${filePath}:`, err); });
                }
                this.recordingProcesses.delete(deviceId); // Remove from tracking
            });

             process.on('error', (err) => {
                 clearTimeout(killTimeout);
                 console.error(`Error in recording process for ${deviceId}:`, err);
                 this.recordingProcesses.delete(deviceId);
             });

        } else {
            console.log(`No active recording process found for device ${deviceId} to stop.`);
        }
    }


    startRecording(sessionPath) {
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
            const fileName = `Audio_${this.recordingCounter}_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.wav`; // Create a unique name per device per recording
            const filePath = path.join(sessionPath, fileName);

            // Ensure we don't start recording on a device already recording
            if (this.recordingProcesses.has(deviceId)) {
                console.warn(`Device ${deviceId} is already recording. Skipping.`);
                return;
            }

            console.log(`Starting recording for ${deviceData.name} (${deviceId}) -> ${filePath}`);

            let recorderProcess;
            if (this.platform === 'linux') {
                // Example using arecord directly. Choose format, rate, etc.
                // arecord -D hw:0,0 -f S16_LE -r 44100 -c 1 filename.wav
                 recorderProcess = exec(`arecord -D ${deviceId} -f cd -t wav ${filePath}`, (error, stdout, stderr) => {
                     // This callback executes when the process *finishes* or errors *during* execution.
                     // We rely on the 'exit' event for cleanup after explicit stopping.
                     if (error && !recorderProcess.killed) { // Check !killed because we expect an error on SIGTERM/SIGKILL
                         console.error(`arecord process error for ${deviceId}: ${stderr || error.message}`);
                         this.recordingProcesses.delete(deviceId); // Clean up if startup failed
                     }
                 });

            } else if (this.platform === 'darwin') {
                // Example using 'sox' or 'ffmpeg'. Requires installation.
                // ffmpeg -f avfoundation -i ":<device_index_or_uid>" -ar 44100 -ac 1 output.wav
                // Finding the correct index/UID mapping might need more work from detectAudioInputDevices
                 console.warn(`Recording implementation for macOS needs specific library/tool setup (e.g., ffmpeg, sox). Device ID used: ${deviceId}`);
                 // Placeholder: Replace with actual command using ffmpeg or sox and the correct device identifier
                 // recorderProcess = exec(`ffmpeg -f avfoundation -i ":${deviceId}" -ar 44100 -ac 1 ${filePath}`, ...);
                 // For now, create a mock process to allow testing flow
                 recorderProcess = exec('sleep 3600'); // Mock long-running process


            } else {
                 console.error(`Recording not supported on platform: ${this.platform}`);
                 return; // Skip this device
            }

             // Store the process handle and file path
             this.recordingProcesses.set(deviceId, { process: recorderProcess, filePath });

             recorderProcess.on('error', (err) => {
                 console.error(`Failed to start recording process for ${deviceId}:`, err);
                 this.recordingProcesses.delete(deviceId); // Clean up on startup error
             });

             recorderProcess.on('exit', (code, signal) => {
                // This listener is mostly for logging unexpected exits.
                // We handle cleanup in _stopDeviceRecording based on our explicit stop action.
                 if (this.recordingProcesses.has(deviceId)) { // Check if we haven't already cleaned up via _stopDeviceRecording
                    console.warn(`Recording process for ${deviceId} exited unexpectedly with code ${code}, signal ${signal}.`);
                    this.recordingProcesses.delete(deviceId);
                 }
             });


            console.log(`Recording process started for ${deviceId} with PID: ${recorderProcess.pid}`);
        });
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