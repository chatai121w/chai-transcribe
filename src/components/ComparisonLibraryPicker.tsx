import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, Folder, FolderOpen, GitCompareArrows, Mic2 } from "lucide-react";
import { useFolderTree, type FolderTreeNode } from "@/hooks/useFolderTree";
import type { CloudTranscript } from "@/hooks/useCloudTranscripts";
import { cn } from "@/lib/utils";

interface ComparisonLibraryPickerProps {
  transcripts: CloudTranscript[];
  initialTranscriptId?: string | null;
  onCompare: (base: CloudTranscript, newer: CloudTranscript) => void;
}

function transcriptText(transcript: CloudTranscript) {
  return transcript.edited_text?.trim() || transcript.text?.trim() || "";
}

function TranscriptRow({
  transcript,
  baseId,
  newerId,
  onBase,
  onNewer,
}: {
  transcript: CloudTranscript;
  baseId: string | null;
  newerId: string | null;
  onBase: () => void;
  onNewer: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-2">
      <Mic2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{transcript.title || transcript.text.slice(0, 60)}</p>
        <p className="truncate text-[10px] text-muted-foreground">{transcript.engine} · {new Date(transcript.updated_at || transcript.created_at).toLocaleDateString("he-IL")}</p>
      </div>
      <Button type="button" size="sm" variant={baseId === transcript.id ? "default" : "outline"} className="h-7 px-2 text-[10px]" onClick={onBase}>
        בסיס
      </Button>
      <Button type="button" size="sm" variant={newerId === transcript.id ? "default" : "outline"} className="h-7 px-2 text-[10px]" onClick={onNewer}>
        חדש
      </Button>
    </div>
  );
}

export function ComparisonLibraryPicker({ transcripts, initialTranscriptId = null, onCompare }: ComparisonLibraryPickerProps) {
  const { tree } = useFolderTree();
  const usable = useMemo(() => transcripts.filter((item) => transcriptText(item)), [transcripts]);
  const [baseId, setBaseId] = useState<string | null>(initialTranscriptId);
  const [newerId, setNewerId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const byFolder = useMemo(() => {
    const map = new Map<string | null, CloudTranscript[]>();
    for (const transcript of usable) {
      const key = transcript.folder_id || null;
      map.set(key, [...(map.get(key) || []), transcript]);
    }
    return map;
  }, [usable]);

  const descendantsHaveTranscripts = (node: FolderTreeNode): boolean => (
    Boolean(byFolder.get(node.id)?.length) || node.children.some(descendantsHaveTranscripts)
  );

  const renderFolder = (node: FolderTreeNode) => {
    if (!descendantsHaveTranscripts(node)) return null;
    const isOpen = openFolders.has(node.id);
    const items = byFolder.get(node.id) || [];
    return (
      <div key={node.id} style={{ paddingInlineStart: `${node.depth * 14}px` }}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-xs font-medium hover:bg-muted"
          onClick={() => setOpenFolders((previous) => {
            const next = new Set(previous);
            if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
            return next;
          })}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          {isOpen ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
          <span className="truncate">{node.name}</span>
          <Badge variant="secondary" className="ms-auto h-5 text-[10px]">{items.length}</Badge>
        </button>
        {isOpen && (
          <div className="space-y-1 py-1">
            {items.map((transcript) => (
              <TranscriptRow key={transcript.id} transcript={transcript} baseId={baseId} newerId={newerId} onBase={() => setBaseId(transcript.id)} onNewer={() => setNewerId(transcript.id)} />
            ))}
            {node.children.map(renderFolder)}
          </div>
        )}
      </div>
    );
  };

  const uncategorized = byFolder.get(null) || [];
  const base = usable.find((item) => item.id === baseId);
  const newer = usable.find((item) => item.id === newerId);

  return (
    <Collapsible className="rounded-lg border bg-card" dir="rtl">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-2">
            <FolderOpen className="h-4 w-4" /> בחר מתיקיות ותמלולים
          </Button>
        </CollapsibleTrigger>
        <span className="text-[11px] text-muted-foreground">בסיס: {base?.title || "לא נבחר"} · חדש: {newer?.title || "לא נבחר"}</span>
        <Button
          type="button"
          size="sm"
          className="me-auto gap-2"
          disabled={!base || !newer || base.id === newer.id}
          onClick={() => base && newer && onCompare(base, newer)}
        >
          <GitCompareArrows className="h-4 w-4" /> השווה נבחרים
        </Button>
      </div>
      <CollapsibleContent className="border-t p-3">
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {tree.map(renderFolder)}
          {uncategorized.length > 0 && (
            <div className={cn("space-y-1 rounded-md border border-dashed p-2", tree.length && "mt-2")}>
              <p className="flex items-center gap-2 px-1 text-xs font-medium"><Folder className="h-4 w-4" /> ללא תיקייה</p>
              {uncategorized.map((transcript) => (
                <TranscriptRow key={transcript.id} transcript={transcript} baseId={baseId} newerId={newerId} onBase={() => setBaseId(transcript.id)} onNewer={() => setNewerId(transcript.id)} />
              ))}
            </div>
          )}
          {!usable.length && <p className="p-4 text-center text-xs text-muted-foreground">אין תמלולים שמורים לבחירה.</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
