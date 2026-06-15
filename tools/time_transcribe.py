"""Quick latency benchmark for /transcribe endpoint (adaptive afftdn path)."""
import requests, time, shutil, os, tempfile

CASES = [
    ("clean",       "tools/hard_clean.wav"),
    ("heavy -12dB", "tools/hard_heavy.wav"),
]

for label, src in CASES:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        shutil.copy(src, tmp.name)
        tmp_path = tmp.name

    t = time.perf_counter()
    with open(tmp_path, "rb") as f:
        r = requests.post(
            "http://localhost:3000/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"language": "he", "beam_size": "5", "normalize": "1"},
            timeout=120,
        )
    elapsed = time.perf_counter() - t
    os.unlink(tmp_path)

    j = r.json()
    text = j.get("text", "")[:90]
    cached = j.get("cached", False)
    print(f"[{label}]  {elapsed:.2f}s  cached={cached}")
    print(f"  {text}")
    print()
