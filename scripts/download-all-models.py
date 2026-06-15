#!/usr/bin/env python3
"""
הורדת כל המודלים הנדרשים לעבודה אופליין מלאה.
הורדה מקבילית + המשכה מאותו מקום (דילוג על מה שכבר ירד).

Usage:
  .venv\\Scripts\\python.exe scripts/download-all-models.py
  .venv\\Scripts\\python.exe scripts/download-all-models.py --hf-token hf_xxx
  .venv\\Scripts\\python.exe scripts/download-all-models.py --skip-whisperx
  .venv\\Scripts\\python.exe scripts/download-all-models.py --models tiny,base,large-v3-turbo
  .venv\\Scripts\\python.exe scripts/download-all-models.py --workers 4
"""

import argparse
import json
import sys
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PROGRESS_FILE = Path(__file__).parent.parent / ".model-download-progress.json"

MODEL_REGISTRY = {
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large-v2": "large-v2",
    "large-v3": "large-v3",
    "large-v3-turbo": "large-v3-turbo",
    "distil-large-v3": "deepdml/faster-whisper-large-v3-turbo-ct2",
    "distil-medium.en": "Systran/faster-distil-whisper-medium.en",
    "distil-small.en": "Systran/faster-distil-whisper-small.en",
    "ivrit-ai/faster-whisper-v2-d4": "ivrit-ai/faster-whisper-v2-d4",
    "ivrit-ai/whisper-large-v3-turbo-ct2": "ivrit-ai/whisper-large-v3-turbo-ct2",
}

RECOMMENDED_HEBREW = [
    "ivrit-ai/whisper-large-v3-turbo-ct2",
    "large-v3-turbo",
    "large-v3",
]

# Thread-safe print
_print_lock = Lock()


def safe_print(*args, **kwargs):
    with _print_lock:
        print(*args, **kwargs)
        sys.stdout.flush()


def print_header(title: str):
    safe_print(f"\n{'=' * 60}")
    safe_print(f"  {title}")
    safe_print(f"{'=' * 60}")


def print_ok(msg: str):
    safe_print(f"  ✓ {msg}")


def print_skip(msg: str):
    safe_print(f"  ⏭ {msg}")


def print_fail(msg: str):
    safe_print(f"  ✗ {msg}")


# ---------------------------------------------------------------------------
# Progress tracking — resume from where we left off
# ---------------------------------------------------------------------------
def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"completed": [], "failed": []}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")


def mark_completed(progress: dict, key: str):
    if key not in progress["completed"]:
        progress["completed"].append(key)
    if key in progress["failed"]:
        progress["failed"].remove(key)
    save_progress(progress)


def mark_failed(progress: dict, key: str):
    if key not in progress["failed"]:
        progress["failed"].append(key)
    save_progress(progress)


# ---------------------------------------------------------------------------
# Check if model is already cached (without loading it)
# ---------------------------------------------------------------------------
def is_whisper_cached(model_id: str) -> bool:
    hf_cache = Path.home() / ".cache" / "huggingface" / "hub"
    if "/" not in model_id:
        cache_dir = hf_cache / f"models--Systran--faster-whisper-{model_id}"
    else:
        safe_name = model_id.replace("/", "--")
        cache_dir = hf_cache / f"models--{safe_name}"
    if cache_dir.exists():
        for snapshot in (cache_dir / "snapshots").glob("*"):
            if (snapshot / "model.bin").exists():
                return True
    return False


def is_align_cached() -> bool:
    hf_cache = Path.home() / ".cache" / "huggingface" / "hub"
    cache_dir = hf_cache / "models--imvladikon--wav2vec2-xls-r-300m-hebrew"
    return cache_dir.exists() and any((cache_dir / "snapshots").glob("*"))


def is_pyannote_cached() -> bool:
    hf_cache = Path.home() / ".cache" / "huggingface" / "hub"
    cache_dir = hf_cache / "models--pyannote--speaker-diarization-3.1"
    return cache_dir.exists() and any((cache_dir / "snapshots").glob("*"))


