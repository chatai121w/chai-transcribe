import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { getTabGuide, shouldShowGuide, type TabGuide as TabGuideData } from '@/lib/tabGuides';
import TabGuideDialog from './TabGuide';

interface GuideContextValue {
  /** מזהה ההדרכה של הטאב הפתוח כרגע, או ריק אם אין. */
  activeGuideId: string;
  openGuide: () => void;
}

const GuideContext = createContext<GuideContextValue>({
  activeGuideId: '',
  openGuide: () => {},
});

interface Props extends React.ComponentPropsWithoutRef<typeof Tabs> {
  /**
   * הקידומת של מזהי ההדרכה. המזהה המלא הוא `${guidePrefix}/${tabValue}`.
   *
   * למשל `voice-studio` עם הטאב `read` נותן `voice-studio/read`.
   */
  guidePrefix: string;
}

/** כמה זמן לחכות אחרי מעבר טאב לפני שההדרכה נפתחת, באלפיות שנייה. */
const OPEN_DELAY_MS = 420;

/**
 * עוטף את רכיב הלשוניות ומוסיף לו הדרכה בכניסה לכל טאב.
 *
 * למה עטיפה ולא הוספה בכל מסך בנפרד: יש במערכת למעלה ממאה טאבים.
 * הוספה ידנית בכל אחד מהם פירושה מאה מקומות שיכולים להישבר, ושכל
 * טאב חדש יישכח. כאן מספיק להחליף את שם הרכיב ולהוסיף שורה אחת
 * במרשם התוכן.
 *
 * שלוש נקודות שלא מובנות מאליהן:
 *
 *  1. **הטאב הפתוח בטעינה אינו מפעיל הדרכה מיד.** מסך שקופץ בשנייה
 *     שבה העמוד נטען מרגיש כתקלה, והמשתמש סוגר אותו ברפלקס. השהיה
 *     קצרה נותנת לעמוד להתייצב, ולמשתמש לראות לאן הגיע.
 *
 *  2. **טאב בלי הדרכה במרשם אינו שובר כלום.** הוא פשוט לא מציג.
 *     כך אפשר להוסיף תוכן בהדרגה בלי לשבור מסכים.
 *
 *  3. **הרכיב עובד גם כשהטאבים נשלטים מבחוץ וגם כשלא.** מסכים
 *     במערכת עושים את זה בשתי הדרכים.
 */
export function GuidedTabs({
  guidePrefix, children, value, defaultValue, onValueChange, ...rest
}: Props) {
  const [internal, setInternal] = useState<string>((defaultValue as string) ?? '');
  const [guide, setGuide] = useState<TabGuideData | null>(null);
  const timerRef = useRef<number | null>(null);

  const controlled = value !== undefined;
  const current = controlled ? (value as string) : internal;
  const activeGuideId = current ? `${guidePrefix}/${current}` : '';

  // פתיחה אוטומטית בכניסה לטאב, רק אם ההדרכה עוד לא נראתה.
  useEffect(() => {
    if (!activeGuideId) return;
    const found = getTabGuide(activeGuideId);
    if (!found || !shouldShowGuide(activeGuideId)) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setGuide(found), OPEN_DELAY_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [activeGuideId]);

  const handleChange = useCallback((next: string) => {
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  }, [controlled, onValueChange]);

  // פתיחה ידנית מהכפתור — מתעלמת מהזיכרון, כי המשתמש ביקש במפורש.
  const openGuide = useCallback(() => {
    const found = getTabGuide(activeGuideId);
    if (found) setGuide(found);
  }, [activeGuideId]);

  const ctx = useMemo(() => ({ activeGuideId, openGuide }), [activeGuideId, openGuide]);

  return (
    <GuideContext.Provider value={ctx}>
      <Tabs {...rest} value={value} defaultValue={defaultValue} onValueChange={handleChange}>
        {children}
      </Tabs>

      {guide && <TabGuideDialog guide={guide} open onClose={() => setGuide(null)} />}
    </GuideContext.Provider>
  );
}

/**
 * כפתור שפותח מחדש את ההדרכה של הטאב הפתוח.
 *
 * בלעדיו "אל תציג שוב" הוא מלכוד: אין דרך חזרה, והמשתמש יחשוש
 * ללחוץ. הכפתור הזה הוא מה שהופך את הביטול להחלטה הפיכה.
 *
 * הוא מסתיר את עצמו בטאב שאין לו הדרכה, במקום להציג כפתור שלא
 * עושה כלום.
 */
export function TabGuideButton({ className }: { className?: string }) {
  const { activeGuideId, openGuide } = useContext(GuideContext);
  if (!activeGuideId || !getTabGuide(activeGuideId)) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={openGuide}
      className={[
        'h-8 gap-1.5 cursor-default text-muted-foreground',
        'transition-colors duration-[83ms] hover:text-foreground',
        className,
      ].filter(Boolean).join(' ')}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      מה אפשר כאן
    </Button>
  );
}
