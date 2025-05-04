"""Handles video reading, frame processing orchestration, and output writing."""

import cv2
import numpy as np
import os
import subprocess
import threading
import queue
import time
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm

# Import functions from other modules
from pose_detector import detect_pose
from masking import create_mask, apply_mask


# --- Frame Processing Function ---
def process_frame(frame_data, movenet_signature, model_input_size):
    """Process a single frame: resize, detect pose, create mask, apply mask."""
    try:
        frame, frame_idx, params = frame_data

        # Unpack parameters
        confidence_threshold = params["confidence_threshold"]
        radius = params["radius"]
        dilation_iterations = params["dilation_iterations"]
        blur_kernel_size = params["blur_kernel_size"]
        target_w = params["target_w"]
        target_h = params["target_h"]
        orig_w = params["orig_w"]

        if frame is None or not isinstance(frame, np.ndarray):
            print(f"Skipping invalid frame {frame_idx}")
            result = np.zeros((target_h, target_w, 4), dtype=np.uint8)
            return (frame_idx, result)

        # Resize if needed
        if target_w != orig_w:
            frame_processed = cv2.resize(
                frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR
            )
        else:
            frame_processed = frame

        # Detect pose
        persons_keypoints = detect_pose(
            frame_processed, movenet_signature, model_input_size, confidence_threshold
        )

        # Create mask
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
            mask = np.zeros(frame_processed.shape[:2], dtype=np.uint8)

        # Apply mask
        result = apply_mask(frame_processed, mask)

        return (frame_idx, result)

    except Exception as e:
        print(
            f"Error processing frame {frame_data[1] if isinstance(frame_data, tuple) and len(frame_data) > 1 else 'unknown'}: {str(e)}"
        )
        import traceback

        traceback.print_exc()
        blank = np.zeros((params["target_h"], params["target_w"], 4), dtype=np.uint8)
        return (
            (
                frame_data[1]
                if isinstance(frame_data, tuple) and len(frame_data) > 1
                else 0
            ),
            blank,
        )


# --- Frame Reader Thread Target ---
def frame_reader(cap, params, frame_queue, processing_done, max_queue_size=32):
    """Read frames from video capture and put them into the queue."""
    frame_idx = 0
    frame_read_count = 0
    print(f"Frame reader starting, max queue size: {max_queue_size}")

    while not processing_done.is_set():
        if frame_queue.qsize() >= max_queue_size:
            time.sleep(0.01)
            continue

        ret, frame = cap.read()
        if not ret:
            print(f"Frame reader reached end of video after {frame_read_count} frames")
            frame_queue.put(None)  # Signal end of frames
            break

        try:
            frame_queue.put((frame, frame_idx, params), block=True, timeout=1.0)
            frame_idx += 1
            frame_read_count += 1
            if frame_read_count % 100 == 0:
                print(
                    f"Read {frame_read_count} frames, queue size: {frame_queue.qsize()}"
                )
        except queue.Full:
            print(f"Warning: Frame queue full at frame {frame_idx}, waiting...")
            time.sleep(0.1)

    print(f"Frame reader finished after reading {frame_read_count} frames")
    # Ensure workers get the None signal
    for _ in range(max(5, params.get("num_threads", os.cpu_count()) * 2)):
        try:
            frame_queue.put(None, block=False)
        except queue.Full:
            pass
    print("Frame reader thread exiting")
    return frame_read_count


