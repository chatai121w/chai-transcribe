import { useEffect, useCallback, useState } from 'react';

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  descriptionHe: string;
  category: 'general' | 'audio' | 'transcription' | 'editing';
}

export const SHORTCUTS: ShortcutDef[] = [
  // General
  { key: '/', ctrl: false, shift: false, description: 'Show keyboard shortcuts', descriptionHe: 'הצג קיצורי מקלדת', category: 'general' },
  { key: 'b', ctrl: true, shift: false, description: 'Toggle sidebar', descriptionHe: 'פתח/סגור סרגל צד', category: 'general' },
  { key: 'n', ctrl: true, shift: false, description: 'New transcription', descriptionHe: 'תמלול חדש', category: 'general' },

  // Audio Player (registered in SyncAudioPlayer — listed here for reference)
  { key: 'Space', ctrl: false, shift: false, description: 'Play / Pause audio', descriptionHe: 'נגן / השהה אודיו', category: 'audio' },
  { key: '←', ctrl: true, shift: false, description: 'Jump back 5 seconds', descriptionHe: 'קפוץ 5 שניות אחורה', category: 'audio' },
  { key: '→', ctrl: true, shift: false, description: 'Jump forward 5 seconds', descriptionHe: 'קפוץ 5 שניות קדימה', category: 'audio' },
  { key: '←', ctrl: false, shift: true, description: 'Next word (RTL)', descriptionHe: 'מילה הבאה', category: 'audio' },
  { key: '→', ctrl: false, shift: true, description: 'Previous word (RTL)', descriptionHe: 'מילה קודמת', category: 'audio' },
  { key: 'M', ctrl: false, shift: false, description: 'Mute / Unmute', descriptionHe: 'השתק / בטל השתקה', category: 'audio' },
  { key: '+', ctrl: false, shift: false, alt: true, description: 'Speed up playback', descriptionHe: 'הגבר מהירות ניגון', category: 'audio' },
  { key: '-', ctrl: false, shift: false, alt: true, description: 'Slow down playback', descriptionHe: 'האט מהירות ניגון', category: 'audio' },

  // Transcription
  { key: 'c', ctrl: true, shift: true, description: 'Copy transcript', descriptionHe: 'העתק תמלול', category: 'transcription' },
  { key: 's', ctrl: true, shift: false, description: 'Save transcript', descriptionHe: 'שמור תמלול', category: 'transcription' },
  { key: 'e', ctrl: true, shift: true, description: 'Export transcript', descriptionHe: 'ייצא תמלול', category: 'transcription' },
  { key: 'Escape', ctrl: false, shift: false, description: 'Cancel transcription', descriptionHe: 'בטל תמלול', category: 'transcription' },

  // Editing
  { key: 'f', ctrl: true, shift: false, description: 'Search in transcript', descriptionHe: 'חיפוש בתמלול', category: 'editing' },
  { key: 'z', ctrl: true, shift: false, description: 'Undo edit', descriptionHe: 'בטל עריכה', category: 'editing' },
  { key: 'z', ctrl: true, shift: true, description: 'Redo edit', descriptionHe: 'החזר עריכה', category: 'editing' },
];

type ShortcutAction =
  | 'show-shortcuts'
  | 'copy-transcript'
  | 'cancel-transcription'
  | 'search-transcript'
  | 'save-transcript'
  | 'export-transcript'
  | 'new-transcription'
  | 'speed-up'
  | 'speed-down'
  | 'undo'
  | 'redo';

type ShortcutHandler = (action: ShortcutAction) => void;

export const useKeyboardShortcuts = (handler?: ShortcutHandler) => {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip if typing in input/textarea/contenteditable
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
      // Allow these shortcuts even in inputs
      const allowedInInputs = [
        e.ctrlKey && e.shiftKey && e.code === 'KeyC',
        e.ctrlKey && !e.shiftKey && e.code === 'KeyS',
        e.ctrlKey && e.shiftKey && e.code === 'KeyE',
        e.code === 'Escape',
      ];
      if (!allowedInInputs.some(Boolean)) {
        return;
      }
    }

    // ? or / — Show shortcuts help
    if ((e.key === '?' || e.key === '/') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      setShowHelp(prev => !prev);
      handler?.('show-shortcuts');
      return;
    }

    // Ctrl+Shift+C — Copy transcript
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      handler?.('copy-transcript');
      return;
    }

    // Ctrl+S — Save transcript
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault();
      handler?.('save-transcript');
      return;
    }

    // Ctrl+Shift+E — Export transcript
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {
      e.preventDefault();
      handler?.('export-transcript');
      return;
    }

    // Ctrl+N — New transcription
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyN') {
      e.preventDefault();
      handler?.('new-transcription');
      return;
    }

    // Ctrl+Z — Undo
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyZ') {
      handler?.('undo');
      return;
    }

    // Ctrl+Shift+Z — Redo
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyZ') {
      handler?.('redo');
      return;
    }

    // Alt + / Alt - — Playback speed
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handler?.('speed-up');
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        handler?.('speed-down');
        return;
      }
    }

    // Escape — Cancel transcription
    if (e.code === 'Escape' && !e.ctrlKey && !e.shiftKey) {
      handler?.('cancel-transcription');
      return;
    }

    // Ctrl+F — Search in transcript (we capture it for our own search)
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      handler?.('search-transcript');
      return;
    }
  }, [handler]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp };
};
