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
    this.availableDevices = []; // Browser devices { deviceId, label, kind }
    this.ptzDevices = [];       // Server PTZ devices { id, name, path }
    this.serverDevices = [];    // Server video devices { id, name }
    this.cameraDefaults = [];
    this.serverToBrowserDeviceMap = new Map(); // Map<serverID, browserDeviceId>
    // Removed latestPoseData map
    // this.drawingLoops = new Map();
    // this.poseDetector = null;
    // this.tfjsBackendReady = false;
    // this.initializeTfjs();
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
      // Ensure labels are available
      if (this.availableDevices.length > 0 && !this.availableDevices[0].label) {
        logToConsole("Labels missing, requesting camera access for labels...", "info");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((track) => track.stop());
          browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
          this.availableDevices = browserDevicesRaw.filter(device => device.kind === "videoinput");
          logToConsole(`Browser devices after requesting permission: ${this.availableDevices.length}`, "info");
          this.availableDevices.forEach(d => logToConsole(` -> Device: ${d.label} (${d.deviceId})`, "info"));
        } catch (err) {
          logToConsole(`Error requesting camera permission: ${err.message}`, "error");
          // Proceeding without labels might still work if names match, but log error
        }
      }

      // --- Get Server Configuration & Devices ---
      logToConsole("Fetching server configuration and devices...", "info");
      const camerasResponse = await fetch("/camera/cameras");
      if (!camerasResponse.ok) throw new Error(`HTTP error! status: ${camerasResponse.status}`);
      this.cameras = await camerasResponse.json(); // Includes showSkeleton
      // Initialize showSkeleton state locally for each camera
      this.cameras.forEach(cam => cam.showSkeleton = false);

      const configResponse = await fetch("/config");
      if (!configResponse.ok) throw new Error(`HTTP error! status: ${configResponse.status}`);
      const config = await configResponse.json();
      this.cameraDefaults = config.cameraDefaults || [];

      const devicesResponse = await fetch("/camera/devices");
      if (!devicesResponse.ok) throw new Error(`HTTP error! status: ${devicesResponse.status}`);
      this.serverDevices = await devicesResponse.json();
      logToConsole(`Server reported ${this.serverDevices.length} devices`, "info");
      this.serverDevices.forEach(d => logToConsole(` -> Server Device: ${d.name} (ID: ${d.id})`, "info"));


      // --- Get PTZ Devices ---
      logToConsole("Fetching PTZ devices...", "info");
      try {
        const ptzResponse = await fetch("/camera/ptz-devices");
        if (ptzResponse.ok) {
          this.ptzDevices = await ptzResponse.json();
          logToConsole(`Found ${this.ptzDevices.length} PTZ devices`, "info");
        } else {
          this.ptzDevices = [];
          logToConsole(`Could not fetch PTZ devices: ${ptzResponse.statusText}`, "warn");
        }
      } catch (ptzError) {
        this.ptzDevices = [];
        logToConsole(`Error fetching PTZ devices: ${ptzError.message}`, "error");
      }

      // --- Map Server Devices to Browser Devices ---
      logToConsole("Attempting to map server devices to browser devices...", "info");
      this.serverToBrowserDeviceMap.clear();
      const browserVideoDevices = this.availableDevices; // Already filtered

      this.serverDevices.forEach(serverDevice => {
        // Attempt to find matching browser device (heuristic based on name)
        const serverDeviceNamePart = serverDevice.name?.split(' (')[0]; // e.g., "OBSBOT Tiny 2 Lite StreamCamera"
        let matchedBrowserDevice = null;

        if (serverDeviceNamePart && browserVideoDevices.length > 0) {
          matchedBrowserDevice = browserVideoDevices.find(bd =>
            bd.label && bd.label.startsWith(serverDeviceNamePart)
          );
        }

        // Fallback: Try matching by index if names fail? (Only reliable if order is guaranteed)
        // if (!matchedBrowserDevice && typeof serverDevice.id === 'number' && browserVideoDevices[serverDevice.id]) {
        //     logToConsole(`Warning: Falling back to index-based mapping for server device ${serverDevice.id}`, "warn");
        //     matchedBrowserDevice = browserVideoDevices[serverDevice.id];
        // }

        if (matchedBrowserDevice) {
          this.serverToBrowserDeviceMap.set(serverDevice.id, matchedBrowserDevice.deviceId);
          logToConsole(`Mapped server device ${serverDevice.id} (${serverDevice.name}) to browser device ${matchedBrowserDevice.deviceId} (${matchedBrowserDevice.label})`, "success");
        } else {
          logToConsole(`Could not find matching browser device for server device ${serverDevice.id} (${serverDevice.name || 'No Name'}). Preview might not work.`, "warn");
          this.serverToBrowserDeviceMap.set(serverDevice.id, null); // Store null to indicate no match
        }
      });
      logToConsole("Finished mapping server devices.", "info");


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
      previewDevice: "", // Expecting server ID or path here initially
      recordingDevice: "",
      ptzDevice: "",
    };

    // --- Determine the default SERVER ID based on the default previewDevice path/name ---
    let defaultServerId = '';
    if (defaults.previewDevice) {
      // Find the server device that matches the default path/name string
      const matchingServerDevice = this.serverDevices.find(sd => sd.id === defaults.previewDevice || sd.name === defaults.previewDevice);
      if (matchingServerDevice) {
        defaultServerId = matchingServerDevice.id;
        logToConsole(`Using default Server ID: ${defaultServerId} for new camera based on config value: ${defaults.previewDevice}`);
      } else {
        logToConsole(`Warning: Could not find server device matching default preview value: ${defaults.previewDevice}`);
      }
    }


    try {
      logToConsole(`Adding new camera: ${name}...`, "info");
      // Step 1: Send POST request to add the camera on the server
      const addResponse = await fetch("/camera/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // Send the determined server ID (or empty string)
          previewDevice: defaultServerId,
          recordingDevice: defaults.recordingDevice, // Keep these as potentially paths/indices for now
          ptzDevice: defaults.ptzDevice,
        }),
      });

      if (addResponse.ok) {
        logToConsole(`Camera ${name} added on server. Fetching updated list...`, "success");

        // --- MODIFICATION START ---
        // Step 2: Fetch the complete updated list of cameras
        const camerasResponse = await fetch("/camera/cameras");
        if (!camerasResponse.ok) {
          throw new Error(`Failed to fetch updated camera list: ${camerasResponse.status}`);
        }
        const updatedCameras = await camerasResponse.json();

        // Step 3: Identify the newly added camera
        const existingNames = new Set(this.cameras.map(cam => cam.name));
        const newCamera = updatedCameras.find(cam => !existingNames.has(cam.name));

        if (!newCamera) {
          logToConsole("Could not identify the newly added camera in the updated list.", "error");
          return;
        }
        logToConsole(`Identified new camera: ${newCamera.name}`, "info");

        // Get the container
        const container = document.getElementById("cameraControls");
        if (!container) {
          logToConsole("Error: Camera controls container missing from DOM.", "error");
          return;
        }

        // Clear "No cameras" message if necessary
        if (this.cameras.length === 0 && container.querySelector('p')) {
          container.innerHTML = '';
        }

        // Step 4 & 5: Create and append the element for ONLY the new camera
        newCamera.showSkeleton = false; // Initialize client-side state for new camera
        const cameraElement = this.createCameraElement(newCamera);
        container.appendChild(cameraElement);
        this.cameraElements.set(newCamera.name, cameraElement); // Add to map

        // Render PTZ controls for the new camera if needed
        if (newCamera.ptzDevice) {
          this.renderPTZControlsForCamera(newCamera.name, newCamera.ptzDevice);
        }

        // Step 6: Update the internal list to match the server state
        this.cameras = updatedCameras.map(cam => ({
          ...cam, // Keep server data
          showSkeleton: this.cameras.find(c => c.name === cam.name)?.showSkeleton ?? false
        }));

        logToConsole(`Camera ${newCamera.name} UI added incrementally.`, "success");
        // --- MODIFICATION END ---

      } else {
        const error = await addResponse.json();
        throw new Error(error.message || `HTTP error ${addResponse.status}`);
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
      // Stop preview if running
      const videoElement = document.getElementById(`preview-${name}`);
      if (videoElement?.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
        logToConsole(`Stopped preview for removed camera ${name}.`, "info");
      }
      // Stop skeleton drawing loop if running
      this.updateSkeletonDrawing(name, false); // Ensure loop stops and cleans up
      // this.drawingLoops.delete(name); // Remove from map

      const response = await fetch("/camera/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        logToConsole(`Camera ${name} removed successfully`, "success");
        // --- Remove UI Element ---
        const cameraElement = this.cameraElements.get(name);
        if (cameraElement) {
          cameraElement.remove();
          this.cameraElements.delete(name);
        }
        // Update internal list
        this.cameras = this.cameras.filter(cam => cam.name !== name);

        // Show "No cameras" message if needed
        const container = document.getElementById("cameraControls");
        if (this.cameras.length === 0 && container) {
          container.innerHTML = '<p>No cameras configured. Click "Add Camera" to set up a camera.</p>';
        }

        // Don't need full re-initialize anymore
        // await this.initialize();
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
    div.id = `camera-control-${camera.name}`; // Add unique ID to the main div


    // --- Build Preview Device Options using Browser Device IDs ---
    let previewOptionsHtml = '<option value="">Select Preview Device</option>';
    // Get the BROWSER device ID corresponding to the camera's saved SERVER previewDevice ID
    const currentPreviewBrowserDeviceId = this.serverToBrowserDeviceMap.get(camera.previewDevice);

    this.serverDevices.forEach(serverDevice => {
      const browserDeviceId = this.serverToBrowserDeviceMap.get(serverDevice.id);
      const displayLabel = serverDevice.name || serverDevice.id; // User-friendly label

      if (browserDeviceId) {
        // Value is the BROWSER Device ID
        // Check if this browserDeviceId matches the one mapped from the saved server ID
        const selected = browserDeviceId === currentPreviewBrowserDeviceId ? "selected" : "";
        previewOptionsHtml += `<option value="${browserDeviceId}" ${selected}>${displayLabel}</option>`;
      } else {
        // Option for server devices that couldn't be mapped to a browser device
        previewOptionsHtml += `<option value="" disabled>${displayLabel} (Not found/mappable)</option>`;
      }
    });


    // Dynamically build the options for recording devices (using server ID)
    let recordingOptionsHtml = '<option value="">Select Recording Device</option>';
    this.serverDevices.forEach(serverDevice => {
      // Value remains the server device ID (index or path)
      const selected = serverDevice.id === camera.recordingDevice ? "selected" : "";
      recordingOptionsHtml += `<option value="${serverDevice.id}" ${selected}>${serverDevice.name || serverDevice.id}</option>`;
    });

    // Dynamically build the options for PTZ devices (using server ID/path)
    let ptzOptionsHtml = '<option value="">Select PTZ Device</option>';
    this.ptzDevices.forEach(device => {
      const value = device.id !== undefined ? device.id : device.path;
      const selected = value === camera.ptzDevice ? "selected" : "";
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
            <video id="preview-${camera.name}" autoplay playsinline muted></video> <!-- Added muted -->
            <!-- <canvas id="skeleton-canvas-${camera.name}" class="skeleton-overlay"></canvas> --> <!-- REMOVED -->
            <div class="device-info">Using: No device selected</div>
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
            <div class="setting-group pose-toggle-group">
                <label for="pose-detection-toggle-${camera.name}">Enable Pose FX:</label>
                <input type="checkbox" id="pose-detection-toggle-${camera.name}" class="pose-detection-toggle">
            </div>
            <div class="setting-group pose-fx-options" style="display: none;">
                 <label for="skeleton-draw-toggle-${camera.name}">Draw Skeleton:</label>
                <input type="checkbox" id="skeleton-draw-toggle-${camera.name}" class="skeleton-draw-toggle">
            </div>
             <div class="setting-group pose-fx-options" style="display: none;">
                <label for="mask-apply-toggle-${camera.name}">Apply Simple Mask:</label>
                <input type="checkbox" id="mask-apply-toggle-${camera.name}" class="mask-apply-toggle">
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
    div.querySelector('.recording-device').addEventListener('change', (e) => this.updateRecordingDevice(camera.name, e.target.value));
    div.querySelector('.ptz-device').addEventListener('change', (e) => this.updatePTZDevice(camera.name, e.target.value));
    div.querySelector('.test-record-btn').addEventListener('click', () => this.recordVideo(camera.name));

    // --- New Pose FX Toggle Logic ---
    const poseDetectionToggle = div.querySelector('.pose-detection-toggle');
    const poseFxOptions = div.querySelectorAll('.pose-fx-options');
    const skeletonDrawToggle = div.querySelector('.skeleton-draw-toggle');
    const maskApplyToggle = div.querySelector('.mask-apply-toggle');

    // Listener for the main Pose FX enable/disable toggle
    poseDetectionToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.togglePoseDetection(camera.name, enabled); // Call new handler method
      // Show/hide sub-options
      poseFxOptions.forEach(opt => opt.style.display = enabled ? '' : 'none');
      // Uncheck sub-options when disabling main toggle
      if (!enabled) {
        if (skeletonDrawToggle) skeletonDrawToggle.checked = false;
        if (maskApplyToggle) maskApplyToggle.checked = false;
        // Also tell compositor to disable specific effects
        if (window.mainCompositor && camera.name === 'Camera_1') {
          window.mainCompositor.setDrawSkeletonOverlay(false);
          window.mainCompositor.setDrawBoundingBoxMask(false);
        }
      }
    });

    // Listener for Draw Skeleton toggle
    if (skeletonDrawToggle) {
      skeletonDrawToggle.addEventListener('change', (e) => {
        if (window.mainCompositor && camera.name === 'Camera_1') {
          window.mainCompositor.setDrawSkeletonOverlay(e.target.checked);
        }
      });
    }
    // Listener for Apply Mask toggle
    if (maskApplyToggle) {
      maskApplyToggle.addEventListener('change', (e) => {
        if (window.mainCompositor && camera.name === 'Camera_1') {
          window.mainCompositor.setDrawBoundingBoxMask(e.target.checked);
        }
      });
    }
    // --- End New Pose FX Toggle Logic ---

    // Initialize drawing state based on initial camera data
    setTimeout(() => {
      // if (this.poseDetector) {
      //   this.updateSkeletonDrawing(camera.name, camera.showSkeleton);
      // } else {
      //   logToConsole(`Pose detector not ready for ${camera.name}, delaying skeleton init.`, "warn");
      // }
    }, 150);

    // --- ADDED: Automatically start preview if a device is pre-selected ---
    if (camera.previewDevice) { // camera.previewDevice holds the SERVER ID/path
      const browserDeviceId = this.serverToBrowserDeviceMap.get(camera.previewDevice); // Get corresponding BROWSER ID
      if (browserDeviceId) {
        logToConsole(`[Auto Preview] Triggering preview for ${camera.name} with browser device ID: ${browserDeviceId} (mapped from server default: ${camera.previewDevice})`, "info");
        setTimeout(() => {
          // Check if the element still exists before updating
          if (document.getElementById(div.id)) {
            this.updatePreviewDevice(camera.name, browserDeviceId); // Pass BROWSER device ID
          } else {
            logToConsole(`[Auto Preview] Camera element ${camera.name} removed before preview could start.`, "warn");
          }
        }, 100); // Small delay
      } else {
        logToConsole(`[Auto Preview] Could not find browser device mapping for default server device ${camera.previewDevice} on ${camera.name}. Preview not started.`, "warn");
      }
    }
    // --- END ADDED ---

    // --- MODIFICATION START: Robust initial selection ---
    logToConsole(`[${camera.name}] Setting initial preview. Server default ID: ${camera.previewDevice}`, 'debug');
    // Re-check the map *now*
    let initialBrowserDeviceId = this.serverToBrowserDeviceMap.get(camera.previewDevice);

    if (initialBrowserDeviceId) {
      logToConsole(`[${camera.name}] Found corresponding browser deviceId in map: ${initialBrowserDeviceId}`, 'debug');
      // Check if this deviceId actually exists in the dropdown options
      const optionExists = Array.from(div.querySelector('.preview-device').options).some(opt => opt.value === initialBrowserDeviceId);
      if (optionExists) {
        div.querySelector('.preview-device').value = initialBrowserDeviceId;
        logToConsole(`[${camera.name}] Set preview dropdown to: ${initialBrowserDeviceId}`, 'debug');
      } else {
        logToConsole(`[${camera.name}] Warning: Mapped browser deviceId ${initialBrowserDeviceId} not found in dropdown options!`, 'warn');
        initialBrowserDeviceId = null; // Reset if not found in dropdown
      }
    } else {
      logToConsole(`[${camera.name}] No corresponding browser deviceId found in map for server ID ${camera.previewDevice}.`, 'warn');
    }

    // Add change listener AFTER setting the initial value
    div.querySelector('.preview-device').addEventListener('change', (e) =>
      this.updatePreviewDevice(camera.name, e.target.value)
    );

    // Call updatePreviewDevice slightly delayed *if* we found a valid initial device
    if (initialBrowserDeviceId) {
      logToConsole(`[${camera.name}] Scheduling initial updatePreviewDevice for ${initialBrowserDeviceId}...`, 'debug');
      setTimeout(() => {
        logToConsole(`[${camera.name}] Executing delayed initial updatePreviewDevice for ${initialBrowserDeviceId}...`, 'debug');
        this.updatePreviewDevice(camera.name, initialBrowserDeviceId);
      }, 200); // Delay by 200ms
    } else {
      logToConsole(`[${camera.name}] Skipping initial updatePreviewDevice call as no valid browser device was selected.`, 'info');
    }
    // --- MODIFICATION END ---

    return div;
  }

  // --- Updated updatePreviewDevice ---
  async updatePreviewDevice(cameraName, browserDeviceId) { // Parameter is now BROWSER Device ID
    logToConsole(`Updating preview device for ${cameraName} using browser device ID: ${browserDeviceId}`, "info");

    const videoElement = document.getElementById(`preview-${cameraName}`);
    if (!videoElement) {
      logToConsole(`Error: Video element preview-${cameraName} not found!`, "error");
      return;
    }

    // Find the sibling device-info div MORE reliably
    const cameraElement = this.cameraElements.get(cameraName); // Use the stored element reference
    let deviceInfoElement = null;
    if (cameraElement) {
      deviceInfoElement = cameraElement.querySelector('.device-info');
    } else {
      logToConsole(`Could not find camera element wrapper for ${cameraName}`, "warn");
    }


    // Stop any existing stream
    if (videoElement.srcObject) {
      const tracks = videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoElement.srcObject = null;
      if (deviceInfoElement) deviceInfoElement.textContent = 'Using: No device selected';
      logToConsole(`Stopped existing preview stream for ${cameraName}.`, "info");
      // Also stop skeleton drawing if it was running for the old stream
      this.updateSkeletonDrawing(cameraName, false);
    }

    if (!browserDeviceId) {
      logToConsole(`No preview device selected for ${cameraName}. Clearing preview.`, "info");
      // Update the camera object state locally (store empty server ID)
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) cam.previewDevice = '';
      // Optionally notify server (currently no endpoint for clearing)
      // await fetch(`/camera/preview-device`, { method: "POST", ... body: { cameraName, deviceId: '' } });
      return;
    }

    try {
      // Find the label for the selected browser device ID for display
      const selectedBrowserDevice = this.availableDevices.find(bd => bd.deviceId === browserDeviceId);
      const browserDeviceLabel = selectedBrowserDevice ? (selectedBrowserDevice.label || `Unnamed Device (${browserDeviceId.substring(0, 6)}...)`) : `Unknown (${browserDeviceId.substring(0, 6)}...)`;

      // --- Get Desired Resolution from UI ---
      let requestedWidth = 1920; // Default width
      let requestedHeight = 1080; // Default height
      const resolutionSelect = document.getElementById('recording-resolution');
      if (resolutionSelect) {
        const selectedValue = resolutionSelect.value;
        const parts = selectedValue.split('x');
        if (parts.length === 2) {
          const parsedWidth = parseInt(parts[0], 10);
          const parsedHeight = parseInt(parts[1], 10);
          if (!isNaN(parsedWidth) && !isNaN(parsedHeight) && parsedWidth > 0 && parsedHeight > 0) {
            requestedWidth = parsedWidth;
            requestedHeight = parsedHeight;
            console.info(`[${cameraName}] Using resolution from dropdown: ${requestedWidth}x${requestedHeight}`);
          } else {
            console.warn(`[${cameraName}] Invalid resolution value parsed: ${selectedValue}. Using defaults.`);
          }
        } else {
          console.warn(`[${cameraName}] Invalid resolution format in dropdown: ${selectedValue}. Using defaults.`);
        }
      } else {
        console.warn(`[${cameraName}] Recording resolution dropdown (#recording-resolution) not found. Using defaults.`);
      }
      // --- End Get Desired Resolution ---

      // 1. Request the stream using the BROWSER device ID
      console.info(`[${cameraName}] Attempting getUserMedia with browser device ID: ${browserDeviceId}`);
      console.info(`[${cameraName}] Requesting getUserMedia with browser device ID: ${browserDeviceId}`);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: browserDeviceId },
          frameRate: { ideal: 30 },
          width: { ideal: requestedWidth }, // Use value from UI
          height: { ideal: requestedHeight } // Use value from UI
        }
      });

      // 2. Assign stream to video element
      videoElement.srcObject = stream;
      // --- Logging Added ---
      console.debug(`[${cameraName}] Stream assigned. Checking tracks...`);
      const videoTracks = stream.getVideoTracks();
      console.debug(`[${cameraName}] videoTracks:`, videoTracks);
      if (videoTracks.length > 0) {
        console.debug(`[${cameraName}] Track found. Getting settings...`);
        const settings = videoTracks[0].getSettings();
        console.debug(`[${cameraName}] Settings object:`, settings);
        console.info(`[${cameraName}] Native stream resolution: ${settings.width}x${settings.height}`);
      } else {
        console.warn(`[${cameraName}] No video tracks found on the stream.`);
      }
      // --- End Logging ---
      await videoElement.play().catch(e => console.error(`Error playing preview video for ${cameraName}: ${e.message}`));
      console.info(`Preview started successfully for ${cameraName} using ${browserDeviceLabel}`);

      if (deviceInfoElement) {
        // Find server device associated with this browser device for display text
        let serverInfo = 'Unknown Server Device';
        let serverIdFound = null;
        for (const [serverID, bID] of this.serverToBrowserDeviceMap.entries()) {
          if (bID === browserDeviceId) {
            const serverDevice = this.serverDevices.find(sd => sd.id === serverID);
            serverInfo = serverDevice ? (serverDevice.name || serverDevice.id) : serverID;
            serverIdFound = serverID; // Keep track of the server ID
            break;
          }
        }
        deviceInfoElement.textContent = `Using: ${browserDeviceLabel} (Server: ${serverInfo})`;
      } else {
        logToConsole(`Device info element not found for ${cameraName}`, "warn");
      }

      // 3. Update server (Send SERVER ID/Path corresponding to the selected BROWSER ID)
      let serverIdToUpdate = null;
      for (const [serverID, bID] of this.serverToBrowserDeviceMap.entries()) {
        if (bID === browserDeviceId) {
          serverIdToUpdate = serverID;
          break;
        }
      }

      // Log values *before* the check
      console.log(`[Preview Update] Checking server update. browserDeviceId: ${browserDeviceId}, mapped serverIdToUpdate: ${serverIdToUpdate}`);

      if (serverIdToUpdate !== null) {
        console.info(`Updating server: ${cameraName} preview set to server device ID: ${serverIdToUpdate}`);
        try {
          console.debug(`[Fetch /preview-device] Sending body: ${JSON.stringify({ cameraName, deviceId: serverIdToUpdate })}`);
          const response = await fetch("/camera/preview-device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Send the SERVER ID
            body: JSON.stringify({ cameraName, deviceId: serverIdToUpdate }),
          });
          if (!response.ok) {
            console.warn(`Failed to update server preview device for ${cameraName}: ${response.statusText}`);
          } else {
            console.info(`Server updated successfully for ${cameraName} preview device.`);
          }
        } catch (serverUpdateError) {
          console.error(`Error updating server preview device for ${cameraName}: ${serverUpdateError.message}`);
        }
      } else {
        console.warn(`Could not find server ID mapping for browser device ${browserDeviceId}. Cannot update server.`);
      }


      // 4. Update the camera object state locally with the SERVER ID
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) {
        cam.previewDevice = serverIdToUpdate ?? ''; // Store the corresponding server ID or empty if not found
        console.info(`Stored server device ID ${cam.previewDevice} locally for ${cameraName}`);
      } else {
        console.warn(`Camera ${cameraName} not found to store server device ID locally.`);
      }

      // 5. Restart skeleton drawing if it was enabled
      if (cam?.showSkeleton) {
        console.info(`Restarting skeleton drawing for ${cameraName} on new stream.`);
        // this.updateSkeletonDrawing(cameraName, true); // updateSkeletonDrawing method seems to be removed
      }

    } catch (err) {
      console.error(`Error updating preview device for ${cameraName}: ${err.message}`);
      if (deviceInfoElement) deviceInfoElement.textContent = `Error: ${err.message.split(':')[0]}`; // Show shorter error
      // Optionally clear the dropdown selection or show an error state
      const previewSelect = cameraElement?.querySelector('.preview-device');
      if (previewSelect) previewSelect.value = ''; // Reset dropdown on error
      // Clear local state as well
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) cam.previewDevice = '';
    }
  }

  // --- NEW METHOD ---
  async updateAllPreviewsResolution() {
    console.info("Recording resolution changed in UI. Updating active previews...");
    for (const camera of this.cameras) {
      const videoElement = document.getElementById(`preview-${camera.name}`);
      // Check if video element exists AND has an active stream
      if (videoElement && videoElement.srcObject) {
        // Ensure tracks exist before trying to access them
        const videoTracks = videoElement.srcObject.getVideoTracks();
        if (videoTracks.length > 0) {
          const currentBrowserDeviceId = videoTracks[0].getSettings().deviceId;
          if (currentBrowserDeviceId) {
            console.info(`Updating preview for ${camera.name} with new resolution.`);
            // Call updatePreviewDevice with the current browser device ID.
            // This function now reads the new resolution from the dropdown internally.
            await this.updatePreviewDevice(camera.name, currentBrowserDeviceId);
          } else {
            console.warn(`Could not get current device ID from track settings for active preview ${camera.name}. Skipping update.`);
          }
        } else {
          console.warn(`No video tracks found for active preview ${camera.name}. Skipping update.`);
        }
      }
    }
    console.info("Finished updating active previews for new resolution.");
  }
  // --- END NEW METHOD ---

  async updateRecordingDevice(cameraName, serverDeviceId) { // Stays serverDeviceId
    console.info(`Setting recording device for ${cameraName} with server device ID: ${serverDeviceId}`);
    try {
      // Update server
      const response = await fetch("/camera/recording-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, deviceId: serverDeviceId }), // Send Server ID/Path
      });

      if (!response.ok) {
        const errorText = await response.text();
        logToConsole(`Error setting recording device: ${errorText}`, "error");
        throw new Error(`Server error: ${response.status}`);
      }

      // Update local state
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) cam.recordingDevice = serverDeviceId;

      logToConsole(`Recording device set for ${cameraName}`, "success");
    } catch (err) {
      logToConsole(`Error updating recording device: ${err.message}`, "error");
      // Optionally revert dropdown
      const cameraElement = this.cameraElements.get(cameraName);
      const recordingSelect = cameraElement?.querySelector('.recording-device');
      if (recordingSelect) {
        const cam = this.cameras.find(c => c.name === cameraName);
        recordingSelect.value = cam ? cam.recordingDevice : ''; // Revert to previous state
      }
    }
  }

  async updatePTZDevice(cameraName, serverDeviceId) { // Stays serverDeviceId
    logToConsole(`Setting PTZ device for ${cameraName} with server device ID/path: ${serverDeviceId}`, "info");
    const originalPTZDevice = this.cameras.find(c => c.name === cameraName)?.ptzDevice ?? '';
    try {
      // Update server
      const response = await fetch("/camera/ptz-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, deviceId: serverDeviceId }), // Send Server ID/Path
      });

      if (!response.ok) {
        const errorText = await response.text();
        logToConsole(`Error setting PTZ device: ${errorText}`, "error");
        throw new Error(`Server error: ${response.status}`);
      }

      // Update local state
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) cam.ptzDevice = serverDeviceId;

      logToConsole(`PTZ device set for ${cameraName}`, "success");

      // Render PTZ controls after setting a device
      this.renderPTZControlsForCamera(cameraName, serverDeviceId);

    } catch (err) {
      logToConsole(`Error updating PTZ device: ${err.message}`, "error");
      // Revert local state and dropdown
      const cam = this.cameras.find(c => c.name === cameraName);
      if (cam) cam.ptzDevice = originalPTZDevice; // Revert local state

      const cameraElement = this.cameraElements.get(cameraName);
      const ptzSelect = cameraElement?.querySelector('.ptz-device');
      if (ptzSelect) ptzSelect.value = originalPTZDevice; // Revert dropdown

      // Re-render PTZ controls based on reverted value
      this.renderPTZControlsForCamera(cameraName, originalPTZDevice);

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

      // TODO: Fetch current PTZ state from server and set initial slider values?
      // This would require a new backend endpoint GET /camera/:cameraName/ptz-state

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

    // Debounce sending updates to the server
    clearTimeout(this.ptzUpdateTimeout); // Clear existing timeout
    this.ptzUpdateTimeout = setTimeout(() => {
      this.updatePTZ(cameraName, control, rawValue);
    }, 150); // Send update 150ms after the last input change
  }


  // Method to send PTZ command to server
  async updatePTZ(cameraName, control, value) {
    // Check if camera exists and has a ptz device configured
    const camera = this.cameras.find(c => c.name === cameraName);
    if (!camera || !camera.ptzDevice) {
      logToConsole(`Cannot send PTZ command for ${cameraName}: No PTZ device configured.`, "warn");
      return;
    }

    logToConsole(`Sending PTZ command for ${cameraName}: ${control}=${value}`, "info");
    try {
      const response = await fetch("/camera/ptz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraName,
          [control]: parseInt(value) // Ensure value is integer
        }),
      });
      // Log success/failure based on response.ok
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
    const statusElement = document.getElementById("status"); // Assuming a global status element exists
    if (statusElement) statusElement.innerText = `Recording from ${cameraName}...`;

    // Get pipeline and resolution from potential global settings (or use defaults)
    const pipelineElement = document.getElementById("recording-pipeline");
    const resolutionElement = document.getElementById("recording-resolution");
    const pipeline = pipelineElement ? pipelineElement.value : 'ffmpeg'; // Default if element not found
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
      logToConsole(`Recording complete for ${cameraName}. Output: ${result.outputPath}`, "success"); // Assuming result has outputPath
      if (statusElement) statusElement.innerText = `Recording finished: ${result.outputPath}`;

      // Construct correct video path using current session ID
      const sessionIdElement = document.getElementById('current-session-id');
      const currentSessionId = sessionIdElement ? sessionIdElement.textContent.trim() : null;

      const vidDiv = document.getElementById("videos"); // Assuming a global video display div

      if (vidDiv && currentSessionId && result.outputPath) {
        // Assuming outputPath is relative to the session dir, e.g., "Camera_1/test_overlay.mp4"
        const videoPath = `/recordings/${encodeURIComponent(currentSessionId)}/${result.outputPath}`;
        logToConsole(`Displaying video: ${videoPath}`, "info");
        // Display the video - PREPEND new video instead of replacing all
        const videoContainer = document.createElement('div');
        videoContainer.innerHTML = `
            <h3>Test Overlay Video (${cameraName.replace(/_/g, ' ')})</h3>
            <video controls src="${videoPath}" style="max-width: 320px; margin-bottom: 10px;"></video>
          `;
        vidDiv.prepend(videoContainer); // Add the new video at the beginning

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
  async togglePoseDetection(cameraName, show) {
    logToConsole(`Toggling pose detection for ${cameraName} to ${show}`, "info");

    // --- MODIFICATION START: Control Compositor ---
    // Update local state directly
    const camera = this.cameras.find(c => c.name === cameraName);
    if (camera) {
      camera.showSkeleton = show;
    } else {
      logToConsole(`Camera ${cameraName} not found locally for pose detection toggle.`, "warn");
      return; // Don't proceed if camera isn't found
    }

    // Find the main compositor (exposed globally from home.js for now)
    // We assume Camera_1 maps to the main compositor for this example
    // A more robust solution would map cameras to compositors/render targets
    if (cameraName === 'Camera_1' && window.mainCompositor) {
      logToConsole(`Calling mainCompositor.setPoseDetectionEnabled(${show})`, 'info');
      window.mainCompositor.setPoseDetectionEnabled(show);
    } else if (cameraName === 'Camera_1') {
      logToConsole('Could not find window.mainCompositor to toggle pose detection.', 'error');
    } else {
      logToConsole(`Pose detection toggle for non-primary camera (${cameraName}) not linked to compositor yet.`, 'warn');
    }
    // --- MODIFICATION END ---
  }

  // Starts or stops the pose detection and drawing loop
  /* --- REMOVE OLD METHOD ---
  updateSkeletonDrawing(cameraName, show) {
     // ... Entire method removed ...
  }
  */

  // Actual drawing logic for a single frame - ACCEPTS POSES
  /* --- REMOVE OLD METHOD ---
  drawSkeletonFrame(cameraName, canvas, video, poses) {
    // ... Entire method removed ...
  }
  */
}
