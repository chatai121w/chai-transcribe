
## מה נבנה

מתחת לפאנל "עריכה עם AI" בעורך הטקסט תתווסף **תצוגת רשת של כל גרסאות ה-AI** שנעשו על התמלול הנוכחי. כל כרטיס יציג את התוצאה, הפרומפט שנשלח, המודל, הטוקנים והעלות, ויאפשר שמירה/מחיקה ושיוך לתיקיה — כולל יצירת תיקיה חדשה והעתקת האודיו המקורי לאותה תיקיה.

## מבנה הנתונים

### חיבור versions ↔ ai_usage_events
- מוסיפים עמודה `ai_usage_event_id uuid` ל-`transcript_versions` (FK ל-`ai_usage_events.id`).
- כל פעולת AI (`edit-transcript`, `loshon-kodesh-ai`, `summarize-transcript`, וה-RPC `edit_transcript_proxy`) שיוצרת גרסה חדשה — תשמור את `id` של ה-usage event ותכניס אותו ל-version.
- כך כל גרסה יודעת בדיוק איזה פרומפט / מודל / טוקנים / עלות הביאו לה.

### שיוך לתיקיה כקבוצה
- מוסיפים ל-`transcript_versions` עמודות אופציונליות:
  - `folder_id uuid` — תיקיה שאליה שויכה הגרסה
  - `audio_file_path text` — העתקה (shared reference) של האודיו של התמלול המקור
- כשמשייכים קבוצת גרסאות לתיקיה — מעדכנים את כולן ב-`folder_id` זהה, וה-`audio_file_path` מועתק מהתמלול המרכזי (אותו path ב-bucket `permanent-audio`, ללא שכפול בייטים).

## UI חדש

### `AIVersionsGrid.tsx` (חדש)
מתחת ל-`AIEditPanel` ב-`TextEditor.tsx`. רשת רספונסיבית של כרטיסים, אחד לכל גרסת AI של התמלול הפעיל:

```text
┌─ AIVersionCard ──────────────────────┐
│ [Gemini 2.5 Flash] [improve] 14:32   │
│ ─────────────────────────────────────│
│ tabs: [תוצאה] [פרומפט] [נתונים]      │
│  • תוצאה: preview של הטקסט (scroll) │
│  • פרומפט: system + user prompt     │
│  • נתונים: tokens · עלות · משך      │
│ ─────────────────────────────────────│
│ [💾 שמור בענן] [📥 שמור לוקלי]      │
│ [📁 שייך לתיקיה ▾] [👁 פתח] [🗑]    │
└──────────────────────────────────────┘
```

- **שמור בענן** — מסמן `_dirty=false` ודוחף ל-`transcript_versions` (אם זמני).
- **שמור לוקלי** — שומר ב-Dexie (`db.versions`) דרך `useCloudVersions`.
- **שייך לתיקיה** — תפריט שמשתמש ב-`useFolderTree` עם:
  - בחירה מתיקיה קיימת
  - "➕ צור תיקיה חדשה…" שמוסיף folder ומשייך אליו
  - checkbox "שייך גם את האודיו המקורי" (ברירת מחדל מסומן)
- **פתח** — מעלה את הגרסה לעורך הראשי (כפי שכבר עובד היום ב-version history).

### `AIVersionFolderDialog.tsx` (חדש)
מודאל לבחירה/יצירת תיקיה. תומך בבחירת **קבוצת גרסאות** (checkboxes על הכרטיסים) ושיוך מרובה בלחיצה אחת.

### בורר תצוגה
בראש הרשת: כפתורי סינון לפי מודל, פיצ'ר (improve/grammar/translate…), וחיפוש בפרומפט. ברירת מחדל: כל הגרסאות של ה-transcript הנוכחי, מהחדש לישן.

## שינויי קוד

| קובץ | שינוי |
|------|-------|
| `supabase/migrations/<new>.sql` | הוספת `ai_usage_event_id`, `folder_id`, `audio_file_path` ל-`transcript_versions` + index על `(transcript_id, created_at)` |
| `src/integrations/supabase/types.ts` | רענון טיפוסים |
| `src/lib/localDb.ts` | הוספת השדות החדשים ל-`LocalVersion` + version bump של Dexie |
| `supabase/functions/_shared/aiUsage.ts` | `logAIUsage` יחזיר את ה-`id` שנוצר |
| `supabase/functions/{edit-transcript,loshon-kodesh-ai,summarize-transcript}/index.ts` | להעביר את ה-`ai_usage_event_id` ל-version שנשמרת |
| `edit_transcript_proxy` (DB function) | אותו דבר ברמת ה-SQL |
| `src/hooks/useCloudVersions.ts` | תמיכה ב-`ai_usage_event_id`, `folder_id`, `audio_file_path` + פונקציות `assignVersionsToFolder`, `saveVersionToCloud`, `saveVersionToLocal` |
| `src/components/AIVersionsGrid.tsx` | **חדש** — הרשת עם הכרטיסים, טאבים וכפתורי פעולה |
| `src/components/AIVersionCard.tsx` | **חדש** — כרטיס יחיד |
| `src/components/AIVersionFolderDialog.tsx` | **חדש** — בחירת/יצירת תיקיה לקבוצה |
| `src/pages/TextEditor.tsx` | שילוב `<AIVersionsGrid transcriptId={…}/>` מתחת לפאנל ה-AI |

## נקודות חשובות

- **שמירת הקשר** — כל גרסת AI נטענת תמיד דרך `transcript_id` של התמלול המרכזי; אין דאטה מנותק.
- **תיקיה כקבוצה** — folder_id זהה לכל הגרסאות שנבחרו יחד, כך שב-`Folders.tsx` הן יוצגו תחת אותה תיקיה (אפשר להוסיף בעתיד תצוגת "קבוצה" גם שם, מחוץ לתחום הזה).
- **אודיו** — לא משכפלים בייטים, רק שומרים את אותו `audio_file_path` של ה-bucket `permanent-audio`. RLS הקיימת על הbucket מספיקה.
- **RTL** — כל הקומפוננטות עם `dir="rtl"` ו-utility classes קיימות.
- **עלות** — מציגים את `cost_usd_snapshot` הקיים מה-event, ואם null מחשבים דינמית מ-`aiPricing.ts`.

## מחוץ לתחום
- שינוי תצוגת התיקיות עצמה (`Folders.tsx`) — בעתיד.
- שיתוף קבוצת גרסאות עם משתמש אחר.
- ייצוא של קבוצה כקובץ אחד.
