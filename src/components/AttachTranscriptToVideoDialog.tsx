import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Captions, Check, Download, FileText, FileVideo, Library, Loader2, Pencil, X } from "lucide-react";
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

/** תמלול שמור באתר, כפי שהוא מגיע מספריית התמלולים. */
export interface LibraryTranscriptOption {
  id: string;
  title: string;
  created_at: string;
  word_timings?: Array<{ word: string; start: number; end: number }> | null;
}

/**
 * מאיפה מגיע הטקסט שייהפך לכתוביות.
 *
 *   open     התמלול שפתוח עכשיו בעורך — מה שהרגע תומלל.
 *   library  תמלול שמור באתר, מהספרייה.
 *   file     קובץ כתוביות מהמחשב.
 *
 * למה בחירה מפורשת ולא ניחוש: קודם לכן הקובץ שהועלה פשוט גבר על
 * התמלול הפתוח. זה עבד, אבל המשתמש לא ראה מה נבחר בפועל — ולא
 * הייתה שום דרך להגיע לתמלול שמור באתר בלי לפתוח אותו קודם בעורך.
 */
type SourceKind = "open" | "library" | "file";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wordTimings: WordTiming[];
  transcriptTitle?: string;
  /** התמלולים השמורים באתר. מגיעים מבחוץ כדי לא לטעון אותם פעמיים. */
  libraryTranscripts?: LibraryTranscriptOption[];
}

const LANGUAGES = TRANSLATION_LANGUAGES.filter((language) => ["he", "en", "de", "fr", "es", "yi"].includes(language.code));

/**
 * כותרת שלב ממוספרת.
 *
 * למה מספר ולא רק כותרת: בחלון הזה שלוש החלטות נפרדות — אילו
 * קבצים, באיזו צורה, ובאילו שפות. בלי מספור הן נראות כרשימה
 * אחת ארוכה, ולא ברור מה חובה ומה כבר נבחר.
 */
/** תאריך קצר וקריא, בלי שעה — ברשימה ארוכה השעה רק מרעישה. */
function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * אפשרות אחת לבחירת מקור הטקסט.
 *
 * אפשרות שאינה זמינה מוצגת ולא מוסתרת: המשתמש צריך לדעת שהיא
 * קיימת ולמה אי אפשר לבחור בה עכשיו. הסיבה כתובה בשורת ההסבר.
 */
function SourceOption({
  active, disabled, onClick, icon, title, note,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2 rounded-lg border p-3 text-right transition-colors duration-[83ms]",
        disabled ? "cursor-not-allowed opacity-50" : "",
        active && !disabled
          ? "border-primary bg-primary/[0.06]"
          : "border-border/60 hover:border-primary/40 hover:bg-muted/40",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          active && !disabled ? "border-primary" : "border-muted-foreground/40",
        ].join(" ")}
        aria-hidden
      >
        {active && !disabled && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className={active && !disabled ? "shrink-0 text-primary" : "shrink-0 text-muted-foreground"}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}

function Step({ number, title, note }: { number: number; title: string; note?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {number}
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <span className="text-xs font-normal text-muted-foreground">— {note}</span>}
    </div>
  );
}

