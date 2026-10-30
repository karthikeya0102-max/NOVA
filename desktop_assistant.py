from __future__ import annotations

import ctypes
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import winreg
from pathlib import Path
from tkinter import Tk, messagebox
from typing import Any

import desktop_bridge
import wake_engine
import windows_voice


ROOT = Path(__file__).resolve().parent
BACKEND_URL = "http://127.0.0.1:8000"
WEB_URL = "http://localhost:3000"
MUTEX_NAME = "Local\\NOVA-Desktop-Assistant"
STARTUP_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
STARTUP_VALUE = "NOVA Desktop Assistant"
WAKE_THRESHOLD = float(os.environ.get("NOVA_WAKE_THRESHOLD", "0.65"))


def _request_backend(path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{BACKEND_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise RuntimeError("The NOVA backend returned an invalid response.")
    return result


def ensure_backend() -> None:
    try:
        _request_backend("/api/status")
        return
    except (urllib.error.URLError, TimeoutError, OSError):
        pass

    with socket.socket() as connection:
        if connection.connect_ex(("127.0.0.1", 8000)) == 0:
            raise RuntimeError("Port 8000 is occupied by a service that is not responding as NOVA.")

    python = ROOT / ".venv" / "Scripts" / "python.exe"
    if not python.is_file():
        raise RuntimeError("NOVA's project Python environment is missing. Run start.bat first.")
    subprocess.Popen(
        [str(python), "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    deadline = time.monotonic() + 30
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            _request_backend("/api/status")
            return
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
            time.sleep(0.5)
    raise RuntimeError(f"NOVA's FastAPI backend did not start: {last_error}")


def is_startup_enabled() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY) as key:
            winreg.QueryValueEx(key, STARTUP_VALUE)
            return True
    except FileNotFoundError:
        return False


def set_startup_enabled(enabled: bool) -> None:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            pythonw = Path(sys.executable).with_name("pythonw.exe")
            executable = pythonw if pythonw.is_file() else Path(sys.executable)
            command = f'"{executable}" "{ROOT / "desktop_assistant.py"}" --background'
            winreg.SetValueEx(key, STARTUP_VALUE, 0, winreg.REG_SZ, command)
        else:
            try:
                winreg.DeleteValue(key, STARTUP_VALUE)
            except FileNotFoundError:
                pass


class DesktopAssistant:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._shutdown = threading.Event()
        self._wake_stop = threading.Event()
        self._wake_thread: threading.Thread | None = None
        self._command_thread: threading.Thread | None = None
        self._state = "idle"
        self._starting = False
        self._error: str | None = None
        pending_command = desktop_bridge.read_command()
        self._last_command_id = pending_command["id"] if pending_command else ""
        self._last_activation = 0.0
        self._icon: Any = None

    def _set_state(self, state: str, error: str | None = None) -> None:
        with self._lock:
            if self._shutdown.is_set():
                return
            self._state = state
            self._error = error
        desktop_bridge.write_status(state, error)
        if self._icon is not None:
            self._icon.title = f"NOVA Desktop — {state.replace('_', ' ')}"
            self._icon.update_menu()

    def start_listening(self) -> None:
        with self._lock:
            if self._state == "paused":
                self._state = "idle"
            if self._shutdown.is_set() or self._state in {
                "wake_listening", "wake_detected", "command_listening", "processing", "speaking"
            } or self._starting:
                return
            if self._command_thread and self._command_thread.is_alive() and self._command_thread is not threading.current_thread():
                return
            previous_thread = self._wake_thread
            self._starting = True
        if previous_thread and previous_thread.is_alive() and previous_thread is not threading.current_thread():
            previous_thread.join(timeout=3)
            if previous_thread.is_alive():
                with self._lock:
                    self._starting = False
                self._set_state("error", "The previous microphone session is still shutting down.")
                return
        with self._lock:
            if self._shutdown.is_set() or self._state not in {"idle", "error"}:
                self._starting = False
                return
            try:
                wake_engine.verify_model()
            except wake_engine.WakeModelUnavailable as error:
                self._starting = False
                self._set_state("error", str(error))
                return
            stop_event = threading.Event()
            self._wake_stop = stop_event
            self._error = None
            self._wake_thread = threading.Thread(
                target=self._wake_loop,
                args=(stop_event,),
                name="NOVA wake-word listener",
                daemon=True,
            )
            self._wake_thread.start()

    def _wake_loop(self, stop_event: threading.Event) -> None:
        try:
            wake_engine.listen(
                stop_event,
                lambda: self._mark_wake_listening(stop_event),
                lambda: self._on_wake_detected(stop_event),
                threshold=WAKE_THRESHOLD,
            )
        except Exception as error:
            if not stop_event.is_set() and not self._shutdown.is_set():
                detail = str(error)
                if any(term in detail.lower() for term in ("permission", "access denied", "not permitted")):
                    detail += " Allow desktop apps to access the microphone in Windows Privacy & security settings."
                self._set_state("error", f"Wake microphone/model error: {detail}")
        with self._lock:
            if self._wake_stop is stop_event:
                self._starting = False
            if self._wake_stop is stop_event and self._state == "wake_listening" and not self._shutdown.is_set():
                self._state = "idle"
                desktop_bridge.write_status("idle")

    def _mark_wake_listening(self, stop_event: threading.Event) -> None:
        with self._lock:
            if self._state != "idle" or self._wake_stop is not stop_event or stop_event.is_set() or self._shutdown.is_set():
                return
            self._starting = False
            self._set_state("wake_listening")

    def _on_wake_detected(self, stop_event: threading.Event) -> None:
        now = time.monotonic()
        with self._lock:
            if self._state != "wake_listening" or self._wake_stop is not stop_event or now - self._last_activation < 2:
                return
            self._last_activation = now
            self._state = "wake_detected"
            self._error = None
            self._wake_stop.set()
            desktop_bridge.write_status("wake_detected")
            self._command_thread = threading.Thread(
                target=self._command_cycle,
                name="NOVA voice command",
                daemon=True,
            )
            self._command_thread.start()

    def _command_cycle(self) -> None:
        wake_thread = self._wake_thread
        if wake_thread and wake_thread is not threading.current_thread():
            wake_thread.join(timeout=3)
        if self._shutdown.is_set():
            return
        with self._lock:
            if self._state != "wake_detected":
                return
        try:
            command_stop = threading.Event()
            command = windows_voice.recognize(
                command_stop,
                lambda: self._set_command_listening(command_stop),
            )
            if self._shutdown.is_set() or command_stop.is_set():
                return
            if not command:
                self._resume_after_command()
                return
            self._set_state("processing")
            reply = _request_backend("/api/chat", {"message": command, "research": False})
            answer = reply.get("answer")
            if not isinstance(answer, str) or not answer.strip():
                raise RuntimeError("The NOVA backend returned an empty answer.")
            if self._shutdown.is_set():
                return
            self._set_state("speaking")
            voice = desktop_bridge.read_windows_voice()
            windows_voice.speak(answer, voice["windowsVoiceId"], voice["windowsSpeechRate"])
            self._resume_after_command()
        except Exception as error:
            self._set_state("error", f"Voice command failed: {error}")

    def _set_command_listening(self, stop_event: threading.Event) -> None:
        with self._lock:
            if self._state != "wake_detected" or stop_event.is_set() or self._shutdown.is_set():
                return
        self._set_state("command_listening")

    def _resume_after_command(self) -> None:
        with self._lock:
            if self._shutdown.is_set() or self._state == "paused":
                return
            self._state = "idle"
            self._error = None
        self.start_listening()

    def pause(self) -> None:
        with self._lock:
            if self._shutdown.is_set():
                return
            self._state = "paused"
            self._error = None
            self._starting = False
            self._wake_stop.set()
        windows_voice.stop_recognition()
        desktop_bridge.write_status("paused")
        wake_thread = self._wake_thread
        if wake_thread and wake_thread is not threading.current_thread():
            wake_thread.join(timeout=3)

    def resume(self) -> None:
        with self._lock:
            if self._shutdown.is_set():
                return
            self._state = "idle"
            self._error = None
        self.start_listening()

    def open_web(self) -> None:
        try:
            with urllib.request.urlopen(WEB_URL, timeout=2):
                pass
        except (urllib.error.URLError, TimeoutError, OSError):
            launcher = ROOT / "RUN_NOVA.bat"
            if not launcher.is_file():
                self._set_state("error", "The NOVA web launcher is missing.")
                return
            subprocess.Popen([os.environ.get("COMSPEC", "cmd.exe"), "/c", str(launcher)], cwd=ROOT)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen(WEB_URL, timeout=2):
                        break
                except (urllib.error.URLError, TimeoutError, OSError):
                    time.sleep(1)
            else:
                self._set_state("error", "The NOVA web interface did not start.")
                return
        os.startfile(WEB_URL)

    def handle_command(self, command: dict[str, str]) -> None:
        if command["id"] == self._last_command_id:
            return
        self._last_command_id = command["id"]
        action = command["action"]
        if action == "start":
            self.start_listening()
        elif action == "pause":
            self.pause()
        elif action == "resume":
            self.resume()
        elif action == "open":
            self.open_web()
        elif action == "exit":
            self.shutdown()

    def shutdown(self) -> None:
        with self._lock:
            if self._shutdown.is_set():
                return
            self._shutdown.set()
            self._wake_stop.set()
            self._state = "stopped"
            self._error = None
        windows_voice.stop_all()
        desktop_bridge.write_status("stopped")
        for thread in (self._wake_thread, self._command_thread):
            if thread and thread is not threading.current_thread():
                thread.join(timeout=3)
        if self._icon is not None:
            self._icon.stop()

    def _poll_commands(self) -> None:
        while not self._shutdown.wait(0.25):
            command = desktop_bridge.read_command()
            if command is not None:
                self.handle_command(command)

    def _heartbeat(self) -> None:
        while not self._shutdown.wait(1):
            with self._lock:
                state, error = self._state, self._error
            desktop_bridge.write_status(state, error)

    def _confirm_startup(self) -> None:
        root = Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            enabled = is_startup_enabled()
            if enabled:
                if messagebox.askyesno("NOVA startup", "Disable NOVA automatic startup for your Windows account?", parent=root):
                    set_startup_enabled(False)
            elif messagebox.askyesno(
                "NOVA startup",
                "Allow NOVA to start and begin wake-word listening when you sign in to Windows? "
                "The microphone will be active. You can disable this at any time from the tray menu.",
                parent=root,
            ):
                set_startup_enabled(True)
        finally:
            root.destroy()

    def run(self, auto_start: bool = False) -> int:
        try:
            import pystray
            from PIL import Image, ImageDraw
        except ImportError as error:
            raise RuntimeError("Install pystray and Pillow to enable the Windows system tray.") from error

        image = Image.new("RGBA", (64, 64), (3, 18, 30, 255))
        draw = ImageDraw.Draw(image)
        draw.ellipse((9, 9, 55, 55), outline=(56, 220, 245, 255), width=3)
        draw.text((20, 23), "N", fill=(176, 249, 255, 255))

        def menu() -> Any:
            return pystray.Menu(
                pystray.MenuItem("Start NOVA", lambda _icon, _item: self.start_listening()),
                pystray.MenuItem("Pause Listening", lambda _icon, _item: self.pause()),
                pystray.MenuItem("Resume Listening", lambda _icon, _item: self.resume()),
                pystray.MenuItem("Open NOVA interface", lambda _icon, _item: self.open_web()),
                pystray.MenuItem("Windows startup consent…", lambda _icon, _item: self._confirm_startup()),
                pystray.MenuItem("Exit NOVA", lambda _icon, _item: self.shutdown()),
            )

        self._icon = pystray.Icon("NOVA", image, "NOVA Desktop — idle", menu())
        threading.Thread(target=self._poll_commands, name="NOVA desktop controls", daemon=True).start()
        threading.Thread(target=self._heartbeat, name="NOVA desktop status", daemon=True).start()
        if auto_start:
            self.start_listening()
        self._icon.run()
        self.shutdown()
        return 0


def _single_instance() -> Any:
    handle = ctypes.windll.kernel32.CreateMutexW(None, True, MUTEX_NAME)
    if not handle:
        raise OSError("Windows could not create the NOVA single-instance mutex.")
    if ctypes.windll.kernel32.GetLastError() == 183:
        ctypes.windll.kernel32.CloseHandle(handle)
        return None
    return handle


def main() -> int:
    mutex = _single_instance()
    if mutex is None:
        return 0
    assistant = DesktopAssistant()
    try:
        ensure_backend()
        return assistant.run(auto_start="--background" in sys.argv[1:])
    except Exception as error:
        desktop_bridge.write_status("error", str(error))
        root = Tk()
        root.withdraw()
        try:
            messagebox.showerror("NOVA Desktop Assistant", str(error), parent=root)
        finally:
            root.destroy()
        return 1
    finally:
        assistant.shutdown()
        ctypes.windll.kernel32.ReleaseMutex(mutex)
        ctypes.windll.kernel32.CloseHandle(mutex)


if __name__ == "__main__":
    raise SystemExit(main())
