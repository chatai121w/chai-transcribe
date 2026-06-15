"""
בדיקה מקיפה של שרת התמלול — מהירות, עומס, איכות
Comprehensive transcription test: Speed, Load, Quality

Tests:
  1. Single-file latency (upload → response) for each file size
  2. Speed metrics (RTF, x real-time, GPU vs wall time)
  3. Sequential burst (5 rapid requests) — stability check
  4. Concurrent load (3 parallel) — throughput under pressure
  5. System resource monitoring (VRAM, CPU-like timing)
  6. Quality analysis — word count consistency, Hebrew detection, word timestamps
  7. Compression effectiveness
  8. Error handling
  9. VRAM leak check over multiple runs
"""
import requests, time, os, sys, io, json, re, statistics
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://localhost:3000"
TEST_DIR = os.path.join(os.environ["TEMP"], "transcribe_test")

FILES = {
    "short":  ("test_short.mp3",  42.8,  "~7s"),
    "medium": ("test_medium.mp3", 117.8, "~20s"),
    "long":   ("test_long.mp3",   236.2, "~40s"),
}

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"

all_issues = []
all_results = {}

def sep(title):
    print(f"\n{'='*72}")
    print(f"  {title}")
    print(f"{'='*72}")

def health():
    return requests.get(f"{BASE}/health", timeout=5).json()

def transcribe(fname, beam=3, extra_headers=None):
    fpath = os.path.join(TEST_DIR, fname)
    headers = extra_headers or {}
    t0 = time.time()
    with open(fpath, "rb") as f:
        resp = requests.post(
            f"{BASE}/transcribe",
            files={"file": (fname, f, "audio/mpeg")},
            data={"language": "he", "beam_size": str(beam), "word_timestamps": "true"},
            headers=headers,
        )
    wall = time.time() - t0
    if resp.status_code == 200:
        d = resp.json()
        return {
            "ok": True, "wall": wall,
            "proc": d.get("processing_time", 0),
            "dur": d.get("duration", 0),
            "text": d.get("text", ""),
            "words": d.get("wordTimings", []),
            "segments": d.get("segments", []),
            "resp_bytes": len(resp.content),
            "encoding": resp.headers.get("Content-Encoding", "none"),
        }
    return {"ok": False, "wall": wall, "status": resp.status_code, "body": resp.text[:200]}

# ═══════════════════════════════════════════
#  STARTUP INFO
# ═══════════════════════════════════════════
print("\n" + "="*72)
print("  בדיקת שרת התמלול — מהירות, עומס, איכות")
print("  Transcription Server Test — Speed, Load, Quality")
print("="*72)

try:
    h = health()
except Exception as e:
    print(f"\n  ERROR: Server not responding at {BASE}")
    print(f"  {e}")
    sys.exit(1)

gm = h["gpu_memory"]
print(f"\n  Server:  {h['status']} | Uptime: {h['uptime_seconds']:.0f}s")
print(f"  GPU:     {h['gpu']}")
print(f"  VRAM:    {gm['allocated_mb']:.0f}MB / {gm['total_mb']:.0f}MB ({gm['utilization_pct']}%)")
print(f"  Model:   {h['current_model']}")
print(f"  Device:  {h['device']}")

# Verify test files
for key, (fname, expected_kb, label) in FILES.items():
    fpath = os.path.join(TEST_DIR, fname)
    if not os.path.exists(fpath):
        print(f"\n  MISSING: {fpath}")
        sys.exit(1)
    actual_kb = os.path.getsize(fpath) / 1024
    print(f"  File:    {fname} ({actual_kb:.1f}KB) — {label}")

# ═══════════════════════════════════════════
sep("TEST 1: Upload Latency & Speed (per file)")
# ═══════════════════════════════════════════
print("  Measuring end-to-end latency for each file size...\n")

