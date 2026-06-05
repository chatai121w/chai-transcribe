
## מה נבנה

### 1. מנוע חיתוך מדורג חדש — `src/lib/tieredCutEngine.ts`
הבעיה הקיימת: `audioCutEngine` מפענח את כל הקובץ ל-`AudioBuffer` בזיכרון (76MB דחוס ≈ 800MB RAM) → קורס בשקט במובייל. אין fallback ואין הודעת שגיאה ברורה.

הפתרון — ניסיון אוטומטי במדרג, מהיר → איכותי:

**Tier 1 — Byte-slice מהיר (ל-WAV/PCM בלבד)**
פיענוח כותרת WAV → חיתוך לפי offset בייטים → File חדש. ללא decode כלל. ~50ms לקובץ 76MB.

**Tier 2 — ffmpeg.wasm stream-copy**
שימוש ב-`ffmpegConverter.ts` הקיים עם `-ss/-to -c copy` (ללא re-encode). עובד על mp3/m4a/webm/wav. ~2-5s לקובץ 76MB. מטפל ב-cut count/time/manual.

**Tier 3 — AudioBuffer המקורי (נשאר fallback אחרון)**
המנוע הקיים, רק לקבצים קטנים או כשהשניים הקודמים נכשלו.

הלוגיקה: try Tier 1 → catch → Tier 2 → catch → Tier 3 → catch → toast שגיאה עם הסבר.
לכל שלב toast התקדמות ("מנסה חיתוך מהיר…", "נופל לחזרה ל-ffmpeg…").

### 2. רכיב `QuickCutDialog.tsx` משותף
דיאלוג קטן: בחירת קובץ + 3 כפתורי חיתוך מהיר (`לחצי`, `3 חלקים`, `כל 5 דק'`) + "מותאם אישית" שפותח את `AdvancedCutPanel`.
מציג רשימת מקטעים שנוצרו + שני כפתורים:
- **תמלל הכל** — מוסיף את כל המקטעים ל-`transcription_jobs` (תור הרקע הקיים)
- **הורד הכל** — zip להורדה

### 3. שילוב בשני מקומות
- **AppSidebar**: פריט תפריט חדש "✂️ חיתוך מהיר" שפותח את הדיאלוג
- **Index**: כפתור צף/חלק מסרגל הפעולות שפותח את אותו דיאלוג

### 4. חיבור לתור התמלול
אחרי חיתוך, "תמלל הכל" קורא ל-hook הקיים `useTranscriptionJobs` (או `useBackgroundTask`) ומעלה כל File ל-`audio-files` bucket + יוצר רשומה ב-`transcription_jobs`. רשימת התמלולים מתעדכנת בזמן אמת.

## שינויי קוד

| קובץ | פעולה |
|---|---|
| `src/lib/tieredCutEngine.ts` | חדש — מנוע מדורג + WAV slicer |
| `src/components/QuickCutDialog.tsx` | חדש — UI דיאלוג |
| `src/components/AppSidebar.tsx` | להוסיף פריט "חיתוך מהיר" |
| `src/pages/Index.tsx` | להוסיף כפתור פתיחה |
| `src/components/AdvancedCutPanel.tsx` | להפנות את `submitCutJob` למנוע המדורג + להוסיף "תמלל הכל" |

## מה לא נוגעים
- `audioCutEngine.ts` נשאר כ-Tier 3 fallback
- מערכת התמלול הקיימת — רק קוראים לתור
- שום שינוי schema

מוכן לבנות?
