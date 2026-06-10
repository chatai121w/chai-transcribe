import { useEffect, useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Folder, FileAudio, FileText, Star, MoreHorizontal, Pin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { FolderNode } from '@/hooks/useFolderTree';
import type { CloudTranscript } from '@/hooks/useCloudTranscripts';
import { cn } from '@/lib/utils';

const NATIVE_DRAG_START_EVENT = 'fm-native-drag-start';
const NATIVE_DRAG_TARGET_EVENT = 'fm-native-drag-target';
const NATIVE_DRAG_END_EVENT = 'fm-native-drag-end';
const DROP_SNAP_EVENT = 'fm-drop-snap';

function setNativeDragImage(e: React.DragEvent, label: string, kind: 'folder' | 'transcript') {
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
  node.textContent = `${kind === 'folder' ? 'תיקייה' : 'תמלול'}: ${label || 'ללא שם'}`;
  document.body.appendChild(node);
  e.dataTransfer.setDragImage(node, 14, 12);
  requestAnimationFrame(() => {
    try { document.body.removeChild(node); } catch { /* ignore */ }
  });
}

function emitNativeDragStart(kind: 'folder' | 'transcript', id: string, name: string) {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_START_EVENT, { detail: { kind, id, name } }));
}

function emitNativeDragTarget(targetName: string | null) {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_TARGET_EVENT, { detail: { targetName } }));
}

function emitNativeDragEnd() {
  window.dispatchEvent(new CustomEvent(NATIVE_DRAG_END_EVENT));
}

type Item =
  | { kind: 'folder'; data: FolderNode }
  | { kind: 'transcript'; data: CloudTranscript };

export type FileGridViewMode = 'grid' | 'list' | 'table';

interface Props {
  items: Item[];
  viewMode?: FileGridViewMode;
  selected: Set<string>;
  onSelect: (id: string, kind: 'folder' | 'transcript', mod: { shift: boolean; ctrl: boolean }) => void;
  onOpenFolder: (id: string) => void;
  onOpenTranscript: (id: string) => void;
  onDeleteTranscript: (id: string) => void;
  onToggleFavorite: (t: CloudTranscript) => void;
  onTogglePinFolder: (id: string) => void;
  onDeleteFolder: (f: FolderNode) => void;
  onDropLocalItemToFolder?: (targetFolderId: string | null, item: { kind: 'folder' | 'transcript'; id: string; name?: string }) => void;
  cutIds: Set<string>;
}

