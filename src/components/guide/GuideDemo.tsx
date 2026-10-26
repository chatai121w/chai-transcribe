import { Fragment, useEffect, useRef, useState } from "react";

/**
 * המחשות מונפשות להדרכה.
 *
 * למה זה נבנה: ההדרכה הקיימת מסבירה כל יכולת במילים. מילים טובות
 * להגדרה ורעות לתנועה — "גרור את הידית כדי לשנות סדר" דורש מהקורא
 * לדמיין פעולה, וזה בדיוק מה שהוא לא יודע לעשות אם הוא לא ראה.
 *
 * שלוש החלטות שקבעו את המימוש
 * ----------------------------
 * אנימציה מצוירת, לא סרטון. סרטון או תמונה נעה שוקלים מאות
 * קילובייטים לכל המחשה, מתיישנים ברגע שהממשק משתנה, ואינם
 * מתאימים את עצמם לערכת הצבעים. כאן הכול צורות פשוטות בצבעי
 * המערכת, ששוקלות אפס ומתעדכנות מעצמן.
 *
 * ההמחשה רצה רק כשרואים אותה. אנימציה אינסופית בכרטיס שגולל
 * מחוץ למסך צורכת חישוב בלי שאיש מרוויח. כאן היא נעצרת מעצמה.
 *
 * תנועה מופחתת מכובדת. מי שביקש במערכת ההפעלה פחות תנועה מקבל
 * תמונה קפואה במצב הסופי — לא ריק, ולא תנועה שהוא ביקש להימנע
 * ממנה. ההדרכה הקיימת כבר בודקת את זה, וכאן אותה בדיקה בדיוק.
 */

/** סוגי ההמחשה. כל אחד מתאר פעולה אחת שהמשתמש יעשה בפועל. */
export type DemoKind =
  | "click" | "drag" | "type" | "upload"
  | "record" | "play" | "lock" | "compare" | "speakers";

/** שני סגנונות, לבחירת המשתמש. */
export type DemoStyle = "quiet" | "lively";

export const DEMO_STYLES: { id: DemoStyle; label: string; note: string }[] = [
  { id: "quiet", label: "שקט", note: "תנועה עדינה בגווני רקע. לא מושך את העין מהטקסט." },
  { id: "lively", label: "חי", note: "תנועה ברורה בצבעי הדגשה. קל יותר לקלוט מה קורה." },
];

export const DEMO_LABELS: Record<DemoKind, string> = {
  click: "לחיצה על כפתור",
  drag: "גרירה לשינוי סדר",
  type: "הקלדה",
  upload: "העלאת קובץ",
  record: "הקלטה",
  play: "נגינה מסונכרנת",
  lock: "נעילת צד",
  compare: "השוואה",
  speakers: "זיהוי דוברים",
};

