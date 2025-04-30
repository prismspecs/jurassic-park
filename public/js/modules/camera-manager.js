import { logToConsole } from './logger.js';
// Remove TF.js imports - they are now loaded globally via CDN script tags
// import * as poseDetection from '@tensorflow-models/pose-detection';
// import * as tf from '@tensorflow/tfjs-core';
// import '@tensorflow/tfjs-backend-webgl';

// Define connections between keypoints for drawing lines (using COCO keypoint indices)
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [0, 2], [1, 3], [2, 4],
  // Torso
  [5, 6], [5, 7], [7, 9], [9, 11], [6, 8], [8, 10], [10, 12], [5, 11], [6, 12], [11, 12],
  // Arms
  [5, 13], [13, 15], [15, 17], // Left arm (from observer's perspective)
  [6, 14], [14, 16], [16, 18], // Right arm
  // Legs
  [11, 19], [19, 21], [21, 23], // Left leg
  [12, 20], [20, 22], [22, 24]  // Right leg
];

// Define a color palette for different poses if needed
const POSE_COLORS = ['lime', 'cyan', 'magenta', 'yellow', 'orange', 'red'];

export class CameraManager {
  constructor() { // Removed socket parameter
    this.cameras = [];
    this.cameraElements = new Map();
    this.availableDevices = [];
    this.ptzDevices = [];
    this.serverDevices = [];
    this.cameraDefaults = [];
    // Removed latestPoseData map
    this.drawingLoops = new Map(); // Map<cameraName, { loopId: number, detector: poseDetection.PoseDetector, running: boolean }>
    this.poseDetector = null; // Store the detector instance
    this.tfjsBackendReady = false;

    this.initializeTfjs();
    // Removed WebSocket listener setup
  }

  async initializeTfjs() {
    try {
      logToConsole("Initializing TensorFlow.js backend...", "info");
      // Access global tf object loaded from CDN
      await tf.setBackend('webgl');
      await tf.ready();
      this.tfjsBackendReady = true;
      logToConsole("TensorFlow.js backend ready (WebGL).", "success");
      await this.loadPoseDetector();
    } catch (err) {
      logToConsole(`Error initializing TensorFlow.js: ${err.message}`, "error");
    }
  }

  async loadPoseDetector() {
    if (!this.tfjsBackendReady) {
      logToConsole("TF.js backend not ready, cannot load pose detector.", "warn");
      return;
    }
    if (this.poseDetector) {
      logToConsole("Pose detector already loaded.", "info");
      return;
    }
    try {
      logToConsole("Loading MoveNet pose detector model...", "info");
      // Access global poseDetection object loaded from CDN
      const model = poseDetection.SupportedModels.MoveNet;
      const detectorConfig = {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, // Use MultiPose Lightning for multiple people
        enableSmoothing: true,
        // multiPoseMaxDimension: 256 // Optional: Can reduce if performance is an issue
      };
      this.poseDetector = await poseDetection.createDetector(model, detectorConfig);
      logToConsole("MoveNet pose detector loaded successfully.", "success");
    } catch (err) {
      logToConsole(`Error loading pose detector: ${err.message}`, "error");
      this.poseDetector = null; // Ensure it's null on failure
    }
  }

  // Removed setupWebSocketListener()