# ---------------------------------------------------------------------------
# Download functions — each returns (key, success, elapsed, skipped)
# ---------------------------------------------------------------------------
def download_one_whisper(key: str, model_id: str, progress: dict):
    if f"whisper:{key}" in progress["completed"] and is_whisper_cached(model_id):
        return (key, True, 0.0, True)
    if is_whisper_cached(model_id):
        mark_completed(progress, f"whisper:{key}")
        return (key, True, 0.0, True)

    safe_print(f"  ⬇ מוריד {key} ({model_id})...")
    t0 = time.time()
    try:
        from faster_whisper import WhisperModel
        WhisperModel(model_id, device="cpu", compute_type="int8")
        elapsed = time.time() - t0
        mark_completed(progress, f"whisper:{key}")
        print_ok(f"{key} — {elapsed:.1f}s")
        return (key, True, elapsed, False)
    except Exception as e:
        elapsed = time.time() - t0
        mark_failed(progress, f"whisper:{key}")
        print_fail(f"{key} — {e}")
        return (key, False, elapsed, False)


def download_whisperx_align(progress: dict):
    key = "whisperx:align-he"
    if key in progress["completed"] and is_align_cached():
        return ("align-he", True, 0.0, True)
    if is_align_cached():
        mark_completed(progress, key)
        return ("align-he", True, 0.0, True)

    safe_print("  ⬇ מוריד wav2vec2-xls-r-300m-hebrew (alignment)...")
    t0 = time.time()
    try:
        import whisperx
        whisperx.load_align_model(language_code="he", device="cpu")
        elapsed = time.time() - t0
        mark_completed(progress, key)
        print_ok(f"alignment עברית — {elapsed:.1f}s")
        return ("align-he", True, elapsed, False)
    except ImportError:
        print_fail("whisperx לא מותקן — דלג")
        return ("align-he", False, 0.0, False)
    except Exception as e:
        elapsed = time.time() - t0
        mark_failed(progress, key)
        print_fail(f"alignment — {e}")
        return ("align-he", False, elapsed, False)


def download_pyannote(hf_token: str, progress: dict):
    key = "pyannote:diarization-3.1"
    if key in progress["completed"] and is_pyannote_cached():
        return ("pyannote", True, 0.0, True)
    if is_pyannote_cached():
        mark_completed(progress, key)
        return ("pyannote", True, 0.0, True)

    safe_print("  ⬇ מוריד pyannote/speaker-diarization-3.1...")
    t0 = time.time()
    try:
        from pyannote.audio import Pipeline as PyannotePipeline
        PyannotePipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token,
        )
        elapsed = time.time() - t0
        mark_completed(progress, key)
        print_ok(f"pyannote diarization — {elapsed:.1f}s")
        return ("pyannote", True, elapsed, False)
    except ImportError:
        print_fail("pyannote.audio לא מותקן — דלג")
        return ("pyannote", False, 0.0, False)
    except Exception as e:
        elapsed = time.time() - t0
        mark_failed(progress, key)
        print_fail(f"pyannote — {e}")
        return ("pyannote", False, elapsed, False)


