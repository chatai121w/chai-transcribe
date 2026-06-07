
# מודול תמלול מיוטיוב + מנהל הורדות

## ארכיטקטורה

```text
                    ┌─ Flask מקומי (מועדף) ─────────┐
                    │  yt-dlp + ffmpeg + GPU          │
   קישור YouTube ──▶│  - /yt/info                     │
                    │  - /yt/download (audio/video)   │
                    │  - /yt/extract                  │
                    │  - /yt/captions                 │
                    │  - /yt/attach-subs              │
                    └───────────────┬────────────────┘
                                    │ (fallback אם לא חי)
                    ┌───────────────▼────────────────┐
                    │ Edge Function: yt-cobalt        │
                    │ → api.cobalt.tools (פתוח)       │
                    │ מוגבל ל-audio/video בלבד        │
                    └─────────────────────────────────┘
```

## חוקי ברירת מחדל (לפי הבקשה)

1. ברירת מחדל = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio"` — m4a נתמך ב-Groq ישירות, אפס המרה.
2. `ffprobe` לבדוק codec → מיפוי aac→m4a, opus→webm, mp3→mp3.
3. המרה רק אם המשתמש מבקש WAV/MP3 במפורש, או אם הפורמט לא ב-Groq whitelist.
4. אם הסרטון מכיל כתוביות עברית מובנות → להציע "השתמש בהן במקום לתמלל".
5. חיבור כתוביות = `-c copy -c:s mov_text` (בלי קידוד). צריבה = אופציה מתקדמת בלבד עם אזהרה.

## שלבי בנייה

### שלב 1 — Backend (Flask)
ב-`server/transcribe_server.py` להוסיף endpoints:
- `POST /yt/info` → `yt-dlp --dump-json` → כותרת, אורך, thumbnail, פורמטים זמינים, רשימת subtitles, גודל משוער.
- `POST /yt/download` → מקבל `mode: audio|video|both` + `audio_format`. מחזיר job_id, מתחיל ברקע. SSE/polling להתקדמות.
- `POST /yt/captions` → מוריד subtitles קיימים (`--write-sub --sub-lang he,iw,en --skip-download`).
- `POST /yt/extract` → `ffprobe` + `-c:a copy` לפי codec.
- `POST /yt/attach-subs` ו-`POST /yt/burn-subs`.
- `GET /yt/status/<job_id>` ו-`GET /yt/file/<job_id>/<filename>` להורדה.
תיקיית עבודה: `temp/yt/<job_id>/`. ניקוי אוטומטי אחרי 24 שעות.

### שלב 2 — Cloud fallback
Edge Function חדש `youtube-cobalt`:
- מקבל URL + mode.
- קורא ל-`https://api.cobalt.tools/api/json` (instance ציבורי, ללא מפתח).
- מחזיר stream URL זמני. הלקוח מוריד ישירות.
- מוגבל לסרטונים < 2 שעות (מגבלת Cobalt).

### שלב 3 — Database (מנהל הורדות)
מיגרציה חדשה: טבלה `youtube_jobs`:
```
id, user_id, url, video_title, thumbnail_url, duration_sec,
mode (audio/video/transcribe/full), status, progress_pct,
backend (local/cobalt), 
output_files jsonb [{kind, url, size}],
transcript_id (FK ל-transcripts), created_at, completed_at, error
```
RLS: רק owner. GRANT לפי הסטנדרט שלך.
Storage bucket `youtube-outputs` (פרטי, 500MB limit) לקבצים שמסונכרנים לענן.

### שלב 4 — Frontend
**עמוד חדש** `src/pages/YouTube.tsx` (route `/youtube`):
- Hero: input URL גדול + "בדוק קישור".
- כרטיס פרטי סרטון: thumbnail, כותרת, אורך, תגיות פורמטים זמינים.
- אם יש subs עבריות: באנר "🎯 קיימות כתוביות עברית מובנות — לחסוך תמלול?" [השתמש בהן | תמלל מחדש].
- בחירת פעולות (checkboxes משולבות לפריסטים):
  - 🎙️ "תמלל בלבד" (ברירת מחדל) — audio bestaudio + TXT/SRT/JSON
  - 📥 "הורד אודיו"
  - 🎬 "הורד וידאו"
  - 📝 "תמלל + חבר כתוביות לווידאו"
  - ⚙️ "מותאם אישית" — מציג את כל ה-checkboxes
- פס התקדמות לפי שלבים (5-6 שלבים מסומנים, hebrew).
- אזור תוצאות: כל קובץ עם איקון, גודל, כפתור הורדה.
- אזהרה משפטית בתחתית.

**מנהל הורדות** `src/components/YouTubeDownloadManager.tsx`:
- טבלה/רשימה של כל ה-jobs של המשתמש.
- סינון לפי סטטוס, חיפוש לפי כותרת.
- פעולות: הורד מחדש, מחק, פתח תמלול ב-editor.
- Realtime subscription ל-progress.
- מוטמע כ-tab בעמוד `/youtube`.

**כניסה מ-/transcribe**: כפתור "📺 מ-YouTube" בכרטיס המקור (ליד "העלאת קובץ"). פותח dialog מהיר עם URL בלבד → אם נבחר "תמלל" → הולך לזרימה הרגילה של תמלול עם הקובץ.

### שלב 5 — Hook מרכזי
`src/hooks/useYoutubeJobs.ts`:
- `probeUrl(url)` → מנסה מקומי, נופל ל-Cobalt.
- `startJob(url, options)` → יוצר רשומה ב-DB, מפעיל backend.
- `subscribeToJob(jobId)` → Realtime updates.
- `cancelJob(jobId)`.
- `useYoutubeJobs()` → רשימת כל ה-jobs.

### שלב 6 — אינטגרציה לתמלול
כשמשתמש בוחר "תמלל": אחרי הורדת אודיו, להזרים לאותו pipeline של `useTranscriptionJobs` (Groq Whisper large-v3 בעברית). תוצאה נשמרת כ-transcript רגיל + מקושרת ל-you