export function AttachTranscriptToVideoDialog({
  open, onOpenChange, wordTimings, transcriptTitle, libraryTranscripts = [],
}: Props) {
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

  // רק תמלולים שיש להם תזמונים. בלי תזמונים אין ממה לבנות כתוביות,
  // והצגתם ברשימה הייתה מבטיחה משהו שייכשל אחרי הבחירה.
  const libraryOptions = useMemo(
    () => libraryTranscripts.filter((t) => (t.word_timings?.length ?? 0) > 0),
    [libraryTranscripts]);

  const [sourceKind, setSourceKind] = useState<SourceKind>("open");
  const [libraryId, setLibraryId] = useState<string>("");

  // בכל פתיחה מתחילים מהמקור הזמין ביותר: מה שפתוח עכשיו, ואם אין
  // תזמונים — הספרייה, ואם גם היא ריקה — קובץ.
  useEffect(() => {
    if (!open) return;
    setSourceKind(openTimings.length ? "open" : libraryOptions.length ? "library" : "file");
  }, [open, openTimings.length, libraryOptions.length]);

  const librarySelected = useMemo(
    () => libraryOptions.find((t) => t.id === libraryId) || null,
    [libraryOptions, libraryId]);
  const libraryTimings = useMemo(
    () => (librarySelected?.word_timings?.length
      ? wordTimingsToSubtitleSegments(librarySelected.word_timings as WordTiming[])
      : []),
    [librarySelected]);

  const segments = sourceKind === "file"
    ? fileTimings
    : sourceKind === "library" ? libraryTimings : openTimings;
  const source = sourceKind;

  const loadSubtitles = async (file: File) => {
    setSourceKind("file");
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
    setSourceKind(openTimings.length ? "open" : libraryOptions.length ? "library" : "file");
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
      <DialogContent
        dir="rtl"
        className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 text-right"
        data-testid="attach-transcript-video-dialog"
      >
        {/*
          הראש והכפתורים קבועים, והאמצע נגלל.

          למה: לחלון אין גובה מרבי מלידה, והתוכן כאן ארוך. במסך
          נמוך הכותרת וכפתור היצירה נדחקו מחוץ למסך, והמשתמש ראה
          חלון חתוך בלי דרך להגיע לכפתור.
        */}
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6 text-right">
          <DialogTitle className="flex items-center gap-2 text-right">
            <Captions className="h-5 w-5" /> חיבור התמלול לווידאו
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {source === "file"
              ? "הכתוביות ייבנו מקובץ הכתוביות שהעלית."
              : source === "library"
                ? "הכתוביות ייבנו מתמלול שמור באתר."
                : "הכתוביות ייבנו מהתמלול שפתוח עכשיו. אפשר גם לבחור תמלול שמור או קובץ."}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">

          <section className="space-y-3">
            <Step number={1} title="קובץ הווידאו" />

            <input ref={inputRef} type="file" accept="video/*,.mp4,.mkv,.mov,.webm" className="hidden" onChange={(event) => setVideo(event.target.files?.[0] || null)} />
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

            <Button
              type="button"
              variant="outline"
              className={[
                "h-auto w-full justify-start gap-3 py-3",
                video ? "border-primary/50 bg-primary/[0.04]" : "",
              ].join(" ")}
              onClick={() => inputRef.current?.click()}
              disabled={working}
            >
              <FileVideo className={["h-5 w-5 shrink-0", video ? "text-primary" : ""].join(" ")} />
              <span className="min-w-0 text-right">
                <span className="block truncate font-medium">{video?.name || "בחר קובץ וידאו"}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {video ? "לחץ כדי להחליף" : "חובה · MP4, MKV, MOV או WebM"}
                </span>
              </span>
            </Button>
          </section>

          <section className="space-y-3">
            <Step number={2} title="מאיפה הטקסט" />

            <div className="space-y-1.5">
              <SourceOption
                active={sourceKind === "open"}
                disabled={working || !openTimings.length}
                onClick={() => setSourceKind("open")}
                icon={<Pencil className="h-4 w-4" />}
                title="התמלול שפתוח עכשיו"
                note={openTimings.length
                  ? `${transcriptTitle || "ללא שם"} · ${openTimings.length} קטעים`
                  : "אין תזמונים לתמלול הפתוח"}
              />

              <SourceOption
                active={sourceKind === "library"}
                disabled={working || !libraryOptions.length}
                onClick={() => setSourceKind("library")}
                icon={<Library className="h-4 w-4" />}
                title="תמלול שמור באתר"
                note={libraryOptions.length
                  ? `${libraryOptions.length} תמלולים עם תזמונים`
                  : "אין באתר תמלול עם תזמונים"}
              />

              {sourceKind === "library" && libraryOptions.length > 0 && (
                <div className="pr-7">
                  <Select value={libraryId} onValueChange={setLibraryId} disabled={working}>
                    <SelectTrigger>
                      <SelectValue placeholder="בחר תמלול מהספרייה" />
                    </SelectTrigger>
                    <SelectContent>
                      {libraryOptions.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {/*
                            שתי שורות ולא אחת: השמות נוצרים אוטומטית
                            מתחילת הטקסט, ולכן הרבה מהם פותחים באותן
                            מילים. התאריך ומספר הקטעים הם מה שמבדיל
                            ביניהם בפועל.
                          */}
                          <span className="flex flex-col items-start gap-0.5 text-right">
                            <span className="line-clamp-1 max-w-[20rem]">{t.title || "ללא שם"}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(t.created_at)} · {t.word_timings?.length || 0} מילים
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void loadSubtitles(file);
                }}
              >
                <SourceOption
                  active={sourceKind === "file"}
                  disabled={working}
                  onClick={() => {
                    setSourceKind("file");
                    if (!subsFile) subsRef.current?.click();
                  }}
                  icon={<FileText className="h-4 w-4" />}
                  title="קובץ כתוביות מהמחשב"
                  note={subsFile?.name || "גרור לכאן או לחץ · srt או vtt"}
                />
              </div>

              {sourceKind === "file" && subsFile && (
                <div className="pr-7">
                  <Button type="button" variant="ghost" size="sm" onClick={clearSubtitles} disabled={working} className="h-7 gap-1 text-xs text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                    הסר את הקובץ
                  </Button>
                </div>
              )}
            </div>

            {subsError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">{subsError}</span>
              </div>
            )}

            {subsInfo && !subsError && sourceKind === "file" && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                <span className="min-w-0 truncate">{subsInfo}</span>
              </div>
            )}

            {!segments.length && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                {sourceKind === "library"
                  ? "בחר תמלול מהרשימה."
                  : sourceKind === "file"
                    ? "העלה קובץ כתוביות."
                    : "לתמלול הפתוח אין תזמונים. אפשר לבצע לו יישור מדויק מול האודיו, או לבחור מקור אחר."}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <Step number={3} title="איך הכתוביות ייכנסו" />

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
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                    <span className="mt-1 block pr-6 text-xs leading-relaxed text-muted-foreground">
                      {m.body}
                    </span>
                    {active && (
                      <span className="mr-6 mt-2 block border-r-2 border-primary/30 pr-2 text-xs text-muted-foreground">
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
          </section>

          <section className="space-y-3">
            <Step
              number={4}
              title="שפות"
              note={modeInfo.multiLanguage ? undefined : "בצריבה אפשר שפה אחת בלבד"}
            />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((language) => {
                const checked = languages.includes(language.code);
                return (
                  <label
                    key={language.code}
                    className={[
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-[83ms]",
                      checked ? "border-primary/50 bg-primary/[0.04]" : "border-border/60 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleLanguage(language.code, value === true)}
                      disabled={working}
                    />
                    {language.label}
                  </label>
                );
              })}
            </div>

            {languages.some((language) => language !== "he") && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">מנוע התרגום</Label>
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
          </section>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {working ? (
            <div className="w-full space-y-1 sm:order-1 sm:flex-1">
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress < 88 ? "מתרגם ומכין כתוביות..." : "מחבר את הכתוביות לווידאו..."}
              </p>
            </div>
          ) : (
            <p className="w-full text-xs text-muted-foreground sm:order-1 sm:flex-1">
              {!video
                ? "בחר קובץ וידאו כדי להמשיך"
                : !segments.length
                  ? "אין תזמונים — העלה קובץ כתוביות"
                  : !languages.length
                    ? "בחר לפחות שפה אחת"
                    : `${modeInfo.label} · ${languages.length === 1 ? "שפה אחת" : languages.length + " שפות"}`}
            </p>
          )}
          <div className="flex w-full gap-2 sm:order-2 sm:w-auto">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)} disabled={working}>
              סגור
            </Button>
            <Button
              type="button"
              className="flex-1 gap-2 sm:flex-none"
              onClick={() => void createVideo()}
              disabled={working || !video || !segments.length || !languages.length}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              צור והורד וידאו
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