# --- Main Video Processing Orchestration ---
def process_video(
    input_path,
    output_path,
    movenet_signature,  # Pass model signature
    model_input_size,  # Pass model input size
    radius,
    confidence_threshold,
    dilation_iterations,
    blur_kernel_size,
    processing_width,
    num_threads=None,
):
    """Orchestrates video processing using multiple threads."""

    if num_threads is None:
        num_threads = max(1, os.cpu_count() - 1)  # Default threads
    print(f"Starting processing with {num_threads} worker threads")

    # Threading and queue setup (internal to this function)
    frame_queue = queue.Queue(maxsize=num_threads * 4)  # Input queue
    processing_done = threading.Event()

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Error: Could not open input video file: {input_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if total_frames <= 0 or fps <= 0:
        cap.release()
        raise ValueError(
            f"Invalid video properties for {input_path}: Frames={total_frames}, FPS={fps}"
        )

    print(f"Input video: {total_frames} frames, {fps:.2f} fps, {orig_w}x{orig_h}")

    # Determine processing dimensions
    target_w, target_h = orig_w, orig_h
    if (
        processing_width is not None
        and processing_width > 0
        and processing_width < orig_w
    ):
        print(f"Resizing frames for processing to width: {processing_width}")
        target_w = processing_width
        aspect_ratio = orig_h / orig_w
        target_h = int(target_w * aspect_ratio)
        # Ensure even height for some codecs
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
        "num_threads": num_threads,  # Pass num_threads for reader exit logic
    }

    # Setup FFmpeg process
    output_filename = output_path
    if not output_filename.lower().endswith(".webm"):
        output_filename = os.path.splitext(output_path)[0] + ".webm"
        print(f"Output requires .webm for transparency. Saving to: {output_filename}")

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        f"{target_w}x{target_h}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",  # VP9 with alpha
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",  # Faster encoding
        "-b:v",
        "1M",
        "-threads",
        str(num_threads),
        "-row-mt",
        "1",
        "-an",
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
    except FileNotFoundError:
        cap.release()
        raise RuntimeError(
            "\n❌ Error: ffmpeg command not found. Please ensure ffmpeg is installed and in your system's PATH."
        )
    except Exception as e:
        cap.release()
        raise RuntimeError(f"\n❌ Failed to start ffmpeg process: {e}")

    # Start frame reader thread
    reader_thread = threading.Thread(
        target=frame_reader,
        args=(
            cap,
            processing_params,
            frame_queue,
            processing_done,
            frame_queue.maxsize,
        ),
        daemon=True,
    )
    reader_thread.start()

    # --- Processing Loop ---
    frames_processed = 0
    frames_read_from_queue = 0
    frames_written = 0
    results = {}  # Store results {frame_idx: processed_frame}
    next_frame_to_write = 0

    # Corrected with statement syntax
    with ThreadPoolExecutor(max_workers=num_threads) as executor, tqdm(
        total=total_frames, desc="Processing Frames", unit="frame"
    ) as pbar:

        futures = {}  # {future: frame_idx}
        end_of_frames_signal_received = False

        while not end_of_frames_signal_received or futures or results:

            # 1. Submit tasks from queue if not end signal received
            if not end_of_frames_signal_received and len(futures) < num_threads * 2:
                try:
                    frame_data = frame_queue.get(timeout=0.1)  # Short timeout
                    if frame_data is None:
                        print("\nReceived end-of-frames marker from reader.")
                        end_of_frames_signal_received = True
                    else:
                        frames_read_from_queue += 1
                        frame, frame_idx, _ = frame_data
                        future = executor.submit(
                            process_frame,
                            frame_data,
                            movenet_signature,
                            model_input_size,
                        )
                        futures[future] = frame_idx
                except queue.Empty:
                    # If queue is empty and reader is done, mark end
                    if not reader_thread.is_alive() and frame_queue.empty():
                        if not end_of_frames_signal_received:
                            print(
                                "\nReader thread finished and queue empty, marking end of frames."
                            )
                            end_of_frames_signal_received = True
                    pass  # Normal if queue is temporarily empty

            # 2. Collect completed results
            done_futures = [f for f in list(futures.keys()) if f.done()]
            for future in done_futures:
                frame_idx = futures.pop(future)
                try:
                    _, result_frame = future.result()
                    results[frame_idx] = result_frame
                    frames_processed += 1
                except Exception as e:
                    print(f"\nError processing frame {frame_idx}: {e}")
                    # Provide a blank frame on error
                    results[frame_idx] = np.zeros(
                        (target_h, target_w, 4), dtype=np.uint8
                    )
                    frames_processed += 1  # Count error frame as processed

            # 3. Write completed frames in order
            frames_written_this_batch = 0
            while next_frame_to_write in results:
                frame_to_write = results.pop(next_frame_to_write)
                try:
                    if frame_to_write is not None and frame_to_write.shape == (
                        target_h,
                        target_w,
                        4,
                    ):
                        ffmpeg_process.stdin.write(frame_to_write.tobytes())
                        frames_written += 1
                        frames_written_this_batch += 1
                    else:
                        print(
                            f"\nSkipping write for invalid frame {next_frame_to_write}"
                        )
                        # Write blank frame instead?
                        # blank = np.zeros((target_h, target_w, 4), dtype=np.uint8)
                        # ffmpeg_process.stdin.write(blank.tobytes())
                        # frames_written += 1
                        # frames_written_this_batch += 1

                except (BrokenPipeError, IOError) as e:
                    print(
                        f"\n❌ Error writing frame {next_frame_to_write} to FFmpeg: {e}"
                    )
                    processing_done.set()  # Signal threads to stop
                    # Drain queues and futures to prevent hangs
                    while not frame_queue.empty():
                        frame_queue.get()
                    for f in futures:
                        f.cancel()
                    futures.clear()
                    results.clear()
                    break  # Exit main loop
                next_frame_to_write += 1

            if frames_written_this_batch > 0:
                pbar.update(frames_written_this_batch)

            # Break condition if ffmpeg pipe broke
            if processing_done.is_set():
                print("\nProcessing aborted due to write error.")
                break

            # Small sleep if nothing happened to prevent busy-waiting
            if (
                not done_futures
                and not frames_written_this_batch
                and not (next_frame_to_write in results)
            ):
                if end_of_frames_signal_received and not futures and not results:
                    break  # Exit if truly finished
                time.sleep(0.005)

    # --- Cleanup ---
    print(
        f"\nProcessing loop finished. Processed: {frames_processed}, Written: {frames_written}"
    )
    processing_done.set()  # Ensure reader thread exits if still running

    if reader_thread.is_alive():
        print("Waiting for frame reader thread to join...")
        reader_thread.join(timeout=5.0)
        if reader_thread.is_alive():
            print("Warning: Frame reader thread did not exit cleanly.")

    # Removed explicit closing of stdin, as communicate() handles it.
    # print("Closing FFmpeg stdin...")
    # if ffmpeg_process.stdin:
    #     try:
    #         ffmpeg_process.stdin.close()
    #     except Exception as e:
    #         print(f"Error closing ffmpeg stdin: {e}")

    print("Waiting for FFmpeg process to finish...")
    stdout, stderr = b"", b""
    try:
        # communicate() closes stdin, reads stdout/stderr, and waits for process.
        stdout, stderr = ffmpeg_process.communicate(timeout=30)
        return_code = ffmpeg_process.returncode
    except subprocess.TimeoutExpired:
        print("\n❌ FFmpeg process timed out. Killing process.")
        ffmpeg_process.kill()
        stdout, stderr = ffmpeg_process.communicate()  # Get output after kill
        return_code = -1  # Indicate timeout
    except Exception as e:
        # Catch potential errors during communication (like the flush error)
        print(f"\nError communicating with FFmpeg: {e}")
        try:
            # Try to get the return code even if communication failed partially
            return_code = ffmpeg_process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            print("FFmpeg process did not terminate after communication error.")
            return_code = -1
        except Exception:
            print("Could not retrieve FFmpeg return code after communication error.")
            return_code = -1

    cap.release()
    print("\n--- Final Processing Statistics ---")
    print(f"Total frames in video: {total_frames}")
    print(f"Frames read from video: {frames_read_from_queue}")
    print(f"Frames processed by workers: {frames_processed}")
    print(f"Frames written to output: {frames_written}")
    print(f"FFmpeg return code: {return_code}")
    print("---------------------------------")

    if return_code != 0:
        print("\n❌ FFmpeg failed.")
        if stderr:
            print("--- FFmpeg stderr ---")
            try:
                print(stderr.decode(errors="ignore"))
            except Exception as e:
                print(f"Could not decode stderr: {e}")
                print(stderr)
            print("---------------------")
        if stdout:
            print("--- FFmpeg stdout ---")
            try:
                print(stdout.decode(errors="ignore"))
            except Exception as e:
                print(f"Could not decode stdout: {e}")
                print(stdout)
            print("---------------------")
        # Consider raising an exception here if failure is critical
        # raise RuntimeError(f"FFmpeg failed with code {return_code}")

    elif frames_written == 0 and total_frames > 0:
        print("⚠️ WARNING: No frames were written! Check logs for errors.")
    elif frames_written < total_frames:
        print(
            f"⚠️ WARNING: Only {frames_written} of {total_frames} frames were written."
        )
    else:
        print(f"✅ FFmpeg processing successful. Output saved to: {output_filename}")

    return frames_written
