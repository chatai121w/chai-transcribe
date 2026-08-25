import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GripVertical,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { FolderNode } from "@/hooks/useFolderTree";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

function FolderDestinationRow({
  folder,
  depth,
  selected,
  open,
  hasChildren,
  disabled,
  onSelect,
  onToggle,
  onCreateChild,
}: {
  folder: FolderNode;
  depth: number;
  selected: boolean;
  open: boolean;
  hasChildren: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onCreateChild: () => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `cut-folder-drop-${folder.id}`,
    data: { folderId: folder.id },
    disabled,
  });
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: `cut-folder-drag-${folder.id}`,
    data: { folderId: folder.id },
    disabled,
  });

  return (
    <div
      ref={setDropRef}
      dir="rtl"
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      className={cn(
        "group flex min-h-10 w-full items-center gap-1 rounded-md border border-transparent pe-2 text-right text-sm transition-colors",
        "hover:border-primary/30 hover:bg-muted/60 focus-within:border-primary/30",
        selected && "border-primary bg-primary/10 text-foreground",
        isOver && "bg-primary/15 ring-2 ring-inset ring-primary/60",
        isDragging && "opacity-45",
      )}
      style={{ paddingInlineStart: `${8 + depth * 20}px` }}
      data-testid={`cut-folder-${folder.id}`}
    >
      <button
        ref={setDragRef}
        type="button"
        disabled={disabled}
        className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-50 hover:bg-background hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed"
        aria-label={`גרור את ${folder.name}`}
        title="גרור להעברת התיקייה"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        className="flex h-8 w-7 shrink-0 items-center justify-center rounded hover:bg-background disabled:cursor-not-allowed"
        aria-label={`${open ? "מזער" : "הרחב"} את ${folder.name}`}
        onClick={hasChildren ? onToggle : onSelect}
      >
        {hasChildren
          ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />
          : <span className="h-4 w-4" />}
      </button>
      <button
        type="button"
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-right disabled:cursor-not-allowed"
        onClick={onSelect}
      >
        {open ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <FolderTree className="h-4 w-4 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 truncate">{folder.emoji ? `${folder.emoji} ` : ""}{folder.name}</span>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="נבחר" />}
      </button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`צור תת-תיקייה בתוך ${folder.name}`}
        title="צור תת-תיקייה"
        onClick={onCreateChild}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FolderRootDropZone({ children, ariaLabel, disabled }: { children: React.ReactNode; ariaLabel: string; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "cut-folder-drop-root",
    data: { folderId: null },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      role="tree"
      aria-label={ariaLabel}
      className={cn("min-h-24 space-y-1 rounded-md p-1", isOver && "bg-primary/5 ring-2 ring-inset ring-primary/50")}
      data-testid="cut-folder-root-drop"
    >
      {children}
    </div>
  );
}

