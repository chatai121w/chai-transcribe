import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, FolderPlus, Loader2 } from "lucide-react";
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

function flattenTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
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
  const folders = useMemo(() => flattenTree(tree), [tree]);
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelectedId(currentFolderId);
  }, [open, currentFolderId]);

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
        className="left-auto right-4 top-20 max-h-[calc(100vh-6rem)] w-[min(28rem,calc(100vw-2rem))] translate-x-0 translate-y-0 overflow-hidden p-0 sm:rounded-lg"
        data-testid="transcript-folder-dialog"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
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

          <ScrollArea className="h-64 rounded-md border p-1">
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
            {!loading && folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedId(folder.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded py-2 pe-3 text-right text-sm hover:bg-muted",
                  selectedId === folder.id && "bg-primary/10 font-semibold text-primary",
                )}
                style={{ paddingInlineStart: `${12 + folder.depth * 20}px` }}
              >
                <Folder className="h-4 w-4 shrink-0" style={{ color: folder.color || undefined }} />
                <span className="truncate">{folder.emoji ? `${folder.emoji} ` : ""}{folder.name}</span>
              </button>
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
