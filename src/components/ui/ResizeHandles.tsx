import type { ResizeDir } from "@/hooks/useFloatingPanel";

/**
 * ידיות לשינוי גודל — ארבעה צדדים וארבע פינות.
 *
 * הידיות שקופות בכוונה. ידית נראית בכל צד הופכת את החלונית
 * לעמוסה, ואילו סמן העכבר שמשתנה בריחוף מספיק כדי למצוא אותן.
 * הפינות מקבלות שטח גדול יותר, כי פינה קשה יותר לפגוע בה מצד.
 *
 * שתי נקודות:
 *
 *  1. **הידיות בולטות מעט החוצה.** ידית שמסתיימת בדיוק בגבול
 *     החלונית קשה לתפיסה — צריך לפגוע בדיוק בפיקסל האחרון.
 *
 *  2. **הפינות מעל הצדדים.** בלי זה הצד תופס את הפינה, ואי אפשר
 *     לשנות את שני הממדים יחד.
 */

interface Props {
  onStart: (dir: ResizeDir, cursor: string) => (e: React.PointerEvent) => void;
  /** כבוי פירושו שהידיות אינן מוצגות כלל. */
  enabled?: boolean;
}

const SIDES: Array<{ dir: ResizeDir; cursor: string; className: string }> = [
  { dir: "n", cursor: "ns-resize", className: "-top-1 right-3 left-3 h-2 cursor-ns-resize" },
  { dir: "s", cursor: "ns-resize", className: "-bottom-1 right-3 left-3 h-2 cursor-ns-resize" },
  { dir: "w", cursor: "ew-resize", className: "-left-1 top-3 bottom-3 w-2 cursor-ew-resize" },
  { dir: "e", cursor: "ew-resize", className: "-right-1 top-3 bottom-3 w-2 cursor-ew-resize" },
];

const CORNERS: Array<{ dir: ResizeDir; cursor: string; className: string }> = [
  { dir: "nw", cursor: "nwse-resize", className: "-top-1 -left-1 h-4 w-4 cursor-nwse-resize" },
  { dir: "ne", cursor: "nesw-resize", className: "-top-1 -right-1 h-4 w-4 cursor-nesw-resize" },
  { dir: "sw", cursor: "nesw-resize", className: "-bottom-1 -left-1 h-4 w-4 cursor-nesw-resize" },
  { dir: "se", cursor: "nwse-resize", className: "-bottom-1 -right-1 h-4 w-4 cursor-nwse-resize" },
];

export function ResizeHandles({ onStart, enabled = true }: Props) {
  if (!enabled) return null;

  return (
    <>
      {SIDES.map(({ dir, cursor, className }) => (
        <div
          key={dir}
          onPointerDown={onStart(dir, cursor)}
          className={`absolute z-10 ${className}`}
          aria-hidden
        />
      ))}
      {CORNERS.map(({ dir, cursor, className }) => (
        <div
          key={dir}
          onPointerDown={onStart(dir, cursor)}
          className={`absolute z-20 ${className}`}
          aria-hidden
        />
      ))}

      {/* סימון דק בפינה התחתונה, כדי שיהיה רמז שאפשר למשוך. */}
      <div
        className="pointer-events-none absolute bottom-0.5 left-0.5 z-10 h-2.5 w-2.5 opacity-30"
        aria-hidden
      >
        <svg viewBox="0 0 10 10" className="h-full w-full">
          <path d="M0 10 L10 0 M4 10 L10 4 M8 10 L10 8"
                stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>
    </>
  );
}
