import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Youtube, Loader2, Download, FileText, Music, Video as VideoIcon,
  AlertTriangle, Search, History, Trash2, ExternalLink, Captions,
  RotateCcw, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useYoutubeJobs, isValidYoutubeUrl,
  type YtProbeResult, type YtMode, type YoutubeJob,
} from "@/hooks/useYoutubeJobs";
import { startYoutubeJob, resumeYoutubeJob } from "@/lib/jobs/pipelines/youtubePipeline";
import { YoutubeJobProgress } from "@/components/YoutubeJobProgress";
import { VideoTranscriptViewer } from "@/components/VideoTranscriptViewer";
import type { JobRecord } from "@/lib/jobs/types";
import { db } from "@/lib/localDb";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { getServerUrl } from "@/lib/serverConfig";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useJob } from "@/hooks/useJobs";
import { JobCard } from "@/components/jobs/JobCard";
import { WaveformPlayer } from "@/components/WaveformPlayer";

/** Engines offered for YouTube transcription — same set as the main page. */
type YtEngine = 'local-server' | 'groq' | 'openai' | 'gemini' | 'google' | 'assemblyai' | 'deepgram' | 'local';

const YT_ENGINES: Array<{ id: YtEngine; label: string; hint: string; local?: boolean }> = [
  { id: 'local-server', label: '🖥️ שרת מקומי (CUDA)', hint: 'מהיר, ללא עלות, רץ על הכרטיס שלך', local: true },
  { id: 'gemini',       label: '✨ Gemini',            hint: 'איכות גבוהה לעברית' },
  { id: 'groq',         label: '⚡ Groq',              hint: 'הכי מהיר בענן' },
  { id: 'openai',       label: '🌐 OpenAI',            hint: 'Whisper בענן' },
  { id: 'google',       label: '🔵 Google',            hint: 'Speech-to-Text' },
  { id: 'assemblyai',   label: '🎙️ AssemblyAI',        hint: 'דיוק גבוה' },
  { id: 'deepgram',     label: '🌊 Deepgram',          hint: 'מהיר וחסכוני' },
  { id: 'local',        label: '💻 ONNX (בדפדפן)',     hint: 'ללא רשת כלל', local: true },
];

type FilterKey = 'all' | 'active' | 'done' | 'error';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'הכל' },
  { key: 'active', label: 'פעילות' },
  { key: 'done', label: 'הושלמו' },
  { key: 'error', label: 'נכשלו' },
];

const isTerminal = (status: string) => ["done", "error", "cancelled"].includes(status);

function matchesFilter(job: YoutubeJob, key: FilterKey): boolean {
  if (key === 'all') return true;
  if (key === 'active') return !isTerminal(job.status);
  if (key === 'done') return job.status === 'done';
  return job.status === 'error' || job.status === 'cancelled';
}

/**
 * The failure a job actually recorded. The orchestrator writes to last_error and
 * to the stage that broke; the legacy `error` column stays null, so reading only
 * that one made every failure look like a bare red badge with no explanation.
 */
function jobFailure(job: YoutubeJob): { message: string; stage?: string } | null {
  const failedStage = job.stages?.find((s) => s.status === 'failed');
  const message = job.last_error ?? job.error ?? failedStage?.error ?? null;
  if (!message && !failedStage) return null;
  return { message: message ?? 'המשימה נכשלה', stage: failedStage?.label ?? failedStage?.key };
}

