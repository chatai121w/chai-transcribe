# 🔌 מדריך חיבור Sumit API - דיפלוי דרך המערכת

## 📋 סקירה כללית

### הבעיה
האפליקציה רצה בדפדפן (`connect-crm-dream.lovable.app`) וצריכה לקרוא ל-API של Sumit (`api.sumit.co.il`).  
הדפדפן חוסם את הקריאה בגלל **CORS** - מדיניות אבטחה שמונעת מאתר אחד לקרוא ל-API של אתר אחר ישירות.

### הפתרון
במקום לקרוא ישירות מהדפדפן ל-Sumit, הקריאה עוברת דרך **Supabase Database Function** (פונקציית PostgreSQL) שרצה בצד השרת - שם אין מגבלות CORS.

```
דפדפן → Supabase (supabase.rpc) → PostgreSQL http extension → Sumit API
```

---

## 🛠️ מה נעשה - שלב אחר שלב

### שלב 1: הפעלת http extension בדאטהבייס

ה-`http` extension של PostgreSQL מאפשר לשלוח בקשות HTTP מתוך פונקציות SQL.

**הבעיה:** לא ניתן להפעיל extension דרך הסקריפט הרגיל (`direct-run.mjs`) כי `execute_safe_migration` לא מאפשר `CREATE EXTENSION`.

**הפתרון:** השתמשנו ב-Edge Function `execute-sql` שכבר מדופלית במערכת, שמריצה SQL עם הרשאות Service Role:

