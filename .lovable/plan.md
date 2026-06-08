## מטרה
כיום בעורך הטקסט יש הרבה "וויידג'טים" (כרטיסים מקופלים) — חלקם עם איקון מזעור משמאל, חלקם מימין, חלקם בכלל ללא. כשממזערים, נשאר `space-y-4` / `mb-4` של ההורה ויוצר חורים ענקיים בין הכרטיסים. נסדר את זה בצורה גלובלית.

## מה נבנה

### 1. רכיב אחיד `CollapsibleWidget`
קובץ חדש: `src/components/ui/CollapsibleWidget.tsx`

- כותרת עליונה עם:
  - **מימין (RTL):** אייקון + שם הוויידג'ט + תגיות אופציונליות.
  - **משמאל קבוע:** כפתור מזעור/הרחבה (`ChevronUp`/`ChevronDown`) — תמיד באותו מקום, אותו גודל (`h-7 w-7`), אותו variant.
- כשהוויידג'ט מזוער: גובה הכרטיס = רק הכותרת (header), הגוף ב-`hidden`.
- שומר state ב-`localStorage` לפי `storageKey` כך שהמצב נשמר בין רענונים.
- מקבל `defaultOpen`, `title`, `icon`, `badge`, `actions` (לכפתורי שמירה/שחזור בכותרת).
- מחזיר אותו `rounded-2xl border bg-card` בכל מקום — מראה אחיד.

### 2. עטיפת ה-Widgets הקיימים
לעטוף את הוויידג'טים שמופיעים בטאבים של `TextEditor.tsx`:
- "טקסט לעריכה" (`AIEditorDual` שורות 1880–1924) — להחליף את ה-toggle הידני ב-`CollapsibleWidget`.
- "שמירה מהירה לתוצאות" (`AIEditorDual` ~1926).
- כרטיסי `SyncAudioPlayer`, `SyncMirrorLayout` בטאב נגן.
- `CorrectionLearningPanel`, `VocabularyPanel`, `DictionaryValidator`, `AutoSummaryCard`, `TranscriptSummary`, `EngineCompare`, `AnalyticsDashboard`, `TextEditHistory` — כל אחד יישב בתוך `CollapsibleWidget` עם שם וטייטל מתאימים.

### 3. תיקון רווחים בין וויידג'טים
- בכל ה-`TabsContent` ב-`TextEditor.tsx` נחליף `space-y-4` ב-`flex flex-col gap-3` כך שגם כשוויידג'ט מזוער הרווח קבוע ולא כפול.
- להסיר `mb-4`/`mt-4` מהקצוות הפנימיים של הוויידג'טים — הרווח מנוהל רק על ידי ההורה.
- כל כרטיס מקבל אותו `rounded-2xl border-border/50 bg-card shadow-sm`.

### 4. עקביות חזותית
- כל איקוני המזעור: `Minimize2`/`Maximize2` יוחלפו ב-`ChevronUp`/`ChevronDown` (יותר ברור בעברית/RTL).
- מיקום קבוע: למעלה משמאל, padding זהה (`px-3 py-2`).
- צבעי hover אחידים (gold לפי memory: `hover:text-yellow-600`).

## פרטים טכניים
- אין שינוי לוגיקה עסקית — רק עטיפה ויזואלית.
- אין מיגרציית DB.
- בדיקה: מעבר בין כל הטאבים, מזעור/הרחבה של כל וויידג'ט, וידוא שאין קפיצות פריסה ושהאיקון נשאר באותו מקום.

## מחוץ לתחום
- לא נוגעים בטאב "ערכות נושא" (כבר עברנו שדרוג).
- לא משנים את התוכן הפונקציונלי של הוויידג'טים —