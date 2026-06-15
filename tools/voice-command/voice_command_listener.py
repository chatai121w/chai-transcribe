#!/usr/bin/env python3
"""
voice_command_listener.py — האזנה ברקע לפקודות קוליות עבריות
==============================================================

ארכיטקטורה (3 שכבות סינון):
  1. RMS energy threshold  → מחסל שקט לגמרי (אין GPU)
  2. faster-whisper tiny   → מתמלל utterance קצר (~200ms עם CUDA)
  3. בדיקת מילות trigger   → "תמלל", "הקלט", "התחל", וכד'

כשtrigger מזוהה:
  → מקליט עד 3 שניות שקט (מקסימום 45 שניות)
  → שולח WAV לשרת Whisper המקומי (port 3000)
  → מדביק תוצאה לחלון הממוקד

דרישות:
  pip install faster-whisper sounddevice numpy requests
  (torch+cuda כבר מותקן)

הפעלה:
  python voice_command_listener.py
  python voice_command_listener.py --model base --device cpu
"""

import argparse
import ast
import ctypes
import difflib
import http.server
import io
import json
import math
import operator as _operator
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import wave
import webbrowser

import numpy as np
import requests
import sounddevice as sd

# ── ודא שמריצים מה-venv הנכון ────────────────────────────────────────────────
_THIS_DIR     = os.path.dirname(os.path.abspath(__file__))
_UI_HTML_PATH = os.path.join(_THIS_DIR, "ui.html")
_REPO_ROOT    = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
_VENV_SITE = os.path.join(_REPO_ROOT, ".venv", "Lib", "site-packages")
if os.path.isdir(_VENV_SITE) and _VENV_SITE not in sys.path:
    sys.path.insert(0, _VENV_SITE)

# ── הגדרות ────────────────────────────────────────────────────────────────────
SAMPLE_RATE    = 16_000      # Hz (Whisper דורש 16kHz)
CHANNELS       = 1
DTYPE          = "int16"
CHUNK_MS       = 30          # ms לכל chunk → 480 samples
CHUNK_SAMPLES  = SAMPLE_RATE * CHUNK_MS // 1000  # = 480

# ── מודל Whisper לזיהוי פקודות (הכי מהיר) ───────────────────────────────────
DEFAULT_MODEL   = "tiny"     # tiny=מהיר מאוד, base=קצת יותר דיוק
DEFAULT_DEVICE  = "cuda"     # cuda / cpu

# ── מילות trigger (עברית + אנגלית) ──────────────────────────────────────────
TRIGGER_WORDS = {
    # עברית
    "תמלל", "תמלל עכשיו", "תמלל בבקשה",
    "הקלט", "הקלט עכשיו",
    "התחל הקלטה", "התחל",
    "כתוב", "כתוב עכשיו",
    "רשום", "רשום עכשיו",
    # אנגלית (fallback)
    "transcribe", "record", "start",
}

STOP_WORDS = {
    "עצור", "סיים", "סיום", "בטל", "הפסק",
    "stop", "cancel", "finish",
}

# ── שרת Whisper (להקלטה המלאה) ───────────────────────────────────────────────
WHISPER_SERVER  = "http://localhost:3000/transcribe"

# ── פרמטרי VAD ────────────────────────────────────────────────────────────────
RMS_THRESHOLD   = 200     # ≈ -44 dBFS — מתחת לזה = שקט
MIN_SPEECH_MS   = 250     # מינימום דיבור לפני עיבוד
SILENCE_END_MS  = 700     # ms שקט → utterance הסתיים
MAX_SPEECH_S    = 5       # מקסימום אורך utterance לזיהוי פקודה (שנ')

# ── פרמטרי הקלטה מלאה ────────────────────────────────────────────────────────
REC_SILENCE_S   = 3.0     # שקט → עצור הקלטה
REC_MAX_S       = 45.0    # מקסימום שניות הקלטה
REC_BEAM        = 5       # beam_size לשרת (דיוק מרבי)

# ── State גלובלי ──────────────────────────────────────────────────────────────
_audio_q:      queue.Queue[bytes] = queue.Queue(maxsize=1000)
_running       = threading.Event()
_running.set()
_recording_now = threading.Event()   # True כשהקלטה מלאה פעילה
_whisper       = None               # faster_whisper.WhisperModel

# ── UI / SSE state ────────────────────────────────────────────────────────────
_ui_clients:      list = []
_ui_lock               = threading.Lock()
_current_state: str    = "idle"
_last_heard:    str    = ""
_last_transcribed: str = ""
_last_task:     str    = ""
_groq_key:      str    = ""   # Groq API key (optional — console.groq.com)
_wake_words:    list[str] = []  # מילות התעוררות — אם מוגדר, רק הן מפעילות את המערכת
_engine_mode:   str    = "groq_first"  # groq_first | groq_only | local_first | local_only | parallel


# ════════════════════════════════════════════════════════════════════════════
# שכבה 1: sounddevice callback (thread נפרד של sounddevice)
# ════════════════════════════════════════════════════════════════════════════

def _audio_callback(indata, frames, time_info, status):
    """מועתק ישירות מ-sounddevice לתור — ללא עיבוד."""
    try:
        _audio_q.put_nowait(bytes(indata))
    except queue.Full:
        pass  # Drop frame — עדיפות ל-real-time


# ════════════════════════════════════════════════════════════════════════════
# שכבה 2: RMS energy (CPU בלבד)
# ════════════════════════════════════════════════════════════════════════════

def _rms(chunk: bytes) -> float:
    arr = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
    return math.sqrt(float(np.mean(arr ** 2))) if len(arr) else 0.0


