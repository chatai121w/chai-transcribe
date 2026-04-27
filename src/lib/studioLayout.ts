/**
 * Studio Layout — persistence helpers for the draggable widget grid in
 * `SyncAudioPlayer`. Stores per-breakpoint layouts in localStorage and
 * (optionally) syncs to Supabase via the cloud preferences hook.
 *
 * Each "widget" is identified by a stable string key:
 *   - 'player'  — top playback bar + visualizers
 *   - 'noise'   — smart noise reduction + presets
 *   - 'mixer'   — professional mixer (EQ + processing)
 *   - 'doubler' — vocal doubler
 *   - 'overlay' — personal sync overlay
 */

import type { Layout, Layouts } from 'react-grid-layout';

export type StudioWidgetKey = 'player' | 'studio';

export const STUDIO_WIDGET_KEYS: StudioWidgetKey[] = ['player', 'studio'];

/** localStorage key used for persistence. */
export const STUDIO_LAYOUT_STORAGE_KEY = 'studio_widget_layouts_v1';

/** localStorage key for the edit-mode toggle (so it persists across reloads). */
export const STUDIO_LAYOUT_EDIT_MODE_KEY = 'studio_widget_edit_mode';

/**
 * Default 12-column layouts. We define `lg` (≥996px) and `md` (≥768px)
 * breakpoints. RGL falls back gracefully for smaller screens.
 *
 * Coordinates: x/y in grid units, w/h in grid units.
 * rowHeight is configured at 32px in the consumer.
 */
export const DEFAULT_STUDIO_LAYOUTS: Layouts = {
  lg: [
    { i: 'player', x: 0, y: 0, w: 6, h: 22, minW: 4, minH: 10 },
    { i: 'studio', x: 6, y: 0, w: 6, h: 30, minW: 4, minH: 10 },
  ],
  md: [
    { i: 'player', x: 0, y: 0,  w: 10, h: 18, minW: 4, minH: 10 },
    { i: 'studio', x: 0, y: 18, w: 10, h: 30, minW: 4, minH: 10 },
  ],
  sm: [
    { i: 'player', x: 0, y: 0,  w: 6, h: 18 },
    { i: 'studio', x: 0, y: 18, w: 6, h: 30 },
  ],
};

/** Make sure a stored layouts object still references all current widget keys
 *  AND that every item has sane dimensions (>= minW/minH). Items with degenerate
 *  width/height get reset to the default sizes. */
function reconcileLayouts(stored: Layouts): Layouts {
  const out: Layouts = {};
  for (const bp of Object.keys(DEFAULT_STUDIO_LAYOUTS)) {
    const defaults = DEFAULT_STUDIO_LAYOUTS[bp] || [];
    const incoming = stored[bp] || [];
    const byKey = new Map<string, Layout>();
    for (const item of incoming) byKey.set(item.i, item);
    out[bp] = defaults.map((d) => {
      const found = byKey.get(d.i);
      if (!found) return d;
      // Validate: if width or height is below minimum, fall back to defaults
      const minW = d.minW ?? 4;
      const minH = d.minH ?? 8;
      const w = typeof found.w === 'number' && found.w >= minW ? found.w : d.w;
      const h = typeof found.h === 'number' && found.h >= minH ? found.h : d.h;
      const x = typeof found.x === 'number' && found.x >= 0 ? found.x : d.x;
      const y = typeof found.y === 'number' && found.y >= 0 ? found.y : d.y;
      return { ...d, ...found, i: d.i, x, y, w, h };
    });
  }
  return out;
}

export function loadStudioLayouts(): Layouts {
  try {
    const raw = localStorage.getItem(STUDIO_LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_STUDIO_LAYOUTS;
    const parsed = JSON.parse(raw) as Layouts;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STUDIO_LAYOUTS;
    return reconcileLayouts(parsed);
  } catch {
    return DEFAULT_STUDIO_LAYOUTS;
  }
}

export function saveStudioLayouts(layouts: Layouts): void {
  try {
    localStorage.setItem(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    /* ignore quota errors */
  }
}

export function resetStudioLayouts(): Layouts {
  try {
    localStorage.removeItem(STUDIO_LAYOUT_STORAGE_KEY);
  } catch { /* ignore */ }
  return DEFAULT_STUDIO_LAYOUTS;
}

export function isStudioEditModeEnabled(): boolean {
  try {
    return localStorage.getItem(STUDIO_LAYOUT_EDIT_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setStudioEditModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STUDIO_LAYOUT_EDIT_MODE_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}
