import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  Activity, Mic, MicOff, Send, RefreshCw, Copy, CheckCheck,
  Terminal, Globe, Settings2, BookOpen, Zap, Circle,
  Play, Square, Wifi, WifiOff, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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
  idle:       { label: "💤 לא פעיל",        color: "bg-zinc-600",   pulse: false },
};

function classifyLog(msg: string): string {
  if (msg.includes("🔴") || msg.includes("מקליט"))       return "text-red-400 font-semibold";
  if (msg.includes("🚀") || msg.includes("זוהתה") || msg.includes("wake word")) return "text-orange-400 font-semibold";
  if (msg.includes("⚙️") || msg.includes("משימה"))       return "text-purple-400 font-semibold";
  if (msg.includes("✅") || msg.includes("Groq"))         return "text-green-400";
  if (msg.includes("🎤") || msg.includes("שמעתי") || msg.includes("Web Speech")) return "text-blue-400";
  if (msg.includes("❌") || msg.includes("שגיאה") || msg.includes("⚠️")) return "text-red-400";
  if (msg.includes("🌐") || msg.includes("ממשק"))         return "text-cyan-400";
  if (msg.includes("🔔") || msg.includes("Wake Word"))   return "text-yellow-400 font-semibold";
  if (msg.includes("🔑") || msg.includes("Groq"))         return "text-emerald-400";
  return "text-zinc-400";
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-zinc-900 border border-zinc-800 rounded-xl p-4", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
      <span className="font-semibold text-zinc-100 text-sm">{title}</span>
      {sub && <span className="text-zinc-500 text-xs">{sub}</span>}
    </div>
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
        <span className="text-base font-bold text-zinc-100">{s.label}</span>
        <div className="mr-auto flex items-center gap-1.5 text-xs">
          {connected
            ? <><Wifi className="w-3.5 h-3.5 text-green-500" /><span className="text-green-500">localhost:{UI_PORT}</span></>
            : <><WifiOff className="w-3.5 h-3.5 text-red-500" /><span className="text-red-500">לא מחובר</span></>
          }
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {[
          { label: "שמעתי", value: status.heard,       color: "text-blue-400" },
          { label: "תמלול", value: status.transcribed, color: "text-green-400" },
          { label: "משימה", value: status.task,        color: "text-purple-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-950 rounded-lg p-2.5">
            <div className="text-zinc-500 uppercase tracking-wide text-[0.6rem] mb-1">{label}</div>
            <div className={cn("font-medium truncate", color, !value && "opacity-30")}>{value || "—"}</div>
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
      <div className="flex items-center justify-between mb-2">
        <SectionTitle icon={Terminal} title="לוג אירועים בזמן אמת" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(a => !a)}
            className={cn("text-[0.65rem] px-2 py-0.5 rounded border transition-colors",
              autoScroll
                ? "border-green-700 text-green-400 bg-green-950"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            )}
          >
            {autoScroll ? "auto-scroll ●" : "auto-scroll ○"}
          </button>
          <button
            onClick={onClear}
            className="text-[0.65rem] px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
          >
            נקה
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto max-h-64 bg-zinc-950 rounded-lg p-2 font-mono text-[0.75rem] space-y-0.5">
        {logs.length === 0 && (
          <div className="text-zinc-600 text-center py-6">ממתין לאירועים מהמערכת…</div>
        )}
        {logs.map(l => (
          <div key={l.id} className={cn("leading-relaxed px-1", l.cls)}>
            <span className="text-zinc-600 mr-1">[{l.ts}]</span>{l.msg}
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
  const [badgeColor, setBadgeColor] = useState("text-zinc-500");
  const recogRef = useRef<SpeechRecognition | null>(null);

  const stop = useCallback(() => {
    setActive(false);
    setBadge("כבוי");
    setBadgeColor("text-zinc-500");
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

    r.onstart = () => { setActive(true); setBadge("🎙 מאזין"); setBadgeColor("text-purple-400"); };
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
        setBadgeColor("text-orange-400");
        fetch(`${BASE_URL}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fin.trim(), source: "webspeech" }),
        })
          .then(r2 => r2.json())
          .then(d => {
            setBadge(d.action === "recording" ? "⏺ מקליט Whisper" : "🎙 מאזין");
            setBadgeColor("text-purple-400");
            setTimeout(() => setBadge("🎙 מאזין"), 4000);
          })
          .catch(() => { setBadge("🎙 מאזין"); setBadgeColor("text-purple-400"); });
      }
    };
    r.start();
  }, [lang, active, connected, stop]);

  useEffect(() => () => recogRef.current?.stop(), []);

  return (
    <Card>
      <SectionTitle icon={Globe} title="Web Speech API" sub="Chrome / Edge בלבד" />
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={active ? stop : start}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
            active
              ? "bg-red-950 border-red-700 text-red-400 hover:bg-red-900"
              : "bg-purple-950 border-purple-700 text-purple-400 hover:bg-purple-900"
          )}
        >
          {active ? <><Square className="w-3 h-3" />עצור</> : <><Play className="w-3 h-3" />הפעל</>}
        </button>
        <span className={cn("text-xs font-medium", badgeColor)}>{badge}</span>
        <select
          value={lang}
          onChange={e => { setLang(e.target.value); if (active) { stop(); setTimeout(start, 300); } }}
          className="mr-auto bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1"
        >
          <option value="he-IL">🇮🇱 עברית</option>
          <option value="en-US">🇺🇸 English</option>
          <option value="ar-SA">🇸🇦 عربي</option>
        </select>
      </div>
      <div className="bg-zinc-950 rounded-lg px-3 py-2 min-h-[2rem] text-sm text-purple-300 italic">
        {interim || <span className="text-zinc-600">טקסט ביניים יופיע כאן…</span>}
      </div>
      {!connected && (
        <p className="text-xs text-orange-400 mt-2">⚠️ שרת Python לא מחובר — Web Speech לא ישלח פקודות</p>
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
      <div className="flex gap-2 mb-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="הקלד פקודה... (כולל wake word)"
          dir="rtl"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-purple-600"
        />
        <button
          onClick={send}
          disabled={!connected || !text.trim() || loading}
          className="px-3 py-2 bg-purple-900 border border-purple-700 text-purple-300 rounded-lg text-sm hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK.map(q => (
          <button
            key={q}
            onClick={() => setText(q)}
            className="text-[0.65rem] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-purple-600 hover:text-purple-300 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
      {result && (
        <div className={cn("text-xs rounded-lg px-3 py-2 mt-1",
          result.action === "task" ? "bg-purple-950 text-purple-300 border border-purple-800" :
          result.action === "recording" ? "bg-red-950 text-red-300 border border-red-800" :
          result.action === "error" ? "bg-red-950 text-red-400 border border-red-800" :
          "bg-zinc-950 text-zinc-400 border border-zinc-700"
        )}>
          action: <strong>{result.action}</strong>
          {result.result && <> · {result.result}</>}
        </div>
      )}
    </Card>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel() {
  const [wakeWord, setWakeWord] = useState("מערכת");
  const [groqKey, setGroqKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [model, setModel] = useState("tiny");

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[0.65rem] text-zinc-500 uppercase tracking-wide block mb-1">Wake Word</label>
          <input
            value={wakeWord}
            onChange={e => setWakeWord(e.target.value)}
            placeholder="מערכת"
            dir="rtl"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-600"
          />
        </div>
        <div>
          <label className="text-[0.65rem] text-zinc-500 uppercase tracking-wide block mb-1">מודל Whisper</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-purple-600"
          >
            <option value="tiny">tiny (מהיר מאוד)</option>
            <option value="base">base (מאוזן)</option>
            <option value="small">small (איכותי)</option>
            <option value="medium">medium (מדויק מאוד)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[0.65rem] text-zinc-500 uppercase tracking-wide block mb-1">
            Groq API Key
            <a href="https://console.groq.com" target="_blank" rel="noreferrer"
              className="mr-2 text-emerald-500 hover:underline">השג חינם ←</a>
          </label>
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={groqKey}
              onChange={e => setGroqKey(e.target.value)}
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxx"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
            />
            <button onClick={() => setShowKey(s => !s)}
              className="px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 text-xs hover:border-zinc-500 transition-colors">
              {showKey ? "הסתר" : "הצג"}
            </button>
          </div>
        </div>
      </div>
      <div className="bg-zinc-950 rounded-lg p-2.5 flex items-start gap-2">
        <code className="flex-1 text-[0.7rem] text-emerald-300 font-mono break-all leading-relaxed">{cliCommand}</code>
        <button onClick={copy} className="shrink-0 p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
          {copied ? <CheckCheck className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-[0.65rem] text-zinc-600 mt-2">הפעל את הפקודה מתיקיית הפרויקט (PowerShell)</p>
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
        {open ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {TASK_RULES.map(rule => (
            <div key={rule.category} className="bg-zinc-950 rounded-lg px-3 py-2 grid grid-cols-3 gap-2 text-xs">
              <div className="font-semibold text-zinc-200">{rule.category}</div>
              <div className="text-zinc-400 col-span-1">
                {rule.examples.map(ex => <div key={ex}>"{ex}"</div>)}
              </div>
              <div className="text-green-400 text-left">{rule.result}</div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2.5 bg-zinc-950 rounded-lg px-3 py-2">
            <span className="text-xl shrink-0">{s.icon}</span>
            <div>
              <div className="text-xs font-semibold text-zinc-200 mb-0.5">{s.title}</div>
              <div className="text-[0.7rem] text-zinc-500 leading-relaxed">{s.desc}</div>
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

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <RefreshCw className="w-6 h-6 animate-spin text-zinc-500" />
    </div>
  );

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-50 flex items-center gap-2">
            <Mic className="w-5 h-5 text-purple-400" />
            Voice Command Admin
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">ניהול מערכת הפקודות הקוליות — עובדת ללא אינטרנט</p>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border",
          connected
            ? "text-green-400 border-green-800 bg-green-950"
            : "text-red-400 border-red-800 bg-red-950"
        )}>
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {connected ? "מחובר לשרת" : "שרת לא פעיל"}
        </div>
      </div>

      {/* Not connected warning */}
      {!connected && (
        <div className="mb-4 bg-orange-950 border border-orange-800 rounded-xl p-3 text-sm text-orange-300">
          <strong>שרת Python לא פעיל.</strong> הפעל בPowerShell:
          <code className="block mt-1 text-[0.72rem] text-orange-200 bg-zinc-950 rounded px-2 py-1 font-mono">
            .venv\Scripts\python.exe tools\voice-command\voice_command_listener.py --model tiny --device cuda --wake-word "מערכת"
          </code>
        </div>
      )}

      {/* Grid layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          <StatusPanel status={status} connected={connected} />
          <LogPanel logs={logs} onClear={() => setLogs([])} />
          <WebSpeechPanel connected={connected} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <CommandTester connected={connected} />
          <ConfigPanel />
          <TaskRulesPanel />
          <HowItWorksPanel />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-[0.65rem] text-zinc-700">
        ממשק Admin · פועל מקומית · localhost:{UI_PORT} · לא נשלחים נתונים לאינטרנט
      </div>
    </div>
  );
}
