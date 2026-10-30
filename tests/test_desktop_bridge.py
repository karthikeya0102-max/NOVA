from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_bridge


class DesktopBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        directory = Path(self.temporary_directory.name)
        self.patches = [
            patch.object(desktop_bridge, "STATUS_PATH", directory / "status.json"),
            patch.object(desktop_bridge, "COMMAND_PATH", directory / "command.json"),
            patch.object(desktop_bridge, "VOICE_PATH", directory / "windows-voice.json"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self) -> None:
        for item in reversed(self.patches):
            item.stop()
        self.temporary_directory.cleanup()

    def test_control_commands_are_unique_and_validated(self) -> None:
        first = desktop_bridge.send_command("pause")
        second = desktop_bridge.send_command("resume")
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(desktop_bridge.read_command(), second)
        with self.assertRaises(ValueError):
            desktop_bridge.send_command("run-shell")

    def test_windows_voice_preferences_persist_independently(self) -> None:
        saved = desktop_bridge.write_windows_voice("Microsoft David Desktop", 1.15)
        self.assertEqual(saved, {"windowsVoiceId": "Microsoft David Desktop", "windowsSpeechRate": 1.15})
        self.assertEqual(desktop_bridge.read_windows_voice(), saved)

    def test_invalid_rate_falls_back_to_default(self) -> None:
        desktop_bridge._write(desktop_bridge.VOICE_PATH, {"windowsVoiceId": "removed", "windowsSpeechRate": 3.0})
        self.assertEqual(desktop_bridge.read_windows_voice(), {"windowsVoiceId": "removed", "windowsSpeechRate": 0.9})

    def test_status_tracks_actual_state(self) -> None:
        desktop_bridge.write_status("paused")
        self.assertEqual(desktop_bridge.read_status()["state"], "paused")


if __name__ == "__main__":
    unittest.main()
