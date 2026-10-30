from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app
import desktop_bridge


class DesktopApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.voice_path = Path(self.temporary_directory.name) / "windows-voice.json"
        self.client = TestClient(app.app)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_windows_voice_preference_round_trips_with_separate_provider_names(self) -> None:
        with patch.object(desktop_bridge, "VOICE_PATH", self.voice_path):
            saved = self.client.put(
                "/api/desktop/voice",
                json={"windowsVoiceId": "Microsoft David Desktop", "windowsSpeechRate": 1.1},
            )
            fetched = self.client.get("/api/desktop/voice")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(
            saved.json(),
            {"windowsVoiceId": "Microsoft David Desktop", "windowsSpeechRate": 1.1},
        )
        self.assertEqual(fetched.json(), saved.json())

    def test_voice_preview_uses_local_windows_speech_without_provider_calls(self) -> None:
        with (
            patch.object(desktop_bridge, "read_status", return_value={"state": "idle"}),
            patch.object(app.windows_voice, "speak") as speak,
        ):
            response = self.client.post(
                "/api/desktop/voice/preview",
                json={
                    "text": "NOVA preview",
                    "windowsVoiceId": "Microsoft David Desktop",
                    "windowsSpeechRate": 1.2,
                },
            )
        self.assertEqual(response.status_code, 200)
        speak.assert_called_once_with("NOVA preview", "Microsoft David Desktop", 1.2)

    def test_control_rejects_unknown_action(self) -> None:
        with patch.object(desktop_bridge, "read_status", return_value={"state": "idle"}):
            response = self.client.post("/api/desktop/control", json={"action": "unknown"})
        self.assertEqual(response.status_code, 400)

    def test_desktop_voice_discovery_returns_installed_windows_voices(self) -> None:
        voices = [{"id": "Microsoft David Desktop", "name": "Microsoft David Desktop", "lang": "en-US"}]
        with patch.object(app.windows_voice, "list_voices", return_value=voices):
            response = self.client.get("/api/desktop/voices")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"voices": voices})


if __name__ == "__main__":
    unittest.main()