def download_whisperx_diarize(hf_token: str, progress: dict):
    key = "whisperx:diarize"
    if key in progress["completed"]:
        return ("whisperx-diarize", True, 0.0, True)

    safe_print("  ⬇ מוריד whisperx DiarizationPipeline...")
    t0 = time.time()
    try:
        from whisperx.diarize import DiarizationPipeline as WxDiarize
        WxDiarize(model_name="pyannote/speaker-diarization-3.1", token=hf_token, device="cpu")
        elapsed = time.time() - t0
        mark_completed(progress, key)
        print_ok(f"whisperx diarization — {elapsed:.1f}s")
        return ("whisperx-diarize", True, elapsed, False)
    except ImportError:
        print_fail("whisperx לא מותקן — דלג")
        return ("whisperx-diarize", False, 0.0, False)
    except Exception as e:
        elapsed = time.time() - t0
        mark_failed(progress, key)
        print_fail(f"whisperx diarization — {e}")
        return ("whisperx-diarize", False, elapsed, False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="הורדת מודלים — מקבילי + resume")
    parser.add_argument("--hf-token", type=str, default=None,
                        help="HuggingFace token (נדרש רק ל-pyannote)")
    parser.add_argument("--models", type=str, default=None,
                        help="רשימת מודלים מופרדת בפסיקים")
    parser.add_argument("--recommended", action="store_true",
                        help="רק מודלים מומלצים לעברית (3 במקום 12)")
    parser.add_argument("--skip-whisperx", action="store_true")
    parser.add_argument("--skip-pyannote", action="store_true")
    parser.add_argument("--workers", type=int, default=3,
                        help="הורדות מקביליות (ברירת מחדל: 3)")
    parser.add_argument("--reset", action="store_true",
                        help="אפס progress ותתחיל מחדש")
    args = parser.parse_args()

    hf_token = args.hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    if args.reset and PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
    progress = load_progress()

    print_header("🔽 הורדת מודלים — מקבילי + resume")

    if progress["completed"]:
        safe_print(f"  📋 כבר הורדו: {len(progress['completed'])} מודלים")
    if progress["failed"]:
        safe_print(f"  ⚠ נכשלו קודם (ינסה שוב): {len(progress['failed'])}")

    if args.models:
        model_keys = [m.strip() for m in args.models.split(",") if m.strip()]
    elif args.recommended:
        model_keys = RECOMMENDED_HEBREW
    else:
        model_keys = list(MODEL_REGISTRY.keys())

    safe_print(f"  🔢 {len(model_keys)} מודלי Whisper | {args.workers} workers מקביליים")

    total_t0 = time.time()
    results = {"downloaded": [], "skipped": [], "failed": []}

    # --- Phase 1: Whisper models (parallel) ---
    print_header(f"שלב 1: מודלי Whisper ({args.workers} מקביליים)")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for key in model_keys:
            model_id = MODEL_REGISTRY.get(key)
            if not model_id:
                print_fail(f"מודל לא מוכר: {key}")
                continue
            fut = pool.submit(download_one_whisper, key, model_id, progress)
            futures[fut] = key

        for fut in as_completed(futures):
            key, success, elapsed, skipped = fut.result()
            if skipped:
                results["skipped"].append(key)
                print_skip(f"{key} (כבר קיים)")
            elif success:
                results["downloaded"].append(key)
            else:
                results["failed"].append(key)

    # --- Phase 2: WhisperX alignment ---
    if not args.skip_whisperx:
        print_header("שלב 2: WhisperX alignment (עברית)")
        _, ok, _, skipped = download_whisperx_align(progress)
        bucket = "skipped" if skipped else ("downloaded" if ok else "failed")
        if skipped:
            print_skip("alignment עברית (כבר קיים)")
        results[bucket].append("align-he")

    # --- Phase 3: Pyannote ---
    if not args.skip_pyannote:
        print_header("שלב 3: pyannote (זיהוי דוברים)")
        if not hf_token:
            print_skip("אין HuggingFace token — דלג על pyannote")
            safe_print("  💡 הרץ עם --hf-token hf_xxx או הגדר HF_TOKEN")
        else:
            _, ok, _, skipped = download_pyannote(hf_token, progress)
            bucket = "skipped" if skipped else ("downloaded" if ok else "failed")
            if skipped:
                print_skip("pyannote (כבר קיים)")
            results[bucket].append("pyannote")

    # --- Phase 4: WhisperX diarization ---
    if not args.skip_whisperx and not args.skip_pyannote and hf_token:
        print_header("שלב 4: WhisperX diarization pipeline")
        _, ok, _, skipped = download_whisperx_diarize(hf_token, progress)
        bucket = "skipped" if skipped else ("downloaded" if ok else "failed")
        if skipped:
            print_skip("whisperx diarization (כבר קיים)")
        results[bucket].append("whisperx-diarize")

    # --- Summary ---
    total_elapsed = time.time() - total_t0
    print_header(f"סיכום — {total_elapsed:.0f} שניות")
    if results["downloaded"]:
        safe_print(f"  ✓ הורדו: {', '.join(results['downloaded'])}")
    if results["skipped"]:
        safe_print(f"  ⏭ דולגו (כבר קיימים): {', '.join(results['skipped'])}")
    if results["failed"]:
        safe_print(f"  ✗ נכשלו: {', '.join(results['failed'])}")
        safe_print("  💡 הרץ שוב — ימשיך מאותו מקום!")
    else:
        safe_print("  ✅ הכול מוכן לעבודה אופליין!")

    if not results["failed"] and PROGRESS_FILE.exists():
        safe_print(f"\n  🧹 מוחק progress file")
        PROGRESS_FILE.unlink()


if __name__ == "__main__":
    main()
