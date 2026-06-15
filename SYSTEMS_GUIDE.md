# 🎙 Smart Hebrew Transcriber — מדריך מערכות מלא

> **תאריך עדכון אחרון:** אפריל 2026  
> **Python venv:** `.venv\Scripts\python.exe`  
> **GPU:** RTX 5050 Laptop (8GB VRAM, CUDA)

---

## תוכן עניינים

1. [🖥 Launcher Tray — מרכז שליטה](#1--launcher-tray--מרכז-שליטה)
2. [🤖 Whisper Server — שרת תמלול CUDA](#2--whisper-server--שרת-תמלול-cuda)
3. [🎹 Voice Hotkey — קלט קולי גלובלי](#3--voice-hotkey--קלט-קולי-גלובלי)
4. [🔔 Voice Command Listener — האזנה ברקע](#4--voice-command-listener--האזנה-ברקע)
5. [🌐 Vite Frontend — ממשק משתמש](#5--vite-frontend--ממשק-משתמש)
6. [🚀 Launcher Service — API הפעלה](#6--launcher-service--api-הפעלה)
7. [📊 שרת ניטור Voice Command (SSE)](#7--שרת-ניטור-voice-command-sse)

---

## 1. 🖥 Launcher Tray — מרכז שליטה

**קובץ:** `server/launcher_tray.py`  
**הפעלה:** `.venv\Scripts\python.exe server\launcher_tray.py`  
**פורט API:** `8764`

### מה זה עושה

אייקון במגש המערכת (System Tray, ליד השעון) שמאפשר לשלוט בכל השירותים ממקום אחד, ללא צורך לפתוח טרמינל.

### אייקון צבעוני

| צבע | משמעות |
|-----|---------|
| 🟢 ירוק | רוב השירותים פעילים |
| 🟡 צהוב | חלק מהשירותים פעילים |
| 🔴 אדום | כולם כבויים |

**6 נקודות קטנות** בתחתית האייקון = סטטוס כל שירות (ירוק=פועל, אדום=כבוי):

```
[CUDA] [Ollama] [Vite] [Cloudflare] [VoiceHotkey] [VoiceCmd]
```

### תפריט קליק-ימין

```
Start All / Stop All
─────────────────────────────
── Transcription ──
  ✓ CUDA server (:3000)
    Ollama (:11434)
─────────────────────────────
── Voice ──
  ✓ 🎙 Voice Hotkey (Ctrl+Shift+H)
    🔔 Voice Command (wake: ביג)
─────────────────────────────
── Frontend ──
    Vite Dev (:8080)
    ☁ Cloudflare Tunnel
─────────────────────────────
  Open localhost
  Open Lovable
  Copy Tunnel URL
─────────────────────────────
  Auto-start with Windows
─────────────────────────────
  Exit
```

### Auto-start עם Windows

לחץ ✓ על **"Auto-start with Windows"** בתפריט → יוצר קיצור דרך בתיקיית Startup של Windows. המערכת תעלה אוטומטית עם כניסה למחשב.

### Flask API פנימי (port 8764)

| Endpoint | Method | תיאור |
|----------|--------|--------|
| `/health` | GET | סטטוס כל השירותים |
| `/status` | GET | מידע מפורט על כל תהליך |
| `/start` | POST | `{"target": "all"/"whisper"/"vite"/"cloudflare"}` |
| `/stop` | POST | `{"target": "all"/"whisper"/"vite"/"cloudflare"}` |
| `/tunnel` | GET | URL של Cloudflare Tunnel הנוכחי |

### דרישות

```bash
pip install pystray Pillow flask flask-cors
```

---

## 2. 🤖 Whisper Server — שרת תמלול CUDA

**קובץ:** `server/transcribe_server.py`  
**הפעלה:** `.venv\Scripts\python.exe server\transcribe_server.py`  
**פורט:** `3000`

### מה זה עושה

שרת Flask שמריץ את מודל Whisper על GPU בזמן אמת. כל שאר המערכות שולחות אליו קובץ WAV ומקבלות טקסט בחזרה.

### הזרימה

```
קובץ WAV/MP3/כלשהו
       ↓
  SHA-256 hash
       ↓
  בכמה הcache?  ──Yes──→  תוצאה מיידית (cache hit)
       ↓ No
  faster-whisper (GPU)
  מודל: ivrit-ai/whisper-large-v3-turbo-ct2
       ↓
  שמירה בcache (24h, עד 100 רשומות)
       ↓
  JSON עם טקסט + timestamps
```

### פרמטרים עיקריים

| פרמטר | ברירת מחדל | תיאור |
|-------|-----------|--------|
| `--port` | `3000` | פורט ה-API |
| `--model` | `ivrit-ai/whisper-large-v3-turbo-ct2` | מודל Whisper |
| `--device` | `cuda` | GPU / CPU |
| `--language` | `he` | שפה (עברית) |

### API Endpoints

| Endpoint | Method | תיאור |
|----------|--------|--------|
| `/transcribe` | POST | מקבל קובץ אודיו, מחזיר JSON עם טקסט |
| `/health` | GET | `{"status":"ok","model_ready":true,"gpu":...}` |
| `/shutdown` | POST | כיבוי מסודר |

#### דוגמת בקשה

```bash
curl -X POST http://localhost:3000/transcribe \
  -F "audio=@recording.wav" \
  -F "language=he" \
  -F "beam_size=3"
```

#### דוגמת תגובה

```json
{
  "text": "שלום, זו הקלטה לדוגמה",
  "segments": [...],
  "language": "he",
  "cached": false,
  "processing_time_ms": 1250
}
```

### Cache SHA-256

- **TTL:** 24 שעות
- **גודל מקסימלי:** 100 רשומות (FIFO)
- **מפתח:** SHA-256 של ה-bytes הגולמיים של הקובץ
- **אפקט:** אותה הקלטה = תוצאה מיידית בפעם השנייה

### מה המודל

`ivrit-ai/whisper-large-v3-turbo-ct2` — גרסת CTranslate2 של Whisper Large v3 Turbo, מותאמת במיוחד לעברית על ידי צוות ivrit-ai. הכי מדויק לעברית מבין המודלים החינמיים.

---

## 3. 🎹 Voice Hotkey — קלט קולי גלובלי

**קובץ:** `server/voice_hotkey.py`  
**קובץ נוסף:** `tools/voice-hotkey/voice_hotkey.py`  
**הפעלה:** `.venv\Scripts\python.exe server\voice_hotkey.py`  
**קיצור ברירת מחדל:** `Ctrl+Shift+H`

### מה זה עושה

**הכלי הכי שימושי במערכת.** עובד מכל מקום ב-Windows — Word, Chrome, Notepad, כל אפליקציה. לוחץ קיצור → מדבר → הטקסט מודבק ישירות.

### הזרימה הטכנית

```
1. RegisterHotKey (Windows API) — רושם Ctrl+Shift+H גלובלית
2. לחיצה ראשונה:
   ├── GetForegroundWindow() → שומר את החלון הנוכחי
   ├── פותח tkinter overlay קטן עם מד עוצמה
   └── sounddevice.InputStream @ 16kHz mono — מתחיל להקליט

3. לחיצה שנייה (או סגירת overlay):
   ├── עוצר הקלטה
   └── שולח לworker thread

4. Worker thread:
   ├── מקודד PCM Int16 → WAV 16-bit
   ├── POST http://localhost:3000/transcribe
   │     language=he, beam_size=3, normalize=1
   └── בהצלחה:
       ├── SetForegroundWindow() → חוזר לחלון המקורי
       ├── SetClipboardData(טקסט)
       └── keybd_event(VK_CONTROL) + keybd_event('V') → Ctrl+V
```

### למה זה עובד כל כך טוב

- **16kHz ישירות מ-OS** — ללא codec, ללא דחיסה, אין אובדן איכות
- **push-to-talk** — אין VAD שמחכה, מקליט בדיוק מה שאתה רוצה
- **Large Whisper model** — המודל הכי מדויק לעברית
- **Paste אוטומטי** — חוזר לחלון המקורי ומדביק

### ממשק המשתמש (tkinter)

```
┌─────────────────────────────┐
│  🎙 מקליט... Ctrl+Shift+H   │
│  ████████░░░░░░░░  -18 dB   │
└─────────────────────────────┘
```

מד עוצמה בזמן אמת. חלון לא-modal (לא גונב focus).

### שינוי קיצור דרך

```bash
# דוגמאות
.venv\Scripts\python.exe server\voice_hotkey.py --hotkey ctrl+shift+t
.venv\Scripts\python.exe server\voice_hotkey.py --hotkey ctrl+alt+space
.venv\Scripts\python.exe server\voice_hotkey.py --hotkey f9
```

### הפעלה אוטומטית עם Windows

```
tools\voice-hotkey\install-startup.bat
```

מעתיק VBS script לתיקיית Startup — מפעיל בלי חלון שחור בעלייה.

---

## 4. 🔔 Voice Command Listener — האזנה ברקע

**קובץ:** `tools/voice-command/voice_command_listener.py`  
**הפעלה:** `.venv\Scripts\python.exe tools\voice-command\voice_command_listener.py --wake-word ביג --model tiny --device cuda`  
**ניטור:** `http://localhost:8765/`

### מה זה עושה

מאזין ברקע **כל הזמן** ומחכה למילת ההפעלה ("ביג"). ברגע שמזוהה — עובר למצב הקלטה ושולח ל-Large Whisper לתמלול באיכות גבוהה.

### ארכיטקטורה — 3 שכבות

```
שמע גולמי (sounddevice, 16kHz) 
         ↓
┌─────────────────────────────────┐
│ שכבה 1: RMS Energy Threshold    │  (CPU, ≈0ms)
│ RMS < 200 → דלג                 │  מחסל שקט מוחלט
└────────────────┬────────────────┘
                 ↓ יש אנרגיה
┌─────────────────────────────────┐
│ שכבה 2: Whisper Tiny (GPU)      │  (~200ms)
│ מתמלל utterance קצר             │  זיהוי מילות trigger
└────────────────┬────────────────┘
                 ↓ יש טקסט
┌─────────────────────────────────┐
│ שכבה 3: Wake Word Detection     │  (CPU, ≈1ms)
│ fuzzy match ≥ 68%               │  מכסה transcription לא מדויק
└────────────────┬────────────────┘
                 ↓ "ביג" זוהה!
         מצב הקלטה מלאה
         ↓ שקט 3 שניות / עצור
    POST http://localhost:3000/transcribe
         ↓
    Ctrl+V → הדבקה בחלון הנוכחי
```

### פרמטרים בשורת הפקודה

| פרמטר | ברירת מחדל | תיאור |
|-------|-----------|--------|
| `--wake-word` | (ללא) | מילת ההפעלה, למשל: `ביג` |
| `--model` | `tiny` | מודל לזיהוי wake word |
| `--device` | `cuda` | GPU/CPU |
| `--groq-key` | (ללא) | Groq API לתמלול מהיר בענן |
| `--rms-threshold` | `200` | רגישות מיקרופון |

### מילות trigger מובנות

בנוסף ל-wake word, המערכת מגיבה גם ל:
```
תמלל | הקלט | התחל | כתוב | רשום
transcribe | record | start
```

### פקודות מערכת קוליות

מלבד תמלול, אפשר לתת פקודות:

| מה לומר | מה קורה |
|---------|---------|
| `"פתח notepad"` | פותח פנקס רשימות |
| `"פתח chrome"` | פותח דפדפן |
| `"כבה מחשב"` | shutdown בעוד 10 שניות |
| `"הפעל מחדש"` | restart בעוד 10 שניות |
| `"נעל מסך"` | נועל עמדת עבודה |
| `"כמה זה 2 כפול 8?"` | מחשבון קולי |

### ממשק ניטור (SSE)

נכנסים ל-`http://localhost:8765/` — רואים בזמן אמת:
- מה המיקרופון שומע
- מה הtiny model מתמלל
- האם wake word זוהה
- תוצאת תמלול אחרונה

### הגדרות VAD

```python
RMS_THRESHOLD  = 200    # רגישות — הורד ל-100 לסביבה שקטה
SILENCE_END_MS = 700    # ms שקט → utterance הסתיים  
MIN_SPEECH_MS  = 250    # מינימום דיבור לפני עיבוד
MAX_SPEECH_S   = 5      # מקסימום לזיהוי wake word
REC_SILENCE_S  = 3.0    # שקט → עצור הקלטה מלאה
REC_MAX_S      = 45.0   # מקסימום שניות הקלטה
```

---

## 5. 🌐 Vite Frontend — ממשק משתמש

**תיקייה:** `src/`  
**הפעלה:** `npx vite --port 8081`  
**URL:** `http://localhost:8081`  
**Stack:** React + TypeScript + Tailwind CSS + shadcn/ui

### עמודים עיקריים

| עמוד | נתיב | תיאור |
|------|------|--------|
| Dashboard | `/` | מסך ראשי — רשימת קבצים + סטטוס |
| Text Editor | `/editor` | עורך טקסט מתמלול עם sync לאודיו |
| Meeting Recorder | `/meeting` | הקלטת ישיבות עם דיאריזציה |
| Voice Studio | `/studio` | עריכת אודיו + ויזואליזציה |
| Audio Clean Lab | `/audio-clean` | שיפור איכות אודיו לפני תמלול |
| Diarization | `/diarization` | הפרדת דוברים |
| Video to MP3 | `/video-to-mp3` | חילוץ אודיו מוידאו |
| Voice Command Admin | `/voice-admin` | ניהול מנוע Voice Command |
| Settings | `/settings` | הגדרות מערכת |
| Login | `/login` | כניסה (Supabase Auth) |

### רכיבים מרכזיים

| רכיב | קובץ | תיאור |
|------|------|--------|
| VoiceInputFAB | `VoiceInputFAB.tsx` | כפתור מיקרופון צף (push-to-talk) |
| TranscriptionEngine | `TranscriptionEngine.tsx` | ניהול בקשות תמלול |
| LiveTranscriber | `LiveTranscriber.tsx` | תמלול בזמן אמת |
| AudioRecorder | `AudioRecorder.tsx` | הקלטת אודיו |
| SyncMirrorLayout | `SyncMirrorLayout.tsx` | תצוגת טקסט+אודיו מסונכרנת |
| AppSidebar | `AppSidebar.tsx` | ניווט צד |

### כפתור ה-FAB (Floating Action Button)

נמצא בכל עמוד, בפינה ימין-תחתון:

```
⚪ idle       → גבול זהב-אדמדם
🔴 recording  → גבול אדום + animation pulse
⚪ processing → גבול כתום + cursor not-allowed
```

- `onMouseDown` → שומר focus, מתחיל הקלטה
- `onMouseUp / onMouseLeave` → עוצר הקלטה, שולח לשרת

### Hooks עיקריים

| Hook | קובץ | תיאור |
|------|------|--------|
| `useToast` | `hooks/use-toast.ts` | התראות (auto-dismiss 4s) |
| `useWhisperServer` | `hooks/use-whisper-server.ts` | תקשורת עם port 3000 |
| `useAudioRecorder` | `hooks/use-audio-recorder.ts` | Web Audio API |

---

## 6. 🚀 Launcher Service — API הפעלה

**קובץ:** `server/launcher_service.py`  
**הפעלה:** `.venv\Scripts\python.exe server\launcher_service.py`  
**פורט:** `8764`

### מה זה עושה

גרסה קלילה יותר של Launcher Tray — רק API ללא GUI. מאפשר לאתר Lovable (HTTPS) להפעיל את שרת Whisper המקומי (localhost) בלחיצת כפתור.

### Private Network Access (PNA)

Chrome חוסם בקשות מ-HTTPS ללcalhost. הקובץ מוסיף header מיוחד:
```
Access-Control-Allow-Private-Network: true
```

### ההבדל מ-launcher_tray.py

| | launcher_tray.py | launcher_service.py |
|--|--|--|
| GUI | ✅ System Tray | ❌ ללא |
| API | ✅ Flask :8764 | ✅ Flask :8764 |
| Voice services | ✅ | ❌ |
| משאבים | ~20MB RAM | ~10MB RAM |
| שימוש | Development | Production/Auto |

---

## 7. 📊 שרת ניטור Voice Command (SSE)

**קובץ:** חלק מ-`tools/voice-command/voice_command_listener.py`  
**URL:** `http://localhost:8765/`  
**פרוטוקול:** SSE (Server-Sent Events)

### מה זה מציג

דף HTML פנימי שמציג בזמן אמת:

```
┌─────────────────────────────────────────────┐
│  🎙 Voice Command Monitor                    │
│─────────────────────────────────────────────│
│  State:   🔴 idle                            │
│  Heard:   "ביג כתוב לי הערה"                │
│  Last:    "כתוב לי הערה"                    │
│  Task:    paste ✓                            │
│                                             │
│  Engine:  local_only | Model: tiny (cuda)   │
└─────────────────────────────────────────────┘
```

---

## 📋 סיכום פורטים

| שירות | פורט | Protocol |
|-------|------|----------|
| Whisper Server | `3000` | HTTP REST |
| Voice Cmd Monitor | `8765` | HTTP + SSE |
| Launcher API | `8764` | HTTP REST |
| Vite Frontend | `8081` | HTTP |
| Ollama | `11434` | HTTP REST |

---

## ⚡ הפעלה מהירה (כל המערכת)

```bash
# 1. הפעל את כל השירותים דרך ה-Tray (מומלץ)
.venv\Scripts\python.exe server\launcher_tray.py

# ─── או ידנית ───

# 2. Whisper Server (CUDA)
.venv\Scripts\python.exe server\transcribe_server.py

# 3. Voice Hotkey (Ctrl+Shift+H מכל מקום)
.venv\Scripts\python.exe server\voice_hotkey.py

# 4. Voice Command (wake word: "ביג")
.venv\Scripts\python.exe tools\voice-command\voice_command_listener.py --wake-word ביג --model tiny --device cuda

# 5. Frontend
npx vite --port 8081
```

---

## 🔧 פתרון בעיות נפוצות

| בעיה | סיבה | פתרון |
|------|------|--------|
| שרת לא עולה | מודל עדיין נטען | המתן 30-60 שניות, בדוק `/health` |
| תמלול לא מדויק | beam_size נמוך | שנה ל-`beam_size=5` |
| Python שגוי | מריץ System Python | תמיד `.venv\Scripts\python.exe` |
| Ctrl+Shift+H לא עובד | קיצור תפוס | שנה עם `--hotkey ctrl+shift+t` |
| Toast לא נסגר | TOAST_REMOVE_DELAY=1000000 | תוקן — 4000ms |
| Voice Hotkey לא מדביק | Focus אבד | הקובץ שומר `GetForegroundWindow` לפני הקלטה |
