import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronLeft, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, FolderPlus, Loader2 } from "lucide-react";
import { useFolderTree, type FolderTreeNode } from "@/hooks/useFolderTree";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface TranscriptFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFolderId?: string | null;
  onAssign: (folderId: string | null, folderName: string) => Promise<void> | void;
  title?: string;
  description?: string;
}

interface FolderTreeRowProps {
  node: FolderTreeNode;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

function FolderTreeRow({ node, selectedId, expanded, onSelect, onToggle }: FolderTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);

  return (
    <>
      <div
        className={cn(
          "flex w-full items-center rounded px-1 py-0.5 text-right text-sm hover:bg-muted",
          selectedId === node.id && "bg-primary/10 font-semibold text-primary",
        )}
        style={{ paddingInlineStart: `${4 + node.depth * 20}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background disabled:pointer-events-none"
          disabled={!hasChildren}
          aria-label={hasChildren ? (isExpanded ? `מזער את ${node.name}` : `הרחב את ${node.name}`) : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
        >
          {hasChildren && (isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />)}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-right"
        >
          {isExpanded && hasChildren ? (
            <FolderOpen className="h-4 w-4 shrink-0" style={{ color: node.color || undefined }} />
          ) : (
            <Folder className="h-4 w-4 shrink-0" style={{ color: node.color || undefined }} />
          )}
          <span className="truncate">{node.emoji ? `${node.emoji} ` : ""}{node.name}</span>
        </button>
      </div>
      {isExpanded && node.children.map((child) => (
        <FolderTreeRow
          key={child.id}
          node={child}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function collectExpandableIds(nodes: FolderTreeNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length > 0 ? [node.id] : []),
    ...collectExpandableIds(node.children),
  ]);
}

export function TranscriptFolderDialog({
  open,
  onOpenChange,
  currentFolderId = null,
  onAssign,
  title = "סיווג התמלול לתיקייה",
  description = "אפשר להמשיך לעבוד בעורך בזמן שהחלון פתוח.",
}: TranscriptFolderDialogProps) {
  const { tree, createFolder, getPath, loading } = useFolderTree();
  const expandableIds = useMemo(() => collectExpandableIds(tree), [tree]);
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(currentFolderId);
    if (currentFolderId) {
      setExpanded(new Set(getPath(currentFolderId).slice(0, -1).map((folder) => folder.id)));
    }
  }, [open, currentFolderId, getPath]);

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const createAndSelect = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await createFolder({ name, parent_id: selectedId });
      setSelectedId(created.id);
      setNewFolderName("");
      toast({ title: "התיקייה נוצרה", description: created.name });
    } catch (error) {
      toast({
        title: "יצירת התיקייה נכשלה",
        description: error instanceof Error ? error.message : "נסה שוב",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const assign = async () => {
    setSaving(true);
    try {
      const folderName = selectedId
        ? getPath(selectedId).map((folder) => folder.name).join(" / ")
        : "";
      await onAssign(selectedId, folderName);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideOverlay
        dir="rtl"
        className="!left-auto !right-4 !top-20 !w-[min(28rem,calc(100vw-2rem))] !max-w-none !translate-x-0 !translate-y-0 max-h-[calc(100vh-6rem)] gap-0 overflow-hidden p-0 text-right shadow-2xl sm:rounded-lg"
        data-testid="transcript-folder-dialog"
      >
        <DialogHeader className="border-b px-5 py-4 text-right">
          <DialogTitle className="text-right">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void createAndSelect(); }}
              placeholder={selectedId ? "צור תיקיית משנה בתוך הבחירה" : "שם תיקייה חדשה"}
              aria-label="שם תיקייה חדשה"
            />
            <Button type="button" variant="outline" onClick={() => void createAndSelect()} disabled={!newFolderName.trim() || creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              צור
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">עץ תיקיות</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setExpanded(new Set(expandableIds))}>
                <ChevronsUpDown className="h-3.5 w-3.5" /> הרחב הכול
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setExpanded(new Set())}>
                <ChevronsDownUp className="h-3.5 w-3.5" /> מזער הכול
              </Button>
            </div>
          </div>

          <ScrollArea className="h-64 rounded-md border p-1" dir="rtl">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-3 py-2 text-right text-sm hover:bg-muted",
                selectedId === null && "bg-primary/10 font-semibold text-primary",
              )}
            >
              <Folder className="h-4 w-4" /> ללא תיקייה
            </button>
            {loading && <div className="p-4 text-center text-xs text-muted-foreground">טוען תיקיות...</div>}
            {!loading && tree.map((folder) => (
              <FolderTreeRow
                key={folder.id}
                node={folder}
                selectedId={selectedId}
                expanded={expanded}
                onSelect={setSelectedId}
                onToggle={toggleExpanded}
              />
            ))}
          </ScrollArea>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
          <Button type="button" onClick={() => void assign()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            שייך לתיקייה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
