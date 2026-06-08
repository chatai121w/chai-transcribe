import { useState, useMemo, useEffect, useCallback } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Search, Plus, Copy, Scissors, Clipboard, Trash2, Pin, Cloud, Loader2, X } from 'lucide-react';
import { useFolderTree, type FolderNode } from '@/hooks/useFolderTree';
import { useCloudTranscripts, type CloudTranscript } from '@/hooks/useCloudTranscripts';
import { FolderTree } from './FolderTree';
import { FileGrid } from './FileGrid';
import { Breadcrumbs } from './Breadcrumbs';
import { fileClipboard } from '@/lib/clipboard';
import { GoogleDriveBrowser } from '@/components/GoogleDriveBrowser';
import { DriveFolderPicker } from '@/components/DriveFolderPicker';
import { supabase } from '@/integrations/supabase/client';

export const FileManager = () => {
  const navigate = useNavigate();
  const { tree, folders, createFolder, updateFolder, deleteFolder, moveFolder, togglePin, getPath } = useFolderTree();
  const { transcripts, updateTranscript, deleteTranscript } = useCloudTranscripts();

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [, forceRender] = useState(0);
  useEffect(() => fileClipboard.subscribe(() => forceRender(n => n + 1)), []);

  // Dialogs
  const [newFolderOpen, setNewFolderOpen] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameOpen, setRenameOpen] = useState<FolderNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [driveLinkOpen, setDriveLinkOpen] = useState<FolderNode | null>(null);
  const [driveBrowserOpen, setDriveBrowserOpen] = useState(false);

  const pinned = useMemo(() => folders.filter(f => f.pinned), [folders]);
  const path = useMemo(() => getPath(currentFolderId), [currentFolderId, getPath]);

  const itemsInCurrent = useMemo(() => {
    const childFolders = folders.filter(f => f.parent_id === currentFolderId);
    const childTranscripts = transcripts.filter((t: any) => (t.folder_id || null) === currentFolderId);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? [
          ...childFolders.filter(f => f.name.toLowerCase().includes(q)),
          ...childTranscripts.filter(t => (t.title || '').toLowerCase().includes(q) || (t.text || '').toLowerCase().includes(q)),
        ]
      : [...childFolders, ...childTranscripts];
    return filtered.map(x =>
      'parent_id' in x ? { kind: 'folder' as const, data: x } : { kind: 'transcript' as const, data: x as CloudTranscript }
    );
  }, [folders, transcripts, currentFolderId, search]);

  // ── Selection ──
  const onSelect = useCallback((id: string, _kind: 'folder' | 'transcript', mod: { shift: boolean; ctrl: boolean }) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (mod.ctrl) { next.has(id) ? next.delete(id) : next.add(id); return next; }
      return new Set([id]);
    });
  }, []);

  // ── Clipboard ops ──
  const cutIds = useMemo(() => new Set(fileClipboard.mode === 'cut' ? fileClipboard.items.map(i => i.id) : []), []);

  const getSelectedItems = () => {
    const items: { kind: 'folder' | 'transcript'; id: string }[] = [];
    selected.forEach(id => {
      if (folders.find(f => f.id === id)) items.push({ kind: 'folder', id });
      else if (transcripts.find((t: any) => t.id === id)) items.push({ kind: 'transcript', id });
    });
    return items;
  };

  const doCopy = () => {
    const items = getSelectedItems();
    if (items.length === 0) return;
    fileClipboard.set(items, 'copy');
    toast({ title: `הועתקו ${items.length} פריטים` });
  };
  const doCut = () => {
    const items = getSelectedItems();
    if (items.length === 0) return;
    fileClipboard.set(items, 'cut');
    toast({ title: `הוכנו לגזירה: ${items.length} פריטים` });
  };
  const doPaste = async () => {
    if (fileClipboard.items.length === 0) return;
    const target = currentFolderId;
    try {
      for (const it of fileClipboard.items) {
        if (it.kind === 'transcript') {
          if (fileClipboard.mode === 'cut') {
            await updateTranscript(it.id, { folder_id: target } as any);
          } else {
            const orig = transcripts.find((t: any) => t.id === it.id);
            if (!orig) continue;
            await supabase.from('transcripts').insert({
              user_id: orig.user_id, text: orig.text, engine: orig.engine, tags: orig.tags,
              notes: orig.notes, title: `${orig.title} (עותק)`, folder: orig.folder,
              category: orig.category, folder_id: target,
            } as any);
          }
        } else {
          if (fileClipboard.mode === 'cut') await moveFolder(it.id, target);
        }
      }
      toast({ title: 'הודבק בהצלחה' });
      if (fileClipboard.mode === 'cut') fileClipboard.clear();
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: 'שגיאה בהדבקה', description: e.message, variant: 'destructive' });
    }
  };

  const doDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`למחוק ${selected.size} פריטים?`)) return;
    for (const id of selected) {
      const f = folders.find(x => x.id === id);
      if (f) await deleteFolder(id);
      else await deleteTranscript(id);
    }
    setSelected(new Set());
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'c') { e.preventDefault(); doCopy(); }
      else if (ctrl && e.key === 'x') { e.preventDefault(); doCut(); }
      else if (ctrl && e.key === 'v') { e.preventDefault(); doPaste(); }
      else if (ctrl && e.key === 'a') { e.preventDefault(); setSelected(new Set(itemsInCurrent.map(i => i.data.id))); }
      else if (e.key === 'Delete') { e.preventDefault(); doDeleteSelected(); }
      else if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ── Drag and drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const a = active.data.current as any; const o = over.data.current as any;
    if (!a || !o || o.kind !== 'folder') return;
    const targetId = o.id as string | null;
    try {
      if (a.kind === 'transcript') {
        await updateTranscript(a.id, { folder_id: targetId } as any);
        toast({ title: '✅ הועבר' });
      } else if (a.kind === 'folder') {
        if (a.id === targetId) return;
        await moveFolder(a.id, targetId);
        toast({ title: '✅ תיקייה הועברה' });
      }
    } catch (err: any) {
      toast({ title: 'שגיאה בהעברה', description: err.message, variant: 'destructive' });
    }
  };

  // ── Folder ops ──
  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    try {
      await createFolder({ name: newFolderName.trim(), parent_id: newFolderOpen?.parentId ?? null });
      setNewFolderName(''); setNewFolderOpen(null);
      toast({ title: '📁 תיקייה נוצרה' });
    } catch (e: any) { toast({ title: 'שגיאה', description: e.message, variant: 'destructive' }); }
  };

  const handleRename = async () => {
    if (!renameOpen || !renameValue.trim()) return;
    await updateFolder(renameOpen.id, { name: renameValue.trim() });
    setRenameOpen(null); setRenameValue('');
  };

  const handleLinkDrive = async (driveFolder: { id: string | null; name: string }) => {
    if (!driveLinkOpen) return;
    await updateFolder(driveLinkOpen.id, {
      drive_folder_id: driveFolder.id, drive_folder_name: driveFolder.name,
      drive_synced_at: new Date().toISOString(),
    });
    toast({ title: '☁️ קושר ל-Drive', description: driveFolder.name });
    setDriveLinkOpen(null);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <Card className="overflow-hidden border-yellow-500/30" dir="rtl">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-3 border-b bg-muted/30 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש בתיקייה..." className="pr-9 text-right h-9" />
          </div>
          <Button size="sm" variant="outline" onClick={() => setNewFolderOpen({ parentId: currentFolderId })}>
            <Plus className="w-4 h-4 ml-1" /> תיקייה חדשה
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
          <Button size="sm" variant="ghost" onClick={doCopy} disabled={selected.size === 0} title="Ctrl+C">
            <Copy className="w-4 h-4 ml-1" /> העתק
          </Button>
          <Button size="sm" variant="ghost" onClick={doCut} disabled={selected.size === 0} title="Ctrl+X">
            <Scissors className="w-4 h-4 ml-1" /> גזור
          </Button>
          <Button size="sm" variant="ghost" onClick={doPaste} disabled={fileClipboard.items.length === 0} title="Ctrl+V">
            <Clipboard className="w-4 h-4 ml-1" /> הדבק
            {fileClipboard.items.length > 0 && <span className="mr-1 text-xs">({fileClipboard.items.length})</span>}
          </Button>
          <Button size="sm" variant="ghost" onClick={doDeleteSelected} disabled={selected.size === 0} className="text-destructive" title="Delete">
            <Trash2 className="w-4 h-4 ml-1" /> מחק
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
          <Button size="sm" variant="outline" onClick={() => setDriveBrowserOpen(true)}>
            <Cloud className="w-4 h-4 ml-1" /> דפדף ב-Drive
          </Button>
        </div>

        {/* Body: tree + grid */}
        <div className="grid grid-cols-[260px_1fr] min-h-[600px]">
          <div className="border-l bg-muted/10">
            <FolderTree
              tree={tree}
              pinned={pinned.map(f => ({ ...f, depth: 0, children: [] }))}
              selectedId={currentFolderId}
              onSelect={setCurrentFolderId}
              onCreateChild={(pid) => setNewFolderOpen({ parentId: pid })}
              onRename={(f) => { setRenameOpen(f); setRenameValue(f.name); }}
              onDelete={async (f) => { if (confirm(`למחוק את התיקייה "${f.name}" וכל תכולתה?`)) await deleteFolder(f.id); }}
              onTogglePin={togglePin}
              onUpdateStyle={(id, patch) => updateFolder(id, patch)}
              onLinkDrive={(f) => setDriveLinkOpen(f)}
            />
          </div>

          <div className="flex flex-col">
            <div className="px-4 py-2 border-b flex items-center justify-between">
              <Breadcrumbs path={path} onNavigate={setCurrentFolderId} />
              {selected.size > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  {selected.size} נבחרו
                  <button onClick={() => setSelected(new Set())}><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <FileGrid
                items={itemsInCurrent}
                selected={selected}
                cutIds={cutIds}
                onSelect={onSelect}
                onOpenFolder={setCurrentFolderId}
                onOpenTranscript={(id) => navigate(`/editor/${id}`)}
                onDeleteTranscript={async (id) => { if (confirm('למחוק תמלול זה?')) await deleteTranscript(id); }}
                onToggleFavorite={(t) => updateTranscript(t.id, { is_favorite: !t.is_favorite })}
                onTogglePinFolder={togglePin}
                onDeleteFolder={async (f) => { if (confirm(`למחוק את "${f.name}"?`)) await deleteFolder(f.id); }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* New folder */}
      <Dialog open={!!newFolderOpen} onOpenChange={(o) => !o && setNewFolderOpen(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>תיקייה חדשה</DialogTitle></DialogHeader>
          <Input
            value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="שם תיקייה" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="text-right"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewFolderOpen(null)}>ביטול</Button>
            <Button onClick={handleCreate}>צור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameOpen} onOpenChange={(o) => !o && setRenameOpen(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>שינוי שם</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleRename()} className="text-right" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(null)}>ביטול</Button>
            <Button onClick={handleRename}>שמור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drive linker */}
      {driveLinkOpen && (
        <DriveFolderPicker
          open={!!driveLinkOpen}
          onOpenChange={(o) => !o && setDriveLinkOpen(null)}
          onPick={handleLinkDrive}
        />
      )}

      {/* Drive browser */}
      <Dialog open={driveBrowserOpen} onOpenChange={setDriveBrowserOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader><DialogTitle>Google Drive</DialogTitle></DialogHeader>
          <GoogleDriveBrowser onImportAudio={(file) => {
            setDriveBrowserOpen(false);
            navigate('/', { state: { file } });
          }} />
        </DialogContent>
      </Dialog>
    </DndContext>
  );
};