const FolderCard = ({ f, isSel, isSnap, onClick, isCut, onPin, onDelete, onDropLocalItemToFolder }: any) => {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `card-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: `drag-card-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  return (
    <div
      ref={dropRef}
      onClick={onClick}
      onDoubleClick={onClick.doubleClick}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-sht-local-item')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          emitNativeDragTarget(f.name || 'תיקייה');
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/x-sht-local-item');
        if (!raw || !onDropLocalItemToFolder) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          const parsed = JSON.parse(raw) as { kind: 'folder' | 'transcript'; id: string; name?: string };
          if (!parsed?.id || (parsed.kind !== 'folder' && parsed.kind !== 'transcript')) return;
          onDropLocalItemToFolder(f.id, parsed);
          emitNativeDragEnd();
        } catch {
          // ignore malformed drag payload
        }
      }}
      className={cn(
        'group relative flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/60 cursor-pointer transition',
        isSel && 'ring-2 ring-yellow-500 bg-yellow-500/10',
        isOver && 'ring-2 ring-yellow-500 bg-yellow-100/90 dark:bg-yellow-900/35 shadow-[0_0_0_1px_rgba(234,179,8,0.35)]',
        isSnap && 'ring-2 ring-emerald-500/70 bg-emerald-50/80 dark:bg-emerald-900/20 animate-[pulse_420ms_ease-out]',
        isCut && 'opacity-50',
      )}
    >
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-sht-local-item', JSON.stringify({ kind: 'folder', id: f.id, name: f.name }));
          e.dataTransfer.effectAllowed = 'copyMove';
          setNativeDragImage(e, f.name || 'תיקייה', 'folder');
          emitNativeDragStart('folder', f.id, f.name || 'תיקייה');
        }}
        onDragEnd={() => emitNativeDragEnd()}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        {f.emoji ? (
          <span className="text-2xl">{f.emoji}</span>
        ) : (
          <Folder className="w-7 h-7 shrink-0" style={{ color: f.color || '#eab308' }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate flex items-center gap-1">
            {f.name}
            {f.drive_folder_id && <Badge variant="outline" className="text-[10px] py-0 h-4">Drive</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">תיקייה</div>
        </div>
      </div>
      {f.pinned && <Pin className="w-3.5 h-3.5 text-yellow-600 fill-current" />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onPin}>{f.pinned ? 'בטל הצמדה' : 'הצמד'}</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>מחק תיקייה</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const TranscriptCard = ({ t, isSel, isCut, onClick, onDelete, onFav }: any) => {
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: `drag-tr-${t.id}`, data: { kind: 'transcript', id: t.id } });
  const isAudio = !!t.audio_file_path;
  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/60 cursor-pointer transition',
        isSel && 'ring-2 ring-yellow-500 bg-yellow-500/10',
        isCut && 'opacity-50',
      )}
    >
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        draggable
        onDragStart={(e) => {
          // Native HTML5 payload so the card can be dropped on the Drive column
          e.dataTransfer.setData('application/x-sht-local-transcript-id', t.id);
          e.dataTransfer.setData('application/x-sht-local-item', JSON.stringify({ kind: 'transcript', id: t.id, name: t.title || 'ללא שם' }));
          e.dataTransfer.effectAllowed = 'copyMove';
          setNativeDragImage(e, t.title || 'ללא שם', 'transcript');
          emitNativeDragStart('transcript', t.id, t.title || 'ללא שם');
        }}
        onDragEnd={() => emitNativeDragEnd()}
        className="flex items-center gap-3 flex-1 min-w-0"
      >

        {isAudio ? <FileAudio className="w-6 h-6 text-yellow-700 shrink-0" /> : <FileText className="w-6 h-6 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{t.title || 'ללא שם'}</div>
          <div className="text-xs text-muted-foreground truncate">
            {new Date(t.updated_at).toLocaleDateString('he-IL')} · {t.engine || 'תמלול'}
            {t.tags?.length > 0 && ` · ${t.tags.length} תגיות`}
          </div>
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onFav(); }} className="opacity-60 hover:opacity-100">
        <Star className={cn('w-4 h-4', t.is_favorite && 'text-yellow-500 fill-current')} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>מחק תמלול</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const FolderTableRow = ({ f, isSel, isSnap, isCut, onSelectRow, onOpenFolder, onPin, onDelete, onDropLocalItemToFolder }: any) => {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `table-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: `drag-table-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  return (
    <div
      ref={dropRef}
      onClick={onSelectRow}
      onDoubleClick={() => onOpenFolder(f.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-sht-local-item')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          emitNativeDragTarget(f.name || 'תיקייה');
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/x-sht-local-item');
        if (!raw || !onDropLocalItemToFolder) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          const parsed = JSON.parse(raw) as { kind: 'folder' | 'transcript'; id: string; name?: string };
          if (!parsed?.id || (parsed.kind !== 'folder' && parsed.kind !== 'transcript')) return;
          onDropLocalItemToFolder(f.id, parsed);
          emitNativeDragEnd();
        } catch {
          // ignore malformed drag payload
        }
      }}
      className={cn(
        'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-xs text-right border-t border-border/40 hover:bg-muted/50 cursor-pointer',
        isSel && 'bg-yellow-500/10',
        isOver && 'ring-2 ring-yellow-500 bg-yellow-100/90 dark:bg-yellow-900/35',
        isSnap && 'ring-2 ring-emerald-500/70 bg-emerald-50/80 dark:bg-emerald-900/20 animate-[pulse_420ms_ease-out]',
        isCut && 'opacity-50',
      )}
    >
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-sht-local-item', JSON.stringify({ kind: 'folder', id: f.id, name: f.name }));
          e.dataTransfer.effectAllowed = 'copyMove';
          setNativeDragImage(e, f.name || 'תיקייה', 'folder');
          emitNativeDragStart('folder', f.id, f.name || 'תיקייה');
        }}
        onDragEnd={() => emitNativeDragEnd()}
        className="flex items-center gap-2 min-w-0"
      >
        <Folder className="w-4 h-4 shrink-0" style={{ color: f.color || '#eab308' }} />
        <span className="truncate">{f.name}</span>
        {f.drive_folder_id && <Badge variant="outline" className="text-[10px] py-0 h-4">Drive</Badge>}
      </div>
      <div className="text-muted-foreground text-right">תיקייה</div>
      <div className="flex items-center gap-1 justify-start">
        {f.pinned && <Pin className="w-3.5 h-3.5 text-yellow-600 fill-current" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onPin}>{f.pinned ? 'בטל הצמדה' : 'הצמד'}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>מחק תיקייה</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

