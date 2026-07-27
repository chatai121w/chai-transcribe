import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { isPersonalGeminiEnabled } from "@/lib/personalGemini";

interface GeminiBadgeProps {
  /** When true, always show as "personal Gemini active" style regardless of global toggle. */
  personal?: boolean;
  size?: number;
  className?: string;
  /** Extra tooltip text appended after the default. */
  hint?: string;
}

/**
 * Small ✨ icon rendered next to any Gemini-powered control.
 * - Gold/filled when personal Gemini key is active.
 * - Muted when using Lovable-hosted Gemini.
 */
export function GeminiBadge({ personal, size = 12, className = "", hint }: GeminiBadgeProps) {
  const usingPersonal = personal ?? isPersonalGeminiEnabled();
  const color = usingPersonal
    ? "text-green-500 drop-shadow-[0_0_6px_rgba(34,197,94,0.9)]"
    : "text-blue-600 font-bold drop-shadow-[0_0_4px_rgba(37,99,235,0.6)]";
  const label = usingPersonal
    ? "Gemini — משתמש במפתח האישי שלך (ירוק זוהר)"
    : "Gemini — דרך Lovable AI (כחול בולט)";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${color} ${className}`} aria-label={label}>
            <Sparkles
              size={size}
              className={usingPersonal ? "fill-green-500/40" : "fill-blue-500/20"}
              strokeWidth={usingPersonal ? 2 : 2.5}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}{hint ? ` · ${hint}` : ""}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default GeminiBadge;
