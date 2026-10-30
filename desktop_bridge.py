from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DESKTOP_DIR = ROOT / "data" / "desktop"
STATUS_PATH = DESKTOP_DIR / "status.json"
COMMAND_PATH = DESKTOP_DIR / "command.json"
VOICE_PATH = DESKTOP_DIR / "windows-voice.json"
VOICE_DEFAULTS = {"windowsVoiceId": "", "windowsSpeechRate": 0.9}
CONTROL_ACTIONS = {"start", "pause", "resume", "exit", "open"}


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (OSError, json.JSONDecodeError):
        return default


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_status() -> dict[str, Any]:
    status = _read(STATUS_PATH, {})
    if not isinstance(status, dict) or not status.get("updated_at"):
        return {"state": "stopped", "error": None, "updated_at": None}
    try:
        updated_at = datetime.fromisoformat(status["updated_at"])
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - updated_at).total_seconds() > 5:
            return {"state": "stopped", "error": None, "updated_at": status["updated_at"]}
    except (TypeError, ValueError):
        return {"state": "error", "error": "Desktop status timestamp is invalid.", "updated_at": None}
    return status


def write_status(state: str, error: str | None = None) -> None:
    _write(STATUS_PATH, {
        "state": state,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def send_command(action: str) -> dict[str, str]:
    if action not in CONTROL_ACTIONS:
        raise ValueError(f"Unsupported desktop action: {action}")
    command = {"id": uuid.uuid4().hex, "action": action}
    _write(COMMAND_PATH, command)
    return command


def read_command() -> dict[str, str] | None:
    command = _read(COMMAND_PATH, None)
    if not isinstance(command, dict):
        return None
    if not isinstance(command.get("id"), str) or command.get("action") not in CONTROL_ACTIONS:
        return None
    return command


def read_windows_voice() -> dict[str, Any]:
    config = _read(VOICE_PATH, {})
    if not isinstance(config, dict):
        config = {}
    voice_id = config.get("windowsVoiceId", "")
    rate = config.get("windowsSpeechRate", VOICE_DEFAULTS["windowsSpeechRate"])
    return {
        "windowsVoiceId": voice_id if isinstance(voice_id, str) else "",
        "windowsSpeechRate": rate if isinstance(rate, (int, float)) and 0.5 <= rate <= 2 else VOICE_DEFAULTS["windowsSpeechRate"],
    }


def write_windows_voice(voice_id: str, rate: float) -> dict[str, Any]:
    config = {"windowsVoiceId": voice_id, "windowsSpeechRate": rate}
    _write(VOICE_PATH, config)
    return config
