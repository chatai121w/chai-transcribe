import { CheckCircle2, XCircle, Loader2, SkipForward, Ban, Scissors, Cog, FileAudio } from "lucide-react";
import type { TierEvent, CutTier, TieredCutProgress } from "@/lib/tieredCutEngine";

interface Props {
  events: TierEvent[];
  activeProgress: TieredCutProgress | null;
  finalTier?: CutTier | null;
}

const TIERS: { id: CutTier; title: string; subtitle: string; icon: typeof Scissors }[] = [
  { id: "wav-slice",   title: "Tier 1 — חיתוך WAV ישיר",          subtitle: "מהיר ביותר · רק לקבצי WAV",                         icon: Scissors },
  { id: "ffmpeg-copy", title: "Tier 2 — FFmpeg.wasm (ללא קידוד)", subtitle: "שומר את הקודק המקורי (MP3/M4A/Opus/…)",            icon: Cog },
  { id: "audio-buffer",title: "Tier 3 — פיענוח מלא → WAV",         subtitle: "גיבוי · קבצים גדולים ודחוסים — פלט WAV לא דחוס",  icon: FileAudio },
];

function statusOf(events: TierEvent[], tier: CutTier) {
  const list = events.filter((e) => e.tier === tier);
  if (list.length === 0) return { state: "idle" as const, last: null };
  const last = list[list.length - 1];
  return { state: last.status, last };
}

export function TierStatusPanel({ events, activeProgress, finalTier }: Props) {
  if (events.length === 0 && !activeProgress) return null;

  return (
    <div dir="rtl" className="rounded-xl border border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-950/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-foreground">מצב מנועי החיתוך</h4>
        {finalTier && (
          <span className="text-[10px] rounded-full bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5">
            הסתיים ב-{TIERS.find((t) => t.id === finalTier)?.title.split("—")[0].trim()}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {TIERS.map((t) => {
          const { state, last } = statusOf(events, t.id);
          const Icon = t.icon;

          const stateColors: Record<string, string> = {
            idle:    "border-border bg-card text-muted-foreground",
            started: "border-yellow-500/60 bg-yellow-500/10 text-foreground",
            success: "border-green-500/60 bg-green-500/10 text-foreground",
            failed:  "border-red-500/60 bg-red-500/10 text-foreground",
            skipped: "border-border bg-muted/40 text-muted-foreground",
            aborted: "border-red-500/60 bg-red-500/10 text-foreground",
          };

          const StatusIcon =
            state === "success" ? CheckCircle2 :
            state === "failed"  ? XCircle :
            state === "aborted" ? Ban :
            state === "skipped" ? SkipForward :
            state === "started" ? Loader2 :
            null;

          const isActive = state === "started";
          const isActiveTier = isActive && activeProgress?.tier === t.id;
          const pct = isActiveTier
            ? Math.max(1, Math.min(99, Math.round((activeProgress.completed / Math.max(1, activeProgress.total)) * 100)))
            : state === "success" ? 100 : 0;

          return (
            <div key={t.id} className={`rounded-lg border px-3 py-2 transition-colors ${stateColors[state]}`}>
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0 opacity-70" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{t.title}</div>
                  <div className="text-[10px] opacity-70 truncate">{t.subtitle}</div>
                </div>
                {StatusIcon && (
                  <StatusIcon className={`w-4 h-4 shrink-0 ${state === "started" ? "animate-spin text-yellow-600" : state === "success" ? "text-green-600" : state === "failed" || state === "aborted" ? "text-red-600" : "text-muted-foreground"}`} />
                )}
              </div>

              {/* Active message + progress bar */}
              {isActiveTier && (
                <div className="mt-1.5 space-y-1">
                  <div className="text-[11px] text-foreground/80">{activeProgress.message}</div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  {activeProgress.total > 1 && (
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {activeProgress.completed} / {activeProgress.total}
                    </div>
                  )}
                </div>
              )}

              {/* Last message / reason */}
              {!isActiveTier && last && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[11px]">{last.message}</div>
                  {last.reason && (
                    <div className="text-[10px] text-red-700 dark:text-red-400 break-words" dir="ltr">
                      {last.reason}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {finalTier === "audio-buffer" && (
        <div className="text-[11px] rounded-lg bg-amber-100 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-700/30 px-2.5 py-1.5 text-amber-900 dark:text-amber-200">
          ⚠️ הפלט הוא WAV לא דחוס (גדול בערך פי 4 מהמקור). זה קרה כי Tier 2 (FFmpeg) נכשל — ראה הסיבה למעלה.
        </div>
      )}
    </div>
  );
}
