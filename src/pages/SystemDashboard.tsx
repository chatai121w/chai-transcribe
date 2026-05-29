import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  Activity, Server, Mic, MicOff, Radio, Globe, Zap, ZapOff,
  Play, Square, RefreshCw, CheckCircle2, XCircle, Clock,
  Cpu, MemoryStick, Wifi, WifiOff, Settings2, ChevronRight,
  Volume2, Keyboard, Eye, Terminal, Info, Copy, ExternalLink,
  AlertTriangle, Cloud, Monitor, Power, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

// ─── Constants ───────────────────────────────────────────────────────────────
const LAUNCHER_PORT = 8764;
const WHISPER_PORT  = 3000;
const VCMD_PORT     = 8765;
const POLL_MS       = 3000;

// ─── Types ───────────────────────────────────────────────────────────────────
interface ServiceStatus {
  running: boolean;
  label: string;
  detail?: string;
}

interface SystemStatus {
  whisper:      { running: boolean; model_ready?: boolean; gpu?: string; cached_items?: number };
  ollama:       { running: boolean; models?: number };
  vite:         { running: boolean; port?: number };
  cloudflare:   { running: boolean; url?: string };
  voice_hotkey: { running: boolean };
  voice_cmd:    { running: boolean };
  launcher:     boolean;
}

interface WhisperHealth {
  status: string;
  model_ready: boolean;
  gpu: string;
  vram_used_mb?: number;
  vram_total_mb?: number;
  cache_size?: number;
  uptime_s?: number;
}

interface LogEntry {
  id: number;
  ts: string;
  msg: string;
  level: "info" | "warn" | "error" | "success";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const INITIAL_STATUS: SystemStatus = {
  whisper:      { running: false },
  ollama:       { running: false },
  vite:         { running: false },
  cloudflare:   { running: false },
  voice_hotkey: { running: false },
  voice_cmd:    { running: false },
  launcher:     false,
};

function StatusDot({ on, pulse = true }: { on: boolean; pulse?: boolean }) {
  return (
    <span className={cn(
      "inline-block w-2.5 h-2.5 rounded-full shrink-0",
      on ? "bg-emerald-400" : "bg-red-400/70",
      on && pulse && "animate-pulse",
    )} />
  );
}

function ServiceRow({
  icon: Icon, label, description, status, onToggle, loading, extra,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  status: boolean;
  onToggle: () => void;
  loading?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-4 rounded-xl border transition-all duration-300",
      status
        ? "bg-emerald-950/30 border-emerald-700/40"
        : "bg-zinc-900/60 border-zinc-700/40",
    )}>
      <div className={cn(
        "p-2.5 rounded-lg",
        status ? "bg-emerald-800/40 text-emerald-300" : "bg-zinc-800 text-zinc-400",
      )}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-zinc-100">{label}</span>
          <StatusDot on={status} />
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 truncate">{description}</p>
        {extra && <div className="mt-1">{extra}</div>}
      </div>
      {loading ? (
        <Loader2 size={18} className="animate-spin text-zinc-400" />
      ) : (
        <Switch checked={status} onCheckedChange={onToggle} />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color = "zinc" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-950/40 border-emerald-700/30",
    blue:    "text-blue-400 bg-blue-950/40 border-blue-700/30",
    orange:  "text-orange-400 bg-orange-950/40 border-orange-700/30",
    violet:  "text-violet-400 bg-violet-950/40 border-violet-700/30",
    zinc:    "text-zinc-300 bg-zinc-900/60 border-zinc-700/40",
  };
  return (
    <div className={cn("rounded-xl border p-4", colorMap[color] ?? colorMap.zinc)}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const cls = {
    info:    "text-zinc-400",
    warn:    "text-amber-400",
    error:   "text-red-400",
    success: "text-emerald-400",
  }[entry.level];
  return (
    <div className={cn("flex gap-2 text-xs font-mono py-0.5", cls)}>
      <span className="text-zinc-600 shrink-0">{entry.ts}</span>
      <span>{entry.msg}</span>
    </div>
  );
}

// ─── Settings state (persisted in localStorage) ──────────────────────────────
function useSetting<T>(key: string, def: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try { const s = localStorage.getItem("sys_dash_" + key); return s !== null ? JSON.parse(s) : def; }
    catch { return def; }
  });
  const set = useCallback((v: T) => {
    setVal(v);
    localStorage.setItem("sys_dash_" + key, JSON.stringify(v));
  }, [key]);
  return [val, set];
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function SystemDashboard() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  const [status, setStatus]             = useState<SystemStatus>(INITIAL_STATUS);
  const [whisperHealth, setWhisperHealth] = useState<WhisperHealth | null>(null);
  const [launcharOk, setLauncherOk]     = useState(false);
  const [loading, setLoading]           = useState<Record<string, boolean>>({});
  const [logs, setLogs]                 = useState<LogEntry[]>([]);
  const [logId, setLogId]               = useState(0);
  const [vcmdState, setVcmdState]       = useState("idle");
  const [lastHeard, setLastHeard]       = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // ── Settings ──────────────────────────────────────────────────────────────
  const [whisperBeam, setWhisperBeam]   = useSetting("whisper_beam", 3);
  const [wakeWord, setWakeWord]         = useSetting("wake_word", "ביג");
  const [rmsThreshold, setRmsThreshold] = useSetting("rms_threshold", 200);
  const [hotkey, setHotkey]             = useSetting("hotkey", "ctrl+shift+h");
  const [vcmdModel, setVcmdModel]       = useSetting("vcmd_model", "tiny");

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addLog = useCallback((msg: string, level: LogEntry["level"] = "info") => {
    const ts = new Date().toLocaleTimeString("he-IL", { hour12: false });
    setLogs(prev => [...prev.slice(-199), { id: logId, ts, msg, level }]);
    setLogId(n => n + 1);
  }, [logId]);

