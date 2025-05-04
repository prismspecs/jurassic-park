# Skeletor-Py

This script uses the MoveNet pose detection model (via TensorFlow Hub) to identify human keypoints in a video and generates a new `.webm` video where only the areas around these keypoints (including torso and limbs) are visible against a transparent background.

It uses multi-threading for faster processing and relies on **FFmpeg** for encoding the final video.

## Setup

**1. Install FFmpeg:**
   - **macOS (using Homebrew):** `brew install ffmpeg`
   - **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install ffmpeg`
   - **Windows:** Download from the [official FFmpeg website](https://ffmpeg.org/download.html) and add it to your system's PATH.

**2. Create and activate a Python virtual environment:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```
    *(Use `python` instead of `python3` if needed for your system. On Windows, use `venv\Scripts\activate`)*

**3. Install the required Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

## Usage

Run the script from the command line, providing the input video path and the desired output video path (should end in `.webm`). You can also customize the processing using optional arguments.

```bash
python main.py <input_video_path> <output_video_path.webm> [options]
```

**Example:**

```bash
python main.py videos/input.mp4 output/processed_video.webm --model_type multipose_lightning --processing_width 1280 --confidence 0.4 --threads 4
```

### Command-Line Arguments

*   `input_path` (Required): Path to the input video file.
*   `output_path` (Required): Path where the processed output `.webm` video file will be saved.
*   `--model_type` (Optional): MoveNet model type (`lightning`/`thunder` for single pose, `multipose_lightning` for multiple). Default: `multipose_lightning`.
*   `--processing_width` (Optional): Resize video to this width for processing (e.g., 1280, 640). Processes at original resolution if omitted. Default: `None`.
*   `--radius` (Optional): Base radius for drawing joints and lines in the mask. Default: `30`.
*   `--confidence` (Optional): Minimum confidence threshold for detecting keypoints (0.0 to 1.0). Default: `0.3`.
*   `--dilate` (Optional): Number of dilation iterations applied to the mask. Default: `10`.
*   `--blur` (Optional): Gaussian blur kernel size applied to the mask (must be an odd number). Default: `21`.
*   `--threads` (Optional): Number of worker threads for parallel frame processing. Defaults to CPU count - 1. Default: `None`.

## Deactivation

When you are finished, deactivate the virtual environment:

```bash
deactivate
```
