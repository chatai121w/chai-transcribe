
# מערכת Jobs מרכזית + צינור YouTube מלא + Resume

המטרה: כל פעולה (YouTube, המרה, חיתוך, תמלול) רצה דרך אותה מערכת Jobs אחת, עם תתי-שלבים, פס התקדמות כולל + פס לכל שלב, שמירת קובצי-ביניים בענן, ויכולת "המשך מהמקום שנתקעת".

## ארכיטקטורה כללית

```text
                ┌──────────────────────────────────┐
                │   JobOrchestrator (client)        │
                │   - יוצר job + stages ב-DB        │
                │   - מריץ pipeline שלב-אחר-שלב     │
                │   - מעלה artifacts ל-Storage      │
                │   - מעדכן progress (Realtime)     │
                └──────────────┬───────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   youtube_jobs           pipeline-artifacts     Realtime UI
   (stages JSONB)         (Storage bucket)       <JobsCenter />
```

## מבנה נתונים — `youtube_jobs` (הרחבה)

עמודות חדשות:
- `job_kind` text — `youtube` | `convert` | `cut` | `transcribe`
- `stages` jsonb — מערך:
  ```json
  [{
    "key": "probe", "label": "בדיקת קישור",
    "status": "pending|running|done|failed|skipped",
    "percent": 0, "weight": 5,
    "started_at": null, "finished_at": null,
    "error": null,
    "artifact_path": null   // נתיב ב-pipeline-artifacts אם רלוונטי
  }]
  ```
- `current_stage` text
- `overall_percent` int (מחושב לפי weights)
- `resume_token` jsonb — מה צריך כדי להמשיך
- `last_error` text

## שלבים סטנדרטיים לפי job_kind

- **youtube**: `probe` → `download` → `extract_audio` → `upload_audio` → `transcribe`
- **convert** (video→mp3): `probe` → `convert` → `upload`
- **cut**: `probe` → `cut` → `upload`
- **transcribe**: `prepare` → `chunk` → `transcribe` → `merge`

כל שלב שהצליח שומר `artifact_path` בענן. המשך = דילוג על שלבים `done` ושימוש ב-artifact הקיים.

## פאזה 1 — תשתית + YouTube מלא

### 1.1 DB + Storage
מיגרציה אחת:
- `ALTER TABLE youtube_jobs ADD COLUMN job_kind text DEFAULT 'youtube', stages jsonb DEFAULT '[]', current_stage text, overall_percent int DEFAULT 0, resume_token jsonb, last_error text;`
- Storage bucket `pipeline-artifacts` (פרטי) — מבנה: `{user_id}/{job_id}/{stage_key}/{filename}`
- RLS על `storage.objects` לפי `auth.uid()::text = (storage.foldername(name))[1]`
- אינדקס על `(user_id, status, created_at desc)`

### 1.2 ליבת Orchestrator
קבצים חדשים:
- `src/lib/jobs/types.ts` — `JobStage`, `JobKind`, `JobRecord`
- `src/lib/jobs/jobOrchestrator.ts` — `createJob()`, `runJob()`, `resumeJob()`, `cancelJob()`, `updateStage()`
- `src/lib/jobs/artifactStorage.ts` — `uploadArtifact()`, `downloadArtifact()`, `getSignedUrl()`
- `src/lib/jobs/pipelines/youtubePipeline.ts` — מימוש 5 השלבים
- `src/hooks/useJobs.ts` — Realtime subscribe + רשימת jobs של המשתמש
- `src/hooks/useJob.ts` — subscribe ל-job בודד

### 1.3 מנוע הורדת YouTube (2 אסטרטגיות)
- **A) Local yt-dlp** דרך `localhost:3000/yt/*` (קיים בתוכנית) — מועדף כשהשרת חי
- **B) Cobalt Self-Host** דרך משתנה סביבה `COBALT_SELFHOST_URL` ב-edge function — נוסף ל-`youtube-cobalt` הקיים כ-fallback ראשון לפני ה-public instances
- מחיקת ה-public instances הלא-זמינים מהקוד; השארתם רק כ-best-effort אחרון

עריכת `supabase/functions/youtube-cobalt/index.ts`:
- קריאת `Deno.env.get('COBALT_SELFHOST_URL')` ושימוש בה ראשונה
- timeout קצר יותר (8s) ל-public כדי למנוע 502 ארוך

