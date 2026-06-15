"""
Launcher Tray Service for Smart Hebrew Transcriber
System tray icon with right-click menu + Flask API on port 8764.

Features:
  - Color-coded icon: green=all running, yellow=partial, red=all off
  - Right-click menu: individual Start/Stop for CUDA, Ollama, Vite
  - "Start All" / "Stop All" shortcuts
  - Flask API on port 8764
  - Minimal resources (~20MB RAM, 0 GPU)

Usage:
    python server/launcher_tray.py
    pythonw server/launcher_tray.py   # no console window
"""

import os
import sys
import json
import subprocess
import threading
import time
import shutil
from pathlib import Path

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    print("Missing: pip install flask flask-cors")
    sys.exit(1)

try:
    import pystray
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Missing: pip install pystray Pillow")
    sys.exit(1)


# ─── Config ─────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WHISPER_SERVER_SCRIPT = PROJECT_ROOT / "server" / "transcribe_server.py"
WHISPER_PORT = 3000
VITE_PORT = 8080
LAUNCHER_PORT = 8764
TASK_NAME = "SmartTranscriberLauncher"
LOVABLE_URL = "https://a1add912-bd72-490b-949a-bf5fe8ed03b5.lovable.app"

# ─── State ──────────────────────────────────────────────
whisper_process     = None
vite_process        = None
cloudflare_process  = None
voice_hotkey_process = None
voice_cmd_process    = None
whisper_running      = False
ollama_running       = False
vite_running         = False
cloudflare_running   = False
voice_hotkey_running = False
voice_cmd_running    = False
cloudflare_url: str | None = None  # public trycloudflare.com URL

# ─── Cloudflare constants ─────────────────────────────────
CLOUDFLARED_EXE = Path(os.environ.get("LOCALAPPDATA", "")) / "cloudflared" / "cloudflared.exe"
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

VOICE_HOTKEY_SCRIPT  = PROJECT_ROOT / "server" / "voice_hotkey.py"
VOICE_CMD_SCRIPT     = PROJECT_ROOT / "tools" / "voice-command" / "voice_command_listener.py"


# ─── Helpers ────────────────────────────────────────────

def find_python():
    """Find the venv python executable."""
    for venv_dir in [".venv", "venv-whisper"]:
        p = PROJECT_ROOT / venv_dir / "Scripts" / "python.exe"
        if p.exists():
            return str(p)
    return None


