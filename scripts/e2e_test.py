r"""
E2E Test — Start server, transcribe 2 files, report speed.
Usage: .venv\Scripts\python.exe scripts\e2e_test.py
"""
import os, sys, re, time, subprocess, signal, socket, json

SERVER = "http://localhost:3000"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV_PYTHON = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
SERVER_SCRIPT = os.path.join(PROJECT_ROOT, "server", "transcribe_server.py")
TEST_DIR = os.path.join(os.environ["TEMP"], "transcribe_test")

# Two test files: short + medium
TEST_FILES = [
    ("short",  "test_short.mp3"),
    ("medium", "test_medium.mp3"),
]

DIVIDER = "=" * 65
TIMEOUT_SERVER_START = 90  # seconds max to wait for server+model


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("localhost", port)) == 0


def wait_for_health(timeout: int) -> dict | None:
    """Wait until /health returns model_ready=true."""
    import requests
    start = time.time()
    last_status = ""
    while time.time() - start < timeout:
        try:
            r = requests.get(f"{SERVER}/health", timeout=3)
            data = r.json()
            status = data.get("status", "?")
            model_ready = data.get("model_ready", False)
            if model_ready:
                return data
            if status != last_status:
                print(f"  Server status: {status} (model_ready={model_ready})")
                last_status = status
        except Exception:
            pass
        time.sleep(2)
    return None


def transcribe(filepath: str, timeout: int = 120) -> dict:
    """Send file to /transcribe and return parsed response."""
    import requests
    fname = os.path.basename(filepath)
    fsize_kb = os.path.getsize(filepath) / 1024

    t0 = time.time()
    with open(filepath, "rb") as f:
        resp = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (fname, f, "audio/mpeg")},
            data={"language": "he", "beam_size": "3", "word_timestamps": "true"},
            timeout=timeout,
        )
    wall = time.time() - t0

    if resp.status_code != 200:
        return {"ok": False, "error": f"HTTP {resp.status_code}", "wall": wall}

    d = resp.json()
    text = d.get("text", "")
    duration = d.get("duration", 0)
    proc = d.get("processing_time", 0)
    words = d.get("wordTimings", [])

    heb_chars = len(re.findall(r"[\u0590-\u05FF]", text))
    total_chars = len(re.sub(r"\s", "", text))
    heb_ratio = (heb_chars / total_chars * 100) if total_chars else 0
    speed = duration / proc if proc > 0 else 0
    prob_avg = sum(w["probability"] for w in words) / len(words) if words else 0

    return {
        "ok": True,
        "text": text,
        "duration": duration,
        "processing_time": proc,
        "wall": wall,
        "speed": speed,
        "words": len(words),
        "heb_ratio": heb_ratio,
        "confidence": prob_avg,
        "fsize_kb": fsize_kb,
    }


