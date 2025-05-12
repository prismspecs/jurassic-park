#!/bin/bash

# Create directory structure for TensorFlow.js files
mkdir -p public/js/vendor/tensorflow/tfjs-core/4.17.0/dist
mkdir -p public/js/vendor/tensorflow/tfjs-backend-webgpu/4.17.0/dist
mkdir -p public/js/vendor/tensorflow/tfjs-converter/4.17.0/dist
mkdir -p public/js/vendor/tensorflow/tfjs-backend-webgl/4.17.0/dist
mkdir -p public/js/vendor/tensorflow/tfjs-backend-wasm/4.17.0/dist
mkdir -p public/js/vendor/tensorflow/pose-detection/2.1.0/dist

# Download TensorFlow.js files
echo "Downloading TensorFlow.js files..."

# Core
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.17.0/dist/tf-core.min.js" -o "public/js/vendor/tensorflow/tfjs-core/4.17.0/dist/tf-core.min.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded tf-core.min.js"
else
    echo "✗ Failed to download tf-core.min.js"
fi

# WebGPU backend
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgpu@4.17.0/dist/tf-backend-webgpu.js" -o "public/js/vendor/tensorflow/tfjs-backend-webgpu/4.17.0/dist/tf-backend-webgpu.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded tf-backend-webgpu.js"
else
    echo "✗ Failed to download tf-backend-webgpu.js"
fi

# Converter
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.17.0/dist/tf-converter.min.js" -o "public/js/vendor/tensorflow/tfjs-converter/4.17.0/dist/tf-converter.min.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded tf-converter.min.js"
else
    echo "✗ Failed to download tf-converter.min.js"
fi

# WebGL backend
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.17.0/dist/tf-backend-webgl.min.js" -o "public/js/vendor/tensorflow/tfjs-backend-webgl/4.17.0/dist/tf-backend-webgl.min.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded tf-backend-webgl.min.js"
else
    echo "✗ Failed to download tf-backend-webgl.min.js"
fi

# WASM backend
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.17.0/dist/tf-backend-wasm.js" -o "public/js/vendor/tensorflow/tfjs-backend-wasm/4.17.0/dist/tf-backend-wasm.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded tf-backend-wasm.js"
else
    echo "✗ Failed to download tf-backend-wasm.js"
fi

# Pose Detection
curl -L "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.0/dist/pose-detection.min.js" -o "public/js/vendor/tensorflow/pose-detection/2.1.0/dist/pose-detection.min.js"
if [ $? -eq 0 ]; then
    echo "✓ Downloaded pose-detection.min.js"
else
    echo "✗ Failed to download pose-detection.min.js"
fi

echo "All TensorFlow.js files downloaded successfully." 