# ════════════════════════════════════════════════════════════════════════════
# שכבה 3: faster_whisper (GPU/CPU)
# ════════════════════════════════════════════════════════════════════════════

def _transcribe_command(audio_bytes: bytes) -> str:
    """
    מתמלל קליפ קצר לזיהוי פקודה.

    תיקונים מהפורומים (github.com/openai/whisper/discussions/928, faster-whisper):
    1. PAD ל-2s מינימום — Whisper מאומן על 30s; קליפים קצרים גורמים hallucination
       כי המודל "לומד" לשייך שקט לכיתובי subtitle ומוסיף אותם.
    2. initial_prompt — מכוון את המודל לצפות למילות trigger עבריות בלבד.
    3. temperature=0 — גרידי, קריטי להפחתת hallucination בקליפים קצרים.
    4. no_speech_threshold=0.6 — Silero VAD ינפה שקט לפני Whisper.
    5. סינון לפי no_speech_prob — אם Whisper עצמו לא בטוח שיש דיבור → בטל.
    6. condition_on_previous_text=False — מונע "prompt drift" בין utterances.
    """
    arr = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    # ── 1. Pad ל-2 שניות מינימום ──────────────────────────────────────────────
    MIN_SAMPLES = SAMPLE_RATE * 2   # 2s @ 16kHz = 32000 samples
    if len(arr) < MIN_SAMPLES:
        arr = np.concatenate([arr, np.zeros(MIN_SAMPLES - len(arr), dtype=np.float32)])

    # ── 2. initial_prompt: מילות trigger / wake word שהמודל מצפה לשמוע ──────────
    _base_prompt = "תמלל, הקלט, התחל, כתוב, רשום, עצור, סיים"
    PROMPT = (", ".join(_wake_words) + ", " if _wake_words else "") + _base_prompt

    segs, _info = _whisper.transcribe(
        arr,
        language="he",
        initial_prompt=PROMPT,          # 2. hint למודל
        temperature=0.0,                # 3. greedy — הפחתת hallucination
        beam_size=5,                    # יותר candidates → בוחר הכי סביר
        vad_filter=True,                # 4. Silero VAD מסנן שקט
        vad_parameters={
            "threshold": 0.60,          # 4. סינון אגרסיבי יותר (ברירת מחדל: 0.5)
            "min_silence_duration_ms": 400,
            "speech_pad_ms": 200,       # padding סביב דיבור
        },
        without_timestamps=True,
        condition_on_previous_text=False,  # 6. אין drift
        compression_ratio_threshold=2.0,   # דחה חזרות (hallucination סימן)
        log_prob_threshold=-1.5,           # דחה תוצאות בטחון נמוך מאוד
        no_speech_threshold=0.6,           # 4. פאלבק אם VAD לא מספיק
    )

    # ── 5. סינון לפי no_speech_prob ─────────────────────────────────────────
    parts: list[str] = []
    for seg in segs:
        if getattr(seg, "no_speech_prob", 0.0) > 0.70:
            continue   # Whisper עצמו חושב שאין דיבור → דלג
        parts.append(seg.text.strip())

    return " ".join(parts).strip()


def _contains_trigger(text: str) -> bool:
    t = text.strip()
    # 1. התאמה מדויקת (sub-string)
    if any(w in t for w in TRIGGER_WORDS):
        return True
    # 2. התאמה מקורבת — מכסה transcription חלקי כמו "תמ" במקום "תמלל"
    for word in TRIGGER_WORDS:
        if len(word) < 3:
            continue   # מילים קצרות מדי — false positives
        ratio = difflib.SequenceMatcher(None, word, t).ratio()
        if ratio >= 0.72:
            return True
    return False


def _contains_stop(text: str) -> bool:
    t = text.strip()
    return any(w in t for w in STOP_WORDS)


def _extract_after_wake_word(text: str) -> str | None:
    """
    בודק אם הטקסט מתחיל במילת התעוררות (עם fuzzy matching).
    מחזיר את החלק שאחרי מילת התעוררות, או None אם לא נמצאה.
    """
    if not _wake_words:
        return None
    t = text.strip()
    t_lower = t.lower()
    for ww in _wake_words:
        ww_l = ww.lower().strip()
        # התאמה מדויקת: prefix
        if t_lower.startswith(ww_l):
            return t[len(ww):].strip(" ,،.!?")
        # fuzzy: בדוק בתחילת המשפט (הדלת fuzzy מכסה transcription לא מדויק)
        window = t[:len(ww) + 4]   # מעט תוספת תווים
        ratio = difflib.SequenceMatcher(None, ww_l, window.lower()).ratio()
        if ratio >= 0.68:
            return t[len(ww):].strip(" ,،.!?")
    return None


# ════════════════════════════════════════════════════════════════════════════
# מנוע משימות — Tasks Engine
# ════════════════════════════════════════════════════════════════════════════

# ── מפת קיצורי תוכנות ────────────────────────────────────────────────────────
_APP_MAP: dict[str, str] = {
    "פנקס רשימות": "notepad.exe",  "פנקס":        "notepad.exe",
    "מחשבון":      "calc.exe",     "סייר קבצים":  "explorer.exe",
    "סייר":        "explorer.exe", "צבע":          "mspaint.exe",
    "מנהל משימות": "taskmgr.exe",  "הגדרות":       "ms-settings:",
    "notepad":     "notepad.exe",  "calculator":   "calc.exe",
    "calc":        "calc.exe",     "explorer":     "explorer.exe",
    "paint":       "mspaint.exe",  "word":         "winword.exe",
    "excel":       "excel.exe",    "powerpoint":   "powerpnt.exe",
    "outlook":     "outlook.exe",  "teams":        "msteams.exe",
    "chrome":      "chrome.exe",   "firefox":      "firefox.exe",
    "edge":        "msedge.exe",   "code":         "code.exe",
    "vscode":      "code.exe",     "terminal":     "wt.exe",
    "taskmanager": "taskmgr.exe",  "settings":     "ms-settings:",
}


