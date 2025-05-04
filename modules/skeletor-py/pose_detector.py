"""Handles pose detection using the MoveNet model."""

import numpy as np
import tensorflow as tf
import cv2


def detect_pose(frame, movenet_signature, model_input_size, confidence_threshold=0.3):
    """Detect pose keypoints in the frame.

    Args:
        frame: Input image frame (numpy array with shape [height, width, 3])
        movenet_signature: Loaded MoveNet model signature.
        model_input_size: Expected input size of the model.
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
            raise RuntimeError("Model input size not set.")
        if movenet_signature is None:
            raise RuntimeError("MoveNet model signature not provided.")

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
        outputs = movenet_signature(input=input_tensor)
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
        import traceback

        traceback.print_exc()  # Print stack trace for debugging
        return None
