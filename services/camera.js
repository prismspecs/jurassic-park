class Camera {
    constructor(name) {
        this.name = name;
        this.previewDevice = null;
        this.recordingDevice = null;
        this.ptzDevice = null;
        this.previewStream = null;
        this.previewElement = null;
        this.showSkeleton = false; // Add state for skeleton tracking
        this.currentPan = 0; // Cache last known pan value
        this.currentTilt = 0; // Cache last known tilt value
    }

    async startPreview(videoElement) {
        console.log('Starting preview for camera:', this.name);
        try {
            // Stop any existing preview
            if (this.previewStream) {
                this.previewStream.getTracks().forEach(track => track.stop());
            }

            if (!this.previewDevice) {
                throw new Error('No preview device configured');
            }

            // Start new preview
            const constraints = {
                video: {
                    deviceId: { exact: this.previewDevice },
                    frameRate: { ideal: 30 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.previewStream = stream;
            videoElement.srcObject = stream;
            this.previewElement = videoElement;
            return true;
        } catch (err) {
            console.error(`Failed to start preview for camera ${this.name}:`, err);
            return false;
        }
    }

    stopPreview() {
        if (this.previewStream) {
            this.previewStream.getTracks().forEach(track => track.stop());
            this.previewStream = null;
        }
        if (this.previewElement) {
            this.previewElement.srcObject = null;
            this.previewElement = null;
        }
    }

    setPreviewDevice(deviceId) {
        // Store the device ID selected by the user on the frontend.
        // This ID corresponds to navigator.mediaDevices.enumerateDevices()
        this.previewDevice = deviceId;
        console.log(`[Camera Instance ${this.name}] Preview device ID set to: ${this.previewDevice} (type: ${typeof this.previewDevice})`);
        // REMOVED: Do not attempt to start preview from the backend.
        // The frontend CameraManager handles calling startPreview.
        /*
        if (this.previewElement) {
            this.startPreview(this.previewElement);
        }
        */
    }

    setRecordingDevice(devicePath) {
        console.log(`[Camera Instance ${this.name}] setRecordingDevice called with: ${devicePath}`);
        this.recordingDevice = devicePath;
        console.log(`[Camera Instance ${this.name}] this.recordingDevice is now: ${this.recordingDevice}`);
    }

    setPTZDevice(deviceId) {
        this.ptzDevice = deviceId;
    }

    getPreviewDevice() {
        return this.previewDevice;
    }

    getRecordingDevice() {
        return this.recordingDevice;
    }

    getPTZDevice() {
        return this.ptzDevice;
    }

    // Add methods to get/set skeleton state
    getShowSkeleton() {
        return this.showSkeleton;
    }

    setShowSkeleton(show) {
        this.showSkeleton = !!show; // Ensure boolean
        console.log(`[Camera Instance ${this.name}] showSkeleton set to: ${this.showSkeleton}`);
    }

    setCurrentPan(pan) {
        this.currentPan = pan;
    }

    getCurrentPan() {
        return this.currentPan;
    }

    setCurrentTilt(tilt) {
        this.currentTilt = tilt;
    }

    getCurrentTilt() {
        return this.currentTilt;
    }
}

module.exports = Camera;