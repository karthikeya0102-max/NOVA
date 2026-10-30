from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

import windows_voice


class WindowsVoiceTests(unittest.TestCase):
    def test_preview_uses_selected_voice_and_rate(self) -> None:
        process = Mock()
        process.communicate.return_value = ("", None)
        process.returncode = 0
        with patch.object(windows_voice, "_powershell", return_value=process) as run:
            windows_voice.speak("Preview", "Microsoft David Desktop", 1.2)
        run.assert_called_once_with(
            "speak",
            text="Preview",
            voice_id="Microsoft David Desktop",
            rate=1.2,
        )

    def test_removed_voice_does_not_break_voice_fallback_script_contract(self) -> None:
        script = windows_voice.SCRIPT.read_text(encoding="utf-8")
        self.assertIn("if ($VoiceId -and $installed -contains $VoiceId)", script)
        self.assertIn("$installed | Where-Object { $_ -match '(?i)david|mark|james|guy' }", script)
        self.assertIn("$synth.Speak($Text)", script)


if __name__ == "__main__":
    unittest.main()
