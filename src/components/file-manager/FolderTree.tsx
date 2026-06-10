import { useEffect, useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { ChevronLeft, ChevronDown, Folder, FolderOpen, Pin, MoreHorizontal, Plus, Cloud, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FolderColorPicker } from './FolderColorPicker';
import type { FolderTreeNode, FolderNode } from '@/hooks/useFolderTree';
import { cn } from '@/lib/utils';

const NATIVE_DRAG_START_EVENT = 'fm-native-drag-start';
const NATIVE_DRAG_TARGET_EVENT = 'fm-native-drag-target';
const NATIVE_DRAG_END_EVENT = 'fm-native-drag-end';
const DROP_SNAP_EVENT = 'fm-drop-snap';

function setNativeDragImage(e: React.DragEvent, label: string) {
  const node = document.createElement('div');
  node.style.position = 'fixed';
  node.style.top = '-1000px';
  node.style.left = '-1000px';
  node.style.padding = '6px 10px';
  node.style.borderRadius = '10px';
  node.style.border = '1px solid rgba(217, 119, 6, 0.35)';
  node.style.background = 'rgba(255,255,255,0.95)';
  node.style.color = '#1f2937';
  node.style.font = '500 12px Heebo, Assistant, sans-serif';
  node.style.whiteSpace = 'nowrap';
  node.style.boxShadow = '0 6px 18px rgba(0,0,0,0.14)';
  node.textContent = `תיקייה: ${label || 'ללא שם'}`;
  document.body.appendChild(node);
  e.dataTransfer.setDragImage(node, 14, 12);
  requestAnimationFrame(() => {
    try { document.body.removeChild(node); } catch { /* ignore */ }
  });
}

function emitNativeDragStart(id: string, name: string) {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_START_EVENT, { detail: { kind: 'folder', id, name } }));
}

function emitNativeDragTarget(targetName: string | null) {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_TARGET_EVENT, { detail: { targetName } }));
}

function emitNativeDragEnd() {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_END_EVENT));
}

export type DriveFolderPayload = { id: string; name: string };
export type DriveFilePayload = { id: string; name: string; mimeType: string };

type LocalDragItem = { kind: 'folder' | 'transcript'; id: string; name?: string };

interface RowProps {
  node: FolderTreeNode;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string | null) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (node: FolderNode) => void;
  onDelete: (node: FolderNode) => void;
  onTogglePin: (id: string) => void;
  onUpdateStyle: (id: string, patch: { color?: string | null; emoji?: string | null }) => void;
  onLinkDrive: (node: FolderNode) => void;
  onDropLocalItem?: (targetLocalParentId: string | null, item: LocalDragItem) => void;
  onDropDriveFolder?: (targetLocalParentId: string | null, drive: DriveFolderPayload) => void;
  onDropDriveFile?: (targetLocalParentId: string | null, drive: DriveFilePayload) => void;
  snapTargetId?: string | null;
}

