import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from PIL import Image
import argparse
from tqdm import tqdm  # Import tqdm
import os  # Added for path manipulation, directory creation
import subprocess  # Added for running external ffmpeg
import shutil  # Added for removing temporary directory

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
    "multipose_lightning": {
        "url": "https://tfhub.dev/google/movenet/multipose/lightning/1",
        "input_size": 256,  # Performs best at 256x256 or similar
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
    print(f"Attempting to load model from URL: {model_url}")
    model = hub.load(model_url)
    print("hub.load(model_url) call completed.")
    print("Attempting to get model signature...")
    movenet = model.signatures["serving_default"]
    print("Model signature retrieved. Model loaded.")


def detect_pose(frame, confidence_threshold=0.3):
    h_proc, w_proc, _ = frame.shape  # Dimensions of the frame *before* padding

    if model_input_size is None:
        raise RuntimeError("Model not loaded or input size not set.")

    # Preprocess image (resize and pad)
    image = tf.convert_to_tensor(frame)
    image = tf.image.resize_with_pad(
        tf.expand_dims(image, axis=0), model_input_size, model_input_size
    )
    input_image = tf.cast(image, dtype=tf.int32)

    outputs = movenet(input=input_image)
    output_data = outputs["output_0"].numpy()

    # --- Calculate padding and scaling factors ---
    # How much the original frame was scaled to fit model_input_size
    scale_y = model_input_size / h_proc
    scale_x = model_input_size / w_proc
    scale = min(scale_y, scale_x)

    # Dimensions after scaling, before padding
    h_scaled = int(h_proc * scale)
    w_scaled = int(w_proc * scale)

    # Padding added to center the scaled image
    pad_y = (model_input_size - h_scaled) // 2
    pad_x = (model_input_size - w_scaled) // 2
    # --------------------------------------------

    detected_persons = []

    if output_data.shape[1] == 1:  # Single pose model
        keypoints_with_scores = output_data[
            0, 0, :, :
        ]  # Shape (17, 3) [y_norm, x_norm, score]
        if np.max(keypoints_with_scores[:, 2]) > confidence_threshold:
            person_data_final = np.zeros_like(keypoints_with_scores)
            for i, (y_norm, x_norm, score) in enumerate(keypoints_with_scores):
                # Coords within padded square
                y_padded = y_norm * model_input_size
                x_padded = x_norm * model_input_size
                # Subtract padding
                y_unpadded = y_padded - pad_y
                x_unpadded = x_padded - pad_x
                # Scale back to original frame dims
                y_final = y_unpadded / scale
                x_final = x_unpadded / scale
                # Clip to frame bounds
                y_final = np.clip(y_final, 0, h_proc - 1)
                x_final = np.clip(x_final, 0, w_proc - 1)
                person_data_final[i] = [y_final, x_final, score]
            detected_persons.append(person_data_final.astype(np.float32))

    elif output_data.shape[1] == 6:  # Multi pose model
        num_detections = output_data.shape[1]
        for i in range(num_detections):
            person = output_data[0, i]
            keypoints_with_scores = person[:51].reshape(
                (17, 3)
            )  # [y_norm, x_norm, score]
            bbox = person[51:]
            person_score = bbox[4]

            if person_score > confidence_threshold:
                person_data_final = np.zeros_like(keypoints_with_scores)
                for j, (y_norm, x_norm, score) in enumerate(keypoints_with_scores):
                    if (
                        score > confidence_threshold
                    ):  # Also check individual keypoint score here? Optional.
                        y_padded = y_norm * model_input_size
                        x_padded = x_norm * model_input_size
                        y_unpadded = y_padded - pad_y
                        x_unpadded = x_padded - pad_x
                        y_final = y_unpadded / scale
                        x_final = x_unpadded / scale
                        y_final = np.clip(y_final, 0, h_proc - 1)
                        x_final = np.clip(x_final, 0, w_proc - 1)
                        person_data_final[j] = [y_final, x_final, score]
                    else:
                        # Store 0s or keep original low-score normalized data? Store 0s for now.
                        person_data_final[j] = [0, 0, score]

                detected_persons.append(person_data_final.astype(np.float32))

    if not detected_persons:
        return None

    return detected_persons  # List of arrays, each array is [[y_px, x_px, score], ...]


def create_mask(
    frame,
    persons_keypoints,  # List of person data [[y,x,score],...]
    confidence_threshold,
    radius=30,  # Base radius, used to derive thickness
    dilation_iterations=10,
    blur_kernel_size=21,
):
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    # Make line thickness and joint radius proportional to the input radius
    # Ensure thickness is at least 1
    joint_radius = max(1, int(radius * 0.5))
    line_thickness = joint_radius  # Use the same for lines and joints

    if persons_keypoints is None:
        return mask  # Return empty mask if no one detected

    for (
        person_kps
    ) in persons_keypoints:  # person_kps is shape (17, 3) [[y, x, score], ...]

        # --- 1. Fill Torso ---
        shoulder_l = person_kps[KEYPOINT_DICT["left_shoulder"]]
        shoulder_r = person_kps[KEYPOINT_DICT["right_shoulder"]]
        hip_l = person_kps[KEYPOINT_DICT["left_hip"]]
        hip_r = person_kps[KEYPOINT_DICT["right_hip"]]

        # Check confidence of all torso keypoints
        if (
            shoulder_l[2] > confidence_threshold
            and shoulder_r[2] > confidence_threshold
            and hip_l[2] > confidence_threshold
            and hip_r[2] > confidence_threshold
        ):

            # Define vertices in order (top-left, top-right, bottom-right, bottom-left)
            torso_pts = np.array(
                [
                    [int(shoulder_l[1]), int(shoulder_l[0])],  # x, y format for cv2
                    [int(shoulder_r[1]), int(shoulder_r[0])],
                    [int(hip_r[1]), int(hip_r[0])],
                    [int(hip_l[1]), int(hip_l[0])],
                ],
                dtype=np.int32,
            )

            cv2.fillPoly(mask, [torso_pts], 255)

        # --- 2. Draw Skeleton Lines ---
        for kp_idx1, kp_idx2 in SKELETON_LINES:
            kp1 = person_kps[kp_idx1]
            kp2 = person_kps[kp_idx2]
            if kp1[2] > confidence_threshold and kp2[2] > confidence_threshold:
                y1, x1 = int(kp1[0]), int(kp1[1])
                y2, x2 = int(kp2[0]), int(kp2[1])
                cv2.line(mask, (x1, y1), (x2, y2), 255, line_thickness)

        # --- 3. Draw Head & Joint Circles ---
        # Define indices for head and limb joints separately
        head_indices = [
            KEYPOINT_DICT[k]
            for k in ["nose", "left_eye", "right_eye", "left_ear", "right_ear"]
        ]
        limb_joint_indices = [
            KEYPOINT_DICT[k]
            for k in [
                "left_elbow",
                "right_elbow",
                "left_wrist",
                "right_wrist",
                "left_knee",
                "right_knee",
                "left_ankle",
                "right_ankle",
            ]
        ]
        # Shoulders and hips are part of torso/lines, no separate circles needed unless desired

        all_joint_indices = head_indices + limb_joint_indices

        for idx in all_joint_indices:
            y_px, x_px, score = person_kps[idx]
            if score > confidence_threshold:
                # Use joint_radius (derived from input radius) for circles
                cv2.circle(mask, (int(x_px), int(y_px)), joint_radius, 255, -1)

    # --- 4. Apply Dilation & Blur ---
    mask = cv2.dilate(mask, None, iterations=dilation_iterations)
    blur_kernel_size = (
        blur_kernel_size if blur_kernel_size % 2 != 0 else blur_kernel_size + 1
    )
    mask = cv2.GaussianBlur(mask, (blur_kernel_size, blur_kernel_size), 0)
    return mask


def apply_mask(frame, mask):
    # Convert frame to float for multiplication
    frame_float = frame.astype(np.float32)
    # Normalize mask to float [0.0, 1.0]
    mask_float = mask.astype(np.float32) / 255.0
    # Make mask 3 channels (needed for element-wise multiplication)
    mask_3ch_float = cv2.cvtColor(mask_float, cv2.COLOR_GRAY2BGR)

    # Multiply frame's BGR data by the normalized mask.
    # Areas where mask is 0 will become black (0*color=0).
    # Areas where mask is 1 will keep original color (1*color=color).
    # Areas in between will be scaled.
    masked_bgr_float = frame_float * mask_3ch_float

    # Convert the blacked-out BGR back to uint8
    masked_bgr_uint8 = masked_bgr_float.astype(np.uint8)

    # Split the blacked-out BGR
    b, g, r = cv2.split(masked_bgr_uint8)

    # Merge the blacked-out BGR with the original mask as the alpha channel
    return cv2.merge((b, g, r, mask))  # Return BGRA


def process_video(
    input_path,
    output_path,
    radius,
    confidence_threshold,
    dilation_iterations,
    blur_kernel_size,
    processing_width,
):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(f"Error: Could not open input video file: {input_path}")
        return

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # --- Temporary Directory Setup for Debugging ---
    # temp_dir = "./skeletor_debug_output"
    # print(f"Using temporary directory for debug images: {temp_dir}")
    # if not os.path.exists(temp_dir):
    #     os.makedirs(temp_dir)
    #     print("Created temporary directory.")
    # We won't delete it automatically for now, so we can inspect the files.
    # -------------------------------------------

    # --- Determine Processing and Output Dimensions ---
    target_w, target_h = orig_w, orig_h
    if (
        processing_width is not None
        and processing_width > 0
        and processing_width < orig_w
    ):
        print(f"Resizing frames for processing to width: {processing_width}")
        target_w = processing_width
        target_h = int(orig_h * (processing_width / orig_w))
        target_h = target_h if target_h % 2 == 0 else target_h + 1
    else:
        print("Processing at original resolution.")
        target_w = orig_w  # Ensure target_w/h are set even if not resizing
        target_h = orig_h

    # --- Setup FFmpeg Process for Streaming ---
    output_filename = output_path
    if not output_filename.lower().endswith(".webm"):
        output_filename = os.path.splitext(output_path)[0] + ".webm"
        print(f"Output requires .webm for transparency. Saving to: {output_filename}")

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",  # Overwrite output file
        # Input options for raw video stream from stdin
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-pix_fmt",
        "bgra",  # Expect BGRA pixels
        "-s",
        f"{target_w}x{target_h}",  # Input size
        "-r",
        str(fps),  # Input framerate
        "-i",
        "-",  # Input from stdin
        # Output options for transparent WebM
        "-c:v",
        "vp9",  # VP9 codec
        "-pix_fmt",
        "yuva420p",  # Output pixel format for VP9 w/ alpha
        "-an",  # No audio
        # Optional: Re-add quality/speed flags if needed, but start simple
        # '-quality', 'good',
        # '-speed', '4',
        output_filename,
    ]

    print(f"Starting FFmpeg process: {' '.join(ffmpeg_cmd)}")
    try:
        ffmpeg_process = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
        # Note: stdout/stderr piped to avoid blocking, text=False for bytes I/O
    except FileNotFoundError:
        print(
            "\n❌ Error: ffmpeg command not found. Please ensure ffmpeg is installed and in your system's PATH."
        )
        cap.release()
        return
    except Exception as e:
        print(f"\n❌ Failed to start ffmpeg process: {e}")
        cap.release()
        return
    # -----------------------------------------

    frame_count = 0
    # --- Frame Processing Loop ---
    for _ in tqdm(
        range(total_frames), desc="Processing & Streaming Frames", unit="frame"
    ):
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        if target_w != orig_w:
            frame_processed = cv2.resize(
                frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR
            )
        else:
            frame_processed = frame

        persons_keypoints = detect_pose(frame_processed, confidence_threshold)
        # print(f"\nFrame {frame_count} - Detected Persons: {'Yes' if persons_keypoints is not None else 'No'}") # DEBUG PRINT REMOVED

        if persons_keypoints is not None:
            mask = create_mask(
                frame_processed,
                persons_keypoints,
                confidence_threshold,
                radius,
                dilation_iterations,
                blur_kernel_size,
            )
            # --- Add temporary mask saving for debugging --- REMOVED
            # if frame_count <= 10: # Save first 10 masks
            #     mask_filename = os.path.join(temp_dir, f"debug_mask_{frame_count:06d}.png")
            #     try:
            #         cv2.imwrite(mask_filename, mask)
            #         print(f"Saved debug mask: {mask_filename}")
            #     except Exception as e:
            #         print(f"Error saving debug mask {mask_filename}: {e}")
            # ---------------------------------------------
        else:
            mask = np.zeros(frame_processed.shape[:2], dtype=np.uint8)
            # --- Save empty mask for comparison --- REMOVED
            # if frame_count <= 10:
            #     mask_filename = os.path.join(temp_dir, f"debug_mask_{frame_count:06d}_empty.png")
            #     try:
            #         cv2.imwrite(mask_filename, mask)
            #         print(f"Saved empty debug mask: {mask_filename}")
            #     except Exception as e:
            #          print(f"Error saving empty debug mask {mask_filename}: {e}")
            # --------------------------------------

        result = apply_mask(frame_processed, mask)  # BGRA result

        # --- Save BGRA result frame for debugging --- REMOVED
        # if frame_count <= 10: # Save first 10 results
        #     result_filename = os.path.join(temp_dir, f"debug_result_{frame_count:06d}.png")
        #     try:
        #         cv2.imwrite(result_filename, result)
        #         print(f"Saved debug result: {result_filename}")
        #     except Exception as e:
        #         print(f"Error saving debug result {result_filename}: {e}")
        # -----------------------------------------

        # --- Stream frame to FFmpeg ---
        try:
            # Ensure result is the correct size expected by ffmpeg
            if result.shape[1] != target_w or result.shape[0] != target_h:
                print(
                    f"\nWarning: Frame {frame_count} size ({result.shape[1]}x{result.shape[0]}) mismatch with ffmpeg input size ({target_w}x{target_h}). Resizing."
                )
                result = cv2.resize(
                    result, (target_w, target_h), interpolation=cv2.INTER_LINEAR
                )

            # Write raw BGRA bytes directly to ffmpeg stdin
            ffmpeg_process.stdin.write(result.tobytes())

        except (BrokenPipeError, IOError) as e:
            print(
                f"\n❌ Error writing frame {frame_count} to FFmpeg stdin: {e}. FFmpeg might have crashed."
            )
            # Check ffmpeg stderr
            stdout, stderr = ffmpeg_process.communicate()
            if stderr:
                print("--- FFmpeg stderr ---")
                print(stderr.decode(errors="ignore"))
                print("---------------------")
            break  # Stop processing
        except Exception as e:
            print(f"\n❌ Unexpected error writing frame {frame_count} to FFmpeg: {e}")
            break
        # ------------------------------

    # --- Finalize FFmpeg ---
    print(f"\nFinished processing {frame_count} frames. Closing FFmpeg stream...")
    if ffmpeg_process.stdin:
        ffmpeg_process.stdin.close()

    # Wait for ffmpeg to finish and capture any remaining output/errors
    # Use wait() instead of communicate() since we manually closed stdin
    return_code = ffmpeg_process.wait()
    # Read any remaining stdout/stderr (may not be necessary if errors were caught during loop)
    stdout, stderr = ffmpeg_process.stdout.read(), ffmpeg_process.stderr.read()

    if return_code == 0:
        print("\n✅ FFmpeg processing complete:", output_filename)
        # Optionally print final stderr if needed for warnings
        if stderr:
            print("--- FFmpeg stderr (final) ---")
            print(stderr.decode(errors="ignore"))
            print("---------------------------")
    else:
        print(f"\n❌ FFmpeg failed with return code: {return_code}")
        if stderr:
            print("--- FFmpeg stderr ---")
            print(stderr.decode(errors="ignore"))
            print("---------------------")
        if stdout:
            print("--- FFmpeg stdout ---")
            print(stdout.decode(errors="ignore"))
            print("---------------------")
    # ----------------------

    cap.release()
    print("Video capture released.")
    # print(f"Debug images saved in: {temp_dir}") # Remind user where debug images are - REMOVED


