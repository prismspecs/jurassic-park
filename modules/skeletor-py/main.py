import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub
from PIL import Image
import argparse
from tqdm import tqdm
import os
import subprocess
import shutil
import threading
import queue
import time
from concurrent.futures import ThreadPoolExecutor

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

# Global variables
movenet = None
model_input_size = None

# Frame queue for parallel processing
frame_queue = queue.Queue(maxsize=16)  # Limit queue size to prevent memory issues
result_queue = queue.Queue()
processing_done = threading.Event()


def load_model(model_type="thunder"):
    """Loads the specified MoveNet model."""
    global movenet, model_input_size
    if model_type not in MODEL_INFO:
        raise ValueError(
            f"Invalid model type: {model_type}. Choose from {list(MODEL_INFO.keys())}"
        )

    info = MODEL_INFO[model_type]
    model_input_size = info["input_size"]
    model_url = info["url"]

    print(
        f"Loading MoveNet {model_type.capitalize()} model (expects {model_input_size}x{model_input_size} input)..."
    )

    # Don't hide CPU devices - this causes errors
    # Instead, configure TensorFlow to prefer GPU but still allow CPU operations
    try:
        # Set GPU as preferred device but keep CPU available
        physical_devices = tf.config.list_physical_devices()
        tf.config.experimental.set_memory_growth(
            tf.config.list_physical_devices("GPU")[0], True
        )
        print("GPU memory growth enabled")
    except (IndexError, ValueError) as e:
        print(f"GPU configuration warning: {e} - continuing with default config")

    print(f"Attempting to load model from URL: {model_url}")
    model = hub.load(model_url)
    print("hub.load(model_url) call completed.")
    print("Attempting to get model signature...")
    movenet = model.signatures["serving_default"]
    print("Model signature retrieved. Model loaded.")

    # Run a warmup inference to compile any XLA operations
    warmup_image = tf.zeros([1, model_input_size, model_input_size, 3], dtype=tf.int32)
    warmup_result = movenet(input=warmup_image)
    print("Model warmed up with test inference.")


