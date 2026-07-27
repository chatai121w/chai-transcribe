# 🎓 מערכת הלמידה והשיפור — מדריך מלא ומסודר

> מסמך זה מסכם את כל מערכות הלמידה במוצר: **LoRA Fine-Tuning** של מודל ה-Whisper על ה-GPU המקומי, ולצידו מערכות הלמידה ה"רכות" (מילון מותאם, תיקונים נלמדים, השוואות ומגמות). הכל במקום אחד, מסודר, עם זרימות, טכנולוגיות והוראות הפעלה.

תאריך עדכון: 21/06/2026

---

## 1. תמונה כללית — איך לומדים בשלוש שכבות

המערכת לומדת ומשתפרת בשלוש שכבות בלתי-תלויות שאפשר לשלב יחד:

| # | שכבה | מה לומדים? | היכן רץ? | זמן השפעה |
|---|---|---|---|---|
| 1 | **Soft-learning** (מילון + תיקונים) | מילים חמות, תיקונים אוטומטיים, prompt התחלתי | בדפדפן + Cloud | מיידי, בכל הרצה הבאה |
| 2 | **Comparison & Trends** (מדידה) | האם השינוי באמת שיפר? WER/CER לאורך זמן | Supabase (`comparison_runs`) | מיידי + השוואה היסטורית |
| 3 | **LoRA Fine-Tuning** (אימון אמיתי) | משקלות חדשים ל-Whisper על הדאטה שלך | שרת Flask מקומי + GPU | חד-פעמי לכל אימון (דקות–שעות), אחר-כך לכל הקלטה |

```
┌─────────────────────────────────────────────────────────────────┐
│                       זרימת השיפור הכוללת                        │
└─────────────────────────────────────────────────────────────────┘

   הקלטה → תמלול (Whisper / Groq / ivrit.ai)
              │
              ├── ① מילון חם + תיקונים נלמדים  (Soft, מיידי)
              │     ↓
              │   תמלול משופר
              │     ↓
              ├── ② נרשם ל-comparison_runs  (מדידה)
              │     ↓
              │   טאב "מגמות": WER/CER לאורך זמן + התראת רגרסיה
              │     ↓
              └── ③ הופך לדאטה לאימון LoRA  (Heavy)
                    ↓
                  מודל CT2 מאומן → מופעל כברירת מחדל
```

---

## 2. שכבה 1 — Soft-Learning (מיידי)

### 2.1 מילון מותאם (Custom Vocabulary / Hotwords)
- **קובץ**: `src/utils/customVocabulary.ts`, `src/hooks/useCustomVocabulary.ts`
- **איך פועל**: רשימת מילים/ביטויים שמוזרקת כ-`initial_prompt` ל-Whisper וכ-`prompt` ל-Groq. מטה את הסבירות לזיהוי המילים האלו.
- **איפה רואים**: Settings → מילון מותאם.

### 2.2 תיקונים נלמדים (Correction Learning)
- **קובץ**: `src/utils/correctionLearning.ts`, `src/hooks/useCorrectionLearning.ts`
- **איך פועל**: כל פעם שהמשתמש מתקן מילה בעורך — התיקון נשמר. בתמלולים הבאים מתבצעת החלפה אוטומטית (regex עם גבולות מילה).
- **סנכרון Cloud**: `useCloudPreferences` → טבלת preferences.

### 2.3 בדיקת איות AI
- **קובץ**: `src/utils/hebrewSpellCheck.ts`, `src/utils/syncedSpellAssist.ts`
- **מנוע**: Gemini דרך Lovable AI Gateway. מתקן רק טעויות כתיב מובהקות, שומר את ההצעות שהמשתמש קיבל/דחה.

---

## 3. שכבה 2 — Comparison & Trends (מדידה)

זו "מערכת ההצלחה" שכל הזמן עוקבת אם באמת יש שיפור.

### 3.1 טבלה מרכזית — `comparison_runs`
מאחדת את כל ההשוואות שהיו פעם מפוזרות ב-localStorage:

