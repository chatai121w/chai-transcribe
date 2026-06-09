import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDesignMode } from './DesignModeProvider';
import {
  computeSelector,
  computeClassSelector,
  describeElement,
  type OverrideScope,
} from '@/lib/designOverrides';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { X, Undo2, Eye, EyeOff, Trash2, MousePointerClick } from 'lucide-react';

interface PendingChange {
  el: Element;
  property: string;     // css property
  value: string;        // new value
  label: string;        // human label
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
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [hoverLabel, setHoverLabel] = useState('');
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Hover + click capture
  useEffect(() => {
    if (!enabled) {
      setHoverRect(null);
      setSelectedEl(null);
      return;
    }

    const isOwnUi = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return !!target.closest('[data-design-mode-ui]');
    };

    const onMove = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || isOwnUi(target)) { setHoverRect(null); return; }
      setHoverRect(target.getBoundingClientRect());
      setHoverLabel(describeElement(target));
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || isOwnUi(target)) return;
      e.preventDefault();
      e.stopPropagation();
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

      {/* Element editor dialog */}
      <Dialog open={!!selectedEl && !pending} onOpenChange={(o) => { if (!o) setSelectedEl(null); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">
              עריכת אלמנט: <code className="text-xs text-muted-foreground">{selectedEl ? describeElement(selectedEl) : ''}</code>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {EDITABLE_FIELDS.map(f => {
              const current = selectedEl ? getComputedStyle(selectedEl).getPropertyValue(f.property).trim() : '';
              return (
                <div key={f.property} className="flex items-center gap-2">
                  <Label className="w-24 text-xs text-right shrink-0">{f.label}</Label>
                  {f.type === 'color' ? (
                    <>
                      <input
                        type="color"
                        defaultValue={rgbToHex(current) || '#000000'}
                        onChange={(e) => selectedEl && setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label })}
                        className="h-8 w-12 rounded border border-border cursor-pointer"
                      />
                      <Input
                        defaultValue={current}
                        placeholder={f.placeholder}
                        onBlur={(e) => { if (selectedEl && e.target.value !== current) setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label }); }}
                        className="h-8 text-xs flex-1"
                      />
                    </>
                  ) : (
                    <Input
                      defaultValue={current}
                      placeholder={f.placeholder}
                      onBlur={(e) => { if (selectedEl && e.target.value !== current) setPending({ el: selectedEl, property: f.property, value: e.target.value, label: f.label }); }}
                      className="h-8 text-xs flex-1"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSelectedEl(null)}>סגור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scope dialog */}
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">להחיל על:</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {pending?.label}: <span className="font-mono text-foreground">{pending?.value}</span>
            </p>
            <Button className="w-full justify-start text-right" variant="outline" onClick={() => applyScope('element')}>
              🎯 רק האלמנט הזה
            </Button>
            <Button className="w-full justify-start text-right" variant="outline" onClick={() => applyScope('class')}>
              🧩 כל האלמנטים מהסוג הזה בעמוד
            </Button>
            <Button className="w-full justify-start text-right" variant="outline" onClick={() => applyScope('global')}>
              🌐 כל המופעים בכל האתר
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>,
    document.body
  );
}

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}
