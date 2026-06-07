"""
Smart Hebrew Transcriber - Local Whisper Server
Runs Whisper models locally with CUDA acceleration on your GPU.
Supports all HuggingFace Whisper models including ivrit-ai Hebrew-optimized models.
Returns word-level timestamps for audio sync.

Usage:
    python server/transcribe_server.py
    python server/transcribe_server.py --port 3000 --model ivrit-ai/whisper-large-v3-turbo
"""

import os
import sys
import json
import hashlib
import argparse
import tempfile
import time
import threading
import warnings
import logging
import traceback as _tb_module
from pathlib import Path
from collections import deque
from datetime import datetime, timezone

# Suppress PyTorch CUDA compatibility warnings for newer GPUs
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "")
warnings.filterwarnings("ignore", message=".*CUDA capability.*")
warnings.filterwarnings("ignore", message=".*cuda capability.*")

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Add NVIDIA cuBLAS DLL directory so CTranslate2 can find cublas64_12.dll
if sys.platform == "win32":
    _dll_dirs_added = []
    for _pkg in ('nvidia.cublas', 'nvidia.cusparse', 'nvidia.cusparselt'):
        try:
            _mod = __import__(_pkg, fromlist=[''])
            _dll_dir = str(Path(_mod.__path__[0]) / "bin")
            if Path(_dll_dir).is_dir():
                os.add_dll_directory(_dll_dir)
                # Also prepend to PATH so ctranslate2.dll can find cublas at runtime
                os.environ["PATH"] = _dll_dir + os.pathsep + os.environ.get("PATH", "")
                _dll_dirs_added.append(_dll_dir)
        except Exception:
            pass
    if _dll_dirs_added:
        print(f"  [DLL] Added {len(_dll_dirs_added)} NVIDIA DLL dirs to PATH + add_dll_directory")

try:
    import faster_whisper
    from flask import Flask, request, jsonify, Response
    from flask_cors import CORS
    from flask_compress import Compress
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install faster-whisper flask flask-cors flask-compress")
    sys.exit(1)

# torch is optional — only used for GPU info display
try:
    import torch
    _has_torch = True
except Exception:
    _has_torch = False

app = Flask(__name__)

# Must be registered BEFORE CORS(app) so it runs AFTER flask-cors
# (Flask calls after_request in reverse registration order)
@app.after_request
def _add_private_network_header(response):
    """Allow Chrome Private Network Access (PNA).
    Required for HTTPS pages (Lovable preview) to reach localhost:3000.
    Without this, Chrome 94+ blocks all requests from public sites to private networks.
    """
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

CORS(app, origins=[
    r"http://localhost:\d+",
    r"http://127\.0\.0\.1:\d+",
    r"https://.*\.lovable\.app",
    r"https://.*\.lovableproject\.com",
    r"https://.*\.trycloudflare\.com",
])
Compress(app)  # gzip/deflate all JSON responses (60-70% size reduction)

# ════════════════════════════════════════════════════════════════════
#  OPTIONAL API KEY + RATE LIMITING
# ════════════════════════════════════════════════════════════════════
# Set via --api-key flag or WHISPER_API_KEY env var.
# When set, every request must include header: X-API-Key: <key>
# Health/status endpoints are exempt so the frontend can detect the server.

_api_key: str | None = os.environ.get("WHISPER_API_KEY")

# Simple rate limiter — max requests per minute per IP
_rate_limit_max = 30  # transcription requests per minute
_rate_limit_window = 60  # seconds
_rate_limit_store: dict[str, list[float]] = {}  # ip → list of timestamps

def _check_rate_limit(ip: str) -> bool:
    """Return True if allowed, False if rate-limited."""
    now = time.time()
    timestamps = _rate_limit_store.get(ip, [])
    timestamps = [t for t in timestamps if now - t < _rate_limit_window]
    _rate_limit_store[ip] = timestamps
    if len(timestamps) >= _rate_limit_max:
        return False
    timestamps.append(now)
    return True

def _cleanup_rate_limit_store():
    """Periodically remove stale IP entries from rate limiter."""
    while True:
        time.sleep(3600)  # every hour
        try:
            now = time.time()
            stale = [ip for ip, ts in _rate_limit_store.items() if all(now - t > _rate_limit_window for t in ts)]
            for ip in stale:
                _rate_limit_store.pop(ip, None)
        except Exception:
            pass

threading.Thread(target=_cleanup_rate_limit_store, daemon=True, name="rate-limit-cleanup").start()

@app.before_request
def _auth_and_rate_limit():
    """Check API key (if configured) and rate limit on mutation endpoints."""
    # Exempt endpoints — always accessible for server discovery
    exempt = {"/health", "/status", "/models", "/presets", "/metrics"}
    if request.path in exempt or request.method == "OPTIONS":
        return None

    # Sensitive endpoints require API key even if global key is not set
    sensitive = {"/debug", "/diagnostics", "/shutdown"}
    if request.path in sensitive:
        if _api_key:
            provided = request.headers.get("X-API-Key", "")
            if provided != _api_key:
                return jsonify({"error": "Unauthorized"}), 401
        # When no API key configured, only allow from localhost
        elif request.remote_addr not in ("127.0.0.1", "::1", "localhost"):
            return jsonify({"error": "Unauthorized — sensitive endpoints are localhost-only"}), 403
        return None

    # API key check
    if _api_key:
        provided = request.headers.get("X-API-Key", "")
        if provided != _api_key:
            return jsonify({"error": "Invalid or missing API key", "hint": "Set X-API-Key header"}), 401

    # Rate limit on POST endpoints (transcription, model loading, etc.)
    if request.method == "POST":
        ip = request.remote_addr or "unknown"
        if not _check_rate_limit(ip):
            return jsonify({"error": "Rate limit exceeded", "limit": f"{_rate_limit_max} requests per {_rate_limit_window}s"}), 429

    return None

# Allowed audio/video file extensions for upload
_ALLOWED_SUFFIXES = frozenset({
    ".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac", ".aac", ".wma",
    ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".3gp",
})

def _safe_suffix(filename: str | None, default: str = ".webm") -> str:
    """Extract file suffix from filename, restricted to allowed extensions."""
    if not filename:
        return default
    suffix = Path(filename).suffix.lower()
    return suffix if suffix in _ALLOWED_SUFFIXES else default

# ════════════════════════════════════════════════════════════════════
#  DEBUG & MONITORING INFRASTRUCTURE
# ════════════════════════════════════════════════════════════════════

# Structured logger
_log = logging.getLogger("whisper-server")
_log.setLevel(logging.DEBUG)
_log_handler = logging.StreamHandler(sys.stdout)
_log_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"
))
_log.addHandler(_log_handler)

# Request history — keeps last 50 transcriptions for /debug endpoint
MAX_REQUEST_HISTORY = 50
_request_history: deque = deque(maxlen=MAX_REQUEST_HISTORY)

# Server start time
_server_start_time = time.time()

# ─── Loshon Kodesh (Ashkenazi torani Hebrew) ────────────────────────
# When the client passes `loshon_kodesh=1`, we override the default
# Hebrew prompt with a torani context and merge a curated hotwords list.
LOSHON_KODESH_PROMPT = (
    'שיעור תורה בלשון הקודש בהגייה אשכנזית. הקדוש ברוך הוא, רבי, גמרא, '
    'משנה, תוספות, רש"י, רמב"ם, הלכה, סוגיא, פסוק, פרשה, מסכת, דף, תורה, '
    'מצוה, ברכה, שבת, יום טוב, מקום, אבות, בני ישראל, תפילה, עבודה, '
    'גמילות חסדים, יראת שמים, אמונה, חסידות, מוסר, ישיבה.'
)
LOSHON_KODESH_HOTWORDS = (
    'הקדוש ברוך הוא, הקב"ה, השם יתברך, תורה, משנה, גמרא, תלמוד, בבלי, '
    'ירושלמי, תוספות, רש"י, רמב"ם, רמב"ן, שולחן ערוך, מסכת, פרק, דף, '
    'הלכה, אגדה, סוגיא, מצוה, ברכה, תפילה, יראת שמים, אמונה, חסידות, '
    'מוסר, תשובה, גמילות חסדים, קדושה, טהרה, בית מדרש, ישיבה, כולל, '
    'שבת קודש, יום טוב, ראש השנה, יום כיפור, סוכות, חנוכה, פורים, פסח, '
    'שבועות, רבי, רבנו, הרב, אדמו"ר, הגאון, בעל שם טוב, משה רבנו, '
    'אברהם אבינו, יצחק אבינו, יעקב אבינו, בני ישראל, ארץ ישראל, '
    'ירושלים, בית המקדש, מקום, מקומות, ענין, פירוש, אפשר, אסור, מותר, '
    'חייב, פטור, כשר, פסול, דאורייתא, דרבנן, לכתחילה, בדיעבד, '
    'הלכה למעשה, אמר, תנא, שמע מינה, רבא, אביי'
)

# ─── Default Hebrew hotwords — common confusable pairs ─────────────────────────
# Boosts probability of the correct word when a phonetically similar error-word
# might otherwise score higher.  Whisper's hotwords work by adding a log-prob
# bonus at decoding time, so listing the correct word makes the model prefer it.
# Format: "correct_word" (the error variant is NOT listed — listing it would
# boost the wrong word instead).
HEBREW_DEFAULT_HOTWORDS = (
    # ─ Construct state vs. base form ──────────────────────────────────────
    'מגמת, ערכת, קבוצת, מדיניות, '
    # ─ Prefix-bearing forms that models drop the prefix on ───────────────
    'לניהול, באחריות, להתפתח, בפיתוח, לשיפור, '
    # ─ ח/כ confusables ──────────────────────────────────────────────────
    'עיבוד, חיפוש, צמיחה, ביטוח, השקעה, '
    # ─ ע ayin-drop at start ──────────────────────────────────────────────
    'ערכות, אבטחה, עיבוד, '
    # ─ Plural vs. singular ───────────────────────────────────────────────
    'תשתיות, מסמכים, קבוצות, '
    # ─ Shin/samech, shin/ayin ────────────────────────────────────────────
    'מפגש, אחריות, ניהול, '
    # ─ tav-drop / lamed-drop ─────────────────────────────────────────────
    'תהליך, '
    # ─ adj vs. noun suffix ───────────────────────────────────────────────
    'כלכלית'
)


def _resolve_prompt_and_hotwords(language, user_initial_prompt, user_hotwords, loshon_kodesh):
    """Decide which initial_prompt and hotwords to send to Whisper.

    Priority for prompt:
      1. explicit user_initial_prompt
      2. Loshon Kodesh torani prompt (when loshon_kodesh=True)
      3. default Hebrew prompt (only for he)
    Hotwords: always merge user hotwords + Hebrew defaults for 'he'.
    When Loshon Kodesh is on, additionally merge torani list.
    """
    if user_initial_prompt:
        prompt = user_initial_prompt
    elif loshon_kodesh:
        prompt = LOSHON_KODESH_PROMPT
    elif language == "he":
        prompt = "תמלול שיחה בעברית."
    else:
        prompt = None

    # Build hotword list: user words always first, then language defaults
    sources = []
    if user_hotwords and user_hotwords.strip():
        sources.append(user_hotwords)
    if language == "he":
        sources.append(HEBREW_DEFAULT_HOTWORDS)  # always boost common confusables
    if loshon_kodesh:
        sources.append(LOSHON_KODESH_HOTWORDS)

    if sources:
        seen = set()
        merged = []
        for source in sources:
            for w in source.split(','):
                w = w.strip()
                if w and w not in seen:
                    seen.add(w)
                    merged.append(w)
        hotwords = ', '.join(merged) if merged else None
    else:
        hotwords = None

    return prompt, hotwords


# Concurrency control — only 1 GPU transcription at a time
import threading
_transcribe_lock = threading.Lock()
_transcribe_active: bool = False
_transcribe_active_info: dict | None = None  # metadata about active transcription

# Settings
MAX_UPLOAD_SIZE_MB = 500  # reject files larger than this
WAITRESS_CHANNEL_TIMEOUT = 1800  # 30 minutes — enough for very long audio
WAITRESS_RECV_BYTES = 131072  # 128 KB receive buffer

# ════════════════════════════════════════════════════════════════════
#  SHA-256 RESPONSE CACHE — skip GPU work for repeated files
# ════════════════════════════════════════════════════════════════════
_result_cache: dict[str, dict] = {}      # sha256 → result JSON
_result_cache_ts: dict[str, float] = {}  # sha256 → insertion time
RESULT_CACHE_MAX = 100                   # max entries
RESULT_CACHE_TTL = 24 * 3600            # 24 hours

def _file_sha256(path: str) -> str:
    """Compute SHA-256 hex digest for a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(131072), b""):
            h.update(chunk)
    return h.hexdigest()

def _cache_get(sha: str) -> dict | None:
    """Return cached result if it exists and hasn't expired."""
    if sha in _result_cache:
        if time.time() - _result_cache_ts.get(sha, 0) < RESULT_CACHE_TTL:
            return _result_cache[sha]
        # Expired
        _result_cache.pop(sha, None)
        _result_cache_ts.pop(sha, None)
    return None

def _cache_put(sha: str, result: dict):
    """Store result in cache, evicting oldest if full."""
    if len(_result_cache) >= RESULT_CACHE_MAX:
        oldest = min(_result_cache_ts, key=_result_cache_ts.get)
        _result_cache.pop(oldest, None)
        _result_cache_ts.pop(oldest, None)
    _result_cache[sha] = result
    _result_cache_ts[sha] = time.time()

# ════════════════════════════════════════════════════════════════════
#  AUDIO NORMALIZATION — FFmpeg loudnorm for consistent quality
# ════════════════════════════════════════════════════════════════════
_ffmpeg_available: bool | None = None

def _check_ffmpeg() -> bool:
    global _ffmpeg_available
    if _ffmpeg_available is not None:
        return _ffmpeg_available
    import subprocess
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        _ffmpeg_available = True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        _ffmpeg_available = False
    return _ffmpeg_available

def _estimate_dynamic_range(input_path: str) -> float:
    """Estimate audio dynamic range (peak_dB − rms_dB).

    Higher = cleaner audio.  Typical values:
      Clean speech         → 18–30 dB
      Light noise  -24dB   → 14–20 dB
      Medium noise -18dB   → 10–16 dB
      Heavy noise  -12dB   →  5–13 dB

    Fast path  : reads s16 WAV directly in Python — ~0 ms overhead.
    Slow path  : FFmpeg volumedetect on first 10 s for non-WAV inputs — < 0.5 s.
    Returns 25.0 on any error (safe default → keep afftdn enabled).
    """
    import wave, array, math

    # ── Fast path: PCM s16 WAV ────────────────────────────────────────
    try:
        with wave.open(input_path, 'rb') as wf:
            if wf.getsampwidth() == 2:  # s16le
                sr = wf.getframerate()
                n = min(wf.getnframes(), sr * 30)   # up to 30 s of samples
                raw = wf.readframes(n)
                samples = array.array('h', raw)
                if len(samples) >= 100:
                    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
                    peak = max(abs(s) for s in samples)
                    if rms >= 10 and peak >= 10:
                        return 20 * math.log10(peak / rms)
    except Exception:
        pass

    # ── Slow path: FFmpeg volumedetect on first 10 s (non-WAV inputs) ─
    import subprocess, re
    try:
        result = subprocess.run(
            ["ffmpeg", "-t", "10", "-i", input_path,
             "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True, timeout=15,
        )
        mean_m = re.search(r"mean_volume:\s*([-\d.]+)\s*dB", result.stderr)
        max_m  = re.search(r"max_volume:\s*([-\d.]+)\s*dB", result.stderr)
        if mean_m and max_m:
            return float(max_m.group(1)) - float(mean_m.group(1))
    except Exception:
        pass

    return 25.0  # safe default → keep afftdn


# Dynamic range threshold below which afftdn is skipped.
# Calibrated on benchmark data:
#   clean -4.5dBFS peak → dyn_range ~16 dB  → afftdn safe
#   -24dB noise         → dyn_range ~16 dB  → afftdn safe
#   -18dB noise         → dyn_range ~15 dB  → afftdn safe (WER improves)
#   -12dB noise         → dyn_range ~13 dB  → afftdn HARMFUL (WER 7→72%)
# Threshold 14 dB sits cleanly between the last two cases.
_AFFTDN_MIN_DYNAMIC_RANGE_DB = 14.0


def _normalize_audio(input_path: str) -> str:
    """Pre-process audio for best Whisper accuracy:
      1. Highpass 80Hz  — removes low-frequency rumble (HVAC, traffic)
      2. Lowpass 8kHz   — removes high-freq noise above speech range
      3. afftdn         — spectral noise reduction (skipped if SNR too low)
      4. loudnorm       — EBU R128 loudness normalization
      5. 16kHz mono     — exactly what Whisper expects (skips internal ffmpeg pass)
    Always outputs .wav (PCM s16le) — avoids container confusion from any input format.
    Returns path to processed .wav file (or original if FFmpeg unavailable)."""
    if not _check_ffmpeg():
        return input_path
    import subprocess
    # Measure dynamic range to decide whether afftdn is safe to use.
    # When the noise floor is very high (small dynamic range), afftdn
    # suppresses speech energy and makes Whisper hallucinate / drop words.
    dyn_range = _estimate_dynamic_range(input_path)
    use_afftdn = dyn_range >= _AFFTDN_MIN_DYNAMIC_RANGE_DB
    if use_afftdn:
        af_chain = "highpass=f=80,lowpass=f=8000,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"
    else:
        af_chain = "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11"
        _log.info(f"Audio dynamic range {dyn_range:.1f}dB < {_AFFTDN_MIN_DYNAMIC_RANGE_DB}dB — skipping afftdn (noisy input)")

    # Always output as .wav — Whisper reads it natively with no extra decode step
    output_path = input_path + "_norm.wav"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-af", af_chain,
             "-ar", "16000", "-ac", "1",
             "-acodec", "pcm_s16le",
             output_path],
            capture_output=True, timeout=120,
        )
        if result.returncode == 0 and os.path.exists(output_path):
            return output_path
        _log.warning(f"Audio normalization ffmpeg exit {result.returncode}: {result.stderr.decode(errors='replace')[:200]}")
    except (subprocess.TimeoutExpired, Exception) as e:
        _log.warning(f"Audio normalization failed: {e}")
    return input_path

# ════════════════════════════════════════════════════════════════════
#  PERFORMANCE METRICS — per-model latency percentiles
# ════════════════════════════════════════════════════════════════════
_perf_metrics: dict[str, list[float]] = {}  # model_id → list of RTFs
PERF_METRICS_MAX_SAMPLES = 200

def _record_metric(model_id: str, rtf: float):
    """Record a real-time-factor measurement for a model."""
    if model_id not in _perf_metrics:
        _perf_metrics[model_id] = []
    samples = _perf_metrics[model_id]
    samples.append(rtf)
    if len(samples) > PERF_METRICS_MAX_SAMPLES:
        _perf_metrics[model_id] = samples[-PERF_METRICS_MAX_SAMPLES:]

def _compute_percentiles(samples: list[float]) -> dict:
    """Compute p50, p90, p95, p99 from a list of values."""
    if not samples:
        return {}
    s = sorted(samples)
    n = len(s)
    return {
        "count": n,
        "p50": round(s[int(n * 0.5)], 4),
        "p90": round(s[int(n * 0.9)], 4),
        "p95": round(s[min(int(n * 0.95), n - 1)], 4),
        "p99": round(s[min(int(n * 0.99), n - 1)], 4),
        "min": round(s[0], 4),
        "max": round(s[-1], 4),
        "avg": round(sum(s) / n, 4),
    }

# GPU memory cache for fast health checks
_gpu_mem_cache: dict | None = None
_gpu_mem_cache_time: float = 0.0

def _get_gpu_mem() -> dict | None:
    """Get GPU memory usage in MB. Cached for 2s to keep /health fast."""
    global _gpu_mem_cache, _gpu_mem_cache_time
    now = time.time()
    if _gpu_mem_cache is not None and (now - _gpu_mem_cache_time) < 2.0:
        return _gpu_mem_cache
    result = None
    try:
        if _has_torch and torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated(0) / 1024 / 1024
            reserved = torch.cuda.memory_reserved(0) / 1024 / 1024
            total = torch.cuda.get_device_properties(0).total_mem / 1024 / 1024
            result = {
                "allocated_mb": round(allocated, 1),
                "reserved_mb": round(reserved, 1),
                "total_mb": round(total, 1),
                "free_mb": round(total - reserved, 1),
                "utilization_pct": round(reserved / total * 100, 1) if total > 0 else 0,
            }
    except Exception:
        pass
    if result is None:
        try:
            import subprocess
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0:
                parts = r.stdout.strip().split(",")
                total, used, free = float(parts[0]), float(parts[1]), float(parts[2])
                result = {
                    "allocated_mb": round(used, 1),
                    "reserved_mb": round(used, 1),
                    "total_mb": round(total, 1),
                    "free_mb": round(free, 1),
                    "utilization_pct": round(used / total * 100, 1) if total > 0 else 0,
                }
        except Exception:
            pass
    _gpu_mem_cache = result
    _gpu_mem_cache_time = now
    return result