def detect_pose(frame, confidence_threshold=0.3):
    """Detect pose keypoints in the frame.

    Args:
        frame: Input image frame (numpy array with shape [height, width, 3])
        confidence_threshold: Minimum confidence score for keypoints

    Returns:
        List of detected person keypoints or None if no detection
    """
    try:
        # Validate input frame
        if frame is None or not isinstance(frame, np.ndarray):
            print("Invalid frame input to detect_pose")
            return None

        h_proc, w_proc, channels = frame.shape

        if h_proc <= 0 or w_proc <= 0 or channels != 3:
            print(f"Invalid frame dimensions: {frame.shape}")
            return None

        if model_input_size is None:
            raise RuntimeError("Model not loaded or input size not set.")

        # Optimized preprocessing approach - vectorized
        # 1. Calculate scale to maintain aspect ratio
        scale = min(model_input_size / h_proc, model_input_size / w_proc)
        new_h = int(h_proc * scale)
        new_w = int(w_proc * scale)

        # 2. Resize image using OpenCV with INTER_LINEAR for speed
        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        # 3. Prepare canvas (pre-allocated once)
        canvas = np.zeros((model_input_size, model_input_size, 3), dtype=np.uint8)

        # 4. Calculate padding
        pad_y = (model_input_size - new_h) // 2
        pad_x = (model_input_size - new_w) // 2

        # 5. Place resized image on canvas (more efficient than multiple operations)
        canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

        # 6. Convert directly to tensor in most efficient way
        input_tensor = tf.convert_to_tensor(canvas, dtype=tf.int32)
        input_tensor = tf.expand_dims(input_tensor, 0)  # Add batch dimension

        # Run inference
        outputs = movenet(input=input_tensor)
        output_data = outputs["output_0"].numpy()

        # Pre-allocate result arrays for detected persons
        detected_persons = []

        # Process single pose result
        if output_data.shape[1] == 1:  # Single pose model
            keypoints_with_scores = output_data[0, 0, :, :]  # Shape (17, 3)
            max_score = np.max(keypoints_with_scores[:, 2])
            if max_score > confidence_threshold:
                # Vectorized coordinate transformation - much faster
                # Convert all coordinates at once using NumPy operations
                y_coords = (
                    keypoints_with_scores[:, 0] * model_input_size
                )  # Normalized to pixels
                x_coords = keypoints_with_scores[:, 1] * model_input_size

                # Subtract padding and scale back (as matrix operations)
                y_coords = (y_coords - pad_y) / scale
                x_coords = (x_coords - pad_x) / scale

                # Clip all coordinates at once
                y_coords = np.clip(y_coords, 0, h_proc - 1)
                x_coords = np.clip(x_coords, 0, w_proc - 1)

                # Create final array in one operation
                person_data_final = np.column_stack(
                    (y_coords, x_coords, keypoints_with_scores[:, 2])
                )
                detected_persons.append(person_data_final.astype(np.float32))

        # Process multi pose result
        elif output_data.shape[1] > 1:  # Multi pose model
            # Process each person
            for i in range(output_data.shape[1]):
                person = output_data[0, i]
                keypoints_with_scores = person[:51].reshape((17, 3))
                bbox = person[51:]
                person_score = bbox[4] if len(bbox) > 4 else 0.0

                if person_score > confidence_threshold:
                    # Use vectorized operations for all keypoints at once
                    # Step 1: Get raw normalized coordinates and scores
                    y_norm = keypoints_with_scores[:, 0]
                    x_norm = keypoints_with_scores[:, 1]
                    scores = keypoints_with_scores[:, 2]

                    # Step 2: Denormalize to get pixel coordinates
                    y_px = y_norm * model_input_size
                    x_px = x_norm * model_input_size

                    # Step 3: Remove padding
                    y_unpadded = y_px - pad_y
                    x_unpadded = x_px - pad_x

                    # Step 4: Scale back to original frame
                    y_final = y_unpadded / scale
                    x_final = x_unpadded / scale

                    # Step 5: Clip to valid frame coordinates
                    y_final = np.clip(y_final, 0, h_proc - 1)
                    x_final = np.clip(x_final, 0, w_proc - 1)

                    # Create mask of valid scores
                    valid_scores = scores > confidence_threshold

                    # Create result array
                    person_data_final = np.zeros((17, 3), dtype=np.float32)
                    person_data_final[:, 2] = scores  # Always keep scores

                    # Only use valid coordinates for valid scores
                    person_data_final[valid_scores, 0] = y_final[valid_scores]
                    person_data_final[valid_scores, 1] = x_final[valid_scores]

                    detected_persons.append(person_data_final)

        return detected_persons

    except Exception as e:
        print(f"Error in detect_pose: {str(e)}")
        return None


