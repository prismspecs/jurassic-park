import { logToConsole } from './logger.js';
import { VideoCompositor } from './video-compositor.js'; // Import VideoCompositor
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
  constructor() {
    this.cameras = [];
    this.cameraElements = new Map();
    this.availableDevices = [];
    this.ptzDevices = [];
    this.serverDevices = [];
    this.cameraDefaults = [];
    this.serverToBrowserDeviceMap = new Map();
    this.cameraCompositors = new Map(); // <cameraName, VideoCompositor instance>
    this.processedCanvases = new Map(); // <cameraName, HTMLCanvasElement for processed video>
    this.ptzUpdateTimeout = null; // For debouncing PTZ updates
  }

  async initialize() {
    try {
      // --- Get Browser Devices and Request Permissions FIRST ---
      logToConsole("Attempting to enumerate browser devices...", "info");
      let browserDevicesRaw = await navigator.mediaDevices.enumerateDevices();
      this.availableDevices = browserDevicesRaw.filter(d => d.kind === "videoinput");
      logToConsole(`Initial browser devices found: ${this.availableDevices.length}`, "info");
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
        }
      }

      // --- Get Server Configuration & Devices ---
      logToConsole("Fetching server configuration and devices...", "info");
      const [camerasRes, configRes, devicesRes, ptzRes] = await Promise.all([
        fetch("/camera/cameras").catch(e => { logToConsole('Error fetching cameras: ' + e.message, 'error'); return null; }),
        fetch("/config").catch(e => { logToConsole('Error fetching config: ' + e.message, 'error'); return null; }),
        fetch("/camera/devices").catch(e => { logToConsole('Error fetching devices: ' + e.message, 'error'); return null; }),
        fetch("/camera/ptz-devices").catch(e => { logToConsole('Error fetching PTZ devices: ' + e.message, 'error'); return null; })
      ]);

      if (camerasRes?.ok) this.cameras = await camerasRes.json();
      else logToConsole('Failed to load cameras configuration.', 'warn');
      this.cameras.forEach(cam => { cam.showSkeleton = false; cam.showMask = false; }); // Initialize client-side state

      if (configRes?.ok) this.cameraDefaults = (await configRes.json()).cameraDefaults || [];
      else logToConsole('Failed to load config defaults.', 'warn');

      if (devicesRes?.ok) this.serverDevices = await devicesRes.json();
      else logToConsole('Failed to load server devices.', 'warn');
      logToConsole(`Server reported ${this.serverDevices.length} devices`, "info");
      this.serverDevices.forEach(d => logToConsole(` -> Server Device: ${d.name} (ID: ${d.id})`, "info"));

      if (ptzRes?.ok) this.ptzDevices = await ptzRes.json();
      else logToConsole('Failed to load PTZ devices.', 'warn');
      logToConsole(`Found ${this.ptzDevices.length} PTZ devices`, "info");

      // --- Map Server Devices to Browser Devices ---
      this._mapServerToBrowserDevices();

      this.renderCameraControls();
      logToConsole(`Camera manager initialized with ${this.cameras.length} cameras`, "success");

    } catch (err) {
      logToConsole(`Error initializing camera manager: ${err.message}`, "error");
    }
  }

  _mapServerToBrowserDevices() {
    logToConsole("Attempting to map server devices to browser devices...", "info");
    this.serverToBrowserDeviceMap.clear();
    const browserVideoDevices = [...this.availableDevices]; // Create a copy to allow safe removal/marking
    const usedBrowserDeviceIds = new Set();

    this.serverDevices.forEach(serverDevice => {
      const serverDeviceNamePart = serverDevice.name?.split(' (')[0];
      let matchedBrowserDevice = null;

      if (serverDeviceNamePart && browserVideoDevices.length > 0) {
        // Find the first available (unused) browser device that matches the name part
        for (let i = 0; i < browserVideoDevices.length; i++) {
          const bd = browserVideoDevices[i];
          if (!usedBrowserDeviceIds.has(bd.deviceId) && bd.label && bd.label.startsWith(serverDeviceNamePart)) {
            matchedBrowserDevice = bd;
            usedBrowserDeviceIds.add(bd.deviceId); // Mark as used
            break; // Found a match for this serverDevice
          }
        }
      }

      if (matchedBrowserDevice) {
        this.serverToBrowserDeviceMap.set(String(serverDevice.id), matchedBrowserDevice.deviceId);
        logToConsole(`Mapped server ${serverDevice.id} (${serverDevice.name}) to browser ${matchedBrowserDevice.deviceId} (${matchedBrowserDevice.label})`, "success");
      } else {
        logToConsole(`Could not map server device ${serverDevice.id} (${serverDevice.name || 'No Name'}). Ensure a unique browser device is available.`, "warn");
        this.serverToBrowserDeviceMap.set(String(serverDevice.id), null);
      }
    });
    logToConsole("Finished mapping server devices.", "info");
  }

  async addCamera() {
    const cameraIndex = this.cameras.length;
    const name = `Camera_${cameraIndex + 1}`;
    const defaults = this.cameraDefaults[cameraIndex] || { previewDevice: "", recordingDevice: "", ptzDevice: "" };

    // The values from `defaults` (from config.json) are assumed to be device NAMES.
    // The backend /camera/add route expects device names.
    const previewDeviceName = defaults.previewDevice;
    const recordingDeviceName = defaults.recordingDevice;
    const ptzDeviceName = defaults.ptzDevice;

    try {
      logToConsole(`Adding new camera: ${name} with default names - Preview: '${previewDeviceName}', Record: '${recordingDeviceName}', PTZ: '${ptzDeviceName}'`, "info");
      const addResponse = await fetch("/camera/add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          previewDevice: previewDeviceName,
          recordingDevice: recordingDeviceName,
          ptzDevice: ptzDeviceName
        }),
      });

      if (addResponse.ok) {
        const camerasResponse = await fetch("/camera/cameras");
        if (!camerasResponse.ok) throw new Error(`Failed to fetch updated camera list: ${camerasResponse.status}`);
        const updatedCameras = await camerasResponse.json();
        const existingNames = new Set(this.cameras.map(cam => cam.name));
        const newCamera = updatedCameras.find(cam => !existingNames.has(cam.name));

        if (!newCamera) throw new Error("Could not identify the newly added camera.");
        logToConsole(`Identified new camera: ${newCamera.name}`, "info");

        const container = document.getElementById("cameraControls");
        if (!container) throw new Error("Camera controls container missing from DOM.");
        if (this.cameras.length === 0) container.innerHTML = '';

        newCamera.showSkeleton = false; newCamera.showMask = false; // Initialize client state
        const cameraElement = this.createCameraElement(newCamera);
        container.appendChild(cameraElement);
        this.cameraElements.set(newCamera.name, cameraElement);

        // Update internal list, preserving existing client-side state (like showSkeleton/showMask)
        const clientStateMap = new Map(this.cameras.map(c => [c.name, { showSkeleton: c.showSkeleton, showMask: c.showMask }]));
        this.cameras = updatedCameras.map(cam => ({
          ...cam,
          ...(clientStateMap.get(cam.name) || { showSkeleton: false, showMask: false })
        }));

        logToConsole(`Camera ${newCamera.name} UI added.`, "success");
        document.dispatchEvent(new CustomEvent('cameramanagerupdate', { detail: { action: 'added', cameraName: newCamera.name } }));
      } else {
        const error = await addResponse.json(); throw new Error(error.message || `HTTP error ${addResponse.status}`);
      }
    } catch (err) {
      logToConsole(`Error adding camera: ${err.message}`, "error");
    }
  }

  async removeCamera(name) {
    if (!confirm(`Are you sure you want to remove camera '${name}'?`)) return;
    logToConsole(`Attempting to remove camera: ${name}`, "info");
    try {
      this.stopVideoStream(name); // Stops tracks and nullifies srcObject

      // Explicitly destroy the VideoCompositor for this camera
      const compositor = this.cameraCompositors.get(name);
      if (compositor && typeof compositor.destroy === 'function') {
        compositor.destroy();
        logToConsole(`Destroyed VideoCompositor for camera ${name}.`, 'debug');
      }
      this.cameraCompositors.delete(name);
      this.processedCanvases.delete(name); // The canvas itself is removed with cameraElement

      // Use DELETE method and URL parameter
      const response = await fetch(`/camera/${encodeURIComponent(name)}`, { method: "DELETE" });

      if (response.ok) {
        logToConsole(`Camera ${name} removed on server.`, "success");
        const cameraElement = this.cameraElements.get(name);
        if (cameraElement) { cameraElement.remove(); this.cameraElements.delete(name); }
        this.cameras = this.cameras.filter((cam) => cam.name !== name);
        logToConsole(`Camera ${name} removed locally.`, "success");
        if (this.cameras.length === 0) {
          const container = document.getElementById("cameraControls");
          if (container) container.innerHTML = '<p>No cameras configured.</p>';
        }
        document.dispatchEvent(new CustomEvent('cameramanagerupdate', { detail: { action: 'removed', cameraName: name } }));
      } else {
        // Improved error handling for remove
        let errorMsg = `Failed to remove camera: ${response.status}`;
        try {
          const errorResult = await response.json();
          errorMsg = errorResult.message || errorMsg;
        } catch (e) {
          // If response wasn't JSON, use text
          try { errorMsg = await response.text(); } catch (e2) { }
        }
        throw new Error(errorMsg);
      }
    } catch (err) {
      logToConsole(`Error removing camera ${name}: ${err.message}`, "error");
      alert(`Error removing camera: ${err.message}`); // Notify user
    }
  }

  renderCameraControls() {
    const container = document.getElementById("cameraControls");
    if (!container) { console.error("Camera controls container not found!"); return; }
    container.innerHTML = "";
    this.cameraElements.clear();
    if (this.cameras.length === 0) {
      container.innerHTML = '<p>No cameras configured.</p>'; return;
    }
    // Create and append all camera elements first
    this.cameras.forEach((camera) => {
      const cameraElement = this.createCameraElement(camera);
      container.appendChild(cameraElement);
      this.cameraElements.set(camera.name, cameraElement);
    });
  }

  // --- Helper to create select dropdown groups --- (Consolidated)
  _createSelectGroup(labelText, selectId, options, selectedValue, changeCallback) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.htmlFor = selectId; label.textContent = labelText; label.className = 'form-label';
    const select = document.createElement('select');
    select.id = selectId; select.className = 'form-select form-select-sm';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value; option.textContent = opt.text;
      if (opt.disabled) option.disabled = true;
      if (String(opt.value) === String(selectedValue)) option.selected = true; // Ensure type consistency
      select.appendChild(option);
    });
    select.addEventListener('change', changeCallback);
    group.appendChild(label); group.appendChild(select);
    return group;
  }

  // --- Helper to create toggle switches --- (Consolidated)
  _createToggleSwitch(labelText, switchId, isChecked, changeCallback) {
    const group = document.createElement('div');
    group.className = 'form-group form-check form-switch';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'form-check-input';
    input.id = switchId; input.checked = isChecked;
    const label = document.createElement('label');
    label.className = 'form-check-label'; label.htmlFor = switchId;
    label.textContent = labelText;

    // Correctly pass the boolean state (event.target.checked) of the checkbox to the callback
    input.addEventListener('change', (event) => {
      changeCallback(event.target.checked);
    });

    group.appendChild(input); group.appendChild(label);
    return group;
  }

  createCameraElement(camera) {
    const card = document.createElement("div");
    card.className = "camera-card card"; card.id = `camera-card-${camera.name}`; card.dataset.cameraName = camera.name;

    const header = document.createElement("div");
    header.className = "camera-card-header";
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-sm btn-danger remove-camera-btn'; removeBtn.title = `Remove ${camera.name}`;
    removeBtn.innerHTML = '❌';
    removeBtn.addEventListener('click', () => this.removeCamera(camera.name));
    header.innerHTML = `<h3>${camera.name.replace(/_/g, ' ')}</h3>`; header.appendChild(removeBtn);
    card.appendChild(header);

    const content = document.createElement("div");
    content.className = "camera-card-content";

    const videoContainer = document.createElement('div');
    videoContainer.className = 'camera-video-container';
    const videoElement = document.createElement("video");
    videoElement.id = `video-${camera.name}`; videoElement.autoplay = true; videoElement.muted = true;
    videoElement.playsInline = true; videoElement.style.width = "100%"; videoElement.style.backgroundColor = "#222"; // Ensure video element is visible if stream fails
    const deviceInfoElement = document.createElement('div');
    deviceInfoElement.className = 'device-info'; deviceInfoElement.textContent = 'No device selected';
    videoContainer.appendChild(videoElement); videoContainer.appendChild(deviceInfoElement);
    content.appendChild(videoContainer);

    const processedCanvas = document.createElement('canvas');
    processedCanvas.id = `processed-canvas-${camera.name}`; // Original ID for per-camera canvas
    processedCanvas.style.display = 'block'; // Or 'none' if preferred, but block is good for debug
    processedCanvas.style.width = '100%'; // Let CSS handle sizing, or set a specific debug size
    processedCanvas.style.maxWidth = '320px';
    processedCanvas.style.aspectRatio = '16/9';
    processedCanvas.style.border = '1px solid green'; // For debugging
    processedCanvas.style.marginTop = '5px';
    content.appendChild(processedCanvas);

    const compositor = new VideoCompositor(processedCanvas);
    this.cameraCompositors.set(camera.name, compositor);
    this.processedCanvases.set(camera.name, processedCanvas);

    videoElement.onloadedmetadata = () => {
      logToConsole(`Video metadata loaded for ${camera.name}: ${videoElement.videoWidth}x${videoElement.videoHeight}`, 'info');
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        compositor.setCurrentFrameSource(videoElement);
      } else {
        logToConsole(`Video dimensions zero for ${camera.name}, compositor may retry.`, 'warn');
      }
    };
    videoElement.onerror = (e) => {
      logToConsole(`Error loading video source for ${camera.name}: ${e.message || 'Unknown error'}`, 'error');
      if (deviceInfoElement) deviceInfoElement.textContent = 'Error loading video.';
    };

    const controlsDiv = document.createElement("div");
    controlsDiv.className = "camera-controls-grid"; // Main div for all selectors and toggles

    // --- Preview Device Selector ---
    const previewDeviceOptions = [];
    const labelCounts = {};
    this.availableDevices.forEach(d => {
      // Ensure d.label is treated as a string, even if it's null or undefined, to avoid errors with object keys.
      const labelKey = String(d.label);
      labelCounts[labelKey] = (labelCounts[labelKey] || 0) + 1;
    });

    this.availableDevices.forEach(d => {
      let displayText = d.label || d.deviceId;
      // Ensure d.label is treated as a string for the lookup.
      if (labelCounts[String(d.label)] > 1) {
        // If there's more than one camera with the same label, append part of the deviceId for uniqueness
        displayText = `${d.label || 'Unknown Camera'} (ID: ...${d.deviceId.slice(-6)})`;
      }
      previewDeviceOptions.push({ value: d.deviceId, text: displayText });
    });

    const initialBrowserPreviewDeviceId = this.serverToBrowserDeviceMap.get(camera.previewDevice) || ""; // Get initial mapped device ID

    const previewSelectGroup = this._createSelectGroup(
      'Preview Device:',
      `preview-device-selector-${camera.name}`,
      previewDeviceOptions,
      initialBrowserPreviewDeviceId,
      async (e) => await this.updatePreviewDevice(camera.name, e.target.value)
    );
    controlsDiv.appendChild(previewSelectGroup);

    // Auto-start preview and set devices if a valid initial device is set
    if (initialBrowserPreviewDeviceId) {
      logToConsole(`Camera ${camera.name} has initial preview device ID: ${initialBrowserPreviewDeviceId}. Attempting immediate auto-configuration.`, "info");
      // Call directly, ensuring the select element's value is indeed what we expect.
      // The select element is part of previewSelectGroup which was just appended to controlsDiv.
      // Its value should be correctly set by _createSelectGroup.
      this.updatePreviewDevice(camera.name, initialBrowserPreviewDeviceId).catch(err => {
        logToConsole(`Error during immediate auto-configuration for ${camera.name}: ${err.message}`, "error");
      });
    }

    // --- PTZ Controls Container (still needed, populated by updateUnifiedDevice/renderPTZControlsForCamera) ---
    const ptzControlsContainerOriginal = document.createElement('div');
    ptzControlsContainerOriginal.id = `ptz-controls-${camera.name}`;
    ptzControlsContainerOriginal.className = 'ptz-controls-container';
    controlsDiv.appendChild(ptzControlsContainerOriginal);
    // Initial rendering of PTZ controls will be handled by the updateUnifiedDevice call if an initial device is set,
    // or when a device is selected. We can force an initial empty render if desired.
    this.renderPTZControlsForCamera(camera.name, "", ptzControlsContainerOriginal);

    // --- Effect Toggles ---
    const skeletonToggle = this._createToggleSwitch(
      `Show Skeleton Overlay`,
      `skeleton-toggle-${camera.name}`,
      compositor.drawSkeletonOverlay,
      (isChecked) => {
        if (compositor) {
          compositor.setDrawSkeletonOverlay(isChecked);
          logToConsole(`Skeleton for ${camera.name} set to ${isChecked}`);
        }
      }
    );
    controlsDiv.appendChild(skeletonToggle);

    const maskToggle = this._createToggleSwitch(
      `Enable Pose Rect Cut-out`,
      `mask-toggle-${camera.name}`,
      compositor.drawBoundingBoxMask,
      (isChecked) => {
        if (compositor) {
          compositor.setDrawBoundingBoxMask(isChecked);
          logToConsole(`Mask for ${camera.name} set to ${isChecked}`);
        }
      }
    );
    controlsDiv.appendChild(maskToggle);

    const bodySegmentToggle = this._createToggleSwitch(
      `Enable Body Segment Cut-out`,
      `body-segment-toggle-${camera.name}`,
      compositor.drawBodySegmentMask, // Read initial state from compositor
      (isChecked) => {
        if (compositor) {
          compositor.setDrawBodySegmentMask(isChecked);
          logToConsole(`Body Segment Mask for ${camera.name} set to ${isChecked}`);
        }
      }
    );
    controlsDiv.appendChild(bodySegmentToggle);

    // --- Record Processed Canvas Button ---
    const recordButton = document.createElement('button');
    recordButton.id = `record-btn-${camera.name}`; recordButton.className = 'btn btn-info btn-sm';
    recordButton.textContent = 'Record Processed';
    recordButton.addEventListener('click', () => {
      const comp = this.cameraCompositors.get(camera.name);
      if (comp && comp.canvas && comp.canvas.dataset.isRecording === 'true') {
        this.stopRecordProcessedCanvas(camera.name);
      } else {
        this.recordVideo(camera.name);
      }
    });
    controlsDiv.appendChild(recordButton);

    // --- Status Message Area ---
    const statusElement = document.createElement('div');
    statusElement.id = `status-${camera.name}`; statusElement.className = 'camera-status-message';
    controlsDiv.appendChild(statusElement);

    content.appendChild(controlsDiv);
    card.appendChild(content);

    this.cameraElements.set(camera.name, card);
    return card;
  }

  async updateUnifiedDevice(cameraName, selectedServerDeviceId) {
    logToConsole(`Updating unified device for ${cameraName} to ${selectedServerDeviceId}`, "info");
    const camera = this.cameras.find(c => c.name === cameraName);
    if (!camera) {
      logToConsole(`Camera ${cameraName} not found for unified update.`, "error");
      return;
    }

    // 1. Update Recording Device
    // camera.recordingDevice = selectedServerDeviceId; // Client-side state
    // await this.updateRecordingDevice(cameraName, selectedServerDeviceId); // Server-side update via its own _updateCameraConfig call

    // 2. Update Preview Device
    const browserDeviceId = selectedServerDeviceId ? this.serverToBrowserDeviceMap.get(selectedServerDeviceId) : "";
    logToConsole(`Unified selected for ${cameraName}: serverID '${selectedServerDeviceId}', mapped browserID: '${browserDeviceId}'`, "debug");
    // camera.previewDevice = selectedServerDeviceId; // Client-side state (storing server ID for consistency)
    // await this.updatePreviewDevice(cameraName, browserDeviceId || ""); // Server-side update & starts preview

    // 3. Update PTZ Device
    logToConsole(`PTZ Check for ${cameraName}: selectedServerDeviceId is '${selectedServerDeviceId}'`, "debug");
    logToConsole(`PTZ Check for ${cameraName}: this.ptzDevices list:`, "debug", JSON.parse(JSON.stringify(this.ptzDevices)));

    const ptzDeviceDetail = selectedServerDeviceId ? this.ptzDevices.find(pd => {
      const idMatch = pd.id !== undefined && String(pd.id) === String(selectedServerDeviceId);
      const pathMatch = pd.path !== undefined && String(pd.path) === String(selectedServerDeviceId);
      // Log individual comparisons for clarity
      // logToConsole(`PTZ Find: comparing pd.id '${pd.id}' (str: '${String(pd.id)}') or pd.path '${pd.path}' (str: '${String(pd.path)}') with '${String(selectedServerDeviceId)}'`, "debug");
      return idMatch || pathMatch;
    }) : null;

    logToConsole(`PTZ Check for ${cameraName}: ptzDeviceDetail found:`, "debug", ptzDeviceDetail ? JSON.parse(JSON.stringify(ptzDeviceDetail)) : null);

    const ptzIdToUse = ptzDeviceDetail ? (ptzDeviceDetail.id !== undefined ? String(ptzDeviceDetail.id) : String(ptzDeviceDetail.path)) : "";
    logToConsole(`PTZ Check for ${cameraName}: ptzIdToUse determined as: '${ptzIdToUse}'`, "debug");

    // It's better to call the individual update functions, as they handle their specific logic
    // and server updates. They also update the camera object's respective fields.

    // Call individual update functions which will also update the client-side camera object
    // and make their own calls to _updateCameraConfig.
    await this.updateRecordingDevice(cameraName, selectedServerDeviceId);
    await this.updatePreviewDevice(cameraName, browserDeviceId || "");
    await this.updatePTZDevice(cameraName, ptzIdToUse); // This will also call renderPTZControlsForCamera

    // Ensure the camera object in this.cameras reflects the latest server-side confirmed state
    // The individual update functions should have updated the camera object already via _updateCameraConfig's success path.
    // However, to be absolutely sure the local camera object is consistent for subsequent UI updates:
    const updatedCamera = this.cameras.find(c => c.name === cameraName);
    if (updatedCamera) {
      updatedCamera.recordingDevice = selectedServerDeviceId;
      updatedCamera.previewDevice = selectedServerDeviceId; // Store the SERVER id for preview consistency in the model
      updatedCamera.ptzDevice = ptzIdToUse;
    }

    // The PTZ controls rendering is handled by updatePTZDevice.
    // If selectedServerDeviceId is empty, we effectively clear all.
    if (!selectedServerDeviceId) {
      const ptzControlsContainer = document.getElementById(`ptz-controls-${cameraName}`);
      if (ptzControlsContainer) {
        this.renderPTZControlsForCamera(cameraName, "", ptzControlsContainer);
      }
    }

    // Note: _updateCameraConfig is called by each update*Device method.
    // If we wanted a single server update, we'd collect all changes and call _updateCameraConfig once here.
    // For now, allowing individual updates is fine and likely what the user expects from existing behavior.
    logToConsole(`Unified device update for ${cameraName} complete. Preview: '${browserDeviceId}', Record: '${selectedServerDeviceId}', PTZ: '${ptzIdToUse}'`, "info");
    document.dispatchEvent(new CustomEvent('cameramanagerupdate', { detail: { action: 'modified', cameraName: cameraName, unifiedDevice: selectedServerDeviceId } }));
  }

  async updatePreviewDevice(cameraName, browserDeviceId) {
    logToConsole(`Updating preview for ${cameraName} to browser device ID: ${browserDeviceId}`, "info");
    logToConsole(`updatePreviewDevice ENTRY for ${cameraName} with browserDeviceId: '${browserDeviceId}'`, "info");

    const camera = this.cameras.find(c => c.name === cameraName);
    const videoElement = document.getElementById(`video-${cameraName}`);
    const compositor = this.cameraCompositors.get(cameraName);

    if (!camera || !videoElement || !compositor) {
      logToConsole(`Cannot update preview for ${cameraName}: Camera, video element, or compositor not found.`, "error");
      return;
    }

    this.stopVideoStream(cameraName); // This now also pauses and should clear listeners for the raw video element

    if (!browserDeviceId) {
      logToConsole(`No browser device ID selected for ${cameraName}. Clearing preview.`, "info");
      compositor.removeFrameSource(); // Clear source from compositor
      this._updateCameraConfig(cameraName, { previewDevice: "" });
      return;
    }

    try {
      // Get desired resolution from UI
      const resolutionSelect = document.getElementById('recording-resolution');
      logToConsole(`updatePreviewDevice for ${cameraName}: resolutionSelect found: ${!!resolutionSelect}`, 'debug');
      if (resolutionSelect) {
        logToConsole(`updatePreviewDevice for ${cameraName}: resolutionSelect.value: '${resolutionSelect.value}'`, 'debug');
      }

      let constraints = { video: { deviceId: { exact: browserDeviceId }, frameRate: { ideal: 30 } } };
      if (resolutionSelect?.value && resolutionSelect.value.includes('x')) {
        const [widthStr, heightStr] = resolutionSelect.value.split('x');
        const width = parseInt(widthStr, 10);
        const height = parseInt(heightStr, 10);
        logToConsole(`updatePreviewDevice for ${cameraName}: Parsed resolution - width: ${width}, height: ${height}`, 'debug');

        if (width > 0 && height > 0) {
          constraints.video.width = { ideal: width };
          constraints.video.height = { ideal: height };
          logToConsole(`Applying resolution constraints for ${cameraName}: ${width}x${height}`, 'debug');
        } else {
          logToConsole(`Invalid parsed resolution for ${cameraName}: width ${width}, height ${height}. Using default.`, 'warn');
        }
      } else {
        logToConsole(`Recording resolution dropdown value '${resolutionSelect?.value}' not valid or not found for ${cameraName}. Using default resolution.`, 'warn');
      }
      logToConsole(`updatePreviewDevice for ${cameraName}: Final media constraints:`, 'debug', JSON.parse(JSON.stringify(constraints)));

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = stream;
      // Remove any old onloadedmetadata listener before adding a new one.
      // Store the bound function to be able to remove it.
      if (videoElement._boundOnMetadataLoaded) {
        videoElement.removeEventListener('loadedmetadata', videoElement._boundOnMetadataLoaded);
      }
      videoElement._boundOnMetadataLoaded = () => {
        logToConsole(`Video metadata loaded for ${cameraName}: ${videoElement.videoWidth}x${videoElement.videoHeight}`, "info");
        if (compositor) {
          compositor.setCurrentFrameSource(videoElement);
        }
        // Remove the listener after it has run once if that's the desired behavior,
        // or manage it if multiple reloads are possible for the same element/stream.
        // For now, let it persist for the current stream.
      };
      videoElement.addEventListener('loadedmetadata', videoElement._boundOnMetadataLoaded);

      await videoElement.play();
      logToConsole(`Preview for ${cameraName} (${camera.label || browserDeviceId}): Metadata loaded. Video resolution: ${videoElement.videoWidth}x${videoElement.videoHeight}`, 'success');

      // Find the server ID that maps to the selected browserDeviceId
      let serverIdForUpdate = null;
      for (const [serverID, bID] of this.serverToBrowserDeviceMap.entries()) {
        if (bID === browserDeviceId) {
          serverIdForUpdate = serverID;
          break;
        }
      }
      if (serverIdForUpdate !== null) {
        this._updateCameraConfig(cameraName, { previewDevice: serverIdForUpdate });
      } else {
        logToConsole(`Could not find a server ID mapping for browser device ${browserDeviceId}. Config not updated for previewDevice.`, 'warn');
        // Optionally, you might want to clear the previewDevice on the server if no mapping is found
        // this._updateCameraConfig(cameraName, { previewDevice: "" }); 
      }

    } catch (err) {
      logToConsole(`Error starting video stream for ${cameraName} with device ${browserDeviceId}: ${err.message}`, "error");
      this.stopVideoStream(cameraName); // Clean up on error
      compositor.removeFrameSource();
      // Ensure server config reflects that this preview device failed
      // camera.previewDevice should hold the server ID of the device we attempted to use.
      if (camera && camera.previewDevice) { // camera.previewDevice is the SERVER ID that was intended for preview
        this._updateCameraConfig(cameraName, { previewDevice: "" });
        logToConsole(`Cleared previewDevice on server for ${cameraName} (was ${camera.previewDevice}) due to getUserMedia error for browserDevice ${browserDeviceId}.`, "warn");
      } else {
        // If camera.previewDevice isn't set, still attempt to clear with generic empty
        this._updateCameraConfig(cameraName, { previewDevice: "" });
        logToConsole(`Cleared previewDevice on server for ${cameraName} due to getUserMedia error (camera.previewDevice was not set).`, "warn");
      }
    }
  }

  async updateRecordingDevice(cameraName, serverDeviceId) {
    logToConsole(`Updating recording device for ${cameraName} to server ID: ${serverDeviceId}`, "info");
    this._updateCameraConfig(cameraName, { recordingDevice: serverDeviceId });
  }

  async updatePTZDevice(cameraName, serverDeviceId) {
    logToConsole(`Updating PTZ device for ${cameraName} to server ID/path: ${serverDeviceId}`, "info");
    // Added log to confirm received serverDeviceId
    logToConsole(`updatePTZDevice ENTRY for ${cameraName} with serverDeviceId: '${serverDeviceId}'`, "info");

    this._updateCameraConfig(cameraName, { ptzDevice: serverDeviceId });

    // Find the specific PTZ container for this camera
    const cameraCard = this.cameraElements.get(cameraName);
    const ptzContainer = cameraCard?.querySelector(`#ptz-controls-${cameraName}`);

    logToConsole(`updatePTZDevice for ${cameraName}: Found card:`, 'debug', cameraCard);
    logToConsole(`updatePTZDevice for ${cameraName}: Found ptzContainer:`, 'debug', ptzContainer);
    logToConsole(`updatePTZDevice for ${cameraName}: Calling renderPTZControls with deviceId: '${serverDeviceId}'`, 'debug');

    this.renderPTZControlsForCamera(cameraName, serverDeviceId, ptzContainer); // Pass the found container
  }

  // Consolidated method to update local camera state and push to server
  async _updateCameraConfig(cameraName, updates) {
    const camera = this.cameras.find(c => c.name === cameraName);
    if (!camera) {
      logToConsole(`Cannot update config: Camera ${cameraName} not found locally.`, 'warn');
      return;
    }

    logToConsole(`_updateCameraConfig for ${cameraName}. Initial updates:`, 'debug', JSON.parse(JSON.stringify(updates)));
    logToConsole(`_updateCameraConfig for ${cameraName}. Camera object:`, 'debug', JSON.parse(JSON.stringify(camera)));
    logToConsole(`_updateCameraConfig for ${cameraName}. Camera keys: ${Object.keys(camera).join(', ')}`, 'debug');

    const originalValues = {};
    const updatesCopy = { ...updates }; // Work on a copy for inspection

    for (const key in updatesCopy) {
      if (Object.hasOwnProperty.call(updatesCopy, key)) { // Ensure key is from updates itself
        const cameraHasKey = Object.hasOwnProperty.call(camera, key);
        logToConsole(`_updateCameraConfig for ${cameraName}: Checking key '${key}'. Camera has own property '${key}': ${cameraHasKey}`, 'debug');
        if (cameraHasKey) {
          originalValues[key] = camera[key];
          camera[key] = updatesCopy[key];
        } else {
          logToConsole(`Skipping update for key '${key}' as it's not an own property of camera ${cameraName}.`, 'warn');
          delete updates[key]; // Modify the original updates object being sent to server
        }
      }
    }

    logToConsole(`_updateCameraConfig for ${cameraName}. Final updates to be sent:`, 'debug', JSON.parse(JSON.stringify(updates)));

    if (Object.keys(updates).length === 0) {
      logToConsole(`Error updating camera config for ${cameraName} on server: No valid configuration updates to send.`, 'error');
      // Revert optimistic local changes since nothing will be sent
      for (const key in originalValues) {
        if (Object.hasOwnProperty.call(originalValues, key) && Object.hasOwnProperty.call(camera, key)) {
          camera[key] = originalValues[key];
        }
      }
      logToConsole(`Reverted local config changes for ${cameraName} due to no valid updates.`, 'warn');
      return;
    }

    logToConsole(`Updating local config for ${cameraName}:`, 'debug', JSON.parse(JSON.stringify(updates))); // Log the actual data being sent

    // Persist change(s) to the server
    try {
      const response = await fetch(`/camera/${encodeURIComponent(cameraName)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        // Improved error handling: Check content type before parsing
        let errorMsg = `Failed to update config: ${response.status}`;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          try {
            const errorResult = await response.json();
            errorMsg = errorResult.message || errorMsg;
          } catch (e) { logToConsole('Error parsing JSON error response', 'warn', e); }
        } else {
          try { errorMsg = await response.text(); } catch (e) { /* Ignore */ }
        }
        throw new Error(errorMsg);
      }

      const result = await response.json(); // Should be { success: true, message: '...' }
      logToConsole(`Camera config updated on server for ${cameraName}: ${result.message}`, "success");

    } catch (err) {
      logToConsole(`Error updating camera config for ${cameraName} on server: ${err.message}`, "error");
      // Revert local changes on error
      for (const key in originalValues) {
        camera[key] = originalValues[key];
      }
      logToConsole(`Reverted local config changes for ${cameraName} due to server error.`, 'warn');

      // TODO: Optionally revert UI elements (e.g., dropdowns) if needed
      alert(`Failed to save camera settings for ${cameraName}: ${err.message}`);
    }
  }

  stopVideoStream(cameraName) {
    const videoElement = document.getElementById(`video-${cameraName}`);
    if (videoElement) {
      logToConsole(`Stopping video stream for ${cameraName}...`, 'info');
      if (videoElement.pause) {
        videoElement.pause(); // Explicitly pause
      }
      if (videoElement.srcObject) {
        const stream = videoElement.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => {
          track.stop();
          logToConsole(`Stopped track ${track.label || 'N/A'} for ${cameraName}`, 'debug');
        });
        videoElement.srcObject = null;
        logToConsole(`srcObject set to null for ${cameraName}`, 'debug');
      }
      // Remove specific listeners if they were added with addEventListener
      if (videoElement._boundOnMetadataLoaded) {
        videoElement.removeEventListener('loadedmetadata', videoElement._boundOnMetadataLoaded);
        delete videoElement._boundOnMetadataLoaded; // Clean up the stored handler
        logToConsole(`Removed onloadedmetadata listener for ${cameraName}`, 'debug');
      }
      // Add any other specific listener removals here if needed

    } else {
      logToConsole(`Video element for ${cameraName} not found to stop stream.`, 'warn');
    }
  }

  async updateAllPreviewsResolution() {
    logToConsole("Resolution changed. Updating active previews...", "info");
    for (const camera of this.cameras) {
      const videoElement = document.getElementById(`video-${camera.name}`);
      if (videoElement?.srcObject) {
        const videoTracks = videoElement.srcObject.getVideoTracks();
        if (videoTracks.length > 0) {
          const currentBrowserDeviceId = videoTracks[0].getSettings().deviceId;
          if (currentBrowserDeviceId) {
            logToConsole(`Re-starting preview for ${camera.name} with new resolution.`, "info");
            await this.updatePreviewDevice(camera.name, currentBrowserDeviceId);
          }
        }
      }
    }
    logToConsole("Finished updating previews for new resolution.", "info");
  }

  // --- PTZ Methods ---
  renderPTZControlsForCamera(cameraName, ptzDeviceId, ptzContainer) {
    logToConsole(`renderPTZControlsForCamera called for ${cameraName}. Device ID: '${ptzDeviceId}'. Passed container:`, 'debug', ptzContainer);

    if (!ptzContainer) {
      logToConsole(`PTZ container for ${cameraName} not found (or not passed). Cannot render controls.`, 'warn');
      return;
    }
    ptzContainer.innerHTML = ''; // Clear previous
    ptzContainer.style.display = 'block'; // Ensure the container itself is visible

    if (!ptzDeviceId) {
      ptzContainer.innerHTML = '<p class="ptz-placeholder text-muted small">No PTZ device selected.</p>';
      return;
    }

    const controls = [
      { name: 'pan', min: -468000, max: 468000, step: 3600, unit: '°', scale: 3600 },
      { name: 'tilt', min: -324000, max: 324000, step: 3600, unit: '°', scale: 3600 },
      { name: 'zoom', min: 0, max: 100, step: 1, unit: '%', scale: 1 },
    ];

    controls.forEach(c => {
      const groupId = `ptz-${c.name}-group-${cameraName}`;
      const inputId = `ptz-${c.name}-input-${cameraName}`;
      const valueId = `ptz-${c.name}-value-${cameraName}`;

      const group = document.createElement('div');
      group.className = 'ptz-control-group'; group.id = groupId;
      group.innerHTML = `
            <label for="${inputId}" class="form-label">${c.name.charAt(0).toUpperCase() + c.name.slice(1)}:</label>
            <input type="range" class="form-range" id="${inputId}" name="${c.name}" 
                   min="${c.min}" max="${c.max}" step="${c.step}" value="0" title="${c.name}">
            <span id="${valueId}" class="ptz-value-display">${(0 / c.scale).toFixed(c.scale === 1 ? 0 : 1)}${c.unit}</span>`;
      ptzContainer.appendChild(group);

      group.querySelector(`#${inputId}`).addEventListener('input', (e) =>
        this.handlePTZInputChange(cameraName, c.name, e.target.value, c.scale, c.unit, valueId)
      );
    });

    // TODO: Fetch current PTZ state from server to set initial slider values?
  }

  handlePTZInputChange(cameraName, control, value, scale, unit, valueSpanId) {
    const rawValue = parseInt(value);
    const displayValue = (rawValue / scale).toFixed(scale === 1 ? 0 : 1) + unit;
    const displaySpan = document.getElementById(valueSpanId);
    if (displaySpan) displaySpan.textContent = displayValue;

    clearTimeout(this.ptzUpdateTimeout);
    this.ptzUpdateTimeout = setTimeout(() => this.updatePTZ(cameraName, control, rawValue), 150);
  }

  async updatePTZ(cameraName, control, value) {
    const camera = this.cameras.find(c => c.name === cameraName);
    if (!camera?.ptzDevice) return;
    logToConsole(`Sending PTZ command: ${cameraName} ${control}=${value}`, "info");
    try {
      const response = await fetch("/camera/ptz", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraName, [control]: value })
      });
      if (!response.ok) logToConsole(`PTZ update failed: ${response.statusText}`, 'warn');
    } catch (err) {
      logToConsole(`Error sending PTZ command: ${err.message}`, "error");
    }
  }

  // --- Recording Methods (Per-Camera Processed Canvas) ---
  async recordVideo(cameraName) {
    logToConsole(`Attempting to record processed canvas for ${cameraName}`, 'info');
    const statusElement = document.getElementById(`status-${cameraName}`);
    const recordButton = document.getElementById(`record-btn-${cameraName}`);
    const processedCanvas = this.processedCanvases.get(cameraName);

    if (!processedCanvas) {
      logToConsole(`Error: Processed canvas for ${cameraName} not found.`, 'error');
      if (statusElement) statusElement.innerText = "Error: Canvas not found."; return;
    }
    if (processedCanvas.dataset.isRecording === 'true') {
      logToConsole(`Canvas ${cameraName} already recording.`, 'warn'); return;
    }
    if (processedCanvas.width === 0 || processedCanvas.height === 0) {
      logToConsole(`Canvas ${cameraName} has zero dimensions. Cannot record.`, 'warn');
      if (statusElement) statusElement.innerText = "Error: Canvas has no size."; return;
    }

    try {
      const stream = processedCanvas.captureStream(30); // Target 30 FPS
      const mimeType = 'video/webm;codecs=vp9'; // VP9 preferred for potential alpha
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        logToConsole(`VP9 mimeType not supported for MediaRecorder. Recording may fail or lack alpha. Consider VP8 or H.264 if available and suitable.`, 'warn');
        // Could fallback here if needed: mimeType = 'video/webm;codecs=vp8'; 
        // Or even 'video/mp4' if that's supported and preferred, though WEBM is common for canvas.
      }

      const options = {
        mimeType: mimeType,
        videoBitsPerSecond: 5000000 // 5 Mbps, should significantly improve quality
        // audioBitsPerSecond: 128000, // Example if audio was also being recorded
      };
      logToConsole(`Initializing MediaRecorder for ${cameraName} with options:`, 'debug', options);

      const mediaRecorder = new MediaRecorder(stream, options);
      const recordedChunks = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) recordedChunks.push(event.data); };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${cameraName}_processed_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        logToConsole(`Recording stopped for ${cameraName}. File downloaded.`, 'success');
        if (statusElement) statusElement.innerText = "Recording finished.";
        processedCanvas.dataset.isRecording = 'false';
        if (recordButton) { recordButton.textContent = 'Record Processed Canvas'; recordButton.classList.remove('btn-danger'); recordButton.classList.add('btn-info'); }
        delete processedCanvas.mediaRecorder; // Clean up reference
      };

      mediaRecorder.start();
      processedCanvas.dataset.isRecording = 'true';
      processedCanvas.mediaRecorder = mediaRecorder; // Store recorder instance
      logToConsole(`Recording started for ${cameraName}.`, 'info');
      if (statusElement) statusElement.innerText = "Recording...";
      if (recordButton) { recordButton.textContent = 'Stop Recording Canvas'; recordButton.classList.remove('btn-info'); recordButton.classList.add('btn-danger'); }

    } catch (e) {
      logToConsole(`Error starting canvas recording for ${cameraName}: ${e}`, 'error');
      if (statusElement) statusElement.innerText = "Error starting recording.";
      processedCanvas.dataset.isRecording = 'false';
      if (recordButton) { recordButton.textContent = 'Record Processed Canvas'; recordButton.classList.remove('btn-danger'); recordButton.classList.add('btn-info'); }
      delete processedCanvas.mediaRecorder;
    }
  }

  stopRecordProcessedCanvas(cameraName) {
    const processedCanvas = this.processedCanvases.get(cameraName);
    if (processedCanvas?.mediaRecorder && processedCanvas.dataset.isRecording === 'true') {
      processedCanvas.mediaRecorder.stop(); // onstop handler will do the rest
    } else {
      logToConsole(`No active recording found for ${cameraName} to stop.`, 'warn');
    }
  }

  // Method to get processed canvas for external use (e.g., main output)
  getProcessedCanvas(cameraName) {
    return this.processedCanvases.get(cameraName);
  }
}
