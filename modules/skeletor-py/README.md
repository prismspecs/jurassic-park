# Skeletor-Py

This script uses the MoveNet pose detection model (via TensorFlow Hub) to identify human keypoints in a video and generates a new video where only the areas around these keypoints are visible, effectively creating a 'skeleton' effect against a transparent background.

## Setup

**Create and activate a Python virtual environment:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```
    *(Use `python` instead of `python3` if needed for your system)*

**Install the required dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

## Usage

Run the script from the command line, providing the input video path and the desired output video path. You can also customize the processing using optional arguments.

```bash
python main.py <input_video_path> <output_video_path> [options]
```

**Example:**

```bash
python main.py videos/input.mp4 output/processed_video.mp4 --radius 25 --confidence 0.4
```

### Command-Line Arguments

*   `input_path` (Required): Path to the input video file.
*   `output_path` (Required): Path where the processed output video file will be saved.
*   `--radius` (Optional): Radius of the circle drawn around keypoints. Default: `30`.
*   `--confidence` (Optional): Minimum confidence threshold for detecting keypoints (0.0 to 1.0). Default: `0.3`.
*   `--dilate` (Optional): Number of dilation iterations applied to the mask. Default: `10`.
*   `--blur` (Optional): Gaussian blur kernel size applied to the mask (must be an odd number). Default: `21`.

## Deactivation

When you are finished, deactivate the virtual environment:

```bash
deactivate
```
