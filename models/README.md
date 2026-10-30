# Hey NOVA wake model status

The desktop engine expects a **real openWakeWord-compatible ONNX classifier** at
`models/hey_nova.onnx`. No such model is included: the upstream openWakeWord
project does not publish a pre-trained "Hey NOVA" classifier. The included
"Hey Jarvis" classifier is not a substitute and must not be renamed or used as
one.

Wake detection stays disabled and reports a clear error until a custom model is
trained, reviewed for its model and data licenses, and placed at the expected
path. No wake detector is simulated.

Before calling the model ready, gather consented, labeled mono 16 kHz, 16-bit
PCM WAV samples across multiple speakers/accents, microphone distances and
background-noise conditions, plus negative speech/noise samples. Keep raw
recordings out of source control. Place a CSV manifest at
`wakeword-samples/manifest.csv` with these columns:

```csv
path,label,condition,speaker,distance,noise
positive/voice-a-near.wav,positive,accent-a,voice-a,near,quiet
negative/voice-b-far.wav,negative,accent-b,voice-b,far,conversation
```

Run the evaluation harness from the project root after installing the
dependencies and providing a trained model:

```powershell
.\.venv\Scripts\python.exe tools\evaluate_wakeword.py --model models\hey_nova.onnx --manifest wakeword-samples\manifest.csv
```

It reports per-condition clip false-reject and false-accept rates and false
alarms per hour of negative audio. Rates from a small convenience set are not
production-reliability evidence; preserve the evaluation set and report its
speaker count, audio hours, conditions, and threshold with any claims.
