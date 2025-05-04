# Skeletor-Py Plan

## Goal

To create a Python-based video processing tool that isolates human figures from their background in videos. This is achieved by using pose detection (skeletal tracking) to generate a mask around the detected person(s) and applying this mask to the video frames. The output is a `.webm` video where only the detected person(s) are visible against a transparent background.

This module serves as a Python alternative to the Node.js `skeletor` module, specifically designed to leverage TensorFlow's Metal backend for optimized performance on Apple Silicon Macs, and utilizes multi-threading for improved processing speed.

## Core Technologies

*   **Python:** The primary programming language.
*   **OpenCV (`cv2`):** Used for video reading, frame manipulation (resizing), image processing (dilation, blurring), and drawing (lines, circles, polygons).
*   **TensorFlow (`tf`):** The machine learning framework used for running the pose detection model.
*   **TensorFlow Hub (`tensorflow_hub`):** Used to easily load pre-trained models, specifically Google's MoveNet for pose estimation.
*   **NumPy (`np`):** For numerical operations, especially on image data and keypoints.
*   **Argparse:** For handling command-line arguments.
*   **tqdm:** For displaying progress bars during video processing.
*   **Subprocess:** For running the external FFmpeg process for video encoding.
*   **Threading, Queue, Concurrent.futures:** For managing multi-threaded frame processing.
*   **FFmpeg:** External command-line tool required for encoding the output `.webm` video with transparency.

## Project Structure

*   `main.py`: Entry point, argument parsing, orchestrates model loading and video processing.
*   `config.py`: Stores constants like model URLs, input sizes, keypoint definitions (`KEYPOINT_DICT`), and skeleton connections (`SKELETON_LINES`).
*   `model_loader.py`: Handles loading the specified MoveNet model from TensorFlow Hub and performing GPU configuration/warmup.
*   `pose_detector.py`: Contains the `detect_pose` function for running inference on a frame and extracting keypoints.
*   `masking.py`: Contains `create_mask` (draws skeleton/joints/torso on a mask) and `apply_mask` (combines frame with mask for transparency).
*   `video_processor.py`: Manages the multi-threaded video processing pipeline, including frame reading, worker threads, frame ordering, and interaction with FFmpeg.
*   `requirements.txt`: Lists Python dependencies.
*   `README.md`: Usage instructions.
*   `plan.md`: This file.

## Workflow

1.  **Initialization (`main.py`):**
    *   Parse command-line arguments (`input_path`, `output_path`, `model_type`, `processing_width`, `radius`, `confidence`, `dilate`, `blur`, `threads`).
    *   Configure TensorFlow logging and check device availability.
    *   Call `load_model` (`model_loader.py`) to get the specified MoveNet model signature and expected input size.

2.  **Video Processing Setup (`video_processor.py`):**
    *   The `process_video` function is called from `main.py`.
    *   Open the input video file using `cv2.VideoCapture`.
    *   Retrieve video properties: frame count, FPS, original width, and height.
    *   Determine the processing resolution (`target_w`, `target_h`) based on `processing_width` argument.
    *   Prepare parameters dictionary for worker threads.
    *   Set up and start the FFmpeg process using `subprocess.Popen`, configured to receive raw BGRA frames via stdin and output a VP9 encoded `.webm` file.
    *   Initialize threading components: `frame_queue` (for frames read from video), `processing_done` event.
    *   Start the `frame_reader` thread.

3.  **Multi-threaded Frame Processing (`video_processor.py`):**
    *   **Frame Reading (`frame_reader` thread):**
        *   Continuously reads frames from `cv2.VideoCapture`.
        *   Puts `(frame, frame_idx, params)` tuples into the `frame_queue`.
        *   Sends a `None` signal upon reaching the end of the video.
    *   **Worker Pool (`ThreadPoolExecutor`):**
        *   Main thread pulls frame data from `frame_queue`.
        *   Submits `process_frame` tasks to the executor pool for each frame.
        *   Stores `Future` objects returned by the executor.
    *   **Frame Processing (`process_frame` worker function):**
        *   Receives `(frame, frame_idx, params)`, model signature, and input size.
        *   Resizes frame if necessary.
        *   Calls `detect_pose` (`pose_detector.py`) to get keypoints for detected person(s).
        *   Calls `create_mask` (`masking.py`) to generate a mask based on keypoints.
        *   Calls `apply_mask` (`masking.py`) to create the final BGRA frame with transparency.
        *   Returns `(frame_idx, processed_bgra_frame)`.
    *   **Result Collection & Ordering:**
        *   Main thread checks for completed `Future` objects.
        *   Stores the processed BGRA frames in a `results` dictionary, keyed by `frame_idx`.
    *   **Output Writing:**
        *   Main thread iterates from `next_frame_to_write = 0` upwards.
        *   If `results[next_frame_to_write]` exists, it retrieves the frame, removes it from `results`, and writes its byte data to the `ffmpeg_process.stdin` pipe.
        *   Updates the `tqdm` progress bar.

4.  **Cleanup (`video_processor.py` & `main.py`):**
    *   Signal `processing_done` event.
    *   Wait for the `frame_reader` thread to join.
    *   Call `ffmpeg_process.communicate()` to close stdin, wait for FFmpeg to finish encoding, and capture any output/errors.
    *   Release the `cv2.VideoCapture` resource.
    *   Print final statistics and messages in `main.py`.

## Command-Line Interface

The script uses `argparse` to accept configuration options:

*   `input_path`: Path to the source video.
*   `output_path`: Path to save the processed `.webm` video.
*   `--model_type`: `lightning` (single pose, faster), `thunder` (single pose, more accurate), `multipose_lightning` (multiple poses). Default: `multipose_lightning`.
*   `--processing_width`: Optional width to resize video for potentially faster processing.
*   `--radius`: Base radius for drawing joints/lines in the mask. Default: 30.
*   `--confidence`: Minimum keypoint detection confidence. Default: 0.3.
*   `--dilate`: Mask dilation iterations. Default: 10.
*   `--blur`: Mask Gaussian blur kernel size. Default: 21.
*   `--threads`: Number of worker threads for parallel frame processing. Default: CPU count - 1.

## Potential Future Improvements

*   **Refined Masking:** Explore more sophisticated masking techniques (e.g., semantic segmentation if available, better polygon fitting around limbs).
*   **FFmpeg Parameter Tuning:** Allow more control over FFmpeg encoding settings (bitrate, quality, speed preset) via command-line arguments.
*   **Error Handling:** Add more specific error handling for FFmpeg execution issues or video reading problems.
*   **Configuration File:** Allow parameters to be specified via a configuration file (e.g., YAML, JSON).
*   **Memory Optimization:** Further investigate memory usage, especially queue sizes and frame buffering, for very long or high-resolution videos.
*   **Alternative Backends:** Explore if other TensorFlow backends or inference engines could offer benefits.