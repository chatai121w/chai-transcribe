import { type ReactNode, useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarClock, Check, ChevronDown, ChevronLeft, CircleAlert, Cloud, Cpu, Folder, FolderOpen, FolderPlus, GripVertical, HardDrive, Hash, Languages, Loader2, Mic2, Pencil, Plus, Search, X } from "lucide-react";
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
  purpose?: "comparison" | "audio";
  dialogTitle?: string;
  dialogDescription?: string;
}

function transcriptText(transcript: CloudTranscript) {
  return transcript.edited_text?.trim() || transcript.text?.trim() || "";
}

function transcriptLabel(transcript: CloudTranscript) {
  return transcript.title?.trim() || transcriptText(transcript).slice(0, 70) || "תמלול ללא שם";
}

const VERSION_SOURCE_LABELS: Record<TextVersion["source"], string> = {
  original: "תמלול ראשון",
  manual: "עריכה ידנית",
  "ai-improve": "שיפור ניסוח",
  "ai-sources": "הוספת מקורות",
  "ai-readable": "שיפור קריאות",
  "ai-custom": "עיבוד AI מותאם",
  "ai-fix": "תיקון AI",
  "ai-grammar": "דקדוק ואיות",
  "ai-punctuation": "פיסוק",
  "ai-paragraphs": "חלוקה לפסקאות",
  "ai-bullets": "תבליטים",
  "ai-headings": "כותרות",
  "ai-expand": "הרחבה",
  "ai-shorten": "קיצור",
  "ai-summarize": "סיכום",
  "ai-translate": "תרגום",
  "ai-speakers": "זיהוי דוברים",
  "ai-tone": "שינוי טון",
};

function legacyEngineLabel(version: TextVersion): string | null {
  if (version.engineLabel?.trim()) return version.engineLabel.trim();
  const prompt = version.customPrompt?.trim() || "";
  const knownEngine = prompt.match(/(?:^|•\s*)((?:Local CUDA|Gemini|Groq(?: Whisper)?|OpenAI(?: Whisper)?|AssemblyAI|Deepgram|Google Speech-to-Text|Whisper)[^•]*)/i);
  return knownEngine?.[1]?.trim() || null;
}

function splitEngineLabel(value: string | null): { engine: string; model: string | null; detail: string | null } {
  if (!value) return { engine: "המנוע לא נשמר", model: null, detail: null };
  const normalizedEngines: Record<string, string> = {
    openai: "OpenAI Whisper",
    groq: "Groq Whisper",
    google: "Google Speech-to-Text",
    assemblyai: "AssemblyAI",
    deepgram: "Deepgram",
    gemini: "Gemini",
    "local-server": "Local CUDA",
    local: "Whisper בדפדפן",
  };
  const normalizedValue = normalizedEngines[value.toLocaleLowerCase()] || value;
  const match = normalizedValue.match(/^([^()]+?)\s*\((.+)\)$/);
  if (!match) return { engine: normalizedValue, model: null, detail: null };
  const inner = match[2].trim();
  const [model, ...details] = inner.split(",").map((part) => part.trim()).filter(Boolean);
  return { engine: match[1].trim(), model: model || null, detail: details.join(" · ") || null };
}

function languageLabel(value?: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = { he: "עברית", hebrew: "עברית", en: "אנגלית", english: "אנגלית", auto: "זיהוי אוטומטי" };
  return labels[value.toLocaleLowerCase()] || value;
}

function formatVersionDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value.getTime() <= 0) return "תאריך לא נשמר";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

interface ManagedFolderRowProps {
  node: FolderTreeNode;
  isOpen: boolean;
  count: number;
  editing: boolean;
  editControl: ReactNode;
  children: ReactNode;
  onToggle: () => void;
  onCreateChild: () => void;
}