speed_results = {}
for key, (fname, _, label) in FILES.items():
    fpath = os.path.join(TEST_DIR, fname)
    file_kb = os.path.getsize(fpath) / 1024

    r = transcribe(fname)
    if not r["ok"]:
        print(f"  [{label}] {FAIL} — status {r['status']}")
        all_issues.append(f"Transcription failed for {key}: {r['status']}")
        continue

    net_overhead = r["wall"] - r["proc"]
    speed_x = r["dur"] / r["proc"] if r["proc"] > 0 else 0
    rtf = r["proc"] / r["dur"] if r["dur"] > 0 else 0

    speed_results[key] = {
        "wall": r["wall"], "proc": r["proc"], "dur": r["dur"],
        "speed_x": speed_x, "rtf": rtf, "net_overhead": net_overhead,
        "file_kb": file_kb, "resp_bytes": r["resp_bytes"],
    }

    status = PASS if speed_x > 5 else (WARN if speed_x > 1 else FAIL)
    print(f"  [{label}] {fname} ({file_kb:.1f}KB)")
    print(f"    Audio duration:   {r['dur']:.1f}s")
    print(f"    GPU processing:   {r['proc']:.3f}s")
    print(f"    Wall time:        {r['wall']:.3f}s")
    print(f"    Network overhead: {net_overhead:.3f}s")
    print(f"    Speed:            {speed_x:.1f}x real-time  [{status}]")
    print(f"    RTF:              {rtf:.4f}")
    print(f"    Response size:    {r['resp_bytes']:,} bytes ({r['encoding']})")
    print()

all_results["speed"] = speed_results

# ═══════════════════════════════════════════
sep("TEST 2: Transcription Quality Analysis")
# ═══════════════════════════════════════════
print("  Analyzing transcription output quality...\n")

quality_results = {}
for key, (fname, _, label) in FILES.items():
    r = transcribe(fname)
    if not r["ok"]:
        print(f"  [{label}] {FAIL}")
        continue

    text = r["text"]
    words = r["words"]
    dur = r["dur"]

    # Quality metrics
    hebrew_chars = len(re.findall(r'[\u0590-\u05FF]', text))
    total_chars = len(text.strip())
    hebrew_ratio = hebrew_chars / total_chars if total_chars > 0 else 0

    word_count = len(text.split())
    words_per_sec = word_count / dur if dur > 0 else 0

    # Word timestamp analysis
    has_timestamps = len(words) > 0
    timestamp_coverage = 0
    timestamp_gaps = []
    if has_timestamps and len(words) > 1:
        # Check if timestamps cover the audio
        first_ts = words[0].get("start", 0)
        last_ts = words[-1].get("end", 0)
        timestamp_coverage = (last_ts - first_ts) / dur if dur > 0 else 0

        # Check for gaps > 5s between words
        for i in range(1, len(words)):
            gap = words[i].get("start", 0) - words[i-1].get("end", 0)
            if gap > 5:
                timestamp_gaps.append(gap)

    # Check for common quality issues
    issues = []
    if hebrew_ratio < 0.3:
        issues.append(f"Low Hebrew ratio: {hebrew_ratio:.0%}")
    if word_count < 2:
        issues.append(f"Very few words: {word_count}")
    if has_timestamps and timestamp_coverage < 0.5:
        issues.append(f"Low timestamp coverage: {timestamp_coverage:.0%}")
    if text.count("...") > 3:
        issues.append("Many ellipses (possible hallucination)")
    # Check for repetitive text (hallucination indicator)
    sentences = [s.strip() for s in re.split(r'[.!?،,]', text) if len(s.strip()) > 10]
    if len(sentences) > 2:
        unique = set(sentences)
        repeat_ratio = 1 - (len(unique) / len(sentences))
        if repeat_ratio > 0.4:
            issues.append(f"High repetition: {repeat_ratio:.0%}")

    quality_results[key] = {
        "text_len": total_chars, "word_count": word_count,
        "hebrew_ratio": hebrew_ratio, "words_per_sec": words_per_sec,
        "word_timestamps": len(words), "timestamp_coverage": timestamp_coverage,
        "issues": issues,
    }

    q_status = PASS if not issues else (WARN if len(issues) == 1 else FAIL)
    print(f"  [{label}] {q_status}")
    print(f"    Text length:       {total_chars} chars ({word_count} words)")
    print(f"    Hebrew content:    {hebrew_ratio:.0%} ({hebrew_chars} Hebrew chars)")
    print(f"    Words/sec:         {words_per_sec:.1f}")
    print(f"    Word timestamps:   {len(words)} words with timing")
    print(f"    Timestamp coverage:{timestamp_coverage:.0%} of audio")
    if timestamp_gaps:
        print(f"    Timestamp gaps:    {len(timestamp_gaps)} gaps >5s (max {max(timestamp_gaps):.1f}s)")
    if issues:
        for iss in issues:
            print(f"    Issue: {iss}")
    # Show text preview
    preview = text[:200].replace('\n', ' ')
    print(f"    Text preview:      {preview}")
    print()