def main():
    import requests  # verify requests available

    e2e_start = time.time()
    print()
    print(DIVIDER)
    print("  E2E Test — Smart Hebrew Transcriber")
    print("  בדיקת קצה לקצה — מתמלל עברי חכם")
    print(DIVIDER)
    print()

    # --- Step 1: Check/start server ---
    server_proc = None
    server_was_running = port_open(3000)

    if server_was_running:
        print("[1/3] Whisper server already running on :3000")
    else:
        print("[1/3] Starting Whisper server...")
        if not os.path.exists(VENV_PYTHON):
            print(f"  ERROR: {VENV_PYTHON} not found")
            sys.exit(1)
        if not os.path.exists(SERVER_SCRIPT):
            print(f"  ERROR: {SERVER_SCRIPT} not found")
            sys.exit(1)

        server_proc = subprocess.Popen(
            [VENV_PYTHON, SERVER_SCRIPT, "--port", "3000"],
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        print(f"  Server PID: {server_proc.pid}")

    # Wait for health
    print("  Waiting for model to load...")
    t_wait_start = time.time()
    health = wait_for_health(TIMEOUT_SERVER_START)
    t_wait = time.time() - t_wait_start

    if not health:
        print(f"  ERROR: Server did not become ready within {TIMEOUT_SERVER_START}s")
        if server_proc:
            server_proc.terminate()
        sys.exit(1)

    print(f"  Server ready in {t_wait:.1f}s")
    print(f"  Model: {health.get('current_model', '?')}")
    print(f"  GPU: {health.get('gpu', '?')}")
    vram = health.get("gpu_memory", {})
    if vram:
        print(f"  VRAM: {vram.get('allocated_mb', 0):.0f}MB / {vram.get('total_mb', 0):.0f}MB")
    print()

    # --- Step 2: Transcribe test files ---
    print("[2/3] Transcribing test files...")
    print()

    results = []
    all_pass = True

    for label, fname in TEST_FILES:
        fpath = os.path.join(TEST_DIR, fname)
        if not os.path.exists(fpath):
            print(f"  {label}: SKIP — file not found: {fpath}")
            results.append({"label": label, "ok": False, "error": "file not found"})
            all_pass = False
            continue

        print(f"  Transcribing: {label} ({fname})...")
        r = transcribe(fpath)
        results.append({"label": label, **r})

        if not r["ok"]:
            print(f"  {label}: FAILED — {r['error']}")
            all_pass = False
            continue

        # Determine pass/fail
        passed = r["heb_ratio"] > 50 and r["speed"] > 3 and r["words"] > 2
        status = "✅ PASS" if passed else "❌ FAIL"
        if not passed:
            all_pass = False

        print(f"  {label:8s} | {status}")
        print(f"           | Audio: {r['duration']:.1f}s | File: {r['fsize_kb']:.0f}KB")
        print(f"           | GPU time: {r['processing_time']:.2f}s | Wall: {r['wall']:.2f}s")
        print(f"           | Speed: {r['speed']:.1f}x realtime")
        print(f"           | Words: {r['words']} | Hebrew: {r['heb_ratio']:.0f}% | Confidence: {r['confidence']:.1%}")
        print(f"           | Text: {r['text'][:100]}")
        print()

    # --- Step 3: Summary ---
    e2e_total = time.time() - e2e_start
    print(DIVIDER)
    print("[3/3] Summary / סיכום")
    print(DIVIDER)
    print()

    passed_count = sum(1 for r in results if r.get("ok") and r.get("heb_ratio", 0) > 50)
    total_audio = sum(r.get("duration", 0) for r in results if r.get("ok"))
    total_gpu = sum(r.get("processing_time", 0) for r in results if r.get("ok"))
    total_wall = sum(r.get("wall", 0) for r in results if r.get("ok"))
    avg_speed = total_audio / total_gpu if total_gpu > 0 else 0
    avg_confidence = (
        sum(r.get("confidence", 0) for r in results if r.get("ok"))
        / max(1, sum(1 for r in results if r.get("ok")))
    )

    print(f"  Tests:        {passed_count}/{len(results)} passed")
    print(f"  Total audio:  {total_audio:.1f}s")
    print(f"  Total GPU:    {total_gpu:.2f}s")
    print(f"  Total wall:   {total_wall:.2f}s")
    print(f"  Avg speed:    {avg_speed:.1f}x realtime")
    print(f"  Avg conf:     {avg_confidence:.1%}")
    print(f"  E2E time:     {e2e_total:.1f}s (including server startup)")
    print()

    if all_pass:
        print("  🎉 ALL TESTS PASSED — הכל עבר בהצלחה!")
    else:
        print("  ⚠ SOME TESTS FAILED — יש כישלונות")

    print()
    print(DIVIDER)

    # Cleanup: if we started the server, shut it down
    if server_proc and not server_was_running:
        print("  Shutting down server we started...")
        try:
            requests.post(f"{SERVER}/shutdown", timeout=5)
        except Exception:
            server_proc.terminate()
        print("  Server stopped.")
        print()

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