const TranscriptTableRow = ({ t, isSel, isCut, onSelectRow, onOpenTranscript, onDelete, onFav }: any) => {
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: `drag-table-tr-${t.id}`, data: { kind: 'transcript', id: t.id } });
  const isAudio = !!t.audio_file_path;
  return (
    <div
      onClick={onSelectRow}
      onDoubleClick={() => onOpenTranscript(t.id)}
      className={cn(
        'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-xs text-right border-t border-border/40 hover:bg-muted/50 cursor-pointer',
        isSel && 'bg-yellow-500/10',
        isCut && 'opacity-50',
      )}
    >
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-sht-local-transcript-id', t.id);
          e.dataTransfer.setData('application/x-sht-local-item', JSON.stringify({ kind: 'transcript', id: t.id, name: t.title || 'ללא שם' }));
          e.dataTransfer.effectAllowed = 'copyMove';
          setNativeDragImage(e, t.title || 'ללא שם', 'transcript');
          emitNativeDragStart('transcript', t.id, t.title || 'ללא שם');
        }}
        onDragEnd={() => emitNativeDragEnd()}
        className="flex items-center gap-2 min-w-0"
      >
        {isAudio ? <FileAudio className="w-4 h-4 text-yellow-700 shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="truncate">{t.title || 'ללא שם'}</span>
      </div>
      <div className="text-muted-foreground truncate text-right">{new Date(t.updated_at).toLocaleDateString('he-IL')}</div>
      <div className="flex items-center gap-1 justify-start">
        <button onClick={(e) => { e.stopPropagation(); onFav(); }} className="opacity-60 hover:opacity-100">
          <Star className={cn('w-4 h-4', t.is_favorite && 'text-yellow-500 fill-current')} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>מחק תמלול</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export const FileGrid = ({ items, viewMode = 'grid', selected, onSelect, onOpenFolder, onOpenTranscript, onDeleteTranscript, onToggleFavorite, onTogglePinFolder, onDeleteFolder, onDropLocalItemToFolder, cutIds }: Props) => {
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDropSnap = (ev: Event) => {
      const detail = (ev as CustomEvent<{ targetId?: string | null }>).detail;
      if (!detail || detail.targetId == null) return;
      setSnapTargetId(String(detail.targetId));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSnapTargetId(null), 450);
    };
    window.addEventListener(DROP_SNAP_EVENT, onDropSnap as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(DROP_SNAP_EVENT, onDropSnap as EventListener);
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" dir="rtl">
        <Folder className="w-12 h-12 mb-3 opacity-40" />
        <div className="text-sm">תיקייה ריקה</div>
        <div className="text-xs mt-1">גרור לכאן תמלולים או צור תת-תיקייה</div>
      </div>
    );
  }

  if (viewMode === 'table') {
    return (
      <div className="rounded-lg border border-border/60 overflow-hidden bg-background" dir="rtl">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground bg-muted/30 text-right">
          <div>שם</div>
          <div>סוג / תאריך</div>
          <div className="text-right">פעולות</div>
        </div>
        {items.map((item) => {
          if (item.kind === 'folder') {
            const f = item.data;
            return (
              <FolderTableRow
                key={`f-table-${f.id}`}
                f={f}
                isSel={selected.has(f.id)}
                isSnap={snapTargetId === f.id}
                isCut={cutIds.has(f.id)}
                onSelectRow={(e: React.MouseEvent) => onSelect(f.id, 'folder', { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
                onOpenFolder={onOpenFolder}
                onPin={() => onTogglePinFolder(f.id)}
                onDelete={() => onDeleteFolder(f)}
                onDropLocalItemToFolder={onDropLocalItemToFolder}
              />
            );
          }
          const t = item.data;
          return (
            <TranscriptTableRow
              key={`t-table-${t.id}`}
              t={t}
              isSel={selected.has(t.id)}
              isCut={cutIds.has(t.id)}
              onSelectRow={(e: React.MouseEvent) => onSelect(t.id, 'transcript', { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
              onOpenTranscript={onOpenTranscript}
              onDelete={() => onDeleteTranscript(t.id)}
              onFav={() => onToggleFavorite(t)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'} dir="rtl">
      {items.map(item => {
        if (item.kind === 'folder') {
          const f = item.data;
          const click: any = (e: React.MouseEvent) => onSelect(f.id, 'folder', { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
          click.doubleClick = () => onOpenFolder(f.id);
          return (
            <div key={`f-${f.id}`} onDoubleClick={() => onOpenFolder(f.id)}>
              <FolderCard
                f={f}
                isSel={selected.has(f.id)}
                isSnap={snapTargetId === f.id}
                isCut={cutIds.has(f.id)}
                onClick={click}
                onPin={() => onTogglePinFolder(f.id)}
                onDelete={() => onDeleteFolder(f)}
                onDropLocalItemToFolder={onDropLocalItemToFolder}
              />
            </div>
          );
        }
        const t = item.data;
        return (
          <TranscriptCard
            key={`t-${t.id}`}
            t={t}
            isSel={selected.has(t.id)}
            isCut={cutIds.has(t.id)}
            onClick={(e: React.MouseEvent) => {
              if (e.detail === 2) onOpenTranscript(t.id);
              else onSelect(t.id, 'transcript', { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
            }}
            onDelete={() => onDeleteTranscript(t.id)}
            onFav={() => onToggleFavorite(t)}
          />
        );
      })}
    </div>
  );
};
