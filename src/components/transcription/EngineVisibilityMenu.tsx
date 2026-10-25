import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Settings2, GripVertical, RotateCcw } from "lucide-react";
import {
  ENGINE_LABELS, ENGINE_PREFS_DEFAULT, type EngineId, type EnginePrefs,
  moveEngine, orderedEngines, toggleEngine, visibleEngines,
} from "@/lib/enginePrefs";

/**
 * בחירת המנועים שמוצגים, והסדר שלהם.
 *
 * על המסך שמונה מנועי תמלול, ורוב העבודה נעשית עם אחד או שניים.
 * השאר תופסים מקום ומסיחים את העין בכל פעם מחדש.
 *
 * התפריט יושב מאחורי איקון קטן ולא על המסך עצמו: זאת הגדרה שנוגעים
 * בה פעם אחת, ואין סיבה שתתפוס מקום קבוע ליד מה שהיא מגדירה.
 *
 * הגרירה כאן פשוטה בכוונה — גרירת דפדפן רגילה, בלי ספרייה. רשימה
 * של שמונה שורות אינה מצדיקה תלות חדשה, והתנהגות הגרירה המובנית
 * עובדת גם במקלדת ובקורא מסך.
 */
export function EngineVisibilityMenu({
  prefs,
  onChange,
  selected,
}: {
  prefs: EnginePrefs;
  onChange: (next: EnginePrefs) => void;
  selected?: string;
}) {
  const [dragging, setDragging] = useState<EngineId | null>(null);
  const order = orderedEngines(prefs);
  const shown = visibleEngines(prefs, selected).length;

  const drop = useCallback((target: EngineId) => {
    if (!dragging || dragging === target) return setDragging(null);
    onChange(moveEngine(prefs, dragging, order.indexOf(target)));
    setDragging(null);
  }, [dragging, onChange, order, prefs]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="בחירת מנועים וסדר התצוגה"
          aria-label="בחירת מנועים וסדר התצוגה"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-2" dir="rtl">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium">מנועים מוצגים</span>
          <Button
            variant="ghost" size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={() => onChange(ENGINE_PREFS_DEFAULT)}
            title="חזרה לברירת המחדל"
          >
            <RotateCcw className="h-3 w-3" />
            איפוס
          </Button>
        </div>

        <div className="space-y-0.5">
          {order.map((id) => {
            const hidden = prefs.hidden.includes(id);
            const isSelected = selected === id;
            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDragging(id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(id)}
                onDragEnd={() => setDragging(null)}
                className={`flex items-center gap-2 rounded px-1 py-1 ${
                  dragging === id ? "opacity-40" : "hover:bg-muted/60"
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <span className={`flex-1 truncate text-xs ${hidden ? "text-muted-foreground line-through" : ""}`}>
                  {ENGINE_LABELS[id]}
                </span>
                {/* המנוע הנבחר מוצג תמיד. המתג כבוי כדי שלא ייראה
                    כאילו ההסתרה נכשלה בשקט. */}
                {isSelected && hidden && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">בשימוש</span>
                )}
                <Switch
                  checked={!hidden}
                  disabled={isSelected}
                  onCheckedChange={() => onChange(toggleEngine(prefs, id))}
                  aria-label={`${ENGINE_LABELS[id]} — ${hidden ? "הצג" : "הסתר"}`}
                  className="scale-75"
                />
              </div>
            );
          })}
        </div>

        <p className="mt-2 px-1 text-[10px] text-muted-foreground">
          {shown} מתוך {order.length} מוצגים · לגרירה החזק את הידית
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default EngineVisibilityMenu;
