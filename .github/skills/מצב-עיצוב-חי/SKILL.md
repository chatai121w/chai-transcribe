---
name: מצב-עיצוב-חי
description: "שכפל אחד-לאחד את מערכת Live Design Mode מהפרויקט הנוכחי לפרויקט אחר: overlay, element editor, save scopes, theme save menu, cloud sync ופרסום קהילה. השתמש כשמבקשים 'בדיוק אותה מערכת'."
---

# Skill: שכפול מצב עיצוב חי אחד-לאחד

Use this skill when the user wants to recreate the exact Live Design Mode system from this repository in another project.

## מתי להשתמש
- כשהמשתמש מבקש לבנות "בדיוק אותה מערכת" של מצב עיצוב חי.
- כשצריך inline editing על האפליקציה עצמה ולא רק theme editor רגיל.
- כשצריך גם save scopes וגם שמירה לערכות נושא/ענן.

## מתי לא להשתמש
- כשצריך רק theme picker פשוט.
- כשצריך רק שינוי CSS tokens בלי עריכת אלמנטים.
- כשצריך מערכת חדשה בסגנון שונה ולא שכפול התנהגות.

---

## יעד סופי
לספק מערכת עם הפריטים הבאים:
1. מצב עיצוב חי שנפתח על האפליקציה עצמה.
2. hover highlight + click select לאלמנטים.
3. עורך אלמנט צף עם תצוגה מקדימה מיידית.
4. 3 אפשרויות שמירה להיקף override.
5. toolbar צף עם undo/clear/save/exit.
6. save menu לשמירה לערכות נושא + ענן + פרסום קהילה.
7. persistence מלא localStorage + cloud.

---

## קבצים שצריך ליצור או לשכפל לוגית

### 1) context/provider
- src/components/design-mode/DesignModeProvider.tsx

### 2) overlay + editor
- src/components/design-mode/DesignModeOverlay.tsx

### 3) save menu
- src/components/design-mode/DesignModeSaveMenu.tsx

### 4) utilities
- src/lib/designOverrides.ts

### 5) integration
- src/App.tsx: להקיף את האפליקציה ב-DesignModeProvider ולרנדר DesignModeOverlay
- src/components/ThemeManager.tsx: כפתור מצב עיצוב חי
- src/hooks/useTheme.ts: תמיכה ב-elementOverrides ומיזוג overrides
- src/hooks/useCloudPreferences.ts: סנכרון custom themes
- src/hooks/useCommunityThemes.ts: publish עם element_overrides

---

## חוזה נתונים (חייב להישמר)

```ts
export type OverrideScope = 'element' | 'class' | 'global';

export interface DesignOverride {
  id: string;
  scope: OverrideScope;
  selector: string;
  label?: string;
  css: Record<string, string>;
  createdAt: number;
}
```

storage keys:
- design_overrides_v1
- design_mode_editor_layout_v1
- design_mode_color_favorites_v1

style ids:
- design-mode-overrides
- design-mode-live-preview

---

## התנהגות מערכת - דרישות פונקציונליות מדויקות

## A) הפעלה וכיבוי
1. URL param designMode=1 מפעיל מצב עיצוב אוטומטית.
2. בעת enabled=true, ודא שה-URL כולל designMode=1.
3. Esc סוגר editor ואם אין editor פעיל - מכבה מצב עיצוב.

## B) לכידת אירועים
1. mousemove: עדכון hover box + label.
2. pointerdown: בחירת אלמנט.
3. mousedown/click בזמן מצב עיצוב: preventDefault + stopPropagation.
4. אל תתפוס אירועים שמגיעים מ-UI פנימי של המערכת (data-design-mode-ui).

## C) Live preview
1. לשמור ערכים ב-liveChanges.
2. לעדכן style זמני לפי computeClassSelector(selectedEl).
3. clear style זמני כשה-editor נסגר או אחרי applyScope.

## D) שדות עריכה בעורך
- color
- background-color
- border-color
- font-size
- font-weight
- border-radius
- padding

כולל EyeDropper API עם error message לדפדפן לא נתמך.

## E) save scopes (חייב להיות זהה)
1. element -> computeSelector
2. class -> computeClassSelector
3. global -> כרגע זהה ל-class (שומר selector, לא token mapping)

הערה חשובה:
אם המטרה היא שכפול 1:1, אל תשנה את global ל-token edit אמיתי.

## F) color favorites
1. לשמור צבעים עד 12.
2. להוסיף auto-save של צבעים בעת applyScope.
3. לתמוך delete mode + multi-select delete.

## G) toolbar עליון
- title מצב עיצוב חי
- undo
- collapse
- counter שינויים
- clear all (עם confirm)
- save menu
- exit

## H) save menu לערכות נושא
חייב לכלול:
1. Save
   - overwrite active custom theme
   - built-in/community -> redirect ל-Save As New
2. Save As New
3. Publish (admin only)

בכל save:
- להכניס elementOverrides לתוך theme
- לשמור custom themes local
- לסנכרן custom_themes לענן
- clearAll overrides local

---

## פונקציות חובה (Implementation Checklist)

## designOverrides.ts
- computeSelector
- computeClassSelector
- describeElement
- loadOverrides
- saveOverrides
- applyOverridesToDom
- initDesignOverrides

## DesignModeProvider
- setEnabled
- addOverride
- undoLast
- clearAll

## DesignModeOverlay
- loadEditorLayout / saveEditorLayout
- loadColorFavorites / pushColorFavorite
- applyScope
- saveCurrentColorsToFavorites
- deleteFavorite / deleteSelectedFavorites
- handleEyeDropper
- closeEditor

## DesignModeSaveMenu
- handleSave
- handleSaveAsNew
- handlePublish
- syncCustomToCloud

---

## acceptance tests (must pass)

1. toolbar מופיע ב-route עם designMode=1.
2. click על אלמנט פותח editor.
3. click לא מפעיל ניווט underlying בזמן mode פעיל.
4. reload עם designMode=1 שומר מצב פעיל.
5. apply element/class/global מוסיף override persist.
6. clear all מנקה style ו-storage.
7. save as new יוצר ערכה חדשה עם elementOverrides.
8. publish זמין רק לאדמין.

Reference:
- e2e/design-mode.spec.ts

---

## סדר עבודה מומלץ לביצוע בפרויקט חדש

1. ליישם utility של overrides + style injection.
2. לבנות provider context.
3. לשלב provider+overlay ב-App root.
4. לבנות overlay events + hover + selection.
5. לבנות editor panel + live preview.
6. לממש apply scope + persist.
7. לבנות toolbar.
8. לחבר save menu לערכות נושא.
9. לחבר sync לענן.
10. להוסיף E2E tests.

---

## pitfalls שחייבים למנוע

1. בחירת אלמנט על click במקום pointerdown - עלול לאבד שליטה ל-onClick של האפליקציה.
2. שימוש בסלקטור לא יציב - overrides ישברו.
3. חוסר הפרדה בין live preview ל-persisted overrides.
4. שמירת custom themes בלי cloud sync.
5. clearAll שלא מסיר style tag בפועל.

---

## output format when using this skill

When you finish an implementation task with this skill, report:
1. Files created/updated.
2. Exactly which behaviors were implemented.
3. Which save modes are supported.
4. Which persistence layers are connected (local, cloud, community).
5. Which tests were added/run and their result.
