from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path


MODEL_PATH = Path(__file__).resolve().parent / "models" / "hey_nova.onnx"
SAMPLE_RATE = 16_000
FRAME_SAMPLES = 1_280


class WakeModelUnavailable(RuntimeError):
    pass


def verify_model(model_path: Path = MODEL_PATH) -> None:
    if not model_path.is_file():
        raise WakeModelUnavailable(
            f"No trained Hey NOVA model is installed at {model_path}. "
            "Wake listening has not started."
        )


def listen(
    stop_event: threading.Event,
    on_started: Callable[[], None],
    on_detected: Callable[[], None],
    model_path: Path = MODEL_PATH,
    threshold: float = 0.65,
) -> None:
    if stop_event.is_set():
        return
    verify_model(model_path)
    try:
        import numpy as np
        import sounddevice as sd
        from openwakeword.model import Model
    except ImportError as error:
        raise RuntimeError(
            "Wake listening dependencies are missing. Install the project requirements."
        ) from error

    detector = Model(
        wakeword_models=[str(model_path)],
        inference_framework="onnx",
    )
    if stop_event.is_set():
        return
    model_key = model_path.stem
    activated = False
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
            scores = detector.predict(np.asarray(audio).reshape(-1))
            confidence = scores.get(model_key)
            if confidence is not None and float(confidence) >= threshold:
                if not activated:
                    activated = True
                    on_detected()
                return
