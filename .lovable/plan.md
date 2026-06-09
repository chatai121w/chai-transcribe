## המטרה

לפתור את שני הקשיים הקיימים בעורך ערכות הנושא:
1. ה-iframe חוסם אינטראקציה — אי אפשר ללחוץ על אלמנטים אמיתיים ולשנות אותם.
2. כיום אפשר רק לערוך ערכת נושא שלמה (כל הטוקנים), לא אלמנט בודד או רכיב ספציפי.

הפתרון: להוסיף **"מצב עיצוב חי"** — שכבת עריכה שרצה ישירות מעל האפליקציה האמיתית (לא iframe), ובכל שינוי לשאול היקף.

---

## איך זה ירגיש למשתמש

1. בעורך ערכות נושא יתווסף כפתור גדול: **"הפעל מצב עיצוב חי"**. הדיאלוג ייסגר.
2. סרגל קטן ומרחף יופיע (RTL, פינה שמאלית-עליונה, ניתן לגרירה): מעבר עמודים, מצב פעיל/כבוי, יציאה, ביטול אחרון, שמירה.
3. במצב פעיל: מעבר עכבר מסמן אלמנטים במסגרת זהובה דקה + תווית קטנה (`button.primary`, `Card`, וכו').
4. לחיצה על אלמנט → פאנל צף קטן עם:
   - צבע טקסט / רקע / מסגרת (color picker)
   - גודל טקסט, משקל, רדיוס, padding
5. אחרי שינוי ערך → דיאלוג קצר: **"להחיל על:"**
   - **רק האלמנט הזה** (override נקודתי)
   - **כל האלמנטים מהסוג הזה בעמוד** (לפי class signature)
   - **כל המופעים בכל האתר** (משנה את הטוקן ב-CSS variable של הערכה)
6. שמירה ל-cloud (user_preferences) → מסתנכרן בין מכשירים.
7. גם המצב המקורי (iframe side-by-side + פלטות מוכנות) נשאר זמין כטאב נפרד.

---

## ארכיטקטורה טכנית

### קבצים חדשים
- `src/components/design-mode/DesignModeProvider.tsx` — context גלובלי. מחזיק `enabled`, `overrides[]`, `history[]`. מזריק `<style>` עם ה-overrides.
- `src/components/design-mode/DesignModeOverlay.tsx` — מנוי mouseover/click על `document`, מצייר highlight ב-`position:fixed` div, פותח את פאנל העריכה.
- `src/components/design-mode/ElementEditorPopover.tsx` — שדות צבע/טייפו/spacing.
- `src/components/design-mode/ScopeDialog.tsx` — דיאלוג "להחיל על". 3 אפשרויות.
- `src/lib/designOverrides.ts` — חישוב selector ייחודי (id → data-testid → class signature → nth-child path), serialize/deserialize, apply via stylesheet.

### עדכונים
- `src/App.tsx` — לעטוף ב-`<DesignModeProvider>` ולרנדר `<DesignModeOverlay>` ברמת root.
- `src/components/ThemeManager.tsx` — להוסיף כפתור "הפעל מצב עיצוב חי" שמדליק את ה-context וסוגר את הדיאלוג. להשאיר את ה-iframe preview כטאב משני.
- `src/hooks/useCloudPreferences.ts` — הוספת שדה `element_overrides: string` (JSON).
- מיגרציה: עמודה `element_overrides text` ב-`user_preferences`.

### לוגיקת היקף
- **רק האלמנט הזה**: שומר `{ selector: "main > div:nth-child(2) > button:nth-child(1)", css: {...} }`. מוזרק כ-`<style>` גלובלי.
- **כל הסוג בעמוד**: לוקח את ה-class signature (`button.bg-primary.text-sm`), שומר ל-`.classsig { ... }`.
- **כל האתר (טוקן)**: ממפה את ה-CSS property (e.g. `background-color` של אלמנט שמשתמש ב-`hsl(var(--primary))`) → משנה את ה-token בערכת הנושא הפעילה (משתמש ב-`saveCustomTheme` הקיים).

### בטיחות
- מצב עיצוב חי מבטל clicks רגילים (preventDefault + stopPropagation) רק כשפעיל.
- מקש Esc יוצא מהמצב.
- "ביטול" (Ctrl+Z) מסיר את ה-override האחרון.
- ב-mobile: מקבל tap עם long-press לבחירה (ולא click רגיל).

---

## טכני נוסף

- ה-`<style>` המוזרק יושב ב-`<head>` עם `id="design-overrides"`, מתעדכן בכל שינוי overrides.
- selector ייחודי: עוקב אחר parent path עד שמוצאים `[data-testid]` או `id`, אחרת nth-child path מקסימום 5 רמות.
- ה-overlay highlight: `pointer-events:none`, `position:fixed`, `outline: 2px solid hsl(var(--primary))`.
- תאימות RTL: כל הפאנלים `dir="rtl"`, מיקום שמאלי בברירת מחדל אבל ניתן לגרירה.
- ב-mobile (`useIsMobile`): סרגל למטה, פאנל עורך מלא-מסך מלמטה (sheet).

---

## מה לא נכלל

- אין AI שמייצר עיצוב לאלמנט בודד (אפשר להוסיף בהמשך).
- אין export של overrides לקוד React (רק שמירה ב-preferences).
- אין undo מעבר ל-5 פעולות אחרונות (מספיק לתיקון טע