
from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path

import numpy as np
import sounddevice as sd
import onnxruntime as ort

from openwakeword.utils import AudioFeatures


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "hey_nova_candidate.onnx"

RESOURCE_DIR = (
    Path(__import__("openwakeword").__file__).resolve().parent
    / "resources"
    / "models"
)

MELSPEC_PATH = RESOURCE_DIR / "melspectrogram.onnx"
EMBEDDING_PATH = RESOURCE_DIR / "embedding_model.onnx"

SAMPLE_RATE = 16_000
FRAME_SAMPLES = 1_280
THRESHOLD = 0.75


class WakeModelUnavailable(RuntimeError):
    pass


def verify_model(model_path: Path = MODEL_PATH) -> None:
    required = [
        model_path,
        MELSPEC_PATH,
        EMBEDDING_PATH,
    ]

    missing = [str(path) for path in required if not path.is_file()]

    if missing:
        raise WakeModelUnavailable(
            "Missing wake-word resources:\n" + "\n".join(missing)
        )


def listen(
    stop_event: threading.Event,
    on_started: Callable[[], None],
    on_detected: Callable[[], None],
    model_path: Path = MODEL_PATH,
    threshold: float = THRESHOLD,
) -> None:

    if stop_event.is_set():
        return

    verify_model(model_path)

    feature_extractor = AudioFeatures(
        melspec_model_path=str(MELSPEC_PATH),
        embedding_model_path=str(EMBEDDING_PATH),
        sr=SAMPLE_RATE,
        inference_framework="onnx",
    )

    session = ort.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
    )

    input_name = session.get_inputs()[0].name

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
        blocksize=FRAME_SAMPLES,
    ) as microphone:

        on_started()

        while not stop_event.is_set():

            audio, overflowed = microphone.read(FRAME_SAMPLES)

            if overflowed:
                continue

            audio = np.asarray(audio).reshape(-1)

            # Convert microphone PCM into float audio.
            audio_float = audio.astype(np.float32) / 32768.0

            # Update the persistent feature extractor.
            feature_extractor(audio_float)

            # Obtain the latest 16 embedding frames.
            features = feature_extractor.get_features(
                n_feature_frames=16
            )

            features = np.asarray(features, dtype=np.float32)

            if features.shape != (1, 16, 96):
                continue

            output = session.run(
                None,
                {input_name: features},
            )

            score = float(np.asarray(output[0]).reshape(-1)[0])
            print(f"Wake score: {score:.4f}", flush=True)

            if score >= threshold:
                on_detected()
                return
