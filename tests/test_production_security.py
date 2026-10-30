from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
import jwt
from cryptography.hazmat.primitives.asymmetric import ec

import app


USER_A = "9a7fcd47-358a-4be6-b805-49e64a7628e9"
USER_B = "059f3b61-7e6c-4c28-a7a5-395ca79e1379"


class ProductionSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "security-test.sqlite3"
        self.database_url_patch = patch.object(app, "DATABASE_URL", "")
        self.database_path_patch = patch.object(app, "DB_PATH", self.database_path)
        self.database_url_patch.start()
        self.database_path_patch.start()
        app.initialize_database()
        with app._rate_lock:
            app._rate_buckets.clear()
        self.verify_access_token = app.verify_access_token
        def resolve_user(token: str) -> str:
            users = {"user-a": USER_A, "user-b": USER_B}
            if token not in users:
                raise ValueError("invalid token")
            return users[token]
        self.production_patch = patch.object(app, "production_mode", return_value=True)
        self.token_patch = patch.object(app, "verify_access_token", side_effect=resolve_user)
        self.production_patch.start()
        self.token_patch.start()
        self.client = TestClient(app.app)

    def tearDown(self) -> None:
        self.client.close()
        self.token_patch.stop()
        self.production_patch.stop()
        self.database_path_patch.stop()
        self.database_url_patch.stop()
        self.temporary_directory.cleanup()

    @staticmethod
    def auth(user: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {user}"}

    def test_api_routes_require_a_valid_bearer_token_but_health_is_public(self) -> None:
        self.assertEqual(self.client.get("/api/history").status_code, 401)
        self.assertEqual(self.client.get("/api/history", headers=self.auth("invalid")).status_code, 401)
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        self.assertEqual(self.client.get("/").status_code, 404)

    def test_jwt_verification_checks_signature_issuer_audience_and_user_role(self) -> None:
        key = ec.generate_private_key(ec.SECP256R1())
        signing_key = SimpleNamespace(algorithm_name="ES256", key=key.public_key())
        common_claims = {
            "sub": USER_A,
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://project.supabase.co/auth/v1",
            "exp": int(time.time()) + 300,
        }
        valid = jwt.encode(common_claims, key, algorithm="ES256", headers={"kid": "test-key"})
        service_role = jwt.encode(
            {**common_claims, "role": "service_role"},
            key,
            algorithm="ES256",
            headers={"kid": "test-key"},
        )
        invalid_issuer = jwt.encode(
            {**common_claims, "iss": "https://other.supabase.co/auth/v1"},
            key,
            algorithm="ES256",
            headers={"kid": "test-key"},
        )
        invalid_audience = jwt.encode(
            {**common_claims, "aud": "anon"},
            key,
            algorithm="ES256",
            headers={"kid": "test-key"},
        )
        other_key = ec.generate_private_key(ec.SECP256R1())
        invalid_signature = jwt.encode(common_claims, other_key, algorithm="ES256", headers={"kid": "test-key"})
        resolver = patch.object(
            app,
            "_jwks_client",
            SimpleNamespace(get_signing_key_from_jwt=lambda _token: signing_key),
        )
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co"}), resolver:
            self.assertEqual(self.verify_access_token(valid), USER_A)
            with self.assertRaisesRegex(ValueError, "authenticated user"):
                self.verify_access_token(service_role)
            for invalid_token in (invalid_issuer, invalid_audience, invalid_signature):
                with self.assertRaises(jwt.InvalidTokenError):
                    self.verify_access_token(invalid_token)

    def test_history_and_memories_are_isolated_by_authenticated_user(self) -> None:
        app.save_message("user", "private A", user_id=USER_A)
        app.save_message("user", "private B", user_id=USER_B)
        with app.database() as connection:
            connection.execute("INSERT INTO memories(user_id,content) VALUES(?,?)", (USER_A, "memory A"))
            connection.execute("INSERT INTO memories(user_id,content) VALUES(?,?)", (USER_B, "memory B"))

        history_a = self.client.get("/api/history", headers=self.auth("user-a")).json()["messages"]
        history_b = self.client.get("/api/history", headers=self.auth("user-b")).json()["messages"]
        memories_a = self.client.get("/api/memories", headers=self.auth("user-a")).json()["memories"]
        memories_b = self.client.get("/api/memories", headers=self.auth("user-b")).json()["memories"]

        self.assertEqual([message["content"] for message in history_a], ["private A"])
        self.assertEqual([message["content"] for message in history_b], ["private B"])
        self.assertEqual([memory["content"] for memory in memories_a], ["memory A"])
        self.assertEqual([memory["content"] for memory in memories_b], ["memory B"])

    def test_memory_mutations_are_scoped_to_the_owner(self) -> None:
        created = self.client.post("/api/memories", headers=self.auth("user-a"), json={"content": "owner only"})
        memory_id = created.json()["id"]
        self.assertEqual(created.status_code, 200)
        self.assertEqual(
            self.client.delete(f"/api/memories/{memory_id}", headers=self.auth("user-b")).status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/memories", headers=self.auth("user-b")).json()["memories"],
            [],
        )

    def test_chat_context_does_not_include_another_users_messages(self) -> None:
        app.save_message("user", "private context A", user_id=USER_A)
        app.save_message("assistant", "private context B", user_id=USER_B)
        captured_messages: list[list[dict[str, str]]] = []

        def capture_model(messages, _max_tokens=1200):
            captured_messages.append(messages)
            return "A response for A."

        with patch.object(app, "ask_model", side_effect=capture_model), patch.object(
            app, "model_name", return_value="test-model"
        ):
            response = self.client.post(
                "/api/chat",
                headers=self.auth("user-a"),
                json={"message": "Continue my conversation.", "research": False},
            )

        self.assertEqual(response.status_code, 200)
        serialized_context = str(captured_messages[0])
        self.assertIn("private context A", serialized_context)
        self.assertNotIn("private context B", serialized_context)

    def test_hosted_desktop_controls_are_not_exposed(self) -> None:
        response = self.client.get("/api/desktop/status", headers=self.auth("user-a"))
        self.assertEqual(response.status_code, 404)

    def test_requests_larger_than_limit_are_rejected(self) -> None:
        response = self.client.post(
            "/api/calculate",
            headers=self.auth("user-a"),
            content=b"x" * (65536 + 1),
        )
        self.assertEqual(response.status_code, 413)

    def test_api_rate_limit_returns_retry_after(self) -> None:
        with patch.object(app, "API_RATE_LIMIT", 1):
            first = self.client.get("/api/status", headers=self.auth("user-a"))
            second = self.client.get("/api/status", headers=self.auth("user-a"))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertGreater(int(second.headers["Retry-After"]), 0)

    def test_ai_rate_limit_is_shared_across_chat_and_provider_diagnostic_routes(self) -> None:
        with (
            patch.object(app, "AI_RATE_LIMIT", 1),
            patch.object(app, "ask_model", return_value="Mocked response."),
            patch.object(app, "model_name", return_value="test-model"),
        ):
            diagnostic = self.client.post("/api/test/nebius", headers=self.auth("user-a"))
            chat = self.client.post(
                "/api/chat",
                headers=self.auth("user-a"),
                json={"message": "No provider request should run.", "research": False},
            )
        self.assertEqual(diagnostic.status_code, 200)
        self.assertEqual(chat.status_code, 429)

    def test_production_configuration_rejects_missing_database_and_wildcard_cors(self) -> None:
        valid = {
            "NOVA_ENV": "production",
            "DATABASE_URL": "postgresql://example",
            "SUPABASE_URL": "https://project.supabase.co",
            "NOVA_CORS_ORIGINS": "https://nova.example",
            "NEBIUS_API_KEY": "configured-only",
            "NEBIUS_MODEL": "nvidia/nemotron-3.5-bolt-e4b",
        }
        with patch.dict(os.environ, valid, clear=True):
            app.validate_production_configuration()
        with patch.dict(os.environ, {**valid, "DATABASE_URL": ""}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
                app.validate_production_configuration()
        with patch.dict(os.environ, {**valid, "NOVA_CORS_ORIGINS": "*"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "cannot include"):
                app.validate_production_configuration()


if __name__ == "__main__":
    unittest.main()
