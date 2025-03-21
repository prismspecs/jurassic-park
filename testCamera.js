const { exec } = require('child_process');

const device = '/dev/video2';

function setPTZ({ pan = null, tilt = null, zoom = null }) {
  if (pan !== null) {
    exec(`v4l2-ctl --device=${device} --set-ctrl=pan_absolute=${pan}`, logResult);
  }
  if (tilt !== null) {
    exec(`v4l2-ctl --device=${device} --set-ctrl=tilt_absolute=${tilt}`, logResult);
  }
  if (zoom !== null) {
    exec(`v4l2-ctl --device=${device} --set-ctrl=zoom_absolute=${zoom}`, logResult);
  }
}

function logResult(err, stdout, stderr) {
  if (err) {
    console.error('Error:', err.message);
    return;
  }
  if (stderr) console.error('stderr:', stderr);
  if (stdout) console.log('stdout:', stdout);
}

// Example: center pan, tilt up a bit, slight zoom
setPTZ({
  pan: 0,
  tilt: 50000,
  zoom: 20
});
