# Skeletor-Py Plan

## Goal

To create a Python-based video processing tool that isolates human figures from their background in videos. This is achieved by using pose detection (skeletal tracking) to generate a mask around the detected person and applying this mask to the video frames. The output is a video where only the detected person is visible, potentially on a transparent background (depending on output format capabilities).

This module serves as a Python alternative to the Node.js `skeletor` module, specifically designed to leverage TensorFlow's Metal backend for optimized performance on Apple Silicon Macs.

## Core Technologies

*   **Python:** The primary programming language.
*   **OpenCV (`cv2`):** Used for video reading, writing, frame manipulation (resizing, splitting/merging channels), image processing (dilation, blurring), and drawing (circles).
*   **TensorFlow (`tf`):** The machine learning framework used for running the pose detection model.
*   **TensorFlow Hub (`tensorflow_hub`):** Used to easily load pre-trained models, specifically Google's MoveNet for pose estimation.
*   **NumPy (`np`):** For numerical operations, especially on image data and keypoints.
*   **Argparse:** For handling command-line arguments.
*   **tqdm:** For displaying progress bars during video processing.

## Workflow

1.  **Initialization:**
    *   Parse command-line arguments (`input_path`, `output_path`, `model_type`, `processing_width`, `radius`, `confidence`, `dilate`, `blur`).
    *   Check for TensorFlow device availability (especially Metal GPU).
    *   Load the specified MoveNet model (`lightning` or `thunder`) from TensorFlow Hub using the `load_model` function. Store the model signature and expected input size globally.

2.  **Video Input:**
    *   Open the input video file using `cv2.VideoCapture`.
    *   Retrieve video properties: frame count, FPS, original width, and height.

3.  **Output Setup:**
    *   Determine the processing resolution (`target_w`, `target_h`). If `processing_width` is specified and valid, calculate the corresponding height while maintaining aspect ratio. Otherwise, use the original dimensions.
    *   Initialize `cv2.VideoWriter` for the output file *only after the first frame is processed* to ensure the correct dimensions (`target_w`, `target_h`) are used. Currently uses 'mp4v' codec, which might not support transparency. (Future improvement: investigate codecs like VP9 in a `.webm` container for alpha channel support).

4.  **Frame-by-Frame Processing Loop (using `tqdm` for progress):**
    *   Read a frame from the input video (`cap.read()`).
    *   **Preprocessing:** If `processing_width` was used, resize the current frame to `(target_w, target_h)` before pose detection.
    *   **Pose Detection (`detect_pose`):**
        *   Resize and pad the (potentially downscaled) frame to the model's expected input size (`model_input_size`).
        *   Convert the image tensor to `int32`.
        *   Run inference using the loaded MoveNet model (`movenet(input=input_image)`).
        *   Extract keypoints and filter them based on the `confidence_threshold`.
        *   Convert normalized keypoints (y, x) to pixel coordinates (`keypoints_px`) relative to the dimensions of the frame *passed into `detect_pose`*.
    *   **Mask Creation (`create_mask`):**
        *   If keypoints were detected:
            *   Create a blank mask (single channel, uint8) with the same dimensions as the frame passed into `detect_pose`.
            *   Draw filled circles on the mask at each `keypoints_px` location using the specified `radius`.
            *   Dilate the mask to expand the masked area using `dilation_iterations`.
            *   Apply Gaussian blur to soften the mask edges using `blur_kernel_size`.
        *   If no keypoints were detected, create an empty (all black) mask.
    *   **Mask Application (`apply_mask`):**
        *   Split the BGR channels of the frame processed in this iteration.
        *   Use the generated mask as the alpha channel.
        *   Merge the B, G, R, and alpha channels into a BGRA image.
    *   **Output Writing:**
        *   Ensure the `VideoWriter` (`out`) is initialized (if this is the first frame).
        *   Convert the resulting BGRA frame back to BGR (since 'mp4v' likely doesn't support alpha) before writing. (Note: This currently discards the transparency).
        *   Write the processed frame to the output video file (`out.write()`).

5.  **Cleanup:**
    *   Release the video capture (`cap.release()`) and video writer (`out.release()`) resources.
    *   Print a completion message.

## Command-Line Interface

The script uses `argparse` to accept configuration options:

*   `input_path`: Path to the source video.
*   `output_path`: Path to save the processed video.
*   `--model_type`: `lightning` (faster) or `thunder` (more accurate). Default: `thunder`.
*   `--processing_width`: Optional width to resize video for faster processing.
*   `--radius`: Radius of circles drawn around keypoints for the mask. Default: 30.
*   `--confidence`: Minimum keypoint detection confidence. Default: 0.3.
*   `--dilate`: Mask dilation iterations. Default: 10.
*   `--blur`: Mask Gaussian blur kernel size. Default: 21.

## Potential Future Improvements

*   **Alpha Channel Support:** Modify the output stage to use a container format (e.g., WebM with VP9 codec) that supports an alpha channel, preserving the transparency created by the mask.
*   **Refined Masking:** Explore more sophisticated masking techniques beyond simple circles, dilation, and blur (e.g., using skeletal connections, polygon filling).
*   **Multi-Person Support:** Adapt the logic to handle videos with multiple people (MoveNet has multi-pose variants, but the masking logic would need significant changes).
*   **Error Handling:** Add more robust error handling for file I/O and processing issues.
*   **Configuration File:** Allow parameters to be specified via a configuration file instead of only command-line arguments.
*   **Memory Optimization:** Investigate if further memory optimizations are possible, especially for very long or high-resolution videos. 