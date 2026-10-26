import { useCallback, useMemo, useState } from "react";
import { BookOpen, ChevronDown, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  countAllGuides,
  countSeenGuides,
  guidesByPage,
  isGuideDisabledEverywhere,
  resetAllGuides,
  resetPageGuides,
  setGuidesDisabledEverywhere,
  unmarkGuideSeen,
} from "@/lib/tabGuides";
import { GuideDemo, DEMO_STYLES } from "@/components/guide/GuideDemo";
import { readGuideDemoPrefs, writeGuideDemoPrefs, type GuideDemoPrefs } from "@/lib/guideDemoPrefs";

/**
 * שליטה במסכי ההדרכה שנפתחים בכניסה לכל לשונית.
 *
 * שתי החלטות שלא מובנות מאליהן:
 *
 *  1. **מתג אחד, לא מתג לכל מסך.** יש כאן עשרות הדרכות. מתג לכל
 *     אחת היה הופך את המסך לרשימה בלתי קריאה, ואף אחד לא באמת
 *     רוצה לכבות הדרכה אחת מתוך שלושים ושש. מה שכן צריך זה לכבות
 *     הכול, או להחזיר הכול.
 *
 *  2. **"הצג מחדש" גם מדליק את המתג.** אם ההדרכות כבויות ומישהו
 *     מבקש להציג אותן שוב, הבקשה הזאת סותרת את המתג. במקום לבצע
 *     חצי פעולה ולהשאיר את המשתמש תוהה למה כלום לא קורה — הכפתור
 *     מדליק גם את המתג, והכיתוב אומר את זה מראש.
 *
 * הפירוט לפי דף מקופל כברירת מחדל: הוא שימושי למי שרוצה לראות
 * שוב רק מסך אחד, ומיותר לכל השאר.
 */