### 1.4 UI — מרכז ה-Jobs
קבצים חדשים:
- `src/components/jobs/JobsCenter.tsx` — דרואר/פאנל floating גלובלי (כמו `CompletedFilesPanel`), רשימת כל ה-jobs
- `src/components/jobs/JobCard.tsx` — כרטיס יחיד עם:
  - שורה עליונה: שם, סטטוס, פס התקדמות כולל (`overall_percent`)
  - מתחת: מחולק לשלבים (`JobStagesProgress`) — לכל שלב פס משלו עם אחוז
  - פעולות לפי סטטוס: בטל / המשך / נסה שוב / פתח תוצאה / הורד artifact
- `src/components/jobs/JobStagesProgress.tsx` — סטפר אופקי + פס per-stage
- כפתור FAB גלובלי `JobsCenterTrigger` ב-`App.tsx` (badge עם מספר רצים)

### 1.5 עמוד YouTube
עדכון `src/pages/YouTube.tsx`:
- שימוש ב-`useJobs` במקום מנהל הורדות נפרד
- כפתור "הורד+תמלל" יוצר job דרך Orchestrator
- הצגת JobCard בעמוד עצמו של ה-job הפעיל
- אם תקוע: כפתור "המשך מהשלב שנפל" → `resumeJob(id)`

## פאזה 2 — העברת תמלול ל-Jobs

- עטיפת `useTranscriptionJobs` הקיים בתוך `transcribePipeline` עם שלבים: `prepare` (chunking) → `transcribe` (per-chunk progress) → `merge`
- כל chunk שהצליח → נשמר כ-`partial_transcript.json` ב-`pipeline-artifacts`
- אם נופל באמצע: `resumeJob` מדלג על chunks שכבר תומללו
- עדכון `useTranscriptionJobs.ts` לקרוא ל-orchestrator במקום ניהול state נפרד (אדפטר תאימות לשמירה על קוד קיים)

## פאזה 3 — העברת המרה/חיתוך ל-Jobs

- `VideoToMp3.tsx`: כפתור "המרה" יוצר job מסוג `convert` במקום הזרימה הישנה. תוצאה עדיין נדחפת ל-`completedFilesBus` (תאימות) + נשמרת ב-bucket
- `QuickCutDialog.tsx`: זהה — job מסוג `cut`
- שמירה של `completedFilesBus` כשכבת תצוגה לקבצים מוכנים; `JobsCenter` מציג את התהליך עצמו

## חוויית "המשך"

לוגיקת `resumeJob(jobId)`:
1. טוען את `youtube_jobs.stages`
2. השלב הראשון שאינו `done` = `current_stage`
3. אם השלב הקודם הוא `done` ויש לו `artifact_path` → מוריד מהענן ומזין כקלט לשלב הבא
4. מריץ pipeline מהנקודה הזו והלאה
5. אם המשתמש סוגר טאב באמצע — בעלייה הבאה `useJobs` מציע "ראיתי שיש job שנקטע, להמשיך?"

## שינויים תמציתיים

| קובץ | פעולה |
|---|---|
| migration חדש | ALTER youtube_jobs + bucket + RLS |
| `youtube-cobalt/index.ts` | תמיכה ב-self-host env + timeout |
| `src/lib/jobs/*` | חדש — orchestrator, artifacts, pipelines |
| `src/hooks/useJobs.ts`, `useJob.ts` | חדש |
| `src/components/jobs/*` | חדש — UI |
| `src/App.tsx` | הוספת `<JobsCenterTrigger />` גלובלי |
| `src/pages/YouTube.tsx` | מעבר ל-orchestrator |
| `useTranscriptionJobs.ts` | adapter ל-orchestrator (פאזה 2) |
| `VideoToMp3.tsx`, `QuickCutDialog.tsx` | מעבר ל-jobs (פאזה 3) |

## פתיחת הביצוע

מתחיל מפאזה 1 (תשתית מלאה + YouTube). פאזה 2 ו-3 בהמשך באותו loop אם נשאר זמן, אחרת בהודעות נפרדות.

## הערה על Cobalt Self-Host

אם תרצה שירוץ אצלך — אספק הוראות פריסה ל-Railway בסיום פאזה 1, ותגדיר את `COBALT_SELFHOST_URL` ב-Secrets. עד אז המערכת תיפול ל-`localhost:3000` כשהוא חי.
