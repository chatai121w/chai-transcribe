import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Cloud, Folder, FileAudio, ArrowRight, Loader2, RefreshCw,
  Download, Upload, Search, ChevronLeft, Music
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

interface Props {
  /** Called with downloaded audio File ready to transcribe */
  onImportAudio?: (file: File) => void;
  /** Called when local transcript is dropped onto a Drive folder */
  onDropLocalTranscriptToFolder?: (folder: { id: string | null; name: string }, transcriptId: string) => void;
}

export const GoogleDriveBrowser = ({ onImportAudio, onDropLocalTranscriptToFolder }: Props) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [audioOnly, setAudioOnly] = useState(true);
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

  return (
    <Card dir="rtl" className="border-yellow-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Cloud className="w-5 h-5 text-yellow-600" />
            Google Drive
          </CardTitle>
          <div className="flex gap-2">
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

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-yellow-600" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">
            אין קבצים בתיקייה זו
          </div>
        ) : (
          <ScrollArea className="h-[360px]">
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
              {files.map((f) => {
                const folder = isFolder(f);
                return (
                  <div
                    key={f.id}
                    className={`flex items-center gap-2 p-2 rounded hover:bg-muted group ${dragTargetFolderId === f.id ? 'ring-1 ring-yellow-500 bg-yellow-50/40' : ''}`}
                    draggable={!folder}
                    onDragStart={(e) => {
                      if (folder) return;
                      e.dataTransfer.setData('application/x-sht-drive-file', JSON.stringify({
                        id: f.id,
                        name: f.name,
                        mimeType: f.mimeType,
                      }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDragOver={(e) => {
                      if (!folder || !onDropLocalTranscriptToFolder) return;
                      if (e.dataTransfer.types.includes('application/x-sht-local-transcript-id')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        setDragTargetFolderId(f.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragTargetFolderId === f.id) setDragTargetFolderId(null);
                    }}
                    onDrop={(e) => {
                      if (!folder || !onDropLocalTranscriptToFolder) return;
                      e.preventDefault();
                      setDragTargetFolderId(null);
                      const transcriptId = e.dataTransfer.getData('application/x-sht-local-transcript-id');
                      if (!transcriptId) return;
                      onDropLocalTranscriptToFolder({ id: f.id, name: f.name }, transcriptId);
                    }}
                  >
                    {folder ? (
                      <Folder className="w-5 h-5 text-yellow-600 shrink-0" />
                    ) : (
                      <FileAudio className="w-5 h-5 text-yellow-700 shrink-0" />
                    )}
                    <button
                      onClick={() => folder && openFolder(f)}
                      className="flex-1 text-right truncate text-sm"
                      title={f.name}
                      disabled={!folder && !onImportAudio}
                    >
                      {f.name}
                    </button>
                    {f.size && !folder && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {(parseInt(f.size) / (1024 * 1024)).toFixed(1)}MB
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
              })}
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