def create_mask(
    frame,
    persons_keypoints,
    confidence_threshold,
    radius=30,
    dilation_iterations=10,
    blur_kernel_size=21,
):
    """Create a mask highlighting detected pose keypoints and skeletons."""
    # Pre-allocate mask with correct dimensions
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)

    if persons_keypoints is None:
        return mask

    # Calculate derived values once for performance
    joint_radius = max(1, int(radius * 0.8))
    line_thickness = joint_radius

    # Process all people at once
    for person_kps in persons_keypoints:
        # --- 1. Efficiently fill torso when possible ---
        shoulder_l = person_kps[KEYPOINT_DICT["left_shoulder"]]
        shoulder_r = person_kps[KEYPOINT_DICT["right_shoulder"]]
        hip_l = person_kps[KEYPOINT_DICT["left_hip"]]
        hip_r = person_kps[KEYPOINT_DICT["right_hip"]]

        # Check confidence of all torso keypoints
        torso_valid = (
            shoulder_l[2] > confidence_threshold
            and shoulder_r[2] > confidence_threshold
            and hip_l[2] > confidence_threshold
            and hip_r[2] > confidence_threshold
        )

        if torso_valid:
            # Define torso vertices directly as integers (avoiding repeated conversions)
            torso_pts = np.array(
                [
                    [int(shoulder_l[1]), int(shoulder_l[0])],
                    [int(shoulder_r[1]), int(shoulder_r[0])],
                    [int(hip_r[1]), int(hip_r[0])],
                    [int(hip_l[1]), int(hip_l[0])],
                ],
                dtype=np.int32,
            )
            cv2.fillPoly(mask, [torso_pts], 255)

        # --- 2. Batch skeleton line drawing for efficiency ---
        # Pre-calculate all point coordinates for skeleton lines
        all_points = {}  # Cache to avoid duplicate conversions

        for kp_idx1, kp_idx2 in SKELETON_LINES:
            kp1 = person_kps[kp_idx1]
            kp2 = person_kps[kp_idx2]

            if kp1[2] > confidence_threshold and kp2[2] > confidence_threshold:
                # Get or calculate point 1
                if kp_idx1 not in all_points:
                    all_points[kp_idx1] = (
                        int(kp1[1]),
                        int(kp1[0]),
                    )  # x,y format for OpenCV

                # Get or calculate point 2
                if kp_idx2 not in all_points:
                    all_points[kp_idx2] = (int(kp2[1]), int(kp2[0]))

                # Draw line using cached points
                cv2.line(
                    mask, all_points[kp_idx1], all_points[kp_idx2], 255, line_thickness
                )

        # --- 3. Optimize joint circles drawing ---
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

        # Draw joints from the cached point locations
        for idx in head_indices + limb_joint_indices:
            if idx in all_points and person_kps[idx][2] > confidence_threshold:
                cv2.circle(mask, all_points[idx], joint_radius, 255, -1)
            elif person_kps[idx][2] > confidence_threshold:
                # For points not already in the cache
                pt = (int(person_kps[idx][1]), int(person_kps[idx][0]))
                cv2.circle(mask, pt, joint_radius, 255, -1)

    # --- 4. Optimize post-processing ---
    # Apply dilation (can be computationally expensive)
    if dilation_iterations > 0:
        kernel = np.ones((3, 3), np.uint8)  # Pre-define kernel
        mask = cv2.dilate(mask, kernel, iterations=dilation_iterations)

    # Apply blur if needed (also expensive)
    if blur_kernel_size > 1:
        # Ensure blur kernel size is odd
        blur_kernel_size = (
            blur_kernel_size if blur_kernel_size % 2 != 0 else blur_kernel_size + 1
        )
        mask = cv2.GaussianBlur(mask, (blur_kernel_size, blur_kernel_size), 0)

    return mask


def apply_mask(frame, mask):
    """Apply mask to frame, creating a transparent image with white background.
    Optimized for speed using vectorized operations.
    """
    # For vectorized operations, make sure mask is float32 normalized to [0,1]
    mask_float = mask.astype(np.float32) / 255.0

    # Reshape mask to allow broadcasting with frame
    mask_3ch = mask_float[:, :, np.newaxis]

    # Vectorized operations (faster than separate calculations)
    # 1. Foreground = original * mask
    foreground = frame * mask_3ch

    # 2. Background = white * (1-mask)
    background = 255.0 * (1.0 - mask_3ch)

    # 3. Combined = foreground + background
    # This creates the white background effect
    result_rgb = np.clip(foreground + background, 0, 255).astype(np.uint8)

    # 4. Create BGRA output by adding mask as alpha channel
    return cv2.merge(
        [
            result_rgb[:, :, 0],  # B
            result_rgb[:, :, 1],  # G
            result_rgb[:, :, 2],  # R
            mask,  # A
        ]
    )