# --- Define Skeleton Structure (can be moved elsewhere if preferred) ---
# Dictionary that maps from joint names to keypoint indices.
KEYPOINT_DICT = {
    "nose": 0,
    "left_eye": 1,
    "right_eye": 2,
    "left_ear": 3,
    "right_ear": 4,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16,
}

# Defines the edges (lines) connecting keypoints.
# Each tuple represents a pair of keypoint indices from KEYPOINT_DICT.
SKELETON_LINES = [
    (KEYPOINT_DICT["left_shoulder"], KEYPOINT_DICT["right_shoulder"]),
    (KEYPOINT_DICT["left_shoulder"], KEYPOINT_DICT["left_elbow"]),
    (KEYPOINT_DICT["right_shoulder"], KEYPOINT_DICT["right_elbow"]),
    (KEYPOINT_DICT["left_elbow"], KEYPOINT_DICT["left_wrist"]),
    (KEYPOINT_DICT["right_elbow"], KEYPOINT_DICT["right_wrist"]),
    (KEYPOINT_DICT["left_shoulder"], KEYPOINT_DICT["left_hip"]),
    (KEYPOINT_DICT["right_shoulder"], KEYPOINT_DICT["right_hip"]),
    (KEYPOINT_DICT["left_hip"], KEYPOINT_DICT["right_hip"]),
    (KEYPOINT_DICT["left_hip"], KEYPOINT_DICT["left_knee"]),
    (KEYPOINT_DICT["right_hip"], KEYPOINT_DICT["right_knee"]),
    (KEYPOINT_DICT["left_knee"], KEYPOINT_DICT["left_ankle"]),
    (KEYPOINT_DICT["right_knee"], KEYPOINT_DICT["right_ankle"]),
]
# ---------------------------------------------------------------------

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
        default="multipose_lightning",  # Now defaults to multipose
        help="MoveNet model type ('lightning' is faster single-pose, 'thunder' is accurate single-pose, 'multipose_lightning' detects multiple people).",
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
