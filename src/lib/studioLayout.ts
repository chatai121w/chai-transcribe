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
export const STUDIO_LAYOUT_STORAGE_KEY = 'studio_widget_layouts_v5';

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
    { i: 'player', x: 0, y: 0,  w: 12, h: 18, minW: 4, minH: 10 },
    { i: 'studio', x: 0, y: 18, w: 12, h: 28, minW: 4, minH: 10 },
  ],
  md: [
    { i: 'player', x: 0, y: 0,  w: 10, h: 18, minW: 4, minH: 10 },
    { i: 'studio', x: 0, y: 18, w: 10, h: 28, minW: 4, minH: 10 },
  ],
  sm: [
    { i: 'player', x: 0, y: 0,  w: 6, h: 18 },
    { i: 'studio', x: 0, y: 18, w: 6, h: 28 },
  ],
};

const GRID_COLS_BY_BP: Record<string, number> = {
  lg: 12,
  md: 10,
  sm: 6,
};

const ITEM_ROW_GAP = 1;

function overlapsWithGap(a: Layout, b: Layout, rowGap: number): boolean {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h + rowGap &&
    b.y < a.y + a.h + rowGap
  );
}

function autoPackNoOverlap(items: Layout[], cols: number): Layout[] {
  const ordered = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const placed: Layout[] = [];

  for (const src of ordered) {
    const maxX = Math.max(0, cols - src.w);
    const next: Layout = {
      ...src,
      x: Math.min(maxX, Math.max(0, src.x)),
      y: Math.max(0, src.y),
    };

    // Move down until this item no longer overlaps previously placed items.
    let guard = 0;
    while (placed.some((p) => overlapsWithGap(next, p, ITEM_ROW_GAP)) && guard < 200) {
      const blockers = placed.filter((p) => overlapsWithGap(next, p, ITEM_ROW_GAP));
      const nextY = Math.max(...blockers.map((p) => p.y + p.h + ITEM_ROW_GAP));
      next.y = Math.max(next.y + ITEM_ROW_GAP, nextY);
      guard += 1;
    }

    placed.push(next);
  }

  return placed;
}

/** Make sure a stored layouts object still references all current widget keys
 *  AND that every item has sane dimensions (>= minW/minH). Items with degenerate
 *  width/height get reset to the default sizes. */
function reconcileLayouts(stored: Layouts): Layouts {
  const out: Layouts = {};
  for (const bp of Object.keys(DEFAULT_STUDIO_LAYOUTS)) {
    const defaults = DEFAULT_STUDIO_LAYOUTS[bp] || [];
    const cols = GRID_COLS_BY_BP[bp] ?? 12;
    const incoming = stored[bp] || [];
    const byKey = new Map<string, Layout>();
    for (const item of incoming) byKey.set(item.i, item);
    const normalized = defaults.map((d) => {
      const found = byKey.get(d.i);
      if (!found) return d;
      // Validate: if width or height is below minimum, fall back to defaults
      const minW = d.minW ?? 4;
      const minH = d.minH ?? 8;
      const maxW = Math.max(minW, cols);
      const wRaw = typeof found.w === 'number' && Number.isFinite(found.w) ? Math.round(found.w) : d.w;
      const hRaw = typeof found.h === 'number' && Number.isFinite(found.h) ? Math.round(found.h) : d.h;
      const w = Math.min(maxW, Math.max(minW, wRaw));
      const h = Math.max(minH, hRaw);

      const maxX = Math.max(0, cols - w);
      const xRaw = typeof found.x === 'number' && Number.isFinite(found.x) ? Math.round(found.x) : d.x;
      const yRaw = typeof found.y === 'number' && Number.isFinite(found.y) ? Math.round(found.y) : d.y;
      const x = Math.min(maxX, Math.max(0, xRaw));
      const y = Math.max(0, yRaw);
      return { ...d, ...found, i: d.i, x, y, w, h };
    });

    // Self-heal common broken cases:
    // 1) stacked-with-gap layout (looks like massive empty canvas)
    // 2) overlapping/packed-left widgets (looks like one card is missing)
    const player = normalized.find((it) => it.i === 'player');
    const studio = normalized.find((it) => it.i === 'studio');
    if (player && studio) {
      const halfCols = Math.ceil(cols / 2);
      const bothHalfWidth = player.w <= halfCols && studio.w <= halfCols;
      const largeVerticalGap = Math.abs(player.y - studio.y) >= Math.max(player.h, 10);

      const overlap =
        player.x < studio.x + studio.w &&
        studio.x < player.x + player.w &&
        player.y < studio.y + studio.h &&
        studio.y < player.y + player.h;

      const packedLeftSameRow =
        bothHalfWidth &&
        Math.abs(player.y - studio.y) <= 2 &&
        player.x < halfCols &&
        studio.x < halfCols;

      if ((bothHalfWidth && largeVerticalGap) || overlap || packedLeftSameRow) {
        const defaultPlayer = defaults.find((it) => it.i === 'player');
        const defaultStudio = defaults.find((it) => it.i === 'studio');
        if (defaultPlayer && defaultStudio) {
          player.x = defaultPlayer.x;
          player.y = defaultPlayer.y;
          player.w = defaultPlayer.w;
          player.h = defaultPlayer.h;

          studio.x = defaultStudio.x;
          studio.y = defaultStudio.y;
          studio.w = defaultStudio.w;
          studio.h = defaultStudio.h;
        }
      }
    }

    // Final safety net: make sure items do not overlap each other.
    out[bp] = autoPackNoOverlap(normalized, cols);
  }
  return out;
}

export function sanitizeStudioLayouts(layouts: Layouts): Layouts {
  return reconcileLayouts(layouts);
}

export function loadStudioLayouts(): Layouts {
  try {
    const raw = localStorage.getItem(STUDIO_LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_STUDIO_LAYOUTS;
    const parsed = JSON.parse(raw) as Layouts;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STUDIO_LAYOUTS;
    const reconciled = reconcileLayouts(parsed);
    // Persist the healed layout so broken data won't keep coming back on next load.
    localStorage.setItem(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify(reconciled));
    return reconciled;
  } catch {
    return DEFAULT_STUDIO_LAYOUTS;
  }
}

export function saveStudioLayouts(layouts: Layouts): void {
  try {
    const sanitized = reconcileLayouts(layouts);
    localStorage.setItem(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify(sanitized));
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