  async initialize() {
    try {
      // --- Get Browser Devices and Request Permissions FIRST ---
      logToConsole("Attempting to enumerate browser devices...", "info");
      let browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
      this.availableDevices = browserDevicesRaw.filter(
        (device) => device.kind === "videoinput"
      );
      logToConsole(`Initial browser devices found: ${this.availableDevices.length}`, "info");
      if (this.availableDevices.length > 0) {
        const labelsMissing = !this.availableDevices[0].label;
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (labelsMissing || isMac) {
          logToConsole("Labels missing or on macOS, requesting camera access for labels...", "info");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach((track) => track.stop());
            browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
            this.availableDevices = browserDevicesRaw.filter(device => device.kind === "videoinput");
            logToConsole(`Browser devices after requesting permission: ${this.availableDevices.length}`, "info");
          } catch (err) {
            logToConsole(`Error requesting camera permission: ${err.message}`, "error");
          }
        }
      }

      // --- Get Server Configuration & Devices ---
      logToConsole("Fetching server configuration and devices...", "info");
      const camerasResponse = await fetch("/camera/cameras");
      if (!camerasResponse.ok) throw new Error(`HTTP error! status: ${camerasResponse.status}`);
      this.cameras = await camerasResponse.json(); // This now includes showSkeleton
      // Initialize showSkeleton state locally for each camera
      this.cameras.forEach(cam => cam.showSkeleton = false);

      const configResponse = await fetch("/config");
      if (!configResponse.ok) throw new Error(`HTTP error! status: ${configResponse.status}`);
      const config = await configResponse.json();
      this.cameraDefaults = config.cameraDefaults || [];

      const devicesResponse = await fetch("/camera/devices");
      if (!devicesResponse.ok) throw new Error(`HTTP error! status: ${devicesResponse.status}`);
      this.serverDevices = await devicesResponse.json(); // Still need server devices for Recording dropdown
      logToConsole(`Server reported ${this.serverDevices.length} devices`, "info");

      // --- Get PTZ Devices ---
      // Fetch PTZ devices regardless of initial camera count, as they might be needed later
      logToConsole("Fetching PTZ devices...", "info");
      try {
        const ptzResponse = await fetch("/camera/ptz-devices");
        if (ptzResponse.ok) {
          this.ptzDevices = await ptzResponse.json();
          logToConsole(`Found ${this.ptzDevices.length} PTZ devices`, "info");
        } else {
          this.ptzDevices = []; // Ensure it's an empty array on failure
          logToConsole(`Could not fetch PTZ devices: ${ptzResponse.statusText}`, "warn");
        }
      } catch (ptzError) {
        this.ptzDevices = [];
        logToConsole(`Error fetching PTZ devices: ${ptzError.message}`, "error");
      }


      this.renderCameraControls();
      logToConsole(`Camera manager initialized with ${this.cameras.length} cameras`, "success");

    } catch (err) {
      logToConsole(`Error initializing camera manager: ${err.message}`, "error");
    }
  }

  async addCamera() {
    const cameraIndex = this.cameras.length;
    const name = `Camera_${cameraIndex + 1}`;

    // Get the defaults for this camera index, or use empty defaults if none exist
    const defaults = this.cameraDefaults[cameraIndex] || {
      previewDevice: "",
      recordingDevice: "",
      ptzDevice: "",
    };

    try {
      logToConsole(`Adding new camera: ${name}...`, "info");
      const response = await fetch("/camera/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          previewDevice: defaults.previewDevice, // Use the determined path/ID
          recordingDevice: defaults.recordingDevice,
          ptzDevice: defaults.ptzDevice,
        }),
      });

      if (response.ok) {
        logToConsole(`Camera ${name} added successfully`, "success");
        await this.initialize(); // Refresh the camera list
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP error ${response.status}`);
      }
    } catch (err) {
      logToConsole(`Error adding camera: ${err.message}`, "error");
    }
  }

  async removeCamera(name) {
    if (!confirm(`Are you sure you want to remove camera '${name}'?`)) {
      return;
    }

    try {
      logToConsole(`Removing camera: ${name}...`, "warn");
      const response = await fetch("/camera/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        logToConsole(`Camera ${name} removed successfully`, "success");
        await this.initialize(); // Refresh the camera list
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP error ${response.status}`);
      }
    } catch (err) {
      logToConsole(`Error removing camera: ${err.message}`, "error");
    }
  }

  renderCameraControls() {
    const container = document.getElementById("cameraControls");
    if (!container) {
      console.error("Camera controls container not found!");
      logToConsole("Error: Camera controls container missing from DOM.", "error");
      return;
    }
    container.innerHTML = "";
    this.cameraElements.clear(); // Clear the map before re-rendering

    if (this.cameras.length === 0) {
      container.innerHTML = '<p>No cameras configured. Click "Add Camera" to set up a camera.</p>';
      return;
    }

    // --- Render controls for each camera ---
    this.cameras.forEach((camera) => {
      const cameraElement = this.createCameraElement(camera);
      container.appendChild(cameraElement);
      this.cameraElements.set(camera.name, cameraElement); // Store element reference
    });

    // --- Initial render of PTZ controls AFTER elements are in DOM ---
    this.cameras.forEach((camera) => {
      if (camera.ptzDevice) {
        // Check if the element exists before rendering
        const cameraElement = this.cameraElements.get(camera.name);
        if (cameraElement && container.contains(cameraElement)) {
          this.renderPTZControlsForCamera(camera.name, camera.ptzDevice);
        } else {
          console.warn(`Camera element for ${camera.name} not found in DOM for initial PTZ render.`);
        }
      }
    });
  }

  createCameraElement(camera) {
    const div = document.createElement("div");
    div.className = "camera-control";

    // --- Associative Lookup for Preview Device ---
    const configuredPreviewPath = camera.previewDevice; // e.g., "/dev/video2"
    let targetBrowserDeviceId = null;
    let currentPreviewDisplayLabel = "No device selected";
    let initialPreviewCallNeeded = false;

    if (configuredPreviewPath) {
      // 1. Find server device info using the configured path
      const matchedServerDevice = this.serverDevices.find(sd => sd.id === configuredPreviewPath);

      if (matchedServerDevice?.name) {
        // 2. Use server device name to find matching browser device (heuristic)
        // console.log(`[Camera: ${camera.name}] Searching for match for server name '${matchedServerDevice.name}' within these browser devices:`);
        // this.availableDevices.forEach((bd, index) => {
        //   console.log(`  Browser Device ${index}: label='${bd.label}', deviceId='${bd.deviceId}', kind='${bd.kind}', groupId='${bd.groupId}'`);
        // });
        const matchedBrowserDevice = this.availableDevices.find(bd =>
          bd.label && matchedServerDevice.name &&
          bd.label.startsWith(matchedServerDevice.name.split(' (')[0])
        );

        if (matchedBrowserDevice) {
          // 3. Get the actual browser device ID (hex string)
          targetBrowserDeviceId = matchedBrowserDevice.deviceId;
          currentPreviewDisplayLabel = matchedBrowserDevice.label || targetBrowserDeviceId;
          initialPreviewCallNeeded = true;
          // console.log(`[Camera: ${camera.name}] Associated config path '${configuredPreviewPath}' to browser deviceId '${targetBrowserDeviceId}' via name '${matchedServerDevice.name}' / label '${matchedBrowserDevice.label}'`);
        } else {
          // console.warn(`[Camera: ${camera.name}] Could not find matching browser device for server device named '${matchedServerDevice.name}' (path: ${configuredPreviewPath})`);
          currentPreviewDisplayLabel = `Browser device not found for ${configuredPreviewPath}`;
        }
      } else {
        // console.warn(`[Camera: ${camera.name}] Could not find server device info for configured path: ${configuredPreviewPath}`);
        currentPreviewDisplayLabel = `Server device info not found for ${configuredPreviewPath}`;
      }
    } else {
      // console.log(`[Camera: ${camera.name}] No previewDevice path configured.`);
    }
    // --- End Associative Lookup ---

    // Dynamically build the options for preview devices
    let previewOptionsHtml = '<option value="">Select Preview Device</option>';
    this.availableDevices.forEach(browserDevice => {
      // --- Refined Label Logic (using existing serverDevices list) ---
      const serverDevice = this.serverDevices.find(sd =>
        browserDevice.label && sd.name?.startsWith(browserDevice.label)
      );
      let displayLabel = browserDevice.label || `Device ID: ${browserDevice.deviceId.substring(0, 8)}...`;
      if (serverDevice) {
        displayLabel += ` (${serverDevice.id})`; // Append server path if found
      }
      // --- End Refined Label Logic ---

      // --- Use the LOOKED UP targetBrowserDeviceId for selection ---
      const selected = browserDevice.deviceId === targetBrowserDeviceId ? "selected" : "";
      // if (selected) {
      //   console.log(`[Camera: ${camera.name}] MATCH FOUND for selected preview option! Target Device:`, browserDevice);
      // }
      // --- End Selection Logic ---
      previewOptionsHtml += `<option value="${browserDevice.deviceId}" ${selected}>${displayLabel}</option>`;
    });

    // Dynamically build the options for recording devices
    let recordingOptionsHtml = '<option value="">Select Recording Device</option>';
    this.serverDevices.forEach(serverDevice => {
      const selected = serverDevice.id === camera.recordingDevice ? "selected" : "";
      recordingOptionsHtml += `<option value="${serverDevice.id}" ${selected}>${serverDevice.name || serverDevice.id}</option>`;
    });

    // Dynamically build the options for PTZ devices
    let ptzOptionsHtml = '<option value="">Select PTZ Device</option>';
    // console.log(`[Camera: ${camera.name}] Building PTZ options. Saved PTZ Device:`, camera.ptzDevice);
    // console.log(`[Camera: ${camera.name}] Available PTZ Devices:`, this.ptzDevices);
    this.ptzDevices.forEach(device => {
      const value = device.id || device.path;
      const selected = value === camera.ptzDevice ? "selected" : "";
      // if (selected) {
      //   console.log(`[Camera: ${camera.name}] MATCH FOUND! Setting selected for PTZ device:`, device);
      // }
      ptzOptionsHtml += `<option value="${value}" ${selected}>${device.name || value}</option>`;
    });

    // Checkbox state - now managed purely client-side
    const skeletonChecked = camera.showSkeleton ? 'checked' : '';

    div.innerHTML = `
          <div class="camera-header">
            <h3>${camera.name.replace(/_/g, ' ')}</h3>
            <button class="remove-btn" title="Remove ${camera.name}">❌</button>
          </div>
          <div class="camera-preview">
            <video id="preview-${camera.name}" autoplay playsinline></video>
            <canvas id="skeleton-canvas-${camera.name}" class="skeleton-overlay"></canvas> <!-- Add canvas for overlay -->
            <div class="device-info">Using: ${currentPreviewDisplayLabel}</div>
          </div>
          <div class="camera-settings">
            <div class="setting-group">
              <label>Preview Device:</label>
              <select class="preview-device">
                ${previewOptionsHtml}
              </select>
            </div>
            <div class="setting-group">
              <label>Recording Device:</label>
               <select class="recording-device">
                ${recordingOptionsHtml}
              </select>
            </div>
            <div class="setting-group">
              <label>PTZ Device:</label>
              <select class="ptz-device">
                 ${ptzOptionsHtml}
              </select>
            </div>
            <div class="setting-group skeleton-toggle-group">
              <label for="skeleton-toggle-${camera.name}">Show Skeleton:</label>
              <input type="checkbox" id="skeleton-toggle-${camera.name}" class="skeleton-toggle" ${skeletonChecked}>
            </div>
            <div class="ptz-controls-container">
              <!-- PTZ controls will be added here if a PTZ device is selected -->
            </div>
            <div class="camera-controls">
              <button class="test-record-btn">Test Record Video (${camera.name.replace(/_/g, ' ')})</button>
            </div>
          </div>
        `;

    // Add event listeners programmatically
    div.querySelector('.remove-btn').addEventListener('click', () => this.removeCamera(camera.name));
    div.querySelector('.preview-device').addEventListener('change', (e) => this.updatePreviewDevice(camera.name, e.target.value));
    div.querySelector('.recording-device').addEventListener('change', (e) => {
      // logToConsole('Recording Device changed to: ' + e.target.value, 'info'); // Now handled in update func
      this.updateRecordingDevice(camera.name, e.target.value);
    });
    div.querySelector('.ptz-device').addEventListener('change', (e) => this.updatePTZDevice(camera.name, e.target.value));
    div.querySelector('.test-record-btn').addEventListener('click', () => this.recordVideo(camera.name));
    // Add listener for the skeleton toggle
    div.querySelector('.skeleton-toggle').addEventListener('change', (e) => this.toggleSkeletonOverlay(camera.name, e.target.checked));

    // Initialize drawing state based on initial camera data
    // Use setTimeout to ensure elements are in DOM
    setTimeout(() => {
      // Ensure detector is loaded before trying to start drawing
      if (this.poseDetector) {
        this.updateSkeletonDrawing(camera.name, camera.showSkeleton);
      } else {
        logToConsole(`Pose detector not ready for ${camera.name}, delaying skeleton init.`, "warn");
        // Optionally, retry later or wait for detector load event
      }
    }, 150);

    // Initialize preview if a browser device was successfully associated
    if (initialPreviewCallNeeded && targetBrowserDeviceId) {
      logToConsole(`Initializing preview for ${camera.name} using associated browserId: ${targetBrowserDeviceId}`, "info");
      // console.log(`[Camera: ${camera.name}] Calling updatePreviewDevice with associated browserDeviceId:`, targetBrowserDeviceId);
      // Use setTimeout to ensure the element is fully in the DOM and getUserMedia doesn't block
      setTimeout(() => {
        // Pass the LOOKED UP targetBrowserDeviceId
        this.updatePreviewDevice(camera.name, targetBrowserDeviceId);
      }, 100);
    } else {
      // console.log(`[Camera: ${camera.name}] Skipping initial preview call. initialPreviewCallNeeded=${initialPreviewCallNeeded}, targetBrowserDeviceId=${targetBrowserDeviceId}`);
    }

    return div;
  }

  async updatePreviewDevice(cameraName, browserDeviceId) {
    logToConsole(`Updating preview device for ${cameraName} with browser device ID: ${browserDeviceId}`, "info");
    // console.log(`[Camera: ${cameraName}] Entered updatePreviewDevice with browserDeviceId:`, browserDeviceId); 
    try {
      // Update server - send browserDeviceId 
      // NOTE: Server needs to store this browserDeviceId now!
      const response = await fetch("/camera/preview-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, deviceId: browserDeviceId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logToConsole(`Error saving preview device selection: ${errorText}`, "error");
        // Optionally, revert the dropdown selection if saving failed?
      }

      const videoElement = document.getElementById(`preview-${cameraName}`);
      if (!videoElement) {
        logToConsole(`Video element for ${cameraName} not found`, "error");
        return;
      }

      // Stop any existing stream
      if (videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        videoElement.srcObject = null;
      }

      // Use browserDeviceId directly for getUserMedia
      if (browserDeviceId) {
        try {
          // console.log(`[Camera: ${cameraName}] Attempting getUserMedia with deviceId:`, browserDeviceId); 
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: browserDeviceId } }
          });
          // console.log(`[Camera: ${cameraName}] getUserMedia SUCCESSFUL. Stream:`, stream); 
          videoElement.srcObject = stream;

          const browserDevice = this.availableDevices.find(d => d.deviceId === browserDeviceId);
          const displayLabel = browserDevice ? (browserDevice.label || browserDeviceId) : 'Unknown';
          const deviceInfoElement = videoElement.nextElementSibling;
          if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) { // Check class
            deviceInfoElement.textContent = `Using: ${displayLabel}`;
          }
          logToConsole(`Preview for ${cameraName} started with device: ${displayLabel}`, "success");
        } catch (err) {
          logToConsole(`Error starting camera preview: ${err.message}`, "error");
          // console.error(`[Camera: ${cameraName}] getUserMedia FAILED:`, err); 
          // Clear label if getUserMedia fails
          const deviceInfoElement = videoElement.nextElementSibling;
          if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) {
            deviceInfoElement.textContent = `Error: ${err.message}`;
          }
        }
      } else {
        // No device selected, just update the info text
        const deviceInfoElement = videoElement.nextElementSibling;
        if (deviceInfoElement && deviceInfoElement.classList.contains('device-info')) {
          deviceInfoElement.textContent = "No device selected";
        }
      }
    } catch (err) {
      logToConsole(`Error updating preview device: ${err.message}`, "error");
    }
  }

  async updateRecordingDevice(cameraName, serverDeviceId) {
    logToConsole(`Setting recording device for ${cameraName} with server device ID: ${serverDeviceId}`, "info");
    try {
      const response = await fetch("/camera/recording-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, deviceId: serverDeviceId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logToConsole(`Error setting recording device: ${errorText}`, "error");
        throw new Error(`Server error: ${response.status}`);
      }

      const responseData = await response.json();
      logToConsole(`Recording device set for ${cameraName}`, "success");
    } catch (err) {
      logToConsole(`Error updating recording device: ${err.message}`, "error");
    }
  }

  async updatePTZDevice(cameraName, serverDeviceId) {
    logToConsole(`Setting PTZ device for ${cameraName} with server device ID: ${serverDeviceId}`, "info");
    try {
      const response = await fetch("/camera/ptz-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, deviceId: serverDeviceId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logToConsole(`Error setting PTZ device: ${errorText}`, "error");
        throw new Error(`Server error: ${response.status}`);
      }

      const responseData = await response.json();
      logToConsole(`PTZ device set for ${cameraName}`, "success");

      // Render PTZ controls after setting a device
      this.renderPTZControlsForCamera(cameraName, serverDeviceId);

    } catch (err) {
      logToConsole(`Error updating PTZ device: ${err.message}`, "error");
    }
  }

  // Function to render PTZ controls for a specific camera
  renderPTZControlsForCamera(cameraName, ptzDeviceId) {
    const cameraElement = this.cameraElements.get(cameraName);
    if (!cameraElement) return;

    const ptzContainer = cameraElement.querySelector('.ptz-controls-container');
    if (!ptzContainer) return;

    // Clear previous controls
    ptzContainer.innerHTML = '';

    // Only render controls if a valid PTZ device is selected
    if (ptzDeviceId) {
      // Use unique IDs per camera instance
      const panId = `ptz-pan-${cameraName}`;
      const tiltId = `ptz-tilt-${cameraName}`;
      const zoomId = `ptz-zoom-${cameraName}`;
      const panValueId = `ptz-pan-value-${cameraName}`;
      const tiltValueId = `ptz-tilt-value-${cameraName}`;
      const zoomValueId = `ptz-zoom-value-${cameraName}`;

      ptzContainer.innerHTML = `
          <div class="ptz-control-group">
            <label for="${panId}">Pan:</label>
            <input type="range" id="${panId}" name="pan" min="-468000" max="468000" step="3600" value="0" 
                   title="Pan">
            <span id="${panValueId}" class="ptz-value-display">0.0°</span> 
          </div>
          <div class="ptz-control-group">
            <label for="${tiltId}">Tilt:</label>
            <input type="range" id="${tiltId}" name="tilt" min="-324000" max="324000" step="3600" value="0"
                   title="Tilt">
            <span id="${tiltValueId}" class="ptz-value-display">0.0°</span> 
          </div>
          <div class="ptz-control-group">
            <label for="${zoomId}">Zoom:</label>
            <input type="range" id="${zoomId}" name="zoom" min="0" max="100" step="1" value="0"
                   title="Zoom">
            <span id="${zoomValueId}" class="ptz-value-display">0%</span> 
          </div>
        `;

      // Add event listeners programmatically
      document.getElementById(panId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'pan', e.target.value));
      document.getElementById(tiltId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'tilt', e.target.value));
      document.getElementById(zoomId).addEventListener('input', (e) => this.handlePTZInputChange(cameraName, 'zoom', e.target.value));

    } else {
      ptzContainer.innerHTML = '<p class="ptz-placeholder">Select a PTZ device to enable controls.</p>';
    }
  }

  // Handler for PTZ slider input changes
  handlePTZInputChange(cameraName, control, value) {
    const rawValue = parseInt(value);
    let displayValue = '';
    let displaySpanId = '';

    // Update display span based on control type
    switch (control) {
      case 'pan':
        displayValue = (rawValue / 3600).toFixed(1) + '°';
        displaySpanId = `ptz-pan-value-${cameraName}`;
        break;
      case 'tilt':
        displayValue = (rawValue / 3600).toFixed(1) + '°';
        displaySpanId = `ptz-tilt-value-${cameraName}`;
        break;
      case 'zoom':
        displayValue = rawValue + '%';
        displaySpanId = `ptz-zoom-value-${cameraName}`;
        break;
    }

    const displaySpan = document.getElementById(displaySpanId);
    if (displaySpan) {
      displaySpan.textContent = displayValue;
    }

    // Call the existing method to send data to the server (add throttling/debouncing here if needed)
    this.updatePTZ(cameraName, control, rawValue);
  }

  // Method to send PTZ command to server
  async updatePTZ(cameraName, control, value) {
    // Add debouncing or throttling here if PTZ updates are too frequent
    try {
      const response = await fetch("/camera/ptz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraName,
          [control]: parseInt(value)
        }),
      });
      // Optional: log success/failure based on response.ok
      if (!response.ok) {
        logToConsole(`PTZ update failed for ${cameraName}: ${response.statusText}`, 'warn');
      }
    } catch (err) {
      logToConsole(`Error sending PTZ command: ${err.message}`, "error");
    }
  }

  // Specific method to trigger test recording for ONE camera
  async recordVideo(cameraName) {
    logToConsole(`Starting test recording for ${cameraName}...`, "info");
    const statusElement = document.getElementById("status");
    if (statusElement) statusElement.innerText = `Recording from ${cameraName}...`;

    const pipelineElement = document.getElementById("recording-pipeline");
    const resolutionElement = document.getElementById("recording-resolution");

    const pipeline = pipelineElement ? pipelineElement.value : 'gstreamer'; // Default if element not found
    const useFfmpeg = pipeline === "ffmpeg";
    const resolution = resolutionElement ? resolutionElement.value : '1920x1080'; // Default

    try {
      const response = await fetch(
        `/camera/${encodeURIComponent(cameraName)}/record?useFfmpeg=${useFfmpeg}&resolution=${resolution}`,
        { method: "POST" }
      );

      if (!response.ok) {
        const errorText = await response.text(); // Get error details
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      logToConsole(`Recording complete for ${cameraName}. Output: ${result.overlayName}`, "success");
      if (statusElement) statusElement.innerText = `Recording finished: ${result.overlayName}`;

      // Construct correct video path using current session ID
      const sessionIdElement = document.getElementById('current-session-id');
      const currentSessionId = sessionIdElement ? sessionIdElement.textContent.trim() : null; // TRIM the whitespace

      const vidDiv = document.getElementById("videos");

      if (vidDiv && currentSessionId && result.overlayName) {
        const videoPath = `/recordings/${encodeURIComponent(currentSessionId)}/${encodeURIComponent(result.overlayName)}`;
        logToConsole(`Displaying video: ${videoPath}`, "info");
        // Display the video in the #videos div 
        // (Consider creating separate video elements per camera test)
        vidDiv.innerHTML = `
            <h3>Test Overlay Video (${cameraName.replace(/_/g, ' ')})</h3>
            <video controls src="${videoPath}"></video>
          `;
      } else if (!currentSessionId) {
        logToConsole("Could not find current session ID to display video", "error");
      } else if (!vidDiv) {
        logToConsole("Video display container '#videos' not found.", "error");
      }
    } catch (error) {
      logToConsole(`Recording error for ${cameraName}: ${error.message}`, "error");
      if (statusElement) statusElement.innerText = `Recording failed: ${error.message}`;
    }
  }

  // Updated method to handle skeleton toggle - NO backend call
  async toggleSkeletonOverlay(cameraName, show) {
    logToConsole(`Toggling skeleton overlay for ${cameraName} to ${show}`, "info");

    // Update local state directly
    const camera = this.cameras.find(c => c.name === cameraName);
    if (camera) {
      camera.showSkeleton = show;
    } else {
      logToConsole(`Camera ${cameraName} not found locally for skeleton toggle.`, "warn");
      return; // Don't proceed if camera isn't found
    }

    // Ensure detector is loaded before trying to draw
    if (!this.poseDetector) {
      await this.loadPoseDetector(); // Attempt to load if not already loaded
      if (!this.poseDetector) {
        logToConsole(`Pose detector failed to load. Cannot ${show ? 'start' : 'stop'} skeleton drawing for ${cameraName}.`, "error");
        // Revert checkbox state
        const checkbox = document.getElementById(`skeleton-toggle-${cameraName}`);
        if (checkbox) checkbox.checked = !show;
        if (camera) camera.showSkeleton = !show; // Revert local state too
        return;
      }
    }

    // Trigger drawing logic update
    this.updateSkeletonDrawing(cameraName, show);
    logToConsole(`Skeleton overlay for ${cameraName} toggled locally to ${show}`, "success");
  }

  // Starts or stops the pose detection and drawing loop
  updateSkeletonDrawing(cameraName, show) {
    let loopInfo = this.drawingLoops.get(cameraName);
    const canvas = document.getElementById(`skeleton-canvas-${cameraName}`);
    const video = document.getElementById(`preview-${cameraName}`);

    if (!canvas || !video) {
      logToConsole(`Cannot ${show ? 'start' : 'stop'} drawing loop for ${cameraName}: canvas or video element not found.`, "warn");
      return;
    }

    if (show) {
      if (!this.poseDetector) {
        logToConsole(`Pose detector not ready for ${cameraName}. Cannot start drawing.`, "error");
        return; // Don't start if detector isn't ready
      }
      if (!loopInfo || !loopInfo.running) {
        logToConsole(`Starting skeleton detection/drawing loop for ${cameraName}`, "info");
        canvas.style.display = 'block'; // Show canvas

        const detectAndDraw = async () => {
          if (!this.drawingLoops.get(cameraName)?.running) return; // Stop if flag turned false

          try {
            const poses = await this.poseDetector.estimatePoses(video, {
              // maxPoses: 5, // Default for MultiPose
              // flipHorizontal: false // Default
            });
            this.drawSkeletonFrame(cameraName, canvas, video, poses);
          } catch (err) {
            logToConsole(`Error during pose estimation for ${cameraName}: ${err.message}`, "error");
            // Consider stopping the loop on repeated errors
          }

          // Continue the loop
          const currentLoopInfo = this.drawingLoops.get(cameraName);
          if (currentLoopInfo?.running) {
            currentLoopInfo.loopId = requestAnimationFrame(detectAndDraw);
            this.drawingLoops.set(cameraName, currentLoopInfo);
          }
        };

        // Initialize or update loop info
        if (!loopInfo) {
          loopInfo = { loopId: null, running: true };
        } else {
          loopInfo.running = true;
        }
        this.drawingLoops.set(cameraName, loopInfo);
        detectAndDraw(); // Start the loop

      } else {
        logToConsole(`Loop already running for ${cameraName}`, "info");
      }
    } else {
      // Stop the loop
      if (loopInfo && loopInfo.running) {
        logToConsole(`Stopping skeleton detection/drawing loop for ${cameraName}`, "info");
        loopInfo.running = false;
        if (loopInfo.loopId) {
          cancelAnimationFrame(loopInfo.loopId);
          loopInfo.loopId = null;
        }
        this.drawingLoops.set(cameraName, loopInfo); // Update state

        // Clear the canvas when stopping
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none'; // Hide canvas
      }
    }
  }

  // Actual drawing logic for a single frame - ACCEPTS POSES
  drawSkeletonFrame(cameraName, canvas, video, poses) {
    const ctx = canvas.getContext('2d');
    // Removed fetching from latestPoseData

    // Ensure canvas size matches video display size
    const videoWidth = video.clientWidth;
    const videoHeight = video.clientHeight;
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!poses || poses.length === 0) {
      return; // No poses to draw
    }

    poses.forEach((pose, poseIndex) => {
      // Use pose.keypoints directly (MoveNet provides x, y, score, name)
      if (!pose || !pose.keypoints) return; // Check for valid pose data

      const keypoints = pose.keypoints;
      const color = POSE_COLORS[poseIndex % POSE_COLORS.length];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;

      // --- Draw Connections ---
      POSE_CONNECTIONS.forEach(([i, j]) => {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];

        // Check if keypoints and their scores are valid (e.g., score > 0.1)
        if (kp1 && kp2 && kp1.score > 0.1 && kp2.score > 0.1) {
          // Keypoints x, y are already in pixel coordinates relative to the input video
          // We need to scale them if the displayed video size differs from the detection size
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;

          const x1 = kp1.x * scaleX;
          const y1 = kp1.y * scaleY;
          const x2 = kp2.x * scaleX;
          const y2 = kp2.y * scaleY;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });

      // --- Draw Keypoints ---
      keypoints.forEach((kp) => {
        if (kp && kp.score > 0.1) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;
          const x = kp.x * scaleX;
          const y = kp.y * scaleY;

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2 * Math.PI); // Draw a small circle for each keypoint
          ctx.fill();
        }
      });
    });
  }
}