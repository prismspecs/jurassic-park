"""Handles mask creation and application."""

import numpy as np
import cv2
from config import KEYPOINT_DICT, SKELETON_LINES  # Import constants


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
