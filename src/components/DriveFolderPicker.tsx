import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder, FolderPlus, Loader2, ChevronLeft, Home, Check,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

interface Crumb { id: string | null; name: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen folder. id=null means My Drive root. */
  onPick: (folder: { id: string | null; name: string }) => void;
  title?: string;
}

export const DriveFolderPicker = ({ open, onOpenChange, onPick, title }: Props) => {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: "הדרייב שלי" }]);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  const current = crumbs[crumbs.length - 1];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-drive", {
        body: {
          action: "list",
          folderId: current.id,
          pageSize: 200,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const onlyFolders = (data?.files || []).filter(
        (f: DriveFolder) => f.mimeType === "application/vnd.google-apps.folder"
      );
      setFolders(onlyFolders);
    } catch (e: any) {
      toast({ title: "שגיאה בטעינת תיקיות", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [current.id]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open) setCrumbs([{ id: null, name: "הדרייב שלי" }]); }, [open]);

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-drive", {
        body: {
          action: "createFolder",
          name: newFolderName.trim(),
          parents: current.id ? [current.id] : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "✅ תיקייה נוצרה", description: data.name });
      setNewFolderName("");
      load();
    } catch (e: any) {
      toast({ title: "שגיאה ביצירת תיקייה", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title || "בחר תיקייה ב-Google Drive"}</DialogTitle>
        </DialogHeader>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-wrap text-sm bg-muted/40 rounded p-2">
          <Home className="w-4 h-4 text-yellow-600" />
          {crumbs.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <button
                onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
                className="text-yellow-700 hover:underline disabled:no-underline disabled:text-foreground"
                disabled={i === crumbs.length - 1}
              >
                {c.name}
              </button>
              {i < crumbs.length - 1 && <ChevronLeft className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Folder list */}
        <ScrollArea className="h-[280px] border rounded">
          {loading ? (
            <div className="flex items-center justify-center h-full py-10">
              <Loader2 className="w-5 h-5 animate-spin text-yellow-600" />
            </div>
          ) : folders.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              אין תיקיות כאן
            </div>
          ) : (
            <div className="p-1">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setCrumbs([...crumbs, { id: f.id, name: f.name }])}
                  className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted text-right"
                >
                  <Folder className="w-4 h-4 text-yellow-600 shrink-0" />
                  <span className="flex-1 truncate text-sm">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Create new folder */}
        <div className="flex gap-2">
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="שם תיקייה חדשה..."
            className="text-right"
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
          />
          <Button
            variant="outline"
            onClick={createFolder}
            disabled={!newFolderName.trim() || creating}
            className="gap-1 shrink-0"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
            צור
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            onClick={() => { onPick({ id: current.id, name: current.name }); onOpenChange(false); }}
            className="gap-1 bg-yellow-600 hover:bg-yellow-700"
          >
            <Check className="w-4 h-4" />
            שמור כאן: {current.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
