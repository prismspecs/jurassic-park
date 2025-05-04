import tensorflow as tf
import argparse
import os
import time  # Added import

# Import refactored components
from config import MODEL_INFO  # Keep for arg choices
from model_loader import load_model
from video_processor import process_video

# --- Remove Global variables (managed elsewhere now) ---
# movenet = None
# model_input_size = None
# frame_queue = queue.Queue(maxsize=16)
# result_queue = queue.Queue()
# processing_done = threading.Event()

# --- Remove load_model function (moved to model_loader.py) ---
# def load_model(...): ...

# --- Remove detect_pose function (moved to pose_detector.py) ---
# def detect_pose(...): ...

# --- Remove create_mask function (moved to masking.py) ---
# def create_mask(...): ...

# --- Remove apply_mask function (moved to masking.py) ---
# def apply_mask(...): ...

# --- Remove process_frame function (moved to video_processor.py) ---
# def process_frame(...): ...

# --- Remove frame_reader function (moved to video_processor.py) ---
# def frame_reader(...): ...

# --- Remove process_video function (moved to video_processor.py) ---
# def process_video(...): ...


# --- Remove Skeleton Structure (moved to config.py) ---
# KEYPOINT_DICT = { ... }
# SKELETON_LINES = [ ... ]

# --- Remove MODEL_INFO (moved to config.py) ---
# MODEL_INFO = { ... }


if __name__ == "__main__":
    # Configure TensorFlow logging and performance settings
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "1"  # Reduce TF verbosity
    tf.get_logger().setLevel("WARNING")

    print("TensorFlow Devices:")
    try:
        devices = tf.config.list_physical_devices()
        gpu_devices = tf.config.list_physical_devices("GPU")

        if not devices:
            print("  No devices found.")
        else:
            for device in devices:
                print(f"- {device.name} ({device.device_type})")

        # Configure GPU memory growth if available
        if gpu_devices:
            try:
                for gpu in gpu_devices:
                    tf.config.experimental.set_memory_growth(gpu, True)
                print("✅ GPU detected and memory growth enabled!")
            except RuntimeError as e:
                print(f"❌ Error setting GPU memory growth: {e}")
                print("⚠️ Continuing with default configuration")
        else:
            # Check for Metal device specifically on macOS
            if any(d.device_type == "GPU" for d in devices):
                print(
                    "✅ Metal GPU detected by TensorFlow (memory growth enabled by default on recent TF versions)."
                )
            else:
                print(
                    "❌ No GPU (including Metal) detected by TensorFlow. Running on CPU."
                )

        # Disable TF32 for full precision if needed, though often faster on Ampere+ GPUs
        # tf.config.experimental.enable_tensor_float_32_execution(False)
        # print("Using full precision (TF32 disabled)")

    except Exception as e:
        print(f"Error during TensorFlow device configuration: {e}")
    print("---")

    parser = argparse.ArgumentParser(
        description="Process video to highlight pose keypoints using MoveNet."
    )
    parser.add_argument("input_path", help="Path to the input video file.")
    parser.add_argument("output_path", help="Path to save the output .webm video file.")
    parser.add_argument(
        "--model_type",
        choices=list(MODEL_INFO.keys()),
        default="multipose_lightning",
        help="MoveNet model type ('lightning'/'thunder' for single pose, 'multipose_lightning' for multiple).",
    )
    parser.add_argument(
        "--processing_width",
        type=int,
        default=None,
        help="Resize video to this width for processing (e.g., 640). Processes at original resolution if omitted.",
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
    parser.add_argument(
        "--threads",
        type=int,
        default=None,
        help="Number of processing threads (defaults to CPU count - 1).",
    )

    args = parser.parse_args()

    # --- Main Execution Flow ---
    try:
        # 1. Load the model
        print(f"Loading model: {args.model_type}")
        movenet_signature, model_input_size = load_model(args.model_type)
        print("Model loaded successfully.")

        # 2. Process the video
        print(f"Processing video: {args.input_path}")
        start_time = time.time()
        frames_written = process_video(
            input_path=args.input_path,
            output_path=args.output_path,
            movenet_signature=movenet_signature,  # Pass loaded signature
            model_input_size=model_input_size,  # Pass loaded input size
            radius=args.radius,
            confidence_threshold=args.confidence,
            dilation_iterations=args.dilate,
            blur_kernel_size=args.blur,
            processing_width=args.processing_width,
            num_threads=args.threads,
        )
        end_time = time.time()
        processing_time = end_time - start_time
        print(f"\nVideo processing finished in {processing_time:.2f} seconds.")
        if frames_written > 0:
            # Ensure the output path shown matches the one potentially modified by process_video
            output_filename = args.output_path
            if not output_filename.lower().endswith(".webm"):
                output_filename = os.path.splitext(args.output_path)[0] + ".webm"
            print(f"Output saved to: {output_filename}")
        else:
            print("Processing resulted in zero frames written.")

    except ValueError as ve:
        print(f"Configuration Error: {ve}")
    except FileNotFoundError as fnfe:
        print(f"File Error: {fnfe}")
    except RuntimeError as rte:  # Catch RuntimeErrors specifically
        print(f"Runtime Error: {rte}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        import traceback

        traceback.print_exc()
