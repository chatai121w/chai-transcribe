import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Columns2,
  EyeOff,
  Cloud,
  CloudOff,
  GripVertical,
  LayoutDashboard,
  Maximize2,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";

type WidgetSpan = "half" | "full";

export interface WidgetDefinition {
  id: string;
  title: string;
  defaultSpan?: WidgetSpan;
}

interface WidgetPreference {
  order: number;
  collapsed: boolean;
  hidden: boolean;
  span: WidgetSpan;
}

interface WorkspaceContextValue {
  customizing: boolean;
  preferences: Record<string, WidgetPreference>;
  move: (id: string, direction: -1 | 1) => void;
  /** קובע סדר חדש לכל האזורים בבת אחת — מה שגרירה מייצרת. */
  reorder: (ids: string[]) => void;
  patch: (id: string, changes: Partial<WidgetPreference>) => void;
  register: (id: string, mounted: boolean) => void;
  reset: () => void;
  definitions: WidgetDefinition[];
}

const STORAGE_KEY = "chai-transcribe-widget-layout-v1";
const CLOUD_KEY = "transcription_widget_layout_v2";
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface LayoutEnvelope {
  updatedAt: number;
  preferences: Record<string, WidgetPreference>;
}

function defaultsFor(definitions: WidgetDefinition[]) {
  return Object.fromEntries(
    definitions.map((definition, index) => [
      definition.id,
      {
        order: index,
        collapsed: false,
        hidden: false,
        span: definition.defaultSpan ?? "full",
      } satisfies WidgetPreference,
    ]),
  );
}

function sanitizePreferences(
  definitions: WidgetDefinition[],
  stored: Record<string, Partial<WidgetPreference>>,
) {
  const defaults = defaultsFor(definitions);
  return Object.fromEntries(
    definitions.map((definition) => [definition.id, { ...defaults[definition.id], ...stored[definition.id] }]),
  );
}

function loadLocalLayout(definitions: WidgetDefinition[]): LayoutEnvelope {
  const defaults = defaultsFor(definitions);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<LayoutEnvelope> & Record<string, unknown>;
    if (stored.preferences && typeof stored.preferences === 'object') {
      return {
        updatedAt: Number(stored.updatedAt) || 0,
        preferences: sanitizePreferences(definitions, stored.preferences),
      };
    }
    // Migrate the original local-only layout and prefer it on the first cloud sync.
    return {
      updatedAt: Object.keys(stored).length ? Date.now() : 0,
      preferences: sanitizePreferences(definitions, stored as Record<string, Partial<WidgetPreference>>),
    };
  } catch {
    return { updatedAt: 0, preferences: defaults };
  }
}

function parseCloudLayout(value: string, definitions: WidgetDefinition[]): LayoutEnvelope | null {
  try {
    const settings = JSON.parse(value || '{}') as Record<string, unknown>;
    const envelope = settings[CLOUD_KEY] as Partial<LayoutEnvelope> | undefined;
    if (!envelope?.preferences || typeof envelope.preferences !== 'object') return null;
    return {
      updatedAt: Number(envelope.updatedAt) || 0,
      preferences: sanitizePreferences(definitions, envelope.preferences),
    };
  } catch {
    return null;
  }
}

