import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Captions, Check, Download, FileText, FileVideo, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WordTiming } from "@/components/SyncAudioPlayer";
import { TRANSLATION_LANGUAGES } from "@/lib/translation";
import { buildSubtitleTracks, wordTimingsToSubtitleSegments } from "@/lib/subtitleTracks";
import { importSubtitles, isSubtitleFilename } from "@/lib/subtitleImport";
import {
  SUBTITLE_MODES, getDefaultSubtitleMode, setDefaultSubtitleMode,
  subtitleModeInfo, type SubtitleMode,
} from "@/lib/subtitleMode";
import { fetchLocalServer, getServerUrl } from "@/lib/serverConfig";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wordTimings: WordTiming[];
  transcriptTitle?: string;
}

const LANGUAGES = TRANSLATION_LANGUAGES.filter((language) => ["he", "en", "de", "fr", "es", "yi"].includes(language.code));

export function AttachTranscriptToVideoDialog({ open, onOpenChange, wordTimings, transcriptTitle }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subsRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [languages, setLanguages] = useState(["he", "en"]);
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(false);

  // קובץ כתוביות חיצוני, כשרוצים לחבר תמלול שאינו פתוח בעורך.
  //
  // בלי זה אי אפשר לקחת וידאו וקובץ כתוביות שכבר קיימים ולחבר
  // ביניהם — צריך קודם לתמלל מחדש, וזה מיותר לגמרי כשהתמלול כבר ביד.
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [subsTimings, setSubsTimings] = useState<WordTiming[] | null>(null);
  const [subsInfo, setSubsInfo] = useState<string>("");
  const [subsError, setSubsError] = useState<string>("");

  // איך הכתוביות ייכנסו. נטען מברירת המחדל השמורה, וניתן לשנות
  // בכל פעם בלי לשנות את ברירת המחדל עצמה.
  const [mode, setMode] = useState<SubtitleMode>(() => getDefaultSubtitleMode());
  const [savedDefault, setSavedDefault] = useState<SubtitleMode>(
    () => getDefaultSubtitleMode());
  const modeInfo = subtitleModeInfo(mode);

  const openTimings = useMemo(
    () => wordTimingsToSubtitleSegments(wordTimings), [wordTimings]);
  const fileTimings = useMemo(
    () => (subsTimings ? wordTimingsToSubtitleSegments(subsTimings) : []), [subsTimings]);

  // הקובץ שהועלה גובר על התמלול הפתוח: אם המשתמש טרח להעלות
  // קובץ, זה מה שהוא רוצה לחבר.
  const segments = fileTimings.length ? fileTimings : openTimings;
  const source = fileTimings.length ? "file" : "open";

  const loadSubtitles = async (file: File) => {
    setSubsError("");
    setSubsInfo("");
    setSubsTimings(null);
    setSubsFile(file);

    if (!isSubtitleFilename(file.name)) {
      setSubsError(`הקובץ "${file.name}" אינו קובץ כתוביות. נדרשת סיומת srt או vtt.`);
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setSubsError("לא הצלחתי לקרוא את הקובץ.");
      return;
    }
    const imported = importSubtitles(raw);
    if (!imported.cues.length) {
      setSubsError(`לא נמצא אף קטע תקין בקובץ. ${imported.warnings.join(" ")}`);
      return;
    }
    setSubsTimings(imported.words.map((w) => ({ word: w.word, start: w.start, end: w.end })));
    setSubsInfo(
      `${imported.cues.length} קטעים · ${imported.words.length} מילים · ` +
      `${(imported.durationCovered / 60).toFixed(1)} דקות`);
  };

  const clearSubtitles = () => {
    setSubsFile(null);
    setSubsTimings(null);
    setSubsInfo("");
    setSubsError("");
  };

  const toggleLanguage = (language: string, checked: boolean) => {
    setLanguages((current) => {
      const next = checked
        ? [...new Set([...current, language])]
        : current.filter((item) => item !== language);
      // בצריבה הכתוביות נכנסות לתמונה עצמה, ולכן אפשר שפה אחת בלבד.
      return modeInfo.multiLanguage ? next : next.slice(-1);
    });
  };

  const createVideo = async () => {
    if (!video || !segments.length || !languages.length) return;
    setWorking(true);
    setProgress(2);
    try {
      const tracks = await buildSubtitleTracks(segments, "he", languages, model, async (value) => setProgress(Math.max(3, Math.round(value * 0.85))));
      setProgress(88);
      const form = new FormData();
      form.append("video", video);
      form.append("tracks", JSON.stringify(tracks));
      form.append("mode", mode);
      const response = await fetchLocalServer(`${getServerUrl()}/media/subtitles`, { method: "POST", body: form });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || "חיבור הכתוביות לווידאו נכשל");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(transcriptTitle || video.name.replace(/\.[^.]+$/, "") || "video").replace(/[\\/:*?"<>|]+/g, "-")}-with-subtitles.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setProgress(100);
      toast({ title: "הווידאו מוכן", description: "הקובץ עם מסלולי הכתוביות ירד למחשב." });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "יצירת הווידאו נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !working && onOpenChange(value)}>
      <DialogContent dir="rtl" className="max-w-xl text-right" data-testid="attach-transcript-video-dialog">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-right"><Captions className="h-5 w-5" /> חיבור התמלול לווידאו</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {source === "file"
              ? "הכתוביות יוטמעו לפי קובץ הכתוביות שהעלית."
              : "הכתוביות יוטמעו כמסלולים מתחלפים לפי התזמונים של התמלול הפתוח. אפשר גם להעלות קובץ כתוביות משלך."}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <input ref={inputRef} type="file" accept="video/*,.mp4,.mkv,.mov,.webm" className="hidden" onChange={(event) => setVideo(event.target.files?.[0] || null)} />
          <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 py-3" onClick={() => inputRef.current?.click()} disabled={working}>
            <FileVideo className="h-5 w-5 shrink-0" />
            <span className="min-w-0 text-right"><span className="block truncate font-medium">{video?.name || "בחר קובץ וידאו"}</span><span className="block text-xs text-muted-foreground">MP4, MKV, MOV או WebM</span></span>
          </Button>

          {/* קובץ כתוביות, כשהתמלול אינו פתוח בעורך */}
          <input
            ref={subsRef}
            type="file"
            accept=".srt,.vtt,.webvtt,text/vtt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadSubtitles(file);
              event.target.value = "";
            }}
          />
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void loadSubtitles(file);
            }}
          >
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-3"
              onClick={() => subsRef.current?.click()}
              disabled={working}
            >
              <FileText className="h-5 w-5 shrink-0" />
              <span className="min-w-0 text-right">
                <span className="block truncate font-medium">
                  {subsFile?.name || "קובץ כתוביות (לא חובה)"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {subsFile
                    ? "הקובץ הזה יחליף את התמלול הפתוח"
                    : "גרור לכאן או לחץ · srt או vtt · בלעדיו ישמש התמלול הפתוח"}
                </span>
              </span>
            </Button>
          </div>

          {subsError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">{subsError}</span>
            </div>
          )}

          {subsInfo && !subsError && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 p-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                <span className="truncate">{subsInfo}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSubtitles}
                disabled={working}
                className="h-7 shrink-0 gap-1"
              >
                <X className="h-3.5 w-3.5" />
                בטל
              </Button>
            </div>
          )}

          {/* איך הכתוביות ייכנסו */}
          <div className="space-y-2">
            <Label className="block">איך הכתוביות ייכנסו</Label>
            <div className="space-y-1.5">
              {SUBTITLE_MODES.map((m) => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    disabled={working}
                    className={[
                      "w-full rounded-lg border p-3 text-right transition-colors duration-[83ms]",
                      active
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border/60 hover:border-primary/40 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={[
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          active ? "border-primary" : "border-muted-foreground/40",
                        ].join(" ")}
                        aria-hidden
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <span className="text-sm font-medium">{m.label}</span>
                      {savedDefault === m.id && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          ברירת מחדל
                        </span>
                      )}
                      {m.reencodes && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                          דוחס מחדש
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {m.body}
                    </span>
                    {active && (
                      <span className="mt-1.5 block border-r-2 border-primary/30 pr-2 text-xs text-muted-foreground">
                        {m.when}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {mode !== savedDefault && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => {
                  setDefaultSubtitleMode(mode);
                  setSavedDefault(mode);
                  toast({
                    title: "ברירת המחדל עודכנה",
                    description: `מעכשיו ייבחר "${modeInfo.label}" אוטומטית.`,
                  });
                }}
                className="h-7 gap-1.5 text-xs text-muted-foreground"
              >
                <Check className="h-3 w-3" />
                קבע את הבחירה הזאת כברירת מחדל
              </Button>
            )}
          </div>

          <div>
            <Label className="mb-2 block">
              שפות כתוביות
              {!modeInfo.multiLanguage && (
                <span className="mr-2 text-xs font-normal text-muted-foreground">
                  — בצריבה אפשר שפה אחת בלבד
                </span>
              )}
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((language) => (
                <label key={language.code} className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm">
                  <Checkbox checked={languages.includes(language.code)} onCheckedChange={(checked) => toggleLanguage(language.code, checked === true)} disabled={working} />
                  {language.label}
                </label>
              ))}
            </div>
          </div>

          {languages.some((language) => language !== "he") && (
            <div>
              <Label className="mb-2 block">מנוע תרגום</Label>
              <Select value={model} onValueChange={setModel} disabled={working}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google/gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                  <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                  <SelectItem value="openai/gpt-5-mini">GPT-5 Mini</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!segments.length && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
              אין תזמונים לעבוד איתם. אפשר להעלות קובץ כתוביות למעלה, או לבצע
              "יישור מדויק" לתמלול הפתוח מול האודיו.
            </p>
          )}
          {working && <div className="space-y-1"><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="text-xs text-muted-foreground">{progress < 88 ? "מתרגם ומכין כתוביות..." : "מחבר את הכתוביות לווידאו..."}</p></div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>סגור</Button>
          <Button type="button" onClick={() => void createVideo()} disabled={working || !video || !segments.length || !languages.length}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} צור והורד וידאו
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
