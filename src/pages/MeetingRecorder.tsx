import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Captions,
  ChevronDown,
  CircleDot,
  Download,
  ExternalLink,
  Info,
  Layers,
  Loader2,
  Mic,
  MonitorSpeaker,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  Video,
  X,
  StickyNote,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { debugLog } from "@/lib/debugLogger";
import {
  QUALITY_PRESETS,
  useMeetingRecorder,
  type QualityPreset,
} from "@/hooks/useMeetingRecorder";
import {
  meetingDbApi,
  type MeetingRecording,
  type SourceMode,
} from "@/lib/meetingRecorderDb";
import { useCloudFolders } from "@/hooks/useCloudFolders";
import { useAuth } from "@/contexts/AuthContext";

const LOCAL_FOLDERS_KEY = "local_folders";

// ─── Platform guide definitions ────────────────────────────────────────────
type PlatformId = "meet" | "zoom-web" | "whatsapp" | "teams" | "zoom-app";

interface PlatformDef {
  id: PlatformId;
  label: string;
  url: string | null;
  emoji: string;
  steps: string[];
  warning?: string;
  tip?: string;
  vbCableLink?: boolean;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: "meet",
    label: "Google Meet",
    url: "https://meet.google.com",
    emoji: "📹",
    steps: [
      'לחץ "פתח Google Meet" — ייפתח בלשונית חדשה. הצטרף לפגישה.',
      'חזור לדף זה ולחץ "התחל הקלטה".',
      'בחלון השיתוף → בחר "לשונית" (Tab) → בחר את לשונית Meet.',
      'חובה: סמן "שתף את אודיו הלשונית" בתחתית החלון.',
      'לחץ "שיתוף" — ההקלטה תתחיל מיד.',
    ],
    tip: 'Google Meet עובד מצוין ב-Chrome — האודיו של כל המשתתפים מוקלט בבהירות מלאה.',
  },
  {
    id: "zoom-web",
    label: "Zoom (דפדפן)",
    url: "https://app.zoom.us/wc",
    emoji: "🎥",
    steps: [
      'לחץ "פתח Zoom Web" — Zoom ייפתח בדפדפן ללא התקנת אפליקציה.',
      'הזן Meeting ID ולחץ "Join".',
      'חזור לדף זה ולחץ "התחל הקלטה".',
      'בחלון השיתוף → "לשונית" → בחר את לשונית Zoom.',
      'חובה: סמן "שתף את אודיו הלשונית".',
      'לחץ "שיתוף".',
    ],
    warning: 'אם Zoom מבקש להוריד אפליקציה — חפש "join from your browser" בעמוד.',
    tip: 'בחר "Use web client" כדי לדלג על ההורדה וישירות לפגישה בלשונית.',
  },
  {
    id: "whatsapp",
    label: "WhatsApp Web",
    url: "https://web.whatsapp.com",
    emoji: "📱",
    steps: [
      'לחץ "פתח WhatsApp Web" וסרוק QR-code עם הטלפון.',
      'פתח שיחת וידאו קבוצתית ב-WhatsApp Web.',
      'חזור לדף זה ולחץ "התחל הקלטה".',
      'בחלון השיתוף → "לשונית" → בחר את לשונית WhatsApp.',
      'סמן "שתף את אודיו הלשונית" ולחץ "שיתוף".',
    ],
    tip: 'WhatsApp Web תומך כעת בשיחות קבוצתיות בדפדפן — ניתן להקליט את כל המשתתפים.',
  },
  {
    id: "teams",
    label: "MS Teams",
    url: "https://teams.microsoft.com",
    emoji: "👥",
    steps: [
      'לחץ "פתח Teams" ובחר "Use Teams on the web".',
      'הצטרף לפגישה בלשונית הדפדפן.',
      'חזור לדף זה ולחץ "התחל הקלטה".',
      'בחלון השיתוף → "לשונית" → בחר את לשונית Teams.',
      'סמן "שתף את האודיו" ולחץ "שיתוף".',
    ],
    tip: 'בחר "Web app" בהתחלה ולא "Desktop app" כדי ש-Teams יפעל בתוך הלשונית.',
  },
  {
    id: "zoom-app",
    label: "Zoom / ‏WhatsApp Desktop",
    url: null,
    emoji: "🖥",
    vbCableLink: true,
    steps: [
      'הורד והתקן VB-Audio Virtual Cable (חינמי — קישור בטיפ למטה).',
      'Windows: הגדרות קול → "CABLE Input" → הגדר כהתקן השמעה ברירת מחדל.',
      'Zoom Desktop: הגדרות → אודיו → רמקול: "CABLE Input".',
      'חזור לדף זה → בחר מקור "מיקרופון בלבד" → בחר "CABLE Output" כמיקרופון.',
      'לחץ "התחל הקלטה" — כל האודיו מ-Zoom/WhatsApp Desktop יוקלט.',
    ],
    warning:
      'בזמן ההקלטה לא תשמע קול מהרמקולים כי האודיו מנותב פנימה. אפשר להוסיף Voicemeeter (חינמי) לשמיעה מקבילה.',
    tip: 'הורד VB-Cable בחינם: vb-audio.com/Cable — עובד עם כל אפליקציית דסקטופ: Zoom, WhatsApp, Teams.',
  },
];
// ───────────────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<SourceMode, string> = {
  mic: "מיקרופון בלבד",
  system: "אודיו לשונית/מערכת",
  both: "מיקרופון + אודיו מערכת",
};

