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

export interface ServerLaunchResult {
  status: "started" | "already-running";
  port: number;
  serverUrl: string;
}

export async function startWhisperServer(): Promise<ServerLaunchResult> {
  const invoke = await getInvoke();
  return invoke<ServerLaunchResult>("start_whisper_server");
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
  component?: string;
  stage: string;
  percent: number;
  message: string;
}

export interface GpuProfile {
  vendor: string;
  name: string | null;
  vramMb: number | null;
  driverVersion: string | null;
  cudaReported: string | null;
  cudaCompatible: boolean;
}

export interface SystemProfile {
  os: string;
  architecture: string;
  cpu: string;
  ramGb: number | null;
  diskFreeGb: number | null;
  gpu: GpuProfile;
  recommendedMode: "cuda" | "cpu";
  warnings: string[];
}

export interface ComponentStatus {
  id: "core-runtime" | "cuda-runtime" | "hebrew-model" | "advanced-speech";
  label: string;
  description: string;
  estimatedSizeMb: number;
  required: boolean;
  recommended: boolean;
  installed: boolean;
  version: string | null;
}

export interface BackgroundInstallState {
  status: "idle" | "running" | "completed" | "failed";
  components: ComponentStatus["id"][];
  currentComponent: ComponentStatus["id"] | null;
  completedComponents: ComponentStatus["id"][];
  error: string | null;
}

export async function getSystemProfile(): Promise<SystemProfile> {
  const invoke = await getInvoke();
  return invoke<SystemProfile>("get_system_profile");
}

export async function getComponentStatuses(): Promise<ComponentStatus[]> {
  const invoke = await getInvoke();
  return invoke<ComponentStatus[]>("get_component_statuses");
}

export async function installComponent(componentId: ComponentStatus["id"]): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("install_component", { componentId });
}

export async function startBackgroundInstall(
  componentIds: ComponentStatus["id"][],
): Promise<BackgroundInstallState> {
  const invoke = await getInvoke();
  return invoke<BackgroundInstallState>("start_background_install", { componentIds });
}

export async function getBackgroundInstallState(): Promise<BackgroundInstallState> {
  const invoke = await getInvoke();
  return invoke<BackgroundInstallState>("get_background_install_state");
}

export async function getRuntimeInfo(): Promise<{
  pythonVersion: string;
  appDataDir: string;
  serverPort: number | null;
}> {
  const invoke = await getInvoke();
  return invoke("get_runtime_info");
}

export async function onSetupProgress(
  handler: (p: SetupProgress) => void
): Promise<() => void> {
  const listen = await getListen();
  return listen<SetupProgress>("setup-progress", (e) => handler(e.payload));
}

export async function onBackgroundInstallState(
  handler: (state: BackgroundInstallState) => void,
): Promise<() => void> {
  const listen = await getListen();
  return listen<BackgroundInstallState>("background-install-state", (event) => handler(event.payload));
}

export async function onLocalServerReady(
  handler: (result: ServerLaunchResult) => void,
): Promise<() => void> {
  const listen = await getListen();
  return listen<ServerLaunchResult>("local-server-ready", (event) => handler(event.payload));
}
