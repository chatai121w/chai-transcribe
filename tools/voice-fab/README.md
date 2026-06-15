# 🎤 Voice Input FAB — כפתור תמלול עברית

כפתור מיקרופון צף לתמלול קולי בזמן אמת, מבוסס **Whisper** (דרך שרת מקומי).

---

## קבצים בתיקייה זו

| קובץ | תיאור |
|------|-------|
| `VoiceInputFAB.tsx` | רכיב React עצמאי (TypeScript + Tailwind) |
| `voice-button-standalone.html` | גרסת HTML טהורה — פתח בדפדפן, עובד מיידית |
| `README.md` | מסמך זה |

---

## דרישות

### שרת Whisper מקומי
השרת חייב לרוץ על `http://localhost:3000` (ניתן לשנות בקוד).

להפעלה:
```bash
.venv\Scripts\python.exe server/transcribe_server.py
```

נקודת קצה:
```
POST /transcribe
  file     = קובץ אודיו (webm / ogg / mp4)
  language = "he"
  beam_size = 3
  normalize = 1

תגובה: { "text": "הטקסט המתומלל" }
```

---

## שימוש ב-React (`VoiceInputFAB.tsx`)

### התקנת תלויות
```bash
npm install lucide-react
# אם אין Tailwind — הוסף class אחד ל-className, ראה הערות בקובץ
```

### שילוב בפרויקט
```tsx
// App.tsx / Layout.tsx
import { VoiceInputFAB } from "./VoiceInputFAB";

function App() {
  return (
    <>
      <RouterOutlet />
      <VoiceInputFAB whisperPort={3000} language="he" />
    </>
  );
}
```

### Props

| Prop | סוג | ברירת מחדל | תיאור |
|------|-----|-----------|-------|
| `whisperPort` | `number` | `3000` | פורט שרת Whisper |
| `language` | `string` | `"he"` | קוד שפה לתמלול |
| `onTranscribed` | `(text: string) => void` | — | callback לאחר תמלול |
| `position` | `"bottom-left" \| "bottom-right"` | `"bottom-left"` | מיקום הכפתור |

### דוגמה עם callback
```tsx
<VoiceInputFAB
  whisperPort={3000}
  language="he"
  position="bottom-right"
  onTranscribed={(text) => {
    console.log("תומלל:", text);
    setMyText(prev => prev + " " + text);
  }}
/>
```

---

## גרסת HTML טהורה (`voice-button-standalone.html`)

פתח את הקובץ בדפדפן — **אין צורך ב-npm, build, או framework**.

- ✅ עובד בכל דפדפן מודרני (Chrome / Edge / Firefox)
- ✅ מד עוצמה קולית חי
- ✅ מדביק לשדה הממוקד אוטומטית
- ✅ Fallback לתיבת טקסט מובנית

לשינוי הגדרות, ערוך את קטע ה-`<script>` בראש הקובץ:
```js
const WHISPER_PORT = 3000;   // פורט שרת
const LANGUAGE     = "he";   // שפה
const BEAM_SIZE    = 3;      // דיוק תמלול (1-5)
```

---

## איך עובד

```
לחיצה על כפתור
      │
      ▼
navigator.mediaDevices.getUserMedia()  ← בקשת הרשאת מיקרופון
      │
      ▼
MediaRecorder.start()                  ← הקלטה כ-WebM/Opus
      │
AnalyserNode ──► מד עוצמה חי (20 עמודות)
      │
לחיצה שנייה
      │
      ▼
MediaRecorder.stop() → Blob
      │
      ▼
POST http://localhost:3000/transcribe  ← שליחה ל-Whisper
      │
      ▼
{ text: "הטקסט..." }
      │
      ▼
document.activeElement (input/textarea) → הדבקה
navigator.clipboard.writeText()        → גם ללוח
```

---

## התאמות נפוצות

### שינוי צבעי הכפתור (React)
בקובץ `VoiceInputFAB.tsx`, חפש את ה-`className` של `#fab-btn` ושנה את הגרדיאנט:
```tsx
// בסיס — כחול
"bg-gradient-to-br from-blue-500 to-blue-700"

// הקלטה — אדום
"bg-gradient-to-br from-red-500 to-red-700"
```

### הוספת קיצור מקלדת
```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === "H") handleClick();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [handleClick]);
```

### שיפור דיוק תמלול
בקובץ השרת (`server/transcribe_server.py`), נסה:
```python
beam_size = 5        # יותר דיוק, יותר זמן
best_of   = 5
vad_filter = True    # סינון שקט
```

---

## ראה גם

- `tools/voice-hotkey/` — גרסת Python עם קיצור מקלדת גלובלי (ללא דפדפן)
- `server/transcribe_server.py` — שרת Flask + Whisper
- `server/voice_hotkey.py` — סקריפט עצמאי עם ממשק גרפי
