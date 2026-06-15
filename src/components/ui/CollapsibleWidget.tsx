import { ReactNode, useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CollapsibleWidgetProps {
  /** Display title (Hebrew/RTL). */
  title: ReactNode;
  /** Optional small icon shown to the right of the title (RTL). */
  icon?: ReactNode;
  /** Optional badge / status next to the title. */
  badge?: ReactNode;
  /** Optional action buttons rendered next to the collapse toggle. */
  actions?: ReactNode;
  /** Children rendered as the body. Hidden when collapsed. */
  children: ReactNode;
  /** localStorage key — when set, collapsed state persists per widget. */
  storageKey?: string;
  /** Initial open state when no localStorage entry exists. */
  defaultOpen?: boolean;
  /** Extra classes for the outer card. */
  className?: string;
  /** Extra classes for the body wrapper. */
  bodyClassName?: string;
  /** When true, hide the toggle (always open). */
  noCollapse?: boolean;
}

/**
 * Unified collapsible widget wrapper.
 * - Header: title on the right (RTL), collapse toggle ALWAYS on the top-left in the same place.
 * - When collapsed, only the header is visible — no leftover margins / spacing gaps.
 * - Uses persistent state via `storageKey` so reload restores the user's choice.
 */
export function CollapsibleWidget({
  title,
  icon,
  badge,
  actions,
  children,
  storageKey,
  defaultOpen = true,
  className = "",
  bodyClassName = "",
  noCollapse = false,
}: CollapsibleWidgetProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = localStorage.getItem(`widget_open__${storageKey}`);
      if (v === null) return defaultOpen;
      return v === "1";
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`widget_open__${storageKey}`, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open, storageKey]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div
      dir="rtl"
      className={`rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
        {/* Right (RTL): icon + title + badge */}
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <span className="text-sm font-semibold truncate">{title}</span>
          {badge}
        </div>
        {/* Left: actions + collapse toggle (ALWAYS in the same place) */}
        <div className="flex items-center gap-1 shrink-0">
          {actions}
          {!noCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-yellow-600 hover:bg-yellow-500/10"
              onClick={toggle}
              title={open ? "מזער" : "הרחב"}
              aria-label={open ? "מזער" : "הרחב"}
              aria-expanded={open}
            >
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>
      {open && <div className={`p-3 ${bodyClassName}`}>{children}</div>}
    </div>
  );
}

export default CollapsibleWidget;
