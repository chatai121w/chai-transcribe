import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GeminiBadge } from "@/components/GeminiBadge";

/** Canonical Gemini model list used across the app (Lovable AI Gateway format). */
export const GEMINI_MODELS: Array<{ value: string; label: string }> = [
  { value: "google/gemini-2.5-flash",         label: "Gemini 2.5 Flash (מהיר, ברירת מחדל)" },
  { value: "google/gemini-2.5-pro",           label: "Gemini 2.5 Pro (איכות מקסימלית)" },
  { value: "google/gemini-2.5-flash-lite",    label: "Gemini 2.5 Flash Lite (הכי זול)" },
  { value: "google/gemini-3-flash-preview",   label: "Gemini 3 Flash (preview)" },
  { value: "google/gemini-3.1-pro-preview",   label: "Gemini 3.1 Pro (preview)" },
];

interface GeminiModelSelectProps {
  value: string;
  onChange: (v: string) => void;
  /** localStorage key to persist the choice (optional). */
  storageKey?: string;
  className?: string;
  compact?: boolean;
}

export function loadGeminiModel(storageKey: string, fallback = "google/gemini-2.5-flash"): string {
  try { return localStorage.getItem(storageKey) || fallback; } catch { return fallback; }
}

/**
 * Compact Gemini model picker — reusable across screens that let the user
 * pick which Gemini variant to use for the current AI action.
 */
export function GeminiModelSelect({ value, onChange, storageKey, className, compact }: GeminiModelSelectProps) {
  const handle = (v: string) => {
    onChange(v);
    if (storageKey) { try { localStorage.setItem(storageKey, v); } catch { /* noop */ } }
  };
  return (
    <Select value={value} onValueChange={handle}>
      <SelectTrigger className={className || (compact ? "w-[190px] h-8 text-xs" : "w-[220px] text-sm")} dir="rtl">
        <div className="flex items-center gap-1.5 truncate">
          <GeminiBadge size={12} />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent dir="rtl">
        {GEMINI_MODELS.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            <div className="flex items-center gap-2">
              <GeminiBadge size={11} />
              <span>{m.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default GeminiModelSelect;
