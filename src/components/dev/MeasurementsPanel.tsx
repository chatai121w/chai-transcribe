import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getServerUrl, fetchLocalServer } from "@/lib/serverConfig";
import { AlertTriangle, HardDrive, RefreshCw, TrendingUp } from "lucide-react";

/**
 * מסך המדידות — מה נמדד, מתי, ומה היה הטוב ביותר.
 *
 * הוא אינו מודד. המדידה נעשית ב-scripts/regression_check.py, שמנטר
 * את מצב המחשב ושומר רשימת חבילות; כאן רק מוצג מה שכבר נמדד.
 *
 * שלושה עקרונות שקבעו את המראה, וכולם מתוך פרקטיקה מקצועית
 * מתועדת ולא מתוך טעם אישי:
 *
 *   השיא תמיד מצויר. ההשוואה למדידה הקודמת היא המלכודת הנפוצה
 *   ביותר: אם היינו ב-60, ירדנו ל-50 והגענו ל-55 — הקודמת מראה
 *   שיפור בעוד שבפועל אנחנו מתחת למה שכבר הושג. קו השיא על הגרף
 *   הופך את זה לגלוי בלי שצריך לחשב.
 *
 *   קבוצות שאסור להשוות ביניהן מופרדות פיזית. מדידה על 349 מילים
 *   ומדידה על 114 אינן ניתנות להשוואה, וגם שתי מדידות על אותם
 *   349 אם טקסטי ההפניה או כלל הנרמול שונים. הצגתן על אותו גרף
 *   הייתה מזמינה את הטעות.
 *
 *   נושא שלא נמדד נאמר במפורש. לוח שמראה רק את מה שנמדד יוצר
 *   רושם שהכול מכוסה.
 *
 * ומה שאין כאן בכוונה: מחוגים, אדום-ירוק, וחץ "שיפור" לצד מספר.
 * מדד אדום-ירוק מגיב לרעש ומדווח אזעקה על תנודה שגרתית.
 */

type Row = {
  label: string;
  stamp: string;
  correct: number | null;
  words: number | null;
  percent: number | null;
  topic?: string;
  benchmark?: string | null;
  normalisation?: string | null;
  model?: string;
  machine_verdict?: string | null;
  git?: { commit?: string; dirty?: boolean } | null;
};

type Group = {
  words: number | null;
  benchmark: string | null;
  normalisation: string | null;
  benchmarkKnown: boolean;
  best: { label: string; stamp: string; correct: number; percent: number };
  rows: Row[];
};

type Topic = {
  key: string;
  label: string;
  count: number;
  latest: Row | null;
  groups: Group[];
};

type Lesson = {
  label: string; stamp: string; hypothesis?: string;
  change?: string; outcome?: string; lesson?: string; verdict?: string;
};

type Payload = {
  topics: Topic[];
  notMeasured: { key: string; label: string }[];
  lessons: Lesson[];
  howToMeasure: string;
};

const shortDate = (s: string) => (s || "").slice(5, 16);

/**
 * טווח ציר ה-Y נגזר מרוחב הפיזור, לא מהנתונים.
 *
 * ציר שנצמד לנתונים הופך תנודה של חצי נקודה להר, וציר שמתחיל
 * באפס מרדד כל שינוי אמיתי לקו שטוח. שניהם מטעים, רק לכיוונים
 * הפוכים. לכן הטווח הוא לפחות פי שלושה מרוחב הפיזור בפועל,
 * ולעולם לא פחות משש נקודות.
 */
function yRange(values: number[]): [number, number] {
  if (!values.length) return [0, 100];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max((hi - lo) * 3, 6);
  const mid = (hi + lo) / 2;
  return [
    Math.max(0, Math.round(mid - span / 2)),
    Math.min(100, Math.round(mid + span / 2)),
  ];
}

