/**
 * VoiceInputFAB — כפתור מיקרופון צף גלובלי
 *
 * לוחץ פעם → מקליט (מד עוצמה חי)
 * לוחץ שוב → Whisper מתמלל → מעתיק ללוח ומדביק בשדה הממוקד
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const WHISPER_PORT = 3000;
const SAMPLERATE   = 44100;
const MAX_BARS     = 20;

type State = "idle" | "recording" | "processing";

// ── Audio level from AnalyserNode (0–1) ──────────────────────────────────────
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
    const src     = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setLevel(Math.min(avg / 128, 1));
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

// ── Main component ─────────────────────────────────────────────────────────────
export function VoiceInputFAB() {
  const [state, setState]         = useState<State>("idle");
  const [stream, setStream]       = useState<MediaStream | null>(null);
  const [recText, setRecText]     = useState("");   // preview while recording time
  const recorderRef               = useRef<MediaRecorder | null>(null);
  const chunksRef                 = useRef<Blob[]>([]);
  const savedFocusRef             = useRef<Element | null>(null);  // ← focus saved before click steals it
  const level                     = useLevelMeter(state === "recording" ? stream : null);

  // ── Start recording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      chunksRef.current = [];

      const mr = new MediaRecorder(s, { mimeType: getSupportedMime() });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      recorderRef.current = mr;
      setState("recording");
    } catch (err) {
      toast({ title: "שגיאה", description: "לא ניתן לגשת למיקרופון", variant: "destructive" });
    }
  }, []);

  // ── Stop → send to Whisper ──────────────────────────────────────────────────
  const stopAndTranscribe = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    setState("processing");

    mr.onstop = async () => {
      if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null); }

      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      form.append("language", "he");
      form.append("beam_size", "3");
      form.append("normalize", "1");

      try {
        const res = await fetch(`http://localhost:${WHISPER_PORT}/transcribe`, {
          method: "POST", body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const text = (data.text ?? "").trim();

        if (!text) {
          toast({ title: "⚠️ לא זוהה טקסט", description: "נסה שוב" });
          setState("idle"); return;
        }

        // Copy to clipboard
        await navigator.clipboard.writeText(text).catch(() => {});

        // Paste into the element that was focused BEFORE the button click
        const el = (savedFocusRef.current ?? document.activeElement) as HTMLInputElement | HTMLTextAreaElement | null;
        if (el && ("value" in el)) {
          const start = el.selectionStart ?? el.value.length;
          const end   = el.selectionEnd   ?? el.value.length;
          const before = el.value.slice(0, start);
          const after  = el.value.slice(end);
          el.value = before + text + after;
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          // Fallback: execCommand paste (works in many rich editors)
          document.execCommand?.("insertText", false, text);
        }

        setRecText(text.slice(0, 60) + (text.length > 60 ? "…" : ""));
        toast({
          title: "✅ תומלל",
          description: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
        });
      } catch (err) {
        toast({
          title: "❌ שגיאה",
          description: `שרת Whisper לא זמין (port ${WHISPER_PORT})`,
          variant: "destructive",
        });
      } finally {
        setState("idle");
        setTimeout(() => setRecText(""), 4000);
      }
    };

    mr.stop();
  }, [stream]);

  // ── Toggle on click ─────────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (state === "idle")      startRecording();
    else if (state === "recording") stopAndTranscribe();
  }, [state, startRecording, stopAndTranscribe]);

  // ── Cancel ──────────────────────────────────────────────────────────────────
  const cancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    recorderRef.current?.stop();
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setState("idle");
    setRecText("");
  }, [stream]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => () => {
    recorderRef.current?.stop();
    stream?.getTracks().forEach(t => t.stop());
  }, [stream]);

  // ── Level bars (MAX_BARS bars) ─────────────────────────────────────────────
  const bars = Array.from({ length: MAX_BARS }, (_, i) => {
    const threshold = (i + 1) / MAX_BARS;
    const active    = level >= threshold;
    const color     = threshold < 0.5  ? "bg-emerald-400"
                    : threshold < 0.80 ? "bg-yellow-400"
                    :                    "bg-red-400";
    return (
      <div
        key={i}
        className={cn(
          "w-[3px] rounded-sm transition-all duration-75",
          active ? color : "bg-white/15",
          active ? "opacity-100" : "opacity-40",
        )}
        style={{ height: `${6 + Math.floor((i / MAX_BARS) * 16)}px` }}
      />
    );
  });

  return (
    <div
      className="fixed bottom-6 left-6 z-[9999] flex flex-col items-start gap-2"
      dir="rtl"
    >
      {/* ── Popover panel (recording / processing) ── */}
      {state !== "idle" && (
        <div className={cn(
          "flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl backdrop-blur-sm",
          "border text-sm font-medium",
          state === "recording"
            ? "bg-black/80 border-red-500/40 text-white"
            : "bg-black/80 border-blue-500/40 text-white",
        )}>
          {state === "recording" ? (
            <>
              {/* Bars */}
              <div className="flex items-end gap-[2px] h-6">
                {bars}
              </div>
              <span className="text-red-400 text-xs">מקליט… לחץ לעצירה</span>
              <button
                onClick={cancel}
                className="ml-1 text-white/40 hover:text-white/80 transition-colors"
                title="ביטול"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <Loader2 size={16} className="animate-spin text-blue-400" />
              <span className="text-blue-300 text-xs">מתמלל…</span>
            </>
          )}
        </div>
      )}

      {/* ── Result preview strip ── */}
      {recText && state === "idle" && (
        <div className="max-w-[240px] px-3 py-1.5 rounded-xl bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs backdrop-blur-sm shadow-lg">
          {recText}
        </div>
      )}

      {/* ── FAB button ── */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          savedFocusRef.current = document.activeElement;
          if (state === "idle") startRecording();
        }}
        onMouseUp={() => { if (state === "recording") stopAndTranscribe(); }}
        onMouseLeave={() => { if (state === "recording") stopAndTranscribe(); }}
        onTouchStart={(e) => {
          e.preventDefault();
          savedFocusRef.current = document.activeElement;
          if (state === "idle") startRecording();
        }}
        onTouchEnd={() => { if (state === "recording") stopAndTranscribe(); }}
        title={state === "idle" ? "לחץ והחזק להקלטה, שחרר לעצירה" : "שחרר לעצירה"}
        className={cn(
          "w-14 h-14 rounded-full shadow-2xl flex items-center justify-center",
          "transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          state === "idle"
            ? "bg-white border-2 border-amber-600 hover:bg-amber-50 focus-visible:ring-amber-600"
            : state === "recording"
            ? "bg-white border-2 border-red-500 hover:bg-red-50 focus-visible:ring-red-400 animate-pulse"
            : "bg-white border-2 border-amber-500 cursor-not-allowed",
        )}
        disabled={state === "processing"}
      >
        {state === "processing" ? (
          <Loader2 size={24} className="text-blue-950 animate-spin" />
        ) : state === "recording" ? (
          <MicOff size={24} className="text-red-600" />
        ) : (
          <Mic size={24} className="text-blue-950" />
        )}
      </button>
    </div>
  );
}

// ── Pick supported MIME ──────────────────────────────────────────────────────
function getSupportedMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? "";
}