export function GuideSettings() {
  const { toast } = useToast();

  // המצב נקרא מהזיכרון בכל שינוי, ולא מוחזק כמקור אמת כפול:
  // ההדרכות עצמן כותבות לאותו זיכרון כשסוגרים אותן, ומצב מקומי
  // שלא מתעדכן היה מציג מספר ישן.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const enabled = useMemo(() => !isGuideDisabledEverywhere(), [version]);
  const seen = useMemo(() => countSeenGuides(), [version]);
  const total = useMemo(() => countAllGuides(), []);
  const pages = useMemo(() => guidesByPage(), [version]);

  const [openPages, setOpenPages] = useState(false);

  const toggle = (next: boolean) => {
    setGuidesDisabledEverywhere(!next);
    refresh();
    toast({
      title: next ? "מסכי ההדרכה הופעלו" : "מסכי ההדרכה כובו",
      description: next
        ? "בכניסה ללשונית שעוד לא ראית יוצג מסך הסבר."
        : "לא יוצג יותר אף מסך הסבר, גם בלשוניות חדשות.",
    });
  };

  const resetEverything = () => {
    resetAllGuides();
    refresh();
    toast({
      title: "כל מסכי ההדרכה יוצגו מחדש",
      description: `${total} מסכים חזרו למצב "עוד לא נראה".`,
    });
  };

  const resetOnePage = (pageId: string, label: string) => {
    resetPageGuides(pageId);
    // דף שמאופס בזמן שההדרכות כבויות לא היה מוצג בכל זאת.
    setGuidesDisabledEverywhere(false);
    refresh();
    toast({ title: `ההדרכות של ${label} יוצגו מחדש` });
  };

  // סגנון ההמחשות. נשמר מקומית — זאת העדפת תצוגה אישית למסך,
  // ואדם שעובד על מסך קטן יבחר אחרת מאדם שעובד על מסך גדול.
  const [demoPrefs, setDemoPrefs] = useState<GuideDemoPrefs>(readGuideDemoPrefs);
  const saveDemos = useCallback((next: GuideDemoPrefs) => {
    setDemoPrefs(next);
    writeGuideDemoPrefs(next);
  }, []);

  return (
    <div className="space-y-6" dir="rtl">

      {/* ------------------------------------------- המתג הראשי */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="guides-enabled" className="text-base font-medium">
            הצג מסכי הדרכה
          </Label>
          <p className="text-sm text-muted-foreground">
            בכניסה ראשונה ללשונית נפתח מסך שמסביר מה יש בה. בכל מסך אפשר
            לדלג, או לבחור שלא יוצג שוב.
          </p>
        </div>
        <Switch
          id="guides-enabled"
          checked={enabled}
          onCheckedChange={toggle}
          aria-label="הצגת מסכי הדרכה"
        />
      </div>

      {/* --------------------------------------- סגנון ההמחשות */}
      <div className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="demos-enabled" className="text-base font-medium">
              המחשות מונפשות
            </Label>
            <p className="text-sm text-muted-foreground">
              לחלק מהפעולות נוספת המחשה קטנה שמראה את התנועה. מילים טובות
              להגדרה ורעות לתנועה — קשה לדמיין גרירה שלא ראית.
            </p>
          </div>
          <Switch
            id="demos-enabled"
            checked={demoPrefs.enabled}
            onCheckedChange={(v) => saveDemos({ ...demoPrefs, enabled: v })}
            aria-label="הצגת המחשות מונפשות"
          />
        </div>

        {demoPrefs.enabled && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DEMO_STYLES.map((s) => {
              const on = demoPrefs.style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => saveDemos({ ...demoPrefs, style: s.id })}
                  aria-pressed={on}
                  className={[
                    "rounded-lg border p-3 text-right transition-colors",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                       : "border-border/60 hover:border-primary/40",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {on && <Check className="h-3.5 w-3.5 text-primary" />}
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">{s.note}</p>
                  {/* שתי המחשות שונות, כדי שההבדל בין הסגנונות ייראה
                      על יותר מצורה אחת. */}
                  <div className="grid grid-cols-2 gap-2">
                    <GuideDemo kind="drag" style={s.id} className="h-16 w-full" />
                    <GuideDemo kind="record" style={s.id} className="h-16 w-full" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          מי שביקש במערכת ההפעלה פחות תנועה יראה את ההמחשות קפואות, גם
          כשהן דלוקות כאן.
        </p>
      </div>

      {/* ------------------------------------------------ המצב */}
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              נצפו <strong>{seen}</strong> מתוך <strong>{total}</strong> מסכים
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetEverything}
            disabled={seen === 0 && enabled}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            הצג את כולם מחדש
          </Button>
        </div>

        {/* מד התקדמות — נותן תחושה מיידית בלי לקרוא מספרים. */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${total ? (seen / total) * 100 : 0}%` }}
          />
        </div>

        {!enabled && (
          <p className="mt-3 text-xs text-muted-foreground">
            המסכים כבויים כרגע. לחיצה על "הצג את כולם מחדש" תדליק אותם שוב.
          </p>
        )}
      </div>

      {/* -------------------------------------- פירוט לפי דף */}
      <div className="rounded-lg border">
        <button
          type="button"
          onClick={() => setOpenPages((o) => !o)}
          aria-expanded={openPages}
          className="flex w-full items-center justify-between gap-2 p-4 text-right"
        >
          <span className="text-sm font-medium">הצגה מחדש של דף מסוים</span>
          <ChevronDown
            className={[
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[167ms]",
              openPages ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden
          />
        </button>

        {openPages && (
          <div className="space-y-1 border-t p-2">
            {pages.map((page) => (
              <div
                key={page.pageId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  {page.seen === page.guides.length && page.guides.length > 0 && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
                  )}
                  <span className="truncate">{page.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {page.seen}/{page.guides.length}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  disabled={page.seen === 0}
                  onClick={() => resetOnePage(page.pageId, page.label)}
                >
                  הצג שוב
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** מיוצא לשימוש חיצוני, כדי שאפשר יהיה לאפס הדרכה בודדת. */
export { unmarkGuideSeen };