def _open_url(url: str) -> str:
    webbrowser.open(url)
    return f"פתח: {url}"


def _do_open_app(name: str) -> str:
    clean  = name.strip().lower()
    target = _APP_MAP.get(clean, clean)
    if target.startswith("ms-"):
        subprocess.Popen(["cmd", "/c", "start", "", target],
                         creationflags=0x08000000)
        return "פותח הגדרות"
    safe = re.sub(r"[^\w\s\.\-\+]", "", target).strip()
    if not safe:
        return "שם תוכנה לא תקין"
    subprocess.Popen(["cmd", "/c", "start", "", safe],
                     creationflags=0x08000000)
    return f"פותח: {safe}"


def _system_restart() -> str:
    subprocess.Popen(["shutdown", "/r", "/t", "10"],
                     creationflags=0x08000000)
    return "🔁 הפעלה מחדש תוך 10 שניות — אמור 'בטל כיבוי' לביטול"


def _system_shutdown() -> str:
    subprocess.Popen(["shutdown", "/s", "/t", "10"],
                     creationflags=0x08000000)
    return "⏹ כיבוי מחשב תוך 10 שניות — אמור 'בטל כיבוי' לביטול"


def _system_cancel_shutdown() -> str:
    subprocess.Popen(["shutdown", "/a"], creationflags=0x08000000)
    return "✅ כיבוי/הפעלה מחדש בוטל"


def _system_lock() -> str:
    ctypes.windll.user32.LockWorkStation()
    return "🔒 מסך ננעל"


# ── חישוב מתמטי בטוח (ללא eval) ──────────────────────────────────────────────
_NUM_MAP = {
    "כפול": "*",    "חלקי": "/",    "חלק": "/",
    "ועוד": "+",    "פלוס": "+",
    "מינוס": "-",   "פחות": "-",    "בחסר": "-",
    "בחזקת": "**",  "בחזקה": "**",
    "אפס": "0",     "אחת": "1",     "אחד": "1",
    "שתיים": "2",   "שניים": "2",   "שלוש": "3",   "שלושה": "3",
    "ארבע": "4",    "ארבעה": "4",   "חמש": "5",    "חמישה": "5",
    "שש": "6",      "שישה": "6",    "שבע": "7",    "שבעה": "7",
    "שמונה": "8",   "תשע": "9",     "תשעה": "9",
    "עשר": "10",    "עשרה": "10",   "עשרים": "20", "שלושים": "30",
    "ארבעים": "40", "חמישים": "50", "שישים": "60", "שבעים": "70",
    "שמונים": "80", "תשעים": "90",  "מאה": "100",  "אלף": "1000",
}

_SAFE_OPS = {
    ast.Add:      _operator.add,     ast.Sub:      _operator.sub,
    ast.Mult:     _operator.mul,     ast.Div:      _operator.truediv,
    ast.Pow:      _operator.pow,     ast.Mod:      _operator.mod,
    ast.FloorDiv: _operator.floordiv,
    ast.USub:     _operator.neg,     ast.UAdd:     _operator.pos,
}


