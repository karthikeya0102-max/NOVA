from __future__ import annotations

import base64
import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Callable


SCRIPT = Path(__file__).resolve().parent / "windows_speech.ps1"
_process_lock = threading.Lock()
_active_process: subprocess.Popen[str] | None = None
_active_stop_event: threading.Event | None = None
_speaking_process: subprocess.Popen[str] | None = None


def _powershell(operation: str, *, text: str = "", voice_id: str = "", rate: float = 0.9
                ) -> subprocess.Popen[str]:
    executable = os.environ.get("SystemRoot", r"C:\Windows") + r"\System32\WindowsPowerShell\v1.0\powershell.exe"
    args = [
        executable, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", str(SCRIPT), "-Operation", operation,
    ]
    if text:
        args.extend(["-Text", text])
    if voice_id:
        args.extend(["-VoiceId", voice_id])
    if operation == "speak":
        args.extend(["-Rate", str(rate)])
    return subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        bufsize=1,
    )


def list_voices() -> list[dict[str, str]]:
    process = _powershell("voices")
    output, _ = process.communicate(timeout=15)
    if process.returncode:
        raise RuntimeError(f"Windows speech voice discovery failed: {output.strip()}")
    parsed = json.loads(output)
    if isinstance(parsed, dict):
        parsed = [parsed]
    if not isinstance(parsed, list):
        raise RuntimeError("Windows speech returned an invalid voice list.")
    return [
        {"id": voice["id"], "name": voice["name"], "lang": voice["lang"]}
        for voice in parsed
        if isinstance(voice, dict)
        and all(isinstance(voice.get(key), str) for key in ("id", "name", "lang"))
    ]


def recognize(stop_event: threading.Event, on_listening: Callable[[], None]) -> str | None:
    global _active_process, _active_stop_event
    process = _powershell("recognize")
    with _process_lock:
        _active_process = process
        _active_stop_event = stop_event
    result: str | None = None
    try:
        assert process.stdout is not None
        for line in process.stdout:
            line = line.strip()
            if line == "__NOVA_LISTENING__":
                on_listening()
            elif line.startswith("__NOVA_RESULT__"):
                result = base64.b64decode(line.removeprefix("__NOVA_RESULT__")).decode("utf-8").strip()
            if stop_event.is_set():
                process.terminate()
                break
        process.wait(timeout=5)
        if process.returncode and not stop_event.is_set():
            raise RuntimeError("Windows speech recognition stopped unexpectedly.")
        return result
    finally:
        with _process_lock:
            if _active_process is process:
                _active_process = None
                _active_stop_event = None
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


def stop_recognition() -> None:
    with _process_lock:
        process = _active_process
        stop_event = _active_stop_event
    if stop_event:
        stop_event.set()
    if process and process.poll() is None:
        process.terminate()


def speak(text: str, voice_id: str = "", rate: float = 0.9) -> None:
    global _speaking_process
    process = _powershell("speak", text=text, voice_id=voice_id, rate=rate)
    with _process_lock:
        _speaking_process = process
    try:
        output, _ = process.communicate(timeout=max(30, min(300, len(text) // 8 + 30)))
        if process.returncode:
            raise RuntimeError(f"Windows speech playback failed: {output.strip()}")
    finally:
        with _process_lock:
            if _speaking_process is process:
                _speaking_process = None


def stop_all() -> None:
    with _process_lock:
        recognition_process = _active_process
        stop_event = _active_stop_event
        speech_process = _speaking_process
    if stop_event:
        stop_event.set()
    for process in (recognition_process, speech_process):
        if process and process.poll() is None:
            process.terminate()
