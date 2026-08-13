import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { Pause, Play, Plus, RotateCcw, Trash2, Volume2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildAudioEditPlan,
  planDuration,
  type AudioRange,
  type AudioSelectionMode,
} from "@/lib/audioEditPlan";
import type { CutSegment } from "@/lib/audioCutEngine";

const COLORS = [
  "rgba(37, 99, 235, 0.28)",
  "rgba(16, 185, 129, 0.28)",
  "rgba(245, 158, 11, 0.30)",
  "rgba(168, 85, 247, 0.28)",
  "rgba(236, 72, 153, 0.28)",
  "rgba(6, 182, 212, 0.28)",
];

const MODE_META: Record<AudioSelectionMode, { label: string; description: string; color: string }> = {
  keep: {
    label: "שמור רק את המסומן",
    description: "כל אזור מסומן יישמר כקטע; שאר האודיו לא ייכלל",
    color: "border-emerald-500 bg-emerald-500/10 text-emerald-800",
  },
  remove: {
    label: "הסר את המסומן",
    description: "האזורים המסומנים ייחתכו החוצה והחלקים הנותרים יישמרו",
    color: "border-red-500 bg-red-500/10 text-red-800",
  },
  split: {
    label: "פצל ושמור את הכול",
    description: "האודיו יופרד בכל גבול שסימנת, וכל החלקים יישמרו",
    color: "border-blue-500 bg-blue-500/10 text-blue-800",
  },
};

