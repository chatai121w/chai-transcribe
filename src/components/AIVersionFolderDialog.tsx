import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderTree } from "@/hooks/useFolderTree";
import { Folder, FolderPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionCount: number;
  hasAudio: boolean;
  onConfirm: (folderId: string | null, includeAudio: boolean) => Promise<void> | void;
}

export function AIVersionFolderDialog({ open, onOpenChange, versionCount, hasAudio, onConfirm }: Props) {
  const { folders, createFolder } = useFolderTree();
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const f = await createFolder({ name: newName.trim() });
      setSelected(f.id);
      setNewName("");
      toast({ title: "תיקייה נוצרה ✅", description: f.name });
    } catch (e: any) {
      toast({ title: "שגיאה ביצירת תיקייה", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(selected, includeAudio && hasAudio);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>שיוך {versionCount} גרסאות AI לתיקייה</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="שם תיקייה חדשה…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
            <Button size="sm" variant="outline" onClick={handleCreate} disabled={!newName.trim() || creating}>
              <FolderPlus className="w-4 h-4" />
              צור
            </Button>
          </div>

          <div className="rounded-md border">
            <ScrollArea className="h-48 p-1">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded ${selected === null ? "bg-accent" : "hover:bg-muted/50"}`}
              >
                <Folder className="w-4 h-4 opacity-50" />
                ללא תיקייה
              </button>
              {folders.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected(f.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded ${selected === f.id ? "bg-accent" : "hover:bg-muted/50"}`}
                >
                  <Folder className="w-4 h-4" style={{ color: f.color || undefined }} />
                  {f.emoji && <span>{f.emoji}</span>}
                  <span>{f.name}</span>
                </button>
              ))}
            </ScrollArea>
          </div>

          {hasAudio && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-audio"
                checked={includeAudio}
                onCheckedChange={(c) => setIncludeAudio(Boolean(c))}
              />
              <Label htmlFor="include-audio" className="text-sm cursor-pointer">
                שייך גם את הפניית האודיו המקורי
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>בטל</Button>
          <Button onClick={handleConfirm} disabled={busy}>שייך</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
