"""
Hebrew Transcription Comparison Tool
Sends the same audio file to all system presets and compares results.

Usage: python tools/compare_transcription.py [audio_file]
       Defaults to e2e/fixtures/hebrew_medium.wav
"""

import sys
import time
import json
import requests
import difflib
from pathlib import Path

SERVER = "http://localhost:3000"
AUDIO_FILE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("e2e/fixtures/hebrew_medium.wav")

TESTS = [
    # (label, endpoint, extra_form_params)
    ("fast   [/transcribe-stream]",   "stream", {"preset": "fast"}),
    ("balanced [/transcribe-stream]", "stream", {"preset": "balanced"}),
    ("accurate [/transcribe-stream]", "stream", {"preset": "accurate"}),
    ("direct  [/transcribe beam=3]",  "plain",  {"beam_size": "3"}),
    ("direct  [/transcribe beam=5]",  "plain",  {"beam_size": "5"}),
]

SEP = "─" * 72

def run_plain(extra):
    """Call /transcribe (non-streaming)."""
    with open(AUDIO_FILE, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (AUDIO_FILE.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1", **extra},
            timeout=120,
        )
    elapsed = time.time() - t0
    r.raise_for_status()
    data = r.json()
    return data.get("text", ""), elapsed, data

def run_stream(extra):
    """Call /transcribe-stream (SSE) and collect full text."""
    with open(AUDIO_FILE, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe-stream",
            files={"file": (AUDIO_FILE.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1", **extra},
            stream=True,
            timeout=120,
        )
    r.raise_for_status()
    segments = []
    for line in r.iter_lines():
        if not line:
            continue
        if line.startswith(b"data: "):
            raw = line[6:]
            try:
                obj = json.loads(raw)
                if "text" in obj and obj.get("type") != "done":
                    segments.append(obj["text"].strip())
                if obj.get("type") == "done":
                    break
            except json.JSONDecodeError:
                pass
    elapsed = time.time() - t0
    return " ".join(segments), elapsed, {}

def word_diff(a: str, b: str) -> str:
    a_words = a.split()
    b_words = b.split()
    matcher = difflib.SequenceMatcher(None, a_words, b_words)
    ratio = matcher.ratio()
    return f"{ratio * 100:.0f}% similarity"

def word_count(text: str) -> int:
    return len(text.split()) if text.strip() else 0

def run_all():
    print(f"\n{SEP}")
    print(f"  Hebrew Transcription Comparison")
    print(f"  File : {AUDIO_FILE.name}")
    print(f"  Model: ivrit-ai/whisper-large-v3-turbo-ct2")
    print(SEP)

    results = []
    for label, endpoint, extra in TESTS:
        print(f"\n  ► {label} ...", end="", flush=True)
        try:
            if endpoint == "stream":
                text, elapsed, _ = run_stream(extra)
            else:
                text, elapsed, _ = run_plain(extra)
            results.append((label, text, elapsed))
            words = word_count(text)
            print(f"  ✓  {elapsed:.1f}s  |  {words} מילים")
        except Exception as e:
            results.append((label, f"[ERROR: {e}]", 0.0))
            print(f"  ✗  {e}")

    # ── Output ────────────────────────────────────────────────────
    print(f"\n{SEP}")
    print("  RESULTS — טקסט מלא")
    print(SEP)
    for label, text, elapsed in results:
        words = word_count(text)
        print(f"\n  [{label}]  {elapsed:.1f}s | {words} מילים")
        print(f"  {text}")

    # ── Similarity matrix ─────────────────────────────────────────
    print(f"\n{SEP}")
    print("  SIMILARITY — השוואה בין תוצאות")
    print(SEP)
    valid = [(l, t) for l, t, _ in results if not t.startswith("[ERROR")]
    for i in range(len(valid)):
        for j in range(i + 1, len(valid)):
            la, ta = valid[i]
            lb, tb = valid[j]
            sim = word_diff(ta, tb)
            la_short = la.split()[0]
            lb_short = lb.split()[0]
            print(f"  {la_short:10s} ↔ {lb_short:10s}  →  {sim}")

    # ── Word count summary ────────────────────────────────────────
    print(f"\n{SEP}")
    print("  SUMMARY — זמן עיבוד ומספר מילים")
    print(SEP)
    print(f"  {'Preset':<35} {'מילים':>6}  {'זמן':>6}")
    print(f"  {'-'*50}")
    for label, text, elapsed in results:
        words = word_count(text) if not text.startswith("[ERROR") else "-"
        t_str = f"{elapsed:.1f}s" if elapsed else "-"
        print(f"  {label:<35} {str(words):>6}  {t_str:>6}")
    print(SEP)

if __name__ == "__main__":
    run_all()
