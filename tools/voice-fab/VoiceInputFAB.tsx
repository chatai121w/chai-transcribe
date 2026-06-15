/**
 * VoiceInputFAB — כפתור מיקרופון צף לתמלול עברית
 * ====================================================
 * קובץ עצמאי (standalone) — ניתן להוסיף לכל פרויקט React.
 *
 * תלויות npm נדרשות:
 *   lucide-react        (אייקונים)
 *   clsx או tailwind-merge  (אופציונלי — אפשר להסיר, ראה הערה למטה)
 *
 * שימוש:
 *   import { VoiceInputFAB } from "./VoiceInputFAB";
 *   // ב-App.tsx / Layout:
 *   <VoiceInputFAB whisperPort={3000} />
 *
 * שרת Whisper נדרש:
 *   מריץ מקומית על http://localhost:{whisperPort}/transcribe
 *   ראה: server/transcribe_server.py
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, X } from "lucide-react";

// ── תחליף פנימי ל-cn / clsx ──────────────────────────────────────────────────
// אם יש לך clsx/tailwind-merge בפרויקט, החלף בהם.
function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ── Toast פשוט (אם אין ספריית toast בפרויקט) ─────────────────────────────────
function showToast(title: string, description?: string, variant?: "default" | "destructive") {
  // אם יש לך ספריית toast (sonner / react-hot-toast / shadcn), החלף כאן.
  const msg = description ? `${title}\n${description}` : title;
  if (variant === "destructive") {
    console.error("[VoiceInputFAB]", msg);
  } else {
    console.info("[VoiceInputFAB]", msg);
  }
  // הצגת באנר פשוט ב-DOM
  const div = document.createElement("div");
  div.style.cssText = `
    position:fixed; bottom:100px; left:24px; z-index:99999;
    background:${variant === "destructive" ? "#7f1d1d" : "#064e3b"};
    color:white; padding:10px 16px; border-radius:12px;
    font-size:13px; font-family:sans-serif; max-width:280px;
    box-shadow:0 4px 20px rgba(0,0,0,.4); direction:rtl;
  `;
  div.innerHTML = `<strong>${title}</strong>${description ? `<br/><span style="opacity:.8">${description}</span>` : ""}`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ── קבועים ───────────────────────────────────────────────────────────────────
const MAX_BARS = 20;

// ── סוגים ────────────────────────────────────────────────────────────────────
type State = "idle" | "recording" | "processing";

export interface VoiceInputFABProps {
  /** פורט שרת Whisper (ברירת מחדל: 3000) */
  whisperPort?: number;
  /** שפת תמלול (ברירת מחדל: "he") */
  language?: string;
  /** קריאה לאחר תמלול מוצלח — מקבלת את הטקסט */
  onTranscribed?: (text: string) => void;
  /** מיקום הכפתור */
  position?: "bottom-left" | "bottom-right";
}

// ── Hook: מד עוצמה קול ────────────────────────────────────────────────────────
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

// ── בחירת MIME נתמך ──────────────────────────────────────────────────────────
function getSupportedMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

