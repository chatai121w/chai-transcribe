# 🔌 Database Function כפרוקסי ל-API חיצוני — מדריך כללי

> **💡 הרעיון הזה עובד לכל API חיצוני — לא רק ל-RoomChecking!**  
> בפרויקט שלנו השתמשנו בו פעמיים: פעם עבור **Sumit** (חשבוניות) ופעם עבור **RoomChecking** (ניהול חדרים).  
> הדוגמאות במדריך לקוחות מהמקרה שלנו, אבל אפשר להחליף בכל API: Stripe, Twilio, OpenAI, Google Maps, וכו׳.

---

## 📋 תוכן עניינים
1. [הבעיה — למה אי אפשר לקרוא ל-API ישירות?](#-הבעיה--למה-אי-אפשר-לקרוא-ל-api-ישירות)
2. [הפתרון הרגיל — Edge Function](#-הפתרון-הרגיל--edge-function)
3. [הפתרון האלטרנטיבי — Database Function](#-הפתרון-האלטרנטיבי--database-function)
4. [מתי להשתמש בכל אחד?](#-מתי-להשתמש-בכל-אחד)
5. [איך זה עובד — צעד אחר צעד](#-איך-זה-עובד--צעד-אחר-צעד)
6. [איך ליצור פרוקסי משלך — תבנית כללית](#-איך-ליצור-פרוקסי-משלך--תבנית-כללית)
7. [הדוגמה שלנו — RoomChecking](#-הדוגמה-שלנו--roomchecking)
8. [סיכום יתרונות וחסרונות](#-סיכום-יתרונות-וחסרונות)

---

## ❌ הבעיה — למה אי אפשר לקרוא ל-API ישירות?

כשאתר (frontend) רוצה לדבר עם API חיצוני, הדפדפן **חוסם** את זה מסיבות אבטחה.  
לזה קוראים **CORS** (Cross-Origin Resource Sharing):

```
🖥️ האתר שלך (your-app.com)
    ↓ 
    ❌ הדפדפן: "אסור לך לדבר עם external-api.com ישירות!"
    ↓
🌐 API חיצוני (external-api.com)
```

### למה הדפדפן חוסם?
- מונע מאתרים זדוניים לשלוח בקשות בשם המשתמש
- חל **רק בדפדפן** — שרת-לשרת אין בעיה

### הפתרון: פרוקסי (מתווך)
במקום שהדפדפן ידבר ישירות עם ה-API — הוא שולח בקשה ל**שרת שלנו**, והשרת מעביר את הבקשה הלאה:

```
🖥️ האתר שלך
    ↓ (מותר — זה שרת שלך)
🔄 פרוקסי (שרת שלך)
    ↓ (מותר — שרת לשרת)
🌐 API חיצוני
```

---

## 🟢 הפתרון הרגיל — Edge Function

ב-Supabase, הדרך הרגילה לעשות פרוקסי היא **Edge Function** — קוד JavaScript/TypeScript שרץ בענן של Supabase:

```
🖥️ האתר שלך
    ↓ fetch('/functions/v1/my-proxy')
⚡ Edge Function (Deno runtime בענן)
    ↓ fetch('https://external-api.com/...')
🌐 API חיצוני
```

### ✅ יתרונות:
- מהיר (Deno runtime)
- לוגים ודשבורד ב-Supabase
- timeout של עד 150 שניות
- לא מעמיס על הדאטאבייס

### ❌ חסרון מרכזי:
- **דורש דיפלוי**: `supabase functions deploy my-proxy`
- אם אין לך גישה לפקודה הזו (למשל עובדים מ-Lovable) — **אי אפשר לעדכן**

---

## 🗄️ הפתרון האלטרנטיבי — Database Function

הרעיון: במקום קוד שרץ בענן (Edge Function), כותבים **פונקציית SQL בתוך PostgreSQL** שיודעת לשלוח HTTP requests:

```
🖥️ האתר שלך
    ↓ supabase.rpc('my_proxy', {...})
🗄️ Database Function (PostgreSQL)
    ↓ http extension → HTTP request
🌐 API חיצוני
```

### ✅ יתרונות:
- **אין צורך בדיפלוי** — פונקציה נוצרת עם SQL והיא חיה מיד
- `supabase.rpc()` עובר דרך PostgREST — **אין CORS**
- אותנטיקציה אוטומטית דרך Supabase SDK
- קל לעדכון — שינוי = הרצת SQL

### ❌ חסרונות:
- קצת יותר איטי (~100-300ms)
- מעמיס על connection pool של הדאטאבייס
- timeout מוגבל ל-60 שניות
- אין לוגים מסודרים

---

## 🤔 מתי להשתמש בכל אחד?

| מצב | הפתרון |
|------|---------|
| יש לך גישה ל-`supabase functions deploy` | **Edge Function** — הפתרון המומלץ |
| אין לך גישה לדיפלוי (Lovable, PoC, hackathon) | **Database Function** — עובד מיד |
| API עם תגובות איטיות (מעל 60 שניות) | **Edge Function** — timeout ארוך יותר |
| קריאות תכופות מאוד (מאות בדקה) | **Edge Function** — לא מעמיס על DB |
| קריאות בתדירות נמוכה (כמה בדקה) | **Database Function** — מושלם |
| צריך streaming / SSE | **Edge Function** — DB Function לא תומך |

---

## 🔄 איך זה עובד — צעד אחר צעד

### שלב 1: האתר שולח בקשה
```javascript
// במקום fetch ישירות ל-API חיצוני (שייחסם ע"י CORS):
// ❌ fetch('https://external-api.com/data')

// שולחים דרך הפרוקסי:
// ✅ supabase.rpc('my_proxy', { ... })
```

### שלב 2: הפרוקסי מעביר את הבקשה
```
PostgreSQL מקבל את הפרמטרים (URL, נתיב, שיטה, גוף, טוקן)
    ↓
שולח HTTP request ל-API החיצוני (דרך http extension)
    ↓
מקבל תשובה מה-API
    ↓
מחזיר JSON לאתר
```

### שלב 3: טיפול בשגיאות
```
אם ה-API החיצוני מחזיר שגיאה:
    ← הפרוקסי מחזיר { _error: true, _status: 500, _message: "...", data: [] }
    ← האתר מטפל בשגיאה בצורה מבוקרת במקום להתרסק
```

> **⚠️ נקודה חשובה:** תמיד תטפלו בשגיאות בצד הלקוח (frontend)!  
> גם עם פרוקסי, API חיצוני יכול ליפול. האתר צריך להמשיך לעבוד.

---

## 🧩 איך ליצור פרוקסי משלך — תבנית כללית

### שלב 1: הפעל את ה-http extension
```sql
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
```

### שלב 2: צור את הפונקציה (תבנית כללית)
```sql
CREATE OR REPLACE FUNCTION my_api_proxy(
    p_base_url TEXT,      -- כתובת בסיס של ה-API (למשל 'https://api.stripe.com')
    p_path TEXT,           -- הנתיב (למשל '/v1/charges')
    p_method TEXT,         -- GET או POST
    p_body JSONB,          -- גוף הבקשה (ל-POST)
    p_bearer_token TEXT    -- טוקן אימות (אופציונלי)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_response extensions.http_response;
    v_url TEXT;
    v_headers extensions.http_header[];
    v_result JSONB;
BEGIN
    -- בנה URL מלא
    v_url := p_base_url || '/' || p_path;

    -- בנה headers
    v_headers := ARRAY[
        extensions.http_header('Content-Type', 'application/json'),
        extensions.http_header('Accept', 'application/json')
    ];

    -- הוסף טוקן אם קיים
    IF p_bearer_token IS NOT NULL AND p_bearer_token != '' THEN
        v_headers := v_headers || extensions.http_header('Authorization', 'Bearer ' || p_bearer_token);
    END IF;

    -- שלח את הבקשה
    IF upper(p_method) = 'GET' THEN
        v_response := extensions.http_get(v_url, v_headers);
    ELSE
        v_response := extensions.http_post(v_url, p_body::text, 'application/json', v_headers);
    END IF;

    -- בדוק תשובה
    IF v_response.status >= 200 AND v_response.status < 300 THEN
        BEGIN
            v_result := v_response.content::jsonb;
        EXCEPTION WHEN OTHERS THEN
            v_result := jsonb_build_object('raw', v_response.content);
        END;
        RETURN v_result;
    ELSE
        -- שגיאה — החזר מידע על השגיאה בלי לקרוס
        RETURN jsonb_build_object(
            '_error', true,
            '_status', v_response.status,
            '_message', left(v_response.content, 500),
            'data', '[]'::jsonb
        );
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        '_error', true,
        '_status', 0,
        '_message', SQLERRM,
        'data', '[]'::jsonb
    );
END;
$$;
```

### שלב 3: תן הרשאות
```sql
GRANT EXECUTE ON FUNCTION my_api_proxy TO anon, authenticated, service_role;
```

### שלב 4: קרא מהקוד
```javascript
const { data, error } = await supabase.rpc('my_api_proxy', {
    p_base_url: 'https://api.example.com',
    p_path: 'v1/data',
    p_method: 'POST',
    p_body: { key: 'value' },
    p_bearer_token: 'your-token-here'
});

if (error || data?._error) {
    console.error('API error:', data?._message || error?.message);
    // טפל בשגיאה — אל תתרסק!
} else {
    // data מכיל את התשובה מה-API
    console.log(data);
}
```

> **🔑 טיפ:** אפשר ליצור כמה פרוקסי שרוצים — אחד לכל API חיצוני.  
> בפרויקט שלנו יש `sumit_proxy` ו-`roomchecking_proxy` — שניהם באותו דפוס בדיוק.

---

## 🏨 הדוגמה שלנו — RoomChecking

> **📌 הסעיף הזה ספציפי לפרויקט שלנו. הסעיפים למעלה הם כלליים.**

### הבעיה הספציפית שלנו:
- האתר מתחבר ל-**RoomChecking** (מערכת ניהול חדרים)
- השתמשנו ב-**Edge Function** כפרוקסי
- ה-Edge Function **לא ניתנת לדיפלוי** מ-Lovable
- כש-RoomChecking החזיר שגיאה 500 ← Edge Function העבירה 500 ← **האתר קרס עם מסך לבן**

### מה שינינו:

| קובץ | שינוי |
|-------|-------|
| `scripts/setup-roomchecking-proxy.mjs` | 🆕 סקריפט שיוצר את הפונקציה בדאטאבייס (מריצים פעם אחת) |
| `src/services/roomCheckingApi.ts` | ✏️ שינוי `edgeFunctionCall` — מ-Edge Function ל-`supabase.rpc` |
| `src/hooks/useRoomChecking.ts` | ✏️ הגנות נגד קריאות כפולות + cooldown על שגיאות |

### לפני:
```javascript
// קורא ל-Edge Function שלא מדופלית → מסך לבן
fetch(`${supabaseUrl}/functions/v1/roomchecking-proxy`, { ... })
```

### אחרי:
```javascript
// קורא ל-DB Function שחיה מיד → עובד בלי דיפלוי
supabase.rpc('roomchecking_proxy', { ... })
```

### לעתיד:
כשתהיה גישה ל-`supabase functions deploy` — אפשר לחזור ל-Edge Function (מהיר יותר, לוגים, לא מעמיס על DB). זה שינוי של פונקציה אחת.

---

## ⚖️ סיכום יתרונות וחסרונות

### Database Function

| ✅ יתרונות | ❌ חסרונות |
|---|---|
| אין צורך בדיפלוי — עובד מיד | קצת יותר איטי (~100-300ms) |
| קל לעדכון — הרצת SQL בלבד | מעמיס על connection pool של DB |
| אין בעיות CORS | אין לוגים מסודרים |
| אותנטיקציה אוטומטית דרך SDK | timeout מוגבל ל-60 שניות |
| עובד בכל סביבה (Lovable, PoC, hackathon) | לא תומך ב-streaming |

### Edge Function

| ✅ יתרונות | ❌ חסרונות |
|---|---|
| מהיר יותר (Deno runtime ישיר) | דורש `supabase functions deploy` |
| לוגים ודשבורד ב-Supabase | לא ניתן לדפלי מכל סביבה |
| לא מעמיס על DB | צריך access token |
| timeout של 150 שניות | שינויים דורשים דיפלוי מחדש |
| תומך ב-streaming / SSE | |

---

## 🎯 סיכום

> **הרעיון הכללי:** כשצריך לדבר עם API חיצוני מ-frontend ואין גישה לדיפלוי Edge Functions —  
> אפשר להשתמש ב-**Database Function + http extension** כפרוקסי. זה עובד מכל סביבה, בלי דיפלוי, בלי CORS.
>
> **הדוגמה שלנו:** החלפנו את Edge Function `roomchecking-proxy` (שלא ניתנת לדיפלוי) ב-Database Function `roomchecking_proxy` — ובאותו דפוס בדיוק גם `sumit_proxy` עבור Sumit API.
>
> **עובד לכל API:** Stripe, Twilio, OpenAI, Google Maps — כל מה שצריך זה להעתיק את התבנית ולשנות את השם.