function ManagedFolderRow({ node, isOpen, count, editing, editControl, children, onToggle, onCreateChild }: ManagedFolderRowProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `comparison-folder-${node.id}`, data: { folderId: node.id } });
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: `comparison-drag-folder-${node.id}`,
    data: { folderId: node.id },
  });

  return (
    <div style={{ paddingInlineStart: `${node.depth * 14}px` }}>
      <div
        ref={setDropRef}
        dir="rtl"
        className={cn(
          "group flex w-full items-center gap-1 rounded-md px-1 py-1 text-right text-sm font-medium transition-colors hover:bg-muted",
          isOver && "bg-primary/10 ring-2 ring-primary/60",
          isDragging && "opacity-50",
        )}
        data-testid={`comparison-folder-${node.id}`}
      >
        <button ref={setDragRef} type="button" className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-background active:cursor-grabbing" aria-label={`גרור את ${node.name}`} {...listeners} {...attributes}>
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-right"
          aria-label={`${isOpen ? "סגור" : "פתח"} את תיקיית ${node.name}`}
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
          {isOpen ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
          {!editing && <span className="truncate">{node.emoji ? `${node.emoji} ` : ""}{node.name}</span>}
          <Badge variant="secondary" className="me-auto h-5 text-[10px]">{count}</Badge>
        </button>
        {editControl}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`צור תת-תיקייה בתוך ${node.name}`}
          title="צור תת-תיקייה"
          onClick={onCreateChild}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function RootFolderDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "comparison-folder-root", data: { folderId: null } });
  return (
    <div ref={setNodeRef} className={cn("min-h-full space-y-1 rounded", isOver && "bg-primary/5 ring-2 ring-inset ring-primary/50")}>
      {children}
    </div>
  );
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
  purpose = "comparison",
  dialogTitle,
  dialogDescription,
}: ComparisonSourceDialogProps) {
  const { tree, createFolder, updateFolder, moveFolder } = useFolderTree();
  const { updateTranscript } = useCloudTranscripts();
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ type: "folder" | "transcript"; id: string; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const normalizedQuery = query.trim().toLocaleLowerCase("he");

  const matchingVersions = useMemo(() => versions.filter((version) => {
    if (!normalizedQuery) return true;
    return [
      getVersionLabel(version),
      legacyEngineLabel(version),
      version.actionLabel,
      version.detectedLanguage,
      ...(version.duplicateEngines || []),
    ].filter(Boolean).join(" ").toLocaleLowerCase("he").includes(normalizedQuery);
  }), [getVersionLabel, normalizedQuery, versions]);

  const usableTranscripts = useMemo(() => transcripts.filter((transcript) => {
    if (purpose === "audio") {
      if (!transcript.audio_file_path && !transcript.audio_blob) return false;
    } else if (!transcriptText(transcript)) return false;
    if (!normalizedQuery) return true;
    return `${transcriptLabel(transcript)} ${transcript.engine || ""} ${transcript.folder || ""}`
      .toLocaleLowerCase("he")
      .includes(normalizedQuery);
  }), [normalizedQuery, purpose, transcripts]);

  const byFolder = useMemo(() => {
    const map = new Map<string | null, CloudTranscript[]>();
    for (const transcript of usableTranscripts) {
      const key = transcript.folder_id || null;
      map.set(key, [...(map.get(key) || []), transcript]);
    }
    return map;
  }, [usableTranscripts]);

  const folderHasMatches = (node: FolderTreeNode): boolean => {
    if (!normalizedQuery) return true;
    return node.name.toLocaleLowerCase("he").includes(normalizedQuery)
      || Boolean(byFolder.get(node.id)?.length)
      || node.children.some(folderHasMatches);
  };

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

  const beginCreateFolder = (parentId: string | null) => {
    setCreatingParentId(parentId);
    setNewFolderName("");
    if (parentId) setOpenFolders((previous) => new Set(previous).add(parentId));
  };

  const saveNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingParentId === undefined || creatingFolder) return;
    setCreatingFolder(true);
    try {
      await createFolder({ name, parent_id: creatingParentId });
      setCreatingParentId(undefined);
      setNewFolderName("");
      toast({ title: creatingParentId ? "תת-התיקייה נוצרה" : "התיקייה נוצרה" });
    } catch (error) {
      toast({ title: "יצירת התיקייה נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
    } finally {
      setCreatingFolder(false);
    }
  };

  const creationRow = (parentId: string | null) => creatingParentId === parentId ? (
    <div dir="rtl" className="flex items-center gap-1 px-2 py-1" data-testid={parentId ? `create-child-${parentId}` : "create-root-folder"}>
      <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
      <Input
        autoFocus
        dir="rtl"
        value={newFolderName}
        className="h-8 min-w-0 flex-1 text-right"
        placeholder={parentId ? "שם תת-התיקייה" : "שם התיקייה החדשה"}
        aria-label={parentId ? "שם תת-תיקייה חדשה" : "שם תיקייה ראשית חדשה"}
        onChange={(event) => setNewFolderName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void saveNewFolder();
          if (event.key === "Escape") setCreatingParentId(undefined);
        }}
      />
      <Button type="button" size="icon" className="h-8 w-8" aria-label="שמור תיקייה חדשה" disabled={!newFolderName.trim() || creatingFolder} onClick={() => void saveNewFolder()}>
        {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="בטל יצירת תיקייה" disabled={creatingFolder} onClick={() => setCreatingParentId(undefined)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ) : null;

  const handleFolderDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const folderId = active.data.current?.folderId as string | undefined;
    const parentId = (over.data.current?.folderId ?? null) as string | null;
    if (!folderId || folderId === parentId) return;
    try {
      await moveFolder(folderId, parentId);
      if (parentId) setOpenFolders((previous) => new Set(previous).add(parentId));
      toast({ title: parentId ? "התיקייה הועברה" : "התיקייה הועברה לרמה הראשית" });
    } catch (error) {
      toast({ title: "העברת התיקייה נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
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
              {purpose === "audio" ? " · כולל אודיו" : ""}
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
      <ManagedFolderRow
        key={node.id}
        node={node}
        isOpen={isOpen}
        count={items.length}
        editing={editing?.type === "folder" && editing.id === node.id}
        editControl={editControls("folder", node.id, node.name)}
        onCreateChild={() => beginCreateFolder(node.id)}
        onToggle={() => setOpenFolders((previous) => {
            const next = new Set(previous);
            if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
            return next;
        })}
      >
        {creationRow(node.id)}
        {isOpen && (
          <div className="space-y-1 pb-2 pe-5">
            {items.map(renderTranscript)}
            {node.children.map(renderFolder)}
          </div>
        )}
      </ManagedFolderRow>
    );
  };

  const uncategorized = byFolder.get(null) || [];

  const renderVersion = (version: TextVersion) => {
    const rawEngine = legacyEngineLabel(version);
    const { engine, model, detail } = splitEngineLabel(rawEngine);
    const isMissingEngine = !rawEngine;
    const action = version.actionLabel?.trim() || VERSION_SOURCE_LABELS[version.source];
    const words = version.wordCount ?? version.text.split(/\s+/).filter(Boolean).length;
    const language = languageLabel(version.detectedLanguage);
    const duplicateEngines = Array.from(new Set(version.duplicateEngines || []));
    const storageLabel = version.storage === "local" ? "מקומי" : version.storage === "cloud" ? "ענן" : "מיקום לא נשמר";

    return (
      <button
        key={version.id}
        type="button"
        dir="rtl"
        data-testid={`comparison-version-${version.id}`}
        className={cn(
          "w-full rounded-md border bg-background p-3 text-right transition-colors hover:border-primary/60 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          selectedVersionId === version.id && "border-primary bg-primary/5 ring-1 ring-primary/30",
        )}
        aria-label={`בחר ${engine}${model ? `, מודל ${model}` : ""}, ${action}`}
        onClick={() => selectVersion(version.id)}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40",
              isMissingEngine && "border-amber-300 bg-amber-50 text-amber-800",
            )}>
              {isMissingEngine ? <CircleAlert className="h-4 w-4" /> : <Cpu className="h-4 w-4 text-primary" />}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm font-semibold", isMissingEngine && "text-amber-800")}>{engine}</span>
              {model && (
                <span className="mt-1 block break-all rounded border bg-muted/50 px-2 py-1 font-mono text-[11px] leading-5 text-foreground" dir="ltr">
                  {model}
                </span>
              )}
              {detail && <span className="mt-1 block text-[11px] text-muted-foreground">{detail}</span>}
            </span>
          </div>
          {selectedVersionId === version.id && <Badge className="shrink-0">נבחר</Badge>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">{action}</Badge>
          <Badge variant="outline" className="gap-1 font-normal">
            {version.storage === "local" ? <HardDrive className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
            {storageLabel}
          </Badge>
          {(version.runCount || 0) > 1 && <Badge variant="outline" className="font-normal">{version.runCount} הרצות עם טקסט זהה</Badge>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatVersionDate(version.timestamp)}</span>
          {language && <span className="inline-flex items-center gap-1"><Languages className="h-3.5 w-3.5" />{language}</span>}
          <span className="inline-flex items-center gap-1"><Hash className="h-3.5 w-3.5" />{words.toLocaleString("he-IL")} מילים</span>
        </div>

        {duplicateEngines.length > 1 && (
          <div className="mt-2 rounded-md border border-dashed bg-muted/20 px-2.5 py-2">
            <span className="block text-[11px] font-medium">אותו טקסט הופק גם באמצעות:</span>
            <span className="mt-1.5 flex flex-wrap gap-1">
              {duplicateEngines.map((duplicateEngine) => (
                <Badge key={duplicateEngine} variant="outline" className="max-w-full font-normal">
                  <span className="truncate" title={duplicateEngine}>{duplicateEngine}</span>
                </Badge>
              ))}
            </span>
          </div>
        )}
      </button>
    );
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent hideOverlay dir="rtl" className="!left-auto !right-4 !top-20 !w-[min(42rem,calc(100vw-2rem))] !max-w-none !translate-x-0 !translate-y-0 max-h-[calc(100vh-6rem)] gap-0 overflow-hidden p-0 text-right shadow-2xl sm:rounded-lg" data-testid="comparison-source-dialog">
        <DialogHeader className="border-b px-5 py-4 text-right">
          <DialogTitle>{dialogTitle || `בחירת ${side === "base" ? "גרסת בסיס" : "גרסה חדשה"}`}</DialogTitle>
          <p className="text-xs text-muted-foreground">{dialogDescription || "בחר גרסה קיימת או תמלול מסווג מתוך עץ התיקיות."}</p>
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

        {purpose === "audio" ? (
          <div className="min-h-0 px-5 pb-5 pt-3">
            <div className="mb-2 flex justify-start">
              <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => beginCreateFolder(null)}>
                <FolderPlus className="h-4 w-4" /> תיקייה חדשה
              </Button>
            </div>
            <ScrollArea className="h-[min(65vh,34rem)] rounded-md border p-2">
              <DndContext sensors={sensors} onDragEnd={(event) => void handleFolderDragEnd(event)}>
                <RootFolderDropZone>
                  {creationRow(null)}
                  {tree.map(renderFolder)}
                  {uncategorized.length > 0 && (
                    <div className="rounded-md border border-dashed p-2">
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Folder className="h-4 w-4" /> ללא תיקייה</p>
                      <div className="space-y-1">{uncategorized.map(renderTranscript)}</div>
                    </div>
                  )}
                  {!usableTranscripts.length && <p className="p-8 text-center text-sm text-muted-foreground">לא נמצאו הקלטות עם אודיו.</p>}
                </RootFolderDropZone>
              </DndContext>
            </ScrollArea>
          </div>
        ) : <Tabs defaultValue="folders" dir="rtl" className="min-h-0">
          <TabsList className="mx-5 mt-3 grid w-[calc(100%-2.5rem)] grid-cols-2">
            <TabsTrigger value="folders">תיקיות והקלטות</TabsTrigger>
            <TabsTrigger value="versions">גרסאות קיימות</TabsTrigger>
          </TabsList>

          <TabsContent value="folders" className="m-0 px-5 pb-5 pt-3">
            <div className="mb-2 flex justify-start">
              <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => beginCreateFolder(null)}>
                <FolderPlus className="h-4 w-4" /> תיקייה חדשה
              </Button>
            </div>
            <ScrollArea className="h-[min(55vh,28rem)] rounded-md border p-2">
              <DndContext sensors={sensors} onDragEnd={(event) => void handleFolderDragEnd(event)}>
                <RootFolderDropZone>
                  {creationRow(null)}
                  {tree.map(renderFolder)}
                  {uncategorized.length > 0 && (
                    <div className="rounded-md border border-dashed p-2">
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Folder className="h-4 w-4" /> ללא תיקייה</p>
                      <div className="space-y-1">{uncategorized.map(renderTranscript)}</div>
                    </div>
                  )}
                  {!usableTranscripts.length && <p className="p-8 text-center text-sm text-muted-foreground">לא נמצאו תמלולים מתאימים.</p>}
                </RootFolderDropZone>
              </DndContext>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="versions" className="m-0 px-5 pb-5 pt-3">
            <ScrollArea className="h-[min(55vh,28rem)] rounded-md border p-2">
              <div className="space-y-2">
                {matchingVersions.map(renderVersion)}
                {!matchingVersions.length && <p className="p-8 text-center text-sm text-muted-foreground">לא נמצאו גרסאות מתאימות.</p>}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>}
      </DialogContent>
    </Dialog>
  );
}
