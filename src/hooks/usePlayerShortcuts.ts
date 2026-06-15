import { useState, useCallback } from 'react';

export interface PlayerShortcutDef {
  id: string;
  descriptionHe: string;
  defaultCode: string; // e.code value (e.g. 'Space', 'ArrowLeft', 'KeyM')
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBinding {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const STORAGE_KEY = 'player_shortcuts_v1';

export const PLAYER_SHORTCUTS: PlayerShortcutDef[] = [
  { id: 'play-pause',   descriptionHe: 'נגן / עצור',           defaultCode: 'Space' },
  { id: 'seek-fwd-5',   descriptionHe: '±5 שניות קדימה (RTL)', defaultCode: 'ArrowLeft' },
  { id: 'seek-back-5',  descriptionHe: '±5 שניות אחורה (RTL)', defaultCode: 'ArrowRight' },
  { id: 'seek-fwd-15',  descriptionHe: '+15 שניות קדימה',      defaultCode: 'ArrowLeft',  ctrl: true },
  { id: 'seek-back-15', descriptionHe: '-15 שניות אחורה',      defaultCode: 'ArrowRight', ctrl: true },
  { id: 'word-next',    descriptionHe: 'מילה הבאה',             defaultCode: 'ArrowLeft',  shift: true },
  { id: 'word-prev',    descriptionHe: 'מילה קודמת',           defaultCode: 'ArrowRight', shift: true },
  { id: 'fine-fwd',     descriptionHe: 'דיוק +0.5 שניות',      defaultCode: 'Comma' },
  { id: 'fine-back',    descriptionHe: 'דיוק -0.5 שניות',      defaultCode: 'Period' },
  { id: 'vol-up',       descriptionHe: 'עוצמה ↑',              defaultCode: 'ArrowUp' },
  { id: 'vol-down',     descriptionHe: 'עוצמה ↓',              defaultCode: 'ArrowDown' },
  { id: 'mute',         descriptionHe: 'השתקה / ביטול השתקה',  defaultCode: 'KeyM' },
  { id: 'speed-down',   descriptionHe: 'האט מהירות',           defaultCode: 'BracketLeft' },
  { id: 'speed-up',     descriptionHe: 'האץ מהירות',           defaultCode: 'BracketRight' },
  { id: 'speed-reset',  descriptionHe: 'מהירות רגילה (×1)',    defaultCode: 'Backslash' },
  { id: 'go-start',     descriptionHe: 'קפוץ להתחלה',          defaultCode: 'Home' },
  { id: 'go-end',       descriptionHe: 'קפוץ לסוף',            defaultCode: 'End' },
  { id: 'restart-play', descriptionHe: 'נגן מההתחלה',          defaultCode: 'KeyR', ctrl: true },
  { id: 'mark-a',       descriptionHe: 'סמן נקודה A',          defaultCode: 'KeyA' },
  { id: 'mark-b',       descriptionHe: 'סמן נקודה B',          defaultCode: 'KeyB' },
  { id: 'loop-ab',      descriptionHe: 'לופ A-B',               defaultCode: 'KeyL' },
];

/** Convert e.code → human-readable label */
export function codeToLabel(code: string): string {
  const map: Record<string, string> = {
    Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Comma: ',', Period: '.', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']',
    Home: 'Home', End: 'End', Escape: 'Esc',
    Enter: 'Enter', Tab: 'Tab', Delete: 'Del', Backspace: '⌫',
  };
  if (map[code]) return map[code];
  // KeyX → X
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  // Digit0..9
  if (/^Digit\d$/.test(code)) return code.slice(5);
  // F1..F12
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/** Convert a binding → human-readable string like "Ctrl+←" */
export function bindingToLabel(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.ctrl)  parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt)   parts.push('Alt');
  parts.push(codeToLabel(b.code));
  return parts.join('+');
}

function loadBindings(): Record<string, KeyBinding> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function usePlayerShortcuts() {
  const [customBindings, setCustomBindings] = useState<Record<string, KeyBinding>>(loadBindings);

  const getBinding = useCallback((id: string): KeyBinding => {
    if (customBindings[id]) return customBindings[id];
    const def = PLAYER_SHORTCUTS.find(s => s.id === id);
    if (!def) return { code: '' };
    return { code: def.defaultCode, ctrl: def.ctrl, shift: def.shift, alt: def.alt };
  }, [customBindings]);

  const setBinding = useCallback((id: string, b: KeyBinding) => {
    setCustomBindings(prev => {
      const next = { ...prev, [id]: b };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetBinding = useCallback((id: string) => {
    setCustomBindings(prev => {
      const next = { ...prev };
      delete next[id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setCustomBindings({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  /** Returns true if the KeyboardEvent matches the stored binding for this action */
  const matches = useCallback((id: string, e: KeyboardEvent): boolean => {
    const b = getBinding(id);
    if (!b.code) return false;
    return (
      e.code === b.code &&
      !!e.ctrlKey  === !!b.ctrl &&
      !!e.shiftKey === !!b.shift &&
      !!e.altKey   === !!b.alt
    );
  }, [getBinding]);

  return { customBindings, getBinding, setBinding, resetBinding, resetAll, matches };
}
