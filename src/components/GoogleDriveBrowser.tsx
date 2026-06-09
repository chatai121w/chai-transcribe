import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Cloud, Folder, FileAudio, ArrowRight, Loader2, RefreshCw,
  Download, Search, ChevronLeft, Music, Rows3, LayoutGrid, Table2
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

type DriveViewMode = "list" | "grid" | "table";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

interface CrumbItem { id: string | null; name: string; }

export type LocalDragItem = {
  kind: 'transcript' | 'folder';
  id: string;
  name?: string;
};

interface Props {
  /** Called with downloaded audio File ready to transcribe */
  onImportAudio?: (file: File) => void;
  /** Called when a local item (folder/transcript) is dropped onto a Drive folder */
  onDropLocalItemToFolder?: (folder: { id: string | null; name: string }, item: LocalDragItem) => void;
}

export const GoogleDriveBrowser = ({ onImportAudio, onDropLocalItemToFolder }: Props) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [audioOnly, setAudioOnly] = useState(true);
  const [viewMode, setViewMode] = useState<DriveViewMode>(() => {
    try {
      const v = localStorage.getItem("fm_drive_view_mode");
      return v === "list" || v === "table" || v === "grid" ? v : "list";
    } catch {
      return "list";
    }
  });
  const [crumbs, setCrumbs] = useState<CrumbItem[]>([{ id: null, name: "הדרייב שלי" }]);
  const [dragTargetFolderId, setDragTargetFolderId] = useState<string | null>(null);

  const currentFolder = crumbs[crumbs.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-drive", {
        body: {
          action: "list",
          folderId: currentFolder.id,
          query: search || undefined,
          audioOnly,
          pageSize: 100,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setFiles(data?.files || []);
    } catch (e: any) {
      toast({ title: "שגיאה בטעינת Google Drive", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentFolder.id, search, audioOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    try { localStorage.setItem("fm_drive_view_mode", viewMode); } catch {}
  }, [viewMode]);

  const openFolder = (f: DriveFile) => {
    setCrumbs([...crumbs, { id: f.id, name: f.name }]);
  };
  const goUp = () => { if (crumbs.length > 1) setCrumbs(crumbs.slice(0, -1)); };
  const goTo = (i: number) => setCrumbs(crumbs.slice(0, i + 1));

  const importFile = async (f: DriveFile) => {
    if (!onImportAudio) return;
    setImporting(f.id);
    try {
      const { data, error } = await supabase.functions.invoke("google-drive", {
        body: { action: "download", fileId: f.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const bin = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const file = new File([bin], f.name, { type: data.contentType || f.mimeType });
      onImportAudio(file);
      toast({ title: "✅ ייובא מ-Google Drive", description: f.name });
    } catch (e: any) {
      toast({ title: "שגיאת ייבוא", description: e.message, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  };

  const isFolder = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder";
  const cycleViewMode = () => setViewMode((prev) => (prev === "list" ? "grid" : prev === "grid" ? "table" : "list"));
  const ViewIcon = viewMode === "list" ? Rows3 : viewMode === "grid" ? LayoutGrid : Table2;
  const viewLabel = viewMode === "list" ? "רשימה" : viewMode === "grid" ? "רשת" : "טבלה";
  const formatSize = (size?: string) => size ? `${(parseInt(size, 10) / (1024 * 1024)).toFixed(1)}MB` : "-";

  const renderDriveEntry = (f: DriveFile, mode: DriveViewMode) => {
    const folder = isFolder(f);
    const isDragTarget = dragTargetFolderId === f.id;
    const commonDragProps = {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        if (folder) {
          e.dataTransfer.setData(
            'application/x-sht-drive-folder',
            JSON.stringify({ id: f.id, name: f.name }),
          );
        } else {
          e.dataTransfer.setData(
            'application/x-sht-drive-file',
            JSON.stringify({ id: f.id, name: f.name, mimeType: f.mimeType }),
          );
        }
        e.dataTransfer.effectAllowed = 'copy';
      },
      onDragOver: (e: React.DragEvent) => {
        if (!folder || !onDropLocalItemToFolder) return;
        if (
          e.dataTransfer.types.includes('application/x-sht-local-item') ||
          e.dataTransfer.types.includes('application/x-sht-local-transcript-id')
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragTargetFolderId(f.id);
        }
      },
      onDragLeave: () => {
        if (isDragTarget) setDragTargetFolderId(null);
      },
      onDrop: (e: React.DragEvent) => {
        if (!folder || !onDropLocalItemToFolder) return;
        e.preventDefault();
        setDragTargetFolderId(null);
        const rawItem = e.dataTransfer.getData('application/x-sht-local-item');
        if (rawItem) {
          try {
            const item = JSON.parse(rawItem) as LocalDragItem;
            if (item?.id && (item.kind === 'folder' || item.kind === 'transcript')) {
              onDropLocalItemToFolder({ id: f.id, name: f.name }, item);
              return;
            }
          } catch {
            // ignore and fallback
          }
        }
        const transcriptId = e.dataTransfer.getData('application/x-sht-local-transcript-id');
        if (!transcriptId) return;
        onDropLocalItemToFolder({ id: f.id, name: f.name }, { kind: 'transcript', id: transcriptId });
      },
    };

    if (mode === "grid") {
      return (
        <div
          key={f.id}
          className={`rounded-lg border p-2 space-y-2 hover:bg-muted/50 group ${isDragTarget ? 'ring-1 ring-yellow-500 bg-yellow-50/40' : ''}`}
          {...commonDragProps}
        >
          <div className="flex items-center justify-end gap-2 min-w-0" dir="rtl">
            {folder ? (
              <Folder className="w-5 h-5 text-yellow-600 shrink-0" />
            ) : (
              <FileAudio className="w-5 h-5 text-yellow-700 shrink-0" />
            )}
            <button
              onClick={() => folder && openFolder(f)}
              className="block flex-1 w-full text-right truncate text-sm"
              title={f.name}
            >
              {f.name}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary" className="text-[10px]">{folder ? 'תיקייה' : formatSize(f.size)}</Badge>
            {!folder && onImportAudio && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => importFile(f)}
                disabled={importing === f.id}
                className="gap-1 opacity-0 group-hover:opacity-100 transition"
              >
                {importing === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (mode === "table") {
      return (
        <div
          key={f.id}
          dir="rtl"
          className={`grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-xs text-right border-t border-border/40 hover:bg-muted/50 group ${isDragTarget ? 'ring-1 ring-yellow-500 bg-yellow-50/40' : ''}`}
          {...commonDragProps}
        >
          <div className="flex items-center justify-end gap-2 min-w-0 text-right" dir="rtl">
            {folder ? (
              <Folder className="w-4 h-4 text-yellow-600 shrink-0" />
            ) : (
              <FileAudio className="w-4 h-4 text-yellow-700 shrink-0" />
            )}
            <button
              onClick={() => folder && openFolder(f)}
              className="block w-full truncate text-right"
              title={f.name}
            >
              {f.name}
            </button>
          </div>
          <div className="text-muted-foreground truncate text-right">{folder ? 'תיקייה' : formatSize(f.size)}</div>
          <div className="flex items-center justify-end">
            {!folder && onImportAudio && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => importFile(f)}
                disabled={importing === f.id}
                className="gap-1"
              >
                {importing === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        key={f.id}
        className={`flex items-center gap-2 p-2 rounded hover:bg-muted group ${isDragTarget ? 'ring-1 ring-yellow-500 bg-yellow-50/40' : ''}`}
        {...commonDragProps}
        dir="rtl"
      >
        {folder ? (
          <Folder className="w-5 h-5 text-yellow-600 shrink-0" />
        ) : (
          <FileAudio className="w-5 h-5 text-yellow-700 shrink-0" />
        )}
        <button
          onClick={() => folder && openFolder(f)}
          className="block flex-1 w-full text-right truncate text-sm"
          title={f.name}
          disabled={!folder && !onImportAudio}
        >
          {f.name}
        </button>
        {f.size && !folder && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {formatSize(f.size)}
          </Badge>
        )}
        {!folder && onImportAudio && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => importFile(f)}
            disabled={importing === f.id}
            className="gap-1 opacity-0 group-hover:opacity-100 transition"
          >
            {importing === f.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Download className="w-4 h-4" />
                ייבא לתמלול
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card dir="rtl" className="border-yellow-500/30 text-right [direction:rtl]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Cloud className="w-5 h-5 text-yellow-600" />
            Google Drive
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={cycleViewMode}
              title={`תצוגת עמודה מפוצלת: ${viewLabel}`}
              className="h-9 w-9"
            >
              <ViewIcon className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant={audioOnly ? "default" : "outline"}
              onClick={() => setAudioOnly(v => !v)}
              className="gap-1"
            >
              <Music className="w-4 h-4" />
              רק אודיו
            </Button>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-wrap text-sm mt-2">
          {crumbs.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <button
                onClick={() => goTo(i)}
                className="text-yellow-700 hover:underline"
                disabled={i === crumbs.length - 1}
              >
                {c.name}
              </button>
              {i < crumbs.length - 1 && <ChevronLeft className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש שם קובץ..."
            className="pr-9 text-right"
          />
        </div>
      </CardHeader>

      <CardContent className="text-right" dir="rtl">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-yellow-600" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">
            אין קבצים בתיקייה זו
          </div>
        ) : (
          <ScrollArea className="h-[360px]" dir="rtl">
            <div className="space-y-1">
              {crumbs.length > 1 && (
                <button
                  onClick={goUp}
                  className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted text-right"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span className="text-sm text-muted-foreground">חזרה אחורה</span>
                </button>
              )}
              {viewMode === "grid" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {files.map((f) => renderDriveEntry(f, "grid"))}
                </div>
              )}
              {viewMode === "list" && (
                <div className="space-y-1">
                  {files.map((f) => renderDriveEntry(f, "list"))}
                </div>
              )}
              {viewMode === "table" && (
                <div className="rounded-lg border border-border/60 overflow-hidden bg-background" dir="rtl">
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground bg-muted/30 text-right">
                    <div>שם</div>
                    <div>סוג / גודל</div>
                    <div className="text-right">פעולות</div>
                  </div>
                  {files.map((f) => renderDriveEntry(f, "table"))}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

/** Upload a text/blob file to Drive */
export async function uploadToDrive(opts: {
  name: string;
  mimeType?: string;
  content: string | Blob;
  parents?: string[];
}) {
  let base64: string;
  if (typeof opts.content === "string") {
    base64 = btoa(unescape(encodeURIComponent(opts.content)));
  } else {
    const buf = await opts.content.arrayBuffer();
    base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  const { data, error } = await supabase.functions.invoke("google-drive", {
    body: {
      action: "upload",
      name: opts.name,
      mimeType: opts.mimeType || "text/plain",
      base64,
      parents: opts.parents,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { id: string; name: string; webViewLink?: string };
}
