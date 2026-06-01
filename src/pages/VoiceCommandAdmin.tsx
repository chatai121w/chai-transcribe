import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  Activity, Mic, MicOff, Send, RefreshCw, Copy, CheckCheck,
  Terminal, Globe, Settings2, BookOpen, Zap, Circle,
  Play, Square, Wifi, WifiOff, ChevronDown, ChevronUp, Type, Cpu,
  Loader2, X, Keyboard, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SSEEvent {
  t: "log" | "state" | "heard" | "transcribed" | "task";
  msg?: string;
  ts?: string;
  state?: string;
  heard?: string;
  transcribed?: string;
  task?: string;
  text?: string;
}

interface LogEntry {
  id: number;
  ts: string;
  msg: string;
  cls: string;
}

interface StatusState {
  state: string;
  heard: string;
  transcribed: string;
  task: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const UI_PORT = 8765;
const BASE_URL = `http://localhost:${UI_PORT}`;

const TASK_RULES: { category: string; examples: string[]; result: string }[] = [
  { category: "🎬 YouTube", examples: ["פתח יוטיוב", "פתח יוטיב", "תפעיל יוטיוב"], result: "פותח youtube.com" },
  { category: "🗺️ מפות", examples: ["פתח גוגל מפות", "גוגל מפות"], result: "פותח maps.google.com" },
  { category: "🔍 גוגל", examples: ["פתח גוגל", "פתח את גוגל"], result: "פותח google.com" },
  { category: "💬 WhatsApp", examples: ["פתח ווטסאפ", "פתח וואטסאפ"], result: "פותח web.whatsapp.com" },
  { category: "📧 Gmail", examples: ["פתח ג'ימייל", "פתח מייל"], result: "פותח mail.google.com" },
  { category: "🎵 Spotify", examples: ["פתח ספוטיפיי", "פתח מוזיקה"], result: "פותח open.spotify.com" },
  { category: "📺 Netflix", examples: ["פתח נטפליקס", "פתח נטפלקס"], result: "פותח netflix.com" },
  { category: "📖 Wikipedia", examples: ["פתח ויקיפדיה", "פתח ויקי"], result: "פותח wikipedia.org" },
  { category: "💻 GitHub", examples: ["פתח גיטהאב", "פתח גיט"], result: "פותח github.com" },
  { category: "🐦 Twitter / X", examples: ["פתח טוויטר", "פתח איקס"], result: "פותח x.com" },
  { category: "🛒 Amazon", examples: ["פתח אמזון", "אמזון"], result: "פותח amazon.com" },
  { category: "📰 Walla / Ynet", examples: ["פתח וואלה", "פתח וינט", "פתח ידיעות"], result: "פותח walla.co.il / ynet.co.il" },
  { category: "🔎 חיפוש Google", examples: ["חפש בגוגל...", "תחפש...", "מצא לי..."], result: "חיפוש Google" },
  { category: "🔁 הפעלה מחדש", examples: ["הפעל מחדש", "ריסטרט", "הפעל מחדש את המחשב"], result: "shutdown /r /t 5" },
  { category: "⬇️ כיבוי", examples: ["כבה מחשב", "כיבוי", "תכבה"], result: "shutdown /s /t 5" },
  { category: "🔒 נעילה", examples: ["נעל מסך", "תנעל", "לוק"], result: "LockWorkStation()" },
  { category: "🧮 מחשבון", examples: ["חשב 25 כפול 4", "כמה זה 100 חלקי 5", "מה יוצא 3 בחזקת 2"], result: "מחשב ומדביק תוצאה" },
  { category: "📱 פתיחת אפליקציה", examples: ["פתח פנקס", "פתח מחשבון", "תפעיל סייר", "אפשר לפתוח..."], result: "מפעיל אפליקציה" },
];

const STATE_LABELS: Record<string, { label: string; color: string; pulse: boolean }> = {
  listening:  { label: "👂 מאזין לפקודה",  color: "bg-green-500",  pulse: true },
  recording:  { label: "🔴 מקליט",         color: "bg-red-500",    pulse: true },
  processing: { label: "⚙️ מעבד",          color: "bg-orange-500", pulse: false },
  idle:       { label: "💤 לא פעיל",        color: "bg-blue-400",   pulse: false },
};

function classifyLog(msg: string): string {
  if (msg.includes("🔴") || msg.includes("מקליט"))       return "text-red-600 font-semibold";
  if (msg.includes("🚀") || msg.includes("זוהתה") || msg.includes("wake word")) return "text-orange-600 font-semibold";
  if (msg.includes("⚙️") || msg.includes("משימה"))       return "text-purple-600 font-semibold";
  if (msg.includes("✅") || msg.includes("Groq"))         return "text-green-600";
  if (msg.includes("🎤") || msg.includes("שמעתי") || msg.includes("Web Speech")) return "text-blue-600";
  if (msg.includes("❌") || msg.includes("שגיאה") || msg.includes("⚠️")) return "text-red-600";
  if (msg.includes("🌐") || msg.includes("ממשק"))         return "text-cyan-700";
  if (msg.includes("🔔") || msg.includes("Wake Word"))   return "text-yellow-700 font-semibold";
  if (msg.includes("🔑") || msg.includes("Groq"))         return "text-emerald-600";
  return "text-blue-700";
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useSSE(baseUrl: string) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusState>({ state: "idle", heard: "", transcribed: "", task: "" });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const idRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((ts: string, msg: string) => {
    setLogs(prev => {
      const entry: LogEntry = { id: ++idRef.current, ts, msg, cls: classifyLog(msg) };
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${baseUrl}/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const ev: SSEEvent = JSON.parse(e.data);
        if (ev.t === "log" && ev.ts && ev.msg) {
          addLog(ev.ts, ev.msg);
        } else if (ev.t === "state") {
          setStatus(prev => ({
            state: ev.state || prev.state,
            heard: ev.heard || prev.heard,
            transcribed: ev.transcribed || prev.transcribed,
            task: ev.task || prev.task,
          }));
        } else if (ev.t === "heard" && ev.text) {
          setStatus(prev => ({ ...prev, heard: ev.text! }));
        } else if (ev.t === "transcribed" && ev.text) {
          setStatus(prev => ({ ...prev, transcribed: ev.text! }));
        } else if (ev.t === "task" && ev.text) {
          setStatus(prev => ({ ...prev, task: ev.text! }));
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      reconnectRef.current = setTimeout(connect, 3500);
    };
  }, [baseUrl, addLog]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { connected, status, logs, setLogs };
}

// ─── Font Control types ───────────────────────────────────────────────────────

type FontSize   = "text-sm" | "text-base" | "text-lg" | "text-xl";
type FontFamily = "font-sans" | "font-serif" | "font-mono";

const FONT_SIZES: { val: FontSize; px: string }[] = [
  { val: "text-sm",   px: "11px" },
  { val: "text-base", px: "13px" },
  { val: "text-lg",   px: "16px" },
  { val: "text-xl",   px: "19px" },
];
const FONT_FAMILIES: { val: FontFamily; label: string }[] = [
  { val: "font-sans",  label: "Sans-Serif" },
  { val: "font-serif", label: "Serif" },
  { val: "font-mono",  label: "Mono" },
];

// ─── Engine Mode ─────────────────────────────────────────────────────────────

type EngineMode = "groq_first" | "groq_only" | "local_first" | "local_only" | "parallel" | "web_speech";

const ENGINE_MODES: { val: EngineMode; label: string; desc: string; icon: string; browserOnly?: boolean }[] = [
  { val: "groq_first",  label: "Groq → מקומי",       icon: "☁️→🏠", desc: "Groq קודם, fallback מקומי (ברירת מחדל)" },
  { val: "groq_only",   label: "Groq בלבד",           icon: "☁️",    desc: "רק Groq large-v3, ללא fallback" },
  { val: "local_first", label: "מקומי → Groq",       icon: "🏠→☁️", desc: "מקומי קודם, fallback Groq" },
  { val: "local_only",  label: "מקומי בלבד",         icon: "🏠",    desc: "רק Whisper מקומי, ללא Groq" },
  { val: "parallel",    label: "שניים במקביל",       icon: "⚡",    desc: "Groq + מקומי בו-זמנית, הראשון שמחזיר ניצח" },
  { val: "web_speech",  label: "Web Speech API בלבד", icon: "🌐",    desc: "זיהוי קולי של הדפדפן (Chrome/Edge) — ללא שרת Python", browserOnly: true },
];

const WHISPER_PORT = 3000;
const MAX_BARS     = 20;

function getSupportedMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? "";
}

function useLevelMeter(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      setLevel(Math.min(buf.reduce((a, b) => a + b, 0) / buf.length / 128, 1));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      src.disconnect();
      ctx.close();
    };
  }, [stream]);

