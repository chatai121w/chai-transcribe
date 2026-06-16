import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, FolderInput, Search } from "lucide-react";
import { useCloudVersions } from "@/hooks/useCloudVersions";
import { AIVersionCard } from "./AIVersionCard";
import { AIVersionFolderDialog } from "./AIVersionFolderDialog";
import { toast } from "@/hooks/use-toast";

interface Props {
  transcriptId: string | null;
  audioFilePath?: string | null;
  onOpenInEditor: (text: string) => void;
  onCreateCloudTranscript?: () => Promise<string | null>;
}

export function AIVersionsGrid({ transcriptId, audioFilePath, onOpenInEditor, onCreateCloudTranscript }: Props) {
  const { versions, isLoading, assignVersionsToFolder, deleteVersion, saveVersionToLocalOnly } = useCloudVersions(transcriptId);
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderDialogIds, setFolderDialogIds] = useState<string[] | null>(null);

  // Only versions originating from AI (have engine_label or non-original source)
  const aiVersions = useMemo(
    () => versions.filter(v => v.source !== "original" && (v.engine_label || v.action_label)),
    [versions],
  );

  const models = useMemo(() => {
    const s = new Set<string>();
    aiVersions.forEach(v => { if (v.engine_label) s.add(v.engine_label); });
    return Array.from(s);
  }, [aiVersions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return aiVersions
      .filter(v => modelFilter === "all" || v.engine_label === modelFilter)
      .filter(v => !q
        || v.text.toLowerCase().includes(q)
        || (v.action_label || "").toLowerCase().includes(q)
        || (v.engine_label || "").toLowerCase().includes(q))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [aiVersions, modelFilter, search]);

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleSaveLocal = async (v: any) => {
    await saveVersionToLocalOnly(v);
    toast({ title: "נשמר לוקלית 📥" });
  };

  const handleAssignConfirm = async (folderId: string | null, includeAudio: boolean) => {
    const ids = folderDialogIds || [];
    if (!ids.length) return;
    try {
      await assignVersionsToFolder(
        ids,
        folderId,
        includeAudio ? (audioFilePath ?? null) : undefined,
      );
      toast({
        title: folderId ? "שויך לתיקייה ✅" : "הוסר שיוך תיקייה",
        description: `${ids.length} גרסאות${includeAudio && audioFilePath ? " + אודיו" : ""}`,
      });
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "שגיאה בשיוך", description: e.message, variant: "destructive" });
    }
  };

  if (!transcriptId) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4 text-center text-sm text-muted-foreground flex flex-col items-center gap-3" dir="rtl">
        <span>כדי להציג ולהשוות גרסאות AI יש לשמור תחילה את התמלול בענן.</span>
        {onCreateCloudTranscript && (
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={async () => {
              const id = await onCreateCloudTranscript();
              if (id) toast({ title: 'התמלול נשמר בענן ☁️' });
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            שמור את התמלול בענן עכשיו
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border bg-muted/20 p-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-yellow-600" />
          השוואת גרסאות AI
          <Badge variant="secondary" className="text-xs">{filtered.length}/{aiVersions.length}</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="חיפוש בפרומפט/תוצאה…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 ps-7 text-xs"
            />
          </div>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="all">כל המודלים</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {selected.size > 0 && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => setFolderDialogIds(Array.from(selected))}
            >
              <FolderInput className="w-3.5 h-3.5" />
              שייך {selected.size} לתיקייה
            </Button>
          )}
        </div>
      </div>

      {isLoading && aiVersions.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">טוען…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          אין עדיין גרסאות AI לתמלול הזה. כל פעולה ב"עריכה עם AI" תופיע כאן אוטומטית.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(v => (
            <AIVersionCard
              key={v.id}
              version={v}
              selected={selected.has(v.id)}
              onSelectChange={toggleSelect}
              onOpen={onOpenInEditor}
              onDelete={deleteVersion}
              onSaveLocal={handleSaveLocal}
              onAssignFolder={(id) => setFolderDialogIds([id])}
            />
          ))}
        </div>
      )}

      <AIVersionFolderDialog
        open={folderDialogIds !== null}
        onOpenChange={(o) => { if (!o) setFolderDialogIds(null); }}
        versionCount={folderDialogIds?.length || 0}
        hasAudio={Boolean(audioFilePath)}
        onConfirm={handleAssignConfirm}
      />
    </div>
  );
}
