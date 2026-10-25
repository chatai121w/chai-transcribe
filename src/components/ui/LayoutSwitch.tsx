import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * בורר פריסה — רכיב אחד לכל בוררי הפריסה בעמוד.
 *
 * למה רכיב משותף ולא שני עותקים: היו בעמוד שני בוררים שעושים את
 * אותו דבר ונראים שונה לגמרי — אחד כהה בלי סמלים, השני צהוב עם
 * סמלים. הם נבנו בזמנים שונים, וכל אחד היה סביר בפני עצמו.
 *
 * שני עותקים נפרדים לא נשארים זהים לאורך זמן: מי שמשנה את אחד
 * מהם שוכח את השני, וההבדל חוזר. רכיב אחד הופך את האחידות לדבר
 * שקורה מעצמו ולא לדבר שצריך לזכור.
 */

export interface LayoutOption<T extends string> {
  id: T;
  label: string;
  /** מה משתנה בפועל. מוצג כרמז בריחוף ובשורה שליד. */
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}

interface Props<T extends string> {
  options: LayoutOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** שם לקוראי מסך — חייב להיות ייחודי בעמוד. */
  label: string;
  /** מציג את ההסבר של הפריסה הנבחרת משמאל לבורר. */
  showHint?: boolean;
  disabled?: boolean;
  className?: string;
}

export function LayoutSwitch<T extends string>({
  options, value, onChange, label, showHint = true, disabled, className,
}: Props<T>) {
  const active = options.find((o) => o.id === value);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      {showHint && active?.hint && (
        <span className="min-w-0 text-[11px] text-muted-foreground">{active.hint}</span>
      )}

      <div
        role="tablist"
        aria-label={label}
        className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
      >
        {options.map(({ id, label: text, hint, icon: Icon }) => {
          const on = id === value;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              title={hint || text}
              disabled={disabled}
              onClick={(e) => { e.preventDefault(); onChange(id); }}
              className={cn(
                "flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium",
                "transition-colors duration-[83ms] disabled:opacity-50",
                on
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              {Icon && <Icon className="h-3 w-3" />}
              {/* במסך צר נשאר רק הסמל — ארבע או חמש מילים לא נכנסות. */}
              <span className={Icon ? "hidden sm:inline" : undefined}>{text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
