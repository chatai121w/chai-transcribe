import { useEffect, useState } from "react";
import { FolderManagementTree } from "@/components/FolderManagementTree";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useFolderTree } from "@/hooks/useFolderTree";

interface TranscriptFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFolderId?: string | null;
  onAssign: (folderId: string | null, folderName: string) => Promise<void> | void;
  title?: string;
  description?: string;
}

const NO_FOLDER_ID = "__none__";

export function TranscriptFolderDialog({
  open,
  onOpenChange,
  currentFolderId = null,
  onAssign,
  title = "סיווג התמלול לתיקייה",
  description = "אפשר להמשיך לעבוד בעורך בזמן שהחלון פתוח.",
}: TranscriptFolderDialogProps) {
  const { folders, createFolder, moveFolder, getPath, loading } = useFolderTree();
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelectedId(currentFolderId);
  }, [open, currentFolderId]);

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
        className="!flex max-h-[calc(100vh-2rem)] !w-[min(46rem,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden p-0 text-right shadow-2xl sm:rounded-lg"
        data-testid="transcript-folder-dialog"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-right">
          <DialogTitle className="text-right">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-scroll px-5 py-4 [scrollbar-gutter:stable]" data-testid="transcript-folder-dialog-scroll">
          <FolderManagementTree
            folders={folders}
            selectedId={selectedId ?? NO_FOLDER_ID}
            includeRoot
            rootId={NO_FOLDER_ID}
            rootLabel="ללא תיקייה"
            ariaLabel="עץ תיקיות סיווג"
            loading={loading}
            disabled={saving}
            onSelect={(id) => setSelectedId(id === NO_FOLDER_ID ? null : id)}
            onCreateFolder={(name, parentId) => createFolder({ name, parent_id: parentId })}
            onMoveFolder={moveFolder}
          />
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-3">
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