const FolderRow = ({
  node,
  selectedId,
  expanded,
  onToggleExpand,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  onTogglePin,
  onUpdateStyle,
  onLinkDrive,
  onDropLocalItem,
  onDropDriveFolder,
  onDropDriveFile,
  snapTargetId,
}: RowProps) => {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder-${node.id}`, data: { kind: 'folder', id: node.id } });
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: `drag-folder-${node.id}`, data: { kind: 'folder', id: node.id } });

  return (
    <>
      <div
        ref={setDropRef}
        className={cn(
          'group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition text-sm',
          isSelected && 'bg-yellow-500/20',
          !isSelected && 'hover:bg-muted',
          isOver && 'ring-2 ring-yellow-500 bg-yellow-100/90 dark:bg-yellow-900/35 shadow-[0_0_0_1px_rgba(234,179,8,0.35)]',
          snapTargetId === node.id && 'ring-2 ring-emerald-500/70 bg-emerald-50/80 dark:bg-emerald-900/20 animate-[pulse_420ms_ease-out]',
        )}
        style={{ paddingInlineStart: `${node.depth * 12 + 8}px` }}
        onClick={() => onSelect(node.id)}
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          if (
            t.includes('application/x-sht-local-item') ||
            t.includes('application/x-sht-drive-folder') ||
            t.includes('application/x-sht-drive-file')
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = t.includes('application/x-sht-local-item') ? 'move' : 'copy';
            emitNativeDragTarget(node.name || 'תיקייה');
          }
        }}
        onDrop={(e) => {
          const rawLocal = e.dataTransfer.getData('application/x-sht-local-item');
          const rawFolder = e.dataTransfer.getData('application/x-sht-drive-folder');
          const rawFile = e.dataTransfer.getData('application/x-sht-drive-file');
          if (!rawLocal && !rawFolder && !rawFile) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            if (rawLocal && onDropLocalItem) onDropLocalItem(node.id, JSON.parse(rawLocal));
            else if (rawFolder && onDropDriveFolder) onDropDriveFolder(node.id, JSON.parse(rawFolder));
            else if (rawFile && onDropDriveFile) onDropDriveFile(node.id, JSON.parse(rawFile));
            emitNativeDragEnd();
          } catch {
            // ignore malformed drop payload
          }
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0"
        >
          {hasChildren ? (isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />) : null}
        </button>

        <div
          ref={setDragRef}
          {...listeners}
          {...attributes}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-sht-local-item', JSON.stringify({ kind: 'folder', id: node.id, name: node.name }));
            e.dataTransfer.effectAllowed = 'copyMove';
            setNativeDragImage(e, node.name || 'תיקייה');
            emitNativeDragStart(node.id, node.name || 'תיקייה');
          }}
          onDragEnd={() => emitNativeDragEnd()}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          {node.emoji ? (
            <span className="text-base shrink-0">{node.emoji}</span>
          ) : isExpanded && hasChildren ? (
            <FolderOpen className="w-4 h-4 shrink-0" style={{ color: node.color || '#eab308' }} />
          ) : (
            <Folder className="w-4 h-4 shrink-0" style={{ color: node.color || '#eab308' }} />
          )}
          <span className="truncate flex-1 text-right">{node.name}</span>
          {node.drive_folder_id && <Link2 className="w-3 h-3 text-blue-500 shrink-0" />}
          {node.pinned && <Pin className="w-3 h-3 text-yellow-600 shrink-0 fill-current" />}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onCreateChild(node.id)}>
              <Plus className="w-3.5 h-3.5 ml-2" /> תת-תיקייה חדשה
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(node)}>שינוי שם</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTogglePin(node.id)}>
              <Pin className="w-3.5 h-3.5 ml-2" /> {node.pinned ? 'בטל הצמדה' : 'הצמד למעלה'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLinkDrive(node)}>
              <Cloud className="w-3.5 h-3.5 ml-2" /> {node.drive_folder_id ? 'נהל קישור Drive' : 'חבר ל-Google Drive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(node)}>
              מחק
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <FolderColorPicker
          color={node.color}
          emoji={node.emoji}
          onChange={(patch) => onUpdateStyle(node.id, patch)}
          trigger={
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <div className="w-3 h-3 rounded-full" style={{ background: node.color || 'transparent', border: '1px solid currentColor' }} />
            </Button>
          }
        />
      </div>

      {isExpanded &&
        node.children.map((child) => (
          <FolderRow
            key={child.id}
            node={child}
            selectedId={selectedId}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onUpdateStyle={onUpdateStyle}
            onLinkDrive={onLinkDrive}
            onDropLocalItem={onDropLocalItem}
            onDropDriveFolder={onDropDriveFolder}
            onDropDriveFile={onDropDriveFile}
            snapTargetId={snapTargetId}
          />
        ))}
    </>
  );
};

interface TreeProps {
  tree: FolderTreeNode[];
  pinned: FolderTreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateChild: (parentId: string | null) => void;
  onRename: (node: FolderNode) => void;
  onDelete: (node: FolderNode) => void;
  onTogglePin: (id: string) => void;
  onUpdateStyle: (id: string, patch: { color?: string | null; emoji?: string | null }) => void;
  onLinkDrive: (node: FolderNode) => void;
  onDropLocalItem?: (targetLocalParentId: string | null, item: LocalDragItem) => void;
  onDropDriveFolder?: (targetLocalParentId: string | null, drive: DriveFolderPayload) => void;
  onDropDriveFile?: (targetLocalParentId: string | null, drive: DriveFilePayload) => void;
}

export const FolderTree = ({
  tree,
  pinned,
  selectedId,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  onTogglePin,
  onUpdateStyle,
  onLinkDrive,
  onDropLocalItem,
  onDropDriveFolder,
  onDropDriveFile,
}: TreeProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootDriveOver, setRootDriveOver] = useState(false);
  const [snapTargetId, setSnapTargetId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDropSnap = (ev: Event) => {
      const detail = (ev as CustomEvent<{ targetId?: string | null }>).detail;
      setSnapTargetId(detail?.targetId ?? null);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSnapTargetId(undefined), 450);
    };
    window.addEventListener(DROP_SNAP_EVENT, onDropSnap as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(DROP_SNAP_EVENT, onDropSnap as EventListener);
    };
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const { setNodeRef: rootDropRef, isOver: rootOver } = useDroppable({ id: 'folder-root', data: { kind: 'folder', id: null } });

  return (
    <div dir="rtl" className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-2 border-b">
        <span className="text-xs text-muted-foreground font-medium">תיקיות</span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onCreateChild(null)}>
          <Plus className="w-3.5 h-3.5" /> חדש
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {pinned.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-yellow-700 flex items-center gap-1">
              <Pin className="w-3 h-3 fill-current" /> נעוצות
            </div>
            {pinned.map((n) => (
              <FolderRow
                key={`p-${n.id}`}
                node={{ ...n, depth: 0, children: [] }}
                selectedId={selectedId}
                expanded={expanded}
                onToggleExpand={toggleExpand}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
                onUpdateStyle={onUpdateStyle}
                onLinkDrive={onLinkDrive}
                onDropLocalItem={onDropLocalItem}
                onDropDriveFolder={onDropDriveFolder}
                onDropDriveFile={onDropDriveFile}
                snapTargetId={snapTargetId ?? null}
              />
            ))}
            <div className="my-1 mx-3 border-t border-border/50" />
          </>
        )}

        <div
          ref={rootDropRef}
          onClick={() => onSelect(null)}
          onDragOver={(e) => {
            const t = e.dataTransfer.types;
            if (
              t.includes('application/x-sht-local-item') ||
              t.includes('application/x-sht-drive-folder') ||
              t.includes('application/x-sht-drive-file')
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = t.includes('application/x-sht-local-item') ? 'move' : 'copy';
              setRootDriveOver(true);
              if (t.includes('application/x-sht-local-item')) emitNativeDragTarget('הבית');
            }
          }}
          onDragLeave={() => setRootDriveOver(false)}
          onDrop={(e) => {
            setRootDriveOver(false);
            const rawLocal = e.dataTransfer.getData('application/x-sht-local-item');
            const rawFolder = e.dataTransfer.getData('application/x-sht-drive-folder');
            const rawFile = e.dataTransfer.getData('application/x-sht-drive-file');
            if (!rawLocal && !rawFolder && !rawFile) return;
            e.preventDefault();
            try {
              if (rawLocal && onDropLocalItem) onDropLocalItem(null, JSON.parse(rawLocal));
              else if (rawFolder && onDropDriveFolder) onDropDriveFolder(null, JSON.parse(rawFolder));
              else if (rawFile && onDropDriveFile) onDropDriveFile(null, JSON.parse(rawFile));
              emitNativeDragEnd();
            } catch {
              // ignore malformed drop payload
            }
          }}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-sm cursor-pointer hover:bg-muted',
            selectedId === null && 'bg-yellow-500/20',
            (rootOver || rootDriveOver) && 'ring-2 ring-yellow-500 bg-yellow-100/90 dark:bg-yellow-900/35',
            snapTargetId === null && 'ring-2 ring-emerald-500/70 bg-emerald-50/80 dark:bg-emerald-900/20 animate-[pulse_420ms_ease-out]',
          )}
        >
          <Folder className="w-4 h-4 text-yellow-600" />
          <span>הבית (כל התיקיות)</span>
        </div>

        {tree.map((n) => (
          <FolderRow
            key={n.id}
            node={n}
            selectedId={selectedId}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onUpdateStyle={onUpdateStyle}
            onLinkDrive={onLinkDrive}
            onDropLocalItem={onDropLocalItem}
            onDropDriveFolder={onDropDriveFolder}
            onDropDriveFile={onDropDriveFile}
            snapTargetId={snapTargetId ?? null}
          />
        ))}
      </div>
    </div>
  );
};
