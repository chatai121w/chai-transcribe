import unittest
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import shutil

import transcribe_server as server_module

from transcribe_server import (
    _YT_JOBS,
    _run_ytdlp,
    _yt_conservative_retry_cmd,
    _yt_should_retry_download,
    _write_subtitle_srt,
)


class _FakeProcess:
    def __init__(self, returncode, stderr=""):
        self.returncode = returncode
        self.stdout = StringIO("")
        self.stderr = StringIO(stderr)

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        return None


class YoutubeDownloadRetryTests(unittest.TestCase):
    def test_retries_transient_youtube_download_errors(self):
        self.assertTrue(_yt_should_retry_download("ERROR: HTTP Error 403: Forbidden"))
        self.assertTrue(_yt_should_retry_download("HTTP Error 429: Too Many Requests"))
        self.assertFalse(_yt_should_retry_download("ERROR: ffmpeg executable not found"))

    def test_conservative_retry_reextracts_over_ipv4_with_one_fragment(self):
        original = [
            "yt-dlp",
            "--no-playlist",
            "--concurrent-fragments",
            "8",
            "https://www.youtube.com/watch?v=test",
        ]

        retry = _yt_conservative_retry_cmd(original)

        self.assertEqual(original[3], "8")
        self.assertEqual(retry[0], "yt-dlp")
        self.assertIn("--force-ipv4", retry)
        self.assertEqual(retry[retry.index("--remote-components") + 1], "ejs:github")
        self.assertEqual(
            retry[retry.index("--extractor-args") + 1],
            "youtube:player_client=web_embedded",
        )
        self.assertEqual(retry[retry.index("--concurrent-fragments") + 1], "1")
        self.assertEqual(retry[retry.index("--extractor-retries") + 1], "3")
        self.assertEqual(retry[retry.index("--retry-sleep") + 1], "2")
        self.assertEqual(retry[-1], original[-1])

    def test_adds_fragment_limit_after_executable_when_missing(self):
        retry = _yt_conservative_retry_cmd(["yt-dlp", "https://youtu.be/test"])

        self.assertEqual(retry[0], "yt-dlp")
        self.assertEqual(retry[retry.index("--concurrent-fragments") + 1], "1")

    @patch("transcribe_server.time.sleep", return_value=None)
    @patch("subprocess.Popen")
    def test_403_automatically_runs_conservative_retry(self, popen, _sleep):
        popen.side_effect = [
            _FakeProcess(1, "ERROR: unable to download video data: HTTP Error 403: Forbidden\n"),
            _FakeProcess(0),
        ]
        job_id = "retry-test"
        _YT_JOBS[job_id] = {}
        command = [
            "yt-dlp",
            "--concurrent-fragments",
            "4",
            "https://youtu.be/test",
        ]

        try:
            _run_ytdlp(command, job_id)
            retry_command = popen.call_args_list[1].args[0]

            self.assertEqual(popen.call_count, 2)
            self.assertIn("--force-ipv4", retry_command)
            self.assertEqual(
                retry_command[retry_command.index("--extractor-args") + 1],
                "youtube:player_client=web_embedded",
            )
            self.assertEqual(retry_command[retry_command.index("--concurrent-fragments") + 1], "1")
            self.assertEqual(_YT_JOBS[job_id]["auto_retry_status"], "recovered")
        finally:
            _YT_JOBS.pop(job_id, None)


class YoutubeSubtitleMuxTests(unittest.TestCase):
    def test_writes_utf8_srt_with_original_timing(self):
        job_dir = server_module._YT_ROOT / "subtitle-srt-test"
        job_dir.mkdir(exist_ok=True)
        path = job_dir / "he.srt"
        try:
            _write_subtitle_srt(path, [{"start": 1.25, "end": 3.5, "text": "שלום עולם"}])
            content = path.read_text(encoding="utf-8-sig")
            self.assertIn("00:00:01,250 --> 00:00:03,500", content)
            self.assertIn("שלום עולם", content)
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    @patch("transcribe_server._check_ffmpeg", return_value=True)
    @patch("subprocess.run")
    def test_muxes_hebrew_and_english_as_switchable_mp4_tracks(self, run, _ffmpeg):
        job_id = "subtitle-mux-test"
        job_dir = server_module._YT_ROOT / job_id
        job_dir.mkdir(exist_ok=True)
        video = job_dir / "video.mp4"
        video.write_bytes(b"video")
        _YT_JOBS[job_id] = {
            "id": job_id,
            "status": "done",
            "output_files": [{"kind": "video", "filename": video.name, "url": "/video"}],
        }

        def fake_run(command, **_kwargs):
            Path(command[-1]).write_bytes(b"muxed")
            return SimpleNamespace(returncode=0, stderr="")

        run.side_effect = fake_run
        payload = {
            "tracks": [
                {"language": "he", "label": "עברית", "segments": [{"start": 0, "end": 1, "text": "שלום"}]},
                {"language": "en", "label": "English", "segments": [{"start": 0, "end": 1, "text": "Hello"}]},
            ]
        }
        try:
            response = server_module.app.test_client().post(f"/yt/subtitles/{job_id}", json=payload)
            data = response.get_json()
            command = run.call_args.args[0]

            self.assertEqual(response.status_code, 200)
            self.assertEqual(command[command.index("-c:s") + 1], "mov_text")
            self.assertIn("language=heb", command)
            self.assertIn("language=eng", command)
            self.assertTrue(any(item["kind"] == "subtitled_video" for item in data["output_files"]))
        finally:
            _YT_JOBS.pop(job_id, None)
            shutil.rmtree(job_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
