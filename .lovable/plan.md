
# איחוד כל מסכי ה"השוואה" באפליקציה

## מה קיים היום (הבלאגן)

**בסיידבר — 2 כניסות נפרדות שגורמות לבלבול:**
1. `השוואת מנועים` → `/diarization/compare` — השוואת מנועי **זיהוי דוברים** (`DiarizationComparePage`)
2. `השוואת תמלולים` → `/compare-report` — הרצת 12 מנועי **תמלול** על אודיו והשוואה (`CompareReport`)

**בעורך הטקסט (TextEditor) — 2 טאבים נפרדים:**
3. טאב `A/B` (id=`ab`) → `EngineCompare` — מריץ את הטקסט הנוכחי דרך 2 מודלי LLM ומשווה את הפלט
4. טאב `השוואה` (id=`compare`) → `AdvancedDiffView` — Diff בין גרסאות (מקורי / AI / ידני / ענן)

**קוד מת:**
5. `src/components/TextComparisonMulti.tsx` — מיובא ב-`TextEditor.tsx` אבל לעולם לא נרנדר.
6. `src/components/TextComparison.tsx` — לא מיובא משום מקום.

(נשמרים: `EnhanceCompare` ב-VoiceStudio ו-`DiarizationCompare` בתוך `SpeakerDiarization` — אלו רכיבי השוואה ייעודיים בתוך עמודים אחרים, לא טאבים כפולים.)

## המטרה

מקום אחד ברור לכל סוג השוואה — בלי לאבד שום פיצ'ר.

## תוכנית האיחוד

### 1) סיידבר — כניסה אחת בלבד: "השוואות" → `/compare`
- עמוד חדש `src/pages/ComparisonsHub.tsx` עם `Tabs` עליונים:
  - **תמלולים (אודיו)** — מרנדר את גוף `CompareReport` הקיים.
  - **זיהוי דוברים** — מרנדר את גוף `DiarizationComparePage` הקיים.
- ה-Tabs יקראו את ה-tab מה-URL (`?tab=transcripts` / `?tab=diarization`) כדי לשמר deep-links.
- בסיידבר: להשאיר פריט אחד `השוואות` (icon `GitCompareArrows`). מוחקים את שתי הכניסות הישנות.
- ב-`App.tsx`: ה-routes `/diarization/compare` ו-`/compare-report` נשארים — אבל הופכים ל-redirect ל-`/compare?tab=...` כדי שלא לשבור קישורים/היסטוריה.

### 2) עורך הטקסט — טאב אחד "השוואה" עם תת-טאבים
- מסירים את הטאב `ab` מהמערך `allTabs` (שורה 152) ומ-`TabsContent`.
- בטאב `compare` הקיים מוסיפים `Tabs` פנימיים:
  - **גרסאות (Diff)** — `AdvancedDiffView` הקיים בדיוק כפי שהוא (כולל `onSendToAdvancedCompare` ו-`preselected*`).
  - **מנועי AI (A/B)** — `EngineCompare text={text}` הקיים.
- כל ההגדרות/תצורות של `TabSettingsManager` ימשיכו לעבוד; ניצור migration קטן ב-`loadTabSettings` שמסיר אוטומטית `ab` מ-`visible`/`order` אם הוא קיים, כדי שלמשתמשים קיימים לא יישאר טאב יתום.
- כפתור "שלח להשוואה A/B" בכרטיסי AI (שכבר מפנה ל-`activeTab='compare'`) ימשיך לעבוד; פשוט יפתח גם את התת-טאב "גרסאות" כברירת מחדל.

### 3) ניקוי קוד מת
- מחיקת `src/components/TextComparison.tsx` ו-`src/components/TextComparisonMulti.tsx`.
- מחיקת ה-import של `TextComparisonMulti` מ-`TextEditor.tsx`.

## מה לא משתנה (חשוב)
- כל הלוגיקה של `CompareReport`, `DiarizationComparePage`, `EngineCompare`, `AdvancedDiffView` — לא נוגעים בה. רק עוטפים/מעבירים.
- `EnhanceCompare` (VoiceStudio) ו-`DiarizationCompare` (בתוך `SpeakerDiarization`) — לא נוגעים בהם, אלו לא טאבים כפולים אלא רכיבים פנימיים של עמודים אחרים.
- שמירה בענן, ה-`compareVersions` memo, ה-event `ai-version-saved`, ה-`transcriptId` persistence — הכל נשאר.

## פריסת קבצים סופית

```text
src/pages/ComparisonsHub.tsx        ← חדש (מאחד את שני עמודי הסיידבר)
src/pages/CompareReport.tsx         ← נשאר, מיוצא גם כ-named ל-ComparisonsHub
src/pages/DiarizationComparePage.tsx ← נשאר, מיוצא גם כ-named ל-ComparisonsHub
src/App.tsx                          ← /compare חדש; /compare-report ו-/diarization/compare → redirect
src/components/AppSidebar.tsx        ← פריט יחיד "השוואות"
src/pages/TextEditor.tsx             ← טאב "compare" יחיד עם תת-טאבים; מסיר "ab"
src/components/TextComparison.tsx        ← נמחק
src/components/TextComparisonMulti.tsx   ← נמחק
```

## סיכון ובדיקה
- אחרי המימוש: לפתוח את `/compare` ולאמת שתי תת-לשוניות, לפתוח עורך טקסט ולאמת ש-Diff וגם EngineCompare זמינים תחת "השוואה", ולוודא שכפתור "שלח להשוואה" מהכרטיס פותח את ה-Diff עם הגרסאות הנכונות.
