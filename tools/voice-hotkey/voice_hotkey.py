"""
voice_hotkey.py — קלט קולי גלובלי לעברית
==========================================
לוחץ Ctrl+Shift+H מכל מקום ב-Windows →
אוברליי קטן עם מד עוצמה → מקליט → Whisper מתמלל →
מדביק אוטומטית חזרה לשדה הממוקד.

הפעלה ישירה:
    python voice_hotkey.py
    python voice_hotkey.py --hotkey ctrl+shift+t --port 3000 --lang he

דרישות:
    pip install sounddevice numpy requests
    (tkinter מגיע עם Python ב-Windows)

שרת Whisper חייב לרוץ על הפורט המצוין (ברירת מחדל 3000).
"""

import argparse
import ctypes
import ctypes.wintypes
import io
import os
import queue
import sys
import threading
import time
import tkinter as tk
import wave

# ── Resolve project root & venv automatically ─────────────────────────────────
# This file lives in:  <project>/tools/voice-hotkey/voice_hotkey.py
# OR (when run from server/):  <project>/server/voice_hotkey.py
_HERE    = os.path.dirname(os.path.abspath(__file__))
_PROJECT = os.path.dirname(os.path.dirname(_HERE))   # 2 levels up

def _ensure_deps():
    """Add project venv site-packages to sys.path if needed."""
    for cand in [
        os.path.join(_PROJECT, '.venv', 'Lib', 'site-packages'),
        os.path.join(os.path.dirname(_HERE), '.venv', 'Lib', 'site-packages'),
    ]:
        if os.path.isdir(cand) and cand not in sys.path:
            sys.path.insert(0, cand)

_ensure_deps()

import numpy as np
import requests
import sounddevice as sd

# ── Windows API constants ────────────────────────────────────────────────────
user32 = ctypes.windll.user32
WM_HOTKEY        = 0x0312
GWL_EXSTYLE      = -20
WS_EX_NOACTIVATE = 0x08000000
WS_EX_TOOLWINDOW = 0x00000080
KEYEVENTF_KEYUP  = 0x0002

MOD_NOREPEAT = 0x4000
MOD_ALT   = 0x0001
MOD_CTRL  = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN   = 0x0008

VK_MAP = {c: ord(c.upper()) for c in 'abcdefghijklmnopqrstuvwxyz0123456789'}
VK_MAP.update({
    'f1':0x70,'f2':0x71,'f3':0x72,'f4':0x73,'f5':0x74,'f6':0x75,
    'f7':0x76,'f8':0x77,'f9':0x78,'f10':0x79,'f11':0x7A,'f12':0x7B,
    'space':0x20,'tab':0x09,'enter':0x0D,
})

# ── Args ─────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description='Hebrew voice input global hotkey')
parser.add_argument('--hotkey', default='ctrl+shift+h', help='קיצור מקשים (ברירת מחדל: ctrl+shift+h)')
parser.add_argument('--port',   default=3000, type=int,  help='פורט שרת Whisper (ברירת מחדל: 3000)')
parser.add_argument('--lang',   default='he',            help='שפה (ברירת מחדל: he)')
parser.add_argument('--beam',   default=3, type=int,     help='beam size (ברירת מחדל: 3)')
args = parser.parse_args()

WHISPER_URL = f'http://localhost:{args.port}/transcribe'
SAMPLERATE  = 16000
CHANNELS    = 1
HOTKEY_ID   = 1
METER_W     = 300

# ── Parse hotkey ──────────────────────────────────────────────────────────────
def parse_hotkey(hk: str):
    mods, vk = 0, 0
    for part in hk.lower().split('+'):
        part = part.strip()
        if   part == 'ctrl':  mods |= MOD_CTRL
        elif part == 'shift': mods |= MOD_SHIFT
        elif part == 'alt':   mods |= MOD_ALT
        elif part == 'win':   mods |= MOD_WIN
        elif part in VK_MAP:  vk = VK_MAP[part]
    return mods | MOD_NOREPEAT, vk

hotkey_mods, hotkey_vk = parse_hotkey(args.hotkey)
if not hotkey_vk:
    print(f'[ERROR] לא ניתן לפרש: {args.hotkey}')
    sys.exit(1)

# ── Shared state ──────────────────────────────────────────────────────────────
_recording    = threading.Event()
_audio_frames: list = []
_stream       = None
_prev_hwnd    = None

_overlay_win  = None
_status_lbl   = None
_level_canvas = None
_level_bar    = None
_dot_lbl      = None

_ui_queue: queue.Queue = queue.Queue()

# ── Audio callback ────────────────────────────────────────────────────────────
def _audio_cb(indata, frames, time_info, status):
    if _recording.is_set():
        _audio_frames.append(indata.copy())
        rms   = float(np.sqrt(np.mean(indata ** 2)))
        level = min(rms * 10.0, 1.0)
        _ui_queue.put(('LEVEL', level))