| עמודה | תיאור |
|---|---|
| `kind` | `audio_enhance` / `transcribe_settings` / `asr_ground_truth` / `diarization` |
| `recording_fingerprint` | hash של ההקלטה — מקבץ הרצות שונות על אותה הקלטה |
| `engine`, `model`, `config_snapshot` | מה רץ בפועל (כולל temperature, prompt וכו') |
| `hotwords_count`, `corrections_count` | כמה מילים/תיקונים פעילים היו |
| `wer`, `cer`, `term_recall`, `len_ratio` | המדדים האובייקטיביים |
| `reference_text`, `hypothesis_text` | טקסט אמת + תמלול |
| `user_verdict` | best / good / bad (סובייקטיבי) |
| `created_at`, `updated_at` | חתימת זמן מלאה |

**מקור**: `src/lib/comparisonRuns.ts` + הוק `src/hooks/useComparisonRuns.ts`.

### 3.2 רושמים אוטומטית מ-:
- `/benchmark` — סוויפ פרי-סטים של שיפור אודיו
- `/compare?tab=transcripts` — סוויפ הגדרות תמלול
- `/compare?tab=ground-truth` (AsrTraining) — WER מול טקסט-אמת
- `/compare?tab=diarization` — השוואת מנועי דיאריזציה

### 3.3 טאב "מגמות" (`/compare?tab=trends`)
- **קובץ**: `src/pages/compare/TrendsTab.tsx`
- מקבץ הרצות לפי `recording_fingerprint` (כרטיס לכל הקלטה).
- מציג: גרף קווי של WER/CER/term-recall, Δ pp מול ההרצה הקודמת, באדג' "best WER", פאנל "השווה" צד-ליד עם diff של ה-`config_snapshot`.
- **Realtime**: שינויים מופיעים מיד דרך Supabase Realtime.
- **Deep-link**: `?fp=...&a=runId&b=runId` פותח כרטיס + בוחר השוואה.

### 3.4 התראת רגרסיה אוטומטית
- **קובץ**: `src/components/RegressionWatcher.tsx` + `src/hooks/useNotifications.ts`
- מאזין ל-INSERT חדש ב-`comparison_runs`, משווה לקודם באותה הקלטה.
- סף: `THRESHOLD = 0.005` (0.5 נקודה אחוזית).
- 🟥 WER/CER עלו ביותר מהסף → notification `warning` + כפתור "פתח השוואה".
- 🟩 ירדו משמעותית → notification `success`.

---

## 4. שכבה 3 — LoRA Fine-Tuning (אימון אמיתי של Whisper)

זה הלב הכבד. כאן באמת משנים את המשקלות של המודל לדאטה שלך.

### 4.1 מה זה LoRA?
**Low-Rank Adaptation** — במקום לאמן את כל ~1.5 מיליארד המשקלות של `whisper-large-v3`, מאמנים רק "אדפטרים" קטנים (matrices בדרגה נמוכה) שמתחברים לשכבות Attention. תוצאה:
- 100×–1000× פחות פרמטרים לאימון.
- אפשר לאמן על GPU ביתי (RTX 3060 ומעלה).
- אפשר לשמור אדפטרים מרובים ולהחליף ביניהם.

### 4.2 הסטאק הטכני

| רכיב | טכנולוגיה | תפקיד |
|---|---|---|
| מודל בסיס | **ivrit-ai/whisper-large-v3** (HuggingFace) | המודל לפני האימון |
| Fine-tuning | **PEFT + LoRA** (HuggingFace) | אדפטרים בדרגה נמוכה |
| Training loop | **Transformers Trainer** | אופטימיזציה + לוגינג |
| המרת inference | **CTranslate2** (`ct2-transformers-converter`) | ממיר את המודל המאוחד ל-CT2 (×4 מהירות) |
| Runtime | **faster-whisper** | טוען את ה-CT2 בפועל |
| Audio loading | **librosa** | טעינה + resample ל-16kHz mono |
| Orchestration | **Flask** (`server/training_routes.py`) | API לניהול דאטה-סטים, ג'ובים, וסטטוס |
| UI | React + `useLoraTraining` | יצירת דאטה-סט, הפעלה, מעקב |
| Mirror לענן | טבלת `lora_training_jobs` ב-Supabase | היסטוריה בין מכשירים |

### 4.3 תרשים זרימה — מהקלטה ועד מודל מאומן

```
[1] איסוף זוגות (audio, text)
       │  ↓ העלאה דרך UI (/asr-training או /lora)
       │
[2] POST /training/dataset/new                     → יוצר תיקייה ds_<id>/
[3] POST /training/dataset/upload-pair  (×N)       → audio/00001.wav + texts/00001.txt
[4] POST /training/dataset/<id>/finalize           → כותב manifest.jsonl
       │
[5] POST /training/start { dataset_id, base_model, epochs, lr, lora_r, ... }
       │   ↓
       │   Flask מריץ subprocess:  python server/train_lora.py --dataset ... --merge-and-convert
       │   ↓
       │   טעינת המודל → הוספת LoRA adapters → Trainer.train()
       │   כל step מעדכן progress.json (status, progress%, train_loss, eval_loss, WER before/after)
       │
[6] GET /training/status/<job_id>  (UI מבקש כל 3 שניות)
[7] בסיום: --merge-and-convert מבצע merge_and_unload() ואז המרה ל-CT2 → ct2/
[8] POST /training/set-active-model { ct2_path }   → faster-whisper יטען מעכשיו את המודל המאומן
```

### 4.4 פורמט ה-manifest
```json
{"audio": "/abs/path/to/clip1.wav", "text": "תמלול האמת בעברית"}
{"audio": "/abs/path/to/clip2.wav", "text": "עוד משפט מתויג"}
```
- אורך מומלץ לקליפ: 5–30 שניות.
- כמות מינימלית מעשית: **~50 זוגות** לשיפור מורגש. **200–500** לתוצאות יציבות.

### 4.5 פרמטרים מומלצים (ברירות מחדל בקוד)
| פרמטר | ברירת מחדל | המלצה |
|---|---|---|
| `epochs` | 3 | 3–5 לדאטה-סט קטן, 1–2 לגדול |
| `batch_size` | 8 | תלוי GPU; הנמיכו ל-4 אם OOM |
| `lr` (learning rate) | 1e-4 | 5e-5 לעדינות, 2e-4 לאגרסיביות |
| `lora_r` | 32 | 16 מהיר, 64 איכות גבוהה |
| `lora_alpha` | 64 | בד"כ פי-2 מ-`lora_r` |
| `lora_dropout` | 0.05 | 0.0–0.1 |
| `merge_and_convert` | true | כן אם רוצים inference מהיר ב-faster-whisper |

### 4.6 מה רואים ב-UI בזמן אמת
דרך `useLoraTraining` (polling ל-`/training/status/<id>` כל 3 שניות + mirror ל-Supabase):
- סטטוס: `preparing → training → merging → converting → done`
- אחוז התקדמות + step/total_steps + epoch נוכחי
- `train_loss` / `eval_loss` חיים
- **`wer_before` ↔ `wer_after`** — המדד החשוב ביותר: כמה שיפרנו על ה-eval set
- `log_tail` — 40 שורות אחרונות
- כפתורי "בטל" / "הפעל מודל זה" / "החזר מודל בסיס"

### 4.7 הפעלת המודל המאומן
- `POST /training/set-active-model {"ct2_path": ".../jobs/<id>/ct2"}` כותב `active_model.json`.
- `transcribe_server.load_model()` קורא ל-`get_active_ct2_path()` ואם קיים — טוען אותו במקום הבסיס.
- ביטול: שליחת `ct2_path: null` → חזרה ל-`ivrit-ai/whisper-large-v3`.

### 4.8 מה ה-LoRA *לא* יכול לעשות
> ⚠️ הגבלה: מנועים מקומיים אופליין (CUDA/ONNX) מותרים רק בתמלול ישיר ולא בג'ובי רקע — ראו `mem://constraints/offline-engines`. האימון עצמו רץ כסאב-פרוצס Flask, לא בתור background job של Cloud.

---

## 5. איך מודדים שבאמת השתפרנו? (Closed Loop)

זה לב הבקשה שלך — לא לאמן "באוויר".

1. **לפני האימון** — מריצים תמלול על הקלטת אמת → רושמים run ב-`comparison_runs` (kind=`asr_ground_truth`, WER/CER נמדדים מול `reference_text`).
2. **מאמנים LoRA** על דאטה-סט נפרד.
3. **מפעילים את המודל החדש** (`set-active-model`).
4. **מריצים שוב על אותה הקלטת אמת** → run חדש עם **אותו `recording_fingerprint`**.
5. טאב "מגמות" → מציג Δ WER. `RegressionWatcher` מתריע אוטומטית אם חזרנו אחורה.

המפתח: `recording_fingerprint` (מ-`src/lib/recordingFingerprint.ts`) זהה — לכן ההשוואה אובייקטיבית על אותו אודיו בדיוק.

---

## 6. הפעלה — צ'ק-ליסט מעשי

### 6.1 דרישות מקדימות (חד-פעמי)
- GPU NVIDIA + CUDA 12 מותקן.
- שרת Flask מקומי רץ (`scripts/start-whisper-server.ps1`).
- חבילות Python: `transformers`, `peft`, `accelerate`, `bitsandbytes`, `librosa`, `ctranslate2`, `faster-whisper` (כולן ב-`server/requirements.txt`).

### 6.2 זרימת משתמש מקצה-לקצה
1. `/asr-training` → טוענים זוגות (אודיו + תמלול-אמת).
2. כפתור "סיים דאטה-סט" → `finalize` יוצר manifest.
3. `/lora` (או הטאב המתאים) → "אימון חדש", בוחרים דאטה-סט + פרמטרים.
4. עוקבים אחרי הפרוגרס. מסיימים → רואים `wer_before` vs `wer_after`.
5. "הפעל מודל זה" → המודל החדש פעיל.
6. רצים שוב על הקלטות הייחוס → טאב "מגמות" מראה את ה-Δ.
7. אם רגרסיה → קופצת notification עם קישור ישיר להשוואה.

---

## 7. סיכום הקבצים החשובים

### Frontend (React/TS)
- `src/lib/comparisonRuns.ts` — API להשוואות
- `src/lib/recordingFingerprint.ts` — hash יציב להקלטה
- `src/hooks/useComparisonRuns.ts` — הוק לשליפה
- `src/hooks/useLoraTraining.ts` — הוק לכל ניהול האימון
- `src/hooks/useNotifications.ts` — מערכת התראות
- `src/pages/ComparisonsHub.tsx` — הראב המאחד
- `src/pages/compare/TrendsTab.tsx` — מגמות + Δ + diff
- `src/pages/Benchmark.tsx` / `CompareReport.tsx` / `AsrTraining.tsx` — מקורות ה-runs
- `src/components/RegressionWatcher.tsx` — מאזין רגרסיות realtime

### Backend (Python/Flask)
- `server/train_lora.py` — סקריפט האימון (PEFT + LoRA + Trainer + CT2 merge)
- `server/training_routes.py` — REST endpoints (datasets / start / status / cancel / active-model)
- `server/transcribe_server.py` — מפעיל את המודל הפעיל (בסיס או מאומן)

### Database (Supabase)
- `comparison_runs` — כל ההרצות + מדדים (RLS + Realtime)
- `lora_training_jobs` — היסטוריית אימונים מסונכרנת
- `preferences` — מילון + תיקונים (סנכרון בין מכשירים)

---

## 8. TL;DR (שורה אחת לכל מערכת)

- 🧠 **LoRA Fine-Tuning** — אימון אמיתי של Whisper על דאטה שלך, ב-GPU המקומי, עם merge ל-CT2 לפעלה מהירה.
- 📊 **Comparison Runs + Trends** — כל הרצה נרשמת, מקובצת לפי הקלטה, ומציגה Δ WER/CER לאורך זמן.
- 🔔 **Regression Watcher** — מתריע אוטומטית אם השינוי האחרון פגע בדיוק.
- 📚 **Soft-learning** — מילון חם + תיקונים נלמדים + AI spell-check עובדים בכל הרצה גם בלי אימון כבד.

> כל שלוש השכבות עובדות יחד: ה-Soft מנצח מיידית, ה-Comparison אומר אם זה אמיתי, וה-LoRA הופך זאת לקבוע במשקלות המודל.