def process_frame(frame_data):
    """Process a single frame - optimized for performance"""
    try:
        frame, frame_idx, params = frame_data

        # Unpack parameters (only once)
        confidence_threshold = params["confidence_threshold"]
        radius = params["radius"]
        dilation_iterations = params["dilation_iterations"]
        blur_kernel_size = params["blur_kernel_size"]
        target_w = params["target_w"]
        target_h = params["target_h"]
        orig_w = params["orig_w"]

        # Check if frame is valid
        if frame is None or not isinstance(frame, np.ndarray):
            print(f"Skipping invalid frame {frame_idx}")
            # Return empty frame with correct dimensions
            result = np.zeros((target_h, target_w, 4), dtype=np.uint8)
            return (frame_idx, result)

        # Resize if needed (using faster interpolation method)
        if target_w != orig_w:
            # Use faster INTER_LINEAR interpolation
            frame_processed = cv2.resize(
                frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR
            )
        else:
            # No need to copy the frame if not resizing
            frame_processed = frame

        # Detect pose (most computationally intensive part)
        persons_keypoints = detect_pose(frame_processed, confidence_threshold)

        # Create mask based on detected poses
        if persons_keypoints is not None and len(persons_keypoints) > 0:
            mask = create_mask(
                frame_processed,
                persons_keypoints,
                confidence_threshold,
                radius,
                dilation_iterations,
                blur_kernel_size,
            )
        else:
            # Fast path for empty masks
            mask = np.zeros(frame_processed.shape[:2], dtype=np.uint8)

        # Apply mask to create BGRA result (optimized)
        result = apply_mask(frame_processed, mask)

        # No need for validation here since we're controlling the output format
        return (frame_idx, result)

    except Exception as e:
        print(
            f"Error processing frame {frame_data[1] if isinstance(frame_data, tuple) and len(frame_data) > 1 else 'unknown'}: {str(e)}"
        )
        # Create a blank frame with alpha=0
        blank = np.zeros((params["target_h"], params["target_w"], 4), dtype=np.uint8)
        return (
            (
                frame_data[1]
                if isinstance(frame_data, tuple) and len(frame_data) > 1
                else 0
            ),
            blank,
        )


def frame_reader(cap, params, max_queue_size=32):
    """Read frames from video and put them in the queue"""
    frame_idx = 0
    frame_read_count = 0

    print(f"Frame reader starting, max queue size: {max_queue_size}")

    while not processing_done.is_set():
        # Wait if queue is full
        if frame_queue.qsize() >= max_queue_size:
            time.sleep(0.01)  # Small sleep to avoid busy waiting
            continue

        # Read a frame
        ret, frame = cap.read()
        if not ret:
            print(f"Frame reader reached end of video after {frame_read_count} frames")
            # Signal end of frames but don't exit yet
            frame_queue.put(None)
            break

        # Put frame in queue with index
        try:
            frame_queue.put((frame, frame_idx, params), block=True, timeout=1.0)
            frame_idx += 1
            frame_read_count += 1

            # Print progress occasionally
            if frame_read_count % 50 == 0:
                print(
                    f"Read {frame_read_count} frames, queue size: {frame_queue.qsize()}"
                )

        except queue.Full:
            print(f"Warning: Frame queue full at frame {frame_idx}, waiting...")
            time.sleep(0.1)  # Wait a bit before trying again

    # Wait until processing is done before exiting
    print(f"Frame reader finished after reading {frame_read_count} frames")
    # Put a few extra None markers to ensure all worker threads get the signal
    for _ in range(5):  # Add multiple end markers for safety
        try:
            frame_queue.put(None, block=False)
        except queue.Full:
            pass

    print("Frame reader thread exiting")
    return frame_read_count


