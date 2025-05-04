"""Configuration settings for the pose estimation project."""

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
