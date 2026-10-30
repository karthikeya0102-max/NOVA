from __future__ import annotations

import argparse
import csv
import wave
from collections import defaultdict
from pathlib import Path

import numpy as np
from openwakeword.model import Model


FRAME_SAMPLES = 1_280


def load_audio(path: Path) -> tuple[np.ndarray, float]:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != 16_000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"{path}: expected mono 16 kHz 16-bit PCM WAV.")
        duration = wav.getnframes() / wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
    if samples.size == 0:
        raise ValueError(f"{path}: WAV contains no audio samples.")
    return samples, duration


def evaluate(model: Model, model_key: str, samples: np.ndarray, threshold: float) -> bool:
    for offset in range(0, samples.size, FRAME_SAMPLES):
        frame = samples[offset:offset + FRAME_SAMPLES]
        if frame.size < FRAME_SAMPLES:
            frame = np.pad(frame, (0, FRAME_SAMPLES - frame.size))
        confidence = model.predict(frame).get(model_key, 0)
        if float(confidence) >= threshold:
            return True
    return False


def run(manifest: Path, model_path: Path, threshold: float) -> int:
    model = Model(wakeword_models=[str(model_path)], inference_framework="onnx")
    model_key = model_path.stem
    counts: dict[tuple[str, ...], dict[str, float]] = defaultdict(
        lambda: {"positive": 0, "positive_detected": 0, "negative": 0, "negative_detected": 0, "negative_seconds": 0}
    )
    with manifest.open(newline="", encoding="utf-8-sig") as file:
        rows = csv.DictReader(file)
        required = {"path", "label", "condition", "speaker", "distance", "noise"}
        if not rows.fieldnames or not required.issubset(rows.fieldnames):
            raise ValueError(f"Manifest must contain columns: {', '.join(sorted(required))}")
        processed = 0
        for row in rows:
            label = row["label"].strip().lower()
            if label not in {"positive", "negative"}:
                raise ValueError(f"Unsupported label {row['label']!r}; use positive or negative.")
            path = (manifest.parent / row["path"]).resolve()
            audio, duration = load_audio(path)
            detected = evaluate(model, model_key, audio, threshold)
            group_key = tuple(row[name].strip() or "unspecified" for name in (
                "condition", "speaker", "distance", "noise"
            ))
            group = counts[group_key]
            group[label] += 1
            if detected:
                group[f"{label}_detected"] += 1
            if label == "negative":
                group["negative_seconds"] += duration
            processed += 1
    if processed == 0:
        raise ValueError("The evaluation manifest contains no audio samples.")

    totals = {"positive": 0, "positive_detected": 0, "negative": 0, "negative_detected": 0, "negative_seconds": 0}
    for dimensions, group in sorted(counts.items()):
        for key in totals:
            totals[key] += group[key]
        false_rejects = int(group["positive"] - group["positive_detected"])
        false_accepts = int(group["negative_detected"])
        fnr = false_rejects / group["positive"] if group["positive"] else float("nan")
        fpr = false_accepts / group["negative"] if group["negative"] else float("nan")
        print(
            f"condition/speaker/distance/noise={'/'.join(dimensions)}: "
            f"positives={int(group['positive'])}, false_rejects={false_rejects}, "
            f"FNR={fnr:.1%}; negatives={int(group['negative'])}, false_accepts={false_accepts}, FPR={fpr:.1%}"
        )
    false_rejects = int(totals["positive"] - totals["positive_detected"])
    false_accepts = int(totals["negative_detected"])
    fnr = false_rejects / totals["positive"] if totals["positive"] else float("nan")
    fpr = false_accepts / totals["negative"] if totals["negative"] else float("nan")
    false_alarms_per_hour = (
        false_accepts / (totals["negative_seconds"] / 3600)
        if totals["negative_seconds"] else float("nan")
    )
    print(
        f"TOTAL: clips={processed}, false_rejects={false_rejects}, FNR={fnr:.1%}; "
        f"false_accepts={false_accepts}, FPR={fpr:.1%}, "
        f"false_alarms_per_negative_hour={false_alarms_per_hour:.2f}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure wake-model false rejects and false accepts on labeled WAVs.")
    parser.add_argument("--model", type=Path, default=Path("models/hey_nova.onnx"))
    parser.add_argument("--manifest", type=Path, required=True, help="CSV with path,label,condition,speaker,distance,noise columns")
    parser.add_argument("--threshold", type=float, default=0.65)
    args = parser.parse_args()
    if not 0 < args.threshold < 1:
        parser.error("--threshold must be between 0 and 1.")
    if not args.model.is_file():
        parser.error(f"Wake model not found: {args.model}")
    try:
        return run(args.manifest, args.model, args.threshold)
    except (OSError, ValueError, wave.Error) as error:
        parser.error(str(error))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