function GroupChart({ group }: { group: Group }) {
  const data = group.rows
    .filter((r) => r.percent != null)
    .map((r) => ({
      name: r.label,
      when: shortDate(r.stamp),
      ערך: r.percent as number,
      correct: r.correct,
      loaded: r.machine_verdict === "תחת עומס",
    }));
  const [lo, hi] = yRange(data.map((d) => d.ערך));
  const best = group.best?.percent ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">{group.words} מילים</Badge>
        <Badge variant="outline">
          טקסטי הפניה: {group.benchmarkKnown ? group.benchmark : "לא נרשמו"}
        </Badge>
        <Badge variant="outline">
          כלל נרמול: {group.normalisation ?? "לא נרשם"}
        </Badge>
        <span className="text-muted-foreground">
          {data.length === 1 ? "מדידה אחת" : `${data.length} מדידות`}
        </span>
      </div>

      <div className="h-44 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="when" tick={{ fontSize: 10 }} />
            <YAxis domain={[lo, hi]} tick={{ fontSize: 10 }} width={34} />
            <Tooltip
              formatter={(v: number) => [`${v} מתוך 100`, "נכונות"]}
              labelFormatter={(l) => `נמדד ב-${l}`}
            />
            {best != null && (
              <ReferenceLine
                y={best}
                stroke="hsl(var(--primary))"
                strokeDasharray="6 3"
                label={{ value: `השיא ${Math.round(best)}`, position: "insideTopLeft", fontSize: 10 }}
              />
            )}
            <Line
              type="monotone" dataKey="ערך"
              stroke="hsl(var(--foreground))" strokeWidth={2}
              dot={{ r: 3 }} isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* בלי המשפט הזה אי אפשר לדעת אם הציר חתוך, וקו שטוח נראה
          כיציבות גם כשהוא בכלל קפיצה גדולה. */}
      <p className="text-[11px] text-muted-foreground">
        ציר האחוזים מוצג בטווח {lo} עד {hi} ואינו מתחיל באפס. הקו המקווקו
        הוא השיא ההיסטורי של הקבוצה הזאת — לא המדידה הקודמת.
      </p>

      <div className="space-y-1">
        {group.rows.slice().reverse().map((r) => {
          const isBest = r.label === group.best?.label;
          return (
            <div key={r.label + r.stamp}
                 className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
              <span className="flex items-center gap-2 truncate">
                <span className="truncate font-medium">{r.label}</span>
                {isBest && <Badge className="shrink-0">השיא</Badge>}
                {r.machine_verdict === "תחת עומס" && (
                  <Badge variant="outline" className="shrink-0 gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    נמדד תחת עומס
                  </Badge>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.correct} מתוך {r.words} = {Math.round(r.percent ?? 0)} מ-100
                <span className="mx-1">·</span>
                {shortDate(r.stamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Memory = {
  gpu: { used: number; total: number } | null;
  transcriptionModels: string[];
  transcriptionTtlMinutes: number;
  ttsLoaded: boolean;
  ttsIdleSeconds: number | null;
  ttsTtlMinutes: number;
};

const minutes = (s: number | null) =>
  s == null ? "" : s < 60 ? "פחות מדקה" : `${Math.round(s / 60)} דקות`;

/**
 * מה טעון עכשיו, וכפתור לשחרר.
 *
 * נבנה אחרי שביום אחד נתקלנו שלוש פעמים בכרטיס מסך מלא בלי לדעת
 * מי מחזיק אותו: מדידה שקרסה מחוסר זיכרון, תהליך שהחזיק שלושה
 * ג'יגה אחרי שמת, ומודל שפה חיצוני שתפס חמישה וחצי.
 *
 * השחרור קורה גם לבד — מודלי תמלול אחרי חצי שעה, מנוע ההקראה
 * אחרי שעה. הכפתור כאן נועד לרגע שבו צריך את הזיכרון *עכשיו*,
 * ואין כוונה לחכות.
 */
function MemoryPanel() {
  const [mem, setMem] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const r = await fetchLocalServer(`${getServerUrl()}/memory`);
      if (!r.ok) return setMem(null);
      const j = await r.json();
      // שרת ישן אינו מכיר את הפעולה הזאת ויחזיר משהו אחר לגמרי.
      // בלי הבדיקה הזאת הרכיב קורס ולוקח איתו את כל הטאב — ואז
      // גם המדידות, שאין להן שום קשר, נעלמות מהמסך.
      if (!j || !Array.isArray(j.transcriptionModels)) return setMem(null);
      setMem(j as Memory);
    } catch {
      setMem(null);
    }
  }, []);

  useEffect(() => { void read(); }, [read]);

  const release = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetchLocalServer(`${getServerUrl()}/unload-models`, { method: "POST" });
      const j = await r.json();
      // המספרים שחוזרים הם מה שבאמת שוחרר, לא מה שביקשנו לשחרר.
      const parts = [`${j.unloaded ?? 0} מודלי תמלול`];
      if (j.ttsReleased) parts.push("מנוע ההקראה");
      setNote(`שוחררו: ${parts.join(" ו")}`);
      await read();
    } catch {
      setNote("השחרור נכשל — שרת התמלול אינו פועל");
    } finally {
      setBusy(false);
    }
  }, [read]);

  if (!mem) return null;
  const nothing = mem.transcriptionModels.length === 0 && !mem.ttsLoaded;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="h-4 w-4" />
          מה טעון בזיכרון
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mem.gpu && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>כרטיס המסך</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(mem.gpu.used / 1024 * 10) / 10} מתוך{" "}
                {Math.round(mem.gpu.total / 1024 * 10) / 10} ג׳יגה
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${mem.gpu.used > mem.gpu.total * 0.85 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (mem.gpu.used / mem.gpu.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span>מודלי תמלול</span>
            <span className="text-muted-foreground">
              {mem.transcriptionModels.length === 0
                ? "אין"
                : `${mem.transcriptionModels.length} · משתחרר אחרי ${mem.transcriptionTtlMinutes} דקות`}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>מנוע ההקראה</span>
            <span className="text-muted-foreground">
              {!mem.ttsLoaded
                ? "אינו טעון"
                : `טעון · ${minutes(mem.ttsIdleSeconds)} ללא שימוש · משתחרר אחרי ${mem.ttsTtlMinutes} דקות`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void release()}
                  disabled={busy || nothing}>
            {busy ? "משחרר..." : "שחרר עכשיו"}
          </Button>
          {nothing && (
            <span className="text-[11px] text-muted-foreground">
              אין מה לשחרר — שום מודל אינו טעון.
            </span>
          )}
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        </div>

        {/* בלי המשפט הזה אפשר לחשוב שהשחרור חינם. הוא לא. */}
        <p className="text-[11px] text-muted-foreground">
          שחרור מפנה זיכרון מיד, אבל השימוש הבא ישלם על הטעינה מחדש —
          שניות בודדות למודל תמלול, וכ-70 שניות למנוע ההקראה.
        </p>
      </CardContent>
    </Card>
  );
}

export function MeasurementsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLocalServer(`${getServerUrl()}/measurements`);
      if (!res.ok) throw new Error(`השרת החזיר ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("Failed to fetch")
          ? "שרת התמלול אינו פועל. המדידות נקראות ממנו."
          : e instanceof Error ? e.message : "שגיאה לא ידועה",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">מדידות לאורך זמן</h3>
          <p className="text-xs text-muted-foreground">
            כל נושא נמדד על חומר אחר ומול רף אחר. אין משמעות להשוואה ביניהם.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          רענון
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && (
        <ScrollArea className="h-[62vh] pr-2">
          <div className="space-y-4">
            {/* מצב הזיכרון ראשון: כשכרטיס המסך מלא, זאת הסיבה
                שהמדידה הבאה תיכשל — ועדיף לראות את זה לפני
                שמסתכלים על המספרים. */}
            <MemoryPanel />

            {data.topics.map((t) => (
              <Card key={t.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <TrendingUp className="h-4 w-4" />
                    {t.label}
                    <Badge variant="secondary">{t.count} מדידות</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* ההסבר מופיע רק כשיש יותר מקבוצה אחת — אחרת הוא
                      רעש. כשהוא כן מופיע, הוא נחוץ: בלעדיו המשתמש
                      ישווה בין שני גרפים שאסור להשוות ביניהם. */}
                  {t.groups.length > 1 && (
                    <p className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                      לנושא הזה יש {t.groups.length} קבוצות נפרדות. מדידות
                      מקבוצות שונות נעשו על מספר מילים אחר, על טקסטי הפניה
                      אחרים או בכלל נרמול אחר — ולכן <strong>אסור להשוות
                      ביניהן</strong>. שינוי בכל אחד משלושת אלה מזיז את הציון
                      בלי ששום דבר במנוע השתנה.
                    </p>
                  )}
                  {t.groups.map((g, i) => (
                    <GroupChart key={`${g.words}-${g.benchmark}-${g.normalisation}-${i}`} group={g} />
                  ))}
                </CardContent>
              </Card>
            ))}

            {/* נושא שלא נמדד חייב להיראות. לוח שמציג רק את מה שנמדד
                יוצר רושם שהכול מכוסה, וזה בדיוק מה שהוא לא. */}
            {data.notMeasured.length > 0 && (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">נושאים שעדיין לא נמדדו</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {data.notMeasured.map((m) => (
                      <Badge key={m.key} variant="outline">{m.label}</Badge>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    אין עליהם שום נתון. כדי למדוד נושא, מריצים בשורת הפקודה:
                  </p>
                  <code className="block rounded bg-muted p-2 text-[11px]" dir="ltr">
                    {data.howToMeasure}
                  </code>
                </CardContent>
              </Card>
            )}

            {data.lessons.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    מה ניסינו ומה למדנו
                    <Badge variant="secondary" className="mr-2">{data.lessons.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {/* המספר לבדו אינו שווה הרבה. בלי מה ניסינו ולמה,
                      נחזור על אותו ניסיון כעבור חודשיים. */}
                  {data.lessons.map((l, i) => (
                    <details key={i} className="rounded border px-2 py-1 text-xs">
                      <summary className="cursor-pointer select-none">
                        <span className="font-medium">{l.label}</span>
                        {l.verdict && (
                          <Badge variant="outline" className="mr-2">{l.verdict}</Badge>
                        )}
                        <span className="mr-2 text-muted-foreground">{shortDate(l.stamp)}</span>
                      </summary>
                      <dl className="mt-2 space-y-1 text-muted-foreground">
                        {l.hypothesis && (<><dt className="font-medium">ציפינו</dt><dd>{l.hypothesis}</dd></>)}
                        {l.change && (<><dt className="font-medium">שינינו</dt><dd>{l.change}</dd></>)}
                        {l.outcome && (<><dt className="font-medium">קרה</dt><dd>{l.outcome}</dd></>)}
                        {l.lesson && (<><dt className="font-medium">למדנו</dt><dd>{l.lesson}</dd></>)}
                      </dl>
                    </details>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export default MeasurementsPanel;
