# מערכת מעקב טוקנים ועלויות AI

## מטרה
ליד כל מקום בממשק שמופיע בו מנוע AI (לשון הקודש, סיכום, עריכת טקסט וכו') יופיע אייקון 📊 קטן. לחיצה פותחת חלון עם:
- כמה טוקנים השתמשתי (קלט/פלט) — היום, השבוע, סה"כ
- מחיר משוער ב-USD/ILS לפי מחירון
- מספר קריאות, ממוצע טוקנים לקריאה
- מחירון לכל מודל — עם אפשרות עריכה ידנית

## ארכיטקטורה

### 1. טבלה חדשה ב-DB: `ai_usage_events`
```
id, user_id, feature (loshon-kodesh|summary|edit|...), 
model, prompt_tokens, completion_tokens, total_tokens,
created_at
```
RLS: user רואה רק את שלו.

### 2. רישום אוטומטי
לכל edge function שקוראת ל-Lovable AI:
- לקרוא `usage` מתשובת ה-gateway (`prompt_tokens`, `completion_tokens`)
- להכניס שורה ל-`ai_usage_events`

מתחילים מ-`loshon-kodesh-ai`, `summarize-transcript`, `edit-transcript` (DB proxy + edge).

### 3. מחירון
קובץ `src/lib/aiPricing.ts` עם מחירי ברירת מחדל ($ per 1M tokens):
- google/gemini-2.5-flash: $0.30 / $2.50
- google/gemini-2.5-pro: $1.25 / $10
- google/gemini-3-flash-preview: $0.30 / $2.50
- openai/gpt-5-mini, gpt-5, וכו'

המשתמש יכול לדרוס בהגדרות → נשמר ב-`user_preferences` (שדה JSON חדש `ai_pricing_overrides`).

### 4. רכיב UI: `<AIUsageBadge feature="loshon-kodesh" model={currentModel} />`
- אייקון 📊 קטן (h-4 w-4) ליד כל בורר מנוע AI
- Popover עם:
  - **היום**: X טוקנים · ~$Y
  - **7 ימים**: ...
  - **סה"כ**: ...
  - **פירוט לפי מודל** (טבלה)
  - כפתור "ערוך מחירון"
- שער המרה USD→ILS ניתן לעריכה (default 3.7)

### 5. דף הגדרות מחירון
`/settings` → טאב חדש "מחירי AI": טבלה של כל המודלים עם input/output price, שמירה ל-cloud preferences.

## מיקומי האייקון (גרסה ראשונה)
- `LoshonKodeshRules.tsx` — ליד בורר המודל בטאב AI
- `TranscriptSummary.tsx` — ליד כותרת "סיכום AI"
- `TextEditor.tsx` — ליד בורר מודל עריכה (אם קיים)
- ההמשך: כל מקום שבו מופיע select של מודלי AI

## פרטים טכניים
- שינוי edge functions: להוסיף `await supabase.from('ai_usage_events').insert(...)` אחרי קריאה מוצלחת ל-gateway (השמת `prompt_tokens`/`completion_tokens` מ-`data.usage`).
- ה-RPC `edit_transcript_proxy` (PL/pgSQL) — נוסיף `INSERT` לטבלה אחרי קריאת `http_post`.
- חישוב מחיר: `(prompt*price_in + completion*price_out) / 1_000_000`.
- `useAIUsage(feature?, model?)` hook עם cache + realtime invalidation.

## מה לא בגרסה הזו (אפשר להוסיף אח"כ)
- אזהרות חריגה מתקציב
- ייצוא CSV
- גרפים יומיים

מאשר להתחיל?