def process_video(
    input_path,
    output_path,
    radius,
    confidence_threshold,
    dilation_iterations,
    blur_kernel_size,
    processing_width,
    num_threads=None,
):
    # Configure optimal thread count
    if num_threads is None:
        # Use more threads for better parallelism
        num_threads = min(os.cpu_count() * 2, 16)  # More aggressive threading

    print(f"Starting processing with {num_threads} worker threads")

    # Reset the done event in case this function is called multiple times
    processing_done.clear()

    # Clear the queues if they have any leftover items
    while not frame_queue.empty():
        try:
            frame_queue.get_nowait()
        except queue.Empty:
            break

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(f"Error: Could not open input video file: {input_path}")
        return

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"Input video: {total_frames} frames, {fps} fps, {orig_w}x{orig_h}")

    # Determine processing dimensions
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

    # Prepare parameters dictionary for worker threads
    processing_params = {
        "confidence_threshold": confidence_threshold,
        "radius": radius,
        "dilation_iterations": dilation_iterations,
        "blur_kernel_size": blur_kernel_size,
        "target_w": target_w,
        "target_h": target_h,
        "orig_w": orig_w,
    }

    # Setup FFmpeg process with optimized settings
    output_filename = output_path
    if not output_filename.lower().endswith(".webm"):
        output_filename = os.path.splitext(output_path)[0] + ".webm"
        print(f"Output requires .webm for transparency. Saving to: {output_filename}")

    # Optimized FFmpeg settings for speed
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",  # Overwrite output file
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
        # VP9 settings optimized for speed over quality
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-deadline",
        "realtime",  # Fastest encoding
        "-cpu-used",
        "8",  # Maximum speed
        "-b:v",
        "1M",  # Lower bitrate for speed
        "-threads",
        str(num_threads),
        "-row-mt",
        "1",  # Use row-based multithreading
        "-tile-columns",
        "2",
        "-frame-parallel",
        "1",
        "-an",  # No audio
        output_filename,
    ]

    print(f"Starting FFmpeg process with optimized settings")
    try:
        ffmpeg_process = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
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

    # Increase queue capacity for better buffering
    reader_queue_size = min(64, total_frames // 2) if total_frames > 100 else 32
    print(f"Using frame queue size of {reader_queue_size}")

    # Start frame reader thread with increased queue capacity
    reader_thread = threading.Thread(
        target=frame_reader, args=(cap, processing_params, reader_queue_size)
    )
    reader_thread.daemon = True
    reader_thread.start()

    # Debug counters
    frames_processed = 0
    frames_read_from_queue = 0
    frames_written = 0
    last_reported_count = 0  # Track last status update

    # Start worker thread pool with optimized configuration
    results = {}  # Dictionary to store results keyed by frame index
    next_frame_to_write = 0

    # Use a larger thread pool for better CPU utilization
    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        # Pre-fill the queue to ensure workers are busy
        futures = {}

        # Process frames until there are no more
        with tqdm(total=total_frames, desc="Processing Frames", unit="frame") as pbar:
            end_of_frames = False
            timeout_counter = 0

            while not end_of_frames or futures or results:
                # 1. Get frames from the queue and submit to thread pool
                if (
                    not end_of_frames and len(futures) < num_threads * 2
                ):  # Keep pipeline full
                    try:
                        frame_data = frame_queue.get(timeout=0.1)
                        frames_read_from_queue += 1

                        if frame_data is None:  # End of frames signal
                            print(
                                f"Received end-of-frames marker after reading {frames_read_from_queue} frames"
                            )
                            end_of_frames = True
                        else:
                            # Process the frame in the thread pool
                            future = executor.submit(process_frame, frame_data)
                            frame, frame_idx, _ = frame_data
                            futures[future] = frame_idx
                            timeout_counter = 0  # Reset timeout counter

                    except queue.Empty:
                        # Timeout waiting for a frame - this is normal temporarily
                        timeout_counter += 1
                        if timeout_counter > 20:  # After longer period of no frames
                            print(
                                f"Warning: No frames received for {timeout_counter * 0.1} seconds"
                            )
                            if frames_read_from_queue >= total_frames:
                                # We've read all frames, mark as end
                                end_of_frames = True
                                print(
                                    "Reached expected frame count, marking end of frames"
                                )

                # 2. Check for completed tasks and collect results (batch processing)
                done_futures = [f for f in list(futures.keys()) if f.done()]
                for future in done_futures:
                    try:
                        frame_idx, result = future.result()
                        results[frame_idx] = result
                        frames_processed += 1
                    except Exception as e:
                        print(f"Error getting future result: {e}")
                        # Get the frame index from the futures dict
                        frame_idx = futures[future]
                        # Create a blank frame as fallback
                        blank_frame = np.zeros((target_h, target_w, 4), dtype=np.uint8)
                        results[frame_idx] = blank_frame
                    finally:
                        # Always remove the future from tracking
                        futures.pop(future)

                # 3. Write completed frames in order (batch writing when possible)
                frames_to_write = []
                while next_frame_to_write in results:
                    frames_to_write.append(
                        (next_frame_to_write, results.pop(next_frame_to_write))
                    )
                    next_frame_to_write += 1

                # Write all available frames at once
                if frames_to_write:
                    try:
                        for _, frame_result in frames_to_write:
                            # Minimal validation - assume process_frame produced correct output
                            if frame_result is None or frame_result.shape[:2] != (
                                target_h,
                                target_w,
                            ):
                                frame_result = np.zeros(
                                    (target_h, target_w, 4), dtype=np.uint8
                                )

                            # Write directly to FFmpeg
                            ffmpeg_process.stdin.write(frame_result.tobytes())
                            frames_written += 1
                            pbar.update(1)

                    except (BrokenPipeError, IOError) as e:
                        print(f"\n❌ Error writing frames to FFmpeg: {e}")
                        processing_done.set()
                        break

                # Provide progress updates periodically (not too often to avoid overhead)
                if (
                    frames_processed % 20 == 0
                    and frames_processed > 0
                    and frames_processed != last_reported_count
                ):
                    last_reported_count = frames_processed
                    # Log status every 20 frames
                    backlog = len(results)  # Frames waiting to be written
                    active = len(futures)  # Frames currently being processed
                    print(
                        f"Status: read={frames_read_from_queue}, processed={frames_processed}, written={frames_written}, waiting={backlog}, active={active}"
                    )

                # Sleep a tiny bit to avoid CPU spinning when idle
                if not done_futures and not next_frame_to_write in results:
                    time.sleep(0.001)  # Reduced sleep time for better responsiveness

    # Signal processing is done
    processing_done.set()

    # Wait for reader thread to finish
    if reader_thread.is_alive():
        print("Waiting for frame reader thread to complete...")
        reader_thread.join(timeout=5.0)

    # Finalize FFmpeg
    print(f"\nFinished processing {frames_written} frames. Closing FFmpeg stream...")
    if ffmpeg_process.stdin:
        ffmpeg_process.stdin.close()

    return_code = ffmpeg_process.wait()

    # Read any remaining stdout/stderr
    stdout, stderr = b"", b""
    if ffmpeg_process.stdout:
        stdout = ffmpeg_process.stdout.read()
    if ffmpeg_process.stderr:
        stderr = ffmpeg_process.stderr.read()

    if return_code == 0:
        print("\n✅ FFmpeg processing complete:", output_filename)
    else:
        print(f"\n❌ FFmpeg failed with return code: {return_code}")
        if stderr:
            print("--- FFmpeg stderr ---")
            print(stderr.decode(errors="ignore"))
            print("---------------------")

    # Display final stats
    cap.release()
    print("\n--- Final Processing Statistics ---")
    print(f"Total frames in video: {total_frames}")
    print(f"Frames read from video: {frames_read_from_queue}")
    print(f"Frames processed: {frames_processed}")
    print(f"Frames written to output: {frames_written}")
    print("---------------------------------")

    if frames_written == 0:
        print("⚠️ WARNING: No frames were written! Check the file for errors.")
    elif frames_written < total_frames:
        print(
            f"⚠️ WARNING: Only {frames_written} of {total_frames} frames were written."
        )
    else:
        print("✅ All frames processed successfully.")

    return frames_written


# --- Define Skeleton Structure ---
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

if __name__ == "__main__":
    # Configure TensorFlow for optimal performance
    # Print available devices
    print("TensorFlow Devices:")
    devices = tf.config.list_physical_devices()
    gpu_devices = tf.config.list_physical_devices("GPU")

    for device in devices:
        print(f"- {device.name} ({device.device_type})")

    # Configure GPU memory growth if available
    if gpu_devices:
        try:
            for gpu in gpu_devices:
                tf.config.experimental.set_memory_growth(gpu, True)
            print("✅ Metal GPU detected and memory growth enabled for TensorFlow!")
        except RuntimeError as e:
            print(f"❌ Error setting GPU memory growth: {e}")
            print("⚠️ Continuing with default configuration")
    else:
        print("❌ Metal GPU not detected by TensorFlow. Running on CPU.")

    # Use full precision
    tf.config.experimental.enable_tensor_float_32_execution(False)
    print("Using full precision (TF32 disabled)")
    print("---")

    parser = argparse.ArgumentParser(
        description="Process video to highlight pose keypoints."
    )
    parser.add_argument("input_path", help="Path to the input video file.")
    parser.add_argument("output_path", help="Path to save the output video file.")
    parser.add_argument(
        "--model_type",
        choices=list(MODEL_INFO.keys()),
        default="multipose_lightning",
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
    parser.add_argument(
        "--threads",
        type=int,
        default=None,
        help="Number of processing threads (defaults to CPU count minus 1)",
    )

    args = parser.parse_args()

    # Load the selected model
    load_model(args.model_type)

    # Process the video
    process_video(
        args.input_path,
        args.output_path,
        args.radius,
        args.confidence,
        args.dilate,
        args.blur,
        args.processing_width,
        args.threads,
    )
