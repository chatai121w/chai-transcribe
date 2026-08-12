import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  getComponentStatuses,
  getBackgroundInstallState,
  getSystemProfile,
  isSetupComplete,
  isTauri,
  onBackgroundInstallState,
  onLocalServerReady,
  onSetupProgress,
  startBackgroundInstall,
  startWhisperServer,
  type BackgroundInstallState,
  type ComponentStatus,
  type SetupProgress,
  type SystemProfile,
} from "@/lib/tauri";
import { setDiscoveredServerPort } from "@/lib/serverConfig";

interface Props {
  children: ReactNode;
}

type Phase = "checking" | "ready" | "installing" | "done" | "error";

const DEFERRED_KEY = "tauri_local_setup_deferred";

function formatSize(megabytes: number): string {
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(megabytes >= 5120 ? 1 : 2)} GB`
    : `${megabytes} MB`;
}

async function connectInstalledServer(): Promise<void> {
  const result = await startWhisperServer();
  setDiscoveredServerPort(result.port);
}

export function TauriSetupGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  const [components, setComponents] = useState<ComponentStatus[]>([]);
  const [selected, setSelected] = useState<Set<ComponentStatus["id"]>>(new Set());
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [backgroundInstall, setBackgroundInstall] = useState<BackgroundInstallState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      onSetupProgress((next) => {
        if (!disposed) setProgress(next);
      }),
      onBackgroundInstallState((next) => {
        if (disposed) return;
        setBackgroundInstall(next);
        if (next.status === "completed") localStorage.removeItem(DEFERRED_KEY);
      }),
      onLocalServerReady((result) => {
        if (!disposed) setDiscoveredServerPort(result.port);
      }),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners.push(...listeners);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setPhase("done");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [done, system, installed, background] = await Promise.all([
          isSetupComplete(),
          getSystemProfile(),
          getComponentStatuses(),
          getBackgroundInstallState(),
        ]);
        if (cancelled) return;
        setProfile(system);
        setComponents(installed);
        setBackgroundInstall(background);
        setSelected(new Set(installed.filter((item) => item.recommended && !item.installed).map((item) => item.id)));
        if (done) {
          try {
            await connectInstalledServer();
          } catch {
            // The app remains usable with online engines; the indicator offers a retry.
          }
          setPhase("done");
        } else if (background.status === "running" || localStorage.getItem(DEFERRED_KEY) === "1") {
          setPhase("done");
        } else {
          setPhase("ready");
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedSize = useMemo(
    () => components.filter((item) => selected.has(item.id) && !item.installed)
      .reduce((total, item) => total + item.estimatedSizeMb, 0),
    [components, selected],
  );

  const toggleComponent = (component: ComponentStatus) => {
    if (component.required || component.installed || phase === "installing") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(component.id)) next.delete(component.id);
      else next.add(component.id);
      if (["cuda-runtime", "hebrew-model", "advanced-speech"].includes(component.id)) {
        next.add("core-runtime");
      }
      return next;
    });
  };

  const startInstallation = async () => {
    setPhase("installing");
    setError("");
    try {
      const order: ComponentStatus["id"][] = [
        "core-runtime",
        "cuda-runtime",
        "hebrew-model",
        "advanced-speech",
      ];
      const requested = order.filter((id) => {
        const component = components.find((item) => item.id === id);
        return Boolean(component && !component.installed && selected.has(id));
      });
      const task = await startBackgroundInstall(requested);
      setBackgroundInstall(task);
      localStorage.setItem(DEFERRED_KEY, "1");
      setPhase("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  };

  const continueOnlineOnly = () => {
    localStorage.setItem(DEFERRED_KEY, "1");
    setPhase("done");
  };

  if (phase === "done") {
    const running = backgroundInstall?.status === "running";
    const failed = backgroundInstall?.status === "failed";
    return (
      <>
        {children}
        {(running || failed) && (
          <aside
            className={`fixed bottom-4 left-4 z-50 w-[min(24rem,calc(100vw-2rem))] border bg-background p-3 shadow-lg ${failed ? "border-destructive" : "border-primary"}`}
            dir="rtl"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 font-medium">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <TriangleAlert className="h-4 w-4 text-destructive" />}
              {running ? "התקנת הרכיבים ממשיכה ברקע" : "התקנת הרקע נעצרה"}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress?.percent || 0}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {failed ? backgroundInstall?.error : progress?.message || "מכין את הרכיב הבא..."}
            </p>
            <a href="/setup" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">פתח ניהול רכיבים</a>
          </aside>
        )}
      </>
    );
  }

  if (phase === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground" dir="rtl">
        <div className="flex items-center gap-3 text-lg">
          <Loader2 className="h-6 w-6 animate-spin" />
          בודק התאמה למחשב...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="border-b pb-4 text-right">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">הכנת תמלול מקומי</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                המערכת זיהתה את המחשב ותתקין רק את הרכיבים המתאימים. אין צורך ב־Node, Python או CUDA ידניים.
              </p>
            </div>
            <ShieldCheck className="h-9 w-9 shrink-0 text-primary" />
          </div>
        </header>

        {profile && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="פרטי המחשב">
            <SystemFact icon={Monitor} label="מצב מומלץ" value={profile.recommendedMode === "cuda" ? "CUDA מהיר" : "CPU תואם"} />
            <SystemFact icon={Gauge} label="כרטיס מסך" value={profile.gpu.name || "לא זוהה"} />
            <SystemFact icon={MemoryStick} label="זיכרון" value={profile.ramGb ? `${profile.ramGb} GB` : "לא ידוע"} />
            <SystemFact icon={HardDrive} label="שטח פנוי" value={profile.diskFreeGb ? `${profile.diskFreeGb} GB` : "לא ידוע"} />
          </section>
        )}

        {profile?.warnings.map((warning) => (
          <div key={warning} className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </div>
        ))}

        <section className="border" aria-labelledby="components-title">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 id="components-title" className="font-semibold">רכיבים להתקנה</h2>
              <p className="text-xs text-muted-foreground">הרכיבים נשמרים בתיקייה פרטית וניתנים לעדכון בנפרד.</p>
            </div>
            <div className="text-left text-sm">
              <div className="font-semibold">{formatSize(selectedSize)}</div>
              <div className="text-xs text-muted-foreground">הורדה משוערת</div>
            </div>
          </div>

          <div className="divide-y">
            {components.map((component) => {
              const checked = component.installed || selected.has(component.id);
              const disabled = component.required || component.installed || phase === "installing"
                || (component.id === "cuda-runtime" && !profile?.gpu.cudaCompatible);
              return (
                <label
                  key={component.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 p-4 ${disabled ? "cursor-default" : "cursor-pointer hover:bg-muted/40"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleComponent(component)}
                    className="h-5 w-5 accent-primary"
                  />
                  <span className="min-w-0 text-right">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {component.label}
                      {component.installed && <span className="text-xs text-emerald-700">מותקן</span>}
                      {component.recommended && !component.installed && <span className="text-xs text-primary">מומלץ</span>}
                    </span>
                    <span className="block text-sm text-muted-foreground">{component.description}</span>
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">{formatSize(component.estimatedSizeMb)}</span>
                </label>
              );
            })}
          </div>
        </section>

        {phase === "installing" && (
          <section className="border p-4" aria-live="polite">
            <div className="mb-3 flex items-center gap-2 font-medium">
              <Loader2 className="h-5 w-5 animate-spin" />
              {components.find((item) => item.id === backgroundInstall?.currentComponent)?.label || "מעביר להתקנה ברקע..."}
            </div>
            <div className="h-2 overflow-hidden bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress?.percent || 0}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{progress?.message || "מכין את ההתקנה..."}</span>
              <span dir="ltr">{progress?.percent || 0}%</span>
            </div>
          </section>
        )}

        {phase === "error" && (
          <section className="border border-destructive bg-destructive/5 p-4 text-sm text-destructive">
            <div className="mb-1 font-semibold">ההתקנה נעצרה</div>
            <div className="break-words">{error}</div>
          </section>
        )}

        <footer className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-between">
          <button type="button" onClick={continueOnlineOnly} disabled={phase === "installing"} className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            המשך כעת עם מנועים מקוונים בלבד
          </button>
          <button
            type="button"
            onClick={startInstallation}
            disabled={phase === "installing" || selectedSize === 0}
            className="inline-flex items-center justify-center gap-2 bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "installing" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            {phase === "error" ? "נסה שוב" : "התקן ברקע והמשך לעבוד"}
          </button>
        </footer>
      </div>
    </main>
  );
}

function SystemFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border p-3">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 text-right">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium" title={value}>{value}</div>
      </div>
    </div>
  );
}
