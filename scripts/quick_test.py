"""Quick upload & transcription test — speed + quality."""
import os, re, time, requests

SERVER = "http://localhost:3000"
TEST_DIR = os.path.join(os.environ["TEMP"], "transcribe_test")
FILES = [
    ("short",  "test_short.mp3",  7.3),
    ("medium", "test_medium.mp3", 20.1),
    ("long",   "test_long.mp3",   40.3),
]

print("=" * 65)
print("  Upload & Transcription Test — העלאה ותמלול")
print("=" * 65)

# Check server
try:
    h = requests.get(f"{SERVER}/health", timeout=3).json()
    print(f"  Server: {h['status']} | Model: {h['current_model']} | GPU: {h['gpu']}")
    print(f"  VRAM: {h['gpu_memory']['allocated_mb']:.0f}MB / {h['gpu_memory']['total_mb']:.0f}MB")
    if not h.get("model_ready"):
        print("  WARNING: Model not loaded! Loading...")
        requests.post(f"{SERVER}/load-model", json={"model": h["current_model"], "compute_type": "float16"}, timeout=120)
        print("  Model loaded.")
except Exception as e:
    print(f"  Server ERROR: {e}")
    exit(1)

print()
all_ok = True

for name, fname, expected_dur in FILES:
    fpath = os.path.join(TEST_DIR, fname)
    if not os.path.exists(fpath):
        print(f"  {name}: SKIP (file not found)")
        continue

    fsize = os.path.getsize(fpath) / 1024

    # Upload & transcribe
    t0 = time.time()
    with open(fpath, "rb") as f:
        resp = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (fname, f, "audio/mpeg")},
            data={"language": "he", "beam_size": "3", "word_timestamps": "true"},
            timeout=60,
        )
    wall = time.time() - t0

    if resp.status_code != 200:
        print(f"  {name}: FAILED (HTTP {resp.status_code})")
        all_ok = False
        continue

    d = resp.json()
    text = d.get("text", "")
    duration = d.get("duration", 0)
    proc = d.get("processing_time", 0)
    words = d.get("wordTimings", [])

    # Hebrew ratio
    heb_chars = len(re.findall(r"[\u0590-\u05FF]", text))
    total_chars = len(re.sub(r"\s", "", text))
    heb_ratio = (heb_chars / total_chars * 100) if total_chars else 0

    speed = duration / proc if proc > 0 else 0
    prob_avg = sum(w["probability"] for w in words) / len(words) if words else 0

    status = "PASS" if (heb_ratio > 50 and speed > 5 and len(words) > 3) else "FAIL"
    if status == "FAIL":
        all_ok = False

    print(f"  {name:8s} | {status} | {fsize:.0f}KB | {duration:.1f}s audio")
    print(f"           | GPU: {proc:.2f}s | Wall: {wall:.2f}s | Speed: {speed:.1f}x realtime")
    print(f"           | Words: {len(words)} | Hebrew: {heb_ratio:.0f}% | Confidence: {prob_avg:.1%}")
    print(f"           | Text: {text[:100]}")
    print()

# Summary
print("=" * 65)
if all_ok:
    print("  RESULT: ALL PASSED ✓")
else:
    print("  RESULT: SOME FAILED ✗")
print("=" * 65)
