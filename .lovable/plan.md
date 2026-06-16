# איחוד טאב נגן + עריכה → טאב יחיד "עורך טקסט"

## מטרה
טאב אחד מאוחד שמשלב נגן אודיו מסונכרן עם **כל** יכולות העריכה הקיימות היום בטאב "עריכה" (סרגל סימון, RichTextEditor, קליק ימני, פופ עריכה, שמירה/שכפול/למידה), תוך שמירה על הסנכרון בין הנגן לטקסט.

## שינויים עיקריים

### 1. הסרת הטאב הישן "עריכה"
- מסירים את `TabsTrigger value="edit"` ואת כל תוכן `TabsContent value="edit"` מ-`src/pages/TextEditor.tsx`.
- מסירים מהמערך `TABS` של `TabSettingsManager` (אם רלוונטי) את הערך `edit` כברירת מחדל גלויה.

### 2. שינוי שם הטאב "נגן" → "עורך טקסט"
- בכל הגדרת הטאבים: label `"נגן"` → `"עורך טקסט"`. הערך הפנימי נשאר `player` (לתאימות אחורה עם העדפות שמורות), אבל התווית מתחלפת.

### 3. שדרוג העמודה השמאלית ב-`SyncMirrorLayout`
היום העמודה השמאלית היא תצוגת מילים פשוטה עם קליק-ימני (`WordContextMenu`). מחליפים אותה ב-**מצב עריכה מלא** שכולל:

**א. סרגל סימון עליון (תמיד גלוי בראש העמודה השמאלית):**
- `TextMarkingOverlay` במצב `toolbarOnly` (סרגל בלבד) — אותו רכיב שכבר משמש בטאב הישן.
- כפתור "הפעל סימון" → מפעיל overlay שקוף מעל ה-`RichTextEditor` (לא מסתיר את הטקסט הניתן לעריכה — שכבת ויזואליזציה בלבד).

**ב. גוף העמודה — RichTextEditor במקום התצוגה הפשוטה:**
- `RichTextEditor` (אותו רכיב שבטאב הישן) מקבל את `text` ו-`onChange`.
- שומר את כל הכלים הקיימים: שמירה/שכפול/תיקון איות AI.
- עם **שכבת סנכרון** מעל: כאשר `syncEnabled=true`, מילה בזמן הנוכחי של הנגן מוארת (overlay לפי `data-word-index`, או שכבת ויזואל ע"י `useTextMarking` + `alignEditedToWhisper`).
- **קליק על מילה** = קפיצה לזמן בנגן (כמו היום).
- **קליק ימני על מילה** → תפריט מאוחד שמכיל גם את אפשרויות `WordContextMenu` הקיימות (החלפה, מחיקה, הוספה למילון, דילוג, התעלמות, קפיצה לזמן) וגם את **הפופ-אפ של עריכת מילה** הקיים ב-RichTextEditor (התיקון החכם / Gemini). מימוש: מאחדים את שני התפריטים ל-`WordContextMenu` מורחב עם קטע "תיקון חכם".

**ג. שכבת סימון overlay:**
- כשמפעילים סימון, ה-overlay מצויר מעל הטקסט עם `pointer-events: none` על השכבה הויזואלית, כך שהקליקים והעריכה ב-`RichTextEditor` ממשיכים לעבוד.

### 4. שמירה על פריסת ה-presets הקיימת
- ה-`presets` הקיימים (`split` / `stacked` / `wide` / `full` / `eq-wide`) נשארים בדיוק כמו היום.
- `split` (ברירת מחדל): נגן מימין, עמודת תמלול מסונכרן מימין-למטה, עמודת עריכה מלאה משמאל.
- `stacked`: נגן למעלה ברוחב מלא, מתחתיו 2 העמודות.
- `wide`: נגן + EQ ברוחב מלא ואז העמודות.
- `full`: נגן בלבד.

### 5. שמירה על פיצ'רים קיימים
- חיפוש בתמלול (`transcriptSearchOpen`) — ממשיך לעבוד מעל העמודה השמאלית החדשה.
- נגן צף / EQ צף — ללא שינוי.
- שמירה מהירה / שכפול / שמירת למידה לפרופיל — חוטים מועברים ל-RichTextEditor במקום ל-overlay הישן.

## פירוט טכני

### קבצים שמשתנים
- **`src/pages/TextEditor.tsx`**
  - מחיקת `TabsContent value="edit"` (שורות ~1504-1539).
  - שינוי label של הטאב `player`.
  - הסרת `edit` מתוויות `tabSettings`.
  - העברת תלויות ה-edit (`fontSize`, `lineHeight`, `columnStyle`, `handleEditorChange`, callbacks של שמירה/שכפול) ל-props של `SyncMirrorLayout`.
- **`src/components/SyncMirrorLayout.tsx`**
  - בעמודה השמאלית: החלפת הרינדור הנוכחי של מילים+כפתור "עריכה מלאה" ב:
    1. `<TextMarkingOverlay toolbarOnly={!markingActive} onActiveChange={setMarkingActive} ... />` בראש.
    2. wrapper יחסי (`relative`) שמכיל:
       - `<RichTextEditor>` במלוא הרוחב/גובה.
       - שכבת overlay של סימון (כש-`markingActive`): `absolute inset-0 pointer-events-none`.
       - שכבת overlay של הדגשת מילה לפי זמן (קיימת היום בעמודה הימנית — מועתקת ומסונכרנת לפי word index).
  - הוספת `onWordClick` ו-`onWordContextMenu` כ-handlers שעוטפים את ה-RichTextEditor (event delegation על `data-word-index`).
  - הסרת ה-Dialog של "עריכה מלאה" (כבר לא נחוץ — העריכה תמיד פעילה).
- **`src/components/WordContextMenu.tsx`**
  - הוספת סקציה "תיקון חכם / AI" שתפעיל את אותו flow שכיום RichTextEditor מפעיל בקליק.
  - (אם המבנה הקיים לא תומך — נחשוף callback `onSmartCorrect(word)` מ-RichTextEditor ונחבר ל-WordContextMenu).

### שמירת תאימות נתונים
- ערך הטאב הפנימי נשאר `'player'` כך שכל ההעדפות השמורות (`activeTab` ב-localStorage / cloud sync) ממשיכות לעבוד.
- אין שינוי סכמת DB / API.
- מי שהטאב הפעיל שלו היה `'edit'` — fallback אוטומטי ל-`'player'` (קוד הגנה ב-init).

### בדיקות מומלצות אחרי המימוש
1. עורך טקסט ב-RichTextEditor בזמן שהנגן מנגן — סנכרון מילים ממשיך.
2. הפעלת סימון בזמן עריכה — overlay מופיע, הטקסט עדיין נערך.
3. קליק ימני על מילה — תפריט מאוחד עם כל האפשרויות (החלפה + תיקון חכם).
4. קליק שמאלי על מילה — קפיצה לזמן בנגן.
5. שמירה/שכפול מהסרגל החדש פועלת.
6. החלפה בין presets (split/stacked/wide/full) שומרת על העמודה השמאלית עם כל היכולות.
7. משתמש שהיה לו טאב `edit` שמור — נטען ל-`player`.

## מה לא משתנה
- כל שאר הטאבים (loshon, speakers, templates, ai, compare, pipeline, prompts, ollama, learning, vocab, summary, analytics, history).
- הנגן עצמו (`SyncAudioPlayer`) ללא שינוי.
- העמודה הימנית "תמלול מסונכרן" (read-only) ללא שינוי.
- מערכת ה-presets והנגן/EQ הצף.
