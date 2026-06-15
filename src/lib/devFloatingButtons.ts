export type DevFloatingButtonId =
  | "smartConsole"
  | "transcriptionAnalytics"
  | "pwaInstall"
  | "diarizationStatus";

export interface DevFloatingButtonsVisibility {
  smartConsole: boolean;
  transcriptionAnalytics: boolean;
  pwaInstall: boolean;
  diarizationStatus: boolean;
}

export const DEV_FLOATING_BUTTONS_STORAGE_KEY = "dev_floating_buttons_visibility_v1";
export const DEV_FLOATING_BUTTONS_EVENT = "dev-floating-buttons-visibility-change";

const DEFAULT_VISIBILITY: DevFloatingButtonsVisibility = {
  smartConsole: true,
  transcriptionAnalytics: true,
  pwaInstall: true,
  diarizationStatus: true,
};

export function getDefaultDevFloatingButtonsVisibility(): DevFloatingButtonsVisibility {
  return { ...DEFAULT_VISIBILITY };
}

export function loadDevFloatingButtonsVisibility(): DevFloatingButtonsVisibility {
  try {
    const raw = localStorage.getItem(DEV_FLOATING_BUTTONS_STORAGE_KEY);
    if (!raw) return getDefaultDevFloatingButtonsVisibility();
    const parsed = JSON.parse(raw) as Partial<DevFloatingButtonsVisibility>;
    return {
      ...DEFAULT_VISIBILITY,
      ...parsed,
    };
  } catch {
    return getDefaultDevFloatingButtonsVisibility();
  }
}

export function saveDevFloatingButtonsVisibility(next: DevFloatingButtonsVisibility): void {
  localStorage.setItem(DEV_FLOATING_BUTTONS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(DEV_FLOATING_BUTTONS_EVENT, { detail: next }));
}
