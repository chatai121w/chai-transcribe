import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { useDesignMode } from './DesignModeProvider';
import {
  computeSelector,
  computeClassSelector,
  describeElement,
  type OverrideScope,
} from '@/lib/designOverrides';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { X, Undo2, Eye, EyeOff, Trash2, MousePointerClick, Minimize2, Maximize2, Pipette, Plus, Hand, GripVertical } from 'lucide-react';
import { DesignModeSaveMenu } from './DesignModeSaveMenu';

interface PendingChange {
  el: Element;
  property: string;     // css property
  value: string;        // new value
  label: string;        // human label
}

type EditorLayout = {
  width: number;
  height: number;
  x: number;
  y: number;
  minimized: boolean;
};

const DESIGN_MODE_EDITOR_LAYOUT_KEY = 'design_mode_editor_layout_v1';
const COLOR_FAVORITES_KEY = 'design_mode_color_favorites_v1';
const TOOLBAR_POS_KEY = 'design_mode_toolbar_pos_v1';
const CLICK_THROUGH_KEY = 'design_mode_click_through_v1';

function loadToolbarPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(TOOLBAR_POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const x = clamp(Number(p.x) || 16, 4, Math.max(4, window.innerWidth - 200));
      const y = clamp(Number(p.y) || 16, 4, Math.max(4, window.innerHeight - 60));
      return { x, y };
    }
  } catch { /* ignore */ }
  return { x: 16, y: 16 };
}