  const setLoad = (key: string, val: boolean) =>
    setLoading(prev => ({ ...prev, [key]: val }));

  // ── Poll launcher status ─────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch(`http://localhost:${LAUNCHER_PORT}/status`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return;
      const d = await r.json();
      setLauncherOk(true);
      setStatus(prev => ({
        ...prev,
        whisper:      { running: d.whisper?.running ?? false, model_ready: d.whisper?.data?.model_ready },
        ollama:       { running: d.ollama?.running ?? false,  models: d.ollama?.models },
        vite:         { running: d.vite?.running ?? false,    port: d.vite?.port },
        voice_hotkey: { running: d.voice_hotkey?.running ?? prev.voice_hotkey.running },
        voice_cmd:    { running: d.voice_cmd?.running ?? prev.voice_cmd.running },
        launcher:     true,
      }));
    } catch {
      setLauncherOk(false);
    }
  }, []);

  // ── Poll whisper health ───────────────────────────────────────────────────
  const pollWhisper = useCallback(async () => {
    try {
      const r = await fetch(`http://localhost:${WHISPER_PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return;
      const d = await r.json();
      setWhisperHealth(d);
      setStatus(prev => ({ ...prev, whisper: { ...prev.whisper, running: true, model_ready: d.model_ready, gpu: d.gpu } }));
    } catch {
      setWhisperHealth(null);
    }
  }, []);

  // ── Poll voice-cmd SSE status ─────────────────────────────────────────────
  const pollVcmd = useCallback(async () => {
    try {
      const r = await fetch(`http://localhost:${VCMD_PORT}/api/state`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return;
      const d = await r.json();
      setVcmdState(d.state ?? "idle");
      setLastHeard(d.last_heard ?? "");
      setStatus(prev => ({ ...prev, voice_cmd: { running: true } }));
    } catch {
      setStatus(prev => ({ ...prev, voice_cmd: { running: false } }));
    }
  }, []);

  useEffect(() => {
    pollStatus(); pollWhisper(); pollVcmd();
    const t1 = setInterval(pollStatus,  POLL_MS);
    const t2 = setInterval(pollWhisper, POLL_MS + 500);
    const t3 = setInterval(pollVcmd,    2000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [pollStatus, pollWhisper, pollVcmd]);

  // ── Scroll logs to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── API Actions ───────────────────────────────────────────────────────────
  const apiCall = useCallback(async (
    url: string, opts: RequestInit, loadKey: string, successMsg: string,
  ) => {
    setLoad(loadKey, true);
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
      const d = await r.json().catch(() => ({}));
      addLog(successMsg, "success");
      await pollStatus(); await pollWhisper();
      return d;
    } catch (e) {
      addLog(`שגיאה: ${String(e)}`, "error");
      toast({ title: "שגיאה", description: String(e), variant: "destructive" });
    } finally {
      setLoad(loadKey, false);
    }
  }, [addLog, pollStatus, pollWhisper]);

  const toggleService = useCallback(async (
    key: keyof SystemStatus, isRunning: boolean,
    startBody?: object, stopBody?: object,
  ) => {
    if (!launcharOk) {
      toast({ title: "Launcher לא פעיל", description: "הפעל את launcher_tray.py תחילה", variant: "destructive" });
      return;
    }
    const base = `http://localhost:${LAUNCHER_PORT}`;
    if (isRunning) {
      await apiCall(`${base}/stop`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stopBody ?? { target: key === "voice_hotkey" ? "voice_hotkey" : key }),
      }, String(key), `${key} הופסק`);
    } else {
      await apiCall(`${base}/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startBody ?? { target: key === "voice_hotkey" ? "voice_hotkey" : key }),
      }, String(key), `${key} הופעל`);
    }
  }, [launcharOk, apiCall]);

  const startAll = () => apiCall(
    `http://localhost:${LAUNCHER_PORT}/start`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "all" }) },
    "all", "כל השירותים הופעלו",
  );
  const stopAll = () => apiCall(
    `http://localhost:${LAUNCHER_PORT}/stop`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "all" }) },
    "all", "כל השירותים הופסקו",
  );

  // ── Running count ─────────────────────────────────────────────────────────
  const runningCount = [
    status.whisper.running, status.ollama.running, status.vite.running,
    status.cloudflare.running, status.voice_hotkey.running, status.voice_cmd.running,
  ].filter(Boolean).length;

  // ── VRAM progress ─────────────────────────────────────────────────────────
  const vramPct = whisperHealth?.vram_used_mb && whisperHealth?.vram_total_mb
    ? Math.round((whisperHealth.vram_used_mb / whisperHealth.vram_total_mb) * 100)
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-900/40 border border-violet-700/40">
            <Monitor size={24} className="text-violet-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">לוח בקרה</h1>
            <p className="text-xs text-zinc-500">Smart Hebrew Transcriber</p>
          </div>
        </div>

        {/* Overall status */}
        <div className="flex items-center gap-2 sm:mr-auto">
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
            launcharOk
              ? "bg-emerald-950/50 border-emerald-700/40 text-emerald-300"
              : "bg-red-950/50 border-red-700/40 text-red-300",
          )}>
            <StatusDot on={launcharOk} pulse={false} />
            {launcharOk ? "Launcher פעיל" : "Launcher כבוי"}
          </div>
          <Badge variant="outline" className="text-zinc-300 border-zinc-700">
            {runningCount}/6 פעילים
          </Badge>
        </div>

        {/* Start / Stop All */}
        <div className="flex gap-2">
          <button
            onClick={startAll}
            disabled={loading.all}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white text-sm font-medium transition disabled:opacity-50"
          >
            {loading.all ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            הפעל הכל
          </button>
          <button
            onClick={stopAll}
            disabled={loading.all}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-700/80 hover:bg-zinc-600 text-white text-sm font-medium transition disabled:opacity-50"
          >
            <Square size={14} />
            עצור הכל
          </button>
          <button
            onClick={() => { pollStatus(); pollWhisper(); pollVcmd(); addLog("רענון ידני", "info"); }}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Whisper" value={status.whisper.running ? "✓" : "✗"}
          sub={status.whisper.model_ready ? "מודל טעון" : "מאתחל..."}
          color={status.whisper.running ? "emerald" : "zinc"} />
        <StatCard label="Ollama" value={status.ollama.running ? "✓" : "✗"}
          sub={status.ollama.models !== undefined ? `${status.ollama.models} מודלים` : undefined}
          color={status.ollama.running ? "emerald" : "zinc"} />
        <StatCard label="Voice Hotkey" value={status.voice_hotkey.running ? "✓" : "✗"}
          sub="Ctrl+Shift+H"
          color={status.voice_hotkey.running ? "blue" : "zinc"} />
        <StatCard label="Voice Cmd" value={status.voice_cmd.running ? "✓" : "✗"}
          sub={status.voice_cmd.running ? vcmdState : "כבוי"}
          color={status.voice_cmd.running ? "violet" : "zinc"} />
        <StatCard label="Vite Dev" value={status.vite.running ? "✓" : "✗"}
          sub={`:${status.vite.port ?? 8081}`}
          color={status.vite.running ? "orange" : "zinc"} />
        <StatCard label="Cloudflare" value={status.cloudflare.running ? "✓" : "✗"}
          sub={status.cloudflare.running ? "Tunnel" : "כבוי"}
          color={status.cloudflare.running ? "blue" : "zinc"} />
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview" dir="rtl">
        <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 bg-zinc-900 border border-zinc-800 rounded-xl mb-4 h-auto p-1">
          <TabsTrigger value="overview"   className="text-xs py-2 data-[state=active]:bg-zinc-700">📊 סקירה</TabsTrigger>
          <TabsTrigger value="whisper"    className="text-xs py-2 data-[state=active]:bg-zinc-700">🤖 Whisper</TabsTrigger>
          <TabsTrigger value="hotkey"     className="text-xs py-2 data-[state=active]:bg-zinc-700">🎹 Hotkey</TabsTrigger>
          <TabsTrigger value="vcmd"       className="text-xs py-2 data-[state=active]:bg-zinc-700">🔔 Voice Cmd</TabsTrigger>
          <TabsTrigger value="frontend"   className="text-xs py-2 data-[state=active]:bg-zinc-700">🌐 Frontend</TabsTrigger>
          <TabsTrigger value="logs"       className="text-xs py-2 data-[state=active]:bg-zinc-700">📋 לוגים</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════
            TAB 1: Overview
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview">
          <div className="grid md:grid-cols-2 gap-3">
            <ServiceRow
              icon={Cpu} label="Whisper Server (CUDA)"
              description={`port 3000 — ${status.whisper.model_ready ? "ivrit-ai/whisper-large-v3-turbo" : "טוען מודל..."}`}
              status={status.whisper.running}
              loading={loading.whisper}
              onToggle={() => toggleService("whisper", status.whisper.running)}
              extra={whisperHealth?.gpu && (
                <span className="text-xs text-emerald-400">{whisperHealth.gpu}</span>
              )}
            />
            <ServiceRow
              icon={Radio} label="Ollama"
              description={`port 11434 — ${status.ollama.models ?? 0} מודלים זמינים`}
              status={status.ollama.running}
              loading={loading.ollama}
              onToggle={() => toggleService("ollama", status.ollama.running)}
            />
            <ServiceRow
              icon={Keyboard} label="Voice Hotkey"
              description={`Ctrl+Shift+H • מקליט ומדביק מכל אפליקציה`}
              status={status.voice_hotkey.running}
              loading={loading.voice_hotkey}
              onToggle={() => toggleService("voice_hotkey", status.voice_hotkey.running)}
            />
            <ServiceRow
              icon={Volume2} label="Voice Command Listener"
              description={`wake word: ${wakeWord} • מאזין ברקע`}
              status={status.voice_cmd.running}
              loading={loading.voice_cmd}
              onToggle={() => toggleService("voice_cmd", status.voice_cmd.running)}
              extra={status.voice_cmd.running && (
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-medium", {
                    "text-green-400":  vcmdState === "listening",
                    "text-red-400":    vcmdState === "recording",
                    "text-orange-400": vcmdState === "processing",
                    "text-zinc-400":   vcmdState === "idle",
                  })}>
                    {vcmdState === "listening" ? "👂 מאזין" :
                     vcmdState === "recording" ? "🔴 מקליט" :
                     vcmdState === "processing" ? "⚙️ מעבד" : "💤 ממתין"}
                  </span>
                  {lastHeard && <span className="text-xs text-zinc-500 truncate max-w-[160px]">"{lastHeard}"</span>}
                </div>
              )}
            />
            <ServiceRow
              icon={Globe} label="Vite Dev Server"
              description={`port ${status.vite.port ?? 8081} — ממשק משתמש React`}
              status={status.vite.running}
              loading={loading.vite}
              onToggle={() => toggleService("vite", status.vite.running)}
            />
            <ServiceRow
              icon={Cloud} label="Cloudflare Tunnel"
              description={status.cloudflare.url ?? "מנהרה ציבורית ל-Whisper Server"}
              status={status.cloudflare.running}
              loading={loading.cloudflare}
              onToggle={() => toggleService("cloudflare", status.cloudflare.running)}
            />
          </div>

          {/* Launcher not running warning */}
          {!launcharOk && (
            <div className="mt-4 flex items-start gap-3 p-4 rounded-xl border border-amber-700/40 bg-amber-950/30">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-300">Launcher Tray לא פועל</p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  לשליטה מלאה בשירותים, הפעל:<br/>
                  <code className="bg-zinc-800 px-1 rounded text-xs">.venv\Scripts\python.exe server\launcher_tray.py</code>
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            TAB 2: Whisper Server
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="whisper">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Status card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu size={16} className="text-emerald-400" />
                  <span className="font-semibold">Whisper Server</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusDot on={status.whisper.running} />
                  <span className={cn("text-xs", status.whisper.running ? "text-emerald-400" : "text-red-400")}>
                    {status.whisper.running ? "פעיל" : "כבוי"}
                  </span>
                </div>
              </div>
              <Separator className="bg-zinc-800" />

              {whisperHealth ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">מודל</span>
                    <span className="text-zinc-200 font-mono text-xs">ivrit-ai/whisper-large-v3-turbo</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">GPU</span>
                    <span className="text-emerald-400">{whisperHealth.gpu ?? "CUDA"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">מודל טעון</span>
                    {whisperHealth.model_ready
                      ? <CheckCircle2 size={16} className="text-emerald-400" />
                      : <Loader2 size={16} className="animate-spin text-amber-400" />}
                  </div>
                  {whisperHealth.cache_size !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Cache</span>
                      <span className="text-zinc-300">{whisperHealth.cache_size} / 100 רשומות (24h)</span>
                    </div>
                  )}
                  {vramPct !== null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-zinc-500">
                        <span>VRAM</span>
                        <span>{whisperHealth.vram_used_mb}MB / {whisperHealth.vram_total_mb}MB</span>
                      </div>
                      <Progress value={vramPct} className="h-1.5" />
                    </div>
                  )}
                  {whisperHealth.uptime_s !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Uptime</span>
                      <span className="text-zinc-300">{Math.floor(whisperHealth.uptime_s / 60)} דקות</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 text-center py-4">שרת לא מגיב</p>
              )}

              <Separator className="bg-zinc-800" />
              <div className="flex items-center justify-between">
                <span className="text-sm">מצב שרת</span>
                <Switch
                  checked={status.whisper.running}
                  onCheckedChange={() => toggleService("whisper", status.whisper.running)}
                  disabled={loading.whisper}
                />
              </div>
            </div>

            {/* Settings card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-blue-400" />
                <span className="font-semibold">הגדרות תמלול</span>
              </div>
              <Separator className="bg-zinc-800" />

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Beam Size: {whisperBeam}</Label>
                <Slider
                  min={1} max={10} step={1}
                  value={[whisperBeam]}
                  onValueChange={([v]) => setWhisperBeam(v)}
                  className="w-full"
                />
                <p className="text-xs text-zinc-600">
                  גבוה יותר = מדויק יותר אך איטי. 3-5 מומלץ.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">שפה</Label>
                <div className="flex gap-2">
                  {["he", "en", "ar", "auto"].map(lang => (
                    <button key={lang}
                      className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs hover:bg-zinc-700 transition text-zinc-300"
                    >{lang}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Endpoint</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={`http://localhost:${WHISPER_PORT}/transcribe`}
                    className="bg-zinc-800 border-zinc-700 text-xs text-zinc-400 font-mono"
                  />
                  <button
                    onClick={() => { navigator.clipboard.writeText(`http://localhost:${WHISPER_PORT}/transcribe`); toast({ title: "הועתק!" }); }}
                    className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 p-3 space-y-1">
                <p className="text-xs font-medium text-zinc-300">📌 Cache SHA-256</p>
                <p className="text-xs text-zinc-500">אותה הקלטה = תוצאה מיידית. TTL 24h, מקסימום 100 רשומות.</p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            TAB 3: Voice Hotkey
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="hotkey">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Keyboard size={16} className="text-blue-400" />
                  <span className="font-semibold">Voice Hotkey</span>
                </div>
                <StatusDot on={status.voice_hotkey.running} />
              </div>
              <Separator className="bg-zinc-800" />

              <div className="space-y-2">
                {[
                  ["קיצור", hotkey.toUpperCase()],
                  ["פורמט", "16kHz Mono WAV"],
                  ["שרת", `localhost:${WHISPER_PORT}`],
                  ["מודל", "Large Whisper (GPU)"],
                  ["פעולה", "Ctrl+V אוטומטי"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-zinc-500">{k}</span>
                    <span className="text-zinc-200 font-mono text-xs">{v}</span>
                  </div>
                ))}
              </div>

              <Separator className="bg-zinc-800" />
              <div className="flex items-center justify-between">
                <span className="text-sm">מצב שירות</span>
                <Switch
                  checked={status.voice_hotkey.running}
                  onCheckedChange={() => toggleService("voice_hotkey", status.voice_hotkey.running)}
                  disabled={loading.voice_hotkey}
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-blue-400" />
                <span className="font-semibold">הגדרות</span>
              </div>
              <Separator className="bg-zinc-800" />

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">קיצור מקשים</Label>
                <Input
                  value={hotkey}
                  onChange={e => setHotkey(e.target.value)}
                  placeholder="ctrl+shift+h"
                  className="bg-zinc-800 border-zinc-700 text-sm font-mono"
                />
                <p className="text-xs text-zinc-600">שנה ולאחר מכן הפעל מחדש את השירות</p>
              </div>

              <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 p-3 space-y-2">
                <p className="text-xs font-medium text-zinc-300">🔄 זרימת עבודה</p>
                {[
                  "1. לחץ Ctrl+Shift+H בכל אפליקציה",
                  "2. חלון אוברליי + מד עוצמה נפתח",
                  "3. דבר בעברית",
                  "4. לחץ שוב לסיום",
                  "5. Whisper Large מתמלל (GPU)",
                  "6. טקסט מודבק בשדה שהיה פעיל",
                ].map(s => <p key={s} className="text-xs text-zinc-500">{s}</p>)}
              </div>

              <div className="rounded-lg bg-blue-950/30 border border-blue-700/30 p-3">
                <p className="text-xs font-medium text-blue-300">💡 Auto-start</p>
                <p className="text-xs text-blue-400/70 mt-1">
                  <code className="bg-zinc-800 px-1 rounded">tools\voice-hotkey\install-startup.bat</code>
                  {" "}— מפעיל אוטומטית עם Windows ללא חלון שחור
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            TAB 4: Voice Command
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="vcmd">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Status live */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="text-violet-400" />
                  <span className="font-semibold">Voice Command Listener</span>
                </div>
                <StatusDot on={status.voice_cmd.running} />
              </div>
              <Separator className="bg-zinc-800" />

              {/* Live state indicator */}
              <div className={cn(
                "rounded-xl p-4 border text-center transition-all",
                vcmdState === "recording"  ? "bg-red-950/40 border-red-700/40" :
                vcmdState === "processing" ? "bg-orange-950/40 border-orange-700/40" :
                vcmdState === "listening"  ? "bg-emerald-950/40 border-emerald-700/40" :
                "bg-zinc-900/40 border-zinc-700/40"
              )}>
                <p className="text-2xl mb-1">
                  {vcmdState === "listening" ? "👂" :
                   vcmdState === "recording" ? "🔴" :
                   vcmdState === "processing" ? "⚙️" : "💤"}
                </p>
                <p className="text-sm font-medium text-zinc-200">
                  {vcmdState === "listening" ? "מאזין לפקודה" :
                   vcmdState === "recording" ? "מקליט..." :
                   vcmdState === "processing" ? "מעבד תמלול" :
                   "ממתין (idle)"}
                </p>
                {lastHeard && (
                  <p className="text-xs text-zinc-400 mt-1 italic">שמעתי: "{lastHeard}"</p>
                )}
              </div>

              <div className="space-y-2">
                {[
                  ["Wake Word", wakeWord],
                  ["מודל זיהוי", vcmdModel],
                  ["מודל תמלול", "Large Whisper (port 3000)"],
                  ["מקסימום הקלטה", "45 שניות"],
                  ["שקט לסיום", "3 שניות"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-zinc-500">{k}</span>
                    <span className="text-zinc-200 font-mono text-xs">{v}</span>
                  </div>
                ))}
              </div>

              <Separator className="bg-zinc-800" />
              <div className="flex items-center justify-between">
                <span className="text-sm">מצב שירות</span>
                <Switch
                  checked={status.voice_cmd.running}
                  onCheckedChange={() => toggleService("voice_cmd", status.voice_cmd.running)}
                  disabled={loading.voice_cmd}
                />
              </div>
            </div>

            {/* Settings */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-violet-400" />
                <span className="font-semibold">הגדרות</span>
              </div>
              <Separator className="bg-zinc-800" />

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Wake Word (מילת הפעלה)</Label>
                <Input
                  value={wakeWord}
                  onChange={e => setWakeWord(e.target.value)}
                  placeholder="ביג"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  dir="rtl"
                />
                <p className="text-xs text-zinc-600">Fuzzy match 68% — מכסה transcription לא מדויק</p>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">מודל זיהוי</Label>
                <div className="flex gap-2">
                  {["tiny", "base", "small"].map(m => (
                    <button key={m}
                      onClick={() => setVcmdModel(m)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-xs transition",
                        vcmdModel === m
                          ? "border-violet-500 bg-violet-900/40 text-violet-300"
                          : "border-zinc-700 text-zinc-400 hover:bg-zinc-700",
                      )}
                    >{m}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">RMS Threshold (רגישות מיקרופון): {rmsThreshold}</Label>
                <Slider
                  min={50} max={800} step={25}
                  value={[rmsThreshold]}
                  onValueChange={([v]) => setRmsThreshold(v)}
                />
                <p className="text-xs text-zinc-600">
                  נמוך = רגיש יותר (סביבה שקטה). גבוה = פחות רגיש (סביבה רועשת).
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Label className="text-zinc-400 text-xs">קישור לניטור בזמן אמת</Label>
                <a
                  href={`http://localhost:${VCMD_PORT}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink size={12} />
                  {`localhost:${VCMD_PORT}`}
                </a>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            TAB 5: Frontend
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="frontend">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-orange-400" />
                  <span className="font-semibold">Vite Dev Server</span>
                </div>
                <StatusDot on={status.vite.running} />
              </div>
              <Separator className="bg-zinc-800" />
              <div className="space-y-2">
                {[
                  ["פורט", `:${status.vite.port ?? 8081}`],
                  ["Framework", "React + TypeScript"],
                  ["CSS", "Tailwind + shadcn/ui"],
                  ["Auth", "Supabase"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-zinc-500">{k}</span>
                    <span className="text-zinc-200 font-mono text-xs">{v}</span>
                  </div>
                ))}
              </div>
              <Separator className="bg-zinc-800" />
              <div className="flex gap-2">
                <a
                  href={`http://localhost:${status.vite.port ?? 8081}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-orange-800/40 border border-orange-700/40 text-orange-300 hover:bg-orange-700/40 text-sm transition"
                >
                  <ExternalLink size={13} /> פתח באפליקציה
                </a>
                <Switch
                  checked={status.vite.running}
                  onCheckedChange={() => toggleService("vite", status.vite.running)}
                  disabled={loading.vite}
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud size={16} className="text-blue-400" />
                  <span className="font-semibold">Cloudflare Tunnel</span>
                </div>
                <StatusDot on={status.cloudflare.running} />
              </div>
              <Separator className="bg-zinc-800" />

              {status.cloudflare.url ? (
                <div className="rounded-lg bg-zinc-800/60 p-3 space-y-2">
                  <p className="text-xs text-zinc-500">URL ציבורי:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-blue-300 truncate flex-1">{status.cloudflare.url}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(status.cloudflare.url ?? ""); toast({ title: "הועתק!" }); }}
                      className="p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-400"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-500 py-2">טונל לא פעיל. לחץ Start All או הפעל ידנית.</p>
              )}

              <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 p-3">
                <p className="text-xs font-medium text-zinc-300">לשם מה?</p>
                <p className="text-xs text-zinc-500 mt-1">
                  מאפשר גישה ל-Whisper Server מהאינטרנט (למשל מ-Lovable.app) ללא פורט פורוורד.
                  מנהרה זמנית בחינם של Cloudflare.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">מצב טונל</span>
                <Switch
                  checked={status.cloudflare.running}
                  onCheckedChange={() => toggleService("cloudflare", status.cloudflare.running)}
                  disabled={loading.cloudflare}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            TAB 6: Logs
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="logs">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Terminal size={15} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-300">לוג פעילות</span>
                <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-500">{logs.length} שורות</Badge>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition"
              >
                נקה
              </button>
            </div>
            <ScrollArea className="h-[400px] rounded-lg bg-zinc-950 border border-zinc-800 p-3">
              <div ref={logRef} className="space-y-0.5">
                {logs.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-8">אין לוגים עדיין — פעולות מופיעות כאן</p>
                ) : (
                  logs.map(e => <LogLine key={e.id} entry={e} />)
                )}
              </div>
            </ScrollArea>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { cls: "text-emerald-400", label: "success" },
                { cls: "text-amber-400",   label: "warning" },
                { cls: "text-red-400",     label: "error" },
                { cls: "text-zinc-400",    label: "info" },
              ].map(({ cls, label }) => (
                <div key={label} className={cn("flex items-center gap-1.5 text-xs", cls)}>
                  <span className="w-2 h-2 rounded-full bg-current" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
