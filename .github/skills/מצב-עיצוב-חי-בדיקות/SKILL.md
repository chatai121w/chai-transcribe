---
name: מצב-עיצוב-חי-בדיקות
description: "Skill לבדיקת parity מדויק של מערכת Live Design Mode אחרי הטמעה בפרויקט אחר: פונקציונליות, save modes, persistence ו-cloud sync."
---

# Skill: בדיקות Parity למצב עיצוב חי

Use this skill after implementing Live Design Mode in another project, to validate 1:1 parity with the source behavior.

## מטרה
לאשר שהמערכת החדשה תואמת במדויק ליכולות המקור:
- UX
- לוגיקת אירועים
- save scopes
- theme save options
- persistence
- cloud/community integration

## תסריטי בדיקה חובה

## 1) הפעלה
1. פתיחה עם designMode=1 מעלה toolbar.
2. מצב פעיל נשמר אחרי reload כל עוד query param נשאר.

## 2) selection + event blocking
1. hover מציג highlight ותווית.
2. pointerdown בוחר אלמנט ופותח editor.
3. clicks לא מפעילים ניווט underlying בזמן mode.

## 3) live preview
1. שינוי שדה משנה UI מיידית.
2. style זמני מתאפס בסגירה/שמירה.

## 4) scopes
1. element scope נשמר כסלקטור ייחודי.
2. class scope נשמר כ-class signature.
3. global scope מתנהג כמו class scope (parity מדויק).

## 5) editor utilities
1. EyeDropper: עובד בדפדפן תומך.
2. בדפדפן לא תומך מוצגת שגיאה ידידותית.
3. color favorites נשמרים ונטענים.
4. מחיקת מועדפים יחידה ורב-בחירה עובדת.

## 6) toolbar actions
1. Undo מסיר override אחרון.
2. Clear all מוחק הכל אחרי confirm.
3. Exit מכבה מצב עיצוב.

## 7) save menu
1. Save דורס custom active.
2. Save על built-in/community עובר ל-Save As New.
3. Save As New יוצר id חדש ומפעיל theme חדש.
4. Publish זמין רק לאדמין.

## 8) persistence
1. design_overrides_v1 מתעדכן.
2. app_custom_themes מתעדכן.
3. app_theme_id מתעדכן.
4. cloud user_preferences.custom_themes מתעדכן.
5. publish שומר element_overrides בטבלת community.

## תוצאות נדרשות
- כל התסריטים עוברים.
- אין שבירת ניווט/אירועים מחוץ למצב עיצוב.
- אין drift בין UI preview לשמירה בפועל.

## output format when running this skill
1. Passed tests list.
2. Failed tests list with root cause.
3. Suggested fixes mapped by file.
4. Risk level per issue (high/medium/low).
