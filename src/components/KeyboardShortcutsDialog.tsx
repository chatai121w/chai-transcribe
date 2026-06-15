import { SHORTCUTS, type ShortcutDef } from '@/hooks/useKeyboardShortcuts';
import {
  PLAYER_SHORTCUTS,
  usePlayerShortcuts,
  bindingToLabel,
  codeToLabel,
  type KeyBinding,
} from '@/hooks/usePlayerShortcuts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Keyboard, RotateCcw } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categoryLabels: Record<string, string> = {
  general: 'כללי',
  audio: 'נגן אודיו',
  transcription: 'תמלול',
  editing: 'עריכה',
};

function KeyBadge({ text }: { text: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-md border bg-muted text-xs font-mono font-medium shadow-sm">
      {text}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutDef }) {
  const keys: string[] = [];
  if (shortcut.ctrl) keys.push('Ctrl');
  if (shortcut.shift) keys.push('Shift');
  if (shortcut.alt) keys.push('Alt');
  keys.push(shortcut.key);

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
      <span className="text-sm text-foreground">{shortcut.descriptionHe}</span>
      <div className="flex items-center gap-1 mr-4" dir="ltr">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
            <KeyBadge text={k} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Player shortcut row with rebind capability ───────────────────────────────
function PlayerShortcutRow({
  id,
  descriptionHe,
  binding,
  isDefault,
  onRebind,
  onReset,
}: {
  id: string;
  descriptionHe: string;
  binding: KeyBinding;
  isDefault: boolean;
  onRebind: (id: string) => void;
  onReset: (id: string) => void;
}) {
  const label = bindingToLabel(binding);
  const parts = label.split('+');

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 group">
      <span className="text-sm text-foreground">{descriptionHe}</span>
      <div className="flex items-center gap-1.5 mr-3 shrink-0" dir="ltr">
        <div className="flex items-center gap-1">
          {parts.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
              <KeyBadge text={p} />
            </span>
          ))}
        </div>
        <button
          onClick={() => onRebind(id)}
          className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
          title="לחץ לשינוי המקש"
        >
          שנה
        </button>
        {!isDefault && (
          <button
            onClick={() => onReset(id)}
            title="אפס לברירת מחדל"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <RotateCcw className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Capture overlay to detect a new key combo ────────────────────────────────
function KeyCaptureOverlay({
  descriptionHe,
  onCapture,
  onCancel,
}: {
  descriptionHe: string;
  onCapture: (b: KeyBinding) => void;
  onCancel: () => void;
}) {
  const [captured, setCaptured] = useState<KeyBinding | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { onCancel(); return; }
      const b: KeyBinding = {
        code: e.code,
        ctrl: e.ctrlKey || undefined,
        shift: e.shiftKey || undefined,
        alt: e.altKey || undefined,
      };
      setCaptured(b);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-background rounded-2xl border shadow-2xl p-6 w-80 flex flex-col items-center gap-4"
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-center">{descriptionHe}</div>
        <div className="text-xs text-muted-foreground">לחץ על שילוב המקשים החדש</div>
        {captured ? (
          <div className="flex items-center gap-1" dir="ltr">
            {bindingToLabel(captured).split('+').map((p, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
                <KeyBadge text={p} />
              </span>
            ))}
          </div>
        ) : (
          <div className="h-7 text-muted-foreground text-sm">ממתין...</div>
        )}
        <div className="flex gap-2 mt-1">
          <Button
            size="sm"
            disabled={!captured}
            onClick={() => captured && onCapture(captured)}
          >
            אשר
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            ביטול
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Escape = ביטול</p>
      </div>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────
export const KeyboardShortcutsDialog = ({ open, onOpenChange }: Props) => {
  const { getBinding, setBinding, resetBinding, resetAll, customBindings } = usePlayerShortcuts();
  const [capturing, setCapturing] = useState<{ id: string; descriptionHe: string } | null>(null);

  const grouped = SHORTCUTS.reduce<Record<string, ShortcutDef[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const handleRebind = (id: string) => {
    const def = PLAYER_SHORTCUTS.find(s => s.id === id)!;
    setCapturing({ id, descriptionHe: def.descriptionHe });
  };

  const handleCapture = (b: KeyBinding) => {
    if (!capturing) return;
    setBinding(capturing.id, b);
    setCapturing(null);
  };

  return (
    <>
      {capturing && (
        <KeyCaptureOverlay
          descriptionHe={capturing.descriptionHe}
          onCapture={handleCapture}
          onCancel={() => setCapturing(null)}
        />
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              קיצורי מקלדת
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="player" dir="rtl">
            <TabsList className="w-full mb-3">
              <TabsTrigger value="player" className="flex-1">🎧 נגן — ניתן להתאמה</TabsTrigger>
              <TabsTrigger value="general" className="flex-1">⌨️ כללי</TabsTrigger>
            </TabsList>

            {/* Player shortcuts — editable */}
            <TabsContent value="player" className="space-y-1">
              <p className="text-xs text-muted-foreground mb-3 px-1">
                לחץ על "שנה" ליד כל שורה לשינוי המקש. ריחוף על שורה מציג את הכפתורים.
              </p>
              {PLAYER_SHORTCUTS.map(def => {
                const binding = getBinding(def.id);
                const isDefault = !customBindings[def.id];
                return (
                  <PlayerShortcutRow
                    key={def.id}
                    id={def.id}
                    descriptionHe={def.descriptionHe}
                    binding={binding}
                    isDefault={isDefault}
                    onRebind={handleRebind}
                    onReset={resetBinding}
                  />
                );
              })}
              {Object.keys(customBindings).length > 0 && (
                <div className="pt-3 flex justify-end">
                  <Button size="sm" variant="outline" onClick={resetAll} className="text-xs gap-1">
                    <RotateCcw className="w-3 h-3" />
                    אפס הכל לברירת מחדל
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* General shortcuts — read-only */}
            <TabsContent value="general" className="space-y-4">
              {Object.entries(grouped).map(([category, shortcuts]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      {categoryLabels[category] || category}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    {shortcuts.map((s, i) => (
                      <ShortcutRow key={i} shortcut={s} />
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-4 text-center">
                לחץ <KeyBadge text="?" /> לפתיחת/סגירת חלון זה
              </p>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
};
