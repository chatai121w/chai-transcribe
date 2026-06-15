"""Offline comparison for locally downloaded Hebrew-capable Whisper models.

Runs only models already available in local cache (no internet download).
Measures speed and text accuracy on local Hebrew fixture files.
"""

from __future__ import annotations

import difflib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
SERVER_URL = os.environ.get("WHISPER_SERVER_URL", "http://127.0.0.1:3000")
SERVER_PY = ROOT / "server" / "transcribe_server.py"
PYTHON_EXE = ROOT / ".venv" / "Scripts" / "python.exe"

FIXTURES = [
    ("hebrew_short.wav", 3.864),
    ("hebrew_medium.wav", 17.136),
    ("hebrew_long.wav", 36.48),
]


def _health(timeout: int = 10) -> dict[str, Any]:
    r = requests.get(f"{SERVER_URL}/health", timeout=timeout)
    r.raise_for_status()
    return r.json()


def _wait_for_server(timeout_sec: int = 60) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    last_err = ""
    while time.time() < deadline:
        try:
            return _health(timeout=5)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            time.sleep(1)
    raise RuntimeError(f"Server did not become healthy in {timeout_sec}s: {last_err}")


def _is_hebrew_capable(model_id: str) -> bool:
    lower = model_id.lower()
    if lower.endswith(".en"):
        return False
    return True


def _load_model(model_id: str, timeout_sec: int = 900) -> None:
    r = requests.post(
        f"{SERVER_URL}/load-model",
        json={"model": model_id},
        timeout=timeout_sec,
    )
    r.raise_for_status()
    payload = r.json()
    if payload.get("status") != "loaded":
        raise RuntimeError(f"Failed to load model {model_id}: {payload}")

    deadline = time.time() + 120
    while time.time() < deadline:
        h = _health(timeout=5)
        if h.get("current_model") == model_id and h.get("model_ready"):
            return
        time.sleep(1)
    raise RuntimeError(f"Model {model_id} did not become ready in time")


def _bench_file(model_id: str, wav_name: str, fallback_duration: float) -> dict[str, Any]:
    wav_path = ROOT / "e2e" / "fixtures" / wav_name
    expected_path = wav_path.with_suffix(".expected.txt")

    expected = expected_path.read_text(encoding="utf-8").strip()

    start = time.time()
    with wav_path.open("rb") as f:
        resp = requests.post(
            f"{SERVER_URL}/transcribe",
            files={"file": (wav_name, f, "audio/wav")},
            data={
                "language": "he",
                "beam_size": "5",
                "model": model_id,
            },
            timeout=600,
        )
    wall = time.time() - start

    resp.raise_for_status()
    data = resp.json()

    text = (data.get("text") or "").strip()
    proc = float(data.get("processing_time") or wall)
    dur = float(data.get("duration") or fallback_duration)
    speed_x = dur / proc if proc > 0 else 0.0

    exp_words = expected.split()
    got_words = text.split()
    word_acc = difflib.SequenceMatcher(None, exp_words, got_words).ratio() * 100
    char_acc = difflib.SequenceMatcher(None, expected, text).ratio() * 100

    return {
        "file": wav_name,
        "duration": dur,
        "processing_time": proc,
        "wall_time": wall,
        "speed_x": speed_x,
        "word_accuracy": word_acc,
        "char_accuracy": char_acc,
        "text_preview": text[:120],
    }


def _print_summary(results: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 92)
    print("OFFLINE HEBREW MODEL COMPARISON (downloaded models only)")
    print("=" * 92)
    print(f"{'MODEL':45} {'AVG_WORD%':>10} {'AVG_CHAR%':>10} {'AVG_SPEEDx':>11} {'TOTAL_PROC(s)':>13}")
    print("-" * 92)
    for row in sorted(results, key=lambda x: (-x["avg_word_accuracy"], -x["avg_speed_x"])):
        print(
            f"{row['model'][:45]:45} "
            f"{row['avg_word_accuracy']:10.1f} "
            f"{row['avg_char_accuracy']:10.1f} "
            f"{row['avg_speed_x']:11.2f} "
            f"{row['total_processing_time']:13.2f}"
        )
    print("=" * 92)


def main() -> int:
    if not PYTHON_EXE.exists():
        print(f"ERROR: missing python exe: {PYTHON_EXE}")
        return 1
    if not SERVER_PY.exists():
        print(f"ERROR: missing server file: {SERVER_PY}")
        return 1

    server_proc: subprocess.Popen[str] | None = None
    started_here = False

    try:
        try:
            h = _health(timeout=2)
            print("Server already running.")
        except Exception:
            print("Starting local whisper server...")
            server_proc = subprocess.Popen(  # noqa: S603
                [str(PYTHON_EXE), str(SERVER_PY)],
                cwd=str(ROOT),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            started_here = True
            h = _wait_for_server(timeout_sec=90)

        downloaded = h.get("downloaded_models", [])
        if not downloaded:
            print("No downloaded models found in cache. Nothing to compare offline.")
            return 2

        models = [m for m in downloaded if _is_hebrew_capable(m)]
        only_models_raw = os.environ.get("ONLY_MODELS", "").strip()
        if only_models_raw:
            wanted = {x.strip() for x in only_models_raw.split(",") if x.strip()}
            models = [m for m in models if m in wanted]
        if not models:
            print("No Hebrew-capable downloaded models were found.")
            return 2

        print(f"Found {len(models)} Hebrew-capable downloaded models:")
        for m in models:
            print(f"  - {m}")

        per_model: list[dict[str, Any]] = []
        failed_models: list[dict[str, str]] = []
        for model in models:
            print(f"\n>>> Benchmarking: {model}")
            try:
                _load_model(model)

                runs: list[dict[str, Any]] = []
                for wav_name, dur in FIXTURES:
                    run = _bench_file(model, wav_name, dur)
                    runs.append(run)
                    print(
                        f"  {wav_name:17} | speed {run['speed_x']:.2f}x | "
                        f"word {run['word_accuracy']:.1f}% | char {run['char_accuracy']:.1f}%"
                    )

                total_proc = sum(x["processing_time"] for x in runs)
                total_dur = sum(x["duration"] for x in runs)
                avg_speed = total_dur / total_proc if total_proc > 0 else 0.0
                avg_word = sum(x["word_accuracy"] for x in runs) / len(runs)
                avg_char = sum(x["char_accuracy"] for x in runs) / len(runs)

                per_model.append(
                    {
                        "model": model,
                        "avg_word_accuracy": avg_word,
                        "avg_char_accuracy": avg_char,
                        "avg_speed_x": avg_speed,
                        "total_processing_time": total_proc,
                        "runs": runs,
                    }
                )
            except Exception as model_err:  # noqa: BLE001
                failed_models.append({"model": model, "error": str(model_err)})
                print(f"  FAILED: {model_err}")

        if per_model:
            _print_summary(per_model)
        if failed_models:
            print("\nFailed models:")
            for item in failed_models:
                print(f"  - {item['model']}: {item['error']}")

        out_file = ROOT / "benchmark_offline_hebrew_models.json"
        out_file.write_text(
            json.dumps(
                {"server": SERVER_URL, "results": per_model, "failed_models": failed_models},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Saved detailed results to: {out_file}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}")
        return 1
    finally:
        if started_here and server_proc is not None and server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=8)
            except Exception:  # noqa: BLE001
                server_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