all_results["quality"] = quality_results

# ═══════════════════════════════════════════
sep("TEST 3: Consistency Check (3 runs same file)")
# ═══════════════════════════════════════════
print("  Running same file 3 times to check output consistency...\n")

consistency_texts = []
consistency_times = []
fname = FILES["short"][0]
for i in range(3):
    r = transcribe(fname)
    if r["ok"]:
        consistency_texts.append(r["text"])
        consistency_times.append(r["proc"])
        print(f"    Run {i+1}: {r['proc']:.3f}s GPU, {len(r['text'])} chars")

if len(consistency_texts) >= 2:
    # Check text similarity (exact match or very similar)
    all_same = all(t == consistency_texts[0] for t in consistency_texts)
    if all_same:
        print(f"\n  Text consistency: {PASS} (identical across all runs)")
    else:
        # Check word-level overlap
        words_sets = [set(t.split()) for t in consistency_texts]
        common = words_sets[0]
        for ws in words_sets[1:]:
            common = common & ws
        all_words = words_sets[0]
        for ws in words_sets[1:]:
            all_words = all_words | ws
        overlap = len(common) / len(all_words) if all_words else 0
        print(f"\n  Text consistency: {WARN if overlap > 0.8 else FAIL} (word overlap: {overlap:.0%})")
        if not all_same:
            for i, t in enumerate(consistency_texts):
                print(f"    Run {i+1}: {t[:100]}")
            if overlap < 0.8:
                all_issues.append(f"Inconsistent transcription: {overlap:.0%} word overlap")

    time_std = statistics.stdev(consistency_times) if len(consistency_times) > 1 else 0
    print(f"  Speed consistency: avg={statistics.mean(consistency_times):.3f}s, stdev={time_std:.3f}s")

# ═══════════════════════════════════════════
sep("TEST 4: Sequential Burst (5 rapid requests)")
# ═══════════════════════════════════════════
print("  Sending 5 back-to-back requests...\n")

vram_before = health()["gpu_memory"]["allocated_mb"]
burst_times = []
burst_ok = 0
for i in range(5):
    r = transcribe(FILES["short"][0])
    burst_times.append(r["wall"])
    if r["ok"]:
        burst_ok += 1
    status_txt = PASS if r["ok"] else FAIL
    print(f"    Request {i+1}: wall={r['wall']:.3f}s  [{status_txt}]")

vram_after = health()["gpu_memory"]["allocated_mb"]
avg_burst = statistics.mean(burst_times)
spread = max(burst_times) - min(burst_times)

burst_status = PASS if burst_ok == 5 and spread < 2 else (WARN if burst_ok == 5 else FAIL)
print(f"\n  Success rate: {burst_ok}/5  [{burst_status}]")
print(f"  Average: {avg_burst:.3f}s  Min: {min(burst_times):.3f}s  Max: {max(burst_times):.3f}s")
print(f"  Spread: {spread:.3f}s")
print(f"  VRAM: {vram_before:.0f}MB → {vram_after:.0f}MB (delta: {vram_after-vram_before:+.0f}MB)")

if burst_ok < 5:
    all_issues.append(f"Burst: {5-burst_ok} failed requests")
if spread > 3:
    all_issues.append(f"Burst: high latency spread {spread:.1f}s")

all_results["burst"] = {"ok": burst_ok, "avg": avg_burst, "spread": spread}

# ═══════════════════════════════════════════
sep("TEST 5: Concurrent Load (3 parallel requests)")
# ═══════════════════════════════════════════
print("  Sending short + medium + long simultaneously...\n")

vram_before = health()["gpu_memory"]["allocated_mb"]
t0 = time.time()
conc_results = {}

with ThreadPoolExecutor(max_workers=3) as pool:
    futures = {}
    for key, (fname, _, label) in FILES.items():
        futures[pool.submit(transcribe, fname)] = (key, label)

    for future in as_completed(futures):
        key, label = futures[future]
        try:
            r = future.result()
            conc_results[key] = r
            s = PASS if r["ok"] else FAIL
            print(f"    [{label}] wall={r['wall']:.3f}s, GPU={r.get('proc',0):.3f}s  [{s}]")
        except Exception as e:
            conc_results[key] = {"ok": False}
            print(f"    [{label}] ERROR: {e}")