def _safe_eval(expr: str):
    """מחשב ביטוי מתמטי ללא exec/eval — מספרים ואופרטורים בלבד."""
    def _node(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _SAFE_OPS:
            l, r = _node(n.left), _node(n.right)
            return _SAFE_OPS[type(n.op)](l, r) if l is not None and r is not None else None
        if isinstance(n, ast.UnaryOp) and type(n.op) in _SAFE_OPS:
            v = _node(n.operand)
            return _SAFE_OPS[type(n.op)](v) if v is not None else None
        return None
    try:
        return _node(ast.parse(expr.strip(), mode="eval").body)
    except Exception:
        return None


def _do_calc(expr: str) -> str:
    e = expr.strip().lower()
    for heb, sym in _NUM_MAP.items():
        e = e.replace(heb, sym)
    e = re.sub(r"[^\d\s\+\-\*\/\(\)\.]", "", e).strip()
    if not e:
        return f"לא הצלחתי לחשב: {expr}"
    result = _safe_eval(e)
    if result is None:
        return f"לא הצלחתי לחשב: {expr}"
    r = int(result) if isinstance(result, float) and result == int(result) else round(result, 6)
    return f"📊 {expr} = {r}"


# ── prefix גמיש — מכסה "פתח", "תפתח", "אפשר לפתוח", "תוכל לפתוח לי" וכו' ──
_OPEN_PREFIX = r"(?:(?:אפשר|תוכל|יכול|בבקשה)\s+)?(?:ל)?(?:פתח|תפתח|תפעיל|פעיל|טען|קפוץ|עבור|הראה)(?:\s+לי)?"

# ── כללי משימות (סדר חשוב — כלל ראשון שמתאים מנצח) ───────────────────────────
TASK_RULES: list[tuple] = [
    # אתרים
    (rf"{_OPEN_PREFIX}.*?(?:יוטיוב|youtube)",
     lambda m: _open_url("https://youtube.com")),
    (rf"{_OPEN_PREFIX}.*?(?:מפות|maps)",
     lambda m: _open_url("https://maps.google.com")),
    (rf"{_OPEN_PREFIX}.*?(?:גוגל|google)(?!\s+(?:מפות|maps))",
     lambda m: _open_url("https://google.com")),
    (rf"{_OPEN_PREFIX}.*?(?:ווטסאפ|וואטסאפ|whatsapp|ווצאפ|ואטסאפ)",
     lambda m: _open_url("https://web.whatsapp.com")),
    (rf"{_OPEN_PREFIX}.*?(?:gmail|ג.ימייל|ג'ימייל|מייל גוגל)",
     lambda m: _open_url("https://gmail.com")),
    (rf"{_OPEN_PREFIX}.*?(?:spotify|ספוטיפיי|ספוטיפי)",
     lambda m: _open_url("https://open.spotify.com")),
    (rf"{_OPEN_PREFIX}.*?(?:netflix|נטפליקס|נטפליקס)",
     lambda m: _open_url("https://netflix.com")),
    (rf"{_OPEN_PREFIX}.*?(?:wikipedia|ויקיפדיה|ויקי)",
     lambda m: _open_url("https://he.wikipedia.org")),
    (rf"{_OPEN_PREFIX}.*?github",
     lambda m: _open_url("https://github.com")),
    (rf"{_OPEN_PREFIX}.*?(?:twitter|x\.com|טוויטר)",
     lambda m: _open_url("https://x.com")),
    (rf"{_OPEN_PREFIX}.*?(?:amazon|אמזון)",
     lambda m: _open_url("https://amazon.co.il")),
    (rf"{_OPEN_PREFIX}.*?(?:walla|וואלה)",
     lambda m: _open_url("https://walla.co.il")),
    (rf"{_OPEN_PREFIX}.*?(?:ynet|וואינט)",
     lambda m: _open_url("https://ynet.co.il")),
    # חיפוש גוגל
    (r"(?:חפש|חפשו|תחפש|תחפשי|תמצא|מצא)\s+(?:לי\s+)?(?:ב.?גוגל\s+)?(.+)",
     lambda m: _open_url(f"https://www.google.com/search?q={urllib.parse.quote_plus(m.group(1).strip())}")),
    # פעולות מערכת
    (r"(?:הפעל|אתחל)\s*(?:מחדש|את\s*המחשב)|restart",
     lambda m: _system_restart()),
    (r"כבה\s*(?:את\s*)?(?:המחשב|מחשב)|shutdown",
     lambda m: _system_shutdown()),
    (r"בטל\s*(?:את\s*)?(?:הכיבוי|האתחול|ההפעלה)|abort\s*shutdown",
     lambda m: _system_cancel_shutdown()),
    (r"(?:נעל|תנעל)\s*(?:את\s*)?(?:המסך|מסך)|lock",
     lambda m: _system_lock()),
    # חישוב
    (r"(?:חשב|תחשב|כמה\s+זה|כמה\s+עולה|מה\s+זה|מה\s+שווה|מה\s+יוצא)\s+(.+)",
     lambda m: _do_calc(m.group(1))),
    # פתיחת תוכנות — חייב להיות אחרון (כלל כללי)
    (rf"{_OPEN_PREFIX}\s+(.+)",
     lambda m: _do_open_app(m.group(1))),
]


def _match_task(text: str):
    """בודק אם הטקסט תואם משימה ומבצע אותה. מחזיר תיאור תוצאה, או None."""
    t = text.strip()
    for pattern, handler in TASK_RULES:
        m = re.search(pattern, t, re.IGNORECASE)
        if m:
            try:
                result = handler(m)
                if result:
                    return result
            except Exception as e:
                return f"שגיאה במשימה: {e}"
    return None


def _second_pass_transcribe(audio_bytes: bytes) -> str:
    """
    Pass 2: מתמלל את אותו אודיו שוב עם initial_prompt מרוכז בפקודות.
    קורה רק אם Pass 1 לא זיהה משימה.
    """
    if _whisper is None:
        return ""
    arr = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    MIN_SAMPLES = SAMPLE_RATE * 2
    if len(arr) < MIN_SAMPLES:
        arr = np.concatenate([arr, np.zeros(MIN_SAMPLES - len(arr), dtype=np.float32)])

    COMMAND_PROMPT = (
        "פתח יוטיוב, פתח גוגל, פתח ווטסאפ, פתח מחשבון, פתח נוטפד, "
        "חפש, הפעל מחדש, כבה מחשב, נעל מסך, חשב, כמה זה, "
        "פתח ספוטיפיי, פתח נטפליקס, פתח הגדרות, פתח סייר, "
        "תפתח, תחפש, תחשב, תנעל"
    )
    segs, _ = _whisper.transcribe(
        arr,
        language="he",
        initial_prompt=COMMAND_PROMPT,
        temperature=0.0,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"threshold": 0.50, "min_silence_duration_ms": 300, "speech_pad_ms": 150},
        without_timestamps=True,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
    )
    parts = [seg.text.strip() for seg in segs
             if getattr(seg, "no_speech_prob", 0.0) <= 0.70]
    return " ".join(parts).strip()


# ════════════════════════════════════════════════════════════════════════════
# Groq Whisper API (Pass 1a — cloud, large-v3)
# ════════════════════════════════════════════════════════════════════════════

def _transcribe_with_groq(tmp_path: str) -> str | None:
    """
    שולח WAV לـGroq Whisper large-v3.
    מחזיר טקסט תמלול, או None אם נכשל (יחזור לשרת מקומי).
    """
    if not _groq_key:
        return None
    try:
        with open(tmp_path, "rb") as f:
            resp = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {_groq_key}"},
                files={"file": ("rec.wav", f, "audio/wav")},
                data={
                    "model":           "whisper-large-v3",
                    "language":        "he",
                    "response_format": "json",
                },
                timeout=30,
            )
        resp.raise_for_status()
        return resp.json().get("text", "").strip() or None
    except requests.exceptions.HTTPError as e:
        _log(f"\u26a0\ufe0f  Groq HTTP {e.response.status_code} \u2014 \u05e2\u05d5\u05d1\u05e8 \u05dc\u05e9\u05e8\u05ea \u05de\u05e7\u05d5\u05de\u05d9")
    except requests.ConnectionError:
        _log("\u26a0\ufe0f  Groq \u05dc\u05d0 \u05d6\u05de\u05d9\u05df \u2014 \u05e2\u05d5\u05d1\u05e8 \u05dc\u05e9\u05e8\u05ea \u05de\u05e7\u05d5\u05de\u05d9")
    except Exception as e:
        _log(f"\u26a0\ufe0f  Groq \u05e9\u05d2\u05d9\u05d0\u05d4: {e} \u2014 \u05e2\u05d5\u05d1\u05e8 \u05dc\u05e9\u05e8\u05ea \u05de\u05e7\u05d5\u05de\u05d9")
    return None


# ════════════════════════════════════════════════════════════════════════════
# מנועי תמלול — Local + Groq
# ════════════════════════════════════════════════════════════════════════════

def _transcribe_local(tmp_path: str) -> str | None:
    """שולח WAV לשרת Whisper מקומי. מחזיר טקסט או None."""
    try:
        with open(tmp_path, "rb") as wav_f:
            resp = requests.post(
                WHISPER_SERVER,
                files={"file": ("rec.wav", wav_f, "audio/wav")},
                data={"language": "he", "beam_size": str(REC_BEAM),
                      "normalize": "1", "word_timestamps": "0"},
                timeout=90,
            )
        resp.raise_for_status()
        text = resp.json().get("text", "").strip()
        if text:
            _log(f"✅ תמלול מקומי: {text}")
        return text or None
    except requests.ConnectionError:
        _log(f"❌ שרת Whisper לא זמין ({WHISPER_SERVER})")
        return None
    except Exception as e:
        _log(f"❌ שגיאה בשרת מקומי: {e}")
        return None


def _transcribe_by_mode(tmp_path: str) -> str | None:
    """
    מריץ את ה-transcription לפי _engine_mode:
      groq_first  — Groq → fallback מקומי (ברירת מחדל)
      groq_only   — Groq בלבד, ללא fallback
      local_first — מקומי → fallback Groq
      local_only  — מקומי בלבד
      parallel    — שניהם במקביל, ראשון שמחזיר ניצח
    """
    mode = _engine_mode

    if mode == "groq_only":
        if not _groq_key:
            _log("⚠️  מצב groq_only אבל אין מפתח Groq")
            return None
        _log("☁️  Groq only…")
        result = _transcribe_with_groq(tmp_path)
        if not result:
            _log("⚠️  Groq לא הצליח (מצב groq_only — אין fallback)")
        return result

    elif mode == "local_only":
        _log("🏠 Local only…")
        return _transcribe_local(tmp_path)

    elif mode == "groq_first":
        if _groq_key:
            _log("☁️  Groq first…")
            result = _transcribe_with_groq(tmp_path)
            if result:
                return result
            _log("🔄 Groq נכשל — fallback מקומי")
        return _transcribe_local(tmp_path)

    elif mode == "local_first":
        _log("🏠 Local first…")
        result = _transcribe_local(tmp_path)
        if result:
            return result
        if _groq_key:
            _log("🔄 שרת מקומי נכשל — fallback Groq")
            return _transcribe_with_groq(tmp_path)
        return None

    elif mode == "parallel":
        if not _groq_key:
            _log("⚡ Parallel (אין Groq key) → מקומי בלבד")
            return _transcribe_local(tmp_path)
        _log("⚡ Parallel — Groq + מקומי בו-זמנית")
        results: list[str | None] = [None, None]
        evt = threading.Event()

        def _run_groq():
            results[0] = _transcribe_with_groq(tmp_path)
            if results[0]: evt.set()

        def _run_local():
            results[1] = _transcribe_local(tmp_path)
            if results[1]: evt.set()

        t1 = threading.Thread(target=_run_groq,  daemon=True)
        t2 = threading.Thread(target=_run_local, daemon=True)
        t1.start(); t2.start()
        evt.wait(timeout=60)
        t1.join(timeout=1); t2.join(timeout=1)
        winner = results[0] or results[1]
        if winner:
            src = "Groq" if results[0] else "מקומי"
            _log(f"⚡ Parallel: ניצח {src}")
        return winner

    # fallback
    return _transcribe_local(tmp_path)


# ════════════════════════════════════════════════════════════════════════════
# הקלטה מלאה → שרת Whisper → הדבקה
# ════════════════════════════════════════════════════════════════════════════