def check_whisper():
    """Check if whisper server is responding."""
    import urllib.request
    try:
        req = urllib.request.Request(f"http://localhost:{WHISPER_PORT}/health", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return True, data
    except Exception:
        return False, None


def check_ollama():
    """Check if Ollama is responding."""
    import urllib.request
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return True, len(data.get("models", []))
    except Exception:
        return False, 0


def check_vite():
    """Check if Vite dev server is responding."""
    import urllib.request
    try:
        req = urllib.request.Request(f"http://localhost:{VITE_PORT}/", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            return True
    except Exception:
        return False


def start_ollama():
    """Start Ollama in background if available."""
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        return False, "not installed"
    running, _ = check_ollama()
    if running:
        return True, "already running"
    os.environ["OLLAMA_ORIGINS"] = "*"
    try:
        subprocess.Popen(
            [ollama_path, "serve"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "started"
    except Exception as e:
        return False, str(e)


def stop_ollama():
    """Stop Ollama."""
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        return False, "not installed"
    try:
        subprocess.run(
            ["taskkill", "/f", "/im", "ollama.exe"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "stopped"
    except Exception as e:
        return False, str(e)


def start_whisper():
    """Start CUDA whisper server."""
    global whisper_process
    running, data = check_whisper()
    if running:
        return True, "already running", data
    python_path = find_python()
    if not python_path:
        return False, "No venv found", None
    # Use server's built-in DEFAULT_MODEL (large-v3-turbo) — don't hardcode a model that may not exist
    cmd = [python_path, str(WHISPER_SERVER_SCRIPT), "--port", str(WHISPER_PORT)]
    try:
        whisper_process = subprocess.Popen(
            cmd, cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "starting", None
    except Exception as e:
        return False, str(e), None


def stop_whisper():
    """Stop the whisper server."""
    global whisper_process
    import urllib.request
    try:
        req = urllib.request.Request(f"http://localhost:{WHISPER_PORT}/shutdown", method="POST")
        urllib.request.urlopen(req, timeout=5)
        whisper_process = None
        return True, "shutdown sent"
    except Exception:
        pass
    if whisper_process and whisper_process.poll() is None:
        whisper_process.terminate()
        whisper_process = None
        return True, "terminated"
    return False, "no process"


def start_vite():
    """Start Vite dev server."""
    global vite_process
    if check_vite():
        return True, "already running"
    npx = shutil.which("npx")
    if not npx:
        return False, "npx not found"
    try:
        vite_process = subprocess.Popen(
            [npx, "vite", "--port", str(VITE_PORT)],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "started"
    except Exception as e:
        return False, str(e)


def stop_vite():
    """Stop the Vite dev server."""
    global vite_process
    if vite_process and vite_process.poll() is None:
        vite_process.terminate()
        vite_process = None
        return True, "terminated"
    # Fallback: kill node on vite port
    try:
        result = subprocess.run(
            ["powershell", "-Command", f"Get-NetTCPConnection -LocalPort {VITE_PORT} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return True, "port cleared"
    except Exception:
        return False, "no process"


def _download_cloudflared() -> bool:
    """Download cloudflared.exe if not present."""
    if CLOUDFLARED_EXE.exists():
        return True
    try:
        import urllib.request as ur
        CLOUDFLARED_EXE.parent.mkdir(parents=True, exist_ok=True)
        ur.urlretrieve(CLOUDFLARED_URL, str(CLOUDFLARED_EXE))
        print(f"  Cloudflared downloaded: {CLOUDFLARED_EXE}")
        return True
    except Exception as e:
        print(f"  Cloudflared download failed: {e}")
        return False


def start_cloudflare():
    """Start Cloudflare Tunnel → localhost:WHISPER_PORT."""
    global cloudflare_process, cloudflare_running, cloudflare_url
    if cloudflare_running:
        return True, "already running", cloudflare_url
    if not _download_cloudflared():
        return False, "cloudflared download failed", None
    try:
        import re
        cloudflare_process = subprocess.Popen(
            [str(CLOUDFLARED_EXE), "tunnel", "--url", f"http://localhost:{WHISPER_PORT}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        cloudflare_running = True
        cloudflare_url = None

        def _capture_url():
            global cloudflare_url
            for line in cloudflare_process.stdout:
                m = re.search(r'https://[\w-]+\.trycloudflare\.com', line)
                if m:
                    cloudflare_url = m.group(0)
                    print(f"  \u2601 Cloudflare Tunnel: {cloudflare_url}")
                    if _tray_icon:
                        _tray_icon.update_menu()
                    break
            # Process ended — update state
            global cloudflare_running
            cloudflare_running = False

        threading.Thread(target=_capture_url, daemon=True, name="cf-url-capture").start()
        return True, "starting", None
    except Exception as e:
        cloudflare_running = False
        return False, str(e), None


def stop_cloudflare():
    """Stop Cloudflare Tunnel."""
    global cloudflare_process, cloudflare_running, cloudflare_url
    if cloudflare_process and cloudflare_process.poll() is None:
        cloudflare_process.terminate()
    cloudflare_process = None
    cloudflare_running = False
    cloudflare_url = None
    return True, "stopped"


# ─── Voice Hotkey ────────────────────────────────────────

def check_voice_hotkey() -> bool:
    """Return True if voice_hotkey process is alive."""
    return voice_hotkey_process is not None and voice_hotkey_process.poll() is None


def start_voice_hotkey():
    """Start voice_hotkey.py (registers Ctrl+Shift+H global hotkey)."""
    global voice_hotkey_process, voice_hotkey_running
    if check_voice_hotkey():
        return True, "already running"
    python_path = find_python()
    if not python_path:
        return False, "No venv found"
    try:
        voice_hotkey_process = subprocess.Popen(
            [python_path, str(VOICE_HOTKEY_SCRIPT)],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        voice_hotkey_running = True
        return True, "started"
    except Exception as e:
        return False, str(e)


def stop_voice_hotkey():
    """Stop voice_hotkey process."""
    global voice_hotkey_process, voice_hotkey_running
    if voice_hotkey_process and voice_hotkey_process.poll() is None:
        voice_hotkey_process.terminate()
    voice_hotkey_process = None
    voice_hotkey_running = False
    return True, "stopped"


# ─── Voice Command Listener ──────────────────────────────

def check_voice_cmd() -> bool:
    """Return True if voice_command_listener process is alive."""
    return voice_cmd_process is not None and voice_cmd_process.poll() is None


def start_voice_cmd(wake_word: str = "ביג"):
    """Start voice_command_listener with wake word."""
    global voice_cmd_process, voice_cmd_running
    if check_voice_cmd():
        return True, "already running"
    python_path = find_python()
    if not python_path:
        return False, "No venv found"
    cmd = [python_path, str(VOICE_CMD_SCRIPT),
           "--wake-word", wake_word,
           "--model", "tiny",
           "--device", "cuda"]
    try:
        voice_cmd_process = subprocess.Popen(
            cmd, cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        voice_cmd_running = True
        return True, "started"
    except Exception as e:
        return False, str(e)


def stop_voice_cmd():
    """Stop voice_command_listener process."""
    global voice_cmd_process, voice_cmd_running
    if voice_cmd_process and voice_cmd_process.poll() is None:
        voice_cmd_process.terminate()
    voice_cmd_process = None
    voice_cmd_running = False
    return True, "stopped"


def check_cloudflare():
    """Check if cloudflare tunnel process is alive."""
    return cloudflare_running and cloudflare_process is not None and cloudflare_process.poll() is None


STARTUP_FOLDER = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_SHORTCUT = STARTUP_FOLDER / "SmartTranscriber.lnk"


def is_autostart_enabled():
    """Check if startup shortcut exists."""
    return STARTUP_SHORTCUT.exists()


def toggle_autostart():
    """Toggle Windows startup shortcut."""
    if is_autostart_enabled():
        # Remove shortcut
        try:
            STARTUP_SHORTCUT.unlink()
        except Exception:
            pass
        return False
    else:
        # Create shortcut via PowerShell
        pythonw = None
        for venv_dir in [".venv", "venv-whisper"]:
            p = PROJECT_ROOT / venv_dir / "Scripts" / "pythonw.exe"
            if p.exists():
                pythonw = str(p)
                break
        if not pythonw:
            pythonw = find_python()
        if not pythonw:
            return False

        tray_script = str(PROJECT_ROOT / "server" / "launcher_tray.py")
        ps_cmd = f'''
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("{STARTUP_SHORTCUT}")
$sc.TargetPath = "{pythonw}"
$sc.Arguments = '"{tray_script}"'
$sc.WorkingDirectory = "{PROJECT_ROOT}"
$sc.Description = "Smart Hebrew Transcriber"
$sc.Save()
'''
        try:
            subprocess.run(
                ["powershell", "-Command", ps_cmd],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            return True
        except Exception:
            return False


# ─── Tray Icon ──────────────────────────────────────────

def create_icon_image(cuda_on=False, ollama_on=False, vite_on=False, cf_on=False,
                      hotkey_on=False, vcmd_on=False):
    """Create icon with 6 colored dots for each service status."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle
    running_count = sum([cuda_on, ollama_on, vite_on, cf_on, hotkey_on, vcmd_on])
    total = 6
    if running_count >= total - 1:
        bg = (76, 175, 80, 255)    # green — most running
    elif running_count > 0:
        bg = (255, 193, 7, 255)    # yellow — partial
    else:
        bg = (244, 67, 54, 255)    # red — all off

    draw.ellipse([2, 2, size - 2, size - 2], fill=bg)

    # "T" letter
    draw.text((size // 2 - 6, 6), "T", fill=(255, 255, 255, 255))

    # 6 small status dots at bottom — green=on, red=off
    dot_y = size - 12
    dot_r = 4
    # evenly spaced across 64px: start=5, step=10
    xs = [5, 15, 25, 35, 45, 55]
    dots = list(zip(xs, [dot_y]*6,
                    [cuda_on, ollama_on, vite_on, cf_on, hotkey_on, vcmd_on]))
    for cx, cy, on in dots:
        color = (0, 220, 0, 255) if on else (220, 0, 0, 255)
        draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=color)
        draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], outline=(255, 255, 255, 180))

    return img


_tray_icon = None


def refresh_status():
    """Update all service statuses and refresh icon."""
    global whisper_running, ollama_running, vite_running, cloudflare_running
    global voice_hotkey_running, voice_cmd_running
    whisper_running, _ = check_whisper()
    ollama_running, _ = check_ollama()
    vite_running = check_vite()
    cloudflare_running = check_cloudflare()
    voice_hotkey_running = check_voice_hotkey()
    voice_cmd_running = check_voice_cmd()
    if _tray_icon:
        _tray_icon.icon = create_icon_image(
            whisper_running, ollama_running, vite_running, cloudflare_running,
            voice_hotkey_running, voice_cmd_running)
        running_count = sum([whisper_running, ollama_running, vite_running,
                             cloudflare_running, voice_hotkey_running, voice_cmd_running])
        parts = [
            f"CUDA: {'ON' if whisper_running else 'OFF'}",
            f"Ollama: {'ON' if ollama_running else 'OFF'}",
            f"Vite: {'ON' if vite_running else 'OFF'}",
            f"CF: {'ON' if cloudflare_running else 'OFF'}",
            f"Hotkey: {'ON' if voice_hotkey_running else 'OFF'}",
            f"VCmd: {'ON' if voice_cmd_running else 'OFF'}",
        ]
        _tray_icon.title = f"Smart Transcriber ({running_count}/6) — {' | '.join(parts)}"
        _tray_icon.update_menu()


# ─── Menu Actions ───────────────────────────────────────

def on_start_all(icon, item):
    start_ollama()
    start_whisper()
    start_vite()
    start_cloudflare()
    start_voice_hotkey()
    start_voice_cmd()
    time.sleep(2)
    refresh_status()

def on_stop_all(icon, item):
    stop_whisper()
    stop_ollama()
    stop_vite()
    stop_cloudflare()
    stop_voice_hotkey()
    stop_voice_cmd()
    time.sleep(1)
    refresh_status()

def on_toggle_cuda(icon, item):
    if whisper_running:
        stop_whisper()
    else:
        start_whisper()
    time.sleep(2)
    refresh_status()

def on_toggle_ollama(icon, item):
    if ollama_running:
        stop_ollama()
    else:
        start_ollama()
    time.sleep(2)
    refresh_status()

def on_toggle_vite(icon, item):
    if vite_running:
        stop_vite()
    else:
        start_vite()
    time.sleep(2)
    refresh_status()

def on_toggle_voice_hotkey(icon, item):
    if voice_hotkey_running:
        stop_voice_hotkey()
    else:
        start_voice_hotkey()
    time.sleep(1)
    refresh_status()

def on_toggle_voice_cmd(icon, item):
    if voice_cmd_running:
        stop_voice_cmd()
    else:
        start_voice_cmd()
    time.sleep(1)
    refresh_status()

def voice_hotkey_checked(item):
    return voice_hotkey_running

def voice_cmd_checked(item):
    return voice_cmd_running

def voice_hotkey_label(item):
    return f"🎙 Voice Hotkey (Ctrl+Shift+H)"

def voice_cmd_label(item):
    return f"🔔 Voice Command (wake: ביג)"

def on_open_lovable(icon, item):
    os.startfile(LOVABLE_URL)

def on_open_local(icon, item):
    os.startfile(f"http://localhost:{VITE_PORT}")

def on_open_tunnel(icon, item):
    if cloudflare_url:
        os.startfile(cloudflare_url)

def on_copy_tunnel(icon, item):
    import subprocess
    if cloudflare_url:
        subprocess.run(["powershell", "-Command", f'Set-Clipboard "{cloudflare_url}"'],
                       capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)

def on_toggle_cloudflare(icon, item):
    if cloudflare_running:
        stop_cloudflare()
    else:
        start_cloudflare()
    time.sleep(1)
    refresh_status()

def on_toggle_autostart(icon, item):
    toggle_autostart()

def on_quit(icon, item):
    icon.stop()

def cuda_checked(item):
    return whisper_running

def ollama_checked(item):
    return ollama_running

def vite_checked(item):
    return vite_running

def cloudflare_checked(item):
    return cloudflare_running

def autostart_checked(item):
    return is_autostart_enabled()

def cuda_label(item):
    return f"CUDA server (:{WHISPER_PORT})"

def ollama_label(item):
    return f"Ollama (:{11434})"

def vite_label(item):
    return f"Vite Dev (:{VITE_PORT})"

def cloudflare_label(item):
    if cloudflare_url:
        short = cloudflare_url.replace('https://', '')[:30]
        return f"\u2601 Tunnel ({short})"
    return "\u2601 Cloudflare Tunnel"


def build_menu():
    return pystray.Menu(
        pystray.MenuItem("Start All", on_start_all),
        pystray.MenuItem("Stop All", on_stop_all),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("── Transcription ──", None, enabled=False),
        pystray.MenuItem(cuda_label, on_toggle_cuda, checked=cuda_checked),
        pystray.MenuItem(ollama_label, on_toggle_ollama, checked=ollama_checked),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("── Voice ──", None, enabled=False),
        pystray.MenuItem(voice_hotkey_label, on_toggle_voice_hotkey, checked=voice_hotkey_checked),
        pystray.MenuItem(voice_cmd_label, on_toggle_voice_cmd, checked=voice_cmd_checked),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("── Frontend ──", None, enabled=False),
        pystray.MenuItem(vite_label, on_toggle_vite, checked=vite_checked),
        pystray.MenuItem(cloudflare_label, on_toggle_cloudflare, checked=cloudflare_checked),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Open localhost", on_open_local),
        pystray.MenuItem("Open Lovable", on_open_lovable),
        pystray.MenuItem("Copy Tunnel URL", on_copy_tunnel),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Auto-start with Windows", on_toggle_autostart, checked=autostart_checked),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Exit", on_quit),
    )


def status_updater(icon):
    """Background thread: update icon every 5 seconds."""
    # Do first check immediately
    try:
        refresh_status()
    except Exception:
        pass
    while icon.visible:
        try:
            refresh_status()
        except Exception:
            pass
        time.sleep(5)


# ─── Flask API ──────────────────────────────────────────

app = Flask(__name__)

# Register our PNA handler BEFORE CORS(app) so it runs AFTER flask-cors
# (Flask calls after_request in reverse registration order)
@app.after_request
def add_private_network_headers(response):
    """Allow Chrome Private Network Access (PNA) so Lovable HTTPS can reach localhost."""
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

CORS(app)


@app.route("/health", methods=["GET"])
def health():
    w_ok, w_data = check_whisper()
    o_ok, o_models = check_ollama()
    v_ok = check_vite()
    return jsonify({
        "status": "ok",
        "launcher": True,
        "tray": True,
        "whisper": {"running": w_ok, "port": WHISPER_PORT, "gpu": w_data.get("gpu") if w_data else None},
        "ollama": {"running": o_ok, "models": o_models},
        "vite": {"running": v_ok, "port": VITE_PORT},
    })


@app.route("/start", methods=["POST"])
def api_start():
    target = request.json.get("target", "all") if request.is_json else "all"
    results = {}
    if target in ("all", "ollama"):
        ok_o, msg_o = start_ollama()
        results["ollama"] = {"ok": ok_o, "message": msg_o}
    if target in ("all", "whisper", "cuda"):
        ok_w, msg_w, data_w = start_whisper()
        results["whisper"] = {"ok": ok_w, "message": msg_w}
        if data_w:
            results["whisper"]["gpu"] = data_w.get("gpu")
    if target in ("all", "vite"):
        ok_v, msg_v = start_vite()
        results["vite"] = {"ok": ok_v, "message": msg_v}
    if target in ("cloudflare", "tunnel"):
        ok_cf, msg_cf, url_cf = start_cloudflare()
        results["cloudflare"] = {"ok": ok_cf, "message": msg_cf, "url": url_cf}
    return jsonify({"ok": True, "results": results})


@app.route("/stop", methods=["POST"])
def api_stop():
    target = request.json.get("target", "all") if request.is_json else "all"
    results = {}
    if target in ("all", "whisper", "cuda"):
        ok, msg = stop_whisper()
        results["whisper"] = {"ok": ok, "message": msg}
    if target in ("all", "ollama"):
        ok, msg = stop_ollama()
        results["ollama"] = {"ok": ok, "message": msg}
    if target in ("all", "vite"):
        ok, msg = stop_vite()
        results["vite"] = {"ok": ok, "message": msg}
    if target in ("all", "cloudflare", "tunnel"):
        ok, msg = stop_cloudflare()
        results["cloudflare"] = {"ok": ok, "message": msg}
    return jsonify({"ok": True, "results": results})


@app.route("/tunnel", methods=["GET"])
def api_tunnel():
    """Return current Cloudflare Tunnel status and URL."""
    return jsonify({
        "running": cloudflare_running,
        "url": cloudflare_url,
        "installed": CLOUDFLARED_EXE.exists(),
    })


@app.route("/status", methods=["GET"])
def api_status():
    w_ok, w_data = check_whisper()
    o_ok, o_models = check_ollama()
    v_ok = check_vite()
    return jsonify({
        "whisper": {"running": w_ok, "data": w_data,
                     "process_alive": whisper_process is not None and whisper_process.poll() is None if whisper_process else False},
        "ollama": {"running": o_ok, "models": o_models},
        "vite": {"running": v_ok, "port": VITE_PORT},
    })


def is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return False
        except OSError:
            return True


def run_flask():
    """Run Flask in a background thread."""
    app.run(host="127.0.0.1", port=LAUNCHER_PORT, debug=False, use_reloader=False)


# ─── Main ───────────────────────────────────────────────

def main():
    global _tray_icon

    # Prevent duplicate instances
    if is_port_in_use(LAUNCHER_PORT):
        print(f"Port {LAUNCHER_PORT} already in use — another launcher is running. Exiting.")
        sys.exit(0)

    print(f"Starting Smart Transcriber Tray (API on port {LAUNCHER_PORT})...")

    # Start Flask in background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Auto-boot essential services (CUDA + Ollama only)
    # Others can be started manually from the tray menu
    global whisper_running, ollama_running, vite_running, cloudflare_running
    global voice_hotkey_running, voice_cmd_running
    whisper_running, _ = check_whisper()
    ollama_running, _ = check_ollama()
    if not whisper_running:
        start_whisper()
    if not ollama_running:
        start_ollama()
    # Just check status for the rest (don't auto-start)
    vite_running = check_vite()
    cloudflare_running = check_cloudflare()
    voice_hotkey_running = check_voice_hotkey()
    voice_cmd_running = check_voice_cmd()

    # Create tray icon with actual status
    running_total = sum([whisper_running, ollama_running, vite_running,
                         cloudflare_running, voice_hotkey_running, voice_cmd_running])
    _tray_icon = pystray.Icon(
        "smart_transcriber",
        create_icon_image(whisper_running, ollama_running, vite_running, cloudflare_running,
                         voice_hotkey_running, voice_cmd_running),
        f"Smart Transcriber ({running_total}/6)",
        menu=build_menu(),
    )

    # Start status updater
    updater = threading.Thread(target=status_updater, args=(_tray_icon,), daemon=True)
    updater.start()

    # Run tray (blocks)
    _tray_icon.run()


if __name__ == "__main__":
    main()
