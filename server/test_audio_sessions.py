import io
import os
import unittest
import wave

import transcribe_server as server


def make_wav(seconds: float = 0.2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buffer.getvalue()


class AudioSessionRoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self._clear_sessions()

    def tearDown(self):
        self._clear_sessions()

    def _clear_sessions(self):
        with server._audio_sessions_lock:
            items = list(server._audio_sessions.values())
            server._audio_sessions.clear()
        for info in items:
            try:
                os.unlink(info["path"])
            except OSError:
                pass

    def upload(self):
        return self.client.post(
            "/audio-sessions",
            data={"file": (io.BytesIO(make_wav()), "lesson.wav")},
            content_type="multipart/form-data",
        )

    def test_identical_upload_reuses_session_and_can_be_deleted(self):
        first = self.upload()
        self.assertEqual(first.status_code, 200)
        first_data = first.get_json()
        self.assertFalse(first_data["reused"])

        second = self.upload()
        self.assertEqual(second.status_code, 200)
        second_data = second.get_json()
        self.assertTrue(second_data["reused"])
        self.assertEqual(second_data["audio_session_id"], first_data["audio_session_id"])

        session_id = first_data["audio_session_id"]
        self.assertEqual(self.client.get(f"/audio-sessions/{session_id}").status_code, 200)
        self.assertEqual(self.client.delete(f"/audio-sessions/{session_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/audio-sessions/{session_id}").status_code, 404)

    def test_transcribe_validation_does_not_consume_reusable_session(self):
        session_id = self.upload().get_json()["audio_session_id"]
        response = self.client.post(
            "/transcribe-stream",
            data={"audio_session_id": session_id, "model": "not-a-real-model", "language": "he"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(f"/audio-sessions/{session_id}").status_code, 200)
        with server._audio_sessions_lock:
            self.assertEqual(server._audio_sessions[session_id]["in_use"], 0)


if __name__ == "__main__":
    unittest.main()
