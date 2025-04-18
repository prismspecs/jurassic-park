class Camera {
    constructor(name) {
        this.name = name;
        this.previewDevice = null;
        this.recordingDevice = null;
        this.ptzDevice = null;
        this.previewStream = null;
        this.previewElement = null;
    }

    async startPreview(videoElement) {
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
        this.previewDevice = deviceId;
        // If we have a preview element, restart the preview
        if (this.previewElement) {
            this.startPreview(this.previewElement);
        }
    }

    setRecordingDevice(deviceId) {
        this.recordingDevice = deviceId;
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
}

module.exports = Camera; 