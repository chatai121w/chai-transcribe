"""Quick transcription test with progress monitoring."""
import requests
import time
import json
import sys
import os

AUDIO_FILE = os.path.join(os.environ["TEMP"], "test_audio.mp3")
SERVER_URL = "http://localhost:8765/transcribe-stream"
OUTPUT_FILE = os.path.join(os.environ["TEMP"], "transcribe_result.txt")

if not os.path.exists(AUDIO_FILE):
    print(f"ERROR: {AUDIO_FILE} not found")
    sys.exit(1)

file_size = os.path.getsize(AUDIO_FILE)
print(f"File: {AUDIO_FILE}")
print(f"Size: {file_size / 1024 / 1024:.1f} MB")
print(f"Start: {time.strftime('%H:%M:%S')}")
print()

start = time.time()
seg_count = 0
last_time = 0
audio_duration = 0

try:
    with open(AUDIO_FILE, "rb") as f:
        resp = requests.post(
            SERVER_URL,
            files={"file": ("audio.mp3", f, "audio/mpeg")},
            data={"language": "he"},
            stream=True,
            timeout=1200,
        )

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            out.write(line + "\n")
            try:
                data = json.loads(line[6:])
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type") or data.get("event")

            if msg_type == "info":
                audio_duration = data.get("duration", 0)
                print(f"Audio duration: {audio_duration:.0f}s ({audio_duration/60:.1f} min)")
                print(f"Model: {data.get('model')}")
                print()

            elif msg_type == "segment":
                seg_count += 1
                end_t = data.get("end", 0)
                text = data.get("text", "")[:60]
                elapsed = time.time() - start
                pct = (end_t / audio_duration * 100) if audio_duration > 0 else 0
                if end_t - last_time >= 30 or seg_count <= 3:
                    print(f"  [{seg_count:>3}] {pct:5.1f}% | {end_t:>7.1f}s | {elapsed:>5.0f}s elapsed | {text}")
                    last_time = end_t

            elif msg_type == "done":
                elapsed = time.time() - start
                proc_time = data.get("processing_time", elapsed)
                rtf = data.get("rtf", 0)
                print()
                print("=" * 60)
                print(f"DONE!")
                print(f"  Audio duration : {data.get('duration',0):.0f}s ({data.get('duration',0)/60:.1f} min)")
                print(f"  Processing time: {proc_time:.1f}s")
                print(f"  Wall time      : {elapsed:.1f}s")
                print(f"  RTF            : {rtf}")
                print(f"  Segments       : {seg_count}")
                print(f"  File size      : {data.get('file_size',0)} bytes")
                print(f"  Beam size      : {data.get('beam_size')}")
                print("=" * 60)

except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)

print(f"\nOutput saved to: {OUTPUT_FILE}")
