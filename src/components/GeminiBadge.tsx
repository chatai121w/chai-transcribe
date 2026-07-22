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
  const color = usingPersonal ? "text-yellow-500" : "text-muted-foreground";
  const label = usingPersonal
    ? "Gemini — משתמש במפתח האישי שלך"
    : "Gemini — דרך Lovable AI";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${color} ${className}`} aria-label={label}>
            <Sparkles size={size} className={usingPersonal ? "fill-yellow-500/30" : ""} />
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
