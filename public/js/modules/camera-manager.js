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
    const browserVideoDevices = this.availableDevices;

    this.serverDevices.forEach(serverDevice => {
      const serverDeviceNamePart = serverDevice.name?.split(' (')[0];
      let matchedBrowserDevice = null;
      if (serverDeviceNamePart && browserVideoDevices.length > 0) {
        matchedBrowserDevice = browserVideoDevices.find(bd =>
          bd.label && bd.label.startsWith(serverDeviceNamePart)
        );
      }
      if (matchedBrowserDevice) {
        this.serverToBrowserDeviceMap.set(serverDevice.id, matchedBrowserDevice.deviceId);
        logToConsole(`Mapped server ${serverDevice.id} (${serverDevice.name}) to browser ${matchedBrowserDevice.deviceId} (${matchedBrowserDevice.label})`, "success");
      } else {
        logToConsole(`Could not map server device ${serverDevice.id} (${serverDevice.name || 'No Name'}).`, "warn");
        this.serverToBrowserDeviceMap.set(serverDevice.id, null);
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
        if (newCamera.ptzDevice) this.renderPTZControlsForCamera(newCamera.name, newCamera.ptzDevice);

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
      this.stopVideoStream(name);

      // Use DELETE method and URL parameter
      const response = await fetch(`/camera/${encodeURIComponent(name)}`, { method: "DELETE" });

      if (response.ok) {
        logToConsole(`Camera ${name} removed on server.`, "success");
        const cameraElement = this.cameraElements.get(name);
        if (cameraElement) { cameraElement.remove(); this.cameraElements.delete(name); }
        this.cameras = this.cameras.filter((cam) => cam.name !== name);
        this.cameraCompositors.delete(name);
        this.processedCanvases.delete(name);
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
    this.cameras.forEach((camera) => {
      const cameraElement = this.createCameraElement(camera);
      container.appendChild(cameraElement);
      this.cameraElements.set(camera.name, cameraElement);
    });
    // Render PTZ controls after elements are in DOM
    this.cameras.forEach((camera) => {
      if (camera.ptzDevice && this.cameraElements.has(camera.name)) {
        const cameraCard = this.cameraElements.get(camera.name);
        const ptzContainer = cameraCard?.querySelector(`#ptz-controls-${camera.name}`);
        if (ptzContainer) {
          this.renderPTZControlsForCamera(camera.name, camera.ptzDevice, ptzContainer);
        } else {
          logToConsole(`PTZ container not found for ${camera.name} during initial renderCameraControls.`, 'warn');
        }
      }
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
    removeBtn.innerHTML = '&times;'; removeBtn.addEventListener('click', () => this.removeCamera(camera.name));
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
    const previewDeviceOptions = [{ value: "", text: "Select Preview Device" }];
    const currentPreviewBrowserDeviceId = this.serverToBrowserDeviceMap.get(camera.previewDevice);

    this.availableDevices.forEach(browserDevice => {
      previewDeviceOptions.push({ value: browserDevice.deviceId, text: browserDevice.label || `Camera ${browserDevice.deviceId.substring(0, 6)}...` });
    });
    if (camera.previewDevice && !currentPreviewBrowserDeviceId && this.serverDevices.length > 0) {
      const originalServerDevice = this.serverDevices.find(sd => sd.id === camera.previewDevice);
      if (originalServerDevice) {
        previewDeviceOptions.push({ value: "", text: `${originalServerDevice.name} (Not Mapped)`, disabled: true });
      }
    }

    const previewSelectorGroup = this._createSelectGroup(
      'Preview Device:',
      `preview-device-selector-${camera.name}`,
      previewDeviceOptions,
      currentPreviewBrowserDeviceId || "",
      (e) => {
        const selectedBrowserDeviceId = e.target.value;
        const livePreviewCheckbox = document.getElementById(`live-preview-${camera.name}`);
        if (livePreviewCheckbox) {
          livePreviewCheckbox.disabled = !selectedBrowserDeviceId;
          if (!selectedBrowserDeviceId) {
            livePreviewCheckbox.checked = false;
            this.stopVideoStream(camera.name);
            if (deviceInfoElement) deviceInfoElement.textContent = 'No device selected';
          } else {
            if (livePreviewCheckbox.checked) {
              this.updatePreviewDevice(camera.name, selectedBrowserDeviceId);
            }
          }
        }
        let serverIdToUpdate = null;
        if (selectedBrowserDeviceId) {
          for (const [serverID, bID] of this.serverToBrowserDeviceMap.entries()) {
            if (bID === selectedBrowserDeviceId) { serverIdToUpdate = serverID; break; }
          }
        }
        this._updateCameraConfig(camera.name, { previewDevice: serverIdToUpdate || '' });
      }
    );
    controlsDiv.appendChild(previewSelectorGroup);

    // --- Live Preview Toggle ---
    const livePreviewInitialChecked = !!(currentPreviewBrowserDeviceId && videoElement.srcObject && !videoElement.paused);
    const livePreviewToggleGroup = this._createToggleSwitch(
      'Show Live Preview',
      `live-preview-${camera.name}`,
      livePreviewInitialChecked,
      async (isChecked) => {
        const selector = document.getElementById(`preview-device-selector-${camera.name}`);
        const selectedBrowserDeviceId = selector ? selector.value : null;
        if (isChecked && selectedBrowserDeviceId) {
          await this.updatePreviewDevice(camera.name, selectedBrowserDeviceId);
        } else if (!isChecked) {
          this.stopVideoStream(camera.name);
          if (deviceInfoElement) deviceInfoElement.textContent = 'Preview stopped.';
        } else if (isChecked && !selectedBrowserDeviceId) {
          logToConsole(`Cannot start preview for ${camera.name}: No device selected.`, 'warn');
          const checkboxInput = livePreviewToggleGroup.querySelector('input[type="checkbox"]');
          if (checkboxInput) checkboxInput.checked = false;
        }
      }
    );

    const livePreviewCheckboxInput = livePreviewToggleGroup.querySelector('input[type="checkbox"]');
    if (livePreviewCheckboxInput) livePreviewCheckboxInput.disabled = !currentPreviewBrowserDeviceId;
    controlsDiv.appendChild(livePreviewToggleGroup);

    // --- Recording Device Selector ---
    const recordingDeviceOptions = [{ value: "", text: "Select Rec. Device (Server)" }];
    this.serverDevices.forEach(serverDevice => recordingDeviceOptions.push({ value: serverDevice.id, text: serverDevice.name || serverDevice.id }));
    controlsDiv.appendChild(this._createSelectGroup(
      'Recording Device (Server):',
      `recording-device-selector-${camera.name}`,
      recordingDeviceOptions,
      camera.recordingDevice || "",
      (e) => this.updateRecordingDevice(camera.name, e.target.value)
    ));

    // --- PTZ Device Selector ---
    const ptzDeviceOptions = [{ value: "", text: "Select PTZ Device" }];
    this.ptzDevices.forEach(ptzDevice => {
      const value = ptzDevice.id !== undefined ? ptzDevice.id : ptzDevice.path;
      ptzDeviceOptions.push({ value: value, text: ptzDevice.name || value });
    });
    const ptzControlsContainerOriginal = document.createElement('div');
    ptzControlsContainerOriginal.id = `ptz-controls-${camera.name}`;
    ptzControlsContainerOriginal.className = 'ptz-controls-container';
    ptzControlsContainerOriginal.style.display = camera.ptzDevice ? 'block' : 'none';

    const ptzSelectGroup = this._createSelectGroup(
      'PTZ Device (Server):',
      `ptz-device-selector-${camera.name}`,
      ptzDeviceOptions,
      camera.ptzDevice || "",
      (e) => {
        this.updatePTZDevice(camera.name, e.target.value);
        this.renderPTZControlsForCamera(camera.name, e.target.value, ptzControlsContainerOriginal);
      }
    );
    controlsDiv.appendChild(ptzSelectGroup);
    controlsDiv.appendChild(ptzControlsContainerOriginal);


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
      `Enable Background Mask`,
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

    if (camera.ptzDevice) {
      this.renderPTZControlsForCamera(camera.name, camera.ptzDevice, ptzControlsContainerOriginal);
    }

    if (currentPreviewBrowserDeviceId && livePreviewInitialChecked) {
      setTimeout(() => {
        this.updatePreviewDevice(camera.name, currentPreviewBrowserDeviceId);
      }, 100);
    } else if (currentPreviewBrowserDeviceId && !livePreviewInitialChecked) {
      const device = this.availableDevices.find(d => d.deviceId === currentPreviewBrowserDeviceId);
      if (deviceInfoElement) deviceInfoElement.textContent = `Device: ${device?.label || 'Unknown'}. Preview off.`;
    }

    this.cameraElements.set(camera.name, card);
    return card;
  }

  // --- Device Update Methods ---
  async updatePreviewDevice(cameraName, browserDeviceId) {
    logToConsole(`Updating preview for ${cameraName} to browser device ID: ${browserDeviceId}`, "info");
    const videoElement = document.getElementById(`video-${cameraName}`);
    const cameraCard = this.cameraElements.get(cameraName);
    const deviceInfoElement = cameraCard?.querySelector('.device-info');
    const compositor = this.cameraCompositors.get(cameraName);

    if (!videoElement || !cameraCard) {
      logToConsole(`Preview update error: Video or card element for ${cameraName} not found.`, "error"); return;
    }
    // Stop existing stream before starting new one
    this.stopVideoStream(cameraName);

    if (!browserDeviceId) {
      logToConsole(`No preview device selected for ${cameraName}. Clearing preview.`, "info");
      if (deviceInfoElement) deviceInfoElement.textContent = 'No device selected';
      this._updateCameraConfig(cameraName, { previewDevice: '' }); // Update local & server
      return;
    }

    try {
      const selectedBrowserDevice = this.availableDevices.find(bd => bd.deviceId === browserDeviceId);
      const browserDeviceLabel = selectedBrowserDevice?.label || `Device ${browserDeviceId.substring(0, 6)}...`;
      if (deviceInfoElement) deviceInfoElement.textContent = `Connecting to: ${browserDeviceLabel}...`;

      // Get desired resolution from UI
      const resolutionSelect = document.getElementById('recording-resolution');
      let constraints = { video: { deviceId: { exact: browserDeviceId }, frameRate: { ideal: 30 } } };
      if (resolutionSelect?.value && resolutionSelect.value.includes('x')) {
        const [width, height] = resolutionSelect.value.split('x').map(Number);
        if (width > 0 && height > 0) constraints.video.width = { ideal: width }; constraints.video.height = { ideal: height };
      }

      // Add event listener for loadedmetadata to log resolution BEFORE setting srcObject
      const onMetadataLoaded = () => {
        logToConsole(
          `Preview for ${cameraName} (${browserDeviceLabel}): Metadata loaded. Video resolution: ${videoElement.videoWidth}x${videoElement.videoHeight}`,
          "success"
        );
        // Clean up this specific listener after it fires
        videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
      };
      videoElement.addEventListener('loadedmetadata', onMetadataLoaded);

      videoElement.onerror = (e) => {
        logToConsole(`Error event on video element for ${cameraName}: ${e.message || 'Unknown video element error'}`, 'error');
        if (deviceInfoElement) deviceInfoElement.textContent = 'Video error.';
        // Clean up listener on error too
        videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = stream;
      await videoElement.play();
      // Note: Actual frame rate might be available from stream.getVideoTracks()[0].getSettings().frameRate after play()
      // but videoWidth/videoHeight from the element is reliable after loadedmetadata.

      if (deviceInfoElement) deviceInfoElement.textContent = `Using: ${browserDeviceLabel}`;

      // Find corresponding server ID
      let serverIdToUpdate = null;
      for (const [serverID, bID] of this.serverToBrowserDeviceMap.entries()) {
        if (bID === browserDeviceId) { serverIdToUpdate = serverID; break; }
      }
      this._updateCameraConfig(cameraName, { previewDevice: serverIdToUpdate }); // Update local & server

      if (compositor) {
        compositor.setCurrentFrameSource(videoElement);
      } else {
        logToConsole(`Compositor not found for ${cameraName} after starting stream.`, 'warn');
      }

    } catch (err) {
      logToConsole(`Error starting preview for ${cameraName}: ${err.message}`, "error");
      if (deviceInfoElement) deviceInfoElement.textContent = `Error: ${err.message.split(':')[0]}`;
      this.stopVideoStream(cameraName); // Ensure cleanup on error
      const previewSelect = document.getElementById(`preview-device-selector-${cameraName}`);
      if (previewSelect) previewSelect.value = ''; // Reset dropdown
      const livePreviewCheckbox = document.getElementById(`live-preview-${cameraName}`);
      if (livePreviewCheckbox) { livePreviewCheckbox.checked = false; livePreviewCheckbox.disabled = true; } // Reset toggle
      this._updateCameraConfig(cameraName, { previewDevice: '' }); // Clear config
    }
  }

  async updateRecordingDevice(cameraName, serverDeviceId) {
    logToConsole(`Updating recording device for ${cameraName} to server ID: ${serverDeviceId}`, "info");
    this._updateCameraConfig(cameraName, { recordingDevice: serverDeviceId });
  }

  async updatePTZDevice(cameraName, serverDeviceId) {
    logToConsole(`Updating PTZ device for ${cameraName} to server ID/path: ${serverDeviceId}`, "info");
    this._updateCameraConfig(cameraName, { ptzDevice: serverDeviceId });

    // Find the specific PTZ container for this camera
    const cameraCard = this.cameraElements.get(cameraName);
    const ptzContainer = cameraCard?.querySelector(`#ptz-controls-${cameraName}`);

    this.renderPTZControlsForCamera(cameraName, serverDeviceId, ptzContainer); // Pass the found container
  }

  // Consolidated method to update local camera state and push to server
  async _updateCameraConfig(cameraName, updates) {
    const camera = this.cameras.find(c => c.name === cameraName);
    if (!camera) {
      logToConsole(`Cannot update config: Camera ${cameraName} not found locally.`, 'warn');
      return; // Exit if camera doesn't exist locally
    }

    // Store original values to revert on error
    const originalValues = {};
    for (const key in updates) {
      if (Object.hasOwnProperty.call(updates, key) && Object.hasOwnProperty.call(camera, key)) {
        originalValues[key] = camera[key];
        camera[key] = updates[key]; // Update local state optimistically
      } else {
        logToConsole(`Skipping update for unknown property: ${key}`, 'warn');
        delete updates[key]; // Don't send unknown properties
      }
    }

    if (Object.keys(updates).length === 0) return; // Don't fetch if no valid updates

    logToConsole(`Updating local config for ${cameraName}:`, 'debug', updates);

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
    const compositor = this.cameraCompositors.get(cameraName);
    if (videoElement?.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
      logToConsole(`Stopped video stream for ${cameraName}.`, "info");
      if (compositor) compositor.removeFrameSource();
      const cameraCard = this.cameraElements.get(cameraName);
      const deviceInfoElement = cameraCard?.querySelector('.device-info');
      if (deviceInfoElement) deviceInfoElement.textContent = 'Preview stopped';
      videoElement.style.backgroundColor = "#222";
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
    if (!ptzContainer) return;
    ptzContainer.innerHTML = ''; // Clear previous
    if (!ptzDeviceId) {
      ptzContainer.innerHTML = '<p class="ptz-placeholder text-muted small">No PTZ device selected.</p>'; return;
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
      const stream = processedCanvas.captureStream(30);
      const mimeType = 'video/webm;codecs=vp9'; // VP9 preferred for potential alpha
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        logToConsole(`VP9 mimeType not supported for MediaRecorder. Recording may fail or lack alpha.`, 'warn');
        // Could fallback here if needed: mimeType = 'video/webm';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
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