conc_total = time.time() - t0
vram_after = health()["gpu_memory"]["allocated_mb"]
seq_sum = sum(r.get("wall", 0) for r in conc_results.values())

conc_ok = sum(1 for r in conc_results.values() if r.get("ok"))
conc_status = PASS if conc_ok == 3 else (WARN if conc_ok >= 2 else FAIL)
print(f"\n  Concurrent wall time: {conc_total:.3f}s")
print(f"  Sequential equivalent: {seq_sum:.3f}s")
print(f"  Speedup: {seq_sum/conc_total:.1f}x  [{conc_status}]")
print(f"  Success rate: {conc_ok}/3")
print(f"  VRAM: {vram_before:.0f}MB → {vram_after:.0f}MB (delta: {vram_after-vram_before:+.0f}MB)")

if conc_ok < 3:
    all_issues.append(f"Concurrent: {3-conc_ok} failed under load")

all_results["concurrent"] = {"ok": conc_ok, "wall": conc_total, "seq": seq_sum}

# ═══════════════════════════════════════════
sep("TEST 6: Compression Effectiveness")
# ═══════════════════════════════════════════
print("  Comparing response sizes with different encodings...\n")

fname = FILES["medium"][0]
enc_results = {}
for enc in ["identity", "gzip", "br", "gzip, deflate, br"]:
    r = transcribe(fname, extra_headers={"Accept-Encoding": enc})
    if r["ok"]:
        enc_results[enc] = {"size": r["resp_bytes"], "encoding": r["encoding"]}
        print(f"    Accept: {enc:30s} → {r['encoding']:6s}  {r['resp_bytes']:>6,} bytes")

if "identity" in enc_results and "gzip, deflate, br" in enc_results:
    raw = enc_results["identity"]["size"]
    compressed = enc_results["gzip, deflate, br"]["size"]
    if raw > 0:
        ratio = (1 - compressed / raw) * 100
        c_status = PASS if ratio > 20 else WARN
        print(f"\n  Compression ratio: {ratio:.0f}% smaller  [{c_status}]")

# ═══════════════════════════════════════════
sep("TEST 7: Error Handling")
# ═══════════════════════════════════════════
print("  Testing server resilience to bad inputs...\n")

error_tests = [
    ("Empty file", {"file": ("empty.mp3", b"", "audio/mpeg")}),
    ("Text as audio", {"file": ("test.txt", b"hello world this is text not audio", "text/plain")}),
    ("Random bytes", {"file": ("noise.wav", os.urandom(500), "audio/wav")}),
]

error_ok = 0
for name, files_param in error_tests:
    resp = requests.post(f"{BASE}/transcribe", files=files_param, data={"language": "he"})
    # Should return 400, not 500 (no server crash)
    is_good = resp.status_code == 400
    error_ok += int(is_good)
    s = PASS if is_good else FAIL
    body_preview = resp.text[:80].replace('\n', ' ')
    print(f"    {name:20s}: status={resp.status_code}  [{s}]  {body_preview}")
    # Check no file paths leaked
    if "tmp" in resp.text.lower() or "temp" in resp.text.lower() or "\\Users\\" in resp.text:
        print(f"      {FAIL} Server leaks file paths in error response!")
        all_issues.append(f"Security: {name} leaks file paths")

# No file parameter
resp = requests.post(f"{BASE}/transcribe", data={"language": "he"})
is_good = resp.status_code == 400
error_ok += int(is_good)
s = PASS if is_good else FAIL
print(f"    {'No file param':20s}: status={resp.status_code}  [{s}]")

err_status = PASS if error_ok == 4 else FAIL
print(f"\n  Error handling: {error_ok}/4 correct  [{err_status}]")
if error_ok < 4:
    all_issues.append(f"Error handling: {4-error_ok} wrong status codes")

# ═══════════════════════════════════════════
sep("TEST 8: VRAM Stability (leak check)")
# ═══════════════════════════════════════════
print("  Running 5 transcriptions and monitoring VRAM...\n")

