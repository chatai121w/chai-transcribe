import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clapperboard, ImageIcon, Loader2, RefreshCw, Video } from "lucide-react";

// סטודיו יצירה: תמונות וסרטונים קצרים במנוע המקומי. האתר מדבר עם שרת הסטודיו (ארגז-כלים-לסרטונים/סטודיו-שרת.py),
// שמפנה את כרטיס המסך משרתי התמלול לזמן היצירה ומחזיר אותו בסוף.
const STUDIO = "http://127.0.0.1:8190";

type Job = {
  id: string;
  kind: "image" | "video";
  prompt: string;
  state: "ממתין" | "כותב תיאור" | "בעבודה" | "מוכן" | "נכשל" | "בוטל";
  created: number;
  file?: string;
  error?: string;
  seconds_taken?: number;
  from_job?: string;
  assist?: Assist;
  engine_prompt?: string;
  assist_by?: string;
  retries?: number;
  check?: { ok: boolean | null; problems: string[] };
};

type Assist = "אוטומטי" | "קלוד" | "מקומי" | "כבוי";
const ASSISTS: { v: Assist; label: string; hint: string }[] = [
  { v: "אוטומטי", label: "אוטומטי", hint: "קלוד כשיש מפתח, ואחרת העוזר המקומי" },
  { v: "קלוד", label: "קלוד", hint: "כותב תיאור ובודק כל תמונה. כמה אגורות לתמונה" },
  { v: "מקומי", label: "מקומי", hint: "ג׳מה 3 על המחשב. חינם, בלי בדיקת תמונה, כדקה לתיאור" },
  { v: "כבוי", label: "כבוי", hint: "התיאור נשלח למנוע כמו שכתבתם, עדיף באנגלית" },
];

type Status = Record<string, string | number>;

const SIZES = [
  { label: "רוחב 16:9", w: 1280, h: 720 },
  { label: "לאורך 9:16", w: 720, h: 1280 },
  { label: "ריבוע", w: 1024, h: 1024 },
];

