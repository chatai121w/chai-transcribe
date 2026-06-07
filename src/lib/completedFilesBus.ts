/**
 * completedFilesBus — central queue for files produced by conversions and cuts.
 *
 * Items live in-memory (with a File/Blob handle), and a lightweight metadata
 * mirror is persisted to localStorage so the panel state survives a reload
 * (without the blob — the entry shows as "מקור לא זמין" until re-produced).
 */

export type CompletedKind = "convert" | "cut" | "cut+convert";

export interface CompletedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: CompletedKind;
  sourceLabel?: string;
  createdAt: number;
  file?: File; // present only in-memory
}

type Listener = (items: CompletedFile[]) => void;

const STORAGE_KEY = "completedFilesPanel.items.v1";

let items: CompletedFile[] = [];
const listeners = new Set<Listener>();

function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CompletedFile[];
    if (Array.isArray(parsed)) {
      items = parsed.map((p) => ({ ...p, file: undefined })).slice(0, 200);
    }
  } catch {
    /* ignore */
  }
}
loadMeta();

function persistMeta() {
  try {
    const meta = items.map(({ file: _f, ...rest }) => rest).slice(0, 200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    /* quota — ignore */
  }
}

function emit() {
  for (const l of listeners) l(items);
}

export const completedFilesBus = {
  getAll: () => items.slice(),
  subscribe(cb: Listener) {
    listeners.add(cb);
    cb(items);
    return () => listeners.delete(cb);
  },
  push(item: Omit<CompletedFile, "id" | "createdAt"> & { id?: string }) {
    const id = item.id ?? `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // de-dupe by name + size within the last 5s
    const recent = items.find(
      (x) => x.name === item.name && x.size === item.size && Date.now() - x.createdAt < 5000,
    );
    if (recent) {
      if (item.file && !recent.file) recent.file = item.file;
      emit();
      return recent.id;
    }
    const entry: CompletedFile = {
      id,
      name: item.name,
      size: item.size,
      type: item.type,
      kind: item.kind,
      sourceLabel: item.sourceLabel,
      createdAt: Date.now(),
      file: item.file,
    };
    items = [entry, ...items].slice(0, 200);
    persistMeta();
    emit();
    return id;
  },
  remove(ids: string[]) {
    const set = new Set(ids);
    items = items.filter((x) => !set.has(x.id));
    persistMeta();
    emit();
  },
  clear() {
    items = [];
    persistMeta();
    emit();
  },
};

export function pushCompletedFile(
  file: File,
  kind: CompletedKind,
  sourceLabel?: string,
) {
  return completedFilesBus.push({
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    kind,
    sourceLabel,
    file,
  });
}