  return level;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white border-2 border-amber-400 rounded-xl p-5", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-5 h-5 text-blue-950 shrink-0" />
      <span className="font-bold text-blue-950 text-base">{title}</span>
      {sub && <span className="text-blue-800 text-sm">{sub}</span>}
    </div>
  );
}

// ─── Quick Record Panel (FAB inline + configurable hotkey) ──────────────────────────

type RecState = "idle" | "recording" | "processing";

type InputMode = "whisper" | "webspeech";

type HotkeyConfig = { ctrl: boolean; shift: boolean; alt: boolean; code: string; label: string };

const DEFAULT_HOTKEY: HotkeyConfig = { ctrl: true, shift: true, alt: false, code: "KeyH", label: "Ctrl+Shift+H" };

function loadHotkey(): HotkeyConfig {
  try { const s = localStorage.getItem("vcadmin_hotkey"); return s ? JSON.parse(s) : DEFAULT_HOTKEY; }
  catch { return DEFAULT_HOTKEY; }
}

function saveHotkey(h: HotkeyConfig) {
  localStorage.setItem("vcadmin_hotkey", JSON.stringify(h));
}

function codeToLabel(e: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const c = e.code;
  if      (c === "NumpadEnter")  parts.push("Enter ימני");
  else if (c === "Enter")        parts.push("Enter");
  else if (c === "Space")        parts.push("Space");
  else if (c.startsWith("Key"))   parts.push(c.slice(3));
  else if (c.startsWith("Digit")) parts.push(c.slice(5));
  else if (c.startsWith("Numpad"))parts.push(`Num${c.slice(6)}`);
  else if (c.startsWith("F") && c.length <= 3) parts.push(c);
  else                           parts.push(c);
  return parts.join("+");
}

