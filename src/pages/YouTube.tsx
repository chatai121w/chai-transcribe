import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Youtube, Loader2, Download, FileText, Music, Video as VideoIcon,
  AlertTriangle, Search, History, Trash2, ExternalLink, Captions,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useYoutubeJobs, isValidYoutubeUrl,
  type YtProbeResult, type YtMode, type YoutubeJob,
} from "@/hooks/useYoutubeJobs";
import { startYoutubeJob } from "@/lib/jobs/pipelines/youtubePipeline";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/hooks/useJobs";
import { JobCard } from "@/components/jobs/JobCard";

export default function YouTubePage() {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<YtProbeResult | null>(null);
  const [mode, setMode] = useState<YtMode>("transcribe");
  const [audioFormat, setAudioFormat] = useState<"best" | "mp3" | "wav">("best");
  const [videoQuality, setVideoQuality] = useState<"360" | "720" | "1080">("720");
  const [submitting, setSubmitting] = useState(false);

  const { jobs, loading, probeUrl, startJob, deleteJob } = useYoutubeJobs();
  const { user } = useAuth();
  const { jobs: centralJobs } = useJobs();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJob = centralJobs.find((j) => j.id === activeJobId) ?? null;

  const handleProbe = async () => {
    const trimmed = url.trim();
    if (!isValidYoutubeUrl(trimmed)) {
      toast({ title: "קישור לא תקין", description: "הדבק קישור YouTube חוקי", variant: "destructive" });
      return;
    }
    setProbing(true);
    setProbe(null);
    try {
      const result = await probeUrl(trimmed);
      setProbe(result);
    } catch (e) {
      toast({ title: "שגיאה בבדיקה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setProbing(false);
    }
  };

  const handleStart = async () => {
    if (!probe || !user) return;
    setSubmitting(true);
    try {
      const job = await startYoutubeJob({
        userId: user.id,
        url: url.trim(),
        mode,
        audioFormat,
        videoQuality,
      });
      setActiveJobId(job.id);
      toast({ title: "המשימה התחילה", description: "עקוב אחרי השלבים למטה או במרכז המשימות" });
    } catch (e) {
      toast({ title: "שגיאה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDuration = (sec?: number | null) => {
    if (!sec) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
          <Youtube className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">תמלול והורדה מ-YouTube</h1>
          <p className="text-sm text-muted-foreground">הורד אודיו, וידאו, או תמלל ישירות מקישור</p>
        </div>
      </div>

      <Tabs defaultValue="new">
        <TabsList className="mb-4">
          <TabsTrigger value="new"><Youtube className="w-4 h-4 ml-2" />משימה חדשה</TabsTrigger>
          <TabsTrigger value="manager">
            <History className="w-4 h-4 ml-2" />מנהל הורדות
            {jobs.length > 0 && <Badge variant="secondary" className="mr-2">{jobs.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4">
          <Card className="p-4">
            <Label className="text-sm font-semibold mb-2 block">קישור YouTube</Label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => { setUrl(e.target.value); setProbe(null); }}
                placeholder="https://www.youtube.com/watch?v=..."
                dir="ltr"
                className="flex-1 text-left"
                onKeyDown={(e) => e.key === "Enter" && !probing && handleProbe()}
                disabled={probing || submitting}
              />
              <Button onClick={handleProbe} disabled={probing || !url.trim()}>
                {probing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Search className="w-4 h-4 ml-1" />}
                בדוק קישור
              </Button>
            </div>
          </Card>

          {probe && (
            <Card className="p-4">
              <div className="flex gap-4">
                {probe.thumbnail && <img src={probe.thumbnail} alt="" className="w-40 h-24 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{probe.title ?? "ללא כותרת"}</h3>
                  {probe.author && <p className="text-sm text-muted-foreground">{probe.author}</p>}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {probe.duration && <Badge variant="secondary">{fmtDuration(probe.duration)}</Badge>}
                    <Badge variant={probe.backend === "local" ? "default" : "outline"}>
                      {probe.backend === "local" ? "🖥️ שרת מקומי" : "☁️ ענן (Cobalt)"}
                    </Badge>
                    {probe.hasHebrewSubs && (
                      <Badge className="bg-green-500/15 text-green-700 dark:text-green-300">
                        <Captions className="w-3 h-3 ml-1" />כתוביות עברית קיימות
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {probe.hasHebrewSubs && (
                <Alert className="mt-3">
                  <Captions className="h-4 w-4" />
                  <AlertDescription>בסרטון קיימות כתוביות עברית מובנות — חיסכון משמעותי בזמן ובעלות תמלול.</AlertDescription>
                </Alert>
              )}

              {probe.backend === "cobalt" && (mode === "transcribe" || mode === "full") && (
                <Alert className="mt-3 border-green-500/30 bg-green-500/5">
                  <Captions className="h-4 w-4" />
                  <AlertDescription>
                    תמלול אוטומטי בענן פעיל — האודיו יורד, נשמר ב-Storage ומתומלל ב-Groq (עברית). ההתקדמות נצפית במרכז ה-Jobs.
                  </AlertDescription>
                </Alert>
              )}

              <div className="mt-4">
                <Label className="text-sm font-semibold mb-2 block">בחר פעולה</Label>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as YtMode)} className="grid grid-cols-2 gap-2">
                  <ModeOption value="transcribe" current={mode} icon={<FileText className="w-5 h-5" />} title="תמלול בלבד" desc="ברירת מחדל • אודיו מקורי → TXT + SRT + JSON" />
                  <ModeOption value="audio" current={mode} icon={<Music className="w-5 h-5" />} title="אודיו בלבד" desc="הורדת אודיו בפורמט הטוב ביותר" />
                  <ModeOption value="video" current={mode} icon={<VideoIcon className="w-5 h-5" />} title="וידאו" desc="הורדת קובץ וידאו מלא" />
                  <ModeOption value="full" current={mode} icon={<Download className="w-5 h-5" />} title="הכל ביחד" desc="אודיו + וידאו + תמלול + כתוביות" />
                </RadioGroup>
              </div>

              {(mode === "audio" || mode === "full" || mode === "transcribe") && (
                <div className="mt-4">
                  <Label className="text-xs text-muted-foreground mb-1 block">פורמט אודיו</Label>
                  <RadioGroup value={audioFormat} onValueChange={(v) => setAudioFormat(v as typeof audioFormat)} className="flex gap-2 flex-wrap">
                    <FormatChip value="best" current={audioFormat} label="מקורי (מומלץ — ללא המרה)" />
                    <FormatChip value="mp3" current={audioFormat} label="MP3" />
                    <FormatChip value="wav" current={audioFormat} label="WAV" />
                  </RadioGroup>
                  {audioFormat === "wav" && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠️ WAV גדול פי 10 ממקור — שימוש רק אם הכרחי</p>
                  )}
                </div>
              )}

              {(mode === "video" || mode === "full") && (
                <div className="mt-3">
                  <Label className="text-xs text-muted-foreground mb-1 block">איכות וידאו</Label>
                  <RadioGroup value={videoQuality} onValueChange={(v) => setVideoQuality(v as typeof videoQuality)} className="flex gap-2">
                    <FormatChip value="360" current={videoQuality} label="360p" />
                    <FormatChip value="720" current={videoQuality} label="720p" />
                    <FormatChip value="1080" current={videoQuality} label="1080p" />
                  </RadioGroup>
                </div>
              )}

              <Button onClick={handleStart} disabled={submitting} size="lg" className="w-full mt-4 bg-red-500 hover:bg-red-600 text-white">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <Download className="w-5 h-5 ml-2" />}
                התחל
              </Button>

              <p className="text-xs text-muted-foreground text-center mt-3">
                ⚖️ יש להשתמש רק בתוכן שיש לך זכות להוריד, לעבד או לתמלל.
              </p>
            </Card>
          )}

          {activeJob && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-muted-foreground">התקדמות המשימה</div>
              <JobCard job={activeJob} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="manager">
          <Card className="p-4">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>אין הורדות עדיין. התחל מהטאב הראשון.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => <JobRow key={job.id} job={job} onDelete={deleteJob} />)}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ModeOption({ value, current, icon, title, desc }: { value: string; current: string; icon: React.ReactNode; title: string; desc: string }) {
  const active = current === value;
  return (
    <label className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${active ? "border-red-500 bg-red-500/5" : "border-border hover:bg-muted/50"}`}>
      <RadioGroupItem value={value} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-medium text-sm">{icon}{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </label>
  );
}

function FormatChip({ value, current, label }: { value: string; current: string; label: string }) {
  const active = current === value;
  return (
    <label className={`px-3 py-1.5 border rounded-full cursor-pointer text-xs transition ${active ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted"}`}>
      <RadioGroupItem value={value} className="sr-only" />
      {label}
    </label>
  );
}

function JobRow({ job, onDelete }: { job: YoutubeJob; onDelete: (id: string) => void }) {
  const statusLabel: Record<string, string> = {
    pending: "ממתין", downloading: "מוריד", extracting: "מחלץ", converting: "ממיר",
    transcribing: "מתמלל", finalizing: "מסיים", done: "הושלם", error: "שגיאה", cancelled: "בוטל",
  };
  const isActive = !["done", "error", "cancelled"].includes(job.status);

  return (
    <div className="flex gap-3 p-3 border rounded-lg hover:bg-muted/30 transition">
      {job.thumbnail_url ? (
        <img src={job.thumbnail_url} alt="" className="w-24 h-16 object-cover rounded shrink-0" />
      ) : (
        <div className="w-24 h-16 bg-muted rounded shrink-0 flex items-center justify-center">
          <Youtube className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{job.video_title ?? job.url}</div>
        <div className="flex gap-2 items-center mt-1 flex-wrap">
          <Badge variant={job.status === "done" ? "default" : job.status === "error" ? "destructive" : "secondary"} className="text-[10px]">
            {statusLabel[job.status] ?? job.status}
          </Badge>
          <span className="text-xs text-muted-foreground">{job.mode}</span>
          <span className="text-xs text-muted-foreground">•</span>
          <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString("he-IL")}</span>
        </div>
        {isActive && <Progress value={job.progress_pct} className="mt-2 h-1.5" />}
        {job.error && <p className="text-xs text-destructive mt-1">{job.error}</p>}
        {job.output_files?.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {job.output_files.map((f, i) => (
              <Button key={i} variant="outline" size="sm" className="h-7 text-xs" asChild>
                <a href={f.url} target="_blank" rel="noreferrer" download={f.filename}>
                  <Download className="w-3 h-3 ml-1" />
                  {f.kind.toUpperCase()}
                </a>
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild title="פתח ב-YouTube">
          <a href={job.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => onDelete(job.id)} title="מחק">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
