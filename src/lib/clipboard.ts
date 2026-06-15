// Simple in-memory clipboard for the file manager
type ClipboardItem = { kind: 'folder' | 'transcript'; id: string };

export type ClipboardMode = 'copy' | 'cut' | null;

let _items: ClipboardItem[] = [];
let _mode: ClipboardMode = null;
const listeners = new Set<() => void>();

export const fileClipboard = {
  set(items: ClipboardItem[], mode: 'copy' | 'cut') {
    _items = [...items];
    _mode = mode;
    listeners.forEach(l => l());
  },
  clear() {
    _items = [];
    _mode = null;
    listeners.forEach(l => l());
  },
  get items() { return _items; },
  get mode() { return _mode; },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
