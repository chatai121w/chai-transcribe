"""
Launcher Micro-Service for Smart Hebrew Transcriber
Tiny HTTP server on port 8764 that can start/check the CUDA whisper server.
Allows the Lovable website to start the server with a single button click.

Auto-start: Place shortcut in shell:startup (see install instructions below).

Usage:
    python server/launcher_service.py
    python server/launcher_service.py --port 8764
"""

import os
import sys
import json
import subprocess
import time
import signal
from pathlib import Path

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    print("Missing: pip install flask flask-cors")
    sys.exit(1)

app = Flask(__name__)


@app.after_request
def add_pna_header(response):
    """Allow Chrome Private Network Access (HTTPS → localhost).
    Registered BEFORE CORS so it runs AFTER flask-cors (Flask LIFO order)."""
    # Remove any 'false' value flask-cors might have added, then set 'true'
    while "Access-Control-Allow-Private-Network" in response.headers:
        del response.headers["Access-Control-Allow-Private-Network"]
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


CORS(app)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WHISPER_SERVER_SCRIPT = PROJECT_ROOT / "server" / "transcribe_server.py"
WHISPER_PORT = 3000
WHISPER_PROCESS = None


def find_python():
    """Find the venv python executable."""
    for venv_dir in [".venv", "venv-whisper"]:
        p = PROJECT_ROOT / venv_dir / "Scripts" / "python.exe"
        if p.exists():
            return str(p)
    return None


def is_whisper_running():
    """Check if whisper server is responding on its port."""
    import urllib.request
    try:
        req = urllib.request.Request(
            f"http://localhost:{WHISPER_PORT}/health",
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return True, data
    except Exception:
        return False, None


def is_ollama_running():
    """Check if Ollama is responding."""
    import urllib.request
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return True, len(data.get("models", []))
    except Exception:
        return False, 0


def start_ollama():
    """Start Ollama in background if available."""
    import shutil
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        return False, "Ollama not installed"

    running, _ = is_ollama_running()
    if running:
        return True, "already running"

    os.environ["OLLAMA_ORIGINS"] = "*"
    try:
        subprocess.Popen(
            [ollama_path, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "started"
    except Exception as e:
        return False, str(e)


@app.route("/health", methods=["GET"])
def health():
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        wf = ex.submit(is_whisper_running)
        of = ex.submit(is_ollama_running)
        whisper_ok, whisper_data = wf.result(timeout=4)
        ollama_ok, ollama_models = of.result(timeout=4)
    return jsonify({
        "status": "ok",
        "launcher": True,
        "whisper": {
            "running": whisper_ok,
            "port": WHISPER_PORT,
            "gpu": whisper_data.get("gpu") if whisper_data else None,
        },
        "ollama": {
            "running": ollama_ok,
            "models": ollama_models,
        },
    })


@app.route("/start", methods=["POST"])
def start_all():
    """Start CUDA whisper server (and Ollama if available).
    Responds immediately to avoid browser timeout (PNA preflight + AbortSignal).
    Heavy checks run in background thread."""
    import threading
    global WHISPER_PROCESS

    def _do_start():
        global WHISPER_PROCESS
        start_ollama()
        running, _ = is_whisper_running()
        if running:
            return
        python_path = find_python()
        if not python_path:
            return
        model = "ivrit-ai/whisper-large-v3-turbo-ct2"
        cmd = [python_path, str(WHISPER_SERVER_SCRIPT), "--port", str(WHISPER_PORT), "--model", model]
        try:
            WHISPER_PROCESS = subprocess.Popen(
                cmd, cwd=str(PROJECT_ROOT),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
        except Exception:
            pass

    # Fire and forget — respond instantly
    threading.Thread(target=_do_start, daemon=True).start()
    return jsonify({"ok": True, "results": {
        "whisper": {"ok": True, "message": "starting"},
        "ollama": {"ok": True, "message": "starting"},
    }})


@app.route("/stop", methods=["POST"])
def stop_whisper():
    """Stop the whisper server if we started it."""
    global WHISPER_PROCESS
    # Try to call whisper's own shutdown endpoint first
    import urllib.request
    try:
        req = urllib.request.Request(
            f"http://localhost:{WHISPER_PORT}/shutdown",
            method="POST"
        )
        urllib.request.urlopen(req, timeout=5)
        WHISPER_PROCESS = None
        return jsonify({"ok": True, "message": "shutdown sent"})
    except Exception:
        pass

    # Fallback: kill process
    if WHISPER_PROCESS and WHISPER_PROCESS.poll() is None:
        WHISPER_PROCESS.terminate()
        WHISPER_PROCESS = None
        return jsonify({"ok": True, "message": "terminated"})

    return jsonify({"ok": False, "message": "no process to stop"})


@app.route("/status", methods=["GET"])
def status():
    """Detailed status of all services."""
    whisper_ok, whisper_data = is_whisper_running()
    ollama_ok, ollama_models = is_ollama_running()

    return jsonify({
        "whisper": {
            "running": whisper_ok,
            "data": whisper_data,
            "process_alive": WHISPER_PROCESS is not None and WHISPER_PROCESS.poll() is None if WHISPER_PROCESS else False,
        },
        "ollama": {
            "running": ollama_ok,
            "models": ollama_models,
        },
    })


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Launcher micro-service")
    parser.add_argument("--port", type=int, default=8764)
    args = parser.parse_args()

    print(f"")
    print(f"========================================")
    print(f"  Launcher Service - port {args.port}")
    print(f"========================================")
    print(f"  POST /start  → Start CUDA server + Ollama")
    print(f"  POST /stop   → Stop CUDA server")
    print(f"  GET  /health → Service health check")
    print(f"  GET  /status → Detailed status")
    print(f"========================================")
    print(f"")

    # Use waitress with dual-stack so 'localhost' (::1) connects instantly
    try:
        from waitress import serve
        serve(app, listen=f'0.0.0.0:{args.port} [::1]:{args.port}', threads=4,
              channel_timeout=30, connection_limit=100)
    except ImportError:
        app.run(host="0.0.0.0", port=args.port, debug=False)