function formatPreciseTime(seconds: number): string {
  const safe = Math.max(0, seconds || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  const base = `${minutes.toString().padStart(hours ? 2 : 1, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
  return hours ? `${hours}:${base}` : base;
}

interface VisualAudioCutEditorProps {
  file: File;
  durationSec: number;
  onPlanChange: (segments: CutSegment[], mode: AudioSelectionMode) => void;
}

export default function VisualAudioCutEditor({ file, durationSec, onPlanChange }: VisualAudioCutEditorProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [ranges, setRanges] = useState<Array<AudioRange & { id: string }>>([]);
  const [mode, setMode] = useState<AudioSelectionMode>("keep");
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);

  const syncRanges = useCallback(() => {
    const next = (regionsRef.current?.getRegions() || [])
      .map((region) => ({ id: region.id, startSec: region.start, endSec: region.end }))
      .sort((a, b) => a.startSec - b.startSec);
    setRanges(next);
  }, []);

  useEffect(() => {
    if (!waveformRef.current) return;
    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({ height: 20 });
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "hsl(215 22% 67%)",
      progressColor: "hsl(222 47% 22%)",
      cursorColor: "hsl(42 90% 48%)",
      cursorWidth: 2,
      height: 112,
      normalize: true,
      interact: true,
      dragToSeek: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regions, timeline],
    });
    wavesurferRef.current = wavesurfer;
    regionsRef.current = regions;

    const disableDrag = regions.enableDragSelection({
      color: COLORS[0],
      drag: true,
      resize: true,
      minLength: 0.25,
    }, 5);

    wavesurfer.on("ready", () => setReady(true));
    wavesurfer.on("play", () => setPlaying(true));
    wavesurfer.on("pause", () => setPlaying(false));
    wavesurfer.on("finish", () => setPlaying(false));
    wavesurfer.on("timeupdate", setCurrentTime);
    wavesurfer.on("interaction", setCurrentTime);
    wavesurfer.on("seeking", setCurrentTime);
    regions.on("region-created", (region) => {
      const index = regions.getRegions().findIndex((candidate) => candidate.id === region.id);
      region.setOptions({ color: COLORS[Math.max(0, index) % COLORS.length] });
      syncRanges();
    });
    regions.on("region-updated", syncRanges);
    regions.on("region-removed", syncRanges);
    regions.on("region-clicked", (region, event) => {
      event.stopPropagation();
      setActiveRegionId(region.id);
      region.play(true);
    });

    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    void wavesurfer.load(url);

    return () => {
      disableDrag();
      wavesurfer.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    };
  }, [file, syncRanges]);

  useEffect(() => {
    if (!ready) return;
    wavesurferRef.current?.zoom(zoom);
  }, [ready, zoom]);

  const plan = useMemo(
    () => buildAudioEditPlan(ranges, durationSec, mode),
    [durationSec, mode, ranges],
  );

  useEffect(() => {
    onPlanChange(plan, mode);
  }, [mode, onPlanChange, plan]);

  const addRegionAtCursor = useCallback(() => {
    const plugin = regionsRef.current;
    const wavesurfer = wavesurferRef.current;
    if (!plugin || !wavesurfer) return;
    const existing = plugin.getRegions();
    const cursorTime = wavesurfer.getCurrentTime();
    const start = Math.min(Math.max(0, cursorTime), Math.max(0, durationSec - 0.25));
    const end = Math.min(durationSec, start + Math.min(10, Math.max(1, durationSec / 10)));
    const region = plugin.addRegion({
      start,
      end,
      color: COLORS[existing.length % COLORS.length],
      drag: true,
      resize: true,
      minLength: 0.25,
    });
    setActiveRegionId(region.id);
  }, [durationSec]);

  const playRegion = useCallback((region: Region) => {
    setActiveRegionId(region.id);
    region.play(true);
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-background p-3 sm:p-4" dir="rtl" data-testid="visual-audio-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">חיתוך חזותי על צורת הגל</h3>
          <p className="text-xs text-muted-foreground">גרור על הגל כדי לסמן אזור. ניתן להזיז את האזור ולגרור את הקצוות לדיוק.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addRegionAtCursor} disabled={!ready}>
            <Plus className="h-4 w-4" />
            הוסף באזור הסמן
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="נקה את כל הסימונים"
            disabled={ranges.length === 0}
            onClick={() => {
              regionsRef.current?.clearRegions();
              setActiveRegionId(null);
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-muted/20 p-2" dir="ltr">
        <div ref={waveformRef} className="min-h-[132px] w-full" data-testid="waveform-selection-area" />
      </div>

      <div className="flex flex-wrap items-center gap-3" dir="ltr">
        <Button type="button" size="icon" onClick={() => wavesurferRef.current?.playPause()} disabled={!ready} title={playing ? "השהה" : "נגן"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <span className="min-w-28 font-mono text-xs tabular-nums text-muted-foreground">
          {formatPreciseTime(currentTime)} / {formatPreciseTime(durationSec)}
        </span>
        <Volume2 className="h-4 w-4 text-muted-foreground" />
        <Slider
          className="w-24"
          min={0}
          max={1}
          step={0.05}
          defaultValue={[1]}
          onValueChange={([value]) => wavesurferRef.current?.setVolume(value)}
        />
        <ZoomIn className="ml-auto h-4 w-4 text-muted-foreground" />
        <Slider className="w-32" min={0} max={200} step={5} value={[zoom]} onValueChange={([value]) => setZoom(value)} />
      </div>

      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="מה לעשות באזורים המסומנים">
        {(Object.keys(MODE_META) as AudioSelectionMode[]).map((option) => {
          const meta = MODE_META[option];
          const selected = mode === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option)}
              className={cn(
                "min-h-20 rounded-lg border p-3 text-right transition-colors",
                selected ? meta.color : "border-border bg-card hover:border-primary/40",
              )}
            >
              <span className="block text-sm font-semibold">{meta.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{meta.description}</span>
            </button>
          );
        })}
      </div>

      {ranges.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          עדיין אין סימונים. גרור על צורת הגל או הוסף אזור במיקום הסמן.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{ranges.length} אזורים מסומנים</Badge>
            <Badge variant="secondary">{plan.length} קטעים יופקו</Badge>
            <span className="text-muted-foreground">משך פלט כולל: {formatPreciseTime(planDuration(plan))}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {ranges.map((range, index) => {
              const region = regionsRef.current?.getRegions().find((candidate) => candidate.id === range.id);
              return (
                <div
                  key={range.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2 py-2 text-xs",
                    activeRegionId === range.id && "ring-2 ring-primary/40",
                  )}
                  style={{ borderInlineStart: `5px solid ${COLORS[index % COLORS.length].replace("0.28", "0.9").replace("0.30", "0.9")}` }}
                >
                  <Badge variant="outline" className="h-6 w-6 justify-center p-0">{index + 1}</Badge>
                  <button type="button" className="min-w-0 flex-1 text-right font-mono" onClick={() => region && playRegion(region)}>
                    {formatPreciseTime(range.startSec)} ← {formatPreciseTime(range.endSec)}
                  </button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="נגן אזור" onClick={() => region && playRegion(region)}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="מחק סימון" onClick={() => region?.remove()}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
