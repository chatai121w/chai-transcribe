import { Plus, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import type { Voice } from "@/lib/harmony-engine";

interface Props {
  voices: Voice[];
  onChange: (voices: Voice[]) => void;
}

const intervalLabel = (s: number): string => {
  if (s === 0) return "יוניסון";
  const sign = s > 0 ? "+" : "−";
  const abs = Math.abs(s);
  const map: Record<number, string> = {
    1: "סקונדה קטנה",
    2: "סקונדה גדולה",
    3: "טרצה קטנה",
    4: "טרצה גדולה",
    5: "קווארטה",
    6: "טריטון",
    7: "קווינטה",
    8: "סקסטה קטנה",
    9: "סקסטה גדולה",
    10: "ספטימה קטנה",
    11: "ספטימה גדולה",
    12: "אוקטבה",
  };
  return `${sign}${abs} · ${map[abs] ?? `${abs} חצאי טון`}`;
};

export function HarmonyVoiceControls({ voices, onChange }: Props) {
  const update = (i: number, patch: Partial<Voice>) => {
    onChange(voices.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const remove = (i: number) => onChange(voices.filter((_, idx) => idx !== i));
  const add = () => onChange([...voices, { semitones: 4, gain: 0.6 }]);

  return (
    <div className="space-y-3">
      {voices.map((voice, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider text-muted-foreground">
              קול {i + 1}
            </span>
            {voices.length > 1 && (
              <button
                onClick={() => remove(i)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                aria-label="הסר קול"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-muted-foreground">גובה צליל</span>
                <span className="font-medium text-foreground">{intervalLabel(voice.semitones)}</span>
              </div>
              <Slider
                min={-12}
                max={12}
                step={1}
                value={[voice.semitones]}
                onValueChange={([val]) => update(i, { semitones: val })}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-muted-foreground">עוצמה</span>
                <span className="font-medium text-foreground">{Math.round(voice.gain * 100)}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[Math.round(voice.gain * 100)]}
                onValueChange={([val]) => update(i, { gain: val / 100 })}
              />
            </div>
          </div>
        </div>
      ))}

      {voices.length < 6 && (
        <button
          onClick={add}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/30 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          הוסף קול
        </button>
      )}
    </div>
  );
}
