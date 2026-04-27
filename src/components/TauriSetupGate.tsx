/**
 * TauriSetupGate: gates the entire app on first-run setup completion.
 * - Browser mode: passes through immediately (children rendered).
 * - Tauri mode + setup complete: passes through.
 * - Tauri mode + setup needed: shows wizard until done.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  isTauri,
  isSetupComplete,
  runSetup,
  onSetupProgress,
  getAppDataDir,
  type SetupProgress,
} from "@/lib/tauri";

interface Props {
  children: ReactNode;
}

const STAGE_LABELS: Record<string, string> = {
  python: "מוריד Python 3.12",
  pip: "מתקין pip",
  venv: "יוצר סביבה וירטואלית",
  torch: "מתקין PyTorch + CUDA (זה החלק הארוך)",
  deps: "מתקין faster-whisper + Flask",
  server: "מעתיק קבצי שרת",
  done: "הושלם!",
};

export function TauriSetupGate({ children }: Props) {
  const [phase, setPhase] = useState<"checking" | "needs-setup" | "running" | "done" | "error">(
    "checking"
  );
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState<string>("");
  const [dataDir, setDataDir] = useState<string>("");

  useEffect(() => {
    if (!isTauri()) {
      setPhase("done");
      return;
    }
    (async () => {
      try {
        setDataDir(await getAppDataDir());
      } catch {
        /* ignore */
      }
      const done = await isSetupComplete();
      setPhase(done ? "done" : "needs-setup");
    })();
  }, []);

  const startSetup = async () => {
    setPhase("running");
    setError("");
    const unlisten = await onSetupProgress((p) => setProgress(p));
    try {
      await runSetup();
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    } finally {
      unlisten();
    }
  };

  if (phase === "done") return <>{children}</>;

  if (phase === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground" dir="rtl">
        <div className="text-center">
          <div className="mb-4 h-10 w-10 mx-auto animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-lg">בודק התקנה…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground" dir="rtl">
      <div className="w-full max-w-2xl rounded-lg border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-3xl font-bold">Smart Hebrew Transcriber</h1>
        <p className="mb-6 text-muted-foreground">התקנה ראשונה</p>

        {phase === "needs-setup" && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-sm">
              <p className="mb-2 font-semibold">מה יותקן:</p>
              <ul className="list-disc space-y-1 pr-5">
                <li>Python 3.12 (~30 MB)</li>
                <li>PyTorch + CUDA (~2.5 GB)</li>
                <li>faster-whisper + Flask (~500 MB)</li>
                <li>שרת התמלול המקומי</li>
              </ul>
              <p className="mt-3 text-xs">
                יותקן אל: <code className="break-all">{dataDir || "%LOCALAPPDATA%\\SmartHebrewTranscriber"}</code>
              </p>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                זמן משוער: 5–15 דקות (תלוי במהירות אינטרנט). מודל Whisper יוריד אוטומטית בהפעלה הראשונה.
              </p>
            </div>

            <button
              onClick={startSetup}
              className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              התחל התקנה
            </button>
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-lg font-medium">
                {progress ? STAGE_LABELS[progress.stage] || progress.stage : "מאתחל…"}
              </p>
            </div>

            {progress && progress.percent > 0 && (
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            )}

            {progress?.message && (
              <p className="text-xs text-muted-foreground break-words">{progress.message}</p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-semibold mb-1">ההתקנה נכשלה:</p>
              <p className="break-words">{error}</p>
            </div>
            <button
              onClick={startSetup}
              className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              נסה שוב
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
