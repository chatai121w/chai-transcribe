import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Folder, FileAudio, FileText, Star, MoreHorizontal, Pin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { FolderNode } from '@/hooks/useFolderTree';
import type { CloudTranscript } from '@/hooks/useCloudTranscripts';
import { cn } from '@/lib/utils';

type Item =
  | { kind: 'folder'; data: FolderNode }
  | { kind: 'transcript'; data: CloudTranscript };

interface Props {
  items: Item[];
  selected: Set<string>;
  onSelect: (id: string, kind: 'folder' | 'transcript', mod: { shift: boolean; ctrl: boolean }) => void;
  onOpenFolder: (id: string) => void;
  onOpenTranscript: (id: string) => void;
  onDeleteTranscript: (id: string) => void;
  onToggleFavorite: (t: CloudTranscript) => void;
  onTogglePinFolder: (id: string) => void;
  onDeleteFolder: (f: FolderNode) => void;
  cutIds: Set<string>;
}

const FolderCard = ({ f, isSel, onClick, isCut, onPin, onDelete }: any) => {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `card-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: `drag-card-folder-${f.id}`, data: { kind: 'folder', id: f.id } });
  return (
    <div
      ref={dropRef}
      onClick={onClick}
      onDoubleClick={onClick.doubleClick}
      className={cn(
        'group relative flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/60 cursor-pointer transition',
        isSel && 'ring-2 ring-yellow-500 bg-yellow-500/10',
        isOver && 'ring-2 ring-yellow-500 bg-yellow-50 dark:bg-yellow-950/30',
        isCut && 'opacity-50',
      )}
    >
      <div ref={dragRef} {...listeners} {...attributes} className="flex items-center gap-3 flex-1 min-w-0">
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
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
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

export const FileGrid = ({ items, selected, onSelect, onOpenFolder, onOpenTranscript, onDeleteTranscript, onToggleFavorite, onTogglePinFolder, onDeleteFolder, cutIds }: Props) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" dir="rtl">
        <Folder className="w-12 h-12 mb-3 opacity-40" />
        <div className="text-sm">תיקייה ריקה</div>
        <div className="text-xs mt-1">גרור לכאן תמלולים או צור תת-תיקייה</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" dir="rtl">
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
                isCut={cutIds.has(f.id)}
                onClick={click}
                onPin={() => onTogglePinFolder(f.id)}
                onDelete={() => onDeleteFolder(f)}
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
