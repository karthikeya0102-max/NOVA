from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import wake_engine


class WakeEngineTests(unittest.TestCase):
    def test_missing_custom_model_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "hey_nova.onnx"
            with self.assertRaisesRegex(wake_engine.WakeModelUnavailable, "Wake listening has not started"):
                wake_engine.verify_model(model)


if __name__ == "__main__":
    unittest.main()
