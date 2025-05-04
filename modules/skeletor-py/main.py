import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from PIL import Image
import argparse
from tqdm import tqdm  # Import tqdm

# Model dictionary with input sizes
MODEL_INFO = {
    "thunder": {
        "url": "https://tfhub.dev/google/movenet/singlepose/thunder/4",
        "input_size": 256,
    },
    "lightning": {
        "url": "https://tfhub.dev/google/movenet/singlepose/lightning/4",
        "input_size": 192,
    },
}

# Global variable for loaded model and its input size
movenet = None
model_input_size = None


def load_model(model_type="thunder"):
    """Loads the specified MoveNet model."""
    global movenet, model_input_size  # Update global variables
    if model_type not in MODEL_INFO:
        raise ValueError(
            f"Invalid model type: {model_type}. Choose from {list(MODEL_INFO.keys())}"
        )

    info = MODEL_INFO[model_type]
    model_input_size = info["input_size"]  # Store input size
    model_url = info["url"]

    print(
        f"Loading MoveNet {model_type.capitalize()} model (expects {model_input_size}x{model_input_size} input)..."
    )
    model = hub.load(model_url)
    movenet = model.signatures["serving_default"]
    print("Model loaded.")


def detect_pose(frame, confidence_threshold=0.3):
    # Use the globally stored model_input_size for resizing
    if model_input_size is None:
        raise RuntimeError("Model not loaded or input size not set.")

    image = tf.image.resize_with_pad(
        tf.expand_dims(frame, axis=0), model_input_size, model_input_size
    )
    input_image = tf.cast(image, dtype=tf.int32)

    # Call the model by specifying the input tensor name 'input'
    outputs = movenet(input=input_image)
    keypoints = outputs["output_0"].numpy()[0, 0, :, :]

    # Only keep if confidence is high
    valid_kps = keypoints[keypoints[:, 2] > confidence_threshold][:, :2]
    if len(valid_kps) == 0:
        return None

    # Convert normalized keypoints to pixel coordinates
    h, w, _ = frame.shape
    keypoints_px = np.array(valid_kps * [w, h], dtype=np.int32)
    return keypoints_px


def create_mask(
    frame, keypoints, radius=30, dilation_iterations=10, blur_kernel_size=21
):
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    for x, y in keypoints:
        cv2.circle(mask, (x, y), radius, 255, -1)
    mask = cv2.dilate(mask, None, iterations=dilation_iterations)
    # Ensure kernel size is odd
    blur_kernel_size = (
        blur_kernel_size if blur_kernel_size % 2 != 0 else blur_kernel_size + 1
    )
    mask = cv2.GaussianBlur(mask, (blur_kernel_size, blur_kernel_size), 0)
    return mask


def apply_mask(frame, mask):
    b, g, r = cv2.split(frame)
    alpha = mask
    return cv2.merge((b, g, r, alpha))


def process_video(
    input_path,
    output_path,
    radius,
    confidence_threshold,
    dilation_iterations,
    blur_kernel_size,
    processing_width,  # New argument
):
    cap = cv2.VideoCapture(input_path)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = None

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    target_w, target_h = orig_w, orig_h
    if (
        processing_width is not None
        and processing_width > 0
        and processing_width < orig_w
    ):
        print(f"Resizing frames for processing to width: {processing_width}")
        target_w = processing_width
        target_h = int(orig_h * (processing_width / orig_w))
        # Ensure height is even for some codecs
        target_h = target_h if target_h % 2 == 0 else target_h + 1
    else:
        print("Processing at original resolution.")

    for _ in tqdm(range(total_frames), desc="Processing video", unit="frame"):
        ret, frame = cap.read()
        if not ret:
            break

        # Resize frame if needed *before* processing
        if target_w != orig_w:
            frame_processed = cv2.resize(
                frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR
            )
        else:
            frame_processed = frame

        # --- Process the potentially smaller frame ---
        keypoints = detect_pose(frame_processed, confidence_threshold)
        if keypoints is not None:
            mask = create_mask(
                frame_processed,
                keypoints,
                radius,
                dilation_iterations,
                blur_kernel_size,
            )
        else:
            mask = np.zeros(frame_processed.shape[:2], dtype=np.uint8)

        result = apply_mask(frame_processed, mask)
        # --- End processing smaller frame ---

        if out is None:
            # Use target dimensions for the output writer
            out = cv2.VideoWriter(output_path, fourcc, fps, (target_w, target_h), True)

        # Write the processed (potentially smaller) result
        # Ensure result is BGR before writing
        if result.shape[2] == 4:  # BGRA
            out.write(cv2.cvtColor(result, cv2.COLOR_BGRA2BGR))
        else:  # Assume BGR
            out.write(result)

    cap.release()
    if out:
        out.release()
    print("\n✅ Processing complete:", output_path)


if __name__ == "__main__":
    # Check for available devices, including Metal GPU
    print("TensorFlow Devices:")
    devices = tf.config.list_physical_devices()
    gpu_devices = tf.config.list_physical_devices("GPU")
    for device in devices:
        print(f"- {device.name} ({device.device_type})")
    if gpu_devices:
        print("✅ Metal GPU detected and available for TensorFlow!")
    else:
        print("❌ Metal GPU not detected by TensorFlow. Running on CPU.")
    print("---")  # Separator

    parser = argparse.ArgumentParser(
        description="Process video to highlight pose keypoints."
    )
    parser.add_argument("input_path", help="Path to the input video file.")
    parser.add_argument("output_path", help="Path to save the output video file.")
    parser.add_argument(
        "--model_type",
        choices=list(MODEL_INFO.keys()),
        default="thunder",  # Use keys from MODEL_INFO
        help="MoveNet model type ('lightning' is faster, 'thunder' is more accurate).",
    )
    parser.add_argument(
        "--processing_width",
        type=int,
        default=None,
        help="Resize video to this width for processing (e.g., 640). Processes at original resolution if omitted or >= original width.",
    )
    parser.add_argument(
        "--radius", type=int, default=30, help="Radius of the circle around keypoints."
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.3,
        help="Minimum confidence threshold for keypoints (0.0 to 1.0).",
    )
    parser.add_argument(
        "--dilate",
        type=int,
        default=10,
        help="Number of dilation iterations for the mask.",
    )
    parser.add_argument(
        "--blur", type=int, default=21, help="Gaussian blur kernel size (odd number)."
    )

    args = parser.parse_args()

    # Load the selected model (this will set model_input_size)
    load_model(args.model_type)

    process_video(
        args.input_path,
        args.output_path,
        args.radius,
        args.confidence,
        args.dilate,
        args.blur,
        args.processing_width,  # Pass the new argument
    )
