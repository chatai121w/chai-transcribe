/**
 * Tauri detection + IPC helpers.
 * Safe to import in browser builds — all functions return falsy/no-op outside Tauri.
 */

export const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T = unknown>(
  event: string,
  handler: (e: { payload: T }) => void
) => Promise<() => void>;

let cachedInvoke: InvokeFn | null = null;
let cachedListen: ListenFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (cachedInvoke) return cachedInvoke;
  const mod = await import("@tauri-apps/api/core");
  cachedInvoke = mod.invoke as InvokeFn;
  return cachedInvoke;
}

async function getListen(): Promise<ListenFn> {
  if (cachedListen) return cachedListen;
  const mod = await import("@tauri-apps/api/event");
  cachedListen = mod.listen as ListenFn;
  return cachedListen;
}

export async function isSetupComplete(): Promise<boolean> {
  if (!isTauri()) return true; // browser mode: assume external server
  try {
    const invoke = await getInvoke();
    return await invoke<boolean>("is_setup_complete");
  } catch {
    return false;
  }
}

export async function runSetup(): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("run_setup");
}

export async function startWhisperServer(): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("start_whisper_server");
}

export async function stopWhisperServer(): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("stop_whisper_server");
}

export async function getAppDataDir(): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("get_app_data_dir");
}

export interface SetupProgress {
  stage: string;
  percent: number;
  message: string;
}

export async function onSetupProgress(
  handler: (p: SetupProgress) => void
): Promise<() => void> {
  const listen = await getListen();
  return listen<SetupProgress>("setup-progress", (e) => handler(e.payload));
}
