import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Columns2,
  EyeOff,
  Cloud,
  CloudOff,
  LayoutDashboard,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  patch: (id: string, changes: Partial<WidgetPreference>) => void;
  register: (id: string, mounted: boolean) => void;
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

  const hidden = useMemo(
    () => definitions.filter((definition) => preferences[definition.id]?.hidden),
    [definitions, preferences],
  );

  return (
    <WorkspaceContext.Provider value={{ customizing, preferences, move, patch, register }}>
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