function QuickRecordPanel({
  triggerRef,
  hotkey,
  onHotkeyChange,
}: {
  triggerRef?: React.MutableRefObject<(() => void) | null>;
  hotkey: HotkeyConfig;
  onHotkeyChange: (h: HotkeyConfig) => void;
}) {
  const [inputMode, setInputMode]   = useState<InputMode>("whisper");
  const [state, setState]           = useState<RecState>("idle");
  const [stream, setStream]         = useState<MediaStream | null>(null);
  const [lastText, setLastText]     = useState("");
  const [copied, setCopied]         = useState(false);
  const [wsInterim, setWsInterim]   = useState("");
  const [showEngineInfo, setShowEngineInfo] = useState(false);
  const recorderRef                 = useRef<MediaRecorder | null>(null);
  const chunksRef                   = useRef<Blob[]>([]);
  const wsRecogRef                  = useRef<SpeechRecognition | null>(null);
  const level                       = useLevelMeter(state === "recording" ? stream : null);

  // ── Shortcut capture
  const [capturing, setCapturing]       = useState(false);
  const [pendingHk, setPendingHk]       = useState<HotkeyConfig | null>(null);
  const captureRef                      = useRef<HTMLDivElement>(null);

  const startCapture = useCallback(() => {
    if (state !== "idle") return;
    setCapturing(true);
    setPendingHk(null);
    setTimeout(() => captureRef.current?.focus(), 50);
  }, [state]);

  const handleCaptureKey = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    setPendingHk({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code, label: codeToLabel(e) });
  }, []);

  const confirmHotkey = useCallback(() => {
    if (pendingHk) { onHotkeyChange(pendingHk); saveHotkey(pendingHk); }
    setCapturing(false); setPendingHk(null);
  }, [pendingHk, onHotkeyChange]);

  const cancelCapture = useCallback(() => { setCapturing(false); setPendingHk(null); }, []);

  // ── Whisper mode ──────────────────────────────────────────────────────────
  const startRec = useCallback(async () => {
    if (state !== "idle") return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      chunksRef.current = [];
      const mr = new MediaRecorder(s, { mimeType: getSupportedMime() });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      recorderRef.current = mr;
      setState("recording");
    } catch {
      toast({ title: "שגיאה", description: "לא ניתן לגשת למיקרופון", variant: "destructive" });
    }
  }, [state]);

  const stopRec = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr || state !== "recording") return;
    setState("processing");
    mr.onstop = async () => {
      stream?.getTracks().forEach(t => t.stop());
      setStream(null);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      form.append("language", "he");
      form.append("beam_size", "3");
      form.append("normalize", "1");
      try {
        const res = await fetch(`http://localhost:${WHISPER_PORT}/transcribe`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const text = (data.text ?? "").trim();
        if (!text) {
          toast({ title: "⚠️ לא זוהה טקסט", description: "נסה שוב" });
          setState("idle"); return;
        }
        setLastText(text);
        await navigator.clipboard.writeText(text).catch(() => {});
        const el = document.activeElement as HTMLInputElement | null;
        if (el && "value" in el) {
          const s2 = el.selectionStart ?? el.value.length;
          const e2 = el.selectionEnd   ?? el.value.length;
          el.value = el.value.slice(0, s2) + text + el.value.slice(e2);
          el.selectionStart = el.selectionEnd = s2 + text.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          document.execCommand?.("insertText", false, text);
        }
        toast({ title: "✅ תומלל", description: text.slice(0, 80) });
      } catch {
        toast({ title: "❌ שגיאה", description: `שרת Whisper לא זמין (port ${WHISPER_PORT})`, variant: "destructive" });
      } finally {
        setState("idle");
      }
    };
    mr.stop();
  }, [state, stream]);

  // ── Web Speech mode ───────────────────────────────────────────────────────
  const startWS = useCallback(() => {
    if (state !== "idle") return;
    const SR = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
             ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "לא נתמך", description: "Web Speech API דורש Chrome או Edge", variant: "destructive" });
      return;
    }
    const r = new SR();
    r.lang = "he-IL";
    r.continuous = false;
    r.interimResults = true;
    wsRecogRef.current = r;
    r.onstart  = () => setState("recording");
    r.onerror  = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") toast({ title: "גישה למיקרופון נדחתה", variant: "destructive" });
      setState("idle"); setWsInterim("");
    };
    r.onresult = (e: SpeechRecognitionEvent) => {
      let fin = "", int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      if (int) setWsInterim(int);
      if (fin) {
        const text = fin.trim();
        setWsInterim("");
        setLastText(text);
        navigator.clipboard.writeText(text).catch(() => {});
        const el = document.activeElement as HTMLInputElement | null;
        if (el && "value" in el) {
          const s2 = el.selectionStart ?? el.value.length;
          const e2 = el.selectionEnd   ?? el.value.length;
          el.value = el.value.slice(0, s2) + text + el.value.slice(e2);
          el.selectionStart = el.selectionEnd = s2 + text.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          document.execCommand?.("insertText", false, text);
        }
        toast({ title: "✅ זוהה", description: text.slice(0, 80) });
        setState("idle");
      }
    };
    r.onend = () => { setState("idle"); setWsInterim(""); };
    r.start();
  }, [state]);

  const stopWS = useCallback(() => {
    wsRecogRef.current?.stop();
    wsRecogRef.current = null;
    setState("idle");
    setWsInterim("");
  }, []);

  // ── Unified toggle / cancel ───────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (inputMode === "whisper") {
      if (state === "idle")           startRec();
      else if (state === "recording") stopRec();
    } else {
      if (state === "idle")           startWS();
      else if (state === "recording") stopWS();
    }
  }, [inputMode, state, startRec, stopRec, startWS, stopWS]);

  const cancel = useCallback(() => {
    recorderRef.current?.stop();
    wsRecogRef.current?.stop();
    wsRecogRef.current = null;
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setState("idle");
    setWsInterim("");
  }, [stream]);

  // Switch mode → stop any active recording first
  const switchMode = useCallback((m: InputMode) => {
    if (state !== "idle") cancel();
    setInputMode(m);
    setLastText("");
    setWsInterim("");
    setShowEngineInfo(false);
  }, [state, cancel]);

  // expose toggle to parent (for keyboard shortcut)
  useEffect(() => { if (triggerRef) triggerRef.current = toggle; }, [toggle, triggerRef]);

  // cleanup
  useEffect(() => () => {
    recorderRef.current?.stop();
    wsRecogRef.current?.stop();
    stream?.getTracks().forEach(t => t.stop());
  }, [stream]);

  const bars = Array.from({ length: MAX_BARS }, (_, i) => {
    const thr = (i + 1) / MAX_BARS;
    const active = level >= thr;
    const color = thr < 0.5 ? "bg-emerald-400" : thr < 0.8 ? "bg-yellow-400" : "bg-red-400";
    return (
      <div
        key={i}
        className={cn("w-[3px] rounded-sm transition-all duration-75",
          active ? color : "bg-black/20",
          active ? "opacity-100" : "opacity-30"
        )}
        style={{ height: `${6 + Math.floor((i / MAX_BARS) * 20)}px` }}
      />
    );
  });

  return (
    <Card>
      <SectionTitle icon={Mic} title="הקלטה קולית מהירה"
        sub={`${hotkey.label} · שרת Whisper מקומי`} />

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        {([
          { val: "whisper"  as InputMode, label: "🏠 Whisper מקומי" },
          { val: "webspeech" as InputMode, label: "🌐 Web Speech API" },
        ]).map(({ val, label }) => (
          <button
            key={val}
            onClick={() => switchMode(val)}
            className={cn(
              "flex-1 py-1.5 rounded-lg border-2 border-amber-400 text-sm font-bold transition-colors",
              inputMode === val ? "bg-amber-400 text-white" : "text-blue-950 hover:bg-amber-50"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Keyboard shortcut (configurable) */}
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs text-blue-950 font-medium">
          <Keyboard className="w-3.5 h-3.5 shrink-0" />
          <span>קיצור מקלדת:</span>
          <kbd className="px-2 py-0.5 rounded border-2 border-amber-400 font-mono text-black font-bold">
            {hotkey.label}
          </kbd>
          <span className="text-blue-800">הפעל / עצור</span>
          <button
            onClick={startCapture}
            className="mr-auto text-xs px-2 py-0.5 border-2 border-amber-400 rounded text-blue-950 hover:bg-amber-50 font-semibold transition-colors"
          >
            שנה
          </button>
        </div>

        {capturing && (
          <div
            ref={captureRef}
            tabIndex={0}
            onKeyDown={handleCaptureKey}
            className="mt-2 rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 focus:outline-none cursor-pointer"
          >
            <div className="text-sm font-bold text-blue-950 mb-2">לחץ על הצירוף הרצוי…</div>
            {pendingHk ? (
              <div className="flex items-center gap-2 flex-wrap">
                <kbd className="px-3 py-1 rounded border-2 border-amber-400 font-mono text-black font-bold text-base">
                  {pendingHk.label}
                </kbd>
                <button onClick={confirmHotkey}
                  className="text-xs px-3 py-1.5 border-2 border-green-500 rounded text-green-700 hover:bg-green-50 font-bold">
                  שמור
                </button>
                <button onClick={cancelCapture}
                  className="text-xs px-3 py-1.5 border-2 border-amber-400 rounded text-blue-950 hover:bg-amber-50 font-semibold">
                  ביטול
                </button>
              </div>
            ) : (
              <button onClick={cancelCapture} className="text-xs text-blue-800 underline">
                ביטול
              </button>
            )}
          </div>
        )}
      </div>

      {/* Engine badge */}
      {(() => {
        const isWS = inputMode === "webspeech";
        const badge = isWS
          ? { icon: "🌐", name: "Web Speech API", color: "text-blue-700 border-blue-300 bg-blue-50" }
          : { icon: "🏠", name: "Whisper מקומי", color: "text-green-700 border-green-300 bg-green-50" };
        const details = isWS
          ? [
              "מנוע: SpeechRecognition (Chrome / Edge)",
              "מודל: Google Speech-to-Text",
              "עיבוד: בשרתי Google (ענן)",
              "זמן תגובה: מהיר — streaming בזמן אמת",
              "פרטיות: ⚠️ האודיו עובר לרשת",
              "עברית: ✅ טוב, ❌ ללא VRAM מקומי",
            ]
          : [
              "מנוע: faster-whisper (CTranslate2)",
              "מודל: ivrit-ai/whisper-large-v3-turbo-ct2",
              "עיבוד: מקומי 100% — GPU (CUDA) / CPU",
              "זמן תגובה: 0.5–2 שניות לאחר הקלטה",
              "פרטיות: ✅ לא יוצא מהמחשב",
              "עברית: ✅ מצוין — Fine-tuned ספציפית",
            ];
        return (
          <div className="relative flex items-center justify-center gap-2 mb-1">
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border-2", badge.color)}>
              <span>{badge.icon}</span>{badge.name}
            </span>
            <button
              type="button"
              onClick={() => setShowEngineInfo(s => !s)}
              className="text-blue-950 hover:text-amber-600 transition-colors"
              title="מידע על המנוע"
            >
              <Info className="w-4 h-4" />
            </button>
            {showEngineInfo && (
              <div className="absolute bottom-full mb-2 right-0 left-0 z-20 bg-white border-2 border-amber-400 rounded-xl shadow-xl px-4 py-3 text-right" dir="rtl">
                <div className="text-xs font-bold text-blue-950 mb-2 uppercase tracking-wide">פרטי מנוע תמלול</div>
                <ul className="space-y-1">
                  {details.map((d, i) => (
                    <li key={i} className="text-xs text-black leading-relaxed">{d}</li>
                  ))}
                </ul>
                <button onClick={() => setShowEngineInfo(false)}
                  className="mt-2 text-xs text-blue-800 underline">סגור</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Big record button */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={toggle}
          disabled={state === "processing"}
          className={cn(
            "w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all duration-200 shadow-lg",
            "focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400",
            state === "idle"
              ? "border-amber-400 bg-white hover:bg-amber-50 text-blue-950"
              : state === "recording"
              ? "border-red-500 bg-red-50 text-red-600 animate-pulse"
              : "border-amber-400 bg-amber-50 text-blue-950"
          )}
        >
          {state === "idle"      && <Mic className="w-10 h-10" />}
          {state === "recording" && <Square className="w-10 h-10" />}
          {state === "processing" && <Loader2 className="w-10 h-10 animate-spin" />}
        </button>

        {/* Level meter (Whisper mode only) */}
        {state === "recording" && inputMode === "whisper" && (
          <div className="flex items-end gap-[3px] h-8 px-2 py-1 rounded-lg border-2 border-amber-400 bg-white">
            {bars}
          </div>
        )}

        {/* Web Speech interim text */}
        {state === "recording" && inputMode === "webspeech" && (
          <div className="w-full rounded-lg px-4 py-2 border-2 border-amber-400 text-sm text-black italic min-h-[2.5rem]">
            {wsInterim || <span className="text-blue-800">מאזין…</span>}
          </div>
        )}

        {/* Status label */}
        <div className={cn(
          "text-center font-bold text-base",
          state === "idle"       ? "text-blue-950"
          : state === "recording" ? "text-red-600"
          : "text-amber-600"
        )}>
          {state === "idle"       && "לחץ להתחיל הקלטה"}
          {state === "recording"  && inputMode === "whisper"   && "🔴 מקליט… לחץ לעצירה"}
          {state === "recording"  && inputMode === "webspeech" && "🎙 מאזין… לחץ לעצירה"}
          {state === "processing" && "⚙️ שולח ל-Whisper…"}
        </div>

        {/* Cancel button (recording only) */}
        {state === "recording" && (
          <button
            onClick={cancel}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border-2 border-amber-400 rounded-lg text-blue-950 hover:bg-amber-50 font-semibold"
          >
            <X className="w-3.5 h-3.5" />
            בטל הקלטה
          </button>
        )}
      </div>

      {/* Last transcription result */}
      {lastText && state === "idle" && (
        <div className="mt-4 border-2 border-amber-400 rounded-lg px-4 py-3">
          <div className="text-xs font-bold text-blue-950 uppercase tracking-wide mb-1">תוצאת התמלול האחרון</div>
          <div className="text-black text-sm leading-relaxed">{lastText}</div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(lastText);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1 border-2 border-amber-400 rounded-lg text-blue-950 hover:bg-amber-50 font-semibold"
            >
              {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "הועתק!" : "העתק"}
            </button>
            <button
              onClick={() => setLastText("")}
              className="text-xs px-3 py-1 border-2 border-amber-400 rounded-lg text-blue-950 hover:bg-amber-50 font-semibold"
            >נקה</button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Status Panel ────────────────────────────────────────────────────────────

function StatusPanel({ status, connected }: { status: StatusState; connected: boolean }) {
  const s = STATE_LABELS[status.state] ?? STATE_LABELS.idle;
  return (
    <Card>
      <SectionTitle icon={Activity} title="מצב מערכת" sub={connected ? "מחובר" : "מנותק"} />
      <div className="flex items-center gap-3 mb-4">
        <div className={cn("w-5 h-5 rounded-full shrink-0", s.color, s.pulse && "animate-pulse")} />
        <span className="text-lg font-bold text-black">{s.label}</span>
        <div className="mr-auto flex items-center gap-1.5 text-sm font-semibold">
          {connected
            ? <><Wifi className="w-4 h-4 text-green-600" /><span className="text-green-700">localhost:{UI_PORT}</span></>
            : <><WifiOff className="w-4 h-4 text-red-600" /><span className="text-red-700">לא מחובר</span></>
          }
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "שמעתי", value: status.heard },
          { label: "תמלול", value: status.transcribed },
          { label: "משימה", value: status.task },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg p-3 border-2 border-amber-400">
            <div className="text-blue-950 uppercase tracking-wide text-xs font-bold mb-1">{label}</div>
            <div className={cn("font-semibold truncate text-sm text-black", !value && "opacity-40")}>{value || "—"}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Log Panel ───────────────────────────────────────────────────────────────

function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  return (
    <Card className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon={Terminal} title="לוג אירועים בזמן אמת" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(a => !a)}
            className={cn("text-sm px-3 py-0.5 rounded border-2 transition-colors font-semibold",
              autoScroll
                ? "border-amber-400 text-blue-950 bg-amber-50"
                : "border-amber-300 text-blue-800 hover:border-amber-400"
            )}
          >
            {autoScroll ? "auto-scroll ●" : "auto-scroll ○"}
          </button>
          <button
            onClick={onClear}
            className="text-sm px-3 py-0.5 rounded border-2 border-amber-400 text-blue-950 font-semibold hover:bg-amber-50 transition-colors"
          >
            נקה
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto max-h-72 bg-white rounded-lg p-3 font-mono text-sm space-y-0.5 border-2 border-amber-400">
        {logs.length === 0 && (
          <div className="text-blue-800 text-center py-6 font-medium">ממתין לאירועים מהמערכת…</div>
        )}
        {logs.map(l => (
          <div key={l.id} className={cn("leading-relaxed px-1", l.cls)}>
            <span className="text-blue-950 font-bold mr-1">[{l.ts}]</span>{l.msg}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </Card>
  );
}

// ─── Web Speech Panel ─────────────────────────────────────────────────────────

function WebSpeechPanel({ connected }: { connected: boolean }) {
  const [active, setActive] = useState(false);
  const [lang, setLang] = useState("he-IL");
  const [interim, setInterim] = useState("");
  const [badge, setBadge] = useState("כבוי");
  const [badgeColor, setBadgeColor] = useState("text-blue-800");
  const recogRef = useRef<SpeechRecognition | null>(null);

  const stop = useCallback(() => {
    setActive(false);
    setBadge("כבוי");
    setBadgeColor("text-blue-800");
    setInterim("");
    recogRef.current?.stop();
    recogRef.current = null;
  }, []);

  const start = useCallback(() => {
    const SR = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
             ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "לא נתמך", description: "השתמש ב-Chrome או Edge", variant: "destructive" });
      return;
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    recogRef.current = r;

    r.onstart = () => { setActive(true); setBadge("🎙 מאזין"); setBadgeColor("text-blue-950"); };
    r.onend   = () => { if (active) setTimeout(() => recogRef.current?.start(), 300); };
    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") { toast({ title: "גישה למיקרופון נדחתה", variant: "destructive" }); stop(); }
    };
    r.onresult = (e: SpeechRecognitionEvent) => {
      let fin = "", int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      if (int) setInterim(int);
      if (fin && connected) {
        setInterim("");
        setBadge("↑ שולח…");
        setBadgeColor("text-amber-600");
        fetch(`${BASE_URL}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fin.trim(), source: "webspeech" }),
        })
          .then(r2 => r2.json())
          .then(d => {
            setBadge(d.action === "recording" ? "⏺ מקליט Whisper" : "🎙 מאזין");
            setBadgeColor("text-blue-950");
            setTimeout(() => setBadge("🎙 מאזין"), 4000);
          })
          .catch(() => { setBadge("🎙 מאזין"); setBadgeColor("text-blue-950"); });
      }
    };
    r.start();
  }, [lang, active, connected, stop]);

  useEffect(() => () => recogRef.current?.stop(), []);

  return (
    <Card>
      <SectionTitle icon={Globe} title="Web Speech API" sub="Chrome / Edge בלבד" />
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={active ? stop : start}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold border-2 border-amber-400 transition-colors",
            active ? "text-red-700 hover:bg-amber-50" : "text-blue-950 hover:bg-amber-50"
          )}
        >
          {active ? <><Square className="w-3.5 h-3.5" />עצור</> : <><Play className="w-3.5 h-3.5" />הפעל</>}
        </button>
        <span className={cn("text-sm font-bold", badgeColor)}>{badge}</span>
        <select
          value={lang}
          onChange={e => { setLang(e.target.value); if (active) { stop(); setTimeout(start, 300); } }}
          className="mr-auto bg-white border-2 border-amber-400 text-black text-sm rounded-lg px-2 py-1.5"
        >
          <option value="he-IL">🇮🇱 עברית</option>
          <option value="en-US">🇺🇸 English</option>
          <option value="ar-SA">🇸🇦 عربي</option>
        </select>
      </div>
      <div className="rounded-lg px-4 py-3 min-h-[2.5rem] text-base text-black italic border-2 border-amber-400">
        {interim || <span className="text-blue-800">טקסט ביניים יופיע כאן…</span>}
      </div>
      {!connected && (
        <p className="text-sm text-red-700 font-semibold mt-2">⚠️ שרת Python לא מחובר — Web Speech לא ישלח פקודות</p>
      )}
    </Card>
  );
}

// ─── Command Tester ───────────────────────────────────────────────────────────

function CommandTester({ connected }: { connected: boolean }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ action: string; result?: string } | null>(null);

  const send = async () => {
    if (!text.trim() || !connected) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`${BASE_URL}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), source: "admin-test" }),
      });
      const d = await r.json();
      setResult(d);
    } catch {
      setResult({ action: "error" });
    }
    setLoading(false);
  };

  const QUICK = ["מערכת פתח יוטיוב", "מערכת חשב 25 כפול 4", "מערכת חפש חדשות", "מערכת נעל מסך"];

  return (
    <Card>
      <SectionTitle icon={Zap} title="בדיקת פקודה" sub="שלח פקודה ישירות לשרת" />
      <div className="flex gap-2 mb-3">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="הקלד פקודה... (כולל wake word)"
          dir="rtl"
          className="flex-1 bg-white border-2 border-amber-400 rounded-lg px-3 py-2 text-base text-black placeholder:text-blue-300 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={send}
          disabled={!connected || !text.trim() || loading}
          className="px-4 py-2 bg-white border-2 border-amber-400 text-blue-950 font-bold rounded-lg text-base hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {QUICK.map(q => (
          <button
            key={q}
            onClick={() => setText(q)}
            className="text-sm px-3 py-1 rounded border-2 border-amber-400 text-blue-950 font-semibold hover:bg-amber-50 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
      {result && (
        <div className="text-sm rounded-lg px-4 py-3 mt-1 border-2 border-amber-400 text-black font-semibold">
          action: <strong className="text-blue-950">{result.action}</strong>
          {result.result && <> · {result.result}</>}
        </div>
      )}
    </Card>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel() {
  const { keys: apiKeys, isLoaded } = useCloudApiKeys();
  const keysLoading = !isLoaded;
  const [wakeWord, setWakeWord] = useState("מערכת");
  const [groqKey, setGroqKey] = useState("");
  const [fromSystem, setFromSystem] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [model, setModel] = useState("tiny");

  // Auto-load Groq key from Supabase / Settings
  useEffect(() => {
    if (apiKeys?.groq_key && !fromSystem) {
      setGroqKey(apiKeys.groq_key);
      setFromSystem(true);
    }
  }, [apiKeys, fromSystem]);

  const cliCommand = [
    `.venv\\Scripts\\python.exe tools\\voice-command\\voice_command_listener.py`,
    `--model ${model}`,
    `--device cuda`,
    wakeWord ? `--wake-word "${wakeWord}"` : "",
    groqKey  ? `--groq-key "${groqKey}"` : "",
  ].filter(Boolean).join(" ");

  const copy = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <SectionTitle icon={Settings2} title="הגדרות מערכת" sub="צור CLI command" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-sm font-bold text-blue-950 uppercase tracking-wide block mb-1">Wake Word</label>
          <input
            value={wakeWord}
            onChange={e => setWakeWord(e.target.value)}
            placeholder="מערכת"
            dir="rtl"
            className="w-full bg-white border-2 border-amber-400 rounded-lg px-3 py-2 text-base text-black placeholder:text-blue-300 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div>
          <label className="text-sm font-bold text-blue-950 uppercase tracking-wide block mb-1">מודל Whisper</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-white border-2 border-amber-400 rounded-lg px-3 py-2 text-base text-black focus:outline-none focus:border-amber-500"
          >
            <option value="tiny">tiny (מהיר מאוד)</option>
            <option value="base">base (מאוזן)</option>
            <option value="small">small (איכותי)</option>
            <option value="medium">medium (מדויק מאוד)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-sm font-bold text-blue-950 uppercase tracking-wide">
              Groq API Key
              <a href="https://console.groq.com" target="_blank" rel="noreferrer"
                className="mr-2 text-blue-950 underline hover:text-amber-600">השג חינם ←</a>
            </label>
            {keysLoading && <span className="text-xs text-blue-800">טוען…</span>}
            {!keysLoading && fromSystem && (
              <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full border border-green-300">
                מחובר מהמערכת ✓
              </span>
            )}
            {!keysLoading && !fromSystem && (
              <span className="text-xs text-blue-800">לא נמצא מפתח — הוסף ב-Settings</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={groqKey}
              onChange={e => { setGroqKey(e.target.value); setFromSystem(false); }}
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxx"
              className="flex-1 bg-white border-2 border-amber-400 rounded-lg px-3 py-2 text-base text-black placeholder:text-blue-300 focus:outline-none focus:border-amber-500"
            />
            <button onClick={() => setShowKey(s => !s)}
              className="px-4 py-2 border-2 border-amber-400 rounded-lg text-blue-950 text-sm font-bold hover:bg-amber-50 transition-colors">
              {showKey ? "הסתר" : "הצג"}
            </button>
          </div>
        </div>
      </div>
      <div className="rounded-lg p-3 flex items-start gap-2 border-2 border-amber-400">
        <code className="flex-1 text-sm text-blue-950 font-mono break-all leading-relaxed">{cliCommand}</code>
        <button onClick={copy} className="shrink-0 p-1.5 text-blue-950 hover:text-amber-600 transition-colors">
          {copied ? <CheckCheck className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-sm text-blue-950 font-medium mt-2">הפעל את הפקודה מתיקיית הפרויקט (PowerShell)</p>
    </Card>
  );
}

// ─── Engine Panel ─────────────────────────────────────────────────────────────

function EnginePanel({ connected }: { connected: boolean }) {
  const { apiKeys, isLoading: keysLoading } = useCloudApiKeys();
  const [mode, setMode]               = useState<EngineMode>("groq_first");
  const [groqKey, setGroqKey]         = useState("");
  const [fromSystem, setFromSystem]   = useState(false);
  const [sending, setSending]         = useState(false);
  const [lastResult, setLastResult]   = useState<string | null>(null);

  // Auto-load Groq key from Supabase / Settings
  useEffect(() => {
    if (apiKeys?.groq_key && !fromSystem) {
      setGroqKey(apiKeys.groq_key);
      setFromSystem(true);
    }
  }, [apiKeys, fromSystem]);

  const isWebSpeech = mode === "web_speech";

  const sendConfig = async () => {
    if (isWebSpeech) {
      setLastResult("🌐 Web Speech פעיל — אין צורך בשרת Python");
      return;
    }
    if (!connected) return;
    setSending(true);
    setLastResult(null);
    try {
      const r = await fetch(`${BASE_URL}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine_mode: mode, groq_key: groqKey }),
      });
      const d = await r.json();
      setLastResult(d.ok ? `✅ מנוע עודכן: ${d.engine_mode}` : "❌ שגיאה");
    } catch {
      setLastResult("❌ שרת לא זמין");
    }
    setSending(false);
  };

  return (
    <Card>
      <SectionTitle icon={Cpu} title="מנוע תמלול" sub="בחר מנוע ושלח לשרת" />

      {/* Engine mode selector */}
      <div className="grid grid-cols-1 gap-2 mb-4">
        {ENGINE_MODES.map(m => (
          <button
            key={m.val}
            onClick={() => setMode(m.val)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-right transition-colors w-full",
              mode === m.val
                ? "border-amber-500 bg-amber-50"
                : "border-amber-300 hover:border-amber-400 hover:bg-amber-50/50"
            )}
          >
            <span className="text-xl shrink-0" aria-hidden>{m.icon}</span>
            <div className="flex-1 text-right">
              <div className="font-bold text-black text-sm">{m.label}</div>
              <div className="text-blue-950 text-xs">{m.desc}</div>
            </div>
            {mode === m.val && (
              <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Web Speech note */}
      {isWebSpeech && (
        <div className="mb-4 rounded-lg px-4 py-3 border-2 border-amber-400 bg-amber-50 text-sm text-blue-950 font-medium">
          🌐 <strong>Web Speech API</strong> — פועל ישירות בדפדפן, ללא שרת Python ומקרופון עיבוד. מומלץ ל-Chrome / Edge בלבד.
          <br />
          <span className="text-xs text-blue-800 mt-1 block">השתמש בכפתור ההקלטה בעמודה השמאלית עם מצב Web Speech.</span>
        </div>
      )}

      {/* Groq key from system */}
      {!isWebSpeech && <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-bold text-blue-950 uppercase tracking-wide">Groq API Key</label>
          {keysLoading && <span className="text-xs text-blue-800">טוען…</span>}
          {!keysLoading && fromSystem && (
            <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full border border-green-300">
              מחובר מהמערכת ✓
            </span>
          )}
          {!keysLoading && !fromSystem && (
            <span className="text-xs text-blue-800">לא נמצא מפתח בהגדרות</span>
          )}
        </div>
        <div className="text-xs text-blue-950 mb-2">
          נטען אוטומטית מהגדרות המערכת — שמור ב-Supabase / Settings
        </div>
        <div className="rounded-lg px-3 py-2.5 border-2 border-amber-400 font-mono text-sm text-black">
          {groqKey
            ? groqKey.slice(0, 6) + "•".repeat(Math.max(0, groqKey.length - 10)) + groqKey.slice(-4)
            : <span className="text-blue-800 not-italic text-xs">לא הוגדר מפתח Groq</span>
          }
        </div>
      </div>}

      {/* Send button */}
      <button
        onClick={sendConfig}
        disabled={!isWebSpeech && (!connected || sending)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-amber-400 rounded-lg text-blue-950 font-bold text-base hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {isWebSpeech
          ? <><Globe className="w-4 h-4" />הפעל Web Speech</>          
          : sending
          ? <><RefreshCw className="w-4 h-4 animate-spin" />שולח…</>
          : <><Send className="w-4 h-4" />שלח הגדרות לשרת</>
        }
      </button>

      {lastResult && (
        <div className={cn(
          "mt-3 text-sm font-semibold px-3 py-2 rounded-lg border-2 border-amber-400",
          lastResult.startsWith("✅") ? "text-green-700" : "text-red-700"
        )}>
          {lastResult}
        </div>
      )}

      {!connected && !isWebSpeech && (
        <p className="mt-2 text-xs text-red-700 font-semibold">⚠️ הפעל את שרת Python תחילה</p>
      )}
    </Card>
  );
}

// ─── Task Rules Table ─────────────────────────────────────────────────────────

function TaskRulesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(o => !o)}>
        <SectionTitle icon={BookOpen} title="פקודות נתמכות" sub={`${TASK_RULES.length} קטגוריות`} />
        {open ? <ChevronUp className="w-5 h-5 text-blue-950 shrink-0" /> : <ChevronDown className="w-5 h-5 text-blue-950 shrink-0" />}
      </button>
      {open && (
        <div className="mt-3 divide-y-2 divide-amber-200">
          {TASK_RULES.map(rule => (
            <div key={rule.category} className="px-3 py-3 grid grid-cols-3 gap-3 text-sm">
              <div className="font-bold text-black">{rule.category}</div>
              <div className="text-blue-950 col-span-1">
                {rule.examples.map(ex => <div key={ex}>"{ex}"</div>)}
              </div>
              <div className="text-blue-950 font-semibold text-left">{rule.result}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowItWorksPanel() {
  const steps = [
    { icon: "🎙", title: "Silero VAD", desc: "מזהה אנרגיה קולית ב-30ms chunks. חוסך CPU — מתמלל רק כשיש דיבור." },
    { icon: "⚡", title: "Whisper tiny (GPU)", desc: "מתמלל utterance קצר (~200ms). מחפש wake word / trigger word." },
    { icon: "🔔", title: "Wake Word Mode", desc: "מגיב רק למשפטים שמתחילים במילת ההתעוררות. כל שאר הדיבור — מתעלם." },
    { icon: "⚙️", title: "Task Engine", desc: "Regex patterns מזהים פקודות — URL, אפליקציות, חיפוש, מחשבון, מערכת." },
    { icon: "☁️", title: "Groq Pass 1a", desc: "כשיש API key — שולח לWhisper large-v3 ב-Groq LPU. מהיר ומדויק." },
    { icon: "🔄", title: "Pass 2 (fallback)", desc: "אם Pass 1 לא זיהה פקודה — מתמלל שוב עם prompt ממוקד בפקודות." },
    { icon: "📋", title: "הדבקה", desc: "אם לא זוהתה פקודה — הטקסט מועתק ללוח ומודבק לחלון הממוקד." },
    { icon: "🌐", title: "Web Speech API", desc: "מאפשר זיהוי מהיר מהדפדפן (<100ms). שולח לPython דרך POST /command." },
  ];

  return (
    <Card>
      <SectionTitle icon={Circle} title="איך המערכת עובדת" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-3 border-2 border-amber-400 rounded-lg px-3 py-3">
            <span className="text-2xl shrink-0">{s.icon}</span>
            <div>
              <div className="text-base font-bold text-black mb-0.5">{s.title}</div>
              <div className="text-sm text-blue-950 leading-relaxed">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VoiceCommandAdmin() {
  const { isAdmin, isLoading } = useAuth();
  const { connected, status, logs, setLogs } = useSSE(BASE_URL);
  const [fontSize, setFontSize]         = useState<FontSize>("text-base");
  const [fontFamily, setFontFamily]     = useState<FontFamily>("font-sans");
  const [showFontCtrl, setShowFontCtrl] = useState(false);
  const recTriggerRef = useRef<(() => void) | null>(null);
  const [hotkey, setHotkey]   = useState<HotkeyConfig>(loadHotkey);
  const hotkeyRef             = useRef(hotkey);
  useEffect(() => { hotkeyRef.current = hotkey; }, [hotkey]);

  // configurable hotkey → toggle quick recorder
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const h = hotkeyRef.current;
      if (
        e.code === h.code &&
        !!h.ctrl  === e.ctrlKey &&
        !!h.shift === e.shiftKey &&
        !!h.alt   === e.altKey
      ) {
        e.preventDefault();
        recTriggerRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <RefreshCw className="w-6 h-6 animate-spin text-blue-950" />
    </div>
  );

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className={cn("min-h-screen bg-white text-black p-4 sm:p-6", fontSize, fontFamily)} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Mic className="w-6 h-6 text-blue-950" />
            Voice Command Admin
          </h1>
          <p className="text-sm text-blue-950 font-medium mt-0.5">ניהול מערכת הפקודות הקוליות — עובדת ללא אינטרנט</p>
        </div>
        <div className="flex items-center gap-2">

          {/* Font Control */}
          <div className="relative">
            <button
              onClick={() => setShowFontCtrl(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-amber-400 text-blue-950 hover:bg-amber-50 transition-colors"
              title="שינוי גודל וסגנון גופן"
            >
              <Type className="w-4 h-4" />
            </button>
            {showFontCtrl && (
              <div className="absolute left-0 top-11 z-50 bg-white border-2 border-amber-400 rounded-xl p-4 shadow-lg min-w-[190px]">
                <div className="text-xs font-bold text-blue-950 uppercase mb-2">גודל גופן</div>
                <div className="flex gap-1.5 mb-4">
                  {FONT_SIZES.map(({ val, px }) => (
                    <button
                      key={val}
                      onClick={() => setFontSize(val)}
                      className={cn("w-9 h-9 rounded border-2 border-amber-400 font-bold transition-colors",
                        fontSize === val ? "bg-amber-400 text-white" : "text-blue-950 hover:bg-amber-50"
                      )}
                      style={{ fontSize: px }}
                    >A</button>
                  ))}
                </div>
                <div className="text-xs font-bold text-blue-950 uppercase mb-2">סגנון גופן</div>
                <div className="flex flex-col gap-1.5">
                  {FONT_FAMILIES.map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => setFontFamily(val)}
                      className={cn("px-3 py-1.5 rounded border-2 border-amber-400 text-right text-sm font-bold transition-colors", val,
                        fontFamily === val ? "bg-amber-400 text-white" : "text-blue-950 hover:bg-amber-50"
                      )}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Connection badge */}
          <div className={cn(
            "flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full border-2 border-amber-400",
            connected ? "text-blue-950" : "text-red-700"
          )}>
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? "מחובר לשרת" : "שרת לא פעיל"}
          </div>
        </div>
      </div>

      {/* Not connected warning */}
      {!connected && (
        <div className="mb-5 border-2 border-amber-400 rounded-xl p-4 text-base text-black font-medium">
          <strong className="text-blue-950">שרת Python לא פעיל.</strong> הפעל בPowerShell:
          <code className="block mt-2 text-sm text-blue-950 font-mono border-2 border-amber-400 rounded px-3 py-2">
            .venv\Scripts\python.exe tools\voice-command\voice_command_listener.py --model tiny --device cuda --wake-word "מערכת"
          </code>
        </div>
      )}

      {/* Grid layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column */}
        <div className="space-y-5">
          <QuickRecordPanel triggerRef={recTriggerRef} hotkey={hotkey} onHotkeyChange={setHotkey} />
          <StatusPanel status={status} connected={connected} />
          <LogPanel logs={logs} onClear={() => setLogs([])} />
          <WebSpeechPanel connected={connected} />
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <EnginePanel connected={connected} />
          <CommandTester connected={connected} />
          <ConfigPanel />
          <TaskRulesPanel />
          <HowItWorksPanel />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-sm text-blue-950 font-medium">
        ממשק Admin · פועל מקומית · localhost:{UI_PORT} · לא נשלחים נתונים לאינטרנט
      </div>
    </div>
  );
}

