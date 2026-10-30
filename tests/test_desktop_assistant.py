from __future__ import annotations

import threading
import unittest
from unittest.mock import Mock, patch

import desktop_assistant
import wake_engine


class DesktopAssistantTests(unittest.TestCase):
    def setUp(self) -> None:
        self._status_patch = patch.object(desktop_assistant.desktop_bridge, "write_status")
        self._status_patch.start()
        self.assistant = desktop_assistant.DesktopAssistant()

    def tearDown(self) -> None:
        try:
            self.assistant.shutdown()
        finally:
            self._status_patch.stop()

    def test_duplicate_wake_events_only_start_one_handoff(self) -> None:
        self.assistant._state = "wake_listening"
        stop_event = threading.Event()
        self.assistant._wake_stop = stop_event
        started = threading.Event()
        with patch.object(self.assistant, "_command_cycle", side_effect=started.set):
            self.assistant._on_wake_detected(stop_event)
            self.assistant._on_wake_detected(stop_event)
            self.assertTrue(started.wait(1))
        self.assertEqual(self.assistant._state, "wake_detected")

    def test_wake_hands_off_to_windows_transcription_then_backend_and_voice(self) -> None:
        self.assistant._state = "wake_detected"
        events: list[str] = []

        def recognize(stop_event: threading.Event, on_listening: object) -> str:
            events.append("transcribing")
            on_listening()  # type: ignore[operator]
            return "What time is it?"

        with (
            patch.object(desktop_assistant.windows_voice, "recognize", side_effect=recognize),
            patch.object(desktop_assistant, "_request_backend", return_value={"answer": "It is noon."}) as request,
            patch.object(desktop_assistant.windows_voice, "speak", side_effect=lambda *_: events.append("speaking")),
            patch.object(self.assistant, "_resume_after_command", side_effect=lambda: events.append("resumed")),
            patch.object(desktop_assistant.desktop_bridge, "write_status"),
        ):
            self.assistant._command_cycle()
        self.assertEqual(request.call_args.args, ("/api/chat", {"message": "What time is it?", "research": False}))
        self.assertEqual(events, ["transcribing", "speaking", "resumed"])
        self.assertEqual(self.assistant._state, "speaking")

    def test_wake_microphone_error_is_reported(self) -> None:
        with (
            patch.object(wake_engine, "listen", side_effect=OSError("device unavailable")),
            patch.object(desktop_assistant.desktop_bridge, "write_status") as write_status,
        ):
            self.assistant._wake_loop(threading.Event())
        self.assertEqual(self.assistant._state, "error")
        self.assertIn("device unavailable", self.assistant._error or "")
        self.assertEqual(write_status.call_args.args[0], "error")

    def test_pause_stops_active_speech_recognition_and_resume_restarts(self) -> None:
        with (
            patch.object(desktop_assistant.windows_voice, "stop_recognition") as stop,
            patch.object(self.assistant, "start_listening") as start,
            patch.object(desktop_assistant.desktop_bridge, "write_status"),
        ):
            self.assistant.pause()
            self.assertEqual(self.assistant._state, "paused")
            self.assistant.resume()
        stop.assert_called_once()
        start.assert_called_once()

    def test_shutdown_stops_background_capture_and_updates_status(self) -> None:
        with (
            patch.object(desktop_assistant.windows_voice, "stop_all") as stop,
            patch.object(desktop_assistant.desktop_bridge, "write_status") as write_status,
        ):
            self.assistant.shutdown()
        self.assertTrue(self.assistant._shutdown.is_set())
        stop.assert_called_once()
        self.assertEqual(write_status.call_args.args[0], "stopped")

    def test_start_does_not_fake_listening_without_trained_model(self) -> None:
        with (
            patch.object(wake_engine, "verify_model", side_effect=wake_engine.WakeModelUnavailable("missing")),
            patch.object(desktop_assistant.desktop_bridge, "write_status"),
        ):
            self.assistant.start_listening()
        self.assertEqual(self.assistant._state, "error")
        self.assertIn("missing", self.assistant._error or "")


if __name__ == "__main__":
    unittest.main()
