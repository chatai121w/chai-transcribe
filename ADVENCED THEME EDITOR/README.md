# ADVENCED THEME EDITOR

חבילת עבודה מלאה לשכפול מערכת Live Design Mode לפרויקט אחר, כולל ניתוח עומק, Skills, Checklist ובדיקות Parity.

## מבנה התיקייה

```text
ADVENCED THEME EDITOR/
├─ START-HERE.md
├─ README.md
├─ docs/
│  ├─ LIVE_DESIGN_MODE_SYSTEM_ANALYSIS.md
│  └─ WIDGET_STYLE_ANALYSIS.md
├─ skills/
│  ├─ implementation/
│  │  └─ LIVE_DESIGN_MODE_SKILL.md
│  └─ testing/
│     └─ LIVE_DESIGN_MODE_TESTING_SKILL.md
└─ checklists/
	└─ REPLICATION_CHECKLIST.md
```

## מה נמצא בכל חלק

1. docs
- מסמכי עומק וניתוח פונקציונלי/ויזואלי.

2. skills/implementation
- Skill ראשי להטמעה אחד-לאחד של המערכת.

3. skills/testing
- Skill ייעודי לבדיקות התאמה (Parity) אחרי הטמעה.

4. checklists
- רשימת בקרה מלאה כדי לא לפספס אף פונקציה או Save Mode.

## סדר עבודה מומלץ

1. קרא את START-HERE.md
2. עבור על docs/LIVE_DESIGN_MODE_SYSTEM_ANALYSIS.md
3. עבוד עם skills/implementation/LIVE_DESIGN_MODE_SKILL.md
4. וודא כיסוי מלא עם checklists/REPLICATION_CHECKLIST.md
5. הרץ בדיקות לפי skills/testing/LIVE_DESIGN_MODE_TESTING_SKILL.md

## הערה חשובה לשכפול מדויק

במימוש הנוכחי, Save Scope של global מתנהג כמו class-based selector override (ולא token mutation).
אם המטרה שלך היא זהות מלאה, שמור על ההתנהגות הזו בדיוק.
