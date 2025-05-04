import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from PIL import Image
import argparse
from tqdm import tqdm  # Import tqdm

# Load MoveNet Thunder model (higher accuracy)
model = hub.load("https://tfhub.dev/google/movenet/singlepose/thunder/4")
movenet = model.signatures["serving_default"]


def detect_pose(frame, confidence_threshold=0.3):
    image = tf.image.resize_with_pad(tf.expand_dims(frame, axis=0), 256, 256)
    input_image = tf.cast(image, dtype=tf.int32)
    outputs = movenet(input_image)
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
):
    cap = cv2.VideoCapture(input_path)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = None

    # Get total number of frames for tqdm
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Wrap the loop with tqdm
    for _ in tqdm(range(total_frames), desc="Processing video", unit="frame"):
        ret, frame = cap.read()
        if not ret:
            break

        keypoints = detect_pose(frame, confidence_threshold)
        if keypoints is not None:
            mask = create_mask(
                frame, keypoints, radius, dilation_iterations, blur_kernel_size
            )
        else:
            mask = np.zeros(frame.shape[:2], dtype=np.uint8)

        result = apply_mask(frame, mask)

        if out is None:
            h, w = result.shape[:2]
            out = cv2.VideoWriter(
                output_path, fourcc, cap.get(cv2.CAP_PROP_FPS), (w, h), True
            )

        out.write(cv2.cvtColor(result, cv2.COLOR_BGRA2BGR))

    cap.release()
    if out:  # Check if out was initialized
        out.release()
    print(
        "\n✅ Processing complete:", output_path
    )  # Added newline for cleaner output after tqdm


# Example usage -> Replaced with CLI argument parsing
# process_video("input.mp4", "output.mp4")

if __name__ == "__main__":
    # Check for available devices, including Metal GPU
    print("TensorFlow Devices:")
    devices = tf.config.list_physical_devices()
    gpu_devices = tf.config.list_physical_devices('GPU')
    for device in devices:
        print(f"- {device.name} ({device.device_type})")
    if gpu_devices:
        print("✅ Metal GPU detected and available for TensorFlow!")
    else:
        print("❌ Metal GPU not detected by TensorFlow. Running on CPU.")
    print("---") # Separator

    parser = argparse.ArgumentParser(
        description="Process video to highlight pose keypoints."
    )
    parser.add_argument("input_path", help="Path to the input video file.")
    parser.add_argument("output_path", help="Path to save the output video file.")
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

    process_video(
        args.input_path,
        args.output_path,
        args.radius,
        args.confidence,
        args.dilate,
        args.blur,
    )
