import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, ChevronDown, ChevronLeft, FileText, Folder, FolderOpen, Loader2, Mic2, Pencil, Search, X } from "lucide-react";
import { useFolderTree, type FolderTreeNode } from "@/hooks/useFolderTree";
import { useCloudTranscripts, type CloudTranscript } from "@/hooks/useCloudTranscripts";
import type { TextVersion } from "@/components/TextEditHistory";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface ComparisonSourceDialogProps {
  open: boolean;
  side: "base" | "new";
  versions: TextVersion[];
  transcripts: CloudTranscript[];
  selectedVersionId?: string;
  getVersionLabel: (version: TextVersion) => string;
  onOpenChange: (open: boolean) => void;
  onSelectVersion: (versionId: string) => void;
  onSelectTranscript: (transcript: CloudTranscript) => void;
}

function transcriptText(transcript: CloudTranscript) {
  return transcript.edited_text?.trim() || transcript.text?.trim() || "";
}

function transcriptLabel(transcript: CloudTranscript) {
  return transcript.title?.trim() || transcriptText(transcript).slice(0, 70) || "תמלול ללא שם";
}

export function ComparisonSourceDialog({
  open,
  side,
  versions,
  transcripts,
  selectedVersionId,
  getVersionLabel,
  onOpenChange,
  onSelectVersion,
  onSelectTranscript,
}: ComparisonSourceDialogProps) {
  const { tree, updateFolder } = useFolderTree();
  const { updateTranscript } = useCloudTranscripts();
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ type: "folder" | "transcript"; id: string; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("he");

  const matchingVersions = useMemo(() => versions.filter((version) => (
    !normalizedQuery || getVersionLabel(version).toLocaleLowerCase("he").includes(normalizedQuery)
  )), [getVersionLabel, normalizedQuery, versions]);

  const usableTranscripts = useMemo(() => transcripts.filter((transcript) => {
    if (!transcriptText(transcript)) return false;
    if (!normalizedQuery) return true;
    return `${transcriptLabel(transcript)} ${transcript.engine || ""} ${transcript.folder || ""}`
      .toLocaleLowerCase("he")
      .includes(normalizedQuery);
  }), [normalizedQuery, transcripts]);

  const byFolder = useMemo(() => {
    const map = new Map<string | null, CloudTranscript[]>();
    for (const transcript of usableTranscripts) {
      const key = transcript.folder_id || null;
      map.set(key, [...(map.get(key) || []), transcript]);
    }
    return map;
  }, [usableTranscripts]);

  const folderHasMatches = (node: FolderTreeNode): boolean => (
    Boolean(byFolder.get(node.id)?.length) || node.children.some(folderHasMatches)
  );

  const selectVersion = (versionId: string) => {
    onSelectVersion(versionId);
    onOpenChange(false);
  };

  const selectTranscript = (transcript: CloudTranscript) => {
    onSelectTranscript(transcript);
    onOpenChange(false);
  };

  const saveEdit = async () => {
    if (!editing || savingEdit) return;
    const value = editing.value.trim();
    if (!value) {
      toast({ title: "השם לא יכול להיות ריק", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    try {
      if (editing.type === "folder") await updateFolder(editing.id, { name: value });
      else await updateTranscript(editing.id, { title: value });
      setEditing(null);
      toast({ title: editing.type === "folder" ? "שם התיקייה נשמר" : "שם ההקלטה נשמר" });
    } catch (error) {
      toast({
        title: "שמירת השם נכשלה",
        description: error instanceof Error ? error.message : "נסה שוב",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const editControls = (type: "folder" | "transcript", id: string, label: string) => {
    const isEditing = editing?.type === type && editing.id === id;
    if (!isEditing) {
      return (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          aria-label={type === "folder" ? "ערוך שם תיקייה" : "ערוך שם הקלטה"}
          onClick={(event) => {
            event.stopPropagation();
            setEditing({ type, id, value: label });
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      );
    }

    return (
      <div className="flex min-w-0 flex-1 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <Input
          autoFocus
          dir="rtl"
          value={editing.value}
          aria-label={`שם ${type === "folder" ? "התיקייה" : "ההקלטה"}`}
          className="h-8 min-w-0 flex-1 text-right"
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveEdit();
            if (event.key === "Escape") setEditing(null);
          }}
        />
        <Button type="button" size="icon" className="h-8 w-8" aria-label="שמור שם" disabled={savingEdit} onClick={() => void saveEdit()}>
          {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="בטל עריכת שם" disabled={savingEdit} onClick={() => setEditing(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const renderTranscript = (transcript: CloudTranscript) => {
    const label = transcriptLabel(transcript);
    const isEditing = editing?.type === "transcript" && editing.id === transcript.id;
    return (
    <div
      key={transcript.id}
      dir="rtl"
      className="flex w-full min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-2 text-right hover:border-primary/50 hover:bg-muted/40"
    >
      {!isEditing && (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => selectTranscript(transcript)}>
          <Mic2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{label}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {transcript.engine || "לא ידוע"} · {new Date(transcript.updated_at || transcript.created_at).toLocaleDateString("he-IL")}
            </span>
          </span>
        </button>
      )}
      {editControls("transcript", transcript.id, label)}
    </div>
  );
  };

  const renderFolder = (node: FolderTreeNode) => {
    if (!folderHasMatches(node)) return null;
    const isOpen = normalizedQuery ? true : openFolders.has(node.id);
    const items = byFolder.get(node.id) || [];
    return (
      <div key={node.id} style={{ paddingInlineStart: `${node.depth * 14}px` }}>
        <div dir="rtl" className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-right text-sm font-medium hover:bg-muted">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-right"
            onClick={() => setOpenFolders((previous) => {
            const next = new Set(previous);
            if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
            return next;
            })}
          >
            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
            {isOpen ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
            {editing?.type !== "folder" || editing.id !== node.id ? <span className="truncate">{node.emoji ? `${node.emoji} ` : ""}{node.name}</span> : null}
            <Badge variant="secondary" className="me-auto h-5 text-[10px]">{items.length}</Badge>
          </button>
          {editControls("folder", node.id, node.name)}
        </div>
        {isOpen && (
          <div className="space-y-1 pb-2 pe-5">
            {items.map(renderTranscript)}
            {node.children.map(renderFolder)}
          </div>
        )}
      </div>
    );
  };

  const uncategorized = byFolder.get(null) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl gap-0 overflow-hidden p-0 text-right" data-testid="comparison-source-dialog">
        <DialogHeader className="border-b px-5 py-4 text-right">
          <DialogTitle>בחירת {side === "base" ? "גרסת בסיס" : "גרסה חדשה"}</DialogTitle>
          <p className="text-xs text-muted-foreground">בחר גרסה קיימת או תמלול מסווג מתוך עץ התיקיות.</p>
        </DialogHeader>

        <div className="border-b px-5 py-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חפש לפי שם, תיקייה או מנוע..."
              className="pe-9 text-right"
              aria-label="חיפוש מקור להשוואה"
            />
          </div>
        </div>

        <Tabs defaultValue="folders" dir="rtl" className="min-h-0">
          <TabsList className="mx-5 mt-3 grid w-[calc(100%-2.5rem)] grid-cols-2">
            <TabsTrigger value="folders">תיקיות והקלטות</TabsTrigger>
            <TabsTrigger value="versions">גרסאות קיימות</TabsTrigger>
          </TabsList>

          <TabsContent value="folders" className="m-0 px-5 pb-5 pt-3">
            <ScrollArea className="h-[min(55vh,28rem)] rounded-md border p-2">
              <div className="space-y-1">
                {tree.map(renderFolder)}
                {uncategorized.length > 0 && (
                  <div className="rounded-md border border-dashed p-2">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Folder className="h-4 w-4" /> ללא תיקייה</p>
                    <div className="space-y-1">{uncategorized.map(renderTranscript)}</div>
                  </div>
                )}
                {!usableTranscripts.length && <p className="p-8 text-center text-sm text-muted-foreground">לא נמצאו תמלולים מתאימים.</p>}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="versions" className="m-0 px-5 pb-5 pt-3">
            <ScrollArea className="h-[min(55vh,28rem)] rounded-md border p-2">
              <div className="space-y-1">
                {matchingVersions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-right hover:border-primary/50 hover:bg-muted/40",
                      selectedVersionId === version.id && "border-primary bg-primary/5",
                    )}
                    onClick={() => selectVersion(version.id)}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">{getVersionLabel(version)}</span>
                    {selectedVersionId === version.id && <Badge>נבחר</Badge>}
                  </button>
                ))}
                {!matchingVersions.length && <p className="p-8 text-center text-sm text-muted-foreground">לא נמצאו גרסאות מתאימות.</p>}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
