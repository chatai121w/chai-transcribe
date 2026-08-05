import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Clock, FileText, Trash2, ArrowLeft, ListChecks, CheckCheck, X } from "lucide-react";

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

  const removeEntries = useCallback((ids: Iterable<string>) => {
    const idsToRemove = new Set(ids);
    const updated = loadRecent().filter(e => !idsToRemove.has(e.id));
    saveRecent(updated);
    setEntries(updated);
  }, []);

  return { entries, refresh, clearAll, removeEntry, removeEntries };
}

/** Dashboard widget showing recent files */
export const RecentFilesWidget = () => {
  const { entries, clearAll, removeEntry, removeEntries } = useRecentFiles();
  const navigate = useNavigate();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  if (entries.length === 0) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

  const visibleEntries = entries.slice(0, 8);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every(entry => selectedIds.has(entry.id));
  const toggleSelectionMode = () => {
    if (selectionMode) setSelectedIds(new Set());
    setSelectionMode(!selectionMode);
  };
  const toggleEntry = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleEntries.map(entry => entry.id)));
  const deleteSelected = () => {
    removeEntries(selectedIds);
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">קבצים אחרונים</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={selectionMode ? "secondary" : "outline"}
              size="icon"
              className="h-8 w-8"
              onClick={toggleSelectionMode}
              title={selectionMode ? "סגור בחירה מרובה" : "בחירה מרובה"}
              aria-label={selectionMode ? "סגור בחירה מרובה בקבצים אחרונים" : "בחירה מרובה בקבצים אחרונים"}
            >
              {selectionMode ? <X className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={clearAll}>
              <Trash2 className="w-3 h-3 ml-1" />
              נקה היסטוריה
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {selectionMode && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/35 p-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={toggleAll}>
                <CheckCheck className="ml-1 h-4 w-4" />{allVisibleSelected ? 'בטל בחירת הכל' : 'בחר הכל'}
              </Button>
              <Badge variant="secondary">{selectedIds.size} נבחרו</Badge>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={selectedIds.size === 0}>
                  <Trash2 className="ml-1 h-4 w-4" />מחיקה
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>להסיר {selectedIds.size} פריטים מההיסטוריה?</AlertDialogTitle>
                  <AlertDialogDescription>הקבצים עצמם לא יימחקו. רק הרשומות שלהם יוסרו מהווידג'ט.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteSelected}>
                    הסר מההיסטוריה
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        {visibleEntries.map(entry => (
          <div
            key={entry.id}
            className={`flex items-center justify-between p-2 rounded-md border hover:bg-muted/50 cursor-pointer transition-colors group ${selectedIds.has(entry.id) ? 'border-primary bg-primary/5 ring-1 ring-primary' : ''}`}
            onClick={() => selectionMode ? toggleEntry(entry.id) : navigate("/text-editor", { state: { text: entry.preview } })}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {selectionMode && (
                <div onClick={event => event.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(entry.id)} onCheckedChange={() => toggleEntry(entry.id)} aria-label={`בחר ${entry.fileName}`} />
                </div>
              )}
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{entry.fileName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {entry.engine} · {entry.wordCount} מילים · {formatDate(entry.createdAt)}
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-1 transition-opacity ${selectionMode ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
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