def _get_system_mem() -> dict:
    """Get system RAM usage."""
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "total_gb": round(vm.total / 1024**3, 1),
            "used_gb": round(vm.used / 1024**3, 1),
            "free_gb": round(vm.available / 1024**3, 1),
            "percent": vm.percent,
        }
    except ImportError:
        pass
    # Fallback for Windows
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return {
            "total_gb": round(stat.ullTotalPhys / 1024**3, 1),
            "used_gb": round((stat.ullTotalPhys - stat.ullAvailPhys) / 1024**3, 1),
            "free_gb": round(stat.ullAvailPhys / 1024**3, 1),
            "percent": stat.dwMemoryLoad,
        }
    except Exception:
        return {"error": "unavailable"}

def _cleanup_gpu_memory():
    """Force garbage collection and clear CUDA cache to free VRAM."""
    import gc
    gc.collect()
    if _has_torch and torch.cuda.is_available():
        torch.cuda.empty_cache()
        _log.debug("GPU memory cleaned up (gc + empty_cache)")


def _unload_ollama_models() -> int:
    """Ask Ollama to unload all loaded models (free VRAM). Returns count unloaded."""
    try:
        import urllib.request, urllib.error
        ollama_url = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
        if not ollama_url.startswith("http"):
            ollama_url = "http://" + ollama_url
        # List currently loaded models
        try:
            with urllib.request.urlopen(f"{ollama_url}/api/ps", timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8") or "{}")
        except Exception:
            return 0
        loaded = data.get("models") or []
        if not loaded:
            return 0
        unloaded = 0
        for m in loaded:
            name = m.get("name") or m.get("model")
            if not name:
                continue
            try:
                req = urllib.request.Request(
                    f"{ollama_url}/api/generate",
                    data=json.dumps({"model": name, "keep_alive": 0, "prompt": ""}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5) as r:
                    r.read()
                unloaded += 1
                _log.info(f"Unloaded Ollama model to free VRAM: {name}")
            except Exception as e:
                _log.debug(f"Failed to unload Ollama model {name}: {e}")
        return unloaded
    except Exception as e:
        _log.debug(f"Ollama unload skipped: {e}")
        return 0


def _evict_all_whisper_models():
    """Evict every cached Whisper model to free VRAM."""
    global _current_model_id
    keys = list(_model_cache.keys())
    for k in keys:
        try:
            del _model_cache[k]
        except KeyError:
            pass
        _model_last_used.pop(k, None)
    _current_model_id = None
    if keys:
        _log.info(f"Evicted {len(keys)} cached Whisper model(s) to free VRAM")

def _log_memory_state(label: str):
    """Log current GPU + system memory state."""
    gpu = _get_gpu_mem()
    sys_mem = _get_system_mem()
    gpu_str = f"GPU: {gpu['allocated_mb']:.0f}/{gpu['total_mb']:.0f} MB ({gpu['utilization_pct']:.0f}%)" if gpu else "GPU: N/A"
    ram_str = f"RAM: {sys_mem.get('used_gb', '?')}/{sys_mem.get('total_gb', '?')} GB ({sys_mem.get('percent', '?')}%)"
    _log.info(f"[MEM {label}] {gpu_str} | {ram_str}")

# Global model cache
_model_cache: dict[str, faster_whisper.WhisperModel] = {}
_model_last_used: dict[str, float] = {}  # cache_key → last access timestamp
_current_model_id: str | None = None
MODEL_TTL_SECONDS = 30 * 60  # 30 minutes — evict unused models to free VRAM
_flash_attention_disabled = False  # Set True after runtime flash-attention error

# Background model loading state
_model_loading_lock = threading.Lock()
_model_loading: bool = False       # True while a model is being loaded in background
_model_loading_id: str | None = None  # model being loaded
_model_loading_progress: str = ''   # current loading phase description

# Device + GPU name cache
_cached_device: str | None = None
_cached_gpu_name: str | None = None

# Staged audio files — pre-uploaded while model loads in parallel
import uuid
_staged_files: dict[str, dict] = {}  # stage_id → { path, filename, timestamp }
STAGE_TTL_SECONDS = 5 * 60  # 5 minutes — auto-cleanup staged files

# Model registry - maps friendly names to HuggingFace model IDs
MODEL_REGISTRY = {
    # Standard Whisper models
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large-v2": "large-v2",
    "large-v3": "large-v3",
    "large-v3-turbo": "large-v3-turbo",
    # Distil-Whisper: faster, smaller, ~99% accuracy of large-v3
    "distil-large-v3": "deepdml/faster-whisper-large-v3-turbo-ct2",
    "distil-medium.en": "Systran/faster-distil-whisper-medium.en",
    "distil-small.en": "Systran/faster-distil-whisper-small.en",
    # Ivrit.ai Hebrew-optimized models (pre-converted CT2 format on HuggingFace)
    "ivrit-ai/faster-whisper-v2-d4": "ivrit-ai/faster-whisper-v2-d4",
    "ivrit-ai/whisper-large-v3-turbo-ct2": "ivrit-ai/whisper-large-v3-turbo-ct2",
    # ivrit-ai/whisper-large-v3-turbo — requires local HF→CT2 conversion (see MODELS_NEEDING_CONVERSION)
}

# Default to ivrit-ai for best Hebrew quality (per Interspeech 2025: Marmor et al.).
# Override with --model on CLI for non-Hebrew use cases.
DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"


def _default_model_for(language: str = "he") -> str:
    """Return the best default model, preferring ivrit-ai for Hebrew."""
    if language == "he":
        return "ivrit-ai/whisper-large-v3-turbo-ct2"
    return "large-v3-turbo"


def get_device() -> str:
    """Detect best available device using CTranslate2 (cached)."""
    global _cached_device
    if _cached_device is not None:
        return _cached_device
    try:
        import ctranslate2
        cuda_types = ctranslate2.get_supported_compute_types("cuda")
        if cuda_types and len(cuda_types) > 0:
            _cached_device = "cuda"
            gpu_name = get_gpu_name() or "GPU (CUDA)"
            print(f"  GPU: {gpu_name} (CUDA via CTranslate2)")
            return "cuda"
    except Exception as e:
        print(f"  CUDA detection failed: {e}")
    print("  GPU: Not available, using CPU")
    _cached_device = "cpu"
    return "cpu"


def get_gpu_name():
    """Get GPU name for display (cached)."""
    global _cached_gpu_name
    if _cached_gpu_name is not None:
        return _cached_gpu_name
    if _has_torch:
        try:
            if torch.cuda.is_available():
                _cached_gpu_name = torch.cuda.get_device_name(0)
                return _cached_gpu_name
        except Exception:
            pass
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            _cached_gpu_name = result.stdout.strip()
            return _cached_gpu_name
    except Exception:
        pass
    return None


CONVERT_ROOT = Path.home() / ".cache" / "whisper-models-ct2"


def convert_hf_to_ct2(model_id: str) -> str:
    """Convert a HuggingFace Whisper model to CTranslate2 format."""
    output_dir = CONVERT_ROOT / model_id.replace("/", "--")
    marker = output_dir / "model.bin"

    if marker.exists():
        print(f"  Using cached CT2 conversion: {output_dir}")
        return str(output_dir)

    print(f"  Converting HuggingFace model to CTranslate2: {model_id}...")
    output_dir.mkdir(parents=True, exist_ok=True)

    import ctranslate2
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    print(f"    Downloading from HuggingFace: {model_id}...")
    processor = WhisperProcessor.from_pretrained(model_id)
    processor.save_pretrained(str(output_dir))

    hf_model = WhisperForConditionalGeneration.from_pretrained(model_id)

    print(f"    Converting to CTranslate2 format...")
    converter = ctranslate2.converters.TransformersConverter(
        model_name_or_path=model_id,
    )
    converter.convert(
        output_dir=str(output_dir),
        quantization="float16",
        force=True,
    )

    del hf_model
    print(f"    Conversion complete: {output_dir}")
    return str(output_dir)


# Models that need HF→CT2 conversion (not available as pre-converted on HF Hub)
MODELS_NEEDING_CONVERSION = {
    "ivrit-ai/whisper-large-v3-turbo",
}


# ════════════════════════════════════════════════════════════════════
#  TRANSCRIPTION PRESETS
# ════════════════════════════════════════════════════════════════════
TRANSCRIPTION_PRESETS = {
    "fast": {
        "label": "מהיר",
        "label_en": "Fast",
        "description": "מהירות מקסימלית — עיבוד מקבילי, beam=1, דילוג שקט אגרסיבי",
        "fast_mode": True,
        "beam_size": 1,
        "batch_size": 24,
        "condition_on_previous_text": False,
        "vad_aggressive": True,
        "compute_type": "int8_float16",
    },
    "balanced": {
        "label": "מאוזן",
        "label_en": "Balanced",
        "description": "איזון טוב בין מהירות לדיוק — ברירת מחדל מומלצת",
        "fast_mode": True,
        "beam_size": 3,         # was 1 — beam=3 improves Hebrew WER significantly
        "batch_size": 16,
        "condition_on_previous_text": True,  # was False — context between segments helps Hebrew
        "vad_aggressive": False,
        "compute_type": "int8_float16",
    },
    "accurate": {
        "label": "מדויק",
        "label_en": "Accurate",
        "description": "דיוק מקסימלי — עיבוד סדרתי, beam=5, הקשר טקסט מלא",
        "fast_mode": False,
        "beam_size": 5,
        "batch_size": 8,
        "condition_on_previous_text": True,
        "vad_aggressive": False,
        "compute_type": "float16",
    },
}
DEFAULT_PRESET = "balanced"


def auto_batch_size() -> int:
    """Auto-detect optimal batch size based on GPU VRAM.
    Conservative on small GPUs (≤10GB) to leave headroom for Ollama / browser.
    Falls back to 8 if VRAM cannot be determined.
    """
    gpu = _get_gpu_mem()
    if gpu and gpu.get("free_mb"):
        free_mb = int(gpu["free_mb"])
        total_mb = int(gpu.get("total_mb") or 0)
        # 8GB-class GPUs (RTX 3050/4050/5050 Laptop): cap batch at 8
        if total_mb and total_mb <= 10240:
            return min(8, max(2, free_mb // 768))
        return min(24, max(4, free_mb // 512))
    return 8


def load_model(model_id: str, compute_type_override: str | None = None) -> faster_whisper.WhisperModel:
    """Load or retrieve cached Whisper model.
    compute_type_override: 'float16', 'int8_float16', 'int8', or None (auto)
    """
    global _current_model_id, _flash_attention_disabled

    device = get_device()
    compute_type = compute_type_override or ("int8_float16" if device == "cuda" else "int8")
    cache_key = f"{model_id}::{compute_type}"

    if cache_key in _model_cache:
        _current_model_id = model_id
        _model_last_used[cache_key] = time.time()
        return _model_cache[cache_key]

    # Check if this model needs conversion from HuggingFace format
    actual_path = model_id
    if model_id in MODELS_NEEDING_CONVERSION:
        actual_path = convert_hf_to_ct2(model_id)

    print(f"\n  Loading model: {model_id} ({device}/{compute_type})...")
    start = time.time()

    def _load(dev, ct):
        # Flash Attention 2: ~50% faster on CUDA (CTranslate2 4.x+), zero quality loss
        use_flash = False
        if dev == "cuda" and not _flash_attention_disabled:
            try:
                import ctranslate2
                major = int(ctranslate2.__version__.split('.')[0])
                use_flash = major >= 4
            except Exception:
                pass
        if use_flash:
            print(f"  ⚡ Flash Attention enabled (CTranslate2 {ctranslate2.__version__})")
        elif _flash_attention_disabled and dev == "cuda":
            print(f"  ℹ️ Flash Attention disabled (previously failed at runtime)")
        return faster_whisper.WhisperModel(
            actual_path,
            device=dev,
            compute_type=ct,
            download_root=str(Path.home() / ".cache" / "whisper-models"),
            flash_attention=use_flash,
        )

    try:
        model = _load(device, compute_type)
    except Exception as e:
        err_str = str(e).lower()
        # Retry without Flash Attention if not supported by this GPU/driver
        if "flash attention" in err_str:
            _flash_attention_disabled = True
            print(f"  Flash Attention not supported ({e}), disabling globally and retrying...")
            def _load_no_flash(dev, ct):
                return faster_whisper.WhisperModel(
                    actual_path,
                    device=dev,
                    compute_type=ct,
                    download_root=str(Path.home() / ".cache" / "whisper-models"),
                    flash_attention=False,
                )
            model = _load_no_flash(device, compute_type)
        # Fall back to CPU when CUDA runtime libraries are missing (e.g. cublas64_12.dll)
        elif device == "cuda" and (
            "cublas" in err_str or "cudnn" in err_str or "cufft" in err_str
            or "cannot be loaded" in err_str or "not found" in err_str
        ):
            print(f"  CUDA library missing ({e}), falling back to CPU...")
            device = "cpu"
            compute_type = "int8"
            model = _load(device, compute_type)
        # GPU OOM — free VRAM (Ollama + cached models) and retry with lighter precision, then CPU
        elif device == "cuda" and "out of memory" in err_str:
            print(f"  ⚠️ GPU OOM while loading {model_id} — freeing VRAM and retrying...")
            _evict_all_whisper_models()
            freed = _unload_ollama_models()
            _cleanup_gpu_memory()
            if freed:
                print(f"  Unloaded {freed} Ollama model(s) to reclaim VRAM")
            try:
                model = _load(device, compute_type)
            except Exception as e2:
                if "out of memory" not in str(e2).lower():
                    raise
                # Try lighter quantization
                if compute_type != "int8":
                    print(f"  ⚠️ Still OOM — retrying with compute_type=int8 (lighter)...")
                    compute_type = "int8"
                    cache_key = f"{model_id}::{compute_type}"
                    try:
                        model = _load(device, compute_type)
                    except Exception as e3:
                        if "out of memory" not in str(e3).lower():
                            raise
                        print(f"  ⚠️ Still OOM — falling back to CPU...")
                        device = "cpu"
                        compute_type = "int8"
                        cache_key = f"{model_id}::{compute_type}"
                        model = _load(device, compute_type)
                else:
                    print(f"  ⚠️ Still OOM — falling back to CPU...")
                    device = "cpu"
                    compute_type = "int8"
                    cache_key = f"{model_id}::{compute_type}"
                    model = _load(device, compute_type)
        else:
            raise

    elapsed = time.time() - start
    print(f"  Model loaded in {elapsed:.1f}s")

    # ── Fix mel-bins mismatch for large-v3 / turbo models ──
    # These models expect 128 mel features, but older cached configs may say 80.
    _patch_feature_extractor(model, model_id)

    _model_cache[cache_key] = model
    _model_last_used[cache_key] = time.time()
    _current_model_id = model_id
    return model


def _reload_model_without_flash(model_id: str, compute_type_override: str | None = None):
    """Evict cached model and reload with flash_attention=False."""
    global _flash_attention_disabled
    _flash_attention_disabled = True
    device = get_device()
    compute_type = compute_type_override or ("int8_float16" if device == "cuda" else "int8")
    cache_key = f"{model_id}::{compute_type}"
    _model_cache.pop(cache_key, None)
    _model_last_used.pop(cache_key, None)
    _log.info(f"Flash Attention failed at runtime — reloading model {model_id} without it")
    return load_model(model_id, compute_type_override)


def _patch_feature_extractor(model, model_id: str):
    """Ensure the feature extractor uses 128 mel bins for large-v3/turbo models."""
    needs_128 = any(x in str(model_id).lower() for x in ["-v3", "turbo", "large-v3"])
    if not needs_128:
        return
    try:
        current_size = getattr(getattr(model, "feature_extractor", None), "feature_size", None)
        if current_size == 80:
            from faster_whisper.feature_extractor import FeatureExtractor
            model.feature_extractor = FeatureExtractor(feature_size=128)
            print(f"  ✅ Patched feature extractor: 80→128 mel bins for {model_id}")
        else:
            print(f"  feature_extractor.feature_size = {current_size} (OK)")
    except Exception as e:
        print(f"  ⚠️  Could not patch feature extractor: {e}")


# Cached downloaded-model list (refreshed on load/download, not on every health check)
_downloaded_models_cache: list[str] | None = None

def _refresh_downloaded_models_cache():
    """Refresh the cached list of downloaded models."""
    global _downloaded_models_cache
    download_root = str(Path.home() / ".cache" / "whisper-models")
    downloaded = []
    for model_id, resolved in MODEL_REGISTRY.items():
        if resolved in MODELS_NEEDING_CONVERSION:
            ct2_path = CONVERT_ROOT / resolved.replace("/", "--") / "model.bin"
            if ct2_path.exists():
                downloaded.append(model_id)
        else:
            try:
                from faster_whisper.utils import download_model
                path = download_model(resolved, cache_dir=download_root, local_files_only=True)
                if path and os.path.isdir(path):
                    downloaded.append(model_id)
            except Exception:
                pass
    _downloaded_models_cache = downloaded
    return downloaded

def get_downloaded_models():
    """Return cached list of downloaded models (cheap for /health polling)."""
    if _downloaded_models_cache is None:
        return _refresh_downloaded_models_cache()
    return _downloaded_models_cache


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint with memory diagnostics."""
    device = get_device()
    gpu_name = get_gpu_name()
    downloaded = get_downloaded_models()
    gpu_mem = _get_gpu_mem()
    uptime = round(time.time() - _server_start_time, 0)
    return jsonify({
        "status": "ok",
        "device": device,
        "gpu": gpu_name,
        "gpu_memory": gpu_mem,
        "current_model": _current_model_id,
        "cached_models": list(_model_cache.keys()),
        "downloaded_models": downloaded,
        "available_models": list(MODEL_REGISTRY.keys()),
        "model_loading": _model_loading,
        "model_loading_id": _model_loading_id,
        "model_ready": len(_model_cache) > 0,
        "flash_attention_disabled": _flash_attention_disabled,
        "transcribe_active": _transcribe_active,
        "uptime_seconds": int(uptime),
        "result_cache_size": len(_result_cache),
        "ffmpeg_available": _check_ffmpeg(),
    })


@app.route("/metrics", methods=["GET"])
def metrics_endpoint():
    """Per-model performance metrics with latency percentiles."""
    metrics = {}
    for model_id, samples in _perf_metrics.items():
        metrics[model_id] = _compute_percentiles(samples)
    return jsonify({
        "models": metrics,
        "cache": {
            "size": len(_result_cache),
            "max": RESULT_CACHE_MAX,
            "ttl_hours": RESULT_CACHE_TTL / 3600,
            "hit_keys": list(_result_cache.keys())[:10],
        },
    })


@app.route("/debug", methods=["GET"])
def debug_endpoint():
    """Comprehensive debug info — GPU, RAM, request history, config."""
    gpu_mem = _get_gpu_mem()
    sys_mem = _get_system_mem()
    gpu_name = get_gpu_name()

    # Calculate stats from request history
    recent_requests = list(_request_history)
    total_requests = len(recent_requests)
    errors = [r for r in recent_requests if r.get("error")]
    avg_rtf = 0
    if recent_requests:
        rtfs = [r["rtf"] for r in recent_requests if "rtf" in r and r["rtf"] > 0]
        avg_rtf = round(sum(rtfs) / len(rtfs), 3) if rtfs else 0

    return jsonify({
        "server": {
            "uptime_seconds": int(time.time() - _server_start_time),
            "python_version": sys.version.split()[0],
            "faster_whisper_version": faster_whisper.__version__,
            "torch_version": torch.__version__ if _has_torch else None,
            "pid": os.getpid(),
            "max_upload_mb": MAX_UPLOAD_SIZE_MB,
            "waitress_timeout": WAITRESS_CHANNEL_TIMEOUT,
        },
        "gpu": {
            "name": gpu_name,
            "device": get_device(),
            "memory": gpu_mem,
        },
        "system_memory": sys_mem,
        "models": {
            "current": _current_model_id,
            "cached": list(_model_cache.keys()),
            "loading": _model_loading,
            "loading_id": _model_loading_id,
        },
        "concurrency": {
            "transcribe_active": _transcribe_active,
            "active_info": _transcribe_active_info,
        },
        "stats": {
            "total_requests": total_requests,
            "errors": len(errors),
            "avg_rtf": avg_rtf,
        },
        "recent_requests": recent_requests[-10:],  # last 10
    })


@app.route("/diagnostics", methods=["GET"])
def diagnostics_endpoint():
    """Full request history with performance data."""
    return jsonify({
        "request_history": list(_request_history),
        "total": len(_request_history),
    })


@app.route("/setup/scan", methods=["GET"])
def setup_scan():
    """System scan for the setup wizard — returns GPU, RAM, disk, installed packages."""
    import shutil
    gpu_mem = _get_gpu_mem()
    sys_mem = _get_system_mem()
    gpu_name = get_gpu_name()
    device = get_device()

    # Disk space for project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    disk = shutil.disk_usage(project_root)
    disk_free_gb = round(disk.free / (1024**3), 1)
    disk_total_gb = round(disk.total / (1024**3), 1)

    # CUDA info — use CTranslate2 detection (same as get_device) since torch may be CPU-only
    cuda_available = device == "cuda"
    cuda_version = None
    gpu_device_name = None
    if cuda_available:
        # Try torch first, then nvidia-smi for CUDA version
        if _has_torch and torch.cuda.is_available():
            cuda_version = torch.version.cuda
            gpu_device_name = torch.cuda.get_device_name(0)
        else:
            try:
                import subprocess as _sp
                r = _sp.run(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                            capture_output=True, text=True, timeout=5)
                if r.returncode == 0:
                    cuda_version = f"NVIDIA Driver {r.stdout.strip()}"
            except Exception:
                cuda_version = "available (via CTranslate2)"

    # Package versions
    packages = {}
    for pkg in ["faster_whisper", "flask", "flask_compress", "waitress", "torch", "ctranslate2"]:
        try:
            mod = __import__(pkg)
            packages[pkg] = getattr(mod, "__version__", "installed")
        except ImportError:
            packages[pkg] = None

    # Downloaded models
    downloaded = get_downloaded_models()

    return jsonify({
        "system": {
            "python_version": sys.version.split()[0],
            "ram": sys_mem,
            "disk_free_gb": disk_free_gb,
            "disk_total_gb": disk_total_gb,
        },
        "gpu": {
            "name": gpu_name or gpu_device_name,
            "device": device,
            "cuda_available": cuda_available,
            "cuda_version": cuda_version,
            "memory": gpu_mem,
        },
        "packages": packages,
        "models": {
            "current": _current_model_id,
            "downloaded": downloaded,
            "available": list(MODEL_REGISTRY.keys()),
            "model_ready": len(_model_cache) > 0,
        },
        "server": {
            "uptime_seconds": int(time.time() - _server_start_time),
            "port": int(os.environ.get("PORT", 3000)),
        },
    })


@app.route("/models", methods=["GET"])
def list_models():
    """List available models."""
    return jsonify({
        "models": list(MODEL_REGISTRY.keys()),
        "current": _current_model_id,
        "cached": list(_model_cache.keys()),
    })


@app.route("/presets", methods=["GET"])
def list_presets():
    """List available transcription presets."""
    return jsonify({
        "presets": TRANSCRIPTION_PRESETS,
        "default": DEFAULT_PRESET,
    })


@app.route("/transcribe", methods=["POST"])
def transcribe():
    """Transcribe audio file with word-level timestamps."""
    # Get the audio file
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "he")
    model_id = request.form.get("model", _current_model_id or _default_model_for(language))
    beam_size = int(request.form.get("beam_size", 3))
    normalize = request.form.get("normalize", "1") == "1"
    ai_denoise = request.form.get("ai_denoise", "0") == "1"

    # Resolve model ID
    resolved = MODEL_REGISTRY.get(model_id, model_id)

    # Save to temp file
    suffix = _safe_suffix(audio_file.filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    norm_path = None
    ai_denoise_path = None
    try:
        # AI pre-transcription denoise (optional, uses spectral gating for speed)
        if ai_denoise:
            try:
                from ai_enhance import enhance_spectral
                ai_denoise_path = tmp_path + ".ai_denoised.wav"
                enhance_spectral(tmp_path, ai_denoise_path, prop_decrease=0.65, stationary=False)
                tmp_path = ai_denoise_path
                _log.info(f"  [ai_denoise] Pre-transcription denoise applied for {audio_file.filename}")
            except Exception as denoise_err:
                _log.warning(f"  [ai_denoise] Failed, continuing without: {denoise_err}")

        # SHA-256 cache lookup — skip GPU work for repeated files.
        # Include normalize flag in key: normalized audio sounds different from raw.
        file_hash = _file_sha256(tmp_path)
        cache_key = f"{file_hash}:{resolved}:{language}:{beam_size}:norm={int(normalize)}"
        cached = _cache_get(cache_key)
        if cached:
            _log.info(f"  Cache HIT for {audio_file.filename} ({cache_key[:16]}...)")
            cached["cache_hit"] = True
            return jsonify(cached)

        # Audio normalization for consistent quality
        transcribe_path = tmp_path
        if normalize:
            norm_path = _normalize_audio(tmp_path)
            if norm_path != tmp_path:
                transcribe_path = norm_path

        model = load_model(resolved)

        print(f"\n  Transcribing: {audio_file.filename} (model={resolved}, lang={language})")
        start = time.time()

        # Use full prompt resolution (supports hotwords, loshon_kodesh, user prompts)
        user_initial_prompt = request.form.get("initial_prompt", "")
        user_hotwords = request.form.get("hotwords", "")
        loshon_kodesh = request.form.get("loshon_kodesh", "0") == "1"
        initial_prompt, hotwords = _resolve_prompt_and_hotwords(
            language, user_initial_prompt, user_hotwords, loshon_kodesh
        )

        def _run_transcribe(m):
            from faster_whisper import BatchedInferencePipeline
            pipeline = BatchedInferencePipeline(model=m)
            return pipeline.transcribe(
                transcribe_path,
                language=language if language != "auto" else None,
                word_timestamps=True,
                beam_size=beam_size,
                batch_size=auto_batch_size(),
                initial_prompt=initial_prompt,
                hotwords=hotwords,
                condition_on_previous_text=True,
            )

        try:
            segments, info = _run_transcribe(model)
            # Force first segment to detect flash attention errors early
            segments = list(segments)
        except Exception as fa_err:
            if "flash attention" in str(fa_err).lower():
                model = _reload_model_without_flash(resolved)
                segments, info = _run_transcribe(model)
                segments = list(segments)
            else:
                raise

        # Collect segments and word timings
        full_text_parts = []
        word_timings = []

        for segment in segments:
            full_text_parts.append(segment.text.strip())
            if segment.words:
                for w in segment.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    })

        full_text = " ".join(full_text_parts)
        elapsed = time.time() - start

        # Record performance metric
        if info.duration > 0:
            _record_metric(resolved, round(elapsed / info.duration, 4))

        print(f"  Done in {elapsed:.1f}s — {len(word_timings)} words, {info.duration:.1f}s audio")

        result = {
            "text": full_text,
            "wordTimings": word_timings,
            "duration": round(info.duration, 2),
            "language": info.language,
            "model": resolved,
            "processing_time": round(elapsed, 2),
        }

        # Store in cache
        _cache_put(cache_key, result)

        return jsonify(result)

    except Exception as e:
        err_msg = str(e)
        print(f"  Transcription error: {err_msg}")
        # Don't leak temp file paths to client
        if "Invalid data found" in err_msg or "Errno" in err_msg:
            return jsonify({"error": "Invalid or corrupt audio file"}), 400
        return jsonify({"error": "Transcription failed"}), 500

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if norm_path and norm_path != tmp_path:
            try:
                os.unlink(norm_path)
            except OSError:
                pass
        if ai_denoise_path and ai_denoise_path != tmp_path:
            try:
                os.unlink(ai_denoise_path)
            except OSError:
                pass

@app.route("/transcribe-stream", methods=["POST"])
def transcribe_stream():
    """Transcribe audio with Server-Sent Events — sends each segment as it's ready.
    Supports `start_from` (seconds) to resume from a specific time offset.
    Supports `stage_id` to use a pre-uploaded audio file (parallel upload + preload).

    DEBUG & STABILITY features:
    - Concurrency lock: only 1 GPU transcription at a time (prevents VRAM collision)
    - File size validation: rejects uploads > MAX_UPLOAD_SIZE_MB
    - GPU memory monitoring: logs VRAM before/after transcription
    - CUDA OOM recovery: catches out-of-memory, cleans up, returns graceful error
    - Request history: tracks all requests for /debug endpoint
    - Automatic GPU cleanup after each transcription
    """
    global _transcribe_active, _transcribe_active_info
    request_id = str(uuid.uuid4())[:8]
    request_start = time.time()

    # Resolve audio source: staged file OR uploaded file
    stage_id = request.form.get("stage_id")
    if stage_id and stage_id in _staged_files:
        staged = _staged_files.pop(stage_id)
        tmp_path = staged["path"]
        audio_filename = staged["filename"]
        _log.info(f"[{request_id}] Using staged file: {audio_filename} (stage_id={stage_id[:8]}...)")
    elif "file" in request.files:
        audio_file = request.files["file"]
        audio_filename = audio_file.filename or "audio.webm"
        suffix = _safe_suffix(audio_filename)
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            audio_file.save(tmp)
            tmp_path = tmp.name
    else:
        return jsonify({"error": "No file or stage_id provided"}), 400

    # ── File size validation ──
    file_size_bytes = os.path.getsize(tmp_path)
    file_size_mb = file_size_bytes / (1024 * 1024)
    if file_size_mb > MAX_UPLOAD_SIZE_MB:
        _log.warning(f"[{request_id}] REJECTED: file too large ({file_size_mb:.1f} MB > {MAX_UPLOAD_SIZE_MB} MB limit)")
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return jsonify({"error": f"File too large: {file_size_mb:.1f} MB (max {MAX_UPLOAD_SIZE_MB} MB)"}), 413

    # ── Concurrency check ──
    if _transcribe_active:
        active_info = _transcribe_active_info or {}
        _log.warning(f"[{request_id}] QUEUED: another transcription in progress ({active_info.get('filename', '?')})")
        # Don't reject — wait for lock in generate()

    language = request.form.get("language", "he")
    model_id = request.form.get("model", _current_model_id or _default_model_for(language))
    start_from = max(0.0, float(request.form.get("start_from", "0")))

    # ── Input validation ──
    if model_id not in MODEL_REGISTRY and not model_id.startswith("ivrit-ai/"):
        return jsonify({"error": f"Unknown model: {model_id}", "available": list(MODEL_REGISTRY.keys())}), 400

    _VALID_LANGUAGES = {
        "auto", "he", "en", "ar", "ru", "fr", "de", "es", "it", "pt", "zh",
        "ja", "ko", "nl", "pl", "tr", "uk", "cs", "sv", "da", "fi", "no",
        "hu", "ro", "el", "th", "vi", "id", "ms", "hi", "bn", "ta", "te",
    }
    if language and language not in _VALID_LANGUAGES:
        return jsonify({"error": f"Unsupported language: {language}", "supported": sorted(_VALID_LANGUAGES)}), 400

    # ── Resolve preset → defaults, then allow per-param overrides ──
    preset_name = request.form.get("preset", "").strip()
    preset = TRANSCRIPTION_PRESETS.get(preset_name) if preset_name else None

    fast_mode_raw = request.form.get("fast_mode")
    if fast_mode_raw is not None:
        fast_mode = fast_mode_raw == "1"
    elif preset:
        fast_mode = preset["fast_mode"]
    else:
        fast_mode = True  # Sprint 1 default: batched mode ON

    compute_type_req = request.form.get("compute_type") or (preset["compute_type"] if preset else None)

    beam_size_req = request.form.get("beam_size")
    if not beam_size_req and preset:
        beam_size_req = str(preset["beam_size"])

    batch_size_raw = request.form.get("batch_size")
    if batch_size_raw and batch_size_raw.isdigit():
        batch_size = int(batch_size_raw)
    elif preset:
        batch_size = preset["batch_size"]
    else:
        batch_size = auto_batch_size()

    no_condition_prev_raw = request.form.get("no_condition_on_previous")
    if no_condition_prev_raw is not None:
        no_condition_prev = no_condition_prev_raw == "1"
    elif preset:
        no_condition_prev = not preset["condition_on_previous_text"]
    else:
        no_condition_prev = True  # Sprint 1 default: prevent hallucinations

    vad_aggressive_raw = request.form.get("vad_aggressive")
    if vad_aggressive_raw is not None:
        vad_aggressive = vad_aggressive_raw == "1"
    elif preset:
        vad_aggressive = preset["vad_aggressive"]
    else:
        vad_aggressive = True  # Sprint 1 default: aggressive VAD

    hotwords_raw = request.form.get("hotwords", "").strip()
    hotwords = hotwords_raw if hotwords_raw else None
    paragraph_threshold = float(request.form.get("paragraph_threshold", "0"))
    resolved = MODEL_REGISTRY.get(model_id, model_id)

    # —— Loshon Kodesh (Ashkenazi torani Hebrew) ——
    loshon_kodesh = (request.form.get("loshon_kodesh", "0") or "0").strip().lower() in ("1", "true", "yes")
    initial_prompt_raw = request.form.get("initial_prompt", "").strip() or None
    hebrew_prompt, hotwords = _resolve_prompt_and_hotwords(
        language, initial_prompt_raw, hotwords, loshon_kodesh,
    )

    # Capture request-scoped headers BEFORE entering the SSE generator
    # (Flask `request` proxy is not valid once streaming starts under waitress).
    share_mode = (request.headers.get("X-GPU-Share-Mode") or "serial").lower()

    suffix = _safe_suffix(audio_filename)

    _log.info(f"[{request_id}] NEW REQUEST: {audio_filename} ({file_size_mb:.1f} MB) model={resolved} lang={language}")

    # If resuming, trim audio to start_from using ffmpeg
    trimmed_path = None
    if start_from > 0:
        try:
            import subprocess
            trimmed_path = tmp_path + "_trimmed" + suffix
            result = subprocess.run(
                ["ffmpeg", "-y", "-ss", str(start_from), "-i", tmp_path, "-c", "copy", trimmed_path],
                capture_output=True, timeout=30,
            )
            if result.returncode == 0 and os.path.exists(trimmed_path):
                _log.info(f"[{request_id}] Trimmed audio from {start_from}s")
            else:
                # Fallback: try with re-encoding if copy fails
                result = subprocess.run(
                    ["ffmpeg", "-y", "-ss", str(start_from), "-i", tmp_path, trimmed_path],
                    capture_output=True, timeout=60,
                )
                if result.returncode != 0:
                    trimmed_path = None
                    _log.warning(f"[{request_id}] ffmpeg trim failed, transcribing full file")
        except Exception as e:
            trimmed_path = None
            _log.warning(f"[{request_id}] trim failed: {e}, transcribing full file")

    def generate():
        global _transcribe_active, _transcribe_active_info
        request_record = {
            "request_id": request_id,
            "filename": audio_filename,
            "file_size_mb": round(file_size_mb, 1),
            "model": resolved,
            "language": language,
            "fast_mode": fast_mode,
            "start_time": datetime.now(timezone.utc).isoformat(),
            "status": "started",
        }

        # ── Acquire GPU lock ──
        lock_wait_start = time.time()
        acquired = _transcribe_lock.acquire(timeout=600)  # wait max 10 min
        lock_wait = time.time() - lock_wait_start
        if not acquired:
            _log.error(f"[{request_id}] TIMEOUT waiting for GPU lock after {lock_wait:.0f}s")
            request_record["status"] = "error"
            request_record["error"] = "GPU lock timeout"
            _request_history.append(request_record)
            yield f"data: {json.dumps({'type': 'error', 'error': 'Server busy — GPU lock timeout. Try again later.'})}\n\n"
            return

        if lock_wait > 1:
            _log.info(f"[{request_id}] Waited {lock_wait:.1f}s for GPU lock")

        _transcribe_active = True
        _transcribe_active_info = {"request_id": request_id, "filename": audio_filename, "started": time.time()}

        try:
            # ── Log memory BEFORE transcription ──
            _log_memory_state(f"{request_id} PRE-TRANSCRIBE")

            # ── Proactively free VRAM: unload Ollama models so Whisper has room ──
            # On 8GB-class GPUs Ollama+Whisper together always OOM. Skip if
            # client explicitly opts in to parallel mode (header).
            if share_mode != "parallel":
                gpu_now = _get_gpu_mem()
                if gpu_now and gpu_now.get("total_mb", 0) <= 10240:
                    freed = _unload_ollama_models()
                    if freed:
                        _cleanup_gpu_memory()
                        _log.info(f"[{request_id}] Pre-transcribe: freed {freed} Ollama model(s) from VRAM")

            # Tell client we're loading the model
            _log.info(f"[{request_id}] SSE: sending 'loading' event")
            yield f"data: {json.dumps({'type': 'loading', 'message': 'Loading model...', 'model': resolved})}\n\n"

            model = load_model(resolved, compute_type_override=compute_type_req)
            _log.info(f"[{request_id}] Model loaded, starting transcription...")

            transcribe_path = trimmed_path if trimmed_path else tmp_path
            actual_file_size = os.path.getsize(transcribe_path)
            beam_size = int(beam_size_req) if beam_size_req and beam_size_req.isdigit() and 1 <= int(beam_size_req) <= 5 else None
            condition_on_prev = not no_condition_prev
            ct_label = compute_type_req or 'auto'
            mode_label = "FAST (batched)" if fast_mode else "normal"
            preset_label = f", preset={preset_name}" if preset_name else ""
            hotwords_label = f", hotwords='{hotwords[:40]}'" if hotwords else ""
            lk_label = ", loshon_kodesh=ON" if loshon_kodesh else ""
            _log.info(f"[{request_id}] Transcribing: model={resolved}, lang={language}, start_from={start_from}s, mode={mode_label}, compute={ct_label}, beam={beam_size or 'default'}, batch={batch_size}, cond_prev={condition_on_prev}, vad_agg={vad_aggressive}{preset_label}{hotwords_label}{lk_label})")
            start = time.time()

            # hebrew_prompt was already resolved above (honors loshon_kodesh + initial_prompt)

            def _do_transcribe(mdl, override_batch=None):
                bs = override_batch if override_batch is not None else batch_size
                if fast_mode:
                    from faster_whisper import BatchedInferencePipeline
                    pipeline = BatchedInferencePipeline(model=mdl)
                    return pipeline.transcribe(
                        transcribe_path,
                        language=language if language != "auto" else None,
                        word_timestamps=True,
                        beam_size=beam_size or 1,
                        batch_size=bs,
                        condition_on_previous_text=condition_on_prev,
                        hotwords=hotwords,
                        initial_prompt=hebrew_prompt,
                    )
                else:
                    vad_params = dict(
                        min_silence_duration_ms=200 if vad_aggressive else 500,
                        speech_pad_ms=100 if vad_aggressive else 200,
                        threshold=0.5 if vad_aggressive else 0.35,
                    )
                    return mdl.transcribe(
                        transcribe_path,
                        language=language if language != "auto" else None,
                        word_timestamps=True,
                        beam_size=beam_size or 1,
                        vad_filter=True,
                        vad_parameters=vad_params,
                        condition_on_previous_text=condition_on_prev,
                        hotwords=hotwords,
                        initial_prompt=hebrew_prompt,
                    )

            try:
                segments_gen, info = _do_transcribe(model)
                # Force first segment to detect flash attention errors early
                segments_list = []
                first_seg = next(iter(segments_gen), None)
                if first_seg is not None:
                    segments_list.append(first_seg)
            except Exception as fa_err:
                err_str_lower = str(fa_err).lower()
                if "flash attention" in err_str_lower:
                    _log.warning(f"[{request_id}] Flash Attention failed at runtime, reloading model without it...")
                    yield f"data: {json.dumps({'type': 'loading', 'message': 'Reloading model (without Flash Attention)...', 'model': resolved})}\n\n"
                    model = _reload_model_without_flash(resolved, compute_type_override=compute_type_req)
                    segments_gen, info = _do_transcribe(model)
                    segments_list = []
                    first_seg = next(iter(segments_gen), None)
                    if first_seg is not None:
                        segments_list.append(first_seg)
                elif "out of memory" in err_str_lower and fast_mode and batch_size > 4:
                    # OOM with large batch — retry with smaller batch
                    retry_batch = 4
                    _log.warning(f"[{request_id}] GPU OOM with batch_size={batch_size}, retrying with batch_size={retry_batch}...")
                    _evict_all_whisper_models()
                    _unload_ollama_models()
                    _cleanup_gpu_memory()
                    yield f"data: {json.dumps({'type': 'loading', 'message': f'GPU memory full — retrying with smaller batch ({retry_batch})...', 'model': resolved})}\n\n"
                    model = load_model(resolved, compute_type_override=compute_type_req)
                    segments_gen, info = _do_transcribe(model, override_batch=retry_batch)
                    segments_list = []
                    first_seg = next(iter(segments_gen), None)
                    if first_seg is not None:
                        segments_list.append(first_seg)
                elif "out of memory" in err_str_lower:
                    # OOM with batch already small — free VRAM and retry once with batch=2
                    retry_batch = 2
                    _log.warning(f"[{request_id}] GPU OOM (batch={batch_size}) — freeing VRAM and retrying with batch_size={retry_batch}...")
                    _evict_all_whisper_models()
                    freed = _unload_ollama_models()
                    _cleanup_gpu_memory()
                    yield f"data: {json.dumps({'type': 'loading', 'message': f'GPU memory full — freed {freed} model(s), retrying...', 'model': resolved})}\n\n"
                    model = load_model(resolved, compute_type_override=compute_type_req)
                    segments_gen, info = _do_transcribe(model, override_batch=retry_batch)
                    segments_list = []
                    first_seg = next(iter(segments_gen), None)
                    if first_seg is not None:
                        segments_list.append(first_seg)
                else:
                    raise

            # Chain pre-fetched segments with the rest of the generator
            import itertools
            segments_gen = itertools.chain(segments_list, segments_gen)

            duration = info.duration or 1.0
            total_duration = duration + start_from  # Full original audio duration

            # First event: metadata with audio duration
            _log.info(f"[{request_id}] SSE: 'info' event (duration={total_duration:.1f}s, lang={info.language})")
            yield f"data: {json.dumps({'type': 'info', 'duration': round(total_duration, 2), 'model': resolved, 'language': info.language, 'start_from': start_from})}\n\n"

            all_text_parts = []
            all_word_timings = []
            segment_count = 0
            prev_seg_end = start_from  # Track previous segment end for paragraph detection
            last_progress_log = 0

            for segment in segments_gen:
                seg_text = segment.text.strip()
                if not seg_text:
                    continue

                segment_count += 1

                # Paragraph detection: if gap between segments exceeds threshold, insert break
                is_paragraph_break = False
                if paragraph_threshold > 0 and prev_seg_end > 0:
                    gap = segment.start - prev_seg_end
                    if gap >= paragraph_threshold:
                        is_paragraph_break = True

                all_text_parts.append(seg_text)

                seg_words = []
                if segment.words:
                    for w in segment.words:
                        # Offset timestamps by start_from so they match original audio
                        wt = {"word": w.word.strip(), "start": round(w.start + start_from, 3), "end": round(w.end + start_from, 3), "probability": round(w.probability, 3)}
                        seg_words.append(wt)
                        all_word_timings.append(wt)

                # Progress is relative to the full audio
                seg_end_in_original = segment.end + start_from
                progress = min(99, round((seg_end_in_original / total_duration) * 100))

                # Log progress every 10% to avoid log spam
                if progress >= last_progress_log + 10:
                    elapsed_so_far = time.time() - start
                    _log.info(f"[{request_id}] progress={progress}% segments={segment_count} words={len(all_word_timings)} elapsed={elapsed_so_far:.1f}s")
                    last_progress_log = progress

                yield f"data: {json.dumps({'type': 'segment', 'text': seg_text, 'words': seg_words, 'progress': progress, 'segEnd': round(seg_end_in_original, 2), 'paragraphBreak': is_paragraph_break})}\n\n"
                prev_seg_end = segment.end

            elapsed = time.time() - start
            full_text = " ".join(all_text_parts)

            rtf = round(elapsed / duration, 2) if duration > 0 else 0
            _log.info(f"[{request_id}] DONE: {elapsed:.1f}s processing, {len(all_word_timings)} words, {duration:.1f}s audio, RTF={rtf}")

            stats = {
                'type': 'done',
                'text': full_text,
                'wordTimings': all_word_timings,
                'duration': round(total_duration, 2),
                'processing_time': round(elapsed, 2),
                'model': resolved,
                'start_from': start_from,
                'rtf': rtf,
                'file_size': actual_file_size,
                'compute_type': compute_type_req or ('float16' if get_device() == 'cuda' else 'int8'),
                'beam_size': beam_size or (1 if fast_mode else 5),
                'fast_mode': fast_mode,
            }
            yield f"data: {json.dumps(stats)}\n\n"

            # ── Record success in request history ──
            request_record["status"] = "success"
            request_record["duration_audio"] = round(total_duration, 1)
            request_record["processing_time"] = round(elapsed, 1)
            request_record["rtf"] = rtf
            request_record["segments"] = segment_count
            request_record["words"] = len(all_word_timings)

            # Record performance metric for this model
            if total_duration > 0:
                _record_metric(resolved, rtf)

        except Exception as e:
            elapsed = time.time() - start if 'start' in dir() else time.time() - request_start
            error_str = str(e)
            error_type = type(e).__name__

            # ── Detect specific error categories ──
            is_cuda_oom = "out of memory" in error_str.lower() or "CUDA" in error_str
            is_corrupt_file = "Invalid data" in error_str or "Errno 1094995529" in error_str
            is_empty_file = "Invalid data" in error_str and file_size_bytes < 1024

            if is_cuda_oom:
                _log.error(f"[{request_id}] CUDA OUT OF MEMORY: {error_str}")
                _log.error(f"[{request_id}] Cleaning GPU memory...")
                _cleanup_gpu_memory()
                user_error = "GPU out of memory — try a shorter audio file or use fast_mode=1"
            elif is_corrupt_file:
                _log.error(f"[{request_id}] CORRUPT/INVALID FILE: {audio_filename} ({file_size_mb:.1f} MB)")
                user_error = f"Invalid audio file: {audio_filename}"
            elif is_empty_file:
                _log.error(f"[{request_id}] EMPTY FILE: {audio_filename}")
                user_error = "Empty or invalid audio file"
            else:
                _log.error(f"[{request_id}] ERROR ({error_type}): {error_str}")
                _log.error(f"[{request_id}] Traceback:\n{_tb_module.format_exc()}")
                user_error = error_str

            request_record["status"] = "error"
            request_record["error"] = f"{error_type}: {error_str[:200]}"
            request_record["error_category"] = "cuda_oom" if is_cuda_oom else "corrupt_file" if is_corrupt_file else "unknown"

            yield f"data: {json.dumps({'type': 'error', 'error': user_error, 'error_type': error_type, 'request_id': request_id})}\n\n"

        finally:
            # ── Always release GPU lock ──
            _transcribe_active = False
            _transcribe_active_info = None
            _transcribe_lock.release()

            # ── Cleanup temp files ──
            for path in [tmp_path, trimmed_path]:
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass

            # ── Post-transcription GPU cleanup ──
            _cleanup_gpu_memory()
            _log_memory_state(f"{request_id} POST-TRANSCRIBE")

            # ── Record in history ──
            request_record["end_time"] = datetime.now(timezone.utc).isoformat()
            request_record["total_wall_time"] = round(time.time() - request_start, 1)
            _request_history.append(request_record)

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/transcribe-live", methods=["POST"])
def transcribe_live():
    """Transcribe a short audio chunk for live/real-time transcription.

    Optimized for low-latency: uses beam_size=1, no VAD filter.
    Accepts audio chunks (typically 2-3 seconds each).
    Final mode (final=1): beam_size=3 + VAD + word timestamps for best accuracy.

    Form params:
        file: audio chunk (webm/wav/etc)
        model: whisper model id (optional)
        language: language code (optional, default 'he')
        final: '1' for final refine pass after stop
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "he")
    model_id = request.form.get("model", _current_model_id or _default_model_for(language))
    is_final = str(request.form.get("final", "0")).lower() in ("1", "true", "yes")
    # Context from previous chunk (last N words) — used as initial_prompt for continuity
    live_context = request.form.get("context", "").strip()

    resolved = MODEL_REGISTRY.get(model_id, model_id)
    suffix = _safe_suffix(audio_file.filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    # Quick silence detection: skip tiny files that are almost certainly silence.
    file_size = os.path.getsize(tmp_path)
    if not is_final and file_size < 2000:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return jsonify({"text": "", "wordTimings": [], "processing_time": 0, "audio_duration": 0, "silent": True})

    # Live requests should not run inference in parallel on a single GPU.
    # A short lock timeout keeps latency predictable and avoids queue buildup.
    live_lock_wait = time.time()
    acquired = _transcribe_lock.acquire(timeout=6.0)
    if not acquired:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return jsonify({
            "error": "Server busy (GPU) — try again",
            "retry_after_ms": 500,
        }), 429

    try:
        model = load_model(resolved)
        start = time.time()

        def _run_live(m):
            # Live mode: beam_size=2, VAD=True for better quality on 5s chunks.
            # Final mode: beam_size=3 for best quality, with VAD/word-timestamps.
            beam_size = 3 if is_final else 2
            vad_filter = True  # always filter silence — prevents garbage transcription
            with_timestamps = True if is_final else False
            # Build initial_prompt: combine Hebrew prefix + previous chunk context
            if is_final:
                prompt = "תמלול בעברית." if language == "he" else None
            elif live_context:
                # Carry last words from previous chunk for linguistic continuity
                prompt = f"תמלול בעברית. {live_context}" if language == "he" else live_context
            else:
                prompt = "תמלול בעברית." if language == "he" else None
            segments, info = m.transcribe(
                tmp_path,
                language=language if language != "auto" else None,
                word_timestamps=with_timestamps,
                beam_size=beam_size,
                vad_filter=vad_filter,
                condition_on_previous_text=True if is_final else False,
                without_timestamps=not with_timestamps,
                temperature=0.0,
                no_speech_threshold=0.6,
                suppress_blank=True,
                initial_prompt=prompt,
            )
            # Materialize segments to surface errors (e.g. flash attention)
            # inside this function rather than during lazy iteration.
            return list(segments), info

        try:
            segments, info = _run_live(model)
        except Exception as fa_err:
            if "flash attention" in str(fa_err).lower():
                model = _reload_model_without_flash(resolved)
                segments, info = _run_live(model)
            else:
                raise

        text_parts = []
        word_timings = []
        total_prob = 0.0
        prob_count = 0
        for segment in segments:
            seg_text = segment.text.strip()
            if not seg_text:
                continue
            text_parts.append(seg_text)
            if segment.words:
                for w in segment.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    })
                    total_prob += w.probability
                    prob_count += 1

        text = " ".join(text_parts)
        elapsed = time.time() - start
        avg_confidence = round(total_prob / prob_count, 3) if prob_count > 0 else None

        return jsonify({
            "text": text,
            "wordTimings": word_timings,
            "processing_time": round(elapsed, 3),
            "audio_duration": round(info.duration, 2),
            "lock_wait_ms": round((time.time() - live_lock_wait) * 1000, 1),
            "final": is_final,
            "confidence": avg_confidence,
        })

    except Exception as e:
        _log.error(f"Live transcription error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            _transcribe_lock.release()
        except RuntimeError:
            pass
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ─── YouTube URL Download + Transcribe ────────────────────────────────────────

# ============================================================
# YouTube Module — yt-dlp + ffmpeg job pipeline
# ============================================================
# Endpoints:
#   POST /yt/info           → metadata (title, duration, thumbnail, hebrew subs?)
#   POST /yt/job            → start async job: audio/video/transcribe/full
#   GET  /yt/status/<id>    → poll progress + output files
#   GET  /yt/file/<id>/<name> → download a produced file
# ============================================================
_YT_JOBS: dict = {}
_YT_JOBS_LOCK = threading.Lock()
_YT_ROOT = Path(tempfile.gettempdir()) / "lovable_yt"
_YT_ROOT.mkdir(exist_ok=True)
_YT_URL_RE = __import__("re").compile(
    r"^https?://(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[\w\-]+"
)

# Parses yt-dlp progress lines:
# [download]  35.4% of  123.45MiB at    2.34MiB/s ETA 00:45
_YT_PROGRESS_RE = __import__("re").compile(
    r'\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(KiB|MiB|GiB)(?:.*?at\s+([\d.]+)(KiB|MiB|GiB)/s)?',
    __import__("re").IGNORECASE,
)

def _mb(val: float, unit: str) -> float:
    """Convert KiB/MiB/GiB value to MiB."""
    u = unit.lower()
    if u == "kib": return val / 1024.0
    if u == "gib": return val * 1024.0
    return float(val)

def _yt_update(job_id: str, **patch):
    with _YT_JOBS_LOCK:
        if job_id in _YT_JOBS:
            _YT_JOBS[job_id].update(patch)
            _YT_JOBS[job_id]["updated_at"] = time.time()

def _yt_has_ytdlp() -> bool:
    import subprocess
    try:
        subprocess.run(["yt-dlp", "--version"], capture_output=True, timeout=10, check=True)
        return True
    except Exception:
        return False

def _run_ytdlp(cmd: list, job_id: str, track_key: str = "dl", timeout: int = 900,
               progress_range: tuple = (10, 48)) -> None:
    """
    Run yt-dlp, stream output line-by-line, parse progress and update
    _YT_JOBS[job_id] in real-time with download speed + progress fields.

    Fields written to the job dict (prefixed by track_key):
        {key}_pct          — % complete (0–100)
        {key}_dl_mb        — MB downloaded so far
        {key}_total_mb     — total file size in MB
        {key}_speed_mb     — current speed in MB/s

    Also updates progress_pct (overall 0–100) mapped to progress_range.
    """
    import subprocess, threading
    stderr_lines: list = []

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    def _read_stderr():
        for line in proc.stderr:
            stderr_lines.append(line.rstrip())

    stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
    stderr_thread.start()

    p_start, p_end = progress_range
    for raw_line in proc.stdout:
        line = raw_line.rstrip()
        m = _YT_PROGRESS_RE.search(line)
        if m:
            pct = float(m.group(1))
            total_mb = _mb(float(m.group(2)), m.group(3))
            dl_mb = round(total_mb * pct / 100.0, 2)
            overall_pct = round(p_start + (pct / 100.0) * (p_end - p_start), 1)
            patch: dict = {
                f"{track_key}_pct": pct,
                f"{track_key}_dl_mb": dl_mb,
                f"{track_key}_total_mb": round(total_mb, 2),
                "progress_pct": overall_pct,
            }
            if m.group(4):
                patch[f"{track_key}_speed_mb"] = round(_mb(float(m.group(4)), m.group(5)), 2)
            _yt_update(job_id, **patch)

    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        stderr_thread.join(2)
        raise RuntimeError(f"yt-dlp timed out after {timeout}s")

    stderr_thread.join(5)

    if proc.returncode != 0:
        err_tail = "\n".join(stderr_lines[-5:]) or "unknown error"
        raise RuntimeError(f"yt-dlp failed (rc={proc.returncode}): {err_tail[:400]}")

def _yt_audio_fmt_args(audio_format: str) -> list:
    """Return yt-dlp -f / postprocess args for the requested audio format."""
    if audio_format == "best":
        # Native — no re-encode, fastest
        return ["-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"]
    if audio_format in ("mp3", "wav", "opus", "m4a"):
        return ["-f", "bestaudio", "--extract-audio", "--audio-format", audio_format, "--audio-quality", "0"]
    return ["-f", "bestaudio"]

# Speed + reliability flags shared by all yt-dlp invocations
_YT_SPEED_FLAGS = [
    "--concurrent-fragments", "4",  # parallel fragment download
    "--buffer-size", "65536",       # 64KB read buffer
    "--retries", "10",              # retry failed downloads
    "--fragment-retries", "10",     # retry failed fragments
    "--continue",                   # resume interrupted downloads
    "--newline",                    # one progress line per newline (for parsing)
]

def _yt_run_job(job_id: str, params: dict):
    import subprocess, shutil, json as _json
    from concurrent.futures import ThreadPoolExecutor, as_completed
    job_dir = _YT_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    url = params["url"]
    mode = params.get("mode", "audio")
    audio_format = params.get("audio_format", "best")
    video_quality = params.get("video_quality", "720")
    outputs: list = []

    try:
        _yt_update(job_id, status="downloading", progress_pct=10)

        def _download_audio(prog_range=(10, 48)):
            tmpl = str(job_dir / "audio.%(ext)s")
            cmd = (["yt-dlp", "--no-playlist", "-o", tmpl]
                   + _YT_SPEED_FLAGS
                   + _yt_audio_fmt_args(audio_format)
                   + [url])
            _run_ytdlp(cmd, job_id, track_key="audio", timeout=900,
                       progress_range=prog_range)
            af = next((p for p in job_dir.iterdir()
                       if p.name.startswith("audio.") and not p.suffix == ".part"), None)
            if not af:
                raise RuntimeError("Audio file not produced")
            return af

        def _download_video(prog_range=(10, 48)):
            tmpl = str(job_dir / "video.%(ext)s")
            fmt = f"bestvideo[height<={video_quality}]+bestaudio/best[height<={video_quality}]"
            cmd = (["yt-dlp", "--no-playlist", "-f", fmt,
                    "--merge-output-format", "mp4", "-o", tmpl]
                   + _YT_SPEED_FLAGS
                   + [url])
            _run_ytdlp(cmd, job_id, track_key="video", timeout=1800,
                       progress_range=prog_range)
            return next((p for p in job_dir.iterdir()
                         if p.name.startswith("video.") and not p.suffix == ".part"), None)

        # AUDIO branch (audio/transcribe/full)
        need_audio = mode in ("audio", "transcribe", "full")
        need_video = mode in ("video", "full")

        audio_file = None
        video_file = None

        if need_audio and need_video:
            # Download audio + video in parallel; split overall progress range
            with ThreadPoolExecutor(max_workers=2) as ex:
                fut_audio = ex.submit(_download_audio, (10, 30))
                fut_video = ex.submit(_download_video, (30, 48))
                audio_file = fut_audio.result()
                video_file = fut_video.result()
        elif need_audio:
            audio_file = _download_audio()
        elif need_video:
            video_file = _download_video()

        if audio_file:
            outputs.append({
                "kind": "audio",
                "url": f"/yt/file/{job_id}/{audio_file.name}",
                "filename": audio_file.name,
                "size": audio_file.stat().st_size,
            })
        if video_file:
            outputs.append({
                "kind": "video",
                "url": f"/yt/file/{job_id}/{video_file.name}",
                "filename": video_file.name,
                "size": video_file.stat().st_size,
            })
        _yt_update(job_id, progress_pct=50, output_files=outputs)

        # TRANSCRIBE branch
        if mode in ("transcribe", "full"):
            _yt_update(job_id, status="transcribing", progress_pct=75)
            audio_file = next((p for p in job_dir.iterdir() if p.name.startswith("audio.")), None)
            if not audio_file:
                raise RuntimeError("No audio to transcribe")
            target_model = _current_model_id or DEFAULT_MODEL
            resolved = MODEL_REGISTRY.get(target_model, target_model)
            model = load_model(resolved)
            with _transcribe_lock:
                from faster_whisper import BatchedInferencePipeline
                pipeline = BatchedInferencePipeline(model=model)
                segs_gen, info = pipeline.transcribe(
                    str(audio_file),
                    language="he",
                    beam_size=3,
                    word_timestamps=True,
                    batch_size=auto_batch_size(),
                    initial_prompt="תמלול שיחה בעברית.",
                )
                segments = list(segs_gen)

            # Write TXT
            txt_path = job_dir / "transcript.txt"
            txt_path.write_text(
                " ".join(s.text.strip() for s in segments if s.text.strip()),
                encoding="utf-8",
            )
            # Write SRT
            def _ts(t):
                h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
                return f"{h:02d}:{m:02d}:{int(s):02d},{int((s - int(s)) * 1000):03d}"
            srt_lines = []
            for i, seg in enumerate(segments, 1):
                srt_lines.append(f"{i}\n{_ts(seg.start)} --> {_ts(seg.end)}\n{seg.text.strip()}\n")
            (job_dir / "transcript.srt").write_text("\n".join(srt_lines), encoding="utf-8")
            # Write JSON
            (job_dir / "transcript.json").write_text(_json.dumps({
                "language": info.language,
                "duration": info.duration,
                "segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments],
            }, ensure_ascii=False, indent=2), encoding="utf-8")

            for kind, name in [("txt", "transcript.txt"), ("srt", "transcript.srt"), ("json", "transcript.json")]:
                outputs.append({
                    "kind": kind,
                    "url": f"/yt/file/{job_id}/{name}",
                    "filename": name,
                    "size": (job_dir / name).stat().st_size,
                })
            _yt_update(job_id, progress_pct=95, output_files=outputs)

        _yt_update(job_id, status="done", progress_pct=100, output_files=outputs)
    except Exception as exc:
        _yt_update(job_id, status="error", error=str(exc))


@app.route("/yt/info", methods=["POST"])
def yt_info():
    import subprocess, json as _json
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    if not url or not _YT_URL_RE.match(url):
        return jsonify({"error": "Invalid YouTube URL"}), 400
    if not _yt_has_ytdlp():
        return jsonify({"error": "yt-dlp not installed"}), 500
    try:
        r = subprocess.run(
            ["yt-dlp", "--no-playlist", "--dump-single-json", "--skip-download", url],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            return jsonify({"error": f"yt-dlp: {r.stderr[:300]}"}), 500
        info = _json.loads(r.stdout)
        subs = list((info.get("subtitles") or {}).keys()) + list((info.get("automatic_captions") or {}).keys())
        return jsonify({
            "id": info.get("id"),
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail"),
            "uploader": info.get("uploader"),
            "duration": info.get("duration"),
            "subtitles": subs,
            "formats": [
                {"format_id": f.get("format_id"), "ext": f.get("ext"), "abr": f.get("abr"), "vbr": f.get("vbr"), "filesize": f.get("filesize")}
                for f in (info.get("formats") or [])[:50]
            ],
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/yt/job", methods=["POST"])
def yt_job_start():
    import uuid
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    mode = data.get("mode", "audio")
    if not url or not _YT_URL_RE.match(url):
        return jsonify({"error": "Invalid YouTube URL"}), 400
    if mode not in ("audio", "video", "transcribe", "full"):
        return jsonify({"error": "Invalid mode"}), 400
    if not _yt_has_ytdlp():
        return jsonify({"error": "yt-dlp not installed"}), 500

    job_id = uuid.uuid4().hex[:16]
    with _YT_JOBS_LOCK:
        _YT_JOBS[job_id] = {
            "id": job_id, "status": "pending", "progress_pct": 0,
            "output_files": [], "error": None,
            # real-time download metrics (updated during download)
            "audio_pct": 0, "audio_dl_mb": 0, "audio_total_mb": 0, "audio_speed_mb": 0,
            "video_pct": 0, "video_dl_mb": 0, "video_total_mb": 0, "video_speed_mb": 0,
            "created_at": time.time(), "updated_at": time.time(),
        }
    t = threading.Thread(target=_yt_run_job, args=(job_id, data), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})


@app.route("/yt/status/<job_id>", methods=["GET"])
def yt_job_status(job_id):
    with _YT_JOBS_LOCK:
        job = _YT_JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(dict(job))


@app.route("/yt/file/<job_id>/<path:name>", methods=["GET"])
def yt_job_file(job_id, name):
    from flask import send_file
    safe = name.replace("..", "").lstrip("/\\")
    fpath = _YT_ROOT / job_id / safe
    if not fpath.is_file():
        return jsonify({"error": "File not found"}), 404
    return send_file(str(fpath), as_attachment=True, download_name=safe)


@app.route("/youtube-transcribe", methods=["POST"])
def youtube_transcribe():
    """Download audio from a YouTube URL using yt-dlp and transcribe it.
    Expects JSON body: { url, language?, model? }
    """
    import re as _re
    import subprocess

    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    language = data.get("language", "he")
    model_id = data.get("model") or _default_model_for(language)

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    # Basic URL validation — only allow YouTube domains
    yt_pattern = r'^https?://(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w\-]+'
    if not _re.match(yt_pattern, url):
        return jsonify({"error": "Invalid YouTube URL"}), 400

    # Check yt-dlp availability
    try:
        subprocess.run(["yt-dlp", "--version"], capture_output=True, timeout=10, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return jsonify({"error": "yt-dlp not installed. Install with: pip install yt-dlp"}), 500

    tmp_dir = tempfile.mkdtemp(prefix="yt_")
    output_template = os.path.join(tmp_dir, "audio.%(ext)s")

    try:
        # Download audio only using yt-dlp
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--extract-audio",
            "--audio-format", "wav",
            "--audio-quality", "0",
            "--max-filesize", f"{MAX_UPLOAD_SIZE_MB}m",
            "--output", output_template,
            "--no-post-overwrites",
            url,
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0:
            return jsonify({"error": f"yt-dlp failed: {result.stderr[:500]}"}), 500

        # Find downloaded file
        audio_file = None
        for f in os.listdir(tmp_dir):
            if f.startswith("audio"):
                audio_file = os.path.join(tmp_dir, f)
                break

        if not audio_file or not os.path.isfile(audio_file):
            return jsonify({"error": "Failed to download audio from YouTube"}), 500

        file_size_mb = os.path.getsize(audio_file) / (1024 * 1024)
        if file_size_mb > MAX_UPLOAD_SIZE_MB:
            return jsonify({"error": f"Audio too large ({file_size_mb:.1f}MB > {MAX_UPLOAD_SIZE_MB}MB)"}), 400

        # Model handling
        target_model = model_id or _current_model_id or DEFAULT_MODEL
        resolved = MODEL_REGISTRY.get(target_model, target_model)

        model = load_model(resolved)

        # Transcribe
        start_time = time.time()
        hebrew_prompt = "תמלול שיחה בעברית." if language == "he" else None
        with _transcribe_lock:
            from faster_whisper import BatchedInferencePipeline
            pipeline = BatchedInferencePipeline(model=model)
            segments_gen, info = pipeline.transcribe(
                audio_file,
                language=language if language != "auto" else None,
                beam_size=3,
                word_timestamps=True,
                batch_size=auto_batch_size(),
                initial_prompt=hebrew_prompt,
            )
            segments = list(segments_gen)

        elapsed = time.time() - start_time

        full_text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
        word_timings = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 4),
                    })

        return jsonify({
            "text": full_text,
            "wordTimings": word_timings,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(info.duration, 2),
            "processing_time": round(elapsed, 2),
            "segments": len(segments),
            "source": "youtube",
            "url": url,
        })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "YouTube download timed out (120s limit)"}), 504
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        # Cleanup temp dir
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.route("/stage-audio", methods=["POST"])
def stage_audio():
    """Pre-upload audio file while model loads in parallel.
    Returns a stage_id that can be used in /transcribe-stream instead of uploading again.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    filename = audio_file.filename or "audio.webm"
    suffix = _safe_suffix(filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    stage_id = str(uuid.uuid4())
    _staged_files[stage_id] = {
        "path": tmp_path,
        "filename": filename,
        "timestamp": time.time(),
    }

    file_size = os.path.getsize(tmp_path)
    print(f"  [stage] Staged audio: {filename} ({file_size / 1024:.0f} KB) → stage_id={stage_id[:8]}...")

    return jsonify({
        "stage_id": stage_id,
        "filename": filename,
        "file_size": file_size,
    })


# ════════════════════════════════════════════════════════════════════
#  CONVERT AUDIO — server-side FFmpeg conversion with streaming progress
# ════════════════════════════════════════════════════════════════════

_CONVERT_ALLOWED_SUFFIXES = frozenset({
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".3gp",
    ".ogv", ".ts", ".mts", ".m2ts", ".vob", ".mpg", ".mpeg",
    ".m4a", ".wav", ".ogg", ".flac", ".aac", ".wma", ".opus", ".amr",
})

_CONVERT_OUTPUT_FORMATS = {
    "mp3": {
        "suffix": ".mp3",
        "mimetype": "audio/mpeg",
        "ffmpeg_args": ["-acodec", "libmp3lame", "-ab", "192k", "-ar", "44100", "-ac", "2"],
    },
    "opus": {
        "suffix": ".opus",
        "mimetype": "audio/opus",
        "ffmpeg_args": ["-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-compression_level", "10", "-ar", "48000", "-ac", "2"],
    },
    "aac": {
        "suffix": ".m4a",
        "mimetype": "audio/mp4",
        "ffmpeg_args": ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"],
    },
}

_ENHANCE_PRESET_FILTERS = {
    # Non-AI baseline: cleanup + balanced speech presence
    "clean": "highpass=f=80,lowpass=f=15000,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=8:release=220,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95",
    # AI-like voice profile (no external model dependency): stronger denoise + clarity
    "ai_voice": "afftdn=nf=-24,highpass=f=100,lowpass=f=13500,equalizer=f=2600:t=q:w=1.0:g=4,equalizer=f=7000:t=q:w=1.8:g=-3,acompressor=threshold=-24dB:ratio=5:attack=5:release=180,loudnorm=I=-16:TP=-1.5:LRA=9,alimiter=limit=0.95",
    "podcast": "highpass=f=70,equalizer=f=180:t=q:w=1.0:g=2,equalizer=f=2800:t=q:w=1.1:g=2.5,acompressor=threshold=-18dB:ratio=2.8:attack=10:release=260,loudnorm=I=-16:TP=-1.5:LRA=10,alimiter=limit=0.97",
    "broadcast": "afftdn=nf=-20,highpass=f=90,lowpass=f=14000,equalizer=f=3000:t=q:w=1.1:g=3,acompressor=threshold=-22dB:ratio=4:attack=6:release=180,loudnorm=I=-16:TP=-1.5:LRA=8,alimiter=limit=0.95",
}

# AI enhancement presets (neural network based) — loaded lazily
_AI_ENHANCE_PRESETS = {"ai_denoise", "ai_enhance", "ai_full", "ai_hebrew"}

@app.route("/convert-mp3", methods=["POST"])
def convert_mp3():
    """Convert uploaded audio/video file to requested audio format using server-side FFmpeg.
    Supported output formats: mp3, opus, aac.
    Returns the converted file directly, or streams SSE progress if Accept: text/event-stream.
    """
    if not _check_ffmpeg():
        return jsonify({"error": "FFmpeg not available on server"}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    filename = audio_file.filename or "input.mp4"
    suffix = Path(filename).suffix.lower()
    if suffix not in _CONVERT_ALLOWED_SUFFIXES:
        return jsonify({"error": f"Unsupported format: {suffix}"}), 415

    output_format = (request.form.get("output_format") or "mp3").strip().lower()
    output_cfg = _CONVERT_OUTPUT_FORMATS.get(output_format)
    if not output_cfg:
        return jsonify({"error": f"Unsupported output format: {output_format}"}), 415

    # Save uploaded file to temp
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        audio_file.save(tmp_in)
        input_path = tmp_in.name

    output_suffix = output_cfg["suffix"]
    output_mimetype = output_cfg["mimetype"]
    ffmpeg_audio_args = output_cfg["ffmpeg_args"]
    output_path = input_path + output_suffix
    request_id = f"conv-{int(time.time() * 1000) % 1000000:06d}"
    _log.info(
        f"[{request_id}] convert-mp3 start: in={filename} fmt={output_format} "
        f"size={os.path.getsize(input_path)} bytes"
    )
    staged_output_id = None

    try:
        import subprocess

        # If client wants SSE streaming progress
        if "text/event-stream" in request.headers.get("Accept", ""):
            def generate():
                try:
                    _log.info(f"[{request_id}] convert-mp3 using SSE streaming")
                    proc = subprocess.Popen(
                        ["ffmpeg", "-y", "-i", input_path,
                         "-vn", *ffmpeg_audio_args,
                         "-progress", "pipe:1", "-nostats",
                         output_path],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        text=True, encoding="utf-8", errors="replace",
                    )

                    # Parse duration from stderr in background
                    duration = [0.0]
                    def read_stderr():
                        for line in proc.stderr:
                            m = __import__("re").search(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", line)
                            if m:
                                duration[0] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 100

                    t = threading.Thread(target=read_stderr, daemon=True)
                    t.start()

                    # Parse progress from stdout
                    for line in proc.stdout:
                        line = line.strip()
                        if line.startswith("out_time_ms="):
                            try:
                                us = int(line.split("=", 1)[1])
                                current_sec = us / 1_000_000
                                if duration[0] > 0:
                                    pct = min(99, round(current_sec / duration[0] * 100))
                                    yield f"data: {json.dumps({'progress': pct})}\n\n"
                            except ValueError:
                                pass
                        elif line == "progress=end":
                            break

                    proc.wait(timeout=600)
                    t.join(timeout=5)

                    if proc.returncode != 0 or not os.path.exists(output_path):
                        _log.error(f"[{request_id}] FFmpeg failed (SSE path), returncode={proc.returncode}")
                        yield f"data: {json.dumps({'error': 'FFmpeg conversion failed'})}\n\n"
                        return

                    # Stage the output for download
                    import uuid as _uuid
                    stage_id = str(_uuid.uuid4())
                    output_name = Path(filename).stem + output_suffix
                    nonlocal staged_output_id
                    staged_output_id = stage_id
                    _staged_files[stage_id] = {
                        "path": output_path,
                        "filename": output_name,
                        "mimetype": output_mimetype,
                        "timestamp": time.time(),
                    }
                    file_size = os.path.getsize(output_path)
                    _log.info(
                        f"[{request_id}] convert-mp3 staged output: "
                        f"stage_id={stage_id[:8]}..., size={file_size} bytes, name={output_name}"
                    )
                    yield f"data: {json.dumps({'progress': 100, 'done': True, 'file_size': file_size, 'download_id': stage_id})}\n\n"
                finally:
                    # Cleanup input only; output stays for download
                    try:
                        os.unlink(input_path)
                    except OSError:
                        pass

            return Response(generate(), mimetype="text/event-stream",
                            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

        # Non-streaming: convert and return file directly
        _log.info(f"[{request_id}] convert-mp3 using direct response")
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-vn", *ffmpeg_audio_args,
             output_path],
            capture_output=True, timeout=600,
        )

        if result.returncode != 0 or not os.path.exists(output_path):
            _log.error(f"[{request_id}] FFmpeg failed (direct path), returncode={result.returncode}")
            return jsonify({"error": "FFmpeg conversion failed",
                            "details": result.stderr.decode("utf-8", errors="replace")[-500:]}), 500

        output_name = Path(filename).stem + output_suffix

        from flask import send_file
        return send_file(output_path, mimetype=output_mimetype,
                 as_attachment=True, download_name=output_name)
    except subprocess.TimeoutExpired:
        _log.error(f"[{request_id}] convert-mp3 timeout (600s)")
        return jsonify({"error": "Conversion timed out (10 min limit)"}), 504
    except Exception as e:
        _log.error(f"[{request_id}] convert-mp3 error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        # Keep staged output file alive for /convert-mp3/download/<stage_id>.
        # It will be deleted after download or by TTL cleanup thread.
        paths_to_cleanup = [input_path]
        if staged_output_id is None:
            paths_to_cleanup.append(output_path)
        for p in paths_to_cleanup:
            try:
                os.unlink(p)
            except OSError:
                pass


@app.route("/convert-mp3/download/<path:stage_id>", methods=["GET"])
def convert_mp3_download(stage_id):
    """Download a completed SSE conversion result by stage_id."""
    info = _staged_files.pop(stage_id, None)
    if not info or not os.path.exists(info.get("path", "")):
        _log.warning(f"[convert-download] missing/expired stage_id={stage_id[:8]}...")
        return jsonify({"error": "File not found or expired"}), 404
    from flask import send_file, after_this_request

    file_path = info["path"]

    @after_this_request
    def _cleanup_downloaded_file(response):
        try:
            os.unlink(file_path)
        except OSError:
            pass
        return response

    _log.info(
        f"[convert-download] serving stage_id={stage_id[:8]}..., "
        f"filename={info.get('filename', 'output.mp3')}"
    )
    return send_file(info["path"], mimetype=info.get("mimetype", "application/octet-stream"),
                     as_attachment=True, download_name=info.get("filename", "output.mp3"))


@app.route("/enhance-audio", methods=["POST"])
def enhance_audio():
    """Enhance uploaded audio/video and return a new processed audio file.

    Form fields:
      - file: uploaded input media
      - output_format: mp3|opus|aac (default: mp3)
      - preset: clean|ai_voice|podcast|broadcast|ai_denoise|ai_enhance|ai_full|ai_hebrew
    """
    if not _check_ffmpeg():
        return jsonify({"error": "FFmpeg not available on server"}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    media_file = request.files["file"]
    filename = media_file.filename or "input.wav"
    suffix = Path(filename).suffix.lower()
    if suffix not in _CONVERT_ALLOWED_SUFFIXES:
        return jsonify({"error": f"Unsupported format: {suffix}"}), 415

    output_format = (request.form.get("output_format") or "mp3").strip().lower()
    output_cfg = _CONVERT_OUTPUT_FORMATS.get(output_format)
    if not output_cfg:
        return jsonify({"error": f"Unsupported output format: {output_format}"}), 415

    preset = (request.form.get("preset") or "clean").strip().lower()
    is_ai_preset = preset in _AI_ENHANCE_PRESETS
    filter_chain = _ENHANCE_PRESET_FILTERS.get(preset) if not is_ai_preset else None

    if not is_ai_preset and not filter_chain:
        return jsonify({"error": f"Unsupported preset: {preset}. Available: {list(_ENHANCE_PRESET_FILTERS.keys()) + list(_AI_ENHANCE_PRESETS)}"}), 415

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        media_file.save(tmp_in)
        input_path = tmp_in.name

    output_suffix = output_cfg["suffix"]
    output_mimetype = output_cfg["mimetype"]
    ffmpeg_audio_args = output_cfg["ffmpeg_args"]
    output_path = input_path + f".enhanced{output_suffix}"

    try:
        import subprocess

        if is_ai_preset:
            # ── AI neural enhancement pipeline ──
            try:
                from ai_enhance import run_ai_enhance
            except ImportError:
                return jsonify({"error": "AI enhancement engine not available. Install: pip install speechbrain noisereduce soundfile"}), 503

            ai_wav_path = input_path + ".ai_enhanced.wav"
            try:
                run_ai_enhance(preset, input_path, ai_wav_path)

                # Encode AI-enhanced WAV to requested output format
                result = subprocess.run(
                    ["ffmpeg", "-y", "-i", ai_wav_path, "-vn", *ffmpeg_audio_args, output_path],
                    capture_output=True, timeout=300,
                )
                if result.returncode != 0 or not os.path.exists(output_path):
                    return jsonify({
                        "error": "FFmpeg encoding of AI-enhanced audio failed",
                        "details": result.stderr.decode("utf-8", errors="replace")[-700:],
                    }), 500
            except Exception as ai_err:
                import traceback
                _log.error(f"AI enhance error ({preset}): {ai_err}\n{traceback.format_exc()}")
                return jsonify({"error": f"AI enhancement failed: {str(ai_err)}"}), 500
            finally:
                try:
                    os.unlink(ai_wav_path)
                except OSError:
                    pass
        else:
            # ── Classic FFmpeg filter chain ──
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-vn",
                    "-af", filter_chain,
                    *ffmpeg_audio_args,
                    output_path,
                ],
                capture_output=True,
                timeout=600,
            )

            if result.returncode != 0 or not os.path.exists(output_path):
                return jsonify({
                    "error": "FFmpeg enhancement failed",
                    "details": result.stderr.decode("utf-8", errors="replace")[-700:],
                }), 500

        output_name = f"{Path(filename).stem}.enhanced{output_suffix}"
        from flask import send_file
        return send_file(
            output_path,
            mimetype=output_mimetype,
            as_attachment=True,
            download_name=output_name,
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Enhancement timed out (10 min limit)"}), 504
    except Exception as e:
        import traceback
        _log.error(f"enhance-audio error: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500
    finally:
        for p in (input_path, output_path):
            try:
                os.unlink(p)
            except OSError:
                pass


@app.route("/ai-enhance-status", methods=["GET"])
def ai_enhance_status():
    """Return available AI enhancement engines and presets."""
    try:
        from ai_enhance import is_available, get_ai_presets_info
        engines = is_available()
        presets = get_ai_presets_info()
        return jsonify({
            "available": True,
            "engines": engines,
            "presets": presets,
        })
    except ImportError:
        return jsonify({
            "available": False,
            "engines": {},
            "presets": [],
            "error": "AI enhancement not installed (speechbrain, noisereduce)",
        })


@app.route("/load-model", methods=["POST"])
def load_model_endpoint():
    """Pre-load a model into GPU memory (unloads others first to free VRAM)."""
    data = request.get_json() or {}
    model_id = data.get("model", DEFAULT_MODEL)
    resolved = MODEL_REGISTRY.get(model_id, model_id)

    compute_type = data.get("compute_type")  # optional

    try:
        # Unload other models to free GPU memory before loading new one
        for cached_id in list(_model_cache.keys()):
            if not cached_id.startswith(resolved + "::"):
                del _model_cache[cached_id]
                print(f"  Unloaded model to free VRAM: {cached_id}")
        import gc; gc.collect()

        load_model(resolved, compute_type_override=compute_type)
        _refresh_downloaded_models_cache()
        return jsonify({"status": "loaded", "model": resolved})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/preload-stream", methods=["POST"])
def preload_stream():
    """Preload model via SSE — streams loading progress. Non-blocking if model already cached."""
    global _model_loading, _model_loading_id, _model_loading_progress
    data = request.get_json() or {}
    model_id = data.get("model", _current_model_id or DEFAULT_MODEL)
    resolved = MODEL_REGISTRY.get(model_id, model_id)
    compute_type = data.get("compute_type")

    def generate():
        global _model_loading, _model_loading_id, _model_loading_progress
        device = get_device()
        ct = compute_type or ("float16" if device == "cuda" else "int8")
        cache_key = f"{resolved}::{ct}"

        # Already cached — instant response
        if cache_key in _model_cache:
            _model_last_used[cache_key] = time.time()
            yield f"data: {json.dumps({'type': 'status', 'status': 'ready', 'model': resolved, 'message': 'Model already loaded'})}\n\n"
            return

        # Another preload in progress — wait for it
        if _model_loading and _model_loading_id == resolved:
            yield f"data: {json.dumps({'type': 'status', 'status': 'loading', 'model': resolved, 'message': 'Model loading in progress...'})}\n\n"
            # Poll until done
            while _model_loading and _model_loading_id == resolved:
                time.sleep(0.5)
                yield f"data: {json.dumps({'type': 'progress', 'message': _model_loading_progress or 'Loading...'})}\n\n"
            if cache_key in _model_cache:
                yield f"data: {json.dumps({'type': 'status', 'status': 'ready', 'model': resolved, 'message': 'Model loaded'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': 'Loading failed'})}\n\n"
            return

        # Start loading
        with _model_loading_lock:
            _model_loading = True
            _model_loading_id = resolved
            _model_loading_progress = 'Initializing...'

        yield f"data: {json.dumps({'type': 'status', 'status': 'loading', 'model': resolved, 'message': 'Loading model...'})}\n\n"

        try:
            # Unload other models first
            for cached_id in list(_model_cache.keys()):
                if not cached_id.startswith(resolved + "::"):
                    del _model_cache[cached_id]
                    print(f"  [preload] Unloaded model to free VRAM: {cached_id}")
            import gc; gc.collect()

            _model_loading_progress = 'Loading model into GPU...'
            yield f"data: {json.dumps({'type': 'progress', 'message': 'Loading model into GPU...'})}\n\n"

            start = time.time()
            load_model(resolved, compute_type_override=compute_type)
            elapsed = time.time() - start

            _refresh_downloaded_models_cache()
            print(f"  [preload] Model {resolved} loaded in {elapsed:.1f}s")
            yield f"data: {json.dumps({'type': 'status', 'status': 'ready', 'model': resolved, 'elapsed': round(elapsed, 1), 'message': f'Model loaded in {elapsed:.1f}s'})}\n\n"

        except Exception as e:
            print(f"  [preload] Error loading {resolved}: {e}")
            yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': str(e)})}\n\n"

        finally:
            with _model_loading_lock:
                _model_loading = False
                _model_loading_id = None
                _model_loading_progress = ''

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/download-model", methods=["POST"])
def download_model_endpoint():
    """Download a model to disk cache without loading into GPU memory."""
    data = request.get_json() or {}
    model_id = data.get("model", DEFAULT_MODEL)
    resolved = MODEL_REGISTRY.get(model_id, model_id)

    try:
        download_root = str(Path.home() / ".cache" / "whisper-models")

        if resolved in MODELS_NEEDING_CONVERSION:
            # Download and convert HF model to CT2
            path = convert_hf_to_ct2(resolved)
            _refresh_downloaded_models_cache()
            return jsonify({"status": "downloaded", "model": resolved, "path": path})
        else:
            # Use the same cache_dir as WhisperModel uses
            from faster_whisper.utils import download_model
            path = download_model(resolved, cache_dir=download_root)
            _refresh_downloaded_models_cache()
            return jsonify({"status": "downloaded", "model": resolved, "path": str(path)})
    except Exception as e:
        print(f"  Download error for {resolved}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/unload-models", methods=["POST"])
def unload_models_endpoint():
    """Unload all models from GPU memory."""
    global _current_model_id
    count = len(_model_cache)
    _model_cache.clear()
    _model_last_used.clear()
    _current_model_id = None
    import gc; gc.collect()
    print(f"  Unloaded {count} models from memory")
    return jsonify({"status": "ok", "unloaded": count})


@app.route("/diarize-stream", methods=["POST"])
def diarize_stream():
    """Transcribe audio with speaker diarization — SSE streaming progress & partial segments.

    Sends events: progress (stage+percent), segment (each segment as ready), done (final result), error.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "he")
    model_id = request.form.get("model", _current_model_id or _default_model_for(language))
    min_gap = float(request.form.get("min_gap", "1.5"))
    hf_token = request.form.get("hf_token", "")
    diarization_engine = request.form.get("diarization_engine", "auto").strip().lower()
    pyannote_model_id = request.form.get("pyannote_model", "pyannote/speaker-diarization-3.1").strip() or "pyannote/speaker-diarization-3.1"

    resolved = MODEL_REGISTRY.get(model_id, model_id)
    suffix = _safe_suffix(audio_file.filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    def generate():
        try:
            start = time.time()
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'טוען מודל...', 'percent': 5})}\n\n"

            model = load_model(resolved)

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'מתמלל אודיו...', 'percent': 15})}\n\n"
            hebrew_prompt = "תמלול שיחה בעברית." if language == "he" else None

            def _run(m):
                from faster_whisper import BatchedInferencePipeline
                pipeline = BatchedInferencePipeline(model=m)
                return pipeline.transcribe(
                    tmp_path,
                    language=language if language != "auto" else None,
                    word_timestamps=True,
                    batch_size=auto_batch_size(),
                    initial_prompt=hebrew_prompt,
                )

            try:
                segments_raw, info = _run(model)
            except Exception as fa_err:
                if "flash attention" in str(fa_err).lower():
                    model = _reload_model_without_flash(resolved)
                    segments_raw, info = _run(model)
                else:
                    raise

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'בונה קטעים...', 'percent': 50})}\n\n"

            raw_segments = []
            for seg in segments_raw:
                words = []
                if seg.words:
                    words = [{"word": w.word.strip(), "start": round(w.start, 3),
                              "end": round(w.end, 3), "probability": round(w.probability, 3)}
                             for w in seg.words]
                raw_segments.append({
                    "text": seg.text.strip(),
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                    "words": words,
                })

            yield f"data: {json.dumps({'type': 'progress', 'stage': f'מעבד {len(raw_segments)} קטעים...', 'percent': 55})}\n\n"

            # Speaker diarization
            speaker_segments = None
            diarization_method = "silence-gap"

            if hf_token and diarization_engine in {"auto", "pyannote"}:
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'מריץ זיהוי דוברים (pyannote)...', 'percent': 65})}\n\n"
                try:
                    from pyannote.audio import Pipeline as PyannotePipeline
                    pipe = PyannotePipeline.from_pretrained(pyannote_model_id, use_auth_token=hf_token)
                    if _has_torch and torch.cuda.is_available():
                        pipe.to(torch.device("cuda"))
                    diarization = pipe(tmp_path)
                    speaker_segments = []
                    for turn, _, speaker in diarization.itertracks(yield_label=True):
                        speaker_segments.append({"speaker": speaker, "start": round(turn.start, 3), "end": round(turn.end, 3)})
                    diarization_method = "pyannote"
                except ImportError:
                    _log.warning("pyannote.audio not installed — falling back to silence-gap")
                except Exception as e:
                    _log.warning(f"pyannote failed: {e} — falling back to silence-gap")

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'מקצה דוברים לקטעים...', 'percent': 85})}\n\n"

            # Assign speakers
            if speaker_segments and diarization_method == "pyannote":
                for seg in raw_segments:
                    best_speaker, best_overlap = "SPEAKER_00", 0
                    for sp in speaker_segments:
                        overlap = min(seg["end"], sp["end"]) - max(seg["start"], sp["start"])
                        if overlap > best_overlap:
                            best_overlap = overlap
                            best_speaker = sp["speaker"]
                    seg["speaker"] = best_speaker
            else:
                current_speaker = 0
                for i, seg in enumerate(raw_segments):
                    if i > 0:
                        gap = seg["start"] - raw_segments[i - 1]["end"]
                        if gap >= min_gap:
                            current_speaker = (current_speaker + 1) % 10
                    seg["speaker"] = f"SPEAKER_{current_speaker:02d}"

            # Normalize labels
            seen_speakers, speaker_counter = {}, 0
            for seg in raw_segments:
                sp = seg["speaker"]
                if sp not in seen_speakers:
                    seen_speakers[sp] = f"דובר {speaker_counter + 1}"
                    speaker_counter += 1
                seg["speaker_label"] = seen_speakers[sp]

            # Stream each segment
            for idx, seg in enumerate(raw_segments):
                pct = 85 + int((idx + 1) / len(raw_segments) * 14)
                yield f"data: {json.dumps({'type': 'segment', 'index': idx, 'total': len(raw_segments), 'percent': pct, 'segment': seg})}\n\n"

            elapsed = time.time() - start
            full_text = " ".join(s["text"] for s in raw_segments)

            yield f"data: {json.dumps({'type': 'done', 'text': full_text, 'segments': raw_segments, 'speakers': list(seen_speakers.values()), 'speaker_count': speaker_counter, 'duration': round(info.duration, 2), 'language': info.language, 'model': resolved, 'processing_time': round(elapsed, 2), 'diarization_method': diarization_method})}\n\n"

        except Exception as e:
            _log.error(f"Diarize-stream error: {e}\n{_tb_module.format_exc()}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return app.response_class(generate(), mimetype="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/diarize", methods=["POST"])
def diarize():
    """Transcribe audio with speaker diarization.

    Uses whisper segments + silence gap heuristics to detect speaker changes.
    If pyannote.audio is installed and a HuggingFace token is provided,
    uses proper neural speaker diarization instead.

    Form params:
        file: audio file
        model: whisper model id (optional)
        language: language code (optional, default 'he')
        min_gap: minimum silence gap (seconds) to consider a speaker change (default 1.5)
        hf_token: HuggingFace token for pyannote (optional)
        diarization_engine: auto | whisperx | pyannote | silence-gap (optional, default auto)
        whisperx_model: WhisperX model id (optional, default large-v3)
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "he")
    model_id = request.form.get("model", _current_model_id or _default_model_for(language))
    min_gap = float(request.form.get("min_gap", "1.5"))
    hf_token = request.form.get("hf_token", "")
    diarization_engine = request.form.get("diarization_engine", "auto").strip().lower()
    whisperx_model = request.form.get("whisperx_model", "large-v3").strip() or "large-v3"
    pyannote_model_id = request.form.get("pyannote_model", "pyannote/speaker-diarization-3.1").strip() or "pyannote/speaker-diarization-3.1"

    allowed_engines = {"auto", "whisperx", "pyannote", "silence-gap"}
    if diarization_engine not in allowed_engines:
        return jsonify({"error": f"Unsupported diarization_engine: {diarization_engine}", "supported": sorted(allowed_engines)}), 400

    resolved = MODEL_REGISTRY.get(model_id, model_id)
    suffix = _safe_suffix(audio_file.filename)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    try:
        _log.info(
            f"Diarizing: {audio_file.filename} "
            f"(model={resolved}, lang={language}, min_gap={min_gap}, engine={diarization_engine})"
        )
        start = time.time()

        # ──────────────────────────────────────────────────────────────────
        # WhisperX path (high-quality alignment + diarization)
        # auto mode prefers WhisperX when available.
        # ──────────────────────────────────────────────────────────────────
        if diarization_engine in {"auto", "whisperx"}:
            try:
                import whisperx  # type: ignore

                wx_device = "cuda" if (_has_torch and torch.cuda.is_available()) else "cpu"
                wx_compute_type = "float16" if wx_device == "cuda" else "int8"
                wx_language = None if language == "auto" else language

                _log.info(
                    f"Using WhisperX (model={whisperx_model}, device={wx_device}, compute={wx_compute_type}, lang={wx_language or 'auto'})"
                )

                wx_model = whisperx.load_model(
                    whisperx_model,
                    wx_device,
                    compute_type=wx_compute_type,
                    language=wx_language,
                )
                wx_result = wx_model.transcribe(tmp_path, batch_size=16)

                # Force word-level alignment for higher timestamp precision
                align_model, align_meta = whisperx.load_align_model(
                    language_code=wx_result.get("language") or (wx_language or "he"),
                    device=wx_device,
                )
                aligned = whisperx.align(
                    wx_result.get("segments", []),
                    align_model,
                    align_meta,
                    tmp_path,
                    wx_device,
                    return_char_alignments=False,
                )

                diarization_method = "whisperx+silence-gap"

                # Optional neural diarization (pyannote via WhisperX)
                if hf_token:
                    try:
                        diarize_pipeline = whisperx.DiarizationPipeline(
                            use_auth_token=hf_token,
                            device=wx_device,
                        )
                        diarized_segments = diarize_pipeline(tmp_path)
                        aligned = whisperx.assign_word_speakers(diarized_segments, aligned)
                        diarization_method = "whisperx+pyannote"
                    except Exception as wx_diar_err:
                        _log.warning(f"WhisperX diarization pipeline failed: {wx_diar_err} — using silence-gap labels")

                raw_segments = []
                for seg in aligned.get("segments", []):
                    text = str(seg.get("text", "")).strip()
                    if not text:
                        continue
                    seg_start = round(float(seg.get("start", 0.0) or 0.0), 3)
                    seg_end = round(float(seg.get("end", seg_start) or seg_start), 3)

                    words = []
                    for w in seg.get("words", []) or []:
                        w_text = str(w.get("word", "")).strip()
                        if not w_text:
                            continue
                        words.append({
                            "word": w_text,
                            "start": round(float(w.get("start", seg_start) or seg_start), 3),
                            "end": round(float(w.get("end", seg_end) or seg_end), 3),
                            "probability": round(float(w.get("score", w.get("probability", 0.0)) or 0.0), 3),
                        })

                    raw_segments.append({
                        "text": text,
                        "start": seg_start,
                        "end": seg_end,
                        "words": words,
                        "speaker": seg.get("speaker"),
                    })

                # If speaker was not assigned by WhisperX diarization, use silence-gap heuristic.
                current_speaker = 0
                for i, seg in enumerate(raw_segments):
                    has_speaker = bool(seg.get("speaker"))
                    if not has_speaker:
                        if i > 0:
                            gap = seg["start"] - raw_segments[i - 1]["end"]
                            if gap >= min_gap:
                                current_speaker = (current_speaker + 1) % 10
                        seg["speaker"] = f"SPEAKER_{current_speaker:02d}"

                # Normalize speaker labels to sequential Hebrew labels
                seen_speakers = {}
                speaker_counter = 0
                for seg in raw_segments:
                    sp = str(seg.get("speaker") or "SPEAKER_00")
                    if sp not in seen_speakers:
                        seen_speakers[sp] = f"דובר {speaker_counter + 1}"
                        speaker_counter += 1
                    seg["speaker"] = sp
                    seg["speaker_label"] = seen_speakers[sp]

                elapsed = time.time() - start
                full_text = " ".join(s["text"] for s in raw_segments)
                duration = round(max((s["end"] for s in raw_segments), default=0.0), 2)

                _log.info(
                    f"Diarization done in {elapsed:.1f}s — {len(raw_segments)} segments, "
                    f"{speaker_counter} speakers ({diarization_method})"
                )

                return jsonify({
                    "text": full_text,
                    "segments": raw_segments,
                    "speakers": list(seen_speakers.values()),
                    "speaker_count": speaker_counter,
                    "duration": duration,
                    "language": wx_result.get("language") or language,
                    "model": whisperx_model,
                    "processing_time": round(elapsed, 2),
                    "diarization_method": diarization_method,
                })

            except ImportError:
                if diarization_engine == "whisperx":
                    return jsonify({
                        "error": "WhisperX is not installed. Install it with: pip install whisperx",
                    }), 400
                _log.info("WhisperX not installed — falling back to existing diarization pipeline")
            except Exception as wx_err:
                if diarization_engine == "whisperx":
                    _log.error(f"WhisperX diarization error: {wx_err}\n{_tb_module.format_exc()}")
                    return jsonify({"error": f"WhisperX diarization failed: {wx_err}"}), 500
                _log.warning(f"WhisperX failed in auto mode: {wx_err} — falling back")

        # Load faster-whisper model for non-WhisperX path
        model = load_model(resolved)
        hebrew_prompt = "תמלול שיחה בעברית." if language == "he" else None

        def _run_diarize(m):
            return m.transcribe(
                tmp_path,
                language=language if language != "auto" else None,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
                initial_prompt=hebrew_prompt,
            )

        try:
            segments_raw, info = _run_diarize(model)
        except Exception as fa_err:
            if "flash attention" in str(fa_err).lower():
                model = _reload_model_without_flash(resolved)
                segments_raw, info = _run_diarize(model)
            else:
                raise

        # Collect raw segments
        raw_segments = []
        for seg in segments_raw:
            words = []
            if seg.words:
                words = [{"word": w.word.strip(), "start": round(w.start, 3),
                          "end": round(w.end, 3), "probability": round(w.probability, 3)}
                         for w in seg.words]
            raw_segments.append({
                "text": seg.text.strip(),
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "words": words,
            })

        # Try pyannote diarization if available and token provided
        speaker_segments = None
        diarization_method = "silence-gap"

        if hf_token and diarization_engine in {"auto", "pyannote"}:
            try:
                from pyannote.audio import Pipeline as PyannotePipeline
                _log.info(f"Using pyannote.audio for speaker diarization (model={pyannote_model_id})")
                pipe = PyannotePipeline.from_pretrained(
                    pyannote_model_id,
                    use_auth_token=hf_token,
                )
                if _has_torch and torch.cuda.is_available():
                    pipe.to(torch.device("cuda"))
                diarization = pipe(tmp_path)
                speaker_segments = []
                for turn, _, speaker in diarization.itertracks(yield_label=True):
                    speaker_segments.append({
                        "speaker": speaker,
                        "start": round(turn.start, 3),
                        "end": round(turn.end, 3),
                    })
                diarization_method = "pyannote"
            except ImportError:
                _log.warning("pyannote.audio not installed — falling back to silence-gap heuristic")
            except Exception as e:
                _log.warning(f"pyannote diarization failed: {e} — falling back to silence-gap heuristic")

        # Assign speakers to segments
        if speaker_segments and diarization_method == "pyannote":
            # Map each whisper segment to the pyannote speaker with largest overlap
            for seg in raw_segments:
                best_speaker = "SPEAKER_00"
                best_overlap = 0
                for sp in speaker_segments:
                    overlap = min(seg["end"], sp["end"]) - max(seg["start"], sp["start"])
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best_speaker = sp["speaker"]
                seg["speaker"] = best_speaker
        else:
            # Silence-gap heuristic: detect speaker changes based on gaps between segments
            current_speaker = 0
            for i, seg in enumerate(raw_segments):
                if i > 0:
                    gap = seg["start"] - raw_segments[i - 1]["end"]
                    if gap >= min_gap:
                        current_speaker = (current_speaker + 1) % 10
                seg["speaker"] = f"SPEAKER_{current_speaker:02d}"

        # Normalize speaker labels to sequential numbers
        seen_speakers = {}
        speaker_counter = 0
        for seg in raw_segments:
            sp = seg["speaker"]
            if sp not in seen_speakers:
                seen_speakers[sp] = f"דובר {speaker_counter + 1}"
                speaker_counter += 1
            seg["speaker_label"] = seen_speakers[sp]

        elapsed = time.time() - start
        full_text = " ".join(s["text"] for s in raw_segments)

        _log.info(f"Diarization done in {elapsed:.1f}s — {len(raw_segments)} segments, {speaker_counter} speakers ({diarization_method})")

        return jsonify({
            "text": full_text,
            "segments": raw_segments,
            "speakers": list(seen_speakers.values()),
            "speaker_count": speaker_counter,
            "duration": round(info.duration, 2),
            "language": info.language,
            "model": resolved,
            "processing_time": round(elapsed, 2),
            "diarization_method": diarization_method,
        })

    except Exception as e:
        _log.error(f"Diarization error: {e}\n{_tb_module.format_exc()}")
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route("/warmup", methods=["POST"])
def warmup_endpoint():
    """Warm up the GPU pipeline with a short silent audio — reduces first-transcription latency."""
    import numpy as np
    model_id = _current_model_id
    if not model_id:
        return jsonify({"status": "no_model", "message": "No model loaded"}), 400
    try:
        # Find the cached model
        model = None
        for key, m in _model_cache.items():
            if key.startswith(model_id + "::"):
                model = m
                break
        if model is None:
            return jsonify({"status": "no_model", "message": "Model not in cache"}), 400

        # Generate 1 second of silence at 16kHz and run through the pipeline
        silence = np.zeros(16000, dtype=np.float32)
        start = time.time()
        try:
            segments, _ = model.transcribe(silence, language="he")
            for _ in segments:
                pass  # consume generator
        except Exception as fa_err:
            if "flash attention" in str(fa_err).lower():
                model = _reload_model_without_flash(model_id)
                segments, _ = model.transcribe(silence, language="he")
                for _ in segments:
                    pass
            else:
                raise
        elapsed = time.time() - start
        print(f"  GPU warmup done in {elapsed:.2f}s")
        return jsonify({"status": "ok", "warmup_time": round(elapsed, 2)})
    except Exception as e:
        print(f"  Warmup failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/shutdown", methods=["POST"])
def shutdown_endpoint():
    """Gracefully shut down the server."""
    global _current_model_id
    _model_cache.clear()
    _model_last_used.clear()
    _current_model_id = None
    import gc; gc.collect()
    print("\n  Server shutdown requested — bye!")
    # Return response before shutting down
    def _do_shutdown():
        import signal
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Timer(0.5, _do_shutdown).start()
    return jsonify({"status": "shutting_down"})


def _evict_stale_models():
    """Background thread: evict models unused for MODEL_TTL_SECONDS and expired staged files."""
    import gc
    while True:
        time.sleep(60)  # check every minute
        now = time.time()
        stale = [k for k, ts in _model_last_used.items() if now - ts > MODEL_TTL_SECONDS]
        for key in stale:
            if key in _model_cache:
                del _model_cache[key]
                del _model_last_used[key]
                print(f"  [cache] Evicted idle model: {key}")
        if stale:
            gc.collect()

        # Cleanup expired staged files
        expired_stages = [sid for sid, info in _staged_files.items() if now - info["timestamp"] > STAGE_TTL_SECONDS]
        for sid in expired_stages:
            info = _staged_files.pop(sid, None)
            if info:
                try:
                    os.unlink(info["path"])
                except OSError:
                    pass
                print(f"  [stage] Cleaned up expired staged file: {info['filename']}")


# ════════════════════════════════════════════════════════════════════
#  HARMONY ENGINE — pitch shifting & harmony generation
# ════════════════════════════════════════════════════════════════════

@app.route("/harmonize", methods=["POST"])
def harmonize_endpoint():
    """
    Generate harmonies from an audio file.

    Form fields:
      - audio: audio file (WAV/MP3/OGG/etc.)
      - voices: JSON array, e.g. [{"semitones":4,"gain":0.7},{"semitones":7,"gain":0.5}]
      - scale: "major"|"minor"|"chromatic"|"dorian"|"mixolydian"|"harmonic-minor"
      - root: "C"|"C#"|"D"|...|"B"
      - dryGain: float 0-1 (default 0.85)
      - wetGain: float 0-1 (default 0.7)
      - quality: "basic"|"pro"|"studio" (default "basic")
      - maxDuration: float seconds (optional, for preview)

    Returns: audio/wav
    """
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    audio_bytes = audio_file.read()

    if len(audio_bytes) == 0:
        return jsonify({"error": "Empty audio file"}), 400

    if len(audio_bytes) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        return jsonify({"error": f"File too large (max {MAX_UPLOAD_SIZE_MB} MB)"}), 413

    try:
        voices_json = request.form.get("voices", "[]")
        voices = json.loads(voices_json)
        if not isinstance(voices, list) or not voices:
            return jsonify({"error": "voices must be a non-empty JSON array"}), 400
        # Validate voice entries
        for v in voices:
            if "semitones" not in v:
                return jsonify({"error": "Each voice must have 'semitones'"}), 400
            v["semitones"] = float(v["semitones"])
            v["gain"] = float(v.get("gain", 0.7))
    except (json.JSONDecodeError, ValueError) as e:
        return jsonify({"error": f"Invalid voices parameter: {e}"}), 400

    scale = request.form.get("scale", "major")
    root = request.form.get("root", "C")
    dry_gain = float(request.form.get("dryGain", "0.85"))
    wet_gain = float(request.form.get("wetGain", "0.7"))
    quality = request.form.get("quality", "basic")
    max_duration_str = request.form.get("maxDuration", "")
    max_duration = float(max_duration_str) if max_duration_str else None

    # Validate quality
    if quality not in ("basic", "pro", "studio"):
        quality = "basic"

    _log.info(f"[harmonize] quality={quality} voices={len(voices)} scale={scale} root={root} "
              f"dry={dry_gain:.2f} wet={wet_gain:.2f} maxDur={max_duration} size={len(audio_bytes)}")

    start_time = time.time()
    try:
        from server.harmony_engine import render_harmony
    except ImportError:
        # When running from project root, try direct import
        try:
            from harmony_engine import render_harmony
        except ImportError:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from harmony_engine import render_harmony

    try:
        wav_bytes = render_harmony(
            audio_bytes=audio_bytes,
            voices=voices,
            scale=scale,
            root=root,
            dry_gain=dry_gain,
            wet_gain=wet_gain,
            quality=quality,
            max_duration=max_duration,
        )
    except Exception as e:
        _log.error(f"[harmonize] Error: {e}\n{_tb_module.format_exc()}")
        return jsonify({"error": f"Harmony processing failed: {str(e)}"}), 500

    elapsed = time.time() - start_time
    _log.info(f"[harmonize] Done in {elapsed:.1f}s — {len(wav_bytes)} bytes output")

    return Response(wav_bytes, mimetype="audio/wav", headers={
        "Content-Disposition": "attachment; filename=harmonized.wav",
        "X-Processing-Time": f"{elapsed:.2f}",
        "X-Quality-Tier": quality,
    })


@app.route("/harmonize/capabilities", methods=["GET"])
def harmonize_capabilities():
    """Return available harmony processing tiers."""
    # Check which tiers are available
    tiers = {
        "basic": {"available": True, "label": "מהיר (STFT)", "label_en": "Fast (STFT)"},
        "pro": {"available": False, "label": "מקצועי (WORLD)", "label_en": "Pro (WORLD)"},
        "studio": {"available": False, "label": "סטודיו (Demucs+WORLD)", "label_en": "Studio (Demucs+WORLD)"},
    }
    try:
        import pyworld
        tiers["pro"]["available"] = True
    except ImportError:
        pass
    try:
        from server.harmony_engine import _check_demucs
        tiers["studio"]["available"] = _check_demucs()
    except ImportError:
        try:
            from harmony_engine import _check_demucs
            tiers["studio"]["available"] = _check_demucs()
        except ImportError:
            pass
    # If pro is not available but basic is, studio falls back to basic too
    if not tiers["pro"]["available"]:
        tiers["studio"]["available"] = False

    return jsonify({"tiers": tiers})


def main():
    global _api_key
    parser = argparse.ArgumentParser(description="Local Whisper Transcription Server")
    parser.add_argument("--port", type=int, default=3000, help="Port to listen on")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Default model to preload")
    parser.add_argument("--no-preload", action="store_true", help="Don't preload the default model")
    parser.add_argument("--api-key", type=str, default=None, help="Require API key for requests (or set WHISPER_API_KEY env var)")
    args = parser.parse_args()

    if args.api_key:
        _api_key = args.api_key

    print("=" * 60)
    print("  Smart Hebrew Transcriber — Local Whisper Server")
    print("=" * 60)
    print(f"  Python: {sys.version.split()[0]}")
    print(f"  faster-whisper: {faster_whisper.__version__}")
    if _has_torch:
        print(f"  PyTorch: {torch.__version__}")
    device = get_device()
    gpu_name = get_gpu_name()
    if gpu_name:
        print(f"  GPU: {gpu_name}")
    print(f"  Port: {args.port}")
    print(f"  Default model: {args.model}")
    if _api_key:
        print(f"  API Key: {'*' * (len(_api_key) - 4)}{_api_key[-4:]}")
    else:
        print(f"  API Key: not set (open access)")
    print("=" * 60)

    if not args.no_preload:
        resolved = MODEL_REGISTRY.get(args.model, args.model)
        # Non-blocking: preload model in background thread so server starts instantly
        def _bg_preload(model_id):
            global _model_loading, _model_loading_id, _model_loading_progress
            with _model_loading_lock:
                _model_loading = True
                _model_loading_id = model_id
                _model_loading_progress = 'Pre-loading model...'
            try:
                model = load_model(model_id)
                print("  ✅ Background preload complete — model ready!")
                # Warm-up: run a tone transcription to trigger flash attention
                # failure NOW instead of during the first real request.
                # Must use non-silent audio so segments are actually decoded.
                try:
                    import wave, struct, math
                    warmup_path = os.path.join(tempfile.gettempdir(), "_whisper_warmup.wav")
                    sr = 16000
                    dur = 2  # seconds
                    n = sr * dur
                    # 440 Hz sine wave — enough to produce at least one segment
                    samples = [int(16000 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)]
                    with wave.open(warmup_path, "w") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(sr)
                        wf.writeframes(struct.pack("<" + "h" * n, *samples))
                    segments, _ = model.transcribe(warmup_path, language="he", beam_size=1)
                    list(segments)  # Force iteration to trigger flash attention errors
                    os.unlink(warmup_path)
                    print("  ✅ Warm-up transcription OK (flash attention validated)")
                except Exception as wu_err:
                    if "flash attention" in str(wu_err).lower():
                        print(f"  ⚠️  Flash Attention failed during warm-up — reloading without it...")
                        _reload_model_without_flash(model_id)
                        print("  ✅ Model reloaded without Flash Attention — ready!")
                    else:
                        print(f"  ⚠️  Warm-up transcription warning: {wu_err}")
                    try:
                        os.unlink(warmup_path)
                    except OSError:
                        pass
            except Exception as e:
                print(f"  ⚠️  Background preload failed: {e}")
                print("  Server will still run — model will load on first request.")
            finally:
                with _model_loading_lock:
                    _model_loading = False
                    _model_loading_id = None
                    _model_loading_progress = ''

        print(f"\n  Pre-loading model in background: {resolved}...")
        bg_thread = threading.Thread(target=_bg_preload, args=(resolved,), daemon=True)
        bg_thread.start()

    print(f"\n  Server starting on http://localhost:{args.port}")

    # Start model cache eviction thread (frees VRAM for idle models)
    eviction_thread = threading.Thread(target=_evict_stale_models, daemon=True)
    eviction_thread.start()
    print(f"  Model cache TTL: {MODEL_TTL_SECONDS // 60} minutes")
    print(f"  Max upload size: {MAX_UPLOAD_SIZE_MB} MB")
    print(f"  Rate limit: {_rate_limit_max} requests/{_rate_limit_window}s per IP")
    print(f"  GPU concurrency: 1 (serialized via lock)")

    print("  Endpoints:")
    print("    GET  /health            — Server status + GPU memory info")
    print("    GET  /debug             — Full diagnostics (GPU, RAM, request history)")
    print("    GET  /diagnostics       — Complete request history")
    print("    GET  /metrics           — Per-model performance percentiles (p50/p95/p99)")
    print("    GET  /models            — Available models")
    print("    GET  /presets           — Available transcription presets")
    print("    POST /transcribe        — Transcribe audio (single response)")
    print("    POST /transcribe-stream — Transcribe audio (SSE streaming)")
    print("    POST /diarize           — Transcribe + speaker diarization")
    print("    POST /transcribe-live   — Low-latency chunk transcription (live mode)")
    print("    POST /youtube-transcribe — Download + transcribe YouTube video")
    print("    POST /stage-audio       — Pre-upload audio (parallel with preload)")
    print("    POST /convert-mp3       — Convert audio/video to MP3/OPUS/AAC (server FFmpeg)")
    print("    POST /enhance-audio     — Enhance audio (AI/non-AI presets) to MP3/OPUS/AAC")
    print("    POST /harmonize         — Generate harmonies (basic/pro/studio)")
    print("    GET  /lk/dictionary     — Lashon Kodesh personal dictionary (list)")
    print("    POST /lk/dictionary     — Add / update word pair")
    print("    DELETE /lk/dictionary/<id> — Remove word pair")
    print("    GET  /lk/rules          — Grammar rules list")
    print("    POST /lk/rules          — Add / update rule")
    print("    PATCH /lk/rules/<id>    — Toggle rule enabled/disabled")
    print("    DELETE /lk/rules/<id>   — Remove rule")
    print("    POST /lk/transcribe     — Transcribe with LK mode + post-processing")
    print("    GET  /harmonize/capabilities — Available harmony tiers")
    print("    POST /load-model        — Load model into GPU memory")
    print("    POST /preload-stream    — Preload model via SSE (background)")
    print("    POST /download-model    — Download model to disk only")
    print("    POST /unload-models     — Free GPU memory")
    print("    POST /shutdown          — Gracefully stop the server")
    print()

    # Use waitress production server with multi-threading (8 threads)
    # Falls back to Flask dev server if waitress is not installed
    try:
        from waitress import serve
        import os as _os
        _threads = int(_os.environ.get("SERVER_THREADS", "8"))
        print(f"  Server: waitress ({_threads} threads, timeout={WAITRESS_CHANNEL_TIMEOUT}s)")
        print()
        serve(app, listen=f'0.0.0.0:{args.port} [::1]:{args.port}', threads=_threads,
              channel_timeout=WAITRESS_CHANNEL_TIMEOUT,
              recv_bytes=WAITRESS_RECV_BYTES,
              send_bytes=65536, url_scheme='http',
              connection_limit=200,
              cleanup_interval=30)
    except ImportError:
        print("  Server: Flask dev server (install waitress for production)")
        print("  Tip: pip install waitress")
        print()
        app.run(host="0.0.0.0", port=args.port, debug=False)


# ════════════════════════════════════════════════════════════════════════════
#  LASHON KODESH — Personal dictionary, grammar rules, post-processing
# ════════════════════════════════════════════════════════════════════════════

import sqlite3 as _sqlite3
import re as _re

_LK_DB_PATH = Path(__file__).parent / "lk_data.db"

_LK_SCHEMA = """
CREATE TABLE IF NOT EXISTS lk_dictionary (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    spoken_form   TEXT NOT NULL,
    correct_form  TEXT NOT NULL,
    source        TEXT DEFAULT 'manual',
    note          TEXT,
    count_applied INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(spoken_form)
);
CREATE TABLE IF NOT EXISTS lk_grammar_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    pattern     TEXT NOT NULL,
    replacement TEXT NOT NULL,
    tradition   TEXT DEFAULT 'ashkenazi',
    enabled     INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 10,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(name)
);
CREATE TABLE IF NOT EXISTS lk_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT UNIQUE,
    created_at      TEXT DEFAULT (datetime('now')),
    audio_filename  TEXT,
    raw_text        TEXT,
    corrected_text  TEXT,
    words_fixed     INTEGER DEFAULT 0
);
"""

# Built-in Ashkenazi grammar rules seeded on first run
_LK_BUILTIN_RULES = [
    ("תו-ללא-דגש → ס (אשכנז)",
     r'\bת(?=[אוּוּ])', "ס",
     "ashkenazi", 1, 100),
    ("שַׁבָּת → שַׁבָּס",
     r'\bשַׁבָּת\b', "שַׁבָּס",
     "ashkenazi", 1, 90),
    ("מִצְוָה → מִצְוָה (maintain)",
     r'\bמִצְוָה\b', "מִצְוָה",
     "ashkenazi", 1, 80),
    ("ברכות → ברוכות (blessing-form)",
     r'\bבְּרָכוֹת\b', "ברוכות",
     "ashkenazi", 0, 70),
    ("תורה → תוירה",
     r'\bתּוֹרָה\b', "תּוֹירָה",
     "ashkenazi", 0, 60),
    ("שבת → שבס",
     r'\bשבת\b', "שבס",
     "ashkenazi", 1, 50),
    ("מצוה → מצוה",
     r'\bמצוה\b', "מצוה",
     "ashkenazi", 1, 40),
    ("יום טוב → יום טויב",
     r'\bיום טוב\b', "יום טויב",
     "ashkenazi", 0, 30),
]


def _lk_db():
    """Open LK SQLite connection (thread-safe)."""
    _LK_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _sqlite3.connect(str(_LK_DB_PATH), check_same_thread=False)
    conn.row_factory = _sqlite3.Row
    return conn


def _lk_init():
    """Ensure schema and seed built-in rules."""
    with _lk_db() as conn:
        conn.executescript(_LK_SCHEMA)
        for (name, pattern, replacement, tradition, enabled, priority) in _LK_BUILTIN_RULES:
            conn.execute(
                "INSERT OR IGNORE INTO lk_grammar_rules "
                "(name, pattern, replacement, tradition, enabled, priority) "
                "VALUES (?,?,?,?,?,?)",
                (name, pattern, replacement, tradition, enabled, priority)
            )
        conn.commit()

# Initialise on import
try:
    _lk_init()
except Exception as _e:
    _log.warning(f"[LK] DB init failed: {_e}")


def _lk_apply_postprocessing(text: str) -> tuple[str, int]:
    """
    Apply enabled grammar rules (by priority DESC) then dictionary substitutions.
    Returns (corrected_text, words_fixed_count).
    """
    fixed = 0
    result = text

    # 1. Grammar rules (sorted by priority DESC)
    with _lk_db() as conn:
        rules = conn.execute(
            "SELECT pattern, replacement FROM lk_grammar_rules "
            "WHERE enabled=1 ORDER BY priority DESC"
        ).fetchall()
        for row in rules:
            new_result = _re.sub(row["pattern"], row["replacement"], result)
            if new_result != result:
                fixed += result.count(row["pattern"])  # rough estimate
                result = new_result

        # 2. Dictionary substitutions (exact word match, case-insensitive)
        dictionary = conn.execute(
            "SELECT id, spoken_form, correct_form FROM lk_dictionary"
        ).fetchall()

    for entry in dictionary:
        spoken = _re.escape(entry["spoken_form"])
        pattern = rf'\b{spoken}\b'
        new_result = _re.sub(pattern, entry["correct_form"], result, flags=_re.IGNORECASE)
        if new_result != result:
            fixed += len(_re.findall(pattern, result, flags=_re.IGNORECASE))
            result = new_result
            # Increment count_applied asynchronously
            try:
                with _lk_db() as conn:
                    conn.execute(
                        "UPDATE lk_dictionary SET count_applied=count_applied+1 WHERE id=?",
                        (entry["id"],)
                    )
                    conn.commit()
            except Exception:
                pass

    return result, fixed


# ── LK API endpoints ──────────────────────────────────────────────────────────

@app.route("/lk/dictionary", methods=["GET"])
def lk_dict_list():
    """Return all LK dictionary entries."""
    with _lk_db() as conn:
        rows = conn.execute(
            "SELECT * FROM lk_dictionary ORDER BY created_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/lk/dictionary", methods=["POST"])
def lk_dict_add():
    """Add or update a dictionary entry. Body: {spoken_form, correct_form, note?}"""
    data = request.get_json(force=True) or {}
    spoken = (data.get("spoken_form") or "").strip()
    correct = (data.get("correct_form") or "").strip()
    note = (data.get("note") or "").strip() or None
    source = data.get("source", "manual")
    if not spoken or not correct:
        return jsonify({"error": "spoken_form and correct_form are required"}), 400
    with _lk_db() as conn:
        conn.execute(
            "INSERT INTO lk_dictionary (spoken_form, correct_form, note, source) "
            "VALUES (?,?,?,?) ON CONFLICT(spoken_form) DO UPDATE SET "
            "correct_form=excluded.correct_form, note=excluded.note",
            (spoken, correct, note, source)
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lk_dictionary WHERE spoken_form=?", (spoken,)
        ).fetchone()
    return jsonify(dict(row)), 201


@app.route("/lk/dictionary/<int:entry_id>", methods=["DELETE"])
def lk_dict_delete(entry_id: int):
    """Delete a dictionary entry by id."""
    with _lk_db() as conn:
        conn.execute("DELETE FROM lk_dictionary WHERE id=?", (entry_id,))
        conn.commit()
    return jsonify({"deleted": entry_id})


@app.route("/lk/rules", methods=["GET"])
def lk_rules_list():
    """Return all grammar rules."""
    with _lk_db() as conn:
        rows = conn.execute(
            "SELECT * FROM lk_grammar_rules ORDER BY priority DESC, id"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/lk/rules", methods=["POST"])
def lk_rules_add():
    """Add or update a grammar rule. Body: {name, pattern, replacement, tradition?, priority?}"""
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    pattern = (data.get("pattern") or "").strip()
    replacement = (data.get("replacement") or "").strip()
    tradition = data.get("tradition", "ashkenazi")
    enabled = 1 if data.get("enabled", True) else 0
    priority = int(data.get("priority", 10))
    if not name or not pattern:
        return jsonify({"error": "name and pattern are required"}), 400
    # Validate regex
    try:
        _re.compile(pattern)
    except _re.error as e:
        return jsonify({"error": f"Invalid regex: {e}"}), 400
    with _lk_db() as conn:
        conn.execute(
            "INSERT INTO lk_grammar_rules "
            "(name, pattern, replacement, tradition, enabled, priority) "
            "VALUES (?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET "
            "pattern=excluded.pattern, replacement=excluded.replacement, "
            "tradition=excluded.tradition, enabled=excluded.enabled, priority=excluded.priority",
            (name, pattern, replacement, tradition, enabled, priority)
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lk_grammar_rules WHERE name=?", (name,)
        ).fetchone()
    return jsonify(dict(row)), 201


@app.route("/lk/rules/<int:rule_id>", methods=["PATCH"])
def lk_rules_toggle(rule_id: int):
    """Toggle enabled/disabled or update any field. Body: {enabled?, name?, ...}"""
    data = request.get_json(force=True) or {}
    with _lk_db() as conn:
        row = conn.execute(
            "SELECT * FROM lk_grammar_rules WHERE id=?", (rule_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Rule not found"}), 404
        enabled = int(data.get("enabled", row["enabled"]))
        name = data.get("name", row["name"])
        pattern = data.get("pattern", row["pattern"])
        replacement = data.get("replacement", row["replacement"])
        priority = int(data.get("priority", row["priority"]))
        conn.execute(
            "UPDATE lk_grammar_rules SET enabled=?, name=?, pattern=?, "
            "replacement=?, priority=? WHERE id=?",
            (enabled, name, pattern, replacement, priority, rule_id)
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lk_grammar_rules WHERE id=?", (rule_id,)
        ).fetchone()
    return jsonify(dict(row))


@app.route("/lk/rules/<int:rule_id>", methods=["DELETE"])
def lk_rules_delete(rule_id: int):
    """Delete a grammar rule by id."""
    with _lk_db() as conn:
        conn.execute("DELETE FROM lk_grammar_rules WHERE id=?", (rule_id,))
        conn.commit()
    return jsonify({"deleted": rule_id})


@app.route("/lk/transcribe", methods=["POST"])
def lk_transcribe():
    """
    Transcribe audio with Lashon Kodesh mode ON + post-processing.
    Same as /transcribe but forces loshon_kodesh=True and applies the
    full LK post-processing pipeline (rules → dictionary).
    Form fields: file, beam_size (default 5), normalize (default 1).
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = "he"
    beam_size = int(request.form.get("beam_size", 5))
    normalize = request.form.get("normalize", "1") == "1"

    # Force LK mode
    model_id = request.form.get("model", _current_model_id or _default_model_for("he"))
    resolved = MODEL_REGISTRY.get(model_id, model_id)
    user_hotwords = request.form.get("hotwords", "")

    initial_prompt, hotwords = _resolve_prompt_and_hotwords(
        "he", "", user_hotwords, loshon_kodesh=True
    )

    suffix = _safe_suffix(audio_file.filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    norm_path = None
    try:
        transcribe_path = tmp_path
        if normalize:
            norm_path = _normalize_audio(tmp_path)
            if norm_path != tmp_path:
                transcribe_path = norm_path

        model = load_model(resolved)
        start = time.time()

        from faster_whisper import BatchedInferencePipeline
        pipeline = BatchedInferencePipeline(model=model)
        segments_gen, info = pipeline.transcribe(
            transcribe_path,
            language="he",
            word_timestamps=True,
            beam_size=beam_size,
            batch_size=auto_batch_size(),
            initial_prompt=initial_prompt,
            hotwords=hotwords,
            condition_on_previous_text=True,
        )
        segments = list(segments_gen)

        full_text_parts = []
        word_timings = []
        for seg in segments:
            full_text_parts.append(seg.text.strip())
            if seg.words:
                for w in seg.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    })

        raw_text = " ".join(full_text_parts)
        corrected_text, words_fixed = _lk_apply_postprocessing(raw_text)
        elapsed = time.time() - start

        # Save session
        import uuid as _uuid
        session_id = str(_uuid.uuid4())[:12]
        try:
            with _lk_db() as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO lk_sessions "
                    "(session_id, audio_filename, raw_text, corrected_text, words_fixed) "
                    "VALUES (?,?,?,?,?)",
                    (session_id, audio_file.filename, raw_text, corrected_text, words_fixed)
                )
                conn.commit()
        except Exception:
            pass

        return jsonify({
            "text": corrected_text,
            "raw_text": raw_text,
            "words_fixed": words_fixed,
            "wordTimings": word_timings,
            "duration": round(info.duration, 2),
            "processing_time": round(elapsed, 2),
            "session_id": session_id,
            "lk_mode": True,
        })

    except Exception as e:
        _log.error(f"[LK] transcribe error: {e}")
        return jsonify({"error": "Transcription failed"}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if norm_path and norm_path != tmp_path:
            try:
                os.unlink(norm_path)
            except OSError:
                pass


@app.route("/lk/sessions", methods=["GET"])
def lk_sessions_list():
    """Return recent LK transcription sessions."""
    limit = min(int(request.args.get("limit", 50)), 200)
    with _lk_db() as conn:
        rows = conn.execute(
            "SELECT * FROM lk_sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/lk/sessions/<string:session_id>/words", methods=["POST"])
def lk_session_add_word(session_id: str):
    """
    Learn a word correction from a transcription session.
    Body: {spoken_form, correct_form, note?}
    """
    data = request.get_json(force=True) or {}
    spoken = (data.get("spoken_form") or "").strip()
    correct = (data.get("correct_form") or "").strip()
    note = (data.get("note") or "").strip() or None
    if not spoken or not correct:
        return jsonify({"error": "spoken_form and correct_form required"}), 400
    with _lk_db() as conn:
        conn.execute(
            "INSERT INTO lk_dictionary (spoken_form, correct_form, note, source) "
            "VALUES (?,?,?,'session_correction') ON CONFLICT(spoken_form) DO UPDATE SET "
            "correct_form=excluded.correct_form, note=excluded.note",
            (spoken, correct, note)
        )
        conn.commit()
    return jsonify({"learned": spoken, "correct": correct}), 201


# ════════════════════════════════════════════════════════════════════════════
# COMPARE ENDPOINTS — in-app transcription comparison (12 systems)
# ════════════════════════════════════════════════════════════════════════════

_CMP_DB_PATH = Path(__file__).parent.parent / "tools" / "transcription_feedback.db"

_CMP_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT UNIQUE,
    created_at       TEXT,
    audio_hash       TEXT,
    audio_filename   TEXT,
    duration_s       REAL,
    channels         INTEGER,
    sample_rate      INTEGER,
    dynamic_range_db REAL,
    snr_estimate_db  REAL,
    noise_rms        REAL,
    noise_level      TEXT,
    results_json     TEXT,
    recommended_id   TEXT,
    user_chosen_id   TEXT,
    user_notes       TEXT
);
"""

# 12 compare system configs: (id, label, beam, cond_prev, vad_agg, compute, normalize, denoise)
_CMP_SYSTEMS = [
    ("fast_n",  "⚡ Fast · norm",        1, False, True,  "int8_float16", True,  False),
    ("fast_r",  "⚡ Fast · raw",         1, False, True,  "int8_float16", False, False),
    ("bal_n",   "⚖ Balanced · norm",    3, True,  False, "int8_float16", True,  False),
    ("bal_r",   "⚖ Balanced · raw",     3, True,  False, "int8_float16", False, False),
    ("acc_n",   "🎯 Accurate · norm",    5, True,  False, "float16",      True,  False),
    ("acc_r",   "🎯 Accurate · raw",     5, True,  False, "float16",      False, False),
    ("b3_n",    "B3 · norm",            3, True,  False, "int8_float16", True,  False),
    ("b3_r",    "B3 · raw",             3, True,  False, "int8_float16", False, False),
    ("b5_n",    "B5 · norm",            5, True,  False, "int8_float16", True,  False),
    ("b5_r",    "B5 · raw",             5, True,  False, "int8_float16", False, False),
    ("b5_dn",   "B5+denoise · norm",    5, True,  False, "float16",      True,  True),
    ("b5_dr",   "B5+denoise · raw",     5, True,  False, "float16",      False, True),
]


def _cmp_db():
    _CMP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _sqlite3.connect(str(_CMP_DB_PATH))
    conn.row_factory = _sqlite3.Row
    conn.execute(_CMP_SCHEMA)
    conn.commit()
    return conn


def _cmp_recommend(dynamic_range: float, snr_db: float) -> tuple[str, str]:
    """Simple rule-based recommender (mirrors smart_compare.py logic)."""
    import math
    # Try k-NN from labeled sessions
    with _cmp_db() as conn:
        labeled = conn.execute(
            "SELECT dynamic_range_db, snr_estimate_db, duration_s, user_chosen_id "
            "FROM sessions WHERE user_chosen_id IS NOT NULL LIMIT 100"
        ).fetchall()

    K = 5
    if len(labeled) >= 3:
        def feat(dr, snr):
            return [min(1.0, dr / 30.0), min(1.0, snr / 40.0)]
        v = feat(dynamic_range, snr_db)
        neighbors = []
        for row in labeled:
            rv = feat(row["dynamic_range_db"] or 20, row["snr_estimate_db"] or 30)
            dist = math.sqrt(sum((a - b)**2 for a, b in zip(v, rv)))
            neighbors.append((dist, row["user_chosen_id"]))
        neighbors.sort(key=lambda x: x[0])
        top = neighbors[:K]
        votes: dict = {}
        for dist, cid in top:
            w = 1.0 / (dist + 0.01)
            votes[cid] = votes.get(cid, 0) + w
        best = max(votes, key=lambda k: votes[k])
        total = sum(votes.values())
        conf = votes[best] / total if total else 0
        if conf >= 0.5:
            sys_map = {s[0]: s[1] for s in _CMP_SYSTEMS}
            label = sys_map.get(best, best)
            return best, f"k-NN ({len(labeled)} דוגמאות) → {label} ({conf:.0%} ביטחון)"

    # Rule-based fallback
    if dynamic_range >= 16:
        return "fast_n", f"חוקים (dynamic range={dynamic_range:.1f}dB — נקי)"
    elif dynamic_range >= 15:
        return "bal_n", f"חוקים (dynamic range={dynamic_range:.1f}dB — רעש קל)"
    elif dynamic_range >= 14:
        return "b5_n", f"חוקים (dynamic range={dynamic_range:.1f}dB — רעש בינוני)"
    else:
        return "fast_r", f"חוקים (dynamic range={dynamic_range:.1f}dB — רעש כבד, skip norm)"


def _cmp_analyze_audio(path: str) -> dict:
    """Quick audio quality metrics (WAV only)."""
    info = {
        "duration_s": 0.0, "channels": 1, "sample_rate": 16000,
        "dynamic_range_db": 25.0, "snr_estimate_db": 40.0,
        "noise_rms": 0.0, "clipping_count": 0,
        "noise_level_label": "לא ידוע",
    }
    try:
        import wave, array, math, struct
        with wave.open(path, "rb") as wf:
            info["channels"] = wf.getnchannels()
            info["sample_rate"] = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
            info["duration_s"] = wf.getnframes() / wf.getframerate()
            width = wf.getsampwidth()
        if width == 2:
            samples = array.array("h", frames)
            vals = [abs(s) for s in samples]
            if not vals:
                return info
            peak = max(vals)
            peak_db = 20 * math.log10(max(peak, 1) / 32768)
            rms = math.sqrt(sum(s * s for s in samples) / len(samples))
            rms_db = 20 * math.log10(max(rms, 1) / 32768)
            n = len(samples) // 10
            quiet = sorted(vals)[:n]
            noise_rms = math.sqrt(sum(s * s for s in quiet) / max(len(quiet), 1))
            noise_db = 20 * math.log10(max(noise_rms, 1) / 32768)
            dynamic_range = rms_db - noise_db
            snr = rms_db - noise_db + 20
            clipping = sum(1 for s in samples if abs(s) >= 32700)
            info.update({
                "dynamic_range_db": round(dynamic_range, 1),
                "snr_estimate_db": round(max(snr, 0), 1),
                "noise_rms": round(noise_rms / 32768, 4),
                "clipping_count": clipping,
            })
            dr = dynamic_range
            if dr >= 16:
                info["noise_level_label"] = "נקי"
            elif dr >= 14:
                info["noise_level_label"] = "רעש קל"
            elif dr >= 10:
                info["noise_level_label"] = "רעש בינוני"
            else:
                info["noise_level_label"] = "רעש כבד"
    except Exception:
        pass
    return info


@app.route("/compare/sessions", methods=["GET"])
def compare_sessions_list():
    """List saved compare sessions, newest first."""
    limit = min(int(request.args.get("limit", 50)), 200)
    with _cmp_db() as conn:
        rows = conn.execute(
            "SELECT id, session_id, created_at, audio_filename, duration_s, "
            "noise_level, recommended_id, user_chosen_id "
            "FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/compare/sessions/<string:sid>", methods=["GET"])
def compare_session_get(sid: str):
    """Get a single compare session with full results."""
    with _cmp_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE session_id=?", (sid,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    d = dict(row)
    d["results"] = json.loads(d.pop("results_json") or "[]")
    return jsonify(d)


@app.route("/compare/sessions/<string:sid>/feedback", methods=["PATCH"])
def compare_session_feedback(sid: str):
    """Save user feedback for a session."""
    data = request.get_json(force=True) or {}
    chosen = (data.get("user_chosen_id") or "").strip() or None
    notes = (data.get("user_notes") or "").strip() or None
    with _cmp_db() as conn:
        conn.execute(
            "UPDATE sessions SET user_chosen_id=?, user_notes=? WHERE session_id=?",
            (chosen, notes, sid)
        )
        conn.commit()
    return jsonify({"updated": True})


@app.route("/compare/run", methods=["POST"])
def compare_run():
    """
    Run all 12 transcription systems on an uploaded audio file.
    Returns SSE stream: each event is one system result, final event has 'done':true.
    """
    import hashlib as _hl
    import uuid as _uuid

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    audio_file = request.files["file"]
    suffix = os.path.splitext(audio_file.filename or "audio.wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    orig_filename = audio_file.filename or "audio"

    def _sse_stream():
        import hashlib as _hm
        import subprocess, wave, math, array

        denoise_path = None
        norm_path = None
        try:
            # Hash for session id
            h = _hm.sha256()
            with open(tmp_path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
            audio_hash = h.hexdigest()[:16]
            session_id = f"cmp_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{audio_hash[:6]}"

            # Audio analysis
            audio_info = _cmp_analyze_audio(tmp_path)
            audio_info["filename"] = orig_filename

            # Convert non-wav to wav for analysis
            work_path = tmp_path
            if not suffix.lower().endswith(".wav"):
                wav_out = tmp_path + "_base.wav"
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", wav_out],
                        capture_output=True, timeout=60
                    )
                    if os.path.exists(wav_out):
                        work_path = wav_out
                        audio_info = _cmp_analyze_audio(wav_out)
                        audio_info["filename"] = orig_filename
                except Exception:
                    pass

            # Pre-normalize
            norm_path = _normalize_audio(work_path)

            # Pre-denoise (aggressive ffmpeg afftdn)
            denoise_path = work_path + "_dn.wav"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", work_path,
                     "-af", "highpass=f=80,lowpass=f=8000,afftdn=nf=-30,loudnorm=I=-16:TP=-1.5:LRA=11",
                     "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", denoise_path],
                    capture_output=True, timeout=60
                )
                if not os.path.exists(denoise_path):
                    denoise_path = work_path
            except Exception:
                denoise_path = work_path

            # Recommendation
            recommended_id, rec_reason = _cmp_recommend(
                audio_info["dynamic_range_db"], audio_info["snr_estimate_db"]
            )

            # Emit audio_info event
            yield f"data: {json.dumps({'type':'audio_info','audio_info':audio_info,'session_id':session_id,'recommended_id':recommended_id,'rec_reason':rec_reason,'total':len(_CMP_SYSTEMS)}, ensure_ascii=False)}\n\n"

            model = load_model(_current_model_id or DEFAULT_MODEL)
            results = []

            for idx, (sid_sys, label, beam, cond_prev, vad_agg, compute, do_norm, do_denoise) in enumerate(_CMP_SYSTEMS):
                t0 = time.time()
                try:
                    audio_for_sys = (norm_path if do_norm else work_path) if not do_denoise else denoise_path
                    if do_denoise and do_norm:
                        # denoise already applied; now apply loudnorm on top
                        audio_for_sys = denoise_path

                    from faster_whisper import BatchedInferencePipeline
                    pipeline = BatchedInferencePipeline(model=model)
                    segs_iter, info = pipeline.transcribe(
                        audio_for_sys,
                        language="he",
                        beam_size=beam,
                        batch_size=auto_batch_size(),
                        condition_on_previous_text=cond_prev,
                        word_timestamps=True,
                    )
                    words = []
                    text_parts = []
                    for seg in segs_iter:
                        text_parts.append(seg.text.strip())
                        if seg.words:
                            for w in seg.words:
                                words.append({
                                    "word": w.word.strip(),
                                    "prob": round(float(w.probability), 3),
                                })
                    full_text = " ".join(text_parts)
                    elapsed = round(time.time() - t0, 2)
                    word_count = len(full_text.split()) if full_text else 0
                    avg_prob = round(sum(w["prob"] for w in words) / max(len(words), 1), 3)

                    result = {
                        "id": sid_sys, "label": label, "beam": beam,
                        "normalize": do_norm, "denoise": do_denoise,
                        "text": full_text, "word_count": word_count,
                        "elapsed_s": elapsed, "avg_prob": avg_prob,
                        "words": words, "error": None,
                    }
                except Exception as e:
                    elapsed = round(time.time() - t0, 2)
                    result = {
                        "id": sid_sys, "label": label, "beam": beam,
                        "normalize": do_norm, "denoise": do_denoise,
                        "text": "", "word_count": 0, "elapsed_s": elapsed,
                        "avg_prob": 0, "words": [], "error": str(e)[:200],
                    }

                results.append(result)
                event_data = {"type": "result", "index": idx, "total": len(_CMP_SYSTEMS), "result": result}
                yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            # Save session
            with _cmp_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO sessions "
                    "(session_id, created_at, audio_hash, audio_filename, duration_s, channels, "
                    "sample_rate, dynamic_range_db, snr_estimate_db, noise_rms, noise_level, "
                    "results_json, recommended_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        session_id,
                        datetime.now(timezone.utc).isoformat(),
                        audio_hash,
                        orig_filename,
                        audio_info["duration_s"],
                        audio_info["channels"],
                        audio_info["sample_rate"],
                        audio_info["dynamic_range_db"],
                        audio_info["snr_estimate_db"],
                        audio_info["noise_rms"],
                        audio_info["noise_level_label"],
                        json.dumps(results, ensure_ascii=False),
                        recommended_id,
                    )
                )
                conn.commit()

            done_event = {
                "type": "done",
                "session_id": session_id,
                "recommended_id": recommended_id,
                "rec_reason": rec_reason,
                "audio_info": audio_info,
                "results": results,
            }
            yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type':'error','error':str(e)[:400]}, ensure_ascii=False)}\n\n"
        finally:
            for p in [tmp_path, denoise_path, norm_path]:
                if p and p != tmp_path and os.path.exists(p):
                    try:
                        os.unlink(p)
                    except Exception:
                        pass
            if os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

    return Response(
        _sse_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Benchmark stats ───────────────────────────────────────────────────────────
@app.route("/lk/benchmark/stats", methods=["GET"])
def lk_benchmark_stats():
    """Aggregate personal benchmark statistics."""
    import statistics as _st

    with _lk_db() as conn:
        sessions = conn.execute(
            "SELECT session_id, audio_filename, raw_text, corrected_text, words_fixed, created_at "
            "FROM lk_sessions ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
        dict_entries = conn.execute(
            "SELECT spoken_form, correct_form, count_applied, source "
            "FROM lk_dictionary ORDER BY count_applied DESC LIMIT 20"
        ).fetchall()
        rules = conn.execute(
            "SELECT id, name, enabled FROM lk_grammar_rules"
        ).fetchall()

    total_sessions = len(sessions)
    total_words_fixed = sum(s["words_fixed"] for s in sessions)
    enabled_rules = sum(1 for r in rules if r["enabled"])

    session_data = []
    for s in sessions[:30]:
        raw_words = len((s["raw_text"] or "").split()) if s["raw_text"] else 0
        wf = s["words_fixed"] or 0
        session_data.append({
            "date": (s["created_at"] or "")[:16],
            "filename": s["audio_filename"] or "",
            "words_fixed": wf,
            "word_count": raw_words,
            "correction_rate": round(wf / max(raw_words, 1) * 100, 1),
        })

    top_corrections = [
        {"spoken": e["spoken_form"], "correct": e["correct_form"],
         "count": e["count_applied"], "source": e["source"]}
        for e in dict_entries if (e["count_applied"] or 0) > 0
    ]

    # Trend: compare last 5 sessions vs prior 5
    recent = [s["words_fixed"] for s in sessions[:5]]
    older = [s["words_fixed"] for s in sessions[5:10]]
    if recent and older:
        r_avg = _st.mean(recent)
        o_avg = _st.mean(older)
        if r_avg > o_avg * 1.1:
            trend, trend_label = "improving", "מגמת שיפור 📈"
        elif r_avg < o_avg * 0.9:
            trend, trend_label = "declining", "מגמת ירידה 📉"
        else:
            trend, trend_label = "stable", "יציב 📊"
    else:
        trend, trend_label = "unknown", "אין מספיק נתונים"

    return jsonify({
        "total_sessions": total_sessions,
        "total_words_fixed": total_words_fixed,
        "total_dict_entries": len(dict_entries),
        "enabled_rules": enabled_rules,
        "top_corrections": top_corrections,
        "sessions": session_data,
        "trend": trend,
        "trend_label": trend_label,
    })


# ── Benchmark run ─────────────────────────────────────────────────────────────
@app.route("/lk/benchmark/run", methods=["POST"])
def lk_benchmark_run():
    """
    Full benchmark analysis of an audio file.
    Returns per-word confidence, pronunciation score, rules fired, and personalised feedback.
    """
    import statistics as _st
    import re as _re
    import uuid as _uuid

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    audio_file = request.files["file"]
    beam_size = int(request.form.get("beam_size", 5))

    suffix = os.path.splitext(audio_file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        t0 = time.time()
        model = load_model(_current_model_id or DEFAULT_MODEL)

        segments_iter, info = model.transcribe(
            tmp_path,
            beam_size=beam_size,
            language="he",
            word_timestamps=True,
            initial_prompt=LOSHON_KODESH_PROMPT,
            hotwords=",".join(LOSHON_KODESH_HOTWORDS[:20]) if LOSHON_KODESH_HOTWORDS else None,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            repetition_penalty=1.3,
            log_prob_threshold=-1.0,
        )

        word_timings = []
        for seg in segments_iter:
            if hasattr(seg, "words") and seg.words:
                for w in seg.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "probability": round(float(w.probability), 3),
                    })

        raw_text = " ".join(wt["word"] for wt in word_timings if wt["word"])
        duration = float(info.duration or 0)
        processing_time = round(time.time() - t0, 2)

        corrected_text, words_fixed = _lk_apply_postprocessing(raw_text)

        # Detect which rules fired
        rules_fired = []
        with _lk_db() as conn:
            rules = conn.execute(
                "SELECT name, pattern FROM lk_grammar_rules WHERE enabled=1 ORDER BY priority DESC"
            ).fetchall()
            for r in rules:
                try:
                    if _re.search(r["pattern"], raw_text):
                        rules_fired.append(r["name"])
                except Exception:
                    pass
            dict_ents = conn.execute(
                "SELECT spoken_form, correct_form FROM lk_dictionary"
            ).fetchall()
            for e in dict_ents:
                if e["spoken_form"].lower() in raw_text.lower():
                    rules_fired.append(f"מילון: {e['spoken_form']} → {e['correct_form']}")

        # Scores
        probs = [wt["probability"] for wt in word_timings if wt["probability"] > 0]
        avg_prob = _st.mean(probs) if probs else 0.0
        total_words = len(word_timings) or 1
        pronunciation_score = round(avg_prob * 100, 1)
        rtf = round(processing_time / max(duration, 0.1), 3)

        # Grade
        if pronunciation_score >= 88:
            grade, grade_color = "מצוין 🏆", "green"
        elif pronunciation_score >= 74:
            grade, grade_color = "טוב 👍", "blue"
        elif pronunciation_score >= 60:
            grade, grade_color = "בסדר 📚", "amber"
        else:
            grade, grade_color = "צריך שיפור 💪", "red"

        weak_words = [wt["word"] for wt in word_timings if wt["probability"] < 0.65 and len(wt["word"]) > 1][:10]
        strong_words = [wt["word"] for wt in word_timings if wt["probability"] > 0.9 and len(wt["word"]) > 1]
        strong_pct = round(len(strong_words) / total_words * 100)

        if pronunciation_score >= 88:
            feedback = f"הגייה ברמה גבוהה מאוד! Whisper זיהה {strong_pct}% מהמילים ברמת ביטחון גבוהה."
        elif pronunciation_score >= 74:
            feedback = f"הגייה טובה. {strong_pct}% מהמילים זוהו בביטחון גבוה. {len(weak_words)} מילים צריכות חיזוק."
        elif pronunciation_score >= 60:
            feedback = f"הגייה ממוצעת. מומלץ לאמן את המילים: {', '.join(weak_words[:5]) if weak_words else '—'}."
        else:
            feedback = f"קצב דיבור מהיר מדי, רעש רקע, או הגייה לא מוכרת. {len(weak_words)} מילים ברמת ביטחון נמוכה."

        tips = []
        if weak_words:
            tips.append(f"תרגל את המילים: {', '.join(weak_words[:5])}")
        if words_fixed > 0:
            tips.append(f"המערכת תיקנה {words_fixed} מילים — עיין בטאב מילון")
        if rtf > 0.5:
            tips.append("שקול שימוש במיקרופון איכותי לשיפור הדיוק")
        if not tips:
            tips.append("כל הכבוד! המשך לשמור על הגייה נקייה וברורה")

        # Save to sessions
        session_id = str(_uuid.uuid4())[:8]
        with _lk_db() as conn:
            conn.execute(
                "INSERT INTO lk_sessions (session_id, audio_filename, raw_text, corrected_text, words_fixed) "
                "VALUES (?,?,?,?,?)",
                (session_id, audio_file.filename or "benchmark", raw_text, corrected_text, words_fixed),
            )
            conn.commit()

        return jsonify({
            "session_id": session_id,
            "raw_text": raw_text,
            "corrected_text": corrected_text,
            "words_fixed": words_fixed,
            "word_timings": word_timings,
            "duration": round(duration, 2),
            "processing_time": processing_time,
            "rtf": rtf,
            "total_words": total_words,
            "pronunciation_score": pronunciation_score,
            "avg_probability": round(avg_prob, 3),
            "grade": grade,
            "grade_color": grade_color,
            "weak_words": weak_words,
            "strong_pct": strong_pct,
            "rules_fired": rules_fired,
            "feedback": feedback,
            "tips": tips,
        })
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
