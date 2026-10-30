from __future__ import annotations

import threading
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import app


class _Cursor:
    def fetchall(self):
        return []


class _Connection:
    def execute(self, *_args):
        return _Cursor()


@contextmanager
def _database():
    yield _Connection()


class MissionEventsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.patches = [
            patch.object(app, "database", _database),
            patch.object(app, "relevant_memories", return_value=[]),
            patch.object(app, "save_message"),
            patch.object(app, "ask_model", return_value="A grounded answer."),
            patch.object(app, "model_name", return_value="test-model"),
        ]
        for mocked in self.patches:
            mocked.start()

    def tearDown(self) -> None:
        for mocked in reversed(self.patches):
            mocked.stop()

    def test_chat_emits_actual_sequential_stages_and_dependencies(self) -> None:
        events = list(app.execute_chat(app.Chat(message="Explain this."), "mission-1"))
        self.assertEqual(
            [event["stage"] for event in events],
            ["request_received", "planning", "planning", "analysis", "analysis", "response_delivery", "response_delivery"],
        )
        self.assertEqual([event["sequence"] for event in events], list(range(1, 8)))
        self.assertTrue(all(event["mission_id"] == "mission-1" for event in events))
        self.assertEqual(events[0]["node_id"], "mission_received")
        self.assertEqual(events[2]["depends_on"], ["mission_received"])
        self.assertEqual(events[3]["depends_on"], ["planning"])
        self.assertEqual(events[-1]["node_id"], "response_delivery")
        self.assertEqual(events[-1]["depends_on"], ["analysis"])
        self.assertNotIn(events[-1]["node_id"], events[-1]["depends_on"])
        self.assertTrue(all(
            {"mission_id", "sequence", "stage", "node_id", "depends_on", "status", "timestamp", "description"} <= event.keys()
            for event in events
        ))
        self.assertEqual(events[-1]["type"], "completed")
        self.assertEqual(events[-1]["status"], "completed")
        self.assertEqual(events[-1]["answer"], "A grounded answer.")

    def test_research_stage_is_omitted_when_not_requested(self) -> None:
        events = list(app.execute_chat(app.Chat(message="A direct question."), "mission-chat"))
        self.assertNotIn("tavily_search", [event["stage"] for event in events])
        self.assertNotIn("intent_classification", [event["stage"] for event in events])
        self.assertNotIn("tool_selection", [event["stage"] for event in events])

    def test_research_stage_is_real_and_precedes_model_analysis(self) -> None:
        sources = [{"title": "Source", "url": "https://example.test", "snippet": "Evidence"}]
        with patch.object(app, "web_search", return_value=sources) as search:
            events = list(app.execute_chat(app.Chat(message="Look up current info.", research=True), "mission-research"))
        search.assert_called_once()
        stages = [event["stage"] for event in events]
        self.assertLess(stages.index("tavily_search"), stages.index("analysis"))
        research_complete = next(event for event in events if event["stage"] == "tavily_search" and event["status"] == "completed")
        self.assertEqual(research_complete["details"]["source_count"], 1)

    def test_model_failure_marks_only_the_real_active_stage_failed(self) -> None:
        with patch.object(app, "ask_model", side_effect=RuntimeError("Model unavailable.")):
            events = list(app.execute_chat(app.Chat(message="Answer this."), "mission-failure"))
        self.assertEqual(events[-1]["type"], "failed")
        self.assertEqual(events[-1]["stage"], "analysis")
        self.assertEqual(events[-1]["status"], "failed")
        self.assertNotIn("response_delivery", [event["stage"] for event in events])

    def test_failed_research_tool_does_not_claim_model_analysis_started(self) -> None:
        with patch.object(app, "web_search", side_effect=RuntimeError("Tavily unavailable.")), patch.object(app, "ask_model") as ask:
            events = list(app.execute_chat(app.Chat(message="Research this.", research=True), "mission-tool-failure"))
        self.assertEqual(events[-1]["type"], "failed")
        self.assertEqual(events[-1]["stage"], "tavily_search")
        self.assertNotIn("analysis", [event["stage"] for event in events])
        ask.assert_not_called()

    def test_cancellation_stops_before_the_next_execution_stage(self) -> None:
        cancelled = threading.Event()

        def cancel_during_context(_query: str, _user_id: str = "local") -> list[str]:
            cancelled.set()
            return []

        with patch.object(app, "relevant_memories", side_effect=cancel_during_context), patch.object(app, "ask_model") as ask:
            events = list(app.execute_chat(app.Chat(message="Cancel me."), "mission-cancel", cancelled))
        self.assertEqual(events[-1]["type"], "cancelled")
        self.assertEqual(events[-1]["stage"], "planning")
        ask.assert_not_called()
        self.assertNotIn("analysis", [event["stage"] for event in events])

    def test_sse_stream_preserves_mission_id_and_event_order(self) -> None:
        event_builder = app.MissionEvents("mission-stream")
        events = [
            event_builder.create("step", "request_received", "completed", "Request accepted."),
            event_builder.create(
                "completed", "response_delivery", "completed", "Response ready.",
                answer="Done.", mode="chat", model="test-model", sources=[],
            ),
        ]
        client = TestClient(app.app)
        with patch.object(app, "execute_chat", return_value=iter(events)):
            response = client.post("/api/mission", json={"message": "Run a mission.", "research": False})
        self.assertEqual(response.status_code, 200)
        frames = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
        parsed = [app.json.loads(frame) for frame in frames]
        self.assertEqual([event["sequence"] for event in parsed], [1, 2])
        self.assertTrue(all(event["mission_id"] == "mission-stream" for event in parsed))

    def test_ordinary_chat_response_path_is_preserved(self) -> None:
        response = TestClient(app.app).post(
            "/api/chat",
            json={"message": "A normal chat question.", "research": False},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "answer": "A grounded answer.",
            "mode": "chat",
            "model": "test-model",
            "sources": [],
        })


if __name__ == "__main__":
    unittest.main()
