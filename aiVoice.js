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

// Edit this if your model file has a different name or location
const PIPER_MODEL = 'en_US-ryan-medium';

module.exports = {
    /**
     * speak(sceneName):
     *  - Invokes Piper TTS with the "en_US-ryan-medium" voice
     *  - Streams text from echo into piper
     *  - Produces a WAV file, then plays it with `aplay` (Linux)
     */
    speak(sceneName) {
        // The text to be spoken
        const text = `Please prepare for scene: ${sceneName}.`;
        console.log(`[AI Voice (Piper)]: ${text}`);

        // Make a random wave file
        const waveFile = makeTempWaveFile();

        try {
            // 1) Generate the WAV using Piper
            //    Example: echo "Hello" | piper --model en_US-ryan-medium.onnx --output_file=out.wav
            let cmd = `echo "${text}" | piper --model ${PIPER_MODEL} --output_file "${waveFile}"`;
            execSync(cmd, { stdio: 'inherit' });

            // 2) Play the WAV locally
            //    On macOS, you might use `afplay`; on Windows, an alternative tool
            cmd = `aplay "${waveFile}"`;
            execSync(cmd, { stdio: 'inherit' });

        } catch (err) {
            console.error('Piper TTS error:', err.message);
        } finally {
            // Cleanup wave file
            if (fs.existsSync(waveFile)) {
                fs.unlinkSync(waveFile);
            }
        }
    }
};
