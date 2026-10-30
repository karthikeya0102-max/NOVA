
import sounddevice as sd
import numpy as np
from scipy.signal import resample_poly
from openwakeword.model import Model
import time

MIC_DEVICE = 1

model = Model(
    wakeword_models=["models/hey_nova.onnx"],
    inference_framework="onnx"
)

print("\n========== NOVA MODEL DIAGNOSTIC ==========")
print("Keep quiet for 15 seconds.")
print("Do NOT say Hey NOVA yet.")
print("===========================================\n")

scores = []
start_time = time.monotonic()
last_print = start_time

def callback(indata, frames, time_info, status):
    global last_print

    try:
        audio = np.mean(indata, axis=1)
        audio = resample_poly(audio, 1, 3)
        audio = np.clip(
            audio * 32768, -32768, 32767
        ).astype(np.int16)

        if len(audio) != 1280:
            return

        prediction = model.predict(audio)
        score = float(prediction.get("hey_nova", 0.0))
        scores.append(score)

        now = time.monotonic()

        if now - last_print >= 1:
            recent = scores[-13:]
            print(
                f"Time: {now-start_time:5.1f}s | "
                f"Current: {score:.4f} | "
                f"Maximum: {max(recent):.4f}"
            )
            last_print = now

    except Exception as e:
        print("Error:", repr(e))


try:
    with sd.InputStream(
        device=MIC_DEVICE,
        samplerate=48000,
        channels=1,
        dtype="float32",
        blocksize=3840,
        callback=callback
    ):
        sd.sleep(15000)

    if scores:
        print("\n========== SILENCE RESULTS ==========")
        print("Samples:", len(scores))
        print("Minimum:", round(min(scores), 4))
        print("Average:", round(float(np.mean(scores)), 4))
        print("Maximum:", round(max(scores), 4))
        print("95th percentile:", round(float(np.percentile(scores, 95)), 4))
        print("=====================================")

except KeyboardInterrupt:
    print("\nDiagnostic stopped.")
