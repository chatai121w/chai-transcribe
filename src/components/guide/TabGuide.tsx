import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  markGuideSeen, setGuidesDisabledEverywhere, type TabGuide as TabGuideData,
} from '@/lib/tabGuides';
import { GuideDemo } from "@/components/guide/GuideDemo";
import { readGuideDemoPrefs } from "@/lib/guideDemoPrefs";

interface Props {
  guide: TabGuideData;
  open: boolean;
  /** נקרא בסגירה, עם הסיבה. */
  onClose: () => void;
}

/** כמה זמן מחכים בין כרטיס לכרטיס בהופעה, באלפיות שנייה. */
const STAGGER_MS = 45;

/**
 * מסך ההדרכה שנפתח בכניסה לטאב.
 *
 * העיצוב נגזר מכללי התנועה של המערכת: הופעה של 167 אלפיות, בלי
 * הגדלה או הרמה בריחוף, וקווים דקים של פיקסל אחד במקום מסגרות עבות.
 * אנימציה ארוכה או קופצנית נראית זולה, והמסך הזה נפתח הרבה.
 *
 * הכרטיסים נכנסים בזה אחר זה בהפרש קצר. ההשהיה אינה קישוט: היא
 * מובילה את העין משמאל לימין ומלמעלה למטה, כך שהמשתמש קורא לפי
 * הסדר במקום לסרוק מסך שלם בבת אחת.
 *
 * שתי הגנות שחייבות להיות כאן:
 *
 *  1. **כיבוד העדפת תנועה מופחתת.** למשתמש שהגדיר במערכת שלא רוצה
 *     אנימציות, התנועה גורמת אי-נוחות ממשית. במצב הזה הכל מופיע מיד.
 *
 *  2. **מקש הבריחה סוגר.** מסך שחוסם את המסך בלי דרך יציאה מהמקלדת
 *     הוא מלכודת.
 */
export default function TabGuide({ guide, open, onClose }: Props) {
  const [dontShow, setDontShow] = useState(false);
  const [disableAll, setDisableAll] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // העדפת ההמחשות נקראת פעם אחת. היא אינה משתנה תוך כדי צפייה
  // בהדרכה, ואין טעם לקרוא אותה בכל רינדור.
  const [demoPrefs] = useState(readGuideDemoPrefs);

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const finish = useCallback((remember: boolean) => {
    if (remember || dontShow) markGuideSeen(guide.id);
    if (disableAll) setGuidesDisabledEverywhere(true);
    onClose();
  }, [dontShow, disableAll, guide.id, onClose]);

  // מקש הבריחה סוגר, ומוקד המקלדת עובר לכפתור הסגירה.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [open, finish]);

  // כשהמסך פתוח, הדף שמאחוריו אינו נגלל.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setDontShow(false);
      setDisableAll(false);
    }
  }, [open, guide.id]);

  if (!open) return null;

  const anim = (name: string, index = 0) =>
    reduceMotion
      ? undefined
      : { animation: `${name} 167ms cubic-bezier(0.16, 1, 0.3, 1) both`,
          animationDelay: `${index * STAGGER_MS}ms` };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* הרקע. טשטוש עדין ולא כהה מדי — המסך שמאחור עדיין מזוהה,
          וזה מרגיע: המשתמש יודע איפה הוא. */}
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]"
        style={reduceMotion ? undefined : { animation: 'guide-backdrop 167ms ease-out both' }}
        onClick={() => finish(false)}
        aria-hidden
      />

      <div
        ref={panelRef}
        style={anim('guide-panel')}
        className={[
          'relative w-full max-w-3xl max-h-[88vh] overflow-hidden',
          'flex flex-col rounded-2xl bg-card',
          // קו דק של פיקסל אחד, וצל בשתי שכבות חלשות. צל יחיד וכהה
          // נראה זול; שתי שכבות חלשות נותנות עומק בלי כובד.
          'border border-border/60',
          'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-8px_rgba(0,0,0,0.10)]',
        ].join(' ')}
      >
        {/* כותרת */}
        <div className="flex items-start gap-3 border-b border-border/50 p-5 pb-4">
          {/* ריבוע פסטלי בצבע ההדגשה, עם האייקון בצבע מלא. */}
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent"
            aria-hidden
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            {/* משקל 600 ולא 700, ובלי ריווח בין אותיות — עברית
                מודגשת מדי נראית צועקת. */}
            <h2 id="guide-title" className="text-lg font-semibold leading-tight">
              {guide.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{guide.subtitle}</p>
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            onClick={() => finish(false)}
            aria-label="סגור"
            className="h-8 w-8 shrink-0 cursor-default"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* האפשרויות */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {guide.items.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  style={anim('guide-card', i + 1)}
                  className={[
                    'rounded-xl border border-border/50 bg-background/60 p-4',
                    // בלי הרמה או הגדלה בריחוף — רק שינוי קו וגוון.
                    'transition-colors duration-[83ms] hover:border-accent/40 hover:bg-accent/[0.04]',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold leading-snug">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                      {/* ההמחשה אחרי הטקסט ולא לפניו: היא מראה את מה
                          שהטקסט הסביר, ולא מחליפה אותו. מי שקרא
                          והבין פשוט ממשיך הלאה. */}
                      {item.demo && demoPrefs.enabled && (
                        <GuideDemo
                          kind={item.demo}
                          style={demoPrefs.style}
                          className="mt-2 h-20 w-full"
                        />
                      )}
                      {item.tip && (
                        <p className="mt-2 border-r-2 border-accent/30 pr-2 text-xs leading-relaxed text-muted-foreground">
                          {item.tip}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {guide.startHere && (
            <div
              style={anim('guide-card', guide.items.length + 1)}
              className="mt-4 flex items-start gap-2.5 rounded-xl bg-accent/[0.07] p-4"
            >
              <ArrowLeft className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p className="text-sm leading-relaxed">
                <span className="font-semibold">מאיפה מתחילים: </span>
                {guide.startHere}
              </p>
            </div>
          )}
        </div>

        {/* תחתית. הרצועה קיימת תמיד ובגובה קבוע, כדי שהמסך לא יקפוץ. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-muted/30 px-5 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <label className="flex cursor-default items-center gap-2 text-sm">
              <Checkbox
                checked={dontShow}
                onCheckedChange={(v) => setDontShow(v === true)}
                aria-label="אל תציג את ההדרכה הזאת שוב"
              />
              <span>אל תציג שוב בטאב הזה</span>
            </label>
            <label className="flex cursor-default items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={disableAll}
                onCheckedChange={(v) => setDisableAll(v === true)}
                aria-label="בטל את כל ההדרכות"
              />
              <span>בכל הטאבים</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            {/* דילוג סוגר להפעם ומשאיר את ההדרכה לפעם הבאה. */}
            <Button variant="ghost" onClick={() => finish(false)} className="h-8 cursor-default">
              דלג
            </Button>
            <Button onClick={() => finish(true)} className="h-8 cursor-default">
              הבנתי, בוא נתחיל
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
