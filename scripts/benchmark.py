"""Transcription benchmark - test 3 Hebrew audio files against the CUDA Whisper server."""
import requests, time, os

base = "http://localhost:3000"
test_dir = os.path.join(os.environ["TEMP"], "transcribe_test")
files = ["test_short.mp3", "test_medium.mp3", "test_long.mp3"]
labels = ["קצר (~5s)", "בינוני (~15s)", "ארוך (~30s)"]

print("=" * 70)
print("  TRANSCRIPTION BENCHMARK - 3 Tests")
print("=" * 70)

h = requests.get(f"{base}/health").json()
gpu_mem = h["gpu_memory"]
print(f"  GPU: {h['gpu']}")
print(f"  VRAM: {gpu_mem['allocated_mb']:.0f}MB allocated / {gpu_mem['total_mb']:.0f}MB total")
print(f"  Model: {h['current_model']}")
print(f"  Model Ready: {h['model_ready']}")
print("=" * 70)

results = []

for i, (fname, label) in enumerate(zip(files, labels), 1):
    fpath = os.path.join(test_dir, fname)
    size_kb = os.path.getsize(fpath) / 1024

    print(f"\n--- Test {i}/3: {label} ({fname}, {size_kb:.1f}KB) ---")

    h_before = requests.get(f"{base}/health").json()
    vram_before = h_before["gpu_memory"]["allocated_mb"]

    wall_start = time.time()

    with open(fpath, "rb") as f:
        resp = requests.post(
            f"{base}/transcribe",
            files={"file": (fname, f, "audio/mpeg")},
            data={"language": "he", "beam_size": "3", "word_timestamps": "true"},
        )

    wall_time = time.time() - wall_start

    if resp.status_code == 200:
        data = resp.json()
        text = data.get("text", "")
        proc_time = data.get("processing_time", 0)
        audio_dur = data.get("duration", 0)
        words = len(data.get("wordTimings", []))
        rtf = proc_time / audio_dur if audio_dur > 0 else 0

        h_after = requests.get(f"{base}/health").json()
        vram_after = h_after["gpu_memory"]["allocated_mb"]

        tag = "faster" if rtf < 1 else "slower"
        speed_x = audio_dur / proc_time if proc_time > 0 else 0

        print(f"  Status: SUCCESS")
        print(f"  Audio Duration: {audio_dur:.1f}s")
        print(f"  Processing Time: {proc_time:.2f}s (server)")
        print(f"  Wall Time: {wall_time:.2f}s (including upload)")
        print(f"  RTF (Real-Time Factor): {rtf:.3f}x  ({tag} than real-time)")
        if proc_time > 0:
            print(f"  Speed: {speed_x:.1f}x real-time")
        print(f"  Words detected: {words}")
        print(f"  VRAM: {vram_before:.0f}MB -> {vram_after:.0f}MB")
        preview = text[:150] + "..." if len(text) > 150 else text
        print(f"  Text: {preview}")

        results.append({
            "test": label,
            "audio_duration": audio_dur,
            "processing_time": proc_time,
            "wall_time": wall_time,
            "rtf": rtf,
            "speed_x": speed_x,
            "words": words,
            "vram_mb": vram_after,
        })
    else:
        print(f"  Status: FAILED ({resp.status_code})")
        print(f"  Error: {resp.text[:200]}")
        results.append({"test": label, "status": "FAILED"})

# Summary
print("\n" + "=" * 70)
print("  SUMMARY")
print("=" * 70)
total_audio = sum(r.get("audio_duration", 0) for r in results)
total_proc = sum(r.get("processing_time", 0) for r in results)
total_wall = sum(r.get("wall_time", 0) for r in results)

print(f"  Total audio: {total_audio:.1f}s")
print(f"  Total processing: {total_proc:.2f}s")
print(f"  Total wall time: {total_wall:.2f}s")
if total_proc > 0:
    print(f"  Average speed: {total_audio / total_proc:.1f}x real-time")
    print(f"  Average RTF: {total_proc / total_audio:.3f}x")

hf = requests.get(f"{base}/health").json()
gm = hf["gpu_memory"]
print(f"  Final VRAM: {gm['allocated_mb']:.0f}MB / {gm['total_mb']:.0f}MB ({gm['utilization_pct']}%)")
print(f"  Server uptime: {hf['uptime_seconds'] / 3600:.1f}h")
print("=" * 70)