def _do_full_recording():
    """
    מקליט עד REC_SILENCE_S שניות שקט (מקסימום REC_MAX_S שניות).
    שולח WAV לשרת ומדביק תוצאה.
    """
    global _last_transcribed, _last_task
    _recording_now.set()
    _set_state("recording")
    _log("🔴 מקליט… (ישתוק 3 שנ' לסיום)")

    rec_chunks: list[bytes] = []
    silence_ms  = 0.0
    total_ms    = 0.0

    while _running.is_set() and total_ms < REC_MAX_S * 1000:
        try:
            chunk = _audio_q.get(timeout=0.1)
        except queue.Empty:
            continue

        rec_chunks.append(chunk)
        rms = _rms(chunk)
        total_ms  += CHUNK_MS

        if rms < RMS_THRESHOLD:
            silence_ms += CHUNK_MS
            if silence_ms >= REC_SILENCE_S * 1000:
                _log(f"⏹  {REC_SILENCE_S}s שקט — עוצר הקלטה")
                break
        else:
            silence_ms = 0.0

    _recording_now.clear()

    if not rec_chunks:
        _log("⚠️  לא נקלט אודיו")
        _set_state("listening")
        return

    duration_s = len(rec_chunks) * CHUNK_MS / 1000
    _set_state("processing")
    _log(f"📼 הקלטה הסתיימה ({duration_s:.1f}s) — שולח לשרת…")

    # כתוב WAV לקובץ זמני
    audio_bytes = b"".join(rec_chunks)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        with wave.open(tmp, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)   # int16 = 2 bytes
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_bytes)

    try:
        # ── Pass 1: לפי _engine_mode ─────────────────────────────────────────
        _log(f"🔧 מנוע: {_engine_mode}")
        result: str | None = _transcribe_by_mode(tmp_path)

        if result:
            _last_transcribed = result
            _ui_broadcast({"t": "transcribed", "text": result})
            task_result = _match_task(result)

            # ── Pass 2: אם לא זוהתה משימה, תמלל שוב עם prompt פקודות ───────
            if not task_result:
                _set_state("processing")
                _log("🔄 Pass 2 — תמלול מרוכז בפקודות…")
                pass2 = _second_pass_transcribe(audio_bytes)
                if pass2 and pass2 != result:
                    _log(f"🔍 תמלול [2]: {pass2}")
                    task_result = _match_task(pass2)

            if task_result:
                _last_task = task_result
                _log(f"⚙️ משימה: {task_result}")
                _ui_broadcast({"t": "task", "text": task_result})
            else:
                _paste_text(result)
        else:
            _log("⚠️  לא זוהה טקסט")

    except Exception as e:
        _log(f"❌ שגיאה: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        _set_state("listening")


# ════════════════════════════════════════════════════════════════════════════
# הדבקה לחלון הממוקד
# ════════════════════════════════════════════════════════════════════════════

def _paste_text(text: str):
    """העתק ללוח → Ctrl+V לחלון הממוקד."""
    # הכן טקסט בטוח עבור PowerShell
    safe = text.replace("'", "\\'")
    subprocess.run(
        ["powershell", "-WindowStyle", "Hidden", "-Command",
         f"Set-Clipboard -Value '{safe}'"],
        capture_output=True,
        creationflags=0x08000000,  # CREATE_NO_WINDOW
    )
    # Ctrl+V
    VK_CONTROL, VK_V = 0x11, 0x56
    kbe = ctypes.windll.user32.keybd_event
    kbe(VK_CONTROL, 0, 0, 0)
    kbe(VK_V,       0, 0, 0)
    time.sleep(0.05)
    kbe(VK_V,       0, 2, 0)  # KEYEVENTF_KEYUP
    kbe(VK_CONTROL, 0, 2, 0)
    _log(f"📋 הודבק: {text[:60]}{'…' if len(text) > 60 else ''}")


# ════════════════════════════════════════════════════════════════════════════
# VAD worker — לב המערכת
# ════════════════════════════════════════════════════════════════════════════

def _vad_worker():
    """
    צורך את _audio_q ברציפות.
    כשנזהית אנרגיה → אוסף → מתמלל → בודק trigger → מפעיל הקלטה.
    """
    _log("👂 מאזין לפקודות קוליות…")
    if _wake_words:
        _log(f"   🔔 מצב Wake Word: {' | '.join(_wake_words)}")
        _log("   אמור wake word + פקודה במשפט אחד")
    else:
        _log(f"   מילות הפעלה: {', '.join(sorted(TRIGGER_WORDS))}")
    _log("─" * 60)

    buf:       list[bytes] = []
    in_speech  = False
    speech_ms  = 0.0
    silence_ms = 0.0

    while _running.is_set():
        # בזמן הקלטה מלאה — פשוט רוקן את התור (לא מנסים לזהות פקודות)
        if _recording_now.is_set():
            try:
                _audio_q.get(timeout=0.05)
            except queue.Empty:
                pass
            buf.clear()
            in_speech  = False
            speech_ms  = 0.0
            silence_ms = 0.0
            continue

        try:
            chunk = _audio_q.get(timeout=0.05)
        except queue.Empty:
            continue

        rms = _rms(chunk)

        if rms >= RMS_THRESHOLD:
            # ── דיבור ────────────────────────────────────────────────────
            in_speech   = True
            speech_ms  += CHUNK_MS
            silence_ms  = 0.0
            buf.append(chunk)

        elif in_speech:
            # ── שקט אחרי דיבור ───────────────────────────────────────────
            silence_ms += CHUNK_MS
            buf.append(chunk)   # שמור גם את השקט (edge smoothing)

            end_by_silence = silence_ms >= SILENCE_END_MS
            end_by_length  = speech_ms  >= MAX_SPEECH_S * 1000

            if end_by_silence or end_by_length:
                if speech_ms >= MIN_SPEECH_MS:
                    _process_utterance(b"".join(buf))
                buf.clear()
                in_speech  = False
                speech_ms  = 0.0
                silence_ms = 0.0

        else:
            # ── שקט מוחלט — שמור רק חלון קטן (pre-roll) ─────────────────
            buf.append(chunk)
            # הגבל pre-roll ל-~300ms (10 chunks)
            if len(buf) > 10:
                buf.pop(0)


def _process_utterance(audio_bytes: bytes):
    """קרא ל-Whisper ובדוק trigger. מופעל מ-_vad_worker."""
    global _last_heard
    try:
        text = _transcribe_command(audio_bytes)
    except Exception as e:
        _log(f"⚠️  שגיאת תמלול: {e}")
        return

    if not text:
        return

    _log(f"🎤 שמעתי: '{text}'")
    _last_heard = text
    _ui_broadcast({"t": "heard", "text": text})

    if _wake_words:
        # ── מצב Wake Word: מחכה למילת התעוררות + פקודה באותו משפט ───────────
        command_part = _extract_after_wake_word(text)
        if command_part is None:
            return  # wake word לא נמצא → התעלם
        _log(f"🔔 Wake word! פקודה: '{command_part or '(אין)'}'")
        _set_state("processing")
        if command_part:
            task_result = _match_task(command_part)
            if task_result:
                global _last_task
                _last_task = task_result
                _log(f"⚙️ משימה: {task_result}")
                _ui_broadcast({"t": "task", "text": task_result})
                _set_state("listening")
                return
        # wake word נמצא אבל אין פקודה מוכרת → התחל הקלטה מלאה
        _log("💼 מתחיל הקלטה מלאה…")
        threading.Thread(target=_do_full_recording, daemon=True, name="recorder").start()
    else:
        # ── מצב Trigger Words (קלאסי) ─────────────────────────────────────
        if _contains_trigger(text):
            _log("🚀 פקודה זוהתה! מפעיל הקלטה…")
            threading.Thread(target=_do_full_recording, daemon=True, name="recorder").start()


# ════════════════════════════════════════════════════════════════════════════
# UI / SSE helpers
# ════════════════════════════════════════════════════════════════════════════

def _ui_broadcast(event: dict):
    """שולח event לכל חיבורי SSE פתוחים."""
    data = json.dumps(event, ensure_ascii=False)
    msg  = f"data: {data}\n\n".encode("utf-8")
    with _ui_lock:
        dead = []
        for wf in _ui_clients:
            try:
                wf.write(msg)
                wf.flush()
            except Exception:
                dead.append(wf)
        for wf in dead:
            _ui_clients.remove(wf)


def _set_state(state: str):
    global _current_state
    _current_state = state
    _ui_broadcast({"t": "state", "state": state})


class _UIHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler — משרת את ממשק הניטור + SSE."""

    def log_message(self, *args): pass  # suppress Apache-style logs

    def do_GET(self):
        if self.path == "/events":
            self._sse()
        elif self.path in ("/", "/ui"):
            self._html()
        elif self.path == "/status":
            self._json_resp({
                "engine_mode": _engine_mode,
                "groq_key_set": bool(_groq_key),
                "wake_words": _wake_words,
                "state": _current_state,
            })
        else:
            self.send_error(404)

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type",  "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection",    "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        # שלח snapshot מיידי של המצב הנוכחי
        snap = json.dumps({
            "t":           "state",
            "state":       _current_state,
            "heard":       _last_heard,
            "transcribed": _last_transcribed,
            "task":        _last_task,
        }, ensure_ascii=False)
        try:
            self.wfile.write(f"data: {snap}\n\n".encode("utf-8"))
            self.wfile.flush()
        except Exception:
            return
        with _ui_lock:
            _ui_clients.append(self.wfile)
        try:
            while _running.is_set():
                time.sleep(10)
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with _ui_lock:
                try: _ui_clients.remove(self.wfile)
                except ValueError: pass

    def _html(self):
        try:
            body = open(_UI_HTML_PATH, "rb").read()
        except FileNotFoundError:
            body = b"<h1>ui.html not found next to voice_command_listener.py</h1>"
        self.send_response(200)
        self.send_header("Content-Type",   "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── Web Speech API endpoint ──────────────────────────────────────────

    def do_OPTIONS(self):
        """CORS preflight — allows browser POSTs from any origin."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/command":
            self._handle_ws_command()
        elif self.path == "/config":
            self._handle_config()
        else:
            self.send_error(404)

    def _handle_config(self):
        global _groq_key, _engine_mode
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_error(400)
            return
        VALID_MODES = {"groq_first", "groq_only", "local_first", "local_only", "parallel"}
        changed = []
        if "groq_key" in body:
            _groq_key = body["groq_key"].strip()
            changed.append(f"Groq key={'✓' if _groq_key else '✗'}")
        if "engine_mode" in body and body["engine_mode"] in VALID_MODES:
            _engine_mode = body["engine_mode"]
            changed.append(f"מנוע={_engine_mode}")
        if changed:
            _log(f"⚙️  הגדרות עודכנו: {', '.join(changed)}")
        self._json_resp({"ok": True, "engine_mode": _engine_mode, "groq_key_set": bool(_groq_key)})

    def _json_resp(self, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type",   "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _handle_ws_command(self):
        global _last_heard, _last_task
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_error(400)
            return

        text = body.get("text", "").strip()
        if not text:
            self._json_resp({"ok": False, "error": "empty"})
            return

        _last_heard = text
        _log(f"🌐 Web Speech: '{text}'")
        _ui_broadcast({"t": "heard", "text": text})

        if _wake_words:
            # ── מצב Wake Word: בדוק wake word ב-Web Speech אישור
            command_part = _extract_after_wake_word(text)
            if command_part is None:
                self._json_resp({"ok": True, "action": "none"})
                return
            _log(f"🔔 Web Speech wake word! פקודה: '{command_part or '(אין)'}'")
            if command_part:
                task = _match_task(command_part)
                if task:
                    _last_task = task
                    _log(f"⚙️ Web Speech משימה: {task}")
                    _ui_broadcast({"t": "task", "text": task})
                    self._json_resp({"ok": True, "action": "task", "result": task})
                    return
            if not _recording_now.is_set():
                _log("💼 Web Speech wake word → מתחיל הקלטה…")
                threading.Thread(
                    target=_do_full_recording, daemon=True, name="recorder-ws"
                ).start()
            self._json_resp({"ok": True, "action": "recording"})
            return
        else:
            # ── מצב Trigger Words: trigger word → הפעל הקלטת Whisper מלאה
            if _contains_trigger(text) and not _recording_now.is_set():
                _log("🚀 Web Speech → מפעיל הקלטה Whisper…")
                threading.Thread(
                    target=_do_full_recording, daemon=True, name="recorder-ws"
                ).start()
                self._json_resp({"ok": True, "action": "recording"})
                return

            # פקודה ישירה → הפעל מיד (ללא Whisper)
            task = _match_task(text)
            if task:
                _last_task = task
                _log(f"⚙️ Web Speech משימה: {task}")
                _ui_broadcast({"t": "task", "text": task})
                self._json_resp({"ok": True, "action": "task", "result": task})
                return

        self._json_resp({"ok": True, "action": "none"})


# ════════════════════════════════════════════════════════════════════════════
# Logging
# ════════════════════════════════════════════════════════════════════════════

def _log(msg: str):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)
    _ui_broadcast({"t": "log", "msg": msg, "ts": ts})


# ════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════

def _load_whisper(model: str, device: str):
    global _whisper
    from faster_whisper import WhisperModel

    _log(f"🔄 טוען Whisper '{model}' על {device}…")
    try:
        _whisper = WhisperModel(
            model,
            device=device,
            compute_type="float16" if device == "cuda" else "int8",
            num_workers=1,
            cpu_threads=4,
        )
        _log(f"✅ Whisper '{model}' נטען ({device})")
    except Exception as e:
        if device == "cuda":
            _log(f"⚠️  CUDA נכשל ({e}) — עובר ל-CPU")
            _whisper = WhisperModel(model, device="cpu", compute_type="int8")
            _log(f"✅ Whisper '{model}' נטען (cpu)")
        else:
            raise


def main():
    global RMS_THRESHOLD, WHISPER_SERVER, _groq_key, _engine_mode  # must be first before any reference

    parser = argparse.ArgumentParser(
        description="האזנה לפקודות קוליות עבריות — Silero VAD + faster-whisper"
    )
    parser.add_argument("--model",  default=DEFAULT_MODEL,
                        choices=["tiny", "base", "small", "medium", "large-v3"],
                        help="מודל Whisper לזיהוי פקודות (ברירת מחדל: tiny)")
    parser.add_argument("--device", default=DEFAULT_DEVICE,
                        choices=["cuda", "cpu"],
                        help="מכשיר חישוב (ברירת מחדל: cuda)")
    parser.add_argument("--threshold", type=int, default=RMS_THRESHOLD,
                        help="RMS threshold לזיהוי דיבור (ברירת מחדל: 200)")
    parser.add_argument("--port", type=int, default=3000,
                        help="פורט שרת Whisper (ברירת מחדל: 3000)")
    parser.add_argument("--ui-port", type=int, default=8765,
                        help="פורט ממשק ניטור (ברירת מחדל: 8765 | 0=כבוי)")
    parser.add_argument("--groq-key", default="",
                        help="Groq API key לתמלול cloud (console.groq.com) — או set GROQ_API_KEY")
    parser.add_argument("--wake-word", default="",
                        help="מילת התעוררות (לדוגמא: 'מערכת'). מסוגלות מופרדות בפסיק (,). אם ריק, ישתמש ב-trigger words")
    args = parser.parse_args()

    RMS_THRESHOLD  = args.threshold
    WHISPER_SERVER = f"http://localhost:{args.port}/transcribe"
    _groq_key      = args.groq_key or os.environ.get("GROQ_API_KEY", "")
    if args.wake_word:
        _wake_words.extend(w.strip() for w in args.wake_word.split(",") if w.strip())

    _log("═" * 60)
    _log("  Voice Command Listener — Hebrew Edition")
    _log("  Silero VAD + faster-whisper + Whisper Server")
    _log("═" * 60)

    # בדוק שרת
    try:
        r = requests.get(f"http://localhost:{args.port}/health", timeout=2)
        _log(f"✅ שרת Whisper פעיל (port {args.port})")
    except Exception:
        _log(f"⚠️  שרת Whisper לא זמין (port {args.port})")
        _log("   ודא שהשרת רץ לפני שאתה מפעיל הקלטה")

    if _groq_key:
        _log("🔑 Groq Whisper large-v3 — פעיל (Pass 1a | fallback לשרת מקומי)")
    else:
        _log("   טיפ: הוסף --groq-key KEY או set GROQ_API_KEY לתמלול מהיר+איכותי")
    if _wake_words:
        _log(f"🔔 Wake Word mode: {' | '.join(_wake_words)} + פקודה במשפט אחד")
    else:
        _log("   טיפ: הוסף --wake-word מערכת למצב 'מערכת תפתח יוטיוב'")

    # הפעל שרת UI
    if args.ui_port:
        _ui_srv = http.server.ThreadingHTTPServer(("", args.ui_port), _UIHandler)
        _ui_thr = threading.Thread(target=_ui_srv.serve_forever, daemon=True, name="ui-server")
        _ui_thr.start()
        _log(f"🌐 ממשק ניטור: http://localhost:{args.ui_port}/")

    # טען מודל
    _load_whisper(args.model, args.device)

    # הפעל worker
    worker = threading.Thread(target=_vad_worker, daemon=True, name="vad-worker")
    worker.start()

    # הפעל sounddevice
    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            blocksize=CHUNK_SAMPLES,
            callback=_audio_callback,
        ):
            _log(f"🎙  מיקרופון פעיל — {SAMPLE_RATE}Hz")
            _log("   Ctrl+C לעצירה")
            _log("─" * 60)
            _set_state("listening")
            while _running.is_set():
                time.sleep(0.3)

    except KeyboardInterrupt:
        _log("\n⏹  עוצר…")
        _running.clear()
    except sd.PortAudioError as e:
        _log(f"❌ שגיאת מיקרופון: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
