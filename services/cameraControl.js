const { exec } = require('child_process');

class CameraControl {
    constructor() {
        this.cameras = {
            'PTZ Camera': '/dev/video2',
            'Webcam': '/dev/video0'
        };
        this.currentCamera = null;
    }

    setCamera(deviceName) {
        if (this.cameras[deviceName]) {
            this.currentCamera = deviceName;
            console.log(`Selected camera: ${deviceName} (${this.cameras[deviceName]})`);
            return true;
        }
        return false;
    }

    setPTZ({ pan = null, tilt = null, zoom = null }) {
        if (!this.currentCamera || !this.cameras[this.currentCamera]) return;

        const device = this.cameras[this.currentCamera];
        
        try {
            if (pan !== null) {
                const cmd = `v4l2-ctl --device=${device} --set-ctrl=pan_absolute=${pan}`;
                console.log('Executing:', cmd);
                exec(cmd);
            }
            if (tilt !== null) {
                const cmd = `v4l2-ctl --device=${device} --set-ctrl=tilt_absolute=${tilt}`;
                console.log('Executing:', cmd);
                exec(cmd);
            }
            if (zoom !== null) {
                const cmd = `v4l2-ctl --device=${device} --set-ctrl=zoom_absolute=${zoom}`;
                console.log('Executing:', cmd);
                exec(cmd);
            }
        } catch (err) {
            console.error('Camera control error:', err);
        }
    }

    getCameras() {
        return Object.keys(this.cameras);
    }

    getCurrentCamera() {
        return this.currentCamera;
    }

    getDevicePath(camera) {
        return this.cameras[camera];
    }
}

module.exports = new CameraControl();