function loadColorFavorites(): string[] {
  try {
    const raw = localStorage.getItem(COLOR_FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function pushColorFavorite(existing: string[], color: string): string[] {
  const norm = color.toLowerCase();
  const filtered = existing.filter(c => c.toLowerCase() !== norm);
  const next = [norm, ...filtered].slice(0, 12);
  localStorage.setItem(COLOR_FAVORITES_KEY, JSON.stringify(next));
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function fitLayoutToViewport(raw: Partial<EditorLayout>, fallback: EditorLayout): EditorLayout {
  const minWidth = 360;
  const minHeight = 320;
  const maxWidth = Math.max(minWidth, window.innerWidth - 24);
  const maxHeight = Math.max(minHeight, window.innerHeight - 24);

  const parsedWidth = Number(raw.width);
  const parsedHeight = Number(raw.height);
  const width = clamp(Number.isFinite(parsedWidth) ? parsedWidth : fallback.width, minWidth, maxWidth);
  const height = clamp(Number.isFinite(parsedHeight) ? parsedHeight : fallback.height, minHeight, maxHeight);

  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  const parsedX = Number(raw.x);
  const parsedY = Number(raw.y);

  return {
    width,
    height,
    x: clamp(Number.isFinite(parsedX) ? parsedX : fallback.x, 8, maxX),
    y: clamp(Number.isFinite(parsedY) ? parsedY : fallback.y, 8, maxY),
    minimized: Boolean(raw.minimized),
  };
}

function getDefaultEditorLayout(): EditorLayout {
  const width = Math.min(460, Math.max(360, window.innerWidth - 40));
  const height = Math.min(560, Math.max(320, window.innerHeight - 140));
  const x = Math.max(16, window.innerWidth - width - 20);
  const y = 84;
  return { width, height, x, y, minimized: false };
}

function loadEditorLayout(): EditorLayout {
  const fallback = getDefaultEditorLayout();
  try {
    const raw = localStorage.getItem(DESIGN_MODE_EDITOR_LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EditorLayout>;
    return fitLayoutToViewport(parsed, fallback);
  } catch {
    return fallback;
  }
}

function saveEditorLayout(layout: EditorLayout) {
  localStorage.setItem(DESIGN_MODE_EDITOR_LAYOUT_KEY, JSON.stringify(layout));
}

const EDITABLE_FIELDS: { property: string; label: string; type: 'color' | 'text'; placeholder?: string }[] = [
  { property: 'color', label: 'צבע טקסט', type: 'color' },
  { property: 'background-color', label: 'צבע רקע', type: 'color' },
  { property: 'border-color', label: 'צבע מסגרת', type: 'color' },
  { property: 'font-size', label: 'גודל טקסט', type: 'text', placeholder: '14px' },
  { property: 'font-weight', label: 'משקל טקסט', type: 'text', placeholder: '600' },
  { property: 'border-radius', label: 'עיגול פינות', type: 'text', placeholder: '8px' },
  { property: 'padding', label: 'ריווח פנימי', type: 'text', placeholder: '8px 12px' },
];

export function DesignModeOverlay() {
  const { enabled, setEnabled, overrides, addOverride, undoLast, clearAll } = useDesignMode();
  const initialLayout = loadEditorLayout();
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [hoverLabel, setHoverLabel] = useState('');
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [liveChanges, setLiveChanges] = useState<Record<string, string>>({}); // property -> value (live preview)
  const [selectionKey, setSelectionKey] = useState(0); // increments on each new element selection to remount inputs
  const [colorFavorites, setColorFavorites] = useState<string[]>(loadColorFavorites);
  const [lastFocusedColorProp, setLastFocusedColorProp] = useState<string>('color');
  const [hoveredFavIndex, setHoveredFavIndex] = useState<number | null>(null);
  const [selectedFavs, setSelectedFavs] = useState<Set<number>>(new Set());
  const [deleteMode, setDeleteMode] = useState(false);
  const [hoverColors, setHoverColors] = useState<{ bg: string; text: string } | null>(null);
  const [eyedropperError, setEyedropperError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [editorMinimized, setEditorMinimized] = useState(initialLayout.minimized);
  const [editorSize, setEditorSize] = useState(() => ({ width: initialLayout.width, height: initialLayout.height }));
  const [editorPosition, setEditorPosition] = useState(() => ({ x: initialLayout.x, y: initialLayout.y }));
  const [clickPoint, setClickPoint] = useState<{ x: number; y: number } | null>(null);
  const editorSizeRef = useRef(editorSize);
  editorSizeRef.current = editorSize;
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const previewStyleRef = useRef<HTMLStyleElement | null>(null);

  // Create a dedicated <style> element for live preview — removed on unmount.
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'design-mode-live-preview';
    document.head.appendChild(el);
    previewStyleRef.current = el;
    return () => { el.remove(); previewStyleRef.current = null; };
  }, []);

  // Update the live preview <style> whenever liveChanges changes.
  useEffect(() => {
    const styleEl = previewStyleRef.current;
    if (!styleEl) return;
    const entries = Object.entries(liveChanges);
    if (!selectedEl || entries.length === 0) { styleEl.textContent = ''; return; }
    const selector = computeClassSelector(selectedEl);
    const props = entries.map(([prop, val]) => `  ${prop}: ${val} !important;`).join('\n');
    styleEl.textContent = `${selector} {\n${props}\n}`;
  }, [liveChanges, selectedEl]);

  // Reposition dialog near the click point whenever a new element is selected.
  // Intentionally NOT depending on editorSize to avoid jumping after user resizes the panel.
  useEffect(() => {
    if (!selectedEl || editorMinimized) return;
    const { width: W, height: H } = editorSizeRef.current;

    let preferredX: number;
    let preferredY: number;

    if (clickPoint) {
      // Place dialog just to the right of (and slightly above) the click point.
      preferredX = clickPoint.x + 20;
      preferredY = Math.max(8, clickPoint.y - 40);
      // If it doesn't fit to the right, flip to the left.
      if (preferredX + W > window.innerWidth - 8) {
        preferredX = Math.max(8, clickPoint.x - W - 20);
      }
    } else {
      const rect = selectedEl.getBoundingClientRect();
      preferredX = rect.right + 16 + W <= window.innerWidth
        ? rect.right + 16
        : Math.max(8, rect.left - W - 16);
      preferredY = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - H - 8));
    }

    setEditorPosition({
      x: Math.max(8, Math.min(preferredX, window.innerWidth - W - 8)),
      y: Math.max(8, Math.min(preferredY, window.innerHeight - H - 8)),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEl, editorMinimized, clickPoint]);

  useEffect(() => {
    saveEditorLayout({
      width: editorSize.width,
      height: editorSize.height,
      x: editorPosition.x,
      y: editorPosition.y,
      minimized: editorMinimized,
    });
  }, [editorMinimized, editorPosition.x, editorPosition.y, editorSize.height, editorSize.width]);

  useEffect(() => {
    const onResize = () => {
      const current = fitLayoutToViewport(
        {
          width: editorSize.width,
          height: editorSize.height,
          x: editorPosition.x,
          y: editorPosition.y,
          minimized: editorMinimized,
        },
        getDefaultEditorLayout(),
      );
      setEditorSize({ width: current.width, height: current.height });
      setEditorPosition({ x: current.x, y: current.y });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [editorMinimized, editorPosition.x, editorPosition.y, editorSize.height, editorSize.width]);

  // Hover + click capture
  useEffect(() => {
    if (!enabled) {
      setHoverRect(null);
      setSelectedEl(null);
      return;
    }

    const resolveElementTarget = (target: EventTarget | null): Element | null => {
      if (!target) return null;
      if (target instanceof Element) return target;
      if (target instanceof Node) return target.parentElement;
      return null;
    };

    const isOwnUi = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return !!target.closest('[data-design-mode-ui]');
    };

    const onMove = (e: MouseEvent) => {
      const target = resolveElementTarget(e.target);
      if (!target || isOwnUi(target)) { setHoverRect(null); setHoverColors(null); return; }
      setHoverRect(target.getBoundingClientRect());
      setHoverLabel(describeElement(target));
      const cs = getComputedStyle(target);
      setHoverColors({
        bg: rgbToHex(cs.backgroundColor) || '#000000',
        text: rgbToHex(cs.color) || '#000000',
      });
    };

    const blockEvent = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof (e as any).stopImmediatePropagation === 'function') {
        (e as any).stopImmediatePropagation();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = resolveElementTarget(e.target);
      if (!target || isOwnUi(target)) return;
      if (e.ctrlKey || e.metaKey) return;
      blockEvent(e);
      // Select on pointerdown so React onClick never fires.
      setCollapsed(false);
      setEditorMinimized(false);
      // Clear any live preview from the previous element
      if (previewStyleRef.current) previewStyleRef.current.textContent = '';
      setLiveChanges({});
      setSelectionKey(k => k + 1);
      setClickPoint({ x: e.clientX, y: e.clientY });
      setSelectedEl(target);
      console.log('[design-mode] selected:', describeElement(target));
    };

    const swallow = (e: Event) => {
      const target = resolveElementTarget(e.target);
      if (!target || isOwnUi(target)) return;
      const me = e as MouseEvent;
      if (me.ctrlKey || me.metaKey) return;
      blockEvent(e);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedEl) setSelectedEl(null);
        else setEnabled(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLast();
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('click', swallow, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('click', swallow, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [enabled, selectedEl, setEnabled, undoLast]);

  if (!enabled) return null;

  const hasChanges = Object.keys(liveChanges).length > 0;

  /** Clear live preview and close the editor panel. */
  const closeEditor = () => {
    if (previewStyleRef.current) previewStyleRef.current.textContent = '';
    setLiveChanges({});
    setSelectedEl(null);
  };

  const applyScope = (scope: OverrideScope) => {
    if (!selectedEl || !hasChanges) return;
    const selector = scope === 'element'
      ? computeSelector(selectedEl)
      : computeClassSelector(selectedEl);

    addOverride({
      scope,
      selector,
      label: `${Object.keys(liveChanges).length} שינויים`,
      css: { ...liveChanges },
    });

    // Auto-save colors to favorites
    const colorFields = EDITABLE_FIELDS.filter(f => f.type === 'color').map(f => f.property);
    let favs = colorFavorites;
    for (const prop of colorFields) {
      if (liveChanges[prop]) favs = pushColorFavorite(favs, liveChanges[prop]);
    }
    if (favs !== colorFavorites) setColorFavorites(favs);

    // Clear preview — the override's own <style> now takes over
    if (previewStyleRef.current) previewStyleRef.current.textContent = '';
    setLiveChanges({});
    setSelectedEl(null);
  };

  /** Save all current live color values to favorites manually */
  const saveCurrentColorsToFavorites = () => {
    const colorFields = EDITABLE_FIELDS.filter(f => f.type === 'color').map(f => f.property);
    let favs = colorFavorites;
    let changed = false;
    for (const prop of colorFields) {
      if (liveChanges[prop]) { favs = pushColorFavorite(favs, liveChanges[prop]); changed = true; }
    }
    if (!changed && selectedEl) {
      // Save computed colors from the element
      for (const prop of colorFields) {
        const val = rgbToHex(getComputedStyle(selectedEl).getPropertyValue(prop).trim());
        if (val) { favs = pushColorFavorite(favs, val); changed = true; }
      }
    }
    if (changed) setColorFavorites(favs);
  };

  /** Delete selected favorites or single one by index */
  const deleteFavorite = (idx: number) => {
    const next = colorFavorites.filter((_, i) => i !== idx);
    localStorage.setItem(COLOR_FAVORITES_KEY, JSON.stringify(next));
    setColorFavorites(next);
    setSelectedFavs(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const deleteSelectedFavorites = () => {
    const next = colorFavorites.filter((_, i) => !selectedFavs.has(i));
    localStorage.setItem(COLOR_FAVORITES_KEY, JSON.stringify(next));
    setColorFavorites(next);
    setSelectedFavs(new Set());
    setDeleteMode(false);
  };

  const toggleFavSelection = (idx: number) => {
    setSelectedFavs(prev => {
      const s = new Set(prev);
      if (s.has(idx)) s.delete(idx); else s.add(idx);
      return s;
    });
  };

  /** Open native EyeDropper API to pick any color from the screen */
  const handleEyeDropper = async (property: string) => {
    if (!('EyeDropper' in window)) {
      setEyedropperError('הדפדפן לא תומך ב-EyeDropper (נדרש Chrome/Edge)');
      setTimeout(() => setEyedropperError(null), 3000);
      return;
    }
    try {
      const dropper = new (window as any).EyeDropper();
      const { sRGBHex } = await dropper.open();
      setLiveChanges(prev => ({ ...prev, [property]: sRGBHex }));
      setLastFocusedColorProp(property);
      setSelectionKey(k => k + 1); // remount inputs to show picked value
    } catch { /* user cancelled */ }
  };

  return createPortal(
    <div data-design-mode-ui dir="rtl">
      {/* Hover highlight */}
      {hoverRect && !selectedEl && (
        <div
          style={{
            position: 'fixed',
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
            outline: '2px solid hsl(43, 74%, 49%)',
            outlineOffset: '-1px',
            background: 'hsla(43, 74%, 49%, 0.08)',
            pointerEvents: 'none',
            zIndex: 99998,
            transition: 'all 80ms ease',
          }}
        >
          <div style={{
            position: 'absolute', top: -22, right: 0,
            background: 'hsl(43, 74%, 49%)', color: '#000',
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            fontFamily: 'monospace', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {hoverColors && (
              <>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: hoverColors.text, border: '1px solid rgba(0,0,0,0.3)', flexShrink: 0 }} title={`טקסט: ${hoverColors.text}`} />
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: hoverColors.bg, border: '1px solid rgba(0,0,0,0.3)', flexShrink: 0 }} title={`רקע: ${hoverColors.bg}`} />
              </>
            )}
            {hoverLabel}
          </div>
        </div>
      )}

      {/* Floating toolbar */}
      <div
        ref={toolbarRef}
        className="fixed top-4 left-4 z-[99999] flex items-center gap-2 rounded-xl border border-yellow-500/50 bg-background/95 backdrop-blur p-2 shadow-lg"
        style={{ direction: 'rtl' }}
      >
        <span className="text-xs font-semibold text-yellow-600 px-2 flex items-center gap-1">
          <MousePointerClick className="h-3.5 w-3.5" /> מצב עיצוב חי
        </span>
        <Button size="sm" variant="ghost" onClick={undoLast} disabled={overrides.length === 0} title="ביטול אחרון (Ctrl+Z)">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(c => !c)} title="מזער">
          {collapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        <span className="text-[10px] text-muted-foreground">{overrides.length} שינויים</span>
        {overrides.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => { if (confirm('למחוק את כל השינויים?')) clearAll(); }} title="נקה הכל">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
        <DesignModeSaveMenu />
        <Button size="sm" variant="outline" onClick={() => setEnabled(false)} title="יציאה (Esc)">
          <X className="h-3.5 w-3.5 ml-1" /> יציאה
        </Button>
      </div>

      {!collapsed && (
        <div className="fixed bottom-4 left-4 z-[99999] text-[11px] text-muted-foreground bg-background/95 backdrop-blur border border-border/50 rounded-md px-3 py-1.5">
          רחף עם העכבר על אלמנט ולחץ כדי לערוך • Esc ליציאה
        </div>
      )}

      {selectedEl && editorMinimized && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-[100000] inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background shadow-lg"
          onClick={() => setEditorMinimized(false)}
          title="שחזור עורך אלמנטים"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}

      {selectedEl && !editorMinimized && (
        /* Fixed full-viewport wrapper so Rnd positions in viewport coords, not document coords.
           This means no scroll-offset bugs and dragging always works. */
        <div
          style={{
            position: 'fixed', top: 0, left: 0,
            width: '100vw', height: '100vh',
            pointerEvents: 'none',
            zIndex: 100000,
          }}
        >
        <Rnd
          size={editorSize}
          position={editorPosition}
          minWidth={360}
          minHeight={320}
          maxWidth={Math.max(420, window.innerWidth - 24)}
          maxHeight={Math.max(340, window.innerHeight - 24)}
          bounds="parent"
          dragHandleClassName="design-mode-editor-drag-handle"
          style={{ pointerEvents: 'all' }}
          onDragStart={() => {
            const handle = document.querySelector('.design-mode-editor-drag-handle') as HTMLElement | null;
            if (handle) handle.style.cursor = 'grabbing';
          }}
          onDragStop={(_, d) => {
            const handle = document.querySelector('.design-mode-editor-drag-handle') as HTMLElement | null;
            if (handle) handle.style.cursor = 'grab';
            setEditorPosition({ x: d.x, y: d.y });
          }}
          onResizeStop={(_, __, ref, ___, position) => {
            setEditorSize({ width: ref.offsetWidth, height: ref.offsetHeight });
            setEditorPosition({ x: position.x, y: position.y });
          }}
        >
          <div className="flex h-full flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="design-mode-editor-drag-handle flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 select-none w-full" style={{ cursor: 'grab' }}>
              <div className="text-sm font-semibold text-right truncate flex-1 min-w-0">
                עריכת אלמנט: <code className="text-xs text-muted-foreground">{describeElement(selectedEl)}</code>
              </div>
              <div className="flex items-center gap-1 shrink-0" style={{ cursor: 'default' }}>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditorMinimized(true)}
                  title="מזער"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={closeEditor}
                  title="סגור (מבטל שינויים)"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Fields — key forces remount (reset inputs) on each new element selection */}
            <div key={selectionKey} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3" dir="rtl">
              {/* Color favorites palette */}
              <div className="flex flex-wrap gap-1.5 pb-1 border-b border-border/40 mb-1">
                <span className="text-[10px] text-muted-foreground w-full text-right flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title="שמור צבעים נוכחיים למועדפים"
                      onClick={saveCurrentColorsToFavorites}
                      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus style={{ width: 10, height: 10 }} /> שמור
                    </button>
                    {colorFavorites.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setDeleteMode(d => !d); setSelectedFavs(new Set()); }}
                        className={`inline-flex items-center gap-0.5 text-[10px] transition-colors ${
                          deleteMode ? 'text-destructive font-semibold' : 'text-muted-foreground hover:text-destructive'
                        }`}
                      >
                        <Trash2 style={{ width: 10, height: 10 }} /> {deleteMode ? 'בטל' : 'מחק'}
                      </button>
                    )}
                    {deleteMode && selectedFavs.size > 0 && (
                      <button
                        type="button"
                        onClick={deleteSelectedFavorites}
                        className="inline-flex items-center gap-0.5 text-[10px] text-white bg-destructive rounded px-1 transition-colors"
                      >
                        מחק {selectedFavs.size} נבחרים
                      </button>
                    )}
                  </span>
                  <span>מועדפים:</span>
                </span>
                {colorFavorites.length === 0 && (
                  <span className="text-[10px] text-muted-foreground/60 text-right w-full">עדיין אין — שמור צבע כדי להוסיף</span>
                )}
                {colorFavorites.map((c, i) => (
                  <div
                    key={i}
                    style={{ position: 'relative', width: 22, height: 22, flexShrink: 0 }}
                    onMouseEnter={() => setHoveredFavIndex(i)}
                    onMouseLeave={() => setHoveredFavIndex(null)}
                  >
                    <button
                      type="button"
                      title={deleteMode ? `מחק ${c}` : c}
                      onClick={() => {
                        if (deleteMode) toggleFavSelection(i);
                        else setLiveChanges(prev => ({ ...prev, [lastFocusedColorProp]: c }));
                      }}
                      style={{
                        background: c,
                        width: 22, height: 22,
                        borderRadius: 4,
                        border: selectedFavs.has(i)
                          ? '2px solid red'
                          : '1.5px solid rgba(0,0,0,0.18)',
                        flexShrink: 0,
                        cursor: 'pointer',
                        opacity: deleteMode && !selectedFavs.has(i) ? 0.6 : 1,
                        display: 'block',
                      }}
                    />
                    {/* X icon on hover (non-delete mode) */}
                    {!deleteMode && hoveredFavIndex === i && (
                      <button
                        type="button"
                        title="מחק מהמועדפים"
                        onClick={(e) => { e.stopPropagation(); deleteFavorite(i); }}
                        style={{
                          position: 'absolute', top: -5, right: -5,
                          width: 13, height: 13,
                          borderRadius: '50%',
                          background: 'hsl(var(--destructive))',
                          color: '#fff',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, lineHeight: 1,
                          zIndex: 10,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {eyedropperError && (
                <p className="text-[11px] text-destructive text-right">{eyedropperError}</p>
              )}
              {EDITABLE_FIELDS.map(f => {
                const current = getComputedStyle(selectedEl).getPropertyValue(f.property).trim();
                const liveVal = liveChanges[f.property];
                return (
                  <div key={f.property} className="flex items-center gap-2">
                    <Label className="w-24 text-xs text-right shrink-0">{f.label}</Label>
                    {f.type === 'color' ? (
                      <>
                        <input
                          type="color"
                          defaultValue={rgbToHex(liveVal ?? current) || '#000000'}
                          onFocus={() => setLastFocusedColorProp(f.property)}
                          onChange={(e) => { setLastFocusedColorProp(f.property); setLiveChanges(prev => ({ ...prev, [f.property]: e.target.value })); }}
                          className="h-8 w-12 rounded border border-border cursor-pointer"
                        />
                        <Input
                          defaultValue={liveVal ?? current}
                          placeholder={f.placeholder}
                          onFocus={() => setLastFocusedColorProp(f.property)}
                          onChange={(e) => { setLastFocusedColorProp(f.property); setLiveChanges(prev => ({ ...prev, [f.property]: e.target.value })); }}
                          className="h-8 text-xs flex-1"
                        />
                        <button
                          type="button"
                          title="בחר צבע מהמסך (EyeDropper)"
                          onClick={() => handleEyeDropper(f.property)}
                          className="h-8 w-8 shrink-0 flex items-center justify-center rounded border border-border hover:bg-accent transition-colors"
                        >
                          <Pipette className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <Input
                        defaultValue={liveVal ?? current}
                        placeholder={f.placeholder}
                        onChange={(e) => setLiveChanges(prev => ({ ...prev, [f.property]: e.target.value }))}
                        className="h-8 text-xs flex-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Save panel — always visible */}
            <div className="border-t border-border/50 p-3 space-y-1.5 shrink-0" dir="rtl">
              {hasChanges && (
                <p className="text-[11px] text-yellow-600 text-right pb-1">
                  👁 תצוגה מקדימה חיה — בחר היכן לשמור:
                </p>
              )}
              {!hasChanges && (
                <p className="text-[11px] text-muted-foreground text-right pb-1">
                  שנה ערך למעלה — תראה תצוגה מקדימה מיידית בעמוד
                </p>
              )}
              <Button
                className="w-full justify-start text-right"
                variant="outline"
                disabled={!hasChanges}
                onClick={() => applyScope('element')}
              >
                🎯 שמור רק על האלמנט הזה
              </Button>
              <Button
                className="w-full justify-start text-right"
                variant="outline"
                disabled={!hasChanges}
                onClick={() => applyScope('class')}
              >
                🧩 שמור על כל האלמנטים מהסוג הזה
              </Button>
              <Button
                className="w-full justify-start text-right"
                variant="outline"
                disabled={!hasChanges}
                onClick={() => applyScope('global')}
              >
                🌐 שמור על כל המופעים בכל האתר
              </Button>
              {hasChanges && (
                <div className="flex justify-end pt-0.5">
                  <Button variant="ghost" size="sm" onClick={closeEditor}>בטל שינויים</Button>
                </div>
              )}
            </div>
          </div>
        </Rnd>
        </div>
      )}
    </div>,
    document.body
  );
}

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}