# ── WAV encoding ──────────────────────────────────────────────────────────────
def frames_to_wav(frames: list) -> bytes:
    buf = io.BytesIO()
    data = np.concatenate(frames, axis=0)
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLERATE)
        wf.writeframes((data * 32767).astype(np.int16).tobytes())
    return buf.getvalue()

# ── Whisper ───────────────────────────────────────────────────────────────────
def transcribe_wav(wav_bytes: bytes) -> str:
    try:
        r = requests.post(
            WHISPER_URL,
            files={'file': ('voice.wav', wav_bytes, 'audio/wav')},
            data={'language': args.lang, 'beam_size': str(args.beam), 'normalize': '1'},
            timeout=60,
        )
        r.raise_for_status()
        return (r.json().get('text') or '').strip()
    except requests.exceptions.ConnectionError:
        return '__CONN__'
    except Exception as e:
        return f'__ERR__{e}'

# ── Paste ─────────────────────────────────────────────────────────────────────
def paste_text(text: str, hwnd: int):
    import subprocess
    escaped = text.replace('"', '`"')
    subprocess.run(
        ['powershell', '-NoProfile', '-Command', f'Set-Clipboard -Value "{escaped}"'],
        capture_output=True
    )
    time.sleep(0.05)
    if hwnd and user32.IsWindow(hwnd):
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.15)
    VK_V, VK_CTRL = 0x56, 0x11
    user32.keybd_event(VK_CTRL, 0, 0, 0)
    user32.keybd_event(VK_V,    0, 0, 0)
    user32.keybd_event(VK_V,    0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(VK_CTRL, 0, KEYEVENTF_KEYUP, 0)

# ── Transcription worker ──────────────────────────────────────────────────────
def _worker_transcribe(frames: list, hwnd: int):
    _ui_queue.put(('STATUS', '⏳ מתמלל…', '#58a6ff'))
    wav  = frames_to_wav(frames)
    text = transcribe_wav(wav)

    if text == '__CONN__':
        _ui_queue.put(('STATUS', f'❌ שרת לא פעיל (port {args.port})', '#f85149'))
        time.sleep(2); _ui_queue.put(('CLOSE',)); return

    if text.startswith('__ERR__'):
        _ui_queue.put(('STATUS', f'❌ שגיאה: {text[7:45]}', '#f85149'))
        time.sleep(2); _ui_queue.put(('CLOSE',)); return

    if not text:
        _ui_queue.put(('STATUS', '⚠️ לא זוהה טקסט', '#e3b341'))
        time.sleep(1.5); _ui_queue.put(('CLOSE',)); return

    short = text[:55] + ('…' if len(text) > 55 else '')
    _ui_queue.put(('STATUS', f'✅ {short}', '#3fb950'))
    print(f'[OK] "{text}"')
    time.sleep(0.5)
    _ui_queue.put(('CLOSE',))
    paste_text(text, hwnd)

# ── Recording control ─────────────────────────────────────────────────────────
def _cmd_start():
    global _prev_hwnd, _audio_frames
    _prev_hwnd    = user32.GetForegroundWindow()
    _audio_frames = []
    _ui_queue.put(('SHOW',))

def _cmd_stop():
    global _stream
    _recording.clear()
    if _stream:
        _stream.stop(); _stream.close(); _stream = None
    frames = list(_audio_frames)
    hwnd   = _prev_hwnd
    if len(frames) < 3:
        _ui_queue.put(('STATUS', '⚠️ הקלטה קצרה מדי', '#e3b341'))
        time.sleep(1); _ui_queue.put(('CLOSE',)); return
    threading.Thread(target=_worker_transcribe, args=(frames, hwnd), daemon=True).start()

def on_hotkey():
    if _recording.is_set():
        threading.Thread(target=_cmd_stop, daemon=True).start()
    else:
        _cmd_start()

# ── Windows hotkey listener ───────────────────────────────────────────────────
def hotkey_listener():
    if not user32.RegisterHotKey(None, HOTKEY_ID, hotkey_mods, hotkey_vk):
        print(f'[ERROR] לא ניתן לרשום "{args.hotkey}" — אולי כבר בשימוש?')
        sys.exit(1)
    print(f'[OK] קיצור "{args.hotkey.upper()}" רשום — מוכן\n')
    msg = ctypes.wintypes.MSG()
    while True:
        ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
        if ret <= 0:
            break
        if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
            on_hotkey()

# ── Overlay ───────────────────────────────────────────────────────────────────
def _create_overlay():
    global _overlay_win, _status_lbl, _level_canvas, _level_bar, _dot_lbl

    win = tk.Toplevel()
    win.title('')
    win.overrideredirect(True)
    win.attributes('-topmost', True)
    win.attributes('-alpha', 0.95)
    win.configure(bg='#0d1117')

    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    w, h   = METER_W + 68, 92
    win.geometry(f'{w}x{h}+{(sw - w)//2}+{sh - h - 54}')

    style = user32.GetWindowLongW(win.winfo_id(), GWL_EXSTYLE)
    user32.SetWindowLongW(win.winfo_id(), GWL_EXSTYLE,
                          style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW)

    top = tk.Frame(win, bg='#0d1117')
    top.pack(fill='x', padx=14, pady=(10, 3))

    _dot_lbl = tk.Label(top, text='⏺', font=('Segoe UI', 17),
                         fg='#f85149', bg='#0d1117')
    _dot_lbl.pack(side='left')

    _status_lbl = tk.Label(top, text='מקליט… לחץ שוב לעצירה',
                            font=('Segoe UI', 11, 'bold'),
                            fg='#f85149', bg='#0d1117', anchor='w')
    _status_lbl.pack(side='left', padx=(8, 0), fill='x', expand=True)

    tk.Label(top, text=args.hotkey.upper(),
             font=('Consolas', 8), fg='#3d444d', bg='#0d1117').pack(side='right')

    meter_bg = tk.Frame(win, bg='#161b22')
    meter_bg.pack(fill='x', padx=14, pady=(2, 10))

    _level_canvas = tk.Canvas(meter_bg, width=METER_W, height=16,
                               bg='#161b22', highlightthickness=0)
    _level_canvas.pack(pady=5)
    _level_canvas.create_rectangle(0, 4, METER_W, 12, fill='#21262d', outline='')
    _level_bar = _level_canvas.create_rectangle(0, 4, 0, 12, fill='#3fb950', outline='')
    for pct in (0.25, 0.5, 0.75):
        x = int(METER_W * pct)
        _level_canvas.create_line(x, 4, x, 12, fill='#30363d', width=1)

    win.bind('<Escape>', lambda _: _ui_queue.put(('CANCEL',)))
    _overlay_win = win

def _close_overlay():
    global _overlay_win, _status_lbl, _level_canvas, _level_bar, _dot_lbl
    if _overlay_win:
        try: _overlay_win.destroy()
        except Exception: pass
    _overlay_win = _status_lbl = _level_canvas = _level_bar = _dot_lbl = None

# ── Main-thread poll ──────────────────────────────────────────────────────────
def _poll(root: tk.Tk):
    global _stream
    try:
        while True:
            cmd = _ui_queue.get_nowait()
            if cmd[0] == 'SHOW':
                _create_overlay()
                _recording.set()
                _stream = sd.InputStream(
                    samplerate=SAMPLERATE, channels=CHANNELS,
                    dtype='float32', callback=_audio_cb, blocksize=512,
                )
                _stream.start()
                print('[REC] מקליט…')

            elif cmd[0] == 'STATUS':
                _, text, color = cmd
                if _status_lbl:   _status_lbl.configure(text=text, fg=color)
                if _dot_lbl:      _dot_lbl.configure(fg=color)
                if _level_canvas and _level_bar:
                    _level_canvas.coords(_level_bar, 0, 4, 0, 12)

            elif cmd[0] == 'LEVEL':
                if _level_canvas and _level_bar:
                    w = int(cmd[1] * METER_W)
                    color = '#3fb950' if cmd[1] < 0.40 else \
                            '#e3b341' if cmd[1] < 0.75 else '#f85149'
                    _level_canvas.itemconfig(_level_bar, fill=color)
                    _level_canvas.coords(_level_bar, 0, 4, w, 12)

            elif cmd[0] == 'CLOSE':
                _close_overlay()

            elif cmd[0] == 'CANCEL':
                _recording.clear()
                if _stream:
                    _stream.stop(); _stream.close(); _stream = None
                _close_overlay()

    except queue.Empty:
        pass
    root.after(30, lambda: _poll(root))

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('━' * 54)
    print('  🎙️  קלט קולי עברית — Whisper')
    print(f'  קיצור:  {args.hotkey.upper()}')
    print(f'  שרת:    localhost:{args.port}  |  שפה: {args.lang}')
    print('  לחץ קיצור → דבר → לחץ שוב לעצירה → מודבק אוטומטית')
    print('  Escape לביטול  |  Ctrl+C לסגירה')
    print('━' * 54)

    try:
        r = requests.get(f'http://localhost:{args.port}/health', timeout=2)
        print('  ✅ שרת Whisper פעיל\n' if r.ok else '  ⚠️  שרת מגיב עם שגיאה\n')
    except Exception:
        print(f'  ⚠️  שרת Whisper לא נמצא על port {args.port}\n')

    threading.Thread(target=hotkey_listener, daemon=True).start()

    root = tk.Tk()
    root.withdraw()
    root.after(30, lambda: _poll(root))
    root.mainloop()
