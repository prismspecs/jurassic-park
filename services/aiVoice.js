// aiVoice.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper: random wave file in /tmp or OS temp dir
function makeTempWaveFile() {
    const randomPart = Math.random().toString(36).slice(2);
    return path.join(os.tmpdir(), `piper_${randomPart}.wav`);
}

// Model name for Piper (Linux, Windows, etc.)
const PIPER_MODEL = 'en_US-ryan-medium';

// Bypass flag - set to true to skip voice output
let bypassEnabled = false;

module.exports = {
    // Enable/disable bypass mode
    setBypass(enabled) {
        bypassEnabled = enabled;
        console.log(`[AI Voice]: Bypass mode ${enabled ? 'enabled' : 'disabled'}`);
    },

    speak(text) {
        console.log(`[AI Voice]: ${text}`);
        
        // If bypass is enabled, just log and return
        if (bypassEnabled) {
            console.log(`[AI Voice Bypass]: Would have spoken: "${text}"`);
            return;
        }

        if (process.platform === 'darwin') {
            // macOS: use the built-in 'say' command
            try {
                execSync(`say "${text}"`, { stdio: 'inherit' });
            } catch (err) {
                console.error('macOS say error:', err.message);
            }
        } else {
            // Non-macOS: use Piper
            //console.log('(Using Piper TTS, since not on macOS)');

            // Make a random wave file
            const waveFile = makeTempWaveFile();

            try {
                // 1) Generate WAV using Piper
                let cmd = `echo "${text}" | piper --model ${PIPER_MODEL} --output_file "${waveFile}"`;
                execSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] });

                // 2) Play the WAV (Linux example with `aplay`)
                cmd = `aplay "${waveFile}"`;
                execSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] });

            } catch (err) {
                console.error('Piper TTS error:', err.message);
            } finally {
                // Cleanup wave file
                if (fs.existsSync(waveFile)) {
                    fs.unlinkSync(waveFile);
                }
            }
        }
    }
};