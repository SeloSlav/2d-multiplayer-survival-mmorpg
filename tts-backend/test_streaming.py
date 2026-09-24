"""Focused regression checks for SOVA's text-to-local-audio overlap."""
import asyncio
import json
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

import app as voice_app


class StreamingTests(unittest.TestCase):
    def test_jwt_verification_uses_installed_crypto(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = jwt.encode({
            "iss": "https://test-auth.example", "aud": "vibe-survival-game-client",
            "sub": "local-test", "exp": 4102444800,
        }, private_key, algorithm="RS256")
        with patch.object(voice_app, "AUTH_ISSUER", "https://test-auth.example"), \
             patch.object(voice_app.auth_jwks, "get_signing_key_from_jwt",
                          return_value=SimpleNamespace(key=private_key.public_key())):
            voice_app.authorize_voice_request(f"Bearer {token}")

    def test_phrase_segmentation_starts_before_full_reply(self):
        segment, remaining = voice_app.pop_speech_segment("Hello, Operative. Gather wood")
        self.assertEqual(segment, "Hello, Operative.")
        self.assertEqual(remaining, "Gather wood")

    def test_audio_arrives_while_openai_stream_is_still_open(self):
        first_audio_seen = threading.Event()

        class FakeUpstream:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def __iter__(self):
                for delta in ["Hello, Operative."]:
                    yield b"data: " + json.dumps({"choices": [{"delta": {"content": delta}}]}).encode() + b"\n"
                if not first_audio_seen.wait(10):
                    raise AssertionError("No audio arrived while OpenAI was still streaming")
                yield b"data: " + json.dumps({"choices": [{"delta": {"content": " Stay dry under a tree."}}]}).encode() + b"\n"
                yield b"data: [DONE]\n"

        def fake_pipeline(text, voice):
            self.assertTrue(text)
            self.assertEqual(voice, "af_heart")
            yield None, None, np.zeros(2400, dtype=np.float32)

        # A populated encyclopedia exceeded the original 25,000-character cap.
        request = voice_app.SOVAStreamRequest(messages=[
            {"role": "system", "content": "game knowledge " * 2300},
            {"role": "user", "content": "Help me."},
        ])
        async def collect():
            events = []
            response = voice_app.stream_sova_response(request, authorization="mocked-unit-test")
            async for raw in response.body_iterator:
                event = json.loads(raw)
                events.append(event["type"])
                if event["type"] == "audio":
                    first_audio_seen.set()
            return events

        with patch.object(voice_app, "authorize_voice_request"), \
             patch.object(voice_app, "pipeline", fake_pipeline), \
             patch.object(voice_app.urllib.request, "urlopen", return_value=FakeUpstream()), \
             patch.dict(os.environ, {"OPENAI_API_KEY": "local-mock-only"}):
            events = asyncio.run(collect())

        self.assertIn("audio", events)
        self.assertIn("text_done", events)
        self.assertLess(events.index("audio"), events.index("text_done"))
        self.assertEqual(events[-1], "done")


if __name__ == "__main__":
    unittest.main()