vram_readings = []
h = health()
vram_readings.append(h["gpu_memory"]["allocated_mb"])
print(f"  Baseline: {vram_readings[0]:.0f}MB")

for i in range(5):
    transcribe(FILES["long"][0])
    h = health()
    v = h["gpu_memory"]["allocated_mb"]
    vram_readings.append(v)
    delta = v - vram_readings[0]
    print(f"  Run {i+1}: {v:.0f}MB (delta: {delta:+.0f}MB)")

drift = vram_readings[-1] - vram_readings[0]
max_spike = max(vram_readings) - vram_readings[0]
v_status = PASS if abs(drift) < 50 else (WARN if abs(drift) < 200 else FAIL)
print(f"\n  Net drift: {drift:+.0f}MB  Max spike: {max_spike:+.0f}MB  [{v_status}]")
if abs(drift) >= 200:
    all_issues.append(f"VRAM leak: {drift:+.0f}MB drift after 5 runs")

all_results["vram"] = {"drift": drift, "max_spike": max_spike}

# ═══════════════════════════════════════════
sep("TEST 9: Health Endpoint Speed")
# ═══════════════════════════════════════════
print("  Measuring health endpoint response time...\n")

h_times = []
for i in range(20):
    t0 = time.time()
    requests.get(f"{BASE}/health", timeout=3)
    h_times.append(time.time() - t0)

avg_h = statistics.mean(h_times) * 1000
med_h = statistics.median(h_times) * 1000
p95_h = sorted(h_times)[int(len(h_times)*0.95)] * 1000
h_status = PASS if avg_h < 500 else (WARN if avg_h < 1000 else FAIL)
print(f"  20 requests: avg={avg_h:.0f}ms, median={med_h:.0f}ms, p95={p95_h:.0f}ms  [{h_status}]")

if avg_h > 1000:
    all_issues.append(f"Slow health endpoint: {avg_h:.0f}ms avg")

# ═══════════════════════════════════════════
sep("FINAL SUMMARY / סיכום")
# ═══════════════════════════════════════════

h = health()
gm = h["gpu_memory"]
print(f"  Server:   {h['status']} | Uptime: {h['uptime_seconds']:.0f}s")
print(f"  GPU:      {h['gpu']}")
print(f"  VRAM:     {gm['allocated_mb']:.0f}MB / {gm['total_mb']:.0f}MB ({gm['utilization_pct']}%)")
print(f"  Model:    {h['current_model']}")

print(f"\n  --- Speed ---")
if "speed" in all_results:
    for key in ["short", "medium", "long"]:
        if key in all_results["speed"]:
            s = all_results["speed"][key]
            print(f"    {key:8s}: {s['speed_x']:.1f}x real-time | GPU: {s['proc']:.3f}s | Wall: {s['wall']:.3f}s | Overhead: {s['net_overhead']:.3f}s")

print(f"\n  --- Quality ---")
if "quality" in all_results:
    for key in ["short", "medium", "long"]:
        if key in all_results["quality"]:
            q = all_results["quality"][key]
            issues_txt = ", ".join(q["issues"]) if q["issues"] else "OK"
            print(f"    {key:8s}: {q['word_count']} words | Hebrew: {q['hebrew_ratio']:.0%} | Timestamps: {q['word_timestamps']} | {issues_txt}")

print(f"\n  --- Load ---")
if "burst" in all_results:
    b = all_results["burst"]
    print(f"    Burst 5x: {b['ok']}/5 OK, avg={b['avg']:.3f}s, spread={b['spread']:.3f}s")
if "concurrent" in all_results:
    c = all_results["concurrent"]
    print(f"    Concurrent 3x: {c['ok']}/3 OK, wall={c['wall']:.3f}s (vs {c['seq']:.3f}s sequential)")

print(f"\n  --- Stability ---")
if "vram" in all_results:
    v = all_results["vram"]
    print(f"    VRAM drift: {v['drift']:+.0f}MB after 5 long transcriptions, max spike: {v['max_spike']:+.0f}MB")

print()
if all_issues:
    print(f"  ⚠ ISSUES FOUND ({len(all_issues)}):")
    for iss in all_issues:
        print(f"    - {iss}")
else:
    print(f"  ✓ ALL TESTS PASSED — Server is healthy, fast, and stable!")
print("="*72)
