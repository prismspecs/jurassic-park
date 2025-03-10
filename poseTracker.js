module.exports = {
    loadModels() {
        console.log('Pose tracking model(s) loaded. (Placeholder)');
    },
    processPoseData(payload) {
        // e.g. { x:..., y:..., keypoints:... }
        console.log('Received pose data:', payload);
        // Compare with reference shot
    }
};