// ── רכיב ראשי ─────────────────────────────────────────────────────────────────
export function VoiceInputFAB({
  whisperPort = 3000,
  language = "he",
  onTranscribed,
  position = "bottom-left",
}: VoiceInputFABProps) {
  const [state, setState] = useState<State>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recText, setRecText] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const level = useLevelMeter(state === "recording" ? stream : null);

  // ── התחל הקלטה ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      chunksRef.current = [];

      const mr = new MediaRecorder(s, { mimeType: getSupportedMime() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(100);
      recorderRef.current = mr;
      setState("recording");
    } catch {
      showToast("שגיאה", "לא ניתן לגשת למיקרופון", "destructive");
    }
  }, []);

  // ── עצור → שלח ל-Whisper ───────────────────────────────────────────────────
  const stopAndTranscribe = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    setState("processing");

    mr.onstop = async () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }

      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const form = new FormData();
      form.append("file", blob, "voice.webm");
      form.append("language", language);
      form.append("beam_size", "3");
      form.append("normalize", "1");

      try {
        const res = await fetch(`http://localhost:${whisperPort}/transcribe`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const text = (data.text ?? "").trim();

        if (!text) {
          showToast("⚠️ לא זוהה טקסט", "נסה שוב");
          setState("idle");
          return;
        }

        // העתקה ללוח
        await navigator.clipboard.writeText(text).catch(() => {});

        // הדבקה לתוך האלמנט הממוקד
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (el && "value" in el) {
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          el.value = el.value.slice(0, start) + text + el.value.slice(end);
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          document.execCommand?.("insertText", false, text);
        }

        onTranscribed?.(text);

        setRecText(text.slice(0, 60) + (text.length > 60 ? "…" : ""));
        showToast("✅ תומלל", text.slice(0, 80) + (text.length > 80 ? "…" : ""));
      } catch {
        showToast(
          "❌ שגיאה",
          `שרת Whisper לא זמין (port ${whisperPort})`,
          "destructive"
        );
      } finally {
        setState("idle");
        setTimeout(() => setRecText(""), 4000);
      }
    };

    mr.stop();
  }, [stream, whisperPort, language, onTranscribed]);

  // ── לחיצה על הכפתור ────────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (state === "idle") startRecording();
    else if (state === "recording") stopAndTranscribe();
  }, [state, startRecording, stopAndTranscribe]);

  // ── ביטול הקלטה ────────────────────────────────────────────────────────────
  const cancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      recorderRef.current?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setState("idle");
      setRecText("");
    },
    [stream]
  );

  // ── ניקוי בפירוק ───────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      recorderRef.current?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    },
    [stream]
  );

  // ── עמודות מד עוצמה ────────────────────────────────────────────────────────
  const bars = Array.from({ length: MAX_BARS }, (_, i) => {
    const threshold = (i + 1) / MAX_BARS;
    const active = level >= threshold;
    const color =
      threshold < 0.5
        ? "bg-emerald-400"
        : threshold < 0.8
        ? "bg-yellow-400"
        : "bg-red-400";
    return (
      <div
        key={i}
        className={cn(
          "w-[3px] rounded-sm transition-all duration-75",
          active ? color : "bg-white/15",
          active ? "opacity-100" : "opacity-40"
        )}
        style={{ height: `${6 + Math.floor((i / MAX_BARS) * 16)}px` }}
      />
    );
  });

  const posClass =
    position === "bottom-right"
      ? "fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-2"
      : "fixed bottom-6 left-6 z-[9999] flex flex-col items-start gap-2";

  return (
    <div className={posClass} dir="rtl">
      {/* ── פאנל מצב (הקלטה / עיבוד) ── */}
      {state !== "idle" && (
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl backdrop-blur-sm",
            "border text-sm font-medium",
            state === "recording"
              ? "bg-black/80 border-red-500/40 text-white"
              : "bg-black/80 border-blue-500/40 text-white"
          )}
        >
          {state === "recording" ? (
            <>
              <div className="flex items-end gap-[2px] h-6">{bars}</div>
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

      {/* ── תצוגת תוצאה ── */}
      {recText && state === "idle" && (
        <div className="max-w-[240px] px-3 py-1.5 rounded-xl bg-emerald-900/70 border border-emerald-500/30 text-emerald-300 text-xs backdrop-blur-sm shadow-lg">
          {recText}
        </div>
      )}

      {/* ── כפתור FAB ── */}
      <button
        onClick={handleClick}
        title={
          state === "idle"
            ? "הקלטה קולית (לחץ להתחיל)"
            : "לחץ לעצירה"
        }
        className={cn(
          "w-14 h-14 rounded-full shadow-2xl flex items-center justify-center",
          "transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          state === "idle"
            ? "bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 focus-visible:ring-blue-400"
            : state === "recording"
            ? "bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 focus-visible:ring-red-400 animate-pulse"
            : "bg-gradient-to-br from-slate-600 to-slate-800 cursor-not-allowed"
        )}
        disabled={state === "processing"}
      >
        {state === "processing" ? (
          <Loader2 size={24} className="text-white animate-spin" />
        ) : state === "recording" ? (
          <MicOff size={24} className="text-white" />
        ) : (
          <Mic size={24} className="text-white" />
        )}
      </button>
    </div>
  );
}