export default function CreationStudio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(0);
  const [seed, setSeed] = useState(1);
  const [motion, setMotion] = useState("");
  const [seconds, setSeconds] = useState(3);
  const [source, setSource] = useState<string>("");
  const [scene, setScene] = useState("");
  const [sending, setSending] = useState(false);
  const [assist, setAssist] = useState<Assist>("אוטומטי");

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        fetch(`${STUDIO}/status`).then((r) => r.json()),
        fetch(`${STUDIO}/jobs`).then((r) => r.json()),
      ]);
      setStatus(s);
      setJobs(j);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = async (body: Record<string, unknown>) => {
    setSending(true);
    try {
      const r = await fetch(`${STUDIO}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await refresh();
    } catch (e) {
      alert(`הבקשה לא נשלחה: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
    }
  };

  const images = jobs.filter((j) => j.kind === "image" && j.state === "מוכן");
  const busy = jobs.some((j) => j.state === "ממתין" || j.state === "כותב תיאור" || j.state === "בעבודה");

  return (
    <div className="w-full max-w-full px-4 py-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Clapperboard className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">סטודיו יצירה</h1>
            <p className="text-sm text-muted-foreground">
              תמונות וסרטונים קצרים במנוע המקומי, על כרטיס המסך של המחשב. בזמן היצירה שרתי התמלול נעצרים וחוזרים בסוף.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4 ml-2" /> רענון
        </Button>
      </div>

      {offline ? (
        <Card className="border-destructive">
          <CardContent className="py-4 text-sm">
            שרת הסטודיו לא עונה. מפעילים אותו בקובץ <code>סטודיו-שרת.bat</code> שבתיקייה <code>ארגז-כלים-לסרטונים</code>.
          </CardContent>
        </Card>
      ) : (
        status && (
          <div className="flex gap-2 flex-wrap text-sm">
            {Object.entries(status).map(([k, v]) => (
              <Badge key={k} variant="secondary">
                {k}: {String(v)}
              </Badge>
            ))}
          </div>
        )
      )}

      <Card>
        <CardContent className="py-3 text-sm text-muted-foreground">
          כל תמונה או סרטון מכאן הם <b>המחשה</b>. כשמשתמשים בהם בסרטון לפרסום, חייבים לסמן אותם בבירור: "נוצר בבינה מלאכותית". לא
          מייצרים פנים או קול של אדם אמיתי, וטקסט בעברית מוסיפים אחר כך בעיצוב, כי המנוע מצייר אותיות עבריות משובשות.
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-sm font-medium">העוזר שכותב את התיאור למנוע:</span>
            {ASSISTS.map((a) => (
              <Button key={a.v} size="sm" variant={assist === a.v ? "default" : "outline"} onClick={() => setAssist(a.v)} title={a.hint}>
                {a.label}
              </Button>
            ))}
            {status && <Badge variant="secondary">מפתח קלוד: {String(status["מפתח קלוד"] ?? "לא ידוע")}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{ASSISTS.find((a) => a.v === assist)?.hint}</p>
        </CardContent>
      </Card>

      <Tabs defaultValue="image">
        <TabsList>
          <TabsTrigger value="image">
            <ImageIcon className="h-4 w-4 ml-2" /> תמונה
          </TabsTrigger>
          <TabsTrigger value="video">
            <Video className="h-4 w-4 ml-2" /> סרטון
          </TabsTrigger>
        </TabsList>

        <TabsContent value="image">
          <Card>
            <CardHeader>
              <CardTitle>תמונה מתיאור</CardTitle>
              <CardDescription>כחצי דקה עד דקה לתמונה, ועוד בערך שתי דקות לפינוי הכרטיס בפעם הראשונה. עם העוזר אפשר לכתוב בעברית.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                dir="auto"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="למשל: אבא ואמא חרדים בסלון בבני ברק, מופתעים מעלון צבעוני (או תיאור באנגלית)"
              />
              <div className="flex gap-2 flex-wrap items-center">
                {SIZES.map((s, i) => (
                  <Button key={s.label} size="sm" variant={i === size ? "default" : "outline"} onClick={() => setSize(i)}>
                    {s.label}
                  </Button>
                ))}
                <span className="text-sm text-muted-foreground mr-3">זרע:</span>
                <Input type="number" className="w-24" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} />
              </div>
              <Button
                disabled={sending || !prompt.trim()}
                onClick={() => send({ kind: "image", prompt, width: SIZES[size].w, height: SIZES[size].h, seed, assist })}
              >
                {sending ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <ImageIcon className="h-4 w-4 ml-2" />} צור תמונה
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="video">
          <Card>
            <CardHeader>
              <CardTitle>סרטון קצר</CardTitle>
              <CardDescription>
                מתארים מה רואים בסצנה ומה זז בה. קודם נוצרת תמונה (ואם העוזר הוא קלוד, הוא בודק אותה), ואז היא מונעת. איטי: כשש
                דקות לכל שנייה של סרטון.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">1. מה רואים בסצנה</label>
              <Textarea
                rows={3}
                dir="auto"
                value={source ? "" : scene}
                disabled={!!source}
                onChange={(e) => setScene(e.target.value)}
                placeholder={source ? "נבחרה תמונה קיימת" : "למשל: אולם כנס אקדמי ריק עם במה, שולחן ושלושה מיקרופונים"}
              />
              {images.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">או להניע תמונה שכבר נוצרה (לחיצה נוספת מבטלת):</span>
                  <div className="flex gap-2 flex-wrap">
                    {images.slice(0, 12).map((j) => (
                      <button
                        key={j.id}
                        onClick={() => setSource(source === j.id ? "" : j.id)}
                        className={`rounded border-2 ${source === j.id ? "border-primary" : "border-transparent"}`}
                        title={j.prompt}
                      >
                        <img src={`${STUDIO}/out/${j.file}`} className="h-16 rounded" alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="text-sm font-medium">2. מה זז</label>
              <Textarea
                rows={3}
                dir="auto"
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
                placeholder="למשל: האבא מסתובב לאט אל אשתו ומרים גבות, המצלמה מתקרבת לאט"
              />
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">שניות:</span>
                {[2, 3, 5].map((s) => (
                  <Button key={s} size="sm" variant={s === seconds ? "default" : "outline"} onClick={() => setSeconds(s)}>
                    {s}
                  </Button>
                ))}
              </div>
              <Button
                disabled={sending || !motion.trim() || (!source && !scene.trim())}
                onClick={() =>
                  send(
                    source
                      ? { kind: "video", prompt: motion, from_job: source, seconds, seed, assist }
                      : { kind: "video", prompt: scene, motion, seconds, seed, assist },
                  )
                }
              >
                <Video className="h-4 w-4 ml-2" /> צור סרטון
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            עבודות {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">עוד אין עבודות.</p>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.map((j) => (
                <div key={j.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={j.state === "מוכן" ? "default" : j.state === "נכשל" ? "destructive" : "secondary"}>
                      {j.kind === "image" ? "תמונה" : "סרטון"} · {j.state}
                    </Badge>
                    {j.seconds_taken !== undefined && <span className="text-xs text-muted-foreground">{j.seconds_taken} שניות</span>}
                  </div>
                  {j.file &&
                    (j.kind === "image" ? (
                      <a href={`${STUDIO}/out/${j.file}`} target="_blank" rel="noreferrer">
                        <img src={`${STUDIO}/out/${j.file}`} className="w-full rounded" alt="" />
                      </a>
                    ) : (
                      <video src={`${STUDIO}/out/${j.file}`} className="w-full rounded" controls loop />
                    ))}
                  <p className="text-xs text-muted-foreground line-clamp-3" dir="auto">
                    {j.prompt}
                  </p>
                  {j.engine_prompt && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        התיאור שנשלח למנוע{j.assist_by ? ` (כתב: ${j.assist_by})` : ""}
                      </summary>
                      <p className="mt-1" dir="ltr">{j.engine_prompt}</p>
                    </details>
                  )}
                  {j.check && (
                    <p className={`text-xs ${j.check.ok ? "text-green-700" : "text-amber-700"}`}>
                      {j.check.ok ? "✓ קלוד בדק: התמונה תקינה" : `קלוד מצא: ${j.check.problems.join(" · ")}`}
                      {j.retries ? ` (נוצרה מחדש ${j.retries} פעמים)` : ""}
                    </p>
                  )}
                  {j.error && <p className="text-xs text-destructive">{j.error}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