const CSS = `
.gd { position: relative; overflow: hidden; border-radius: 0.5rem; }
.gd * { box-sizing: border-box; }
.gd-s { --gd-ink: hsl(var(--muted-foreground)); --gd-hi: hsl(var(--muted-foreground)); --gd-bg: hsl(var(--muted) / 0.45); --gd-op: 0.55; }
.gd-l { --gd-ink: hsl(var(--foreground)); --gd-hi: hsl(var(--primary)); --gd-bg: hsl(var(--primary) / 0.07); --gd-op: 1; }
.gd { background: var(--gd-bg); }
.gd-box { position: absolute; border-radius: 3px; background: var(--gd-ink); opacity: var(--gd-op); }
.gd-hi { background: var(--gd-hi); }
.gd-ptr { position: absolute; width: 9px; height: 9px; border-radius: 50%;
  border: 1.5px solid var(--gd-hi); background: hsl(var(--background)); }
.gd-still .gd-anim { animation: none !important; }

/* לחיצה — הסמן ניגש, הכפתור נלחץ */
.gd-click .b { left: 30%; top: 36%; width: 40%; height: 28%; border-radius: 4px; }
.gd-click .gd-anim.b { animation: gdPress 1.9s ease-in-out infinite; }
.gd-click .gd-anim.p { animation: gdTap 1.9s ease-in-out infinite; }
@keyframes gdPress { 0%,42% { transform: scale(1); } 50% { transform: scale(0.9); } 58%,100% { transform: scale(1); } }
@keyframes gdTap { 0% { left: 74%; top: 74%; } 40%,56% { left: 50%; top: 50%; } 100% { left: 74%; top: 74%; } }

/* גרירה — פריט עולה ברשימה והסמן איתו */
.gd-drag .r { left: 18%; width: 64%; height: 14%; }
.gd-drag .r1 { top: 18%; } .gd-drag .r2 { top: 40%; } .gd-drag .r3 { top: 62%; }
.gd-drag .gd-anim.m { animation: gdLift 2.4s ease-in-out infinite; }
.gd-drag .gd-anim.p { animation: gdLiftP 2.4s ease-in-out infinite; }
@keyframes gdLift { 0%,12% { top: 62%; } 55%,100% { top: 18%; } }
@keyframes gdLiftP { 0%,12% { top: 66%; left: 24%; } 55%,100% { top: 22%; left: 24%; } }

/* הקלדה — קו טקסט שגדל וסמן מהבהב */
.gd-type .ln { left: 16%; top: 44%; height: 10%; }
.gd-type .gd-anim.ln { animation: gdGrow 2.6s steps(14) infinite; }
.gd-type .gd-anim.cr { animation: gdCaret 0.9s steps(1) infinite, gdCaretX 2.6s steps(14) infinite; }
.gd-type .cr { top: 42%; height: 14%; width: 1.5px; }
@keyframes gdGrow { 0% { width: 0; } 80%,100% { width: 58%; } }
@keyframes gdCaretX { 0% { left: 16%; } 80%,100% { left: 75%; } }
@keyframes gdCaret { 0%,49% { opacity: var(--gd-op); } 50%,100% { opacity: 0.15; } }

/* העלאה — קובץ נופל לאזור */
.gd-upload .z { left: 22%; top: 46%; width: 56%; height: 34%; background: none;
  border: 1.5px dashed var(--gd-hi); opacity: var(--gd-op); border-radius: 5px; }
.gd-upload .f { left: 44%; width: 12%; height: 18%; border-radius: 2px; }
.gd-upload .gd-anim.f { animation: gdFall 2.1s ease-in infinite; }
@keyframes gdFall { 0% { top: -20%; opacity: 0; } 18% { opacity: var(--gd-op); } 62% { top: 54%; } 70% { top: 50%; } 78%,100% { top: 54%; opacity: 0; } }

/* הקלטה — נקודה עם טבעות מתפשטות */
.gd-record .dot { left: 46%; top: 42%; width: 8%; height: 16%; border-radius: 50%; }
.gd-record .ring { left: 50%; top: 50%; width: 10%; height: 20%; border-radius: 50%;
  background: none; border: 1.5px solid var(--gd-hi); transform: translate(-50%,-50%); }
.gd-record .gd-anim.ring { animation: gdRing 2s ease-out infinite; }
.gd-record .gd-anim.ring2 { animation-delay: 0.66s; }
.gd-record .gd-anim.ring3 { animation-delay: 1.32s; }
@keyframes gdRing { 0% { transform: translate(-50%,-50%) scale(1); opacity: var(--gd-op); } 100% { transform: translate(-50%,-50%) scale(3.4); opacity: 0; } }

/* נגינה — עמודות גל וקו מתנגן שעובר */
.gd-play .w { width: 4%; border-radius: 1px; bottom: 28%; }
.gd-play .ph { top: 22%; height: 56%; width: 1.5px; }
.gd-play .gd-anim.ph { animation: gdSweep 3s linear infinite; }
@keyframes gdSweep { 0% { left: 14%; } 100% { left: 84%; } }

/* נעילה — צד קופא, בשני מופיעות נקודות */
.gd-lock .pane { top: 18%; width: 34%; height: 64%; background: none;
  border: 1.5px solid var(--gd-ink); opacity: var(--gd-op); border-radius: 4px; }
.gd-lock .pl { left: 10%; } .gd-lock .pr { left: 56%; }
.gd-lock .ld { left: 14%; width: 26%; height: 7%; }
.gd-lock .rd { left: 63%; width: 22%; height: 7%; }
.gd-lock .mk { left: 58%; width: 3%; height: 7%; border-radius: 50%; }
.gd-lock .gd-anim.mk { animation: gdDot 2.4s ease-in-out infinite; }
@keyframes gdDot { 0%,30% { opacity: 0; transform: scale(0.4); } 45%,88% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.4); } }

/* השוואה — שורה מודגשת בשני הצדדים */
.gd-compare .c { top: 20%; width: 34%; height: 60%; background: none;
  border: 1.5px solid var(--gd-ink); opacity: var(--gd-op); border-radius: 4px; }
.gd-compare .cl { left: 10%; } .gd-compare .cr2 { left: 56%; }
.gd-compare .rw { width: 26%; height: 7%; }
.gd-compare .gd-anim.fl { animation: gdFlash 2.2s ease-in-out infinite; }
@keyframes gdFlash { 0%,25% { opacity: 0.2; } 45%,75% { opacity: 1; } 100% { opacity: 0.2; } }

/* דוברים — פסים שמתחלפים בין שני גבהים */
.gd-speakers .sp { height: 12%; border-radius: 2px; }
.gd-speakers .gd-anim.s1 { animation: gdSpk 3s steps(1) infinite; }
.gd-speakers .gd-anim.s2 { animation: gdSpk 3s steps(1) infinite; animation-delay: 1s; }
.gd-speakers .gd-anim.s3 { animation: gdSpk 3s steps(1) infinite; animation-delay: 2s; }
@keyframes gdSpk { 0%,32% { opacity: 1; } 33%,100% { opacity: 0.22; } }
`;

