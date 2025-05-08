const express = require('express');
const router = express.Router();
const { Worker } = require('worker_threads'); // Import Worker
const CameraControl = require('../services/cameraControl');
const cameraControl = require('../services/cameraControl').getInstance();
const ffmpegHelper = require('../services/ffmpegHelper');
const gstreamerHelper = require('../services/gstreamerHelper');
const config = require('../config.json'); // Read the full config
const sessionService = require('../services/sessionService');
const path = require('path');
const fs = require('fs');
const { broadcastConsole } = require('../websocket/broadcaster'); // Import broadcaster

// --- Auto-add default camera on startup ---
async function initializeDefaultCamera() {
    try {
        if (config.cameraDefaults && Array.isArray(config.cameraDefaults)) {
            const numCamerasToAdd = Math.min(config.cameraDefaults.length, 2); // Add up to 2 cameras

            for (let i = 0; i < numCamerasToAdd; i++) {
                const defaultCameraConfig = config.cameraDefaults[i];
                const defaultCameraName = `Camera_${i + 1}`;

                if (defaultCameraConfig) {
                    // Check if camera already exists
                    if (!cameraControl.getCamera(defaultCameraName)) {
                        console.log(`[Server Init] Attempting to add default camera '${defaultCameraName}' on startup...`);
                        console.log(`[Server Init] Defaults for ${defaultCameraName} from config:`, defaultCameraConfig);
                        await cameraControl.addCamera(
                            defaultCameraName,
                            defaultCameraConfig.previewDevice,
                            defaultCameraConfig.recordingDevice,
                            defaultCameraConfig.ptzDevice
                        );
                        console.log(`Default camera '${defaultCameraName}' added with config:`, defaultCameraConfig);
                    } else {
                        console.log(`Default camera '${defaultCameraName}' already exists.`);
                    }
                } else {
                    console.warn(`No default camera configuration found in config.json for camera index ${i}.`);
                }
            }
            if (numCamerasToAdd === 0) {
                console.warn('No default camera configurations found in config.json (cameraDefaults is empty or not an array).');
            }
        } else {
            console.warn('No default camera configurations found in config.json (cameraDefaults is missing or not an array).');
        }
    } catch (err) {
        console.error('Error initializing default camera(s):', err);
    }
}

// Call the initialization function
initializeDefaultCamera();
// ------------------------------------------

// Get available cameras
router.get('/cameras', (req, res) => {
    const cameras = cameraControl.getCameras();
    // Log the state being returned to the client
    console.log(`[Route GET /cameras] Returning camera states:`, JSON.stringify(cameras, null, 2));
    res.json(cameras);
});