export function TranscriptionWidgetWorkspace({
  definitions,
  children,
}: {
  definitions: WidgetDefinition[];
  children: ReactNode;
}) {
  const { preferences: cloudPreferences, patchTabSettings, isLoaded: cloudLoaded } = useCloudPreferences();
  const initialLayout = useMemo(() => loadLocalLayout(definitions), []);
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, WidgetPreference>>(initialLayout.preferences);
  const [layoutUpdatedAt, setLayoutUpdatedAt] = useState(initialLayout.updatedAt);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set());
  const cloudHydratedRef = useRef(false);
  const localDirtyRef = useRef(false);

  const register = useCallback((id: string, mounted: boolean) => {
    setMountedIds((current) => {
      const next = new Set(current);
      if (mounted) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const envelope: LayoutEnvelope = { updatedAt: layoutUpdatedAt, preferences };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  }, [layoutUpdatedAt, preferences]);

  useEffect(() => {
    if (!cloudLoaded) return;
    const remote = parseCloudLayout(cloudPreferences.tab_settings_json, definitions);

    if (!cloudHydratedRef.current) {
      cloudHydratedRef.current = true;
      if (remote && remote.updatedAt > layoutUpdatedAt && !localDirtyRef.current) {
        setPreferences(remote.preferences);
        setLayoutUpdatedAt(remote.updatedAt);
        return;
      }
      const updatedAt = layoutUpdatedAt || Date.now();
      if (!layoutUpdatedAt) setLayoutUpdatedAt(updatedAt);
      patchTabSettings({ [CLOUD_KEY]: { updatedAt, preferences } satisfies LayoutEnvelope });
      localDirtyRef.current = false;
      return;
    }

    if (remote && remote.updatedAt > layoutUpdatedAt && !localDirtyRef.current) {
      setPreferences(remote.preferences);
      setLayoutUpdatedAt(remote.updatedAt);
    }
  }, [cloudLoaded, cloudPreferences.tab_settings_json, definitions, layoutUpdatedAt, patchTabSettings, preferences]);

  const commitPreferences = useCallback((updater: (current: Record<string, WidgetPreference>) => Record<string, WidgetPreference>) => {
    setPreferences((current) => {
      const next = updater(current);
      if (next === current) return current;
      const updatedAt = Date.now();
      localDirtyRef.current = true;
      setLayoutUpdatedAt(updatedAt);
      if (cloudHydratedRef.current) {
        patchTabSettings({ [CLOUD_KEY]: { updatedAt, preferences: next } satisfies LayoutEnvelope });
        localDirtyRef.current = false;
      }
      return next;
    });
  }, [patchTabSettings]);

  const patch = (id: string, changes: Partial<WidgetPreference>) => {
    commitPreferences((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  };

  const move = (id: string, direction: -1 | 1) => {
    commitPreferences((current) => {
      const ordered = definitions
        .filter((definition) => mountedIds.has(definition.id) && !current[definition.id].hidden)
        .sort((a, b) => current[a.id].order - current[b.id].order);
      const index = ordered.findIndex((definition) => definition.id === id);
      const target = ordered[index + direction];
      if (!target) return current;
      return {
        ...current,
        [id]: { ...current[id], order: current[target.id].order },
        [target.id]: { ...current[target.id], order: current[id].order },
      };
    });
  };

  /**
   * קובע סדר חדש לכל האזורים.
   *
   * בניגוד להעברה בצעד אחד, גרירה יכולה להזיז אזור לכל מקום — ולכן
   * הסדר נכתב מחדש כרצף שלם. כך גם אין מקום לשני אזורים עם אותו
   * מספר, מצב שבו סדר התצוגה נקבע באקראי.
   */
  const reorder = useCallback((ids: string[]) => {
    commitPreferences((current) => {
      const next = { ...current };
      ids.forEach((id, index) => {
        if (next[id]) next[id] = { ...next[id], order: index };
      });
      return next;
    });
  }, [commitPreferences]);

  const reset = useCallback(
    () => commitPreferences(() => defaultsFor(definitions)),
    [commitPreferences, definitions],
  );

  const hidden = useMemo(
    () => definitions.filter((definition) => preferences[definition.id]?.hidden),
    [definitions, preferences],
  );

  return (
    <WorkspaceContext.Provider value={{ customizing, preferences, move, reorder, patch, register, reset, definitions }}>
      <section className="space-y-3" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/60 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <WidgetSettingsMenu />
            <Button
              type="button"
              size="sm"
              variant={customizing ? "default" : "outline"}
              className="gap-2"
              onClick={() => setCustomizing((value) => !value)}
            >
              <LayoutDashboard className="h-4 w-4" />
              סידור אזורים
            </Button>
            {customizing && hidden.map((definition) => (
              <Button
                key={definition.id}
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5"
                onClick={() => patch(definition.id, { hidden: false })}
              >
                <EyeOff className="h-3.5 w-3.5" />
                הצג {definition.title}
              </Button>
            ))}
            <span
              className={cn(
                "inline-flex h-8 items-center gap-1.5 px-2 text-xs",
                cloudLoaded ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
              )}
              title={cloudLoaded ? "הפריסה נשמרת בחשבון ומסתנכרנת בין מכשירים" : "ממתין לחיבור לענן"}
            >
              {cloudLoaded ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
              {cloudLoaded ? 'פריסה בענן' : 'ממתין לענן'}
            </span>
          </div>
          {customizing && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="איפוס סידור האזורים"
              onClick={() => commitPreferences(() => defaultsFor(definitions))}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
      </section>
    </WorkspaceContext.Provider>
  );
}

/**
 * שורה אחת ברשימת האזורים: ידית גרירה, שם, ומתג הצגה.
 *
 * הידית היא מה שגורר, ולא כל השורה. בלי זה, לחיצה על המתג הייתה
 * מתחילה גרירה והמתג היה מרגיש תקוע.
 */
function WidgetRow({ definition, visible }: { definition: WidgetDefinition; visible: boolean }) {
  const workspace = useContext(WorkspaceContext)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: definition.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-transparent bg-background px-2 py-1.5",
        // השורה הנגררת נשארת במקומה כצל, והעותק הצף הוא מה שרואים.
        isDragging && "opacity-30",
        !visible && "opacity-60",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label={`גרור כדי להזיז את ${definition.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className={cn("min-w-0 flex-1 truncate text-sm", !visible && "line-through")}>
        {definition.title}
      </span>
      <Switch
        checked={visible}
        onCheckedChange={(on) => workspace.patch(definition.id, { hidden: !on })}
        aria-label={`הצגת ${definition.title}`}
      />
    </div>
  );
}

/**
 * תפריט הגלגל: מה מוצג, ובאיזה סדר.
 *
 * מה שהיה חסר: "סידור אזורים" פותח כפתורים **בתוך** כל אזור, ולכן
 * כדי להזיז אזור צריך קודם למצוא אותו על המסך — ואזור מוסתר אי אפשר
 * למצוא בכלל. כאן כל האזורים יושבים ברשימה אחת קצרה, מוצגים
 * ומוסתרים כאחד.
 */
function WidgetSettingsMenu() {
  const workspace = useContext(WorkspaceContext)!;
  const { definitions, preferences, reorder, reset } = workspace;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  // מרחק ההפעלה מונע גרירה בטעות בלחיצה רגילה על המתג.
  //
  // גרירה במקלדת אינה כאן בכוונה: נבדק, והיא נתקעה באמצע — הפריט
  // נשאר מוזז ושקוף עם השחרור, ומקשי החצים הזיזו אותו לכיוון ההפוך.
  // מסלול נגישות שבור גרוע ממסלול שלא קיים, ולכן ההזזה במקלדת נשארת
  // בכפתורי החץ שבכותרת כל אזור, שעובדים.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ordered = useMemo(
    () => [...definitions].sort((a, b) => (preferences[a.id]?.order ?? 0) - (preferences[b.id]?.order ?? 0)),
    [definitions, preferences],
  );
  const ids = ordered.map((d) => d.id);
  const shown = ordered.filter((d) => !preferences[d.id]?.hidden).length;
  const draggedTitle = definitions.find((d) => d.id === dragging)?.title ?? "";

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorder(arrayMove(ids, from, to));
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant={open ? "secondary" : "ghost"}
        className="h-8 w-8 shrink-0"
        title="בחירת אזורים וסדרם"
        aria-label="בחירת אזורים וסדרם"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 className="h-4 w-4" />
      </Button>

      {open && (
        // הפאנל יושב בתוך הדף ולא בחלונית צפה, וזאת החלטה ולא נוחות.
        //
        // נבדק: בחלונית הצפה של התפריט הגרירה יצאה הפוכה ומוכפלת —
        // גרירה של 76 פיקסלים כלפי מעלה הזיזה אזור ארבעה מקומות למטה.
        // העטיפה הצפה מקובעת ומוזזת בעצמה, והספרייה חישבה את התזוזה
        // בתוכה פי מינוס שתיים. כאן אין עטיפה כזאת, והמידות נכונות.
        <div className="order-last w-full rounded-md border border-border/70 bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">אזורים בעמוד</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                גרור בידית כדי לשנות סדר, וכבה כדי להסתיר. {shown} מתוך {definitions.length} מוצגים.
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />
              איפוס
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setDragging(String(e.active.id))}
            onDragCancel={() => setDragging(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-0.5 p-2 sm:grid-cols-2">
                {ordered.map((definition) => (
                  <WidgetRow
                    key={definition.id}
                    definition={definition}
                    visible={!preferences[definition.id]?.hidden}
                  />
                ))}
              </div>
            </SortableContext>

            {/* העותק הצף שנגרר עם העכבר: מרים את השורה מהדף כדי
                שיהיה ברור מה זז, ונושא את השם כדי שלא יגררו ריבוע אלמוני. */}
            <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
              {dragging ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-background px-2 py-1.5 shadow-lg ring-1 ring-primary/20">
                  <GripVertical className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{draggedTitle}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </>
  );
}

export function TranscriptionWidget({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("TranscriptionWidget must be rendered inside TranscriptionWidgetWorkspace");
  const preference = workspace.preferences[id];

  useEffect(() => {
    workspace.register(id, true);
    return () => workspace.register(id, false);
  }, [id, workspace.register]);

  if (!preference || preference.hidden) return null;

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border/70 bg-background",
        preference.span === "full" ? "md:col-span-2" : "md:col-span-1",
        workspace.customizing && "ring-1 ring-primary/25",
      )}
      style={{ order: preference.order }}
    >
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {workspace.customizing && (
            <>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="העבר למעלה" onClick={() => workspace.move(id, -1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="העבר למטה" onClick={() => workspace.move(id, 1)}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title={preference.span === "full" ? "הצג בחצי רוחב" : "הצג ברוחב מלא"}
                onClick={() => workspace.patch(id, { span: preference.span === "full" ? "half" : "full" })}
              >
                {preference.span === "full" ? <Columns2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="הסתר אזור" onClick={() => workspace.patch(id, { hidden: true })}>
                <EyeOff className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title={preference.collapsed ? "הרחב אזור" : "מזער אזור"}
            onClick={() => workspace.patch(id, { collapsed: !preference.collapsed })}
          >
            {preference.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      {!preference.collapsed && <div className="p-3 md:p-4">{children}</div>}
    </section>
  );
}
