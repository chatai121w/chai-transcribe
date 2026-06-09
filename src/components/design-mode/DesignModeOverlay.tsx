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
import { X, Undo2, Eye, EyeOff, Trash2, MousePointerClick, Minimize2, Maximize2 } from 'lucide-react';

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
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [editorMinimized, setEditorMinimized] = useState(initialLayout.minimized);
  const [editorSize, setEditorSize] = useState(() => ({ width: initialLayout.width, height: initialLayout.height }));
  const [editorPosition, setEditorPosition] = useState(() => ({ x: initialLayout.x, y: initialLayout.y }));
  const toolbarRef = useRef<HTMLDivElement | null>(null);

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
      if (!target || isOwnUi(target)) { setHoverRect(null); return; }
      setHoverRect(target.getBoundingClientRect());
      setHoverLabel(describeElement(target));
    };

    const onClick = (e: MouseEvent) => {
      const target = resolveElementTarget(e.target);
      if (!target || isOwnUi(target)) return;

      // Allow normal click behavior with Ctrl/Cmd (open links, button actions, etc.).
      if (e.ctrlKey || e.metaKey) return;

      e.preventDefault();
      e.stopPropagation();
      // If the panel was minimized/collapsed earlier, reopen it when user selects an element.
      setCollapsed(false);
      setEditorMinimized(false);
      setSelectedEl(target);
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
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [enabled, selectedEl, setEnabled, undoLast]);

  if (!enabled) return null;

  const applyScope = (scope: OverrideScope) => {
    if (!pending) return;
    let selector = '';
    if (scope === 'element') selector = computeSelector(pending.el);
    else if (scope === 'class') selector = computeClassSelector(pending.el);
    else selector = computeClassSelector(pending.el); // 'global' falls back to class for now (token-level not auto-mapped)

    addOverride({
      scope,
      selector,
      label: `${pending.label} ← ${pending.value}`,
      css: { [pending.property]: pending.value },
    });
    setPending(null);
    setSelectedEl(null);
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
          }}>
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
        <Rnd
          size={editorSize}
          position={editorPosition}
          minWidth={360}
          minHeight={320}
          maxWidth={Math.max(420, window.innerWidth - 24)}
          maxHeight={Math.max(340, window.innerHeight - 24)}
          bounds="window"
          dragHandleClassName="design-mode-editor-drag-handle"
          onDragStop={(_, d) => setEditorPosition({ x: d.x, y: d.y })}
          onResizeStop={(_, __, ref, ___, position) => {
            setEditorSize({ width: ref.offsetWidth, height: ref.offsetHeight });
            setEditorPosition({ x: position.x, y: position.y });
          }}
          className="z-[100000]"
        >
          <div className="flex h-full flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="design-mode-editor-drag-handle flex cursor-move items-center justify-between gap-2 border-b border-border/50 px-3 py-2 select-none">
              <div className="text-sm font-semibold text-right truncate">
                עריכת אלמנט: <code className="text-xs text-muted-foreground">{describeElement(selectedEl)}</code>
              </div>
              <div className="flex items-center gap-1">
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
                  onClick={() => {
                    setSelectedEl(null);
                    setPending(null);
                  }}
                  title="סגור"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3" dir="rtl">
              {EDITABLE_FIELDS.map(f => {
                const current = getComputedStyle(selectedEl).getPropertyValue(f.property).trim();
                return (
                  <div key={f.property} className="flex items-center gap-2">
                    <Label className="w-24 text-xs text-right shrink-0">{f.label}</Label>
                    {f.type === 'color' ? (
                      <>
                        <input
                          type="color"
                          defaultValue={rgbToHex(current) || '#000000'}
                          onChange={(e) => setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label })}
                          className="h-8 w-12 rounded border border-border cursor-pointer"
                        />
                        <Input
                          defaultValue={current}
                          placeholder={f.placeholder}
                          onBlur={(e) => {
                            if (e.target.value !== current) {
                              setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label });
                            }
                          }}
                          className="h-8 text-xs flex-1"
                        />
                      </>
                    ) : (
                      <Input
                        defaultValue={current}
                        placeholder={f.placeholder}
                        onBlur={(e) => {
                          if (e.target.value !== current) {
                            setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label });
                          }
                        }}
                        className="h-8 text-xs flex-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {pending && (
              <div className="border-t border-border/50 p-3 space-y-2" dir="rtl">
                <p className="text-xs text-muted-foreground text-right">
                  להחיל שינוי: <span className="font-mono text-foreground">{pending.label}: {pending.value}</span>
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  <Button className="justify-start text-right" variant="outline" onClick={() => applyScope('element')}>
                    🎯 רק האלמנט הזה
                  </Button>
                  <Button className="justify-start text-right" variant="outline" onClick={() => applyScope('class')}>
                    🧩 כל האלמנטים מהסוג הזה בעמוד
                  </Button>
                  <Button className="justify-start text-right" variant="outline" onClick={() => applyScope('global')}>
                    🌐 כל המופעים בכל האתר
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setPending(null)}>ביטול</Button>
                </div>
              </div>
            )}
          </div>
        </Rnd>
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