// Add a new camera
router.post('/add', async (req, res) => {
    console.log(`[Route /add] Received request body:`, req.body); // Log the incoming request body
    const { name, previewDevice, recordingDevice, ptzDevice } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    try {
        const success = await cameraControl.addCamera(name, previewDevice, recordingDevice, ptzDevice);
        if (success) {
            res.json({ success: true, message: `Camera ${name} added` });
        } else {
            res.status(400).json({ success: false, message: `Camera ${name} already exists` });
        }
    } catch (err) {
        console.error('Error adding camera:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Remove a camera
router.delete('/:cameraName', (req, res) => {
    const { cameraName } = req.params;
    if (!cameraName) {
        return res.status(400).json({ success: false, message: 'Camera name parameter is required' });
    }
    try {
        const success = cameraControl.removeCamera(cameraName);
        if (success) {
            res.json({ success: true, message: `Camera ${cameraName} removed` });
        } else {
            res.status(404).json({ success: false, message: `Camera ${cameraName} not found` });
        }
    } catch (err) {
        console.error(`Error removing camera ${cameraName}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get available devices
router.get('/devices', async (req, res) => {
    try {
        const devices = await cameraControl.detectVideoDevices();
        res.json(devices);
    } catch (err) {
        console.error('Error getting devices:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get available PTZ devices
router.get('/ptz-devices', async (req, res) => {
    try {
        // Only scan for PTZ devices if there are cameras configured
        const cameras = cameraControl.getCameras();
        if (cameras.length === 0) {
            return res.json([]);
        }

        const devices = await cameraControl.scanPTZDevices();
        res.json(devices);
    } catch (err) {
        console.error('Error getting PTZ devices:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set preview device for a camera
router.post('/preview-device', (req, res) => {
    // Log the received request body immediately
    console.log(`[Route /preview-device] Received request body:`, req.body);
    broadcastConsole(`[Route /preview-device] Received body: ${JSON.stringify(req.body)}`, 'debug'); // Also broadcast

    const { cameraName, deviceId } = req.body;
    if (!cameraName || deviceId === null || typeof deviceId === 'undefined') {
        console.warn(`[Route /preview-device] Validation failed: cameraName='${cameraName}', deviceId='${deviceId}' (type: ${typeof deviceId})`);
        broadcastConsole(`[Route /preview-device] Validation failed: cameraName='${cameraName}', deviceId='${deviceId}'`, 'warn');
        return res.status(400).json({ success: false, message: 'Camera name and a valid device ID (including 0) are required' });
    }

    try {
        cameraControl.setPreviewDevice(cameraName, deviceId);
        res.json({ success: true, message: 'Preview device set' });
    } catch (err) {
        console.error('Error setting preview device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set recording device for a camera
router.post('/recording-device', (req, res) => {
    const { cameraName, deviceId } = req.body;
    if (!cameraName || !deviceId) {
        return res.status(400).json({ success: false, message: 'Camera name and device path are required' });
    }

    try {
        cameraControl.setRecordingDevice(cameraName, deviceId);
        console.log(`Recording device set for camera: ${cameraName}, device path: ${deviceId}`);
        res.json({ success: true, message: 'Recording device set' });
    } catch (err) {
        console.error('Error setting recording device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set PTZ device for a camera
router.post('/ptz-device', (req, res) => {
    console.log(`[Route /ptz-device] Received request body:`, req.body); // Log the incoming request body
    const { cameraName, deviceId } = req.body;
    if (!cameraName || !deviceId) {
        return res.status(400).json({ success: false, message: 'Camera name and device ID are required' });
    }

    try {
        cameraControl.setPTZDevice(cameraName, deviceId);
        res.json({ success: true, message: 'PTZ device set' });
    } catch (err) {
        console.error('Error setting PTZ device:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Set PTZ for a specific camera
router.post('/ptz', (req, res) => {
    const { cameraName, pan, tilt, zoom } = req.body;
    if (!cameraName) {
        return res.status(400).json({ success: false, message: 'Camera name is required' });
    }

    try {
        cameraControl.setPTZ(cameraName, { pan, tilt, zoom });
        res.json({ success: true, message: 'PTZ command sent' });
    } catch (err) {
        console.error('PTZ error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Toggle skeleton overlay for a specific camera
router.post('/:cameraName/toggle-skeleton', (req, res) => {
    const { cameraName } = req.params;
    const { show } = req.body; // Expecting { show: true/false }

    if (typeof show !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Invalid value for "show". Must be true or false.' });
    }

    try {
        const camera = cameraControl.getCamera(cameraName);
        if (!camera) {
            return res.status(404).json({ success: false, message: `Camera ${cameraName} not found` });
        }

        camera.setShowSkeleton(show);
        // Optionally broadcast this change if other clients need to know
        // broadcast({ type: 'SKELETON_TOGGLED', cameraName: cameraName, show: show });
        broadcastConsole(`Skeleton overlay for ${cameraName} set to ${show}`, 'info');
        res.json({ success: true, message: `Skeleton overlay for ${cameraName} set to ${show}` });

    } catch (err) {
        console.error(`Error toggling skeleton for ${cameraName}:`, err);
        broadcastConsole(`Error toggling skeleton for ${cameraName}: ${err.message}`, 'error');
        res.status(500).json({ success: false, message: err.message });
    }
});

// Record video from a specific camera using a Worker Thread
router.post('/:cameraName/record', (req, res) => { // Remove async, no top-level await needed
    const { cameraName } = req.params;
    const { useFfmpeg, resolution } = req.query;

    try {
        console.log(`[Record Route] Handling request for: ${cameraName}`);
        broadcastConsole(`[Record Route] Handling request for: ${cameraName}`, 'info');
        const camera = cameraControl.getCamera(cameraName);
        if (!camera) {
            console.error(`[Record Route] Camera not found: ${cameraName}`);
            broadcastConsole(`[Record Route] Camera not found: ${cameraName}`, 'error');
            return res.status(404).json({ success: false, message: `Camera ${cameraName} not found` });
        }
        console.log(`[Record Route] Found camera instance for ${cameraName}`);

        const devicePath = camera.getRecordingDevice();
        console.log(`[Record Route] Retrieved recording device ID from instance: ${devicePath}`);

        if (!devicePath && devicePath !== 0) {
            const errorMsg = `No recording device configured for camera ${cameraName}`;
            console.error(`[Record Route] ${errorMsg}`);
            broadcastConsole(`[Record Route] ${errorMsg}`, 'error');
            return res.status(400).json({ success: false, message: errorMsg });
        }

        // Get Session Directory
        let sessionDir;
        try {
            sessionDir = sessionService.getSessionDirectory();
        } catch (sessionError) {
            console.error(`[Record Route] Error getting session directory for ${cameraName}:`, sessionError);
            broadcastConsole(`[Record Route] Error getting session directory: ${sessionError.message}`, 'error');
            return res.status(500).json({ success: false, message: 'Could not determine session directory.' });
        }

        // Parse resolution
        let width = 1920;
        let height = 1080;
        if (resolution && resolution.includes('x')) {
            [width, height] = resolution.split('x').map(Number);
        } else {
            console.warn(`[Record Route] Invalid resolution '${resolution}', defaulting to ${width}x${height}.`);
        }

        const workerData = {
            cameraName,
            useFfmpeg: useFfmpeg === 'true',
            resolution: { width, height },
            devicePath,
            sessionDirectory: sessionDir
            // durationSec is not passed for test recordings, worker uses default
        };

        console.log(`[Record Route] Starting worker for ${cameraName}...`);
        broadcastConsole(`[Record Route] Starting worker for ${cameraName}...`, 'info');

        // --- Start the Worker ---
        const worker = new Worker(path.resolve(__dirname, '../workers/recordingWorker.js'), {
            workerData
        });

        worker.on('message', (message) => {
            console.log(`[Worker ${cameraName}] Message:`, message);
            // Broadcast worker status updates to the frontend
            broadcastConsole(`[Worker ${cameraName}] ${message.status}: ${message.message || ''}`, message.status === 'error' ? 'error' : 'info');
            // Look for 'capture_complete' now
            if (message.status === 'capture_complete') {
                broadcastConsole(`[Worker ${cameraName}] Video capture complete! Output: ${message.resultPath}`, 'success');
                // Post-processing is no longer done by worker
            }
        });

        worker.on('error', (error) => {
            console.error(`[Worker ${cameraName}] Error:`, error);
            broadcastConsole(`[Worker ${cameraName}] Fatal error: ${error.message}`, 'error');
            // Optionally, send a specific error status back to the client who initiated?
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`[Worker ${cameraName}] Exited with code ${code}`);
                broadcastConsole(`[Worker ${cameraName}] Worker stopped unexpectedly (code ${code})`, 'error');
            } else {
                console.log(`[Worker ${cameraName}] Exited successfully after capture.`);
                // Message was already sent on 'capture_complete'
            }
        });

        // --- Respond Immediately --- 
        // Don't wait for the worker to finish
        res.json({
            success: true,
            message: `Recording process initiated for ${cameraName}. Check console/UI for progress.`
            // overlayName is no longer available immediately, worker sends it on completion
        });

    } catch (err) {
        // Catch synchronous errors during setup before worker starts
        console.error(`[Record Route] Pre-worker error for ${cameraName}:`, err);
        broadcastConsole(`[Record Route] Failed to start recording for ${cameraName}: ${err.message}`, 'error');
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update camera configuration
router.post('/:cameraName/config', async (req, res) => {
    const { cameraName } = req.params;
    const updates = req.body; // e.g., { previewDevice: '...', recordingDevice: '...' }

    if (!cameraName) {
        return res.status(400).json({ success: false, message: 'Camera name parameter required.' });
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'No configuration updates provided.' });
    }

    console.log(`[Route /config] Received config update for ${cameraName}:`, updates);
    broadcastConsole(`Received config update for ${cameraName}: ${JSON.stringify(updates)}`, 'debug');

    try {
        const camera = cameraControl.getCamera(cameraName);
        if (!camera) {
            return res.status(404).json({ success: false, message: `Camera ${cameraName} not found.` });
        }

        // Apply updates - Add more setters to CameraControl as needed
        if (updates.previewDevice !== undefined) {
            cameraControl.setPreviewDevice(cameraName, updates.previewDevice);
            broadcastConsole(`Preview device updated for ${cameraName}.`, 'info');
        }
        if (updates.recordingDevice !== undefined) {
            cameraControl.setRecordingDevice(cameraName, updates.recordingDevice);
            broadcastConsole(`Recording device updated for ${cameraName}.`, 'info');
        }
        if (updates.ptzDevice !== undefined) {
            cameraControl.setPTZDevice(cameraName, updates.ptzDevice);
            broadcastConsole(`PTZ device updated for ${cameraName}.`, 'info');
        }
        // Add other config updates here (e.g., showSkeleton, showMask if managed server-side)
        // if (updates.showSkeleton !== undefined) camera.setShowSkeleton(updates.showSkeleton);

        res.json({ success: true, message: `Configuration updated for ${cameraName}` });

    } catch (err) {
        console.error(`Error updating config for ${cameraName}:`, err);
        broadcastConsole(`Error updating config for ${cameraName}: ${err.message}`, 'error');
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;