export default function YouTubePage() {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<YtProbeResult | null>(null);
  const [mode, setMode] = useState<YtMode>("transcribe");
  const [audioFormat, setAudioFormat] = useState<"best" | "mp3" | "wav">("best");
  const [videoQuality, setVideoQuality] = useState<"360" | "720" | "1080">("720");
  const [saveToCloud, setSaveToCloud] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [engine, setEngine] = useState<YtEngine>("local-server");
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const navigate = useNavigate();
  const { updatePreference } = useCloudPreferences();

  // Health of the local transcription server — drives the readiness strip and
  // decides whether the server-side engine can be offered at all.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    fetch(`${getServerUrl()}/health`, { signal: ctrl.signal })
      .then(res => res.json())
      .then((h) => { if (!cancelled) setServerOk(h?.status === 'ok'); })
      .catch(() => { if (!cancelled) setServerOk(false); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  const pendingHandoffRef = useRef<string | null>(null);
  const { jobs, loading, probeUrl, deleteJob } = useYoutubeJobs();
  const { user } = useAuth();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // One row, not the whole list: this page only ever renders the job it just
  // started, and subscribing to the list here meant every progress write
  // refetched a hundred rows that nothing on screen reads.
  const { job: centralJob } = useJob(activeJobId);
  // The row returned by startYoutubeJob, held so the progress readout has
  // something to render before the realtime subscription delivers the same row.
  const [seedJob, setSeedJob] = useState<JobRecord | null>(null);
  const activeJob = (centralJob?.id === activeJobId ? centralJob : null)
    ?? (seedJob?.id === activeJobId ? seedJob : null);

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

  // A cloud engine cannot run inside the local server job, so for those the job
  // only downloads the audio and the existing transcription pipeline takes over.
  const wantsCloudEngine = engine !== 'local-server'
    && (mode === 'transcribe' || mode === 'full')
    && probe?.backend === 'local';

  const handleStart = async () => {
    if (!probe || !user) return;
    setSubmitting(true);
    try {
      const effectiveMode: YtMode = wantsCloudEngine && mode === 'transcribe' ? 'audio' : mode;
      if (wantsCloudEngine) {
        // Applied before the handoff so the transcription page starts on it.
        await updatePreference('engine', engine);
      }
      const job = await startYoutubeJob({
        userId: user.id,
        url: url.trim(),
        mode: effectiveMode,
        audioFormat,
        videoQuality,
        saveToCloud: probe?.backend === "local" ? saveToCloud : false,
        knownInfo: {
          title: probe.title,
          thumbnail: probe.thumbnail,
          duration: probe.duration ?? null,
          backend: probe.backend,
        },
      });
      pendingHandoffRef.current = wantsCloudEngine ? job.id : null;
      setSeedJob(job);
      setActiveJobId(job.id);
      toast({ title: "המשימה התחילה", description: "עקוב אחרי השלבים למטה או במרכז המשימות" });
    } catch (e) {
      toast({ title: "שגיאה", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Once the download finishes, carry the audio into the regular transcription
  // flow, which already supports every engine.
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'done') return;
    if (pendingHandoffRef.current !== activeJob.id) return;
    pendingHandoffRef.current = null;

    const audioFile = (activeJob.output_files ?? []).find(
      (f: { kind?: string }) => f.kind === 'audio',
    ) as { url?: string; filename?: string } | undefined;
    if (!audioFile?.url) {
      toast({ title: 'לא נמצא אודיו להעברה', description: 'ההורדה הסתיימה אך לא הופק קובץ אודיו', variant: 'destructive' });
      return;
    }

    setHandingOff(true);
    void (async () => {
      try {
        const res = await fetch(audioFile.url!);
        if (!res.ok) throw new Error(`הורדת האודיו נכשלה (${res.status})`);
        const blob = await res.blob();
        const name = audioFile.filename || 'youtube-audio';
        const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
        const engineLabel = YT_ENGINES.find(e => e.id === engine)?.label ?? engine;
        toast({ title: `מעביר לתמלול עם ${engineLabel}`, description: name });
        navigate('/transcribe', { state: { file } });
      } catch (e) {
        toast({ title: 'שגיאה בהעברה לתמלול', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      } finally {
        setHandingOff(false);
      }
    })();
  }, [activeJob, engine, navigate]);

  /**
   * Load a finished job straight into the text editor: audio in the player,
   * transcript in the editor, word timings wiring the two together.
   */
  const openInEditor = async (job: { output_files?: Array<{ kind?: string; url?: string; filename?: string }> | null } | null) => {
    if (!job) return;
    const outputs = (job.output_files ?? []) as Array<{ kind?: string; url?: string; filename?: string }>;
    const audio = outputs.find(f => f.kind === 'audio');
    const json = outputs.find(f => f.kind === 'json');
    const txt = outputs.find(f => f.kind === 'txt');
    if (!audio?.url || (!json?.url && !txt?.url)) {
      toast({ title: 'חסרים קבצים', description: 'צריך אודיו ותמלול כדי לפתוח בעורך', variant: 'destructive' });
      return;
    }

    setOpeningEditor(true);
    try {
      let text = '';
      let wordTimings: Array<{ word: string; start: number; end: number; probability?: number }> = [];

      if (json?.url) {
        const data = await (await fetch(json.url)).json();
        text = (data.segments ?? []).map((s: { text: string }) => (s.text || '').trim()).filter(Boolean).join(' ');
        wordTimings = Array.isArray(data.wordTimings) ? data.wordTimings : [];
      }
      if (!text && txt?.url) text = await (await fetch(txt.url)).text();
      if (!text.trim()) throw new Error('התמלול ריק');

      const blob = await (await fetch(audio.url)).blob();
      const name = audio.filename || 'youtube-audio';
      // Persist for recovery, exactly like a normal transcription would.
      try {
        await db.audioBlobs.put({ id: 'last_audio', blob, type: blob.type, name, saved_at: Date.now() });
      } catch { /* Dexie unavailable */ }

      navigate('/text-editor', {
        state: {
          text,
          audioUrl: URL.createObjectURL(blob),
          audioFileName: name,
          wordTimings,
        },
      });
    } catch (e) {
      toast({ title: 'פתיחה בעורך נכשלה', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setOpeningEditor(false);
    }
  };

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const visibleJobs = jobs.filter((j) => {
    if (!matchesFilter(j, filter)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (j.video_title ?? "").toLowerCase().includes(q) || j.url.toLowerCase().includes(q);
  });

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

              {probe?.backend === "local" && (mode === "transcribe" || mode === "full") && (
                <div className="flex items-center justify-between mt-3 p-3 bg-muted/40 rounded-lg border">
                  <div className="min-w-0 ml-3">
                    <Label htmlFor="save-cloud" className="text-sm font-medium cursor-pointer">שמור תמלול בענן ☁️</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      מעלה TXT/SRT/JSON ל-Supabase Storage — גישה מכל מקום
                    </p>
                  </div>
                  <Switch
                    id="save-cloud"
                    checked={saveToCloud}
                    onCheckedChange={setSaveToCloud}
                  />
                </div>
              )}

              {/* Engine picker — every engine available on the main page */}
              {(mode === "transcribe" || mode === "full") && (
                <div className="mt-4">
                  <Label className="text-sm font-semibold mb-2 block">מנוע תמלול</Label>
                  <div className="flex flex-wrap gap-2">
                    {YT_ENGINES.map((e) => {
                      const disabled = e.id === 'local-server' && serverOk === false;
                      const active = engine === e.id;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => setEngine(e.id)}
                          title={disabled ? 'השרת המקומי לא זמין כרגע' : e.hint}
                          className={`px-3 py-1.5 rounded-lg border text-xs transition ${
                            active ? 'border-red-500 bg-red-500/10 font-medium'
                              : 'border-border hover:bg-muted/50'
                          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          {e.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {engine === 'local-server'
                      ? 'התמלול ירוץ על השרת המקומי — הכל בתוך המשימה הזו.'
                      : 'האודיו יורד כאן, ואז עובר אוטומטית לתמלול במנוע שנבחר.'}
                  </p>
                </div>
              )}

              {/* Readiness strip */}
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">מצב מערכת:</span>
                <StatusPill ok={true} label="קישור תקין" />
                <StatusPill ok={probe.backend === 'local'} label={probe.backend === 'local' ? 'הורדה מקומית' : 'הורדה בענן'} />
                <StatusPill
                  ok={serverOk === null ? null : serverOk}
                  label={serverOk === null ? 'בודק שרת...' : serverOk ? 'שרת מקומי פעיל' : 'שרת מקומי כבוי'}
                />
                {(mode === 'transcribe' || mode === 'full') && (
                  <StatusPill
                    ok={engine === 'local-server' ? serverOk : true}
                    label={`מנוע: ${YT_ENGINES.find(e => e.id === engine)?.label ?? engine}`}
                  />
                )}
              </div>

              <Button onClick={handleStart} disabled={submitting} size="lg" className="w-full mt-4 bg-red-500 hover:bg-red-600 text-white">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <Download className="w-5 h-5 ml-2" />}
                התחל
              </Button>

              <p className="text-xs text-muted-foreground text-center mt-3">
                ⚖️ יש להשתמש רק בתוכן שיש לך זכות להוריד, לעבד או לתמלל.
              </p>
            </Card>
          )}

          {/* The row is on screen from the click, not from the first server reply */}
          {submitting && !activeJob && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-muted-foreground">התקדמות המשימה</div>
              <Card className="p-4" dir="rtl">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    <span className="font-medium text-sm">פותח משימה...</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold tabular-nums leading-none text-primary">0</span>
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                  <div className="absolute top-0 right-0 h-full w-[2%] rounded-full bg-primary animate-pulse" />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">רושם את המשימה בשרת</p>
              </Card>
            </div>
          )}

          {activeJob && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-muted-foreground">התקדמות המשימה</div>
              <YoutubeJobProgress job={activeJob} />
              {handingOff && (
                <Alert className="border-primary/30 bg-primary/5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertDescription>מעביר את האודיו לתמלול...</AlertDescription>
                </Alert>
              )}
              <JobCard job={activeJob} />
              {activeJob.status === "done" && (() => {
                const outs = (activeJob.output_files ?? []) as Array<{ kind?: string; url?: string; filename?: string }>;
                const videoFile = outs.find(f => f.kind === "video");
                const jsonFile = outs.find(f => f.kind === "json");
                const srtFile = outs.find(f => f.kind === "srt");
                const hasTranscript = Boolean(jsonFile || outs.some(f => f.kind === "txt"));
                const audioFile = outs.find(f => f.kind === "audio");

                return (
                  <>
                    {/* One click: audio in the player, transcript in the editor, linked */}
                    {audioFile && hasTranscript && (
                      <Button
                        onClick={() => openInEditor(activeJob)}
                        disabled={openingEditor}
                        size="lg"
                        className="w-full gap-2"
                      >
                        {openingEditor
                          ? <Loader2 className="w-5 h-5 animate-spin" />
                          : <FileText className="w-5 h-5" />}
                        פתח בעורך טקסט עם האודיו — מחובר ומסונכרן
                      </Button>
                    )}

                    {videoFile?.url && (
                      <VideoTranscriptViewer
                        videoUrl={videoFile.url}
                        transcriptJsonUrl={jsonFile?.url}
                        srtUrl={srtFile?.url}
                        srtFilename={srtFile?.filename}
                      />
                    )}
                  </>
                );
              })()}

              {activeJob.status === "done" && (() => {
                const audioFile = (activeJob.output_files ?? []).find((f: any) => f.kind === "audio");
                if (!audioFile) return null;
                return (
                  <Card className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Music className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold">נגן אודיו</span>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                        <a href={audioFile.url} download={audioFile.filename}>
                          <Download className="w-3 h-3 ml-1" />הורד
                        </a>
                      </Button>
                    </div>
                    <WaveformPlayer audioSrc={audioFile.url} />
                  </Card>
                );
              })()}
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
              <>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="חפש לפי כותרת או קישור"
                      className="h-9 pr-8 text-sm"
                    />
                  </div>
                  {FILTERS.map((f) => {
                    const n = f.key === 'all' ? jobs.length : jobs.filter(j => matchesFilter(j, f.key)).length;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFilter(f.key)}
                        className={`px-3 h-9 rounded-lg border text-xs transition ${
                          filter === f.key ? 'border-red-500 bg-red-500/10 font-medium' : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        {f.label}
                        <span className="mr-1.5 text-muted-foreground tabular-nums">{n}</span>
                      </button>
                    );
                  })}
                </div>

                {visibleJobs.length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    אין משימות שתואמות לסינון.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleJobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        onDelete={deleteJob}
                        onOpenEditor={openInEditor}
                        openingEditor={openingEditor}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
      ok === null ? 'border-border text-muted-foreground'
        : ok ? 'border-green-500/40 text-green-700 dark:text-green-300 bg-green-500/5'
        : 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        ok === null ? 'bg-muted-foreground animate-pulse' : ok ? 'bg-green-500' : 'bg-amber-500'
      }`} />
      {label}
    </span>
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

function JobRow({ job, onDelete, onOpenEditor, openingEditor }: {
  job: YoutubeJob;
  onDelete: (id: string) => void;
  onOpenEditor: (job: { output_files?: Array<{ kind?: string; url?: string; filename?: string }> | null }) => void;
  openingEditor: boolean;
}) {
  const statusLabel: Record<string, string> = {
    pending: "ממתין", downloading: "מוריד", extracting: "מחלץ", converting: "ממיר",
    transcribing: "מתמלל", finalizing: "מסיים", done: "הושלם", error: "שגיאה", cancelled: "בוטל",
  };
  const isActive = !isTerminal(job.status);
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Real-time download stats from stage meta
  const dlStage = job.stages?.find((s) => s.key === "download");
  const dlMeta = dlStage?.meta;
  const showDlStats = isActive &&
    job.status !== "transcribing" &&
    (dlMeta?.dl_mb ?? 0) > 0;

  const failure = jobFailure(job);
  const outs = job.output_files ?? [];
  const audioFile = outs.find((f) => f.kind === "audio");
  const videoFile = outs.find((f) => f.kind === "video");
  const jsonFile = outs.find((f) => f.kind === "json");
  const srtFile = outs.find((f) => f.kind === "srt");
  const hasTranscript = outs.some((f) => f.kind === "json" || f.kind === "txt");
  const canOpenEditor = Boolean(audioFile && hasTranscript);
  const canPlay = Boolean(audioFile || videoFile);

  const retry = async () => {
    setRetrying(true);
    try {
      await resumeYoutubeJob(job.id);
      toast({ title: "ממשיך מהשלב שנכשל", description: job.video_title ?? job.url });
    } catch (e) {
      toast({ title: "לא הצלחתי להמשיך", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="border rounded-lg hover:bg-muted/20 transition">
      <div className="flex gap-3 p-3">
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

          {isActive && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <Progress value={job.progress_pct} className="h-1.5 flex-1" />
                <span className="text-xs font-semibold tabular-nums text-primary shrink-0">{job.progress_pct}%</span>
              </div>
            </div>
          )}
          {showDlStats && (
            <div className="flex gap-3 mt-1 text-xs text-muted-foreground font-mono">
              <span>⬇ {(dlMeta!.dl_mb ?? 0).toFixed(1)} MB</span>
              {(dlMeta!.total_mb ?? 0) > 0 && (
                <span className="text-muted-foreground/60">/ {(dlMeta!.total_mb!).toFixed(1)} MB</span>
              )}
              {(dlMeta!.speed_mb ?? 0) > 0 && (
                <span className="text-blue-500">{(dlMeta!.speed_mb!).toFixed(2)} MB/s</span>
              )}
            </div>
          )}

          {/* The reason it failed, not just that it failed */}
          {failure && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  {failure.stage && (
                    <div className="text-[10px] text-muted-foreground">נכשל בשלב: {failure.stage}</div>
                  )}
                  <p className="text-xs text-destructive break-words">{failure.message}</p>
                </div>
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[11px] shrink-0"
                  onClick={retry}
                  disabled={retrying}
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RotateCcw className="w-3 h-3 ml-1" />}
                  נסה שוב
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-1 mt-2 flex-wrap items-center">
            {outs.map((f, i) => (
              <Button key={i} variant="outline" size="sm" className="h-7 text-xs" asChild>
                <a href={f.url} target="_blank" rel="noreferrer" download={f.filename}>
                  <Download className="w-3 h-3 ml-1" />
                  {f.kind.toUpperCase()}
                </a>
              </Button>
            ))}
            {canOpenEditor && (
              <Button
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => onOpenEditor(job)}
                disabled={openingEditor}
              >
                {openingEditor ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                פתח בעורך
              </Button>
            )}
            {canPlay && (
              <Button
                variant="ghost" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {expanded ? "סגור נגן" : videoFile ? "נגן וידאו" : "נגן אודיו"}
              </Button>
            )}
          </div>
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

      {/* Play the result here instead of sending the user back to the first tab */}
      {expanded && canPlay && (
        <div className="border-t p-3 space-y-3">
          {videoFile?.url && (
            <VideoTranscriptViewer
              videoUrl={videoFile.url}
              transcriptJsonUrl={jsonFile?.url}
              srtUrl={srtFile?.url}
              srtFilename={srtFile?.filename}
            />
          )}
          {audioFile?.url && !videoFile?.url && <WaveformPlayer audioSrc={audioFile.url} />}
        </div>
      )}
    </div>
  );
}