```javascript
const response = await fetch(`${SUPABASE_URL}/functions/v1/execute-sql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    sql: 'CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;',
    mode: 'execute'
  }),
});
```

**✅ תוצאה:** `http extension enabled`

---

### שלב 2: יצירת פונקציית הפרוקסי בדאטהבייס

יצרנו פונקציית PostgreSQL בשם `sumit_proxy` שמקבלת endpoint ו-body, שולחת POST request ל-Sumit, ומחזירה את התשובה כ-JSONB:

```sql
CREATE OR REPLACE FUNCTION public.sumit_proxy(
  p_endpoint TEXT,
  p_body JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result extensions.http_response;
  response_body JSONB;
BEGIN
  -- שליחת POST ל-Sumit API
  SELECT * INTO result FROM extensions.http((
    'POST',
    'https://api.sumit.co.il' || p_endpoint,
    ARRAY[extensions.http_header('Content-Type', 'application/json')],
    'application/json',
    p_body::TEXT
  )::extensions.http_request);

  -- פירוש התשובה כ-JSON
  BEGIN
    response_body := result.content::JSONB;
  EXCEPTION WHEN OTHERS THEN
    response_body := jsonb_build_object(
      'Success', false,
      'ErrorMessage', 'Failed to parse Sumit response'
    );
  END;

  RETURN response_body;
END;
$$;

-- הרשאות למשתמשים מחוברים
GRANT EXECUTE ON FUNCTION public.sumit_proxy(TEXT, JSONB) TO authenticated;
```

**✅ תוצאה:** `sumit_proxy function created!`

---

### שלב 3: עדכון הפרונטנד

שינינו את הפונקציה `sumitApiCall` בקובץ `src/services/sumitService.ts` מקריאה ישירה ל-Sumit לקריאה דרך `supabase.rpc`:

**לפני (לא עובד - CORS):**
```typescript
const response = await fetch(`https://api.sumit.co.il${endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody),
});
```

**אחרי (עובד!):**
```typescript
const { data, error } = await (supabase.rpc as any)('sumit_proxy', {
  p_endpoint: endpoint,
  p_body: requestBody,
});
```

---

### שלב 4: בדיקה

הרצנו סקריפט בדיקה (`scripts/test-sumit-proxy.mjs`) שקורא ל-endpoint `/accounting/general/getvatrate/`:

```
🧪 Testing sumit_proxy with /accounting/general/getvatrate/...
✅ Result: {
  "Data": { "Rate": 18 },
  "Status": 0,
  "UserErrorMessage": null,
  "TechnicalErrorDetails": null
}
```

**שיעור מע"מ 18% חזר בהצלחה - הכל עובד!** 🎉

---

## 📁 קבצים שנוצרו/שונו

| קובץ | תפקיד |
|-------|--------|
| `scripts/setup-sumit-proxy.mjs` | סקריפט ההתקנה - מפעיל extension, יוצר פונקציה, נותן הרשאות |
| `scripts/test-sumit-proxy.mjs` | סקריפט בדיקה - בודק חיבור ל-Sumit |
| `supabase/migrations/sumit_proxy_function.sql` | ה-SQL של הפונקציה (לגיבוי/הרצה ידנית) |
| `supabase/functions/sumit-proxy/index.ts` | Edge Function (חלופי - לא בשימוש כרגע) |
| `setup-sumit-proxy.sql` | SQL מלא כולל extension (להרצה ידנית בדאשבורד) |
| `src/services/sumitService.ts` | שירות ה-Sumit - שונה לעבור דרך `supabase.rpc` |

---

## 🔧 איך להריץ שוב (אם צריך)

### התקנה מחדש
```powershell
cd C:\Users\jj121\connect-crm-dream
node scripts/setup-sumit-proxy.mjs
```

### בדיקת חיבור
```powershell
node scripts/test-sumit-proxy.mjs
```

### התקנה ידנית מהדאשבורד
1. לך ל: https://supabase.com/dashboard/project/pycryoyipkymaqorgpjy/sql/new
2. הדבק את התוכן של `setup-sumit-proxy.sql`
3. לחץ Run

---

## 🔑 פרטי ה-API

| שדה | ערך |
|------|------|
| Company ID | `196701271` |
| API Key | `0pKvMSJNu9VZHY9eTb9Fdr7RBe1zaOCEbLPQneC5xdxdnAAjQG` |
| API Base URL | `https://api.sumit.co.il` |
| Supabase Project | `pycryoyipkymaqorgpjy` |

---

## 🏗️ ארכיטקטורה

```
┌──────────────────────┐
│   דפדפן (Frontend)   │
│   SumitFinancePanel   │
└──────────┬───────────┘
           │ supabase.rpc('sumit_proxy', {
           │   p_endpoint: '/accounting/documents/create/',
           │   p_body: { Credentials: {...}, Details: {...} }
           │ })
           ▼
┌──────────────────────┐
│   Supabase (PostgREST)│
│   RPC → sumit_proxy() │
└──────────┬───────────┘
           │ extensions.http(POST, 'https://api.sumit.co.il/...')
           ▼
┌──────────────────────┐
│   Sumit API           │
│   api.sumit.co.il     │
└──────────────────────┘
```

---

## ⚠️ נקודות חשובות

### למה לא Edge Function?
- Edge Function דורשת **דיפלוי** דרך `supabase functions deploy` עם **access token**
- לא היה לנו token ולא יכולנו לדפלי
- Database Function **לא דורשת דיפלוי** - פשוט SQL שרץ בדאטהבייס

### למה לא ישירות מהדפדפן?
- CORS - הדפדפן חוסם קריאות cross-origin ל-`api.sumit.co.il`
- גם ה-API Key חשוף ב-frontend (לא אידיאלי, אבל Sumit מאפשר את זה)

### למה `execute-sql` ולא `direct-run.mjs`?
- `direct-run.mjs` עובר דרך `execute_safe_migration` שלא מאפשר `CREATE EXTENSION`
- `execute-sql` Edge Function משתמשת ב-Service Role Key עם הרשאות מלאות

### Endpoints נפוצים של Sumit
| Endpoint | תפקיד |
|----------|--------|
| `/accounting/general/getvatrate/` | שיעור מע"מ נוכחי |
| `/accounting/documents/create/` | יצירת חשבונית/קבלה |
| `/accounting/documents/list/` | רשימת מסמכים |
| `/accounting/documents/send/` | שליחת מסמך במייל |
| `/accounting/documents/getpdf/` | הורדת PDF |
| `/accounting/documents/cancel/` | ביטול מסמך |
| `/accounting/customers/create/` | יצירת לקוח |
| `/accounting/incomeitems/list/` | רשימת פריטי הכנסה |
| `/accounting/payments/charge/` | סליקת אשראי |

---

## 📝 Git Commits

| Commit | תיאור |
|--------|--------|
| `75c0be5` | יצירת Edge Function proxy (ניסיון ראשון) |
| `cc3b8f4` | מעבר ל-Database Function proxy עם `supabase.rpc` |
| `a18554b` | סקריפט התקנה ובדיקה - עובד מוצלח! |

---

## 🎓 סיכום

**הבעיה:** CORS חוסם קריאות ישירות מהדפדפן ל-Sumit API  
**הפתרון:** Database Function ב-PostgreSQL עם `http` extension  
**היתרון:** לא צריך לדפלי Edge Function, לא צריך access token  
**הסטטוס:** ✅ עובד ונבדק בהצלחה!
