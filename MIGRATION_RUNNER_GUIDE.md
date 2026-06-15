# 🚀 מדריך הרצת מיגרציות — smart-hebrew-transcriber

## מה זה עושה?
הכלי מריץ SQL על Supabase דרך Edge Function בשם `run-migration`.

בפרויקט הזה הכלי הרשמי הוא:

```text
scripts/direct-run.mjs
```

## שלב 1: כניסה לתיקיית הפרויקט

```powershell
cd "c:\Users\jj121\smart-hebrew-transcriber"
```

## שלב 2: הרצת מיגרציה מקובץ SQL

```powershell
node scripts/direct-run.mjs file "supabase/migrations/20260405143000_add_compare_settings_json.sql"
```

זה השימוש הכי מומלץ למיגרציות אמיתיות.

## שלב 3: הרצת SQL ישיר (מהיר)

```powershell
node scripts/direct-run.mjs sql "SELECT now();" "health_check"
```

השם בסוף (`health_check`) הוא אופציונלי ונועד ללוגים.

## איך מזינים סיסמה?

יש 2 אפשרויות:

1. אינטראקטיבי: הכלי יבקש סיסמה בטרמינל.
2. Environment Variable:

```powershell
$env:ADMIN_PASSWORD="your_password_here"
node scripts/direct-run.mjs file "supabase/migrations/20260405143000_add_compare_settings_json.sql"
```

אופציונלי אפשר גם לשנות אימייל אדמין:

```powershell
$env:ADMIN_EMAIL="jj1212t@gmail.com"
```

## פקודות נתמכות בכלי הזה

1. `file <path>`
2. `sql "..." [name]`

הערה חשובה: הפקודה `pending` לא נתמכת בגרסה הנוכחית של הכלי בפרויקט הזה.

## איפה שמים קבצי מיגרציה?

```text
supabase/migrations/
```

דוגמה לשם טוב:

```text
20260405143000_add_compare_settings_json.sql
```

## בדיקה אחרי הרצה

אם הצליח תראה:

```text
✅ Migration completed successfully!
🏁 Done!
```

## פתרון תקלות מהיר

1. `Login failed`
  הסיסמה/אימייל לא נכונים או שאין הרשאות.
2. `Edge function error`
  בדוק ש-`run-migration` פרוסה ופעילה.
3. `syntax error`
  יש שגיאת SQL בקובץ.

## דוגמה מלאה להרצת המיגרציה החדשה של compare settings

```powershell
cd "c:\Users\jj121\smart-hebrew-transcriber"
node scripts/direct-run.mjs file "supabase/migrations/20260405143000_add_compare_settings_json.sql"
```

## סיכום קצר

1. תמיד להריץ מה-root של הפרויקט.
2. הכי טוב לעבוד עם `file` ולא עם `sql` למיגרציות קבועות.
3. לפני הרצה בפרודקשן, לבדוק קודם בסביבת dev/staging.
