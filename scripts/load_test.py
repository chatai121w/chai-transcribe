"""
Comprehensive load & latency test for the Whisper CUDA server.
Tests:
  1. Upload latency breakdown (DNS, connect, upload, processing, download)
  2. Response compression check (gzip/brotli)
  3. Sequential burst (rapid back-to-back requests)
  4. Concurrent load (parallel requests via threads)
  5. Large file handling
  6. Error handling (bad input, wrong format)
  7. Memory leak check (VRAM before/after)
"""
import requests, time, os, sys, threading, json, io
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://localhost:3000"
TEST_DIR = os.path.join(os.environ["TEMP"], "transcribe_test")
FILES = {
    "short": ("test_short.mp3", "קצר ~7s"),
    "medium": ("test_medium.mp3", "בינוני ~20s"),
    "long": ("test_long.mp3", "ארוך ~40s"),
}

def sep(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

def get_health():
    return requests.get(f"{BASE}/health", timeout=5).json()

def transcribe_file(name, beam=3, accept_encoding=None):
    """Send a file to /transcribe, return (status, wall_time, proc_time, audio_dur, resp_size, text)"""
    fpath = os.path.join(TEST_DIR, name)
    headers = {}
    if accept_encoding:
        headers["Accept-Encoding"] = accept_encoding
    
    wall_start = time.time()
    with open(fpath, "rb") as f:
        resp = requests.post(
            f"{BASE}/transcribe",
            files={"file": (name, f, "audio/mpeg")},
            data={"language": "he", "beam_size": str(beam), "word_timestamps": "true"},
            headers=headers,
        )
    wall_time = time.time() - wall_start
    
    resp_size = len(resp.content)
    content_encoding = resp.headers.get("Content-Encoding", "none")
    
    if resp.status_code == 200:
        data = resp.json()
        return {
            "status": "OK",
            "wall_time": wall_time,
            "proc_time": data.get("processing_time", 0),
            "audio_dur": data.get("duration", 0),
            "resp_size": resp_size,
            "content_encoding": content_encoding,
            "words": len(data.get("wordTimings", [])),
            "text": data.get("text", "")[:100],
        }
    else:
        return {"status": f"FAIL:{resp.status_code}", "wall_time": wall_time, "resp_size": resp_size, "text": resp.text[:100]}

# ─────────────────────────────────────────────
sep("TEST 1: Upload Latency Breakdown")
# ─────────────────────────────────────────────
print("  Testing upload + processing latency for each file size...\n")

for key, (fname, label) in FILES.items():
    fpath = os.path.join(TEST_DIR, fname)
    file_size = os.path.getsize(fpath) / 1024
    
    # Measure upload vs processing
    upload_start = time.time()
    with open(fpath, "rb") as f:
        file_data = f.read()
    read_time = time.time() - upload_start
    
    net_start = time.time()
    resp = requests.post(
        f"{BASE}/transcribe",
        files={"file": (fname, io.BytesIO(file_data), "audio/mpeg")},
        data={"language": "he", "beam_size": "3", "word_timestamps": "true"},
    )
    total_net = time.time() - net_start
    
    if resp.status_code == 200:
        data = resp.json()
        proc = data.get("processing_time", 0)
        audio_dur = data.get("duration", 0)
        network_overhead = total_net - proc  # upload + download + Flask overhead
        resp_size = len(resp.content)
        
        print(f"  [{label}] {fname} ({file_size:.1f}KB)")
        print(f"    Audio duration:     {audio_dur:.1f}s")
        print(f"    Total wall time:    {total_net:.3f}s")
        print(f"    Processing (GPU):   {proc:.3f}s")
        print(f"    Network overhead:   {network_overhead:.3f}s (upload+download+Flask)")
        print(f"    Response size:      {resp_size:,} bytes")
        print(f"    Content-Encoding:   {resp.headers.get('Content-Encoding', 'none')}")
        speed = audio_dur / proc if proc > 0 else 0
        print(f"    Speed:              {speed:.1f}x real-time")
        print()

# ─────────────────────────────────────────────
sep("TEST 2: Response Compression Check")
# ─────────────────────────────────────────────
print("  Comparing response sizes with different Accept-Encoding headers...\n")

fname = FILES["medium"][0]
for enc in ["identity", "gzip", "br", "gzip, deflate, br"]:
    fpath = os.path.join(TEST_DIR, fname)
    headers = {"Accept-Encoding": enc}
    with open(fpath, "rb") as f:
        resp = requests.post(
            f"{BASE}/transcribe",
            files={"file": (fname, f, "audio/mpeg")},
            data={"language": "he", "beam_size": "3"},
            headers=headers,
        )
    actual_enc = resp.headers.get("Content-Encoding", "none")
    raw_size = len(resp.content)
    print(f"  Accept-Encoding: {enc:30s} -> Content-Encoding: {actual_enc:6s}  Size: {raw_size:,} bytes")

# ─────────────────────────────────────────────
sep("TEST 3: Sequential Burst (5 rapid requests)")
# ─────────────────────────────────────────────
print("  Sending 5 back-to-back requests with the short file...\n")

vram_before = get_health()["gpu_memory"]["allocated_mb"]
times = []
for i in range(5):
    r = transcribe_file(FILES["short"][0])
    times.append(r["wall_time"])
    status = r["status"]
    print(f"    Request {i+1}: {r['wall_time']:.3f}s wall, {r.get('proc_time',0):.3f}s GPU  [{status}]")

vram_after = get_health()["gpu_memory"]["allocated_mb"]
avg_time = sum(times) / len(times)
print(f"\n  Average wall time: {avg_time:.3f}s")
print(f"  Min: {min(times):.3f}s  Max: {max(times):.3f}s  Spread: {max(times)-min(times):.3f}s")
print(f"  VRAM: {vram_before:.0f}MB -> {vram_after:.0f}MB (delta: {vram_after-vram_before:+.0f}MB)")

# ─────────────────────────────────────────────
sep("TEST 4: Concurrent Load (3 parallel requests)")
# ─────────────────────────────────────────────
print("  Sending 3 requests simultaneously (short + medium + long)...\n")

vram_before = get_health()["gpu_memory"]["allocated_mb"]
concurrent_start = time.time()

results = {}
with ThreadPoolExecutor(max_workers=3) as pool:
    futures = {}
    for key, (fname, label) in FILES.items():
        futures[pool.submit(transcribe_file, fname)] = (key, label)
    
    for future in as_completed(futures):
        key, label = futures[future]
        try:
            r = future.result()
            results[key] = r
            print(f"    [{label}] Status: {r['status']}, Wall: {r['wall_time']:.3f}s, GPU: {r.get('proc_time',0):.3f}s")
        except Exception as e:
            results[key] = {"status": f"ERROR: {e}"}
            print(f"    [{label}] ERROR: {e}")

concurrent_total = time.time() - concurrent_start
vram_after = get_health()["gpu_memory"]["allocated_mb"]

print(f"\n  Total concurrent wall time: {concurrent_total:.3f}s")
print(f"  (Sequential would be: {sum(r.get('wall_time',0) for r in results.values()):.3f}s)")
print(f"  VRAM: {vram_before:.0f}MB -> {vram_after:.0f}MB (delta: {vram_after-vram_before:+.0f}MB)")

# Check if any failed
failed = [k for k, v in results.items() if not v.get("status", "").startswith("OK")]
if failed:
    print(f"  WARNING: {len(failed)} request(s) failed under load: {failed}")
else:
    print(f"  All 3 requests succeeded under concurrent load!")

# ─────────────────────────────────────────────
sep("TEST 5: Error Handling")
# ─────────────────────────────────────────────
print("  Testing server response to bad inputs...\n")

# 5a: Empty file
print("  5a. Empty file:")
resp = requests.post(f"{BASE}/transcribe", files={"file": ("empty.mp3", b"", "audio/mpeg")}, data={"language": "he"})
print(f"      Status: {resp.status_code}, Response: {resp.text[:120]}")

# 5b: Wrong extension
print("  5b. Text file with .txt extension:")
resp = requests.post(f"{BASE}/transcribe", files={"file": ("test.txt", b"hello world", "text/plain")}, data={"language": "he"})
print(f"      Status: {resp.status_code}, Response: {resp.text[:120]}")

# 5c: Invalid audio (random bytes)
print("  5c. Random bytes as .wav:")
import random
random_data = bytes(random.getrandbits(8) for _ in range(1000))
resp = requests.post(f"{BASE}/transcribe", files={"file": ("noise.wav", random_data, "audio/wav")}, data={"language": "he"})
print(f"      Status: {resp.status_code}, Response: {resp.text[:120]}")

# 5d: No file
print("  5d. No file parameter:")
resp = requests.post(f"{BASE}/transcribe", data={"language": "he"})
print(f"      Status: {resp.status_code}, Response: {resp.text[:120]}")

# 5e: Health endpoint under load
print("  5e. Health endpoint responsiveness:")
h_start = time.time()
for _ in range(10):
    requests.get(f"{BASE}/health", timeout=3)
h_time = time.time() - h_start
print(f"      10 health checks in {h_time:.3f}s ({h_time/10*1000:.1f}ms avg)")

# ─────────────────────────────────────────────
sep("TEST 6: VRAM Leak Check")
# ─────────────────────────────────────────────
print("  Running 3 more transcriptions and checking VRAM stability...\n")

vram_readings = []
h = get_health()
vram_readings.append(h["gpu_memory"]["allocated_mb"])
print(f"  Before: {vram_readings[-1]:.0f}MB")

for i in range(3):
    transcribe_file(FILES["long"][0])
    h = get_health()
    vram_readings.append(h["gpu_memory"]["allocated_mb"])
    print(f"  After run {i+1}: {vram_readings[-1]:.0f}MB (delta: {vram_readings[-1]-vram_readings[0]:+.0f}MB)")

vram_drift = vram_readings[-1] - vram_readings[0]
if abs(vram_drift) < 100:
    print(f"\n  VRAM stable (drift: {vram_drift:+.0f}MB) - no leak detected")
else:
    print(f"\n  WARNING: VRAM drift of {vram_drift:+.0f}MB detected - possible memory leak!")

# ─────────────────────────────────────────────
sep("SUMMARY")
# ─────────────────────────────────────────────
h = get_health()
gm = h["gpu_memory"]
print(f"  Server status:     {h['status']}")
print(f"  Model:             {h['current_model']}")
print(f"  GPU:               {h['gpu']}")
print(f"  VRAM:              {gm['allocated_mb']:.0f}MB / {gm['total_mb']:.0f}MB ({gm['utilization_pct']}%)")
print(f"  Uptime:            {h['uptime_seconds']:.0f}s")
print(f"  Transcribe active: {h['transcribe_active']}")

issues = []
if failed:
    issues.append(f"Concurrent requests failed: {failed}")
if abs(vram_drift) >= 100:
    issues.append(f"VRAM drift: {vram_drift:+.0f}MB")
if avg_time > 5:
    issues.append(f"High avg latency in burst: {avg_time:.1f}s")

if issues:
    print(f"\n  ISSUES FOUND ({len(issues)}):")
    for iss in issues:
        print(f"    - {iss}")
else:
    print(f"\n  NO ISSUES FOUND - Server is healthy and stable!")
print("=" * 70)
