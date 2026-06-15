import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, FileText, Trash2, ArrowLeft } from "lucide-react";

export interface RecentFileEntry {
  id: string;
  fileName: string;
  engine: string;
  wordCount: number;
  charCount: number;
  createdAt: number;
  preview: string; // first 120 chars
}

const STORAGE_KEY = "recent_files_history";
const MAX_ENTRIES = 15;

function loadRecent(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentFileEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

/** Add a recent file entry (call after transcription completes) */
export function addRecentFile(entry: Omit<RecentFileEntry, "id" | "createdAt">) {
  const entries = loadRecent();
  const newEntry: RecentFileEntry = {
    ...entry,
    id: `rf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };
  // Deduplicate by fileName + engine combo
  const filtered = entries.filter(
    e => !(e.fileName === entry.fileName && e.engine === entry.engine)
  );
  saveRecent([newEntry, ...filtered]);
}

export function useRecentFiles() {
  const [entries, setEntries] = useState<RecentFileEntry[]>(loadRecent);

  // Refresh on storage changes (cross-tab)
  useEffect(() => {
    const handler = () => setEntries(loadRecent());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const refresh = useCallback(() => setEntries(loadRecent()), []);

  const clearAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEntries([]);
  }, []);

  const removeEntry = useCallback((id: string) => {
    const updated = loadRecent().filter(e => e.id !== id);
    saveRecent(updated);
    setEntries(updated);
  }, []);

  return { entries, refresh, clearAll, removeEntry };
}

/** Dashboard widget showing recent files */
export const RecentFilesWidget = () => {
  const { entries, clearAll, removeEntry } = useRecentFiles();
  const navigate = useNavigate();

  if (entries.length === 0) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">קבצים אחרונים</CardTitle>
          </div>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={clearAll}>
            <Trash2 className="w-3 h-3 ml-1" />
            נקה היסטוריה
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.slice(0, 8).map(entry => (
          <div
            key={entry.id}
            className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50 cursor-pointer transition-colors group"
            onClick={() => navigate("/text-editor", { state: { text: entry.preview } })}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{entry.fileName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {entry.engine} · {entry.wordCount} מילים · {formatDate(entry.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive"
                onClick={e => { e.stopPropagation(); removeEntry(entry.id); }}
                title="הסר"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
