import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Columns2,
  EyeOff,
  LayoutDashboard,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  patch: (id: string, changes: Partial<WidgetPreference>) => void;
}

const STORAGE_KEY = "chai-transcribe-widget-layout-v1";
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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

function loadPreferences(definitions: WidgetDefinition[]) {
  const defaults = defaultsFor(definitions);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Partial<WidgetPreference>>;
    return Object.fromEntries(
      definitions.map((definition) => [definition.id, { ...defaults[definition.id], ...stored[definition.id] }]),
    );
  } catch {
    return defaults;
  }
}

export function TranscriptionWidgetWorkspace({
  definitions,
  children,
}: {
  definitions: WidgetDefinition[];
  children: ReactNode;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, WidgetPreference>>(() => loadPreferences(definitions));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const patch = (id: string, changes: Partial<WidgetPreference>) => {
    setPreferences((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  };

  const move = (id: string, direction: -1 | 1) => {
    setPreferences((current) => {
      const ordered = definitions
        .filter((definition) => !current[definition.id].hidden)
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

  const hidden = useMemo(
    () => definitions.filter((definition) => preferences[definition.id]?.hidden),
    [definitions, preferences],
  );

  return (
    <WorkspaceContext.Provider value={{ customizing, preferences, move, patch }}>
      <section className="space-y-3" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/60 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          </div>
          {customizing && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="איפוס סידור האזורים"
              onClick={() => setPreferences(defaultsFor(definitions))}
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
