// aiVoice.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load config
const config = require('../config.json');

// Helper: random wave file in /tmp or OS temp dir
function makeTempWaveFile() {
    const randomPart = Math.random().toString(36).slice(2);
    return path.join(os.tmpdir(), `piper_${randomPart}.wav`);
}

// Model name for Piper (Linux, Windows, etc.)
const PIPER_MODEL = 'en_US-ryan-medium';

// Get model directory from config
const PIPER_MODEL_DIR = path.join(__dirname, '..', config.piperDir || 'piper');

// Ensure Piper model directory exists
if (!fs.existsSync(PIPER_MODEL_DIR)) {
    fs.mkdirSync(PIPER_MODEL_DIR, { recursive: true });
}

// Bypass flag - set to true to skip voice output
let bypassEnabled = true;

// Broadcast function
let broadcastConsole = null;

module.exports = {
    // Initialize with broadcast function
    init(broadcastFn) {
        broadcastConsole = broadcastFn;
    },

    // Get current bypass state
    getBypassState() {
        return bypassEnabled;
    },

    // Enable/disable bypass mode
    setBypass(enabled) {
        bypassEnabled = enabled;
        if (broadcastConsole) {
            broadcastConsole(`[AI Voice]: Bypass mode ${enabled ? 'enabled' : 'disabled'}`);
        }
    },

    speak(text) {
        if (broadcastConsole) {
            broadcastConsole(`[AI Voice]: ${text}`);
        }
        
        // If bypass is enabled, just log and return
        if (bypassEnabled) {
            if (broadcastConsole) {
                broadcastConsole(`[AI Voice Bypass]: Would have spoken: "${text}"`);
            }
            return;
        }

        if (process.platform === 'darwin') {
            // macOS: use the built-in 'say' command
            try {
                execSync(`say "${text}"`, { stdio: 'inherit' });
            } catch (err) {
                if (broadcastConsole) {
                    broadcastConsole('macOS say error: ' + err.message, 'error');
                }
            }
        } else {
            // Non-macOS: use Piper
            //if (broadcastConsole) {
            //    broadcastConsole('(Using Piper TTS, since not on macOS)');
            //}

            // Make a random wave file
            const waveFile = makeTempWaveFile();

            try {
                // 1) Generate WAV using Piper with custom model directory
                let cmd = `echo "${text}" | piper --model "${PIPER_MODEL_DIR}/${PIPER_MODEL}.onnx" --output_file "${waveFile}"`;
                execSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] });

                // 2) Play the WAV (Linux example with `aplay`)
                cmd = `aplay "${waveFile}"`;
                execSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] });

            } catch (err) {
                if (broadcastConsole) {
                    broadcastConsole('Piper TTS error: ' + err.message, 'error');
                }
            } finally {
                // Cleanup wave file
                if (fs.existsSync(waveFile)) {
                    fs.unlinkSync(waveFile);
                }
            }
        }
    }
};