let injected = false;
function useStyles() {
  useEffect(() => {
    if (injected || typeof document === "undefined") return;
    const el = document.createElement("style");
    el.id = "guide-demo-styles";
    el.textContent = CSS;
    document.head.appendChild(el);
    injected = true;
  }, []);
}

/** האם המשתמש ביקש פחות תנועה. אותה בדיקה כמו בהדרכה עצמה. */
function prefersStill(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** התוכן של כל המחשה. מופרד מהעטיפה כדי שהעטיפה תישאר אחת. */
function Shapes({ kind }: { kind: DemoKind }) {
  const a = "gd-box gd-anim";
  switch (kind) {
    case "click":
      return (<>
        <i className={`${a} gd-hi b`} /><i className={`gd-ptr gd-anim p`} />
      </>);
    case "drag":
      return (<>
        <i className="gd-box r r1" /><i className="gd-box r r2" />
        <i className={`${a} gd-hi r m`} style={{ left: "18%", width: "64%", height: "14%" }} />
        <i className="gd-ptr gd-anim p" />
      </>);
    case "type":
      return (<>
        <i className={`${a} gd-hi ln`} /><i className={`${a} cr`} />
      </>);
    case "upload":
      return (<>
        <i className="gd-box z" /><i className={`${a} gd-hi f`} />
      </>);
    case "record":
      return (<>
        <i className="gd-box gd-hi dot" />
        <i className={`${a} ring`} /><i className={`${a} ring ring2`} /><i className={`${a} ring ring3`} />
      </>);
    case "play":
      return (<>
        {[14, 24, 34, 44, 54, 64, 74, 84].map((l, i) => (
          <i key={l} className="gd-box w" style={{ left: `${l}%`, height: `${18 + ((i * 37) % 34)}%` }} />
        ))}
        <i className={`${a} gd-hi ph`} />
      </>);
    case "lock":
      return (<>
        <i className="gd-box pane pl" /><i className="gd-box pane pr" />
        {[26, 40, 54, 68].map((t) => <i key={t} className="gd-box ld" style={{ top: `${t}%` }} />)}
        {[26, 40, 54, 68].map((t) => <i key={t} className="gd-box rd" style={{ top: `${t}%` }} />)}
        {[40, 54].map((t) => <i key={t} className={`${a} gd-hi mk`} style={{ top: `${t}%` }} />)}
      </>);
    case "compare":
      return (<>
        <i className="gd-box c cl" /><i className="gd-box c cr2" />
        {/* Fragment עם מפתח, ולא <> — מעטפת בלי מפתח בתוך רשימה
            מוציאה אזהרה בכל רינדור. */}
        {[28, 42, 56, 70].map((t, i) => (
          <Fragment key={t}>
            <i className={`gd-box rw ${i === 1 ? "gd-hi gd-anim fl" : ""}`} style={{ left: "14%", top: `${t}%` }} />
            <i className={`gd-box rw ${i === 1 ? "gd-hi gd-anim fl" : ""}`} style={{ left: "60%", top: `${t}%` }} />
          </Fragment>
        ))}
      </>);
    case "speakers":
      return (<>
        {[22, 40, 58, 76].map((t, i) => (
          <i key={t} className={`${a} gd-hi sp s${(i % 3) + 1}`}
             style={{ top: `${t}%`, left: `${12 + (i % 2) * 20}%`, width: `${48 - (i % 3) * 8}%` }} />
        ))}
      </>);
  }
}

/**
 * המחשה אחת.
 *
 * `label` מתאר לקורא מסך מה קורה כאן. אנימציה בלי תיאור היא ריבוע
 * ריק למי שאינו רואה אותה.
 */
export function GuideDemo({
  kind, style = "quiet", className = "", label,
}: {
  kind: DemoKind;
  style?: DemoStyle;
  className?: string;
  label?: string;
}) {
  useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const still = prefersStill();

  // רצה רק כשרואים. אנימציה אינסופית בכרטיס שגולל מחוץ למסך
  // צורכת חישוב בלי שאיש מרוויח.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label ?? DEMO_LABELS[kind]}
      className={`gd gd-${kind} ${style === "lively" ? "gd-l" : "gd-s"} ${(!visible || still) ? "gd-still" : ""} ${className}`}
    >
      <Shapes kind={kind} />
    </div>
  );
}

export default GuideDemo;
