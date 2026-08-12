import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  getComponentStatuses,
  getBackgroundInstallState,
  getSystemProfile,
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
import { toast } from "sonner";

function formatSize(megabytes: number): string {
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes} MB`;
}

export function DesktopComponentManager() {
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  const [components, setComponents] = useState<ComponentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<ComponentStatus["id"] | null>(null);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [background, setBackground] = useState<BackgroundInstallState | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [system, statuses] = await Promise.all([getSystemProfile(), getComponentStatuses()]);
      setProfile(system);
      setComponents(statuses);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void getBackgroundInstallState().then((state) => {
      if (!disposed) {
        setBackground(state);
        setInstalling(state.status === "running" ? state.currentComponent : null);
      }
    });
    void Promise.all([
      onSetupProgress((next) => {
        if (!disposed) setProgress(next);
      }),
      onBackgroundInstallState((next) => {
        if (disposed) return;
        setBackground(next);
        setInstalling(next.status === "running" ? next.currentComponent : null);
        if (next.status === "completed") {
          toast.success("התקנת הרקע הסתיימה בהצלחה");
          void refresh();
        } else if (next.status === "failed") {
          toast.error(next.error || "התקנת הרקע נעצרה");
          void refresh();
        }
      }),
      onLocalServerReady((result) => {
        if (disposed) return;
        setDiscoveredServerPort(result.port);
        toast.success(`שרת התמלול פעיל בפורט ${result.port}`);
      }),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners.push(...listeners);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refresh]);

  const install = async (component: ComponentStatus) => {
    setProgress(null);
    try {
      const task = await startBackgroundInstall([component.id]);
      setBackground(task);
      setInstalling(component.id);
      toast.success(`${component.label} עובר להתקנה ברקע; אפשר להמשיך לעבוד`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setInstalling(null);
    }
  };

  const startServer = async () => {
    try {
      const result = await startWhisperServer();
      setDiscoveredServerPort(result.port);
      toast.success(`שרת התמלול פעיל בפורט ${result.port}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (loading && !profile) {
    return <div className="flex min-h-[45vh] items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> בודק את המחשב...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 py-6" dir="rtl">
      <header className="flex items-center justify-between gap-4 border-b pb-4 text-right">
        <div>
          <h1 className="text-2xl font-bold">רכיבי תמלול מקומיים</h1>
          <p className="text-sm text-muted-foreground">ניהול מנוע, מודלים והאצת GPU בלי התקנות ידניות במחשב.</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void refresh()} aria-label="רענן אבחון">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>

      {profile && (
        <section className="grid gap-3 sm:grid-cols-3">
          <Fact icon={Monitor} label="כרטיס מסך" value={profile.gpu.name || "לא זוהה"} />
          <Fact icon={Cpu} label="מצב מומלץ" value={profile.recommendedMode === "cuda" ? "CUDA" : "CPU"} />
          <Fact icon={HardDrive} label="שטח פנוי" value={profile.diskFreeGb ? `${profile.diskFreeGb} GB` : "לא ידוע"} />
        </section>
      )}

      {profile?.warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {warning}
        </div>
      ))}

      <section className="divide-y border">
        {components.map((component) => {
          const active = installing === component.id;
          const cudaBlocked = component.id === "cuda-runtime" && !profile?.gpu.cudaCompatible;
          const coreMissing = component.id !== "core-runtime"
            && !components.find((item) => item.id === "core-runtime")?.installed;
          return (
            <article key={component.id} className="p-4 text-right">
              <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {component.label}
                    {component.installed && <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> מותקן</span>}
                    {component.recommended && !component.installed && <span className="text-xs text-primary">מומלץ</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{component.description}</p>
                  {cudaBlocked && <p className="mt-1 text-xs text-amber-700">חבילת CUDA אינה תואמת לאבחון הנוכחי; מצב CPU זמין.</p>}
                  {coreMissing && <p className="mt-1 text-xs text-amber-700">יש להתקין תחילה את מנוע התמלול המקומי.</p>}
                </div>
                <span className="whitespace-nowrap text-sm text-muted-foreground">{formatSize(component.estimatedSizeMb)}</span>
                <Button
                  onClick={() => void install(component)}
                  disabled={component.installed || background?.status === "running" || Boolean(installing) || cudaBlocked || coreMissing}
                  variant={component.recommended ? "default" : "outline"}
                  className="gap-2"
                >
                  {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {component.installed ? "מותקן" : "התקן"}
                </Button>
              </div>
              {active && (
                <div className="mt-4 space-y-2" aria-live="polite">
                  <Progress value={progress?.percent || 0} className="h-2" />
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span>{progress?.message || "מתחיל הורדה..."}</span>
                    <span dir="ltr">{progress?.percent || 0}%</span>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {background?.status === "running" && !installing && (
        <div className="border border-primary/40 bg-primary/5 p-3 text-sm text-primary">
          ההתקנה פועלת ברקע ומכינה את הרכיב הבא. אפשר לצאת מהעמוד ולהמשיך לעבוד.
        </div>
      )}

      <div className="flex justify-end border-t pt-4">
        <Button onClick={() => void startServer()} className="gap-2" disabled={!components.find((item) => item.id === "core-runtime")?.installed}>
          <Play className="h-4 w-4" /> הפעל ובדוק שרת
        </Button>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border p-3 text-right">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium" title={value}>{value}</div>
      </div>
    </div>
  );
}
