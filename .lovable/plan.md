## מטרה
לחזק את "מצב למידה ידני / היברידי" עם 3 שכבות שעובדות ביחד:
1. ציון ביטחון (confidence) לכל תיקון ממתין + סליידר לאישור אוטומטי מעל סף.
2. מנוע חוקים עבריים דטרמיניסטי (לא-AI) שמתקן/מסמן שגיאות נפוצות לפני שהן מגיעות לתור.
3. ניתוח AI אחרי-תמלול שמסביר את ההבדל בין ההיפותזה למקור ומציע מיפוי נכון של מילה→מילה.

---

## 1. ציון ביטחון לכל תיקון ממתין (`src/utils/correctionConfidence.ts` חדש)

נחשב לכל זוג `wrong→correct` ציון 0-100 לפי משקלים:

| גורם | משקל | חישוב |
|---|---|---|
| מרחק לוונשטיין מנורמל | 25 | `1 - dist/max(len)` |
| דמיון פונטי (Soundex עברי + ניקוד) | 20 | `phoneticSimilarity()` |
| מספר הופעות בקובץ | 15 | `min(n/4, 1)` |
| אורך מילה (מילים ארוכות = בטוח יותר) | 10 | `min(len/8, 1)` |
| תיקון לחוק עברי ידוע (סופיות וכו') | 15 | בינארי |
| הופעה ב-`customVocabulary` או `correctionLearning` קיים | 15 | בינארי |

הציון נשמר בעמודה `confidence` ב-`asr_pending_corrections` (מיגרציה) ובמטא של פריטים אופטימיסטיים.

### UI בתוך הכרטיס של "תיקונים ממתינים" (`AsrTraining.tsx`):
- **Badge ביטחון** צבעוני בכל פריט: ירוק 80%+, צהוב 50-79%, אדום <50%.
- **סליידר "אישור אוטומטי מסף"** (0-100, ברירת מחדל 80) שנשמר ב-`preferences`. כל פריט בתור עם `confidence >= threshold` מאושר אוטומטית מיידית.
- כפתור "אשר כל מה שמעל הסף" + תצוגת ספירה חיה.

---

## 2. מנוע חוקים עבריים (`src/utils/hebrewRuleEngine.ts` חדש)

אוסף חוקים דטרמיניסטיים שרצים על ההיפותזה לפני ה-diff. כל חוק מחזיר `{from, to, ruleId, confidence}`:

- **סופיות חובה**: `כ→ך / מ→ם / נ→ן / פ→ף / צ→ץ` בסוף מילה כשלא במצב טבעי הפוך.
- **אות סופית באמצע מילה**: `ך→כ / ם→מ / ן→נ / ף→פ / ץ→צ` כשלא בסוף.
- **ו"ו כפולה / חיריק חסר**: `וו` בתחילת מילה → `ו` (לפי הקשר).
- **א/ה בסוף**: שמות עצם נשיים שמסתיימים ב-`א` כשהמקור `ה` (טבלת חריגים).
- **כפילויות ניקוד/רווחים**: `  ` → ` `, ` .` → `.`, וכו'.
- **ה"א הידיעה דבוקה**: `ה בית` → `הבית` (אופציונלי, רק אם הקנוני מאשר).
- **גרשיים בראשי תיבות**: `ארהב` → `ארה״ב` כשמופיע במילון.

החוקים נטענים לתוך:
- ה-pre-pass לפני `extractCorrections()` — תיקוני "חוק עברי" מקבלים `confidence=95` ונכנסים אוטומטית גם במצב היברידי.
- חישוב ה-confidence (משקל 15 ב-#1).

מבוסס על דפוסים נפוצים מ-`ivrit-ai/whisper`, `dicta-il/nikud-base`, ו-`hspell` (נבדוק את החוקים שלהם ב-GitHub לפני קוד פרודקשן).

---

## 3. השוואת AI אחרי-תמלול (`src/utils/aiAlignmentReview.ts` חדש)

אחרי שהריצה הסתיימה ויש `refText` + `hyp`, כפתור חדש **"נתח עם AI"** בכרטיס התוצאות:

- שולח ל-Lovable AI Gateway (`google/gemini-2.5-flash`) פרומפט שמקבל:
  - הטקסט הקנוני
  - ההיפותזה
  - רשימת ה-diff candidates שלנו
- מבקש מבנה JSON:
  ```json
  { "alignments": [
      { "hyp": "...", "ref": "...", "reason": "...", "ruleType": "phonetic|context|homophone|...", "confidence": 0.0-1.0 }
  ]}
  ```
- כל alignment עם `confidence >= 0.7` מועלה כהצעה חדשה לתור הממתינים, עם תווית `engine: 'ai-review'` ו-`reason` מוצג בטולטיפ. הציון מ-AI נשקלל לתוך ה-confidence של #1 (משקל נוסף +10 אם AI מאשר).

מגן: rate-limit (1 בקשה לקובץ), cache לפי `fingerprint(refText + hyp)`.

---

## פרטים טכניים

### מיגרציית DB
```sql
ALTER TABLE public.asr_pending_corrections
  ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS rule_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_reason TEXT;
```

### העדפה חדשה
ב-`useCloudPreferences`: `auto_approve_threshold: number` (ברירת מחדל 80).

### קבצים שנוצרים
- `src/utils/correctionConfidence.ts`
- `src/utils/hebrewRuleEngine.ts`
- `src/utils/aiAlignmentReview.ts`
- `supabase/functions/ai-alignment-review/index.ts` (edge function עם CORS תקני)
- מיגרציה חדשה ל-`asr_pending_corrections`.

### קבצים שעורכים
- `src/pages/AsrTraining.tsx` — אינטגרציה: pre-pass חוקים → חישוב confidence → סליידר + badge → כפתור "נתח עם AI".
- `src/lib/asrLocalSessions.ts` — שמירת confidence בסשנים מקומיים.

### מקורות שנבדקים (לפני כתיבת חוקים)
- `github.com/ivrit-ai/whisper` — דפוסי טעויות נפוצים בעברית.
- `github.com/Dicta-Israel-Center-for-Text-Analysis` — חוקי נורמליזציה.
- `github.com/elyase/hebrew-tokenizer` ו-`hspell` — חוקי סופיות.

---

## זרימה סופית למשתמש (מצב היברידי, סף 80)
1. תמלול מסתיים.
2. מנוע החוקים מתקן אוטומטית סופיות → 12 תיקונים נכנסים מיד (confidence 95).
3. שאר ה-diff עובר חישוב confidence:
   - 8 פריטים מעל 80 → אושרו אוטומטית.
   - 5 פריטים 50-79 → בתור עם badge צהוב.
   - 3 פריטים <50 → בתור עם badge אדום.
4. המשתמש לוחץ "נתח עם AI" → 4 פריטים נוספים מוצעים עם הסבר.
5. המשתמש מזיז סליידר ל-70 → 3 נוספים מאושרים אוטומטית.

האם לאשר תכנון זה ולעבור לבנייה?