export function FolderManagementTree({
  folders,
  selectedId,
  includeRoot,
  rootId = "__root__",
  rootLabel = "תיקיות ראשיות",
  ariaLabel = "עץ תיקיות יעד",
  loading = false,
  disabled,
  onSelect,
  onCreateFolder,
  onMoveFolder,
}: {
  folders: FolderNode[];
  selectedId: string;
  includeRoot: boolean;
  rootId?: string;
  rootLabel?: string;
  ariaLabel?: string;
  loading?: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => Promise<FolderNode>;
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, FolderNode[]>();
    folders.forEach((folder) => {
      const parentId = folder.parent_id || null;
      const children = map.get(parentId) || [];
      children.push(folder);
      map.set(parentId, children);
    });
    map.forEach((children) => children.sort((a, b) => a.name.localeCompare(b.name, "he")));
    return map;
  }, [folders]);

  useEffect(() => {
    if (!selectedId || selectedId === rootId) return;
    const ancestors = new Set<string>();
    let current = folders.find((folder) => folder.id === selectedId)?.parent_id || null;
    while (current) {
      ancestors.add(current);
      current = folders.find((folder) => folder.id === current)?.parent_id || null;
    }
    if (ancestors.size) setOpenFolders((previous) => new Set([...previous, ...ancestors]));
  }, [folders, rootId, selectedId]);

  const normalizedQuery = query.trim().toLocaleLowerCase("he");
  const folderMatches = (folder: FolderNode, ancestors = new Set<string>()): boolean => {
    if (!normalizedQuery) return true;
    if (ancestors.has(folder.id)) return false;
    const nextAncestors = new Set(ancestors).add(folder.id);
    return folder.name.toLocaleLowerCase("he").includes(normalizedQuery)
      || (childrenByParent.get(folder.id) || []).some((child) => folderMatches(child, nextAncestors));
  };

  const beginCreate = (parentId: string | null) => {
    setCreatingParentId(parentId);
    setFolderName("");
    if (parentId) setOpenFolders((previous) => new Set(previous).add(parentId));
  };

  const saveFolder = async () => {
    const name = folderName.trim();
    if (!name || creatingParentId === undefined || creating) return;
    setCreating(true);
    try {
      const created = await onCreateFolder(name, creatingParentId);
      if (creatingParentId) setOpenFolders((previous) => new Set(previous).add(creatingParentId));
      setCreatingParentId(undefined);
      setFolderName("");
      onSelect(created.id);
      toast({ title: creatingParentId ? "תת-התיקייה נוצרה ונבחרה" : "התיקייה נוצרה ונבחרה" });
    } catch (error) {
      toast({ title: "יצירת התיקייה נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const creationRow = (parentId: string | null, depth: number) => creatingParentId === parentId ? (
    <div
      dir="rtl"
      className="flex items-center gap-1 py-1 pe-2"
      style={{ paddingInlineStart: `${8 + depth * 20}px` }}
      data-testid={parentId ? `cut-create-child-${parentId}` : "cut-create-root-folder"}
    >
      <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
      <Input
        autoFocus
        dir="rtl"
        value={folderName}
        className="h-8 min-w-0 flex-1 text-right"
        placeholder={parentId ? "שם תת-התיקייה" : "שם התיקייה החדשה"}
        aria-label={parentId ? "שם תת-תיקייה חדשה" : "שם תיקייה ראשית חדשה"}
        onChange={(event) => setFolderName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void saveFolder();
          if (event.key === "Escape") setCreatingParentId(undefined);
        }}
      />
      <Button type="button" size="icon" className="h-8 w-8" aria-label="שמור תיקייה חדשה" disabled={!folderName.trim() || creating} onClick={() => void saveFolder()}>
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="בטל יצירת תיקייה" disabled={creating} onClick={() => setCreatingParentId(undefined)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ) : null;

  const renderBranch = (parentId: string | null, depth: number, ancestors: Set<string>): React.ReactNode =>
    (childrenByParent.get(parentId) || []).map((folder) => {
      if (ancestors.has(folder.id)) return null;
      if (!folderMatches(folder, ancestors)) return null;
      const nextAncestors = new Set(ancestors).add(folder.id);
      const isSelected = selectedId === folder.id;
      const children = childrenByParent.get(folder.id) || [];
      const isOpen = normalizedQuery ? true : openFolders.has(folder.id);
      return (
        <div key={folder.id}>
          <FolderDestinationRow
            folder={folder}
            depth={depth}
            selected={isSelected}
            open={isOpen}
            hasChildren={children.length > 0}
            disabled={disabled}
            onSelect={() => onSelect(folder.id)}
            onToggle={() => setOpenFolders((previous) => {
              const next = new Set(previous);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            })}
            onCreateChild={() => beginCreate(folder.id)}
          />
          {creationRow(folder.id, depth + 1)}
          {isOpen && renderBranch(folder.id, depth + 1, nextAncestors)}
        </div>
      );
    });

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const folderId = active.data.current?.folderId as string | undefined;
    const parentId = (over.data.current?.folderId ?? null) as string | null;
    if (!folderId || folderId === parentId) return;
    try {
      await onMoveFolder(folderId, parentId);
      if (parentId) setOpenFolders((previous) => new Set(previous).add(parentId));
      toast({ title: parentId ? "התיקייה הועברה" : "התיקייה הועברה לרמה הראשית" });
    } catch (error) {
      toast({ title: "העברת התיקייה נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
    }
  };

  return (
    <div className="overflow-hidden rounded-md border bg-background" aria-label="ניהול עץ תיקיות">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש תיקייה..." aria-label="חיפוש תיקייה" className="h-9 pe-8 text-right" />
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          disabled={disabled}
          aria-label="צור תיקייה ראשית"
          title="צור תיקייה ראשית"
          onClick={() => beginCreate(null)}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="h-[min(36vh,22rem)]">
        <DndContext sensors={sensors} onDragEnd={(event) => void handleDragEnd(event)}>
          <FolderRootDropZone ariaLabel={ariaLabel} disabled={disabled}>
            {includeRoot && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(rootId)}
                aria-pressed={selectedId === rootId}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-right text-sm transition-colors",
                  "hover:border-primary/30 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60",
                  selectedId === rootId && "border-primary bg-primary/10",
                )}
              >
                <FolderTree className="h-4 w-4 text-primary" />
                <span className="flex-1">{rootLabel}</span>
                {selectedId === rootId && <Check className="h-4 w-4 text-primary" />}
              </button>
            )}
            {creationRow(null, 0)}
            {loading
              ? <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> טוען תיקיות...</div>
              : folders.length > 0
              ? renderBranch(null, 0, new Set())
              : <p className="px-3 py-6 text-center text-xs text-muted-foreground">עדיין אין תיקיות במערכת</p>}
            {normalizedQuery && !folders.some((folder) => folderMatches(folder)) && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">לא נמצאו תיקיות מתאימות</p>
            )}
          </FolderRootDropZone>
        </DndContext>
      </ScrollArea>
    </div>
  );
}

