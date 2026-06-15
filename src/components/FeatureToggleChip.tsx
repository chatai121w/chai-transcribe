/**
 * FeatureToggleChip — small inline icon that opens a popover with a toggle
 * for a single feature flag. Drop it next to a feature's UI for quick
 * enable/disable access without leaving the page.
 *
 * Hidden automatically when the user disables the global
 * "ff_show_quick_toggles" flag.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings2, Sparkles, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { getFlagMeta, useFeatureFlag } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

interface Props {
  flagKey: string;
  /** Optional override of the trigger icon size (defaults to compact). */
  size?: "sm" | "md";
  className?: string;
}

export function FeatureToggleChip({ flagKey, size = "sm", className }: Props) {
  const [showQuick] = useFeatureFlag("ff_show_quick_toggles");
  const [enabled, setEnabled] = useFeatureFlag(flagKey);
  const meta = getFlagMeta(flagKey);

  if (!showQuick || !meta) return null;

  const triggerSize = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const iconSize = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            triggerSize,
            "rounded-full border transition-colors",
            enabled
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
            className,
          )}
          title={`${meta.label} — ${enabled ? "פעיל" : "כבוי"}`}
          aria-label={`טוגל: ${meta.label}`}
        >
          <Settings2 className={iconSize} />
        </Button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="end" className="w-72 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">{meta.label}</span>
            {meta.experimental && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Sparkles className="h-3 w-3" /> ניסיוני
              </Badge>
            )}
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>

        {meta.risk && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{meta.risk}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t">
          <Link
            to="/features"
            className="text-[11px] text-primary hover:underline"
          >
            כל הפיצ'רים →
          </Link>
          <Link
            to="/ab-compare"
            className="text-[11px] text-muted-foreground hover:underline"
          >
            השוואת A/B
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
