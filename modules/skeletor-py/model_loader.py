"""Handles loading the MoveNet model."""

import tensorflow as tf
import tensorflow_hub as hub
from config import MODEL_INFO


def load_model(model_type="thunder"):
    """Loads the specified MoveNet model.

    Args:
        model_type (str): The type of MoveNet model to load.

    Returns:
        tuple: (model_signature, model_input_size)
    """
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
        gpu_devices = tf.config.list_physical_devices("GPU")
        if gpu_devices:
            tf.config.experimental.set_memory_growth(gpu_devices[0], True)
            print("GPU memory growth enabled")
        else:
            print("No GPU detected, using CPU.")
    except (IndexError, ValueError, RuntimeError) as e:
        print(f"GPU configuration warning: {e} - continuing with default config")

    print(f"Attempting to load model from URL: {model_url}")
    model = hub.load(model_url)
    print("hub.load(model_url) call completed.")
    print("Attempting to get model signature...")
    movenet_signature = model.signatures["serving_default"]
    print("Model signature retrieved. Model loaded.")

    # Run a warmup inference to compile any XLA operations
    print("Warming up model...")
    warmup_image = tf.zeros([1, model_input_size, model_input_size, 3], dtype=tf.int32)
    _ = movenet_signature(input=warmup_image)
    print("Model warmed up with test inference.")

    return movenet_signature, model_input_size