const SOURCE_HINTS: Record<SourceMode, string> = {
  mic: "מקליט מהמיקרופון בלבד — מתאים לפגישת לקוח פיזית או הכתבה.",
  system:
    "מקליט את האודיו של לשונית הדפדפן/מסך. בחלון השיתוף — חובה לסמן 'שתף את האודיו'.",
  both:
    "מקליט גם אותך וגם את שאר המשתתפים בזום/מיט. מומלץ לפגישות מקוונות בלשונית.",
};

const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const fmtDateTime = (ms: number) => new Date(ms).toLocaleString("he-IL");

const getLocalFolders = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_FOLDERS_KEY) || "[]");
  } catch {
    return [];
  }
};

const MeetingRecorder = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { folders: cloudFolders } = useCloudFolders();

  const [sourceMode, setSourceMode] = useState<SourceMode>("both");
  const [preset, setPreset] = useState<QualityPreset>("balanced");
  const [platformGuide, setPlatformGuide] = useState<PlatformId>("meet");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState<string>("__none__");
  const [noteDraft, setNoteDraft] = useState("");

  // Live transcription (Web Speech API)
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveTranscribingOn, setLiveTranscribingOn] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Library UX
  const [librarySearch, setLibrarySearch] = useState("");
  const [librarySort, setLibrarySort] = useState<"date" | "duration" | "size">("date");

  const [library, setLibrary] = useState<MeetingRecording[]>([]);
  const [orphans, setOrphans] = useState<MeetingRecording[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const folderOptions = useMemo(() => {
    if (isAuthenticated) return cloudFolders.map((f) => f.name);
    return getLocalFolders();
  }, [isAuthenticated, cloudFolders]);

  const refreshLibrary = useCallback(async () => {
    const all = await meetingDbApi.listRecordings();
    setLibrary(all.filter((r) => r.status === "completed"));
    setOrphans(all.filter((r) => r.status === "recording"));
  }, []);

  useEffect(() => {
    void refreshLibrary();
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { state, start, pause, resume, stop, addNote, removeNote } = useMeetingRecorder({
    onFinalized: async (file, rec) => {
      await refreshLibrary();
      toast({
        title: "✅ ההקלטה נשמרה",
        description: `${rec.fileName} • ${fmtSize(file.size)} • ${formatTime(rec.durationMs)}`,
      });
    },
  });

  // ── Live transcript via Web Speech API ──────────────────────────
  useEffect(() => {
    const SR =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR || !liveTranscribingOn || !state.isRecording || state.isPaused) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: SpeechRecognition = new (SR as any)();
    rec.lang = "he-IL";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let buf = "";
      for (let i = 0; i < e.results.length; i++) {
        buf += e.results[i][0].transcript + " ";
      }
      setLiveTranscript(buf.trim());
    };
    rec.onerror = () => {};
    recognitionRef.current = rec;
    rec.start();
    return () => {
      rec.stop();
      recognitionRef.current = null;
    };
  }, [liveTranscribingOn, state.isRecording, state.isPaused]);

  // Reset live transcript when a new recording starts
  useEffect(() => {
    if (state.isStarting) setLiveTranscript("");
  }, [state.isStarting]);

  // ── Library filtering / sorting ───────────────────────────────────
  const filteredLibrary = useMemo(() => {
    let result = [...library];
    if (librarySearch.trim()) {
      const q = librarySearch.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.folder ?? "").toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      if (librarySort === "duration") return b.durationMs - a.durationMs;
      if (librarySort === "size") return b.sizeBytes - a.sizeBytes;
      return b.startedAt - a.startedAt;
    });
    return result;
  }, [library, librarySearch, librarySort]);

  const totalRecordingMs = useMemo(
    () => library.reduce((acc, r) => acc + r.durationMs, 0),
    [library]
  );

  const handleStart = () => {
    void start({
      sourceMode,
      preset,
      title: title.trim(),
      folder: folder === "__none__" ? null : folder,
    });
  };

  // One-click quick-start: open platform tab + auto-start recording immediately
  const handleQuickStart = (platform: PlatformDef) => {
    const autoTitle = `פגישת ${platform.label} — ${new Date().toLocaleDateString("he-IL")}`;
    if (platform.url) {
      window.open(platform.url, "_blank", "noopener,noreferrer");
    }
    setTitle(autoTitle);
    setSourceMode("both");
    // Show tab-share instruction before getDisplayMedia dialog appears
    toast({
      title: `${platform.emoji} בחלון השיתוף שייפתח:`,
      description: `1. בחר "לשונית" ← ${platform.label}\n2. ☑️ סמן "שתף את אודיו הלשונית"\n3. לחץ "שיתוף"`,
      duration: 20_000,
    });
    void start({
      sourceMode: "both",
      preset,
      title: autoTitle,
      folder: folder === "__none__" ? null : folder,
    });
  };

  // One-click mic-only (face-to-face / dictation)
  const handleMicOnly = () => {
    const autoTitle = `פגישה פיזית — ${new Date().toLocaleDateString("he-IL")}`;
    setTitle(autoTitle);
    setSourceMode("mic");
    void start({
      sourceMode: "mic",
      preset,
      title: autoTitle,
      folder: folder === "__none__" ? null : folder,
    });
  };

  const handleAddNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    void addNote(text);
    setNoteDraft("");
  };

  const handleNoteKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddNote();
    }
  };

  const playRecording = async (rec: MeetingRecording) => {
    if (!rec.assembled) {
      toast({ title: "ההקלטה לא זמינה לנגינה", variant: "destructive" });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(rec.assembled);
    setPreviewUrl(url);
    setPreviewId(rec.id);
  };

  const downloadRecording = (rec: MeetingRecording) => {
    if (!rec.assembled) return;
    const url = URL.createObjectURL(rec.assembled);
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sendToTranscribe = (rec: MeetingRecording) => {
    if (!rec.assembled) return;
    const file = new File([rec.assembled], rec.fileName, { type: rec.config.mimeType });
    const notesBlock =
      rec.notes.length > 0
        ? rec.notes.map((n) => `[${formatTime(n.timeMs)}] ${n.text}`).join("\n")
        : "";
    toast({ title: "📤 שולח לתמלול", description: rec.fileName });
    navigate("/transcribe", {
      state: {
        file,
        meetingMeta: {
          title: rec.title,
          folder: rec.folder,
          notes: notesBlock,
        },
      },
    });
  };

  const deleteRecording = async (rec: MeetingRecording) => {
    if (!confirm(`למחוק את ההקלטה "${rec.title}"? פעולה זו אינה הפיכה.`)) return;
    await meetingDbApi.deleteRecording(rec.id);
    if (previewId === rec.id && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewId(null);
    }
    await refreshLibrary();
    toast({ title: "🗑 ההקלטה נמחקה" });
  };

  const recoverOrphan = async (rec: MeetingRecording) => {
    try {
      const blob = await meetingDbApi.assembleFromChunks(rec.id, rec.config.mimeType);
      if (!blob) {
        toast({ title: "אין נתונים לשחזור", variant: "destructive" });
        await meetingDbApi.deleteRecording(rec.id);
        await refreshLibrary();
        return;
      }
      await meetingDbApi.updateRecording(rec.id, {
        status: "completed",
        endedAt: Date.now(),
        sizeBytes: blob.size,
        assembled: blob,
      });
      await meetingDbApi.clearChunks(rec.id);
      await refreshLibrary();
      toast({
        title: "🔄 ההקלטה שוחזרה",
        description: `${rec.fileName} • ${fmtSize(blob.size)}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.error("MeetingRecorder", "Recover failed", msg);
      toast({ title: "שחזור נכשל", description: msg, variant: "destructive" });
    }
  };

  const discardOrphan = async (rec: MeetingRecording) => {
    if (!confirm(`למחוק את ההקלטה החלקית "${rec.title}"?`)) return;
    await meetingDbApi.deleteRecording(rec.id);
    await refreshLibrary();
  };

  const sourceOptions: { value: SourceMode; icon: React.ElementType }[] = [
    { value: "mic", icon: Mic },
    { value: "system", icon: MonitorSpeaker },
    { value: "both", icon: Layers },
  ];

  const isBusy = state.isRecording || state.isStarting || state.isFinalizing;

  return (
    <div dir="rtl" className="container max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Video className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">מקליט פגישות</h1>
          <p className="text-sm text-muted-foreground">
            הקלטה מקצועית של פגישות, Zoom, Google Meet — עם גיבוי אוטומטי, הערות ושיוך לתיקיות.
          </p>
        </div>
      </div>

      {orphans.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>נמצאו הקלטות שלא נסגרו כראוי</AlertTitle>
          <AlertDescription className="space-y-2 mt-2">
            <div className="text-xs">
              ייתכן שהדפדפן/הלשונית נסגרו באמצע הקלטה. ניתן לשחזר את הנתונים שכבר נכתבו לדיסק:
            </div>
            <div className="space-y-2">
              {orphans.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-2 bg-background/50 rounded p-2"
                >
                  <div className="text-xs">
                    <div className="font-semibold">{o.title}</div>
                    <div className="opacity-70">
                      {fmtDateTime(o.startedAt)} • {fmtSize(o.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="default" onClick={() => recoverOrphan(o)}>
                      שחזר
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => discardOrphan(o)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card className="p-5 space-y-5">

        {/* ─── One-click quick-start ─── */}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold mb-0.5">הקלטה מהירה — בלחיצה אחת</h2>
            <p className="text-xs text-muted-foreground">
              לחץ על הפלטפורמה — תיפתח לשונית חדשה ותתחיל ההקלטה אוטומטית.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PLATFORMS.filter((p) => p.id !== "zoom-app").map((platform) => (
              <button
                key={platform.id}
                onClick={() => handleQuickStart(platform)}
                disabled={isBusy}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                  isBusy
                    ? "opacity-50 cursor-not-allowed"
                    : "border-border hover:border-primary hover:bg-primary/5 active:scale-95"
                }`}
              >
                <span className="text-3xl leading-none">{platform.emoji}</span>
                <span className="text-xs font-semibold text-center leading-snug">
                  {platform.label}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={handleMicOnly}
            disabled={isBusy}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed text-right transition-all ${
              isBusy
                ? "opacity-50 cursor-not-allowed"
                : "border-border hover:border-primary hover:bg-primary/5"
            }`}
          >
            <Mic className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-sm font-semibold">🎤 פגישה פיזית / הכתבה</div>
              <div className="text-xs text-muted-foreground">מיקרופון בלבד — ללא שיתוף מסך</div>
            </div>
          </button>
          <div className="flex gap-2 text-xs text-muted-foreground rounded-lg border p-3 bg-muted/30">
            <MonitorSpeaker className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Zoom Desktop / WhatsApp Desktop?{" "}
              <a
                href="https://vb-audio.com/Cable"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold hover:text-foreground"
              >
                הורד VB-Cable בחינם
              </a>{" "}
              → הגדרות מתקדמות למטה.
            </span>
          </div>
        </div>

        <Separator />

        {/* ─── Advanced settings (collapsed) ─── */}
        <details>
          <summary className="cursor-pointer list-none text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 select-none">
            <ChevronDown className="w-3.5 h-3.5" />
            הגדרות מתקדמות (שם, תיקיה, איכות, מקור מותאם)
          </summary>
          <div className="mt-4 space-y-4">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">
              שם ההקלטה
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              placeholder={`פגישה ${new Date().toLocaleDateString("he-IL")}`}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">
              תיקיה (אופציונלי)
            </label>
            <Select value={folder} onValueChange={setFolder} disabled={isBusy}>
              <SelectTrigger>
                <SelectValue placeholder="ללא תיקיה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">ללא תיקיה</SelectItem>
                {folderOptions.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div>
          <h2 className="text-sm font-semibold mb-3">מקור ההקלטה</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {sourceOptions.map((opt) => {
              const Icon = opt.icon;
              const active = sourceMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => !isBusy && setSourceMode(opt.value)}
                  disabled={isBusy}
                  className={`text-right p-3 rounded-lg border transition-all flex items-start gap-3 ${
                    active
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50 hover:bg-muted"
                  } ${isBusy ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      active ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <div className="text-xs">
                    <div className="font-semibold">{SOURCE_LABELS[opt.value]}</div>
                    <div className="opacity-70 leading-snug mt-1">
                      {SOURCE_HINTS[opt.value]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-3">איכות</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {QUALITY_PRESETS.map((p) => {
              const active = preset === p.preset;
              return (
                <button
                  key={p.preset}
                  onClick={() => !isBusy && setPreset(p.preset)}
                  disabled={isBusy}
                  className={`text-right p-3 rounded-lg border transition-all ${
                    active
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50 hover:bg-muted"
                  } ${isBusy ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className="text-xs opacity-70 leading-snug mt-1">
                    {p.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {(sourceMode === "system" || sourceMode === "both") && (() => {
          const activePlatform = PLATFORMS.find((p) => p.id === platformGuide)!;
          return (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
              {/* Platform picker */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                  מדריך לפלטפורמה:
                </span>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatformGuide(p.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      platformGuide === p.id
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "border-border hover:border-primary/50 hover:bg-muted"
                    }`}
                  >
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>

              {/* Active platform guide */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm font-semibold">
                    {activePlatform.emoji} מדריך — {activePlatform.label}
                  </div>
                  {activePlatform.url && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs h-7"
                      onClick={() =>
                        window.open(activePlatform.url!, "_blank", "noopener,noreferrer")
                      }
                    >
                      <ExternalLink className="w-3 h-3" />
                      פתח {activePlatform.label}
                    </Button>
                  )}
                </div>

                <ol className="space-y-2 pr-1">
                  {activePlatform.steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-xs leading-snug">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-[10px] mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                {activePlatform.warning && (
                  <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md p-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{activePlatform.warning}</span>
                  </div>
                )}

                {activePlatform.tip && (
                  <div className="flex gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {activePlatform.vbCableLink ? (
                      <span>
                        {activePlatform.tip.split("vb-audio.com/Cable")[0]}
                        <a
                          href="https://vb-audio.com/Cable"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-semibold"
                        >
                          vb-audio.com/Cable
                        </a>
                        {activePlatform.tip.split("vb-audio.com/Cable")[1]}
                      </span>
                    ) : (
                      <span>{activePlatform.tip}</span>
                    )}
                  </div>
                )}

                <div className="flex gap-1.5 text-xs text-muted-foreground border-t pt-2.5 mt-1">
                  <CircleDot className="w-3 h-3 shrink-0 mt-0.5 text-green-500" />
                  <span>
                    כל 5 שניות ההקלטה מגובה אוטומטית — גם אם הדפדפן נסגר, ניתן לשחזר מהדף הזה.
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

            <Button
              onClick={handleStart}
              disabled={isBusy}
              className="w-full gap-2 mt-2"
            >
              {state.isStarting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
              התחל הקלטה מותאמת אישית
            </Button>
          </div>
        </details>
      </Card>

      {isBusy && (
      <Card className="p-6 space-y-4">
        {state.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{state.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {state.isRecording ? (
              <Badge variant="destructive" className="gap-1">
                <CircleDot className="w-3 h-3 animate-pulse" />
                {state.isPaused ? "מושהה" : "מקליט"}
              </Badge>
            ) : state.isFinalizing ? (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> מסיים
              </Badge>
            ) : state.isStarting ? (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> מתחיל
              </Badge>
            ) : (
              <Badge variant="secondary">מוכן</Badge>
            )}
            <span className="text-3xl font-mono font-bold tabular-nums">
              {formatTime(state.durationMs)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {state.isRecording && (
              <>
                <Button
                  onClick={state.isPaused ? resume : pause}
                  variant="secondary"
                  size="lg"
                  className="gap-2"
                >
                  {state.isPaused ? (
                    <Play className="w-5 h-5" />
                  ) : (
                    <Pause className="w-5 h-5" />
                  )}
                  {state.isPaused ? "המשך" : "השהה"}
                </Button>
                <Button
                  onClick={() => void stop()}
                  variant="destructive"
                  size="lg"
                  className="gap-2"
                  disabled={state.isFinalizing}
                >
                  <Square className="w-5 h-5" />
                  עצור
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-l from-green-500 via-yellow-500 to-red-500 transition-[width] duration-100"
            style={{ width: `${Math.min(100, state.audioLevel * 140)}%` }}
          />
        </div>

        {state.isRecording && (
          <div className="space-y-2 pt-2">
            {/* ── Live Transcription toggle ── */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLiveTranscribingOn((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${
                  liveTranscribingOn
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary/60 hover:bg-muted"
                }`}
              >
                <Captions className="w-3.5 h-3.5" />
                {liveTranscribingOn ? "כבה תמלול חי" : "הפעל תמלול חי"}
              </button>
              {liveTranscribingOn && (
                <span className="text-xs text-muted-foreground">
                  Chrome / Edge בעברית — זיהוי קולי בזמן אמת
                </span>
              )}
            </div>
            {liveTranscribingOn && liveTranscript && (
              <div
                dir="rtl"
                className="text-sm bg-muted/50 border rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed"
              >
                {liveTranscript}
              </div>
            )}

            <div className="flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">הערות בזמן אמת</h3>
              <span className="text-xs text-muted-foreground">
                Ctrl+Enter להוספה מהירה
              </span>
            </div>
            <div className="flex gap-2">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={handleNoteKey}
                placeholder="כתוב הערה ולחץ Ctrl+Enter — ההערה תקבל חותמת זמן אוטומטית"
                rows={2}
                className="text-sm"
              />
              <Button
                onClick={handleAddNote}
                size="icon"
                variant="secondary"
                className="self-stretch"
                disabled={!noteDraft.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {state.notes.length > 0 && (
              <ScrollArea className="max-h-48 border rounded-lg p-2">
                <div className="space-y-1">
                  {state.notes
                    .slice()
                    .reverse()
                    .map((n) => (
                      <div
                        key={n.id}
                        className="flex items-start gap-2 p-2 rounded hover:bg-muted text-xs group"
                      >
                        <Badge variant="outline" className="font-mono shrink-0">
                          {formatTime(n.timeMs)}
                        </Badge>
                        <div className="flex-1 whitespace-pre-wrap break-words">
                          {n.text}
                        </div>
                        <button
                          onClick={() => void removeNote(n.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                          title="מחק הערה"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </Card>
      )}

      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">ספריית ההקלטות</h2>
            <Badge variant="secondary">{library.length}</Badge>
          </div>
          {library.length > 0 && (
            <div className="text-xs text-muted-foreground">
              סה"כ: {formatTime(totalRecordingMs)}
            </div>
          )}
        </div>
        {library.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="חפש לפי שם או תיקיה..."
                className="pr-8 text-sm h-9"
              />
            </div>
            <div className="flex items-center gap-1 text-xs">
              {(["date", "duration", "size"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setLibrarySort(s)}
                  className={`px-2.5 py-1 rounded-full border transition-all ${
                    librarySort === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary/60 hover:bg-muted"
                  }`}
                >
                  {s === "date" ? "תאריך" : s === "duration" ? "משך" : "גודל"}
                </button>
              ))}
            </div>
          </div>
        )}
        {library.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            אין הקלטות שמורות עדיין. ההקלטות נשמרות אוטומטית במכשיר (IndexedDB).
          </p>
        ) : filteredLibrary.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            אין תוצאות לחיפוש "{librarySearch}".
          </p>
        ) : (
          <div className="space-y-3">
            {filteredLibrary.map((rec) => (
              <div
                key={rec.id}
                className={`border rounded-lg p-3 space-y-2 transition-colors ${
                  previewId === rec.id ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{rec.title}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
                      <span>{fmtDateTime(rec.startedAt)}</span>
                      <span>•</span>
                      <span>{formatTime(rec.durationMs)}</span>
                      <span>•</span>
                      <span>{fmtSize(rec.sizeBytes)}</span>
                      <span>•</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {SOURCE_LABELS[rec.sourceMode]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        {rec.config.preset}
                      </Badge>
                      {rec.folder && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          📁 {rec.folder}
                        </Badge>
                      )}
                      {rec.notes.length > 0 && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          📝 {rec.notes.length} הערות
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void playRecording(rec)}
                      title="נגן"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadRecording(rec)}
                      title="הורד"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => sendToTranscribe(rec)}
                      className="gap-1"
                    >
                      <Send className="w-3.5 h-3.5" />
                      תמלל
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteRecording(rec)}
                      title="מחק"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {previewId === rec.id && previewUrl && (
                  <audio src={previewUrl} controls className="w-full" autoPlay />
                )}
                {rec.notes.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      הצג {rec.notes.length} הערות
                    </summary>
                    <div className="mt-2 space-y-1 pr-2 border-r-2 border-primary/30">
                      {rec.notes.map((n) => (
                        <div key={n.id} className="flex gap-2 items-start">
                          <Badge
                            variant="outline"
                            className="font-mono shrink-0 text-[10px]"
                          >
                            {formatTime(n.timeMs)}
                          </Badge>
                          <span className="whitespace-pre-wrap">{n.text}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MeetingRecorder;
