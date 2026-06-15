/**
 * Tiny global event bus to open the QuickCutDialog from anywhere
 * (sidebar, page buttons, keyboard shortcuts, …).
 */

const EVT_OPEN = "quick-cut:open";

export interface OpenQuickCutDetail {
  /** Optional pre-selected file */
  file?: File;
  /** Optional initial split preset */
  preset?: "halves" | "thirds" | "every5min";
}

export function openQuickCut(detail: OpenQuickCutDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenQuickCutDetail>(EVT_OPEN, { detail }));
}

export function onOpenQuickCut(cb: (d: OpenQuickCutDetail) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<OpenQuickCutDetail>).detail ?? {});
  window.addEventListener(EVT_OPEN, handler);
  return () => window.removeEventListener(EVT_OPEN, handler);
}
