"""Transcription benchmark — tests speed and quality on test audio files."""
import requests
import time
import difflib
import sys

SERVER = "http://localhost:8765"

files = [
    ("hebrew_short.wav", 3.864),
    ("hebrew_medium.wav", 17.136),
    ("hebrew_long.wav", 36.48),
]

# Check server
try:
    h = requests.get(f"{SERVER}/health", timeout=5).json()
    model = h.get("current_model", "?")
    gpu = h.get("gpu", "?")
    ready = h.get("model_ready", False)
    print(f"Server: {h.get('status')} | Model: {model} | GPU: {gpu} | Ready: {ready}")
    if not ready:
        print("ERROR: Model not loaded. Load it first.")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: Server not reachable: {e}")
    sys.exit(1)

print("=" * 70)
print(f"  TRANSCRIPTION BENCHMARK — {model} ({gpu})")
print("=" * 70)

total_audio = 0
total_proc = 0

for fname, dur in files:
    wav = f"e2e/fixtures/{fname}"
    expected_file = wav.replace(".wav", ".expected.txt")
    with open(expected_file, encoding="utf-8") as f:
        expected = f.read().strip()

    start = time.time()
    with open(wav, "rb") as f:
        resp = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (fname, f, "audio/wav")},
            data={"language": "he", "beam_size": "5"},
            timeout=120,
        )
    elapsed = time.time() - start

    if resp.status_code != 200:
        print(f"\n  ERROR {fname}: {resp.status_code} {resp.text[:200]}")
        continue

    data = resp.json()
    result_text = data.get("text", "").strip()
    proc_time = data.get("processing_time", elapsed)
    audio_dur = data.get("duration", dur)
    word_count = len(data.get("wordTimings", []))

    total_audio += audio_dur
    total_proc += proc_time

    # Speed
    speed_x = audio_dur / proc_time if proc_time > 0 else 0

    # Quality — word-level
    expected_words = expected.split()
    result_words = result_text.split()
    sm = difflib.SequenceMatcher(None, expected_words, result_words)
    word_accuracy = sm.ratio() * 100

    # Quality — char-level
    sm2 = difflib.SequenceMatcher(None, expected, result_text)
    char_accuracy = sm2.ratio() * 100

    print(f"\n  [{fname}] ({audio_dur:.1f}s audio)")
    print(f"    Processing time : {proc_time:.2f}s")
    print(f"    Speed           : {speed_x:.1f}x real-time")
    print(f"    Word accuracy   : {word_accuracy:.1f}%")
    print(f"    Char accuracy   : {char_accuracy:.1f}%")
    print(f"    Words detected  : {word_count}")

    r_display = result_text[:130] + "..." if len(result_text) > 130 else result_text
    e_display = expected[:130] + "..." if len(expected) > 130 else expected
    print(f"    Result  : {r_display}")
    print(f"    Expected: {e_display}")

    # Show word diffs
    if word_accuracy < 100:
        diffs = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "replace":
                diffs.append(f'"{" ".join(expected_words[i1:i2])}" -> "{" ".join(result_words[j1:j2])}"')
            elif tag == "delete":
                diffs.append(f'-"{" ".join(expected_words[i1:i2])}"')
            elif tag == "insert":
                diffs.append(f'+"{" ".join(result_words[j1:j2])}"')
        if diffs:
            print(f"    Diffs   : {' | '.join(diffs[:10])}")

# Summary
if total_proc > 0:
    print("\n" + "=" * 70)
    avg_speed = total_audio / total_proc
    print(f"  SUMMARY: {total_audio:.1f}s audio processed in {total_proc:.2f}s")
    print(f"  Average speed: {avg_speed:.1f}x real-time")
    print("=" * 70)
