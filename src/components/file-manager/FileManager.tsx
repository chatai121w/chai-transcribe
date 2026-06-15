import { useState, useMemo, useEffect, useCallback } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Plus, Copy, Scissors, Clipboard, Trash2, Pin, Cloud, Loader2, X, Columns2, Rows3, LayoutGrid, Table2, Folder as FolderIcon, FileText } from 'lucide-react';
import { useFolderTree, type FolderNode } from '@/hooks/useFolderTree';
import { useCloudTranscripts, type CloudTranscript } from '@/hooks/useCloudTranscripts';
import { FolderTree } from './FolderTree';
import { FileGrid, type FileGridViewMode } from './FileGrid';
import { Breadcrumbs } from './Breadcrumbs';
import { fileClipboard } from '@/lib/clipboard';
import { GoogleDriveBrowser, uploadToDrive, type LocalDragItem } from '@/components/GoogleDriveBrowser';
import { DriveFolderPicker } from '@/components/DriveFolderPicker';
import { DriveUploadStatus } from './DriveUploadStatus';
import { driveUploadQueue } from '@/lib/driveUploadQueue';
import { supabase } from '@/integrations/supabase/client';

type DriveDropFile = {
  id: string;
  name: string;
  mimeType: string;
};

type DriveDropFolder = {
  id: string;
  name: string;
};

type CrossSystemAction = 'copy' | 'move' | 'cancel';
type DragPreview = {
  kind: 'folder' | 'transcript';
  id: string;
  name: string;
  targetName: string | null;
};

const NATIVE_DRAG_START_EVENT = 'fm-native-drag-start';
const NATIVE_DRAG_TARGET_EVENT = 'fm-native-drag-target';
const NATIVE_DRAG_END_EVENT = 'fm-native-drag-end';
const DROP_SNAP_EVENT = 'fm-drop-snap';

export const FileManager = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tree, folders, createFolder, updateFolder, deleteFolder, moveFolder, togglePin, getPath } = useFolderTree();
  const { transcripts, updateTranscript, deleteTranscript } = useCloudTranscripts();

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [, forceRender] = useState(0);
  useEffect(() => fileClipboard.subscribe(() => forceRender(n => n + 1)), []);

  // Dialogs
  const [newFolderOpen, setNewFolderOpen] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameOpen, setRenameOpen] = useState<FolderNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [driveLinkOpen, setDriveLinkOpen] = useState<FolderNode | null>(null);
  const [inlineDriveSplit, setInlineDriveSplit] = useState<boolean>(() => {
    try { return localStorage.getItem('fm_inline_drive_split') === '1'; } catch { return false; }
  });
  const [localViewMode, setLocalViewMode] = useState<FileGridViewMode>(() => {
    try {
      const v = localStorage.getItem('fm_local_view_mode');
      return (v === 'list' || v === 'table' || v === 'grid') ? v : 'grid';
    } catch {
      return 'grid';
    }
  });
  useEffect(() => {
    try { localStorage.setItem('fm_inline_drive_split', inlineDriveSplit ? '1' : '0'); } catch {}
  }, [inlineDriveSplit]);
  useEffect(() => {
    try { localStorage.setItem('fm_local_view_mode', localViewMode); } catch {}
  }, [localViewMode]);

  const cycleLocalViewMode = () => {
    setLocalViewMode((prev) => (prev === 'grid' ? 'list' : prev === 'list' ? 'table' : 'grid'));
  };

  const LocalViewIcon = localViewMode === 'grid' ? LayoutGrid : localViewMode === 'list' ? Rows3 : Table2;
  const localViewLabel = localViewMode === 'grid' ? 'רשת' : localViewMode === 'list' ? 'רשימה' : 'טבלה';


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

  const localTranscriptsInCurrent = useMemo(
    () => transcripts.filter((t: any) => (t.folder_id || null) === currentFolderId),
    [transcripts, currentFolderId],
  );

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

  const resolveItemName = useCallback((kind: 'folder' | 'transcript', id: string) => {
    if (kind === 'folder') return folders.find((f) => f.id === id)?.name || 'תיקייה';
    return transcripts.find((t: any) => t.id === id)?.title || 'תמלול';
  }, [folders, transcripts]);

  const resolveTargetName = useCallback((id: string | null) => {
    if (id === null) return 'הבית';
    return folders.find((f) => f.id === id)?.name || 'תיקייה';
  }, [folders]);

  const emitDropSnap = useCallback((targetId: string | null) => {
    window.dispatchEvent(new CustomEvent(DROP_SNAP_EVENT, { detail: { targetId } }));
  }, []);

  useEffect(() => {
    const onNativeStart = (ev: Event) => {
      const detail = (ev as CustomEvent<{ kind: 'folder' | 'transcript'; id: string; name: string }>).detail;
      if (!detail || (detail.kind !== 'folder' && detail.kind !== 'transcript') || !detail.id) return;
      setDragPreview({
        kind: detail.kind,
        id: detail.id,
        name: detail.name || resolveItemName(detail.kind, detail.id),
        targetName: null,
      });
    };

    const onNativeTarget = (ev: Event) => {
      const detail = (ev as CustomEvent<{ targetName?: string | null }>).detail;
      setDragPreview((prev) => (prev ? { ...prev, targetName: detail?.targetName ?? null } : prev));
    };

    const onNativeEnd = () => setDragPreview(null);

    window.addEventListener(NATIVE_DRAG_START_EVENT, onNativeStart as EventListener);
    window.addEventListener(NATIVE_DRAG_TARGET_EVENT, onNativeTarget as EventListener);
    window.addEventListener(NATIVE_DRAG_END_EVENT, onNativeEnd);
    return () => {
      window.removeEventListener(NATIVE_DRAG_START_EVENT, onNativeStart as EventListener);
      window.removeEventListener(NATIVE_DRAG_TARGET_EVENT, onNativeTarget as EventListener);
      window.removeEventListener(NATIVE_DRAG_END_EVENT, onNativeEnd);
    };
  }, [resolveItemName]);

  const handleDropLocalItemToFolder = useCallback(async (
    targetId: string | null,
    item: { kind: 'folder' | 'transcript'; id: string; name?: string }
  ) => {
    const targetFolder = folders.find((f) => f.id === targetId);
    try {
      if (item.kind === 'transcript') {
        await updateTranscript(item.id, { folder_id: targetId } as any);
        emitDropSnap(targetId);
        toast({ title: '✅ הועבר' });

        // If target folder is linked to Drive — also upload there with confirmation flow
        if (targetFolder?.drive_folder_id !== undefined && targetFolder?.drive_folder_id !== null) {
          const tr: any = transcripts.find((t: any) => t.id === item.id);
          if (tr) {
            driveUploadQueue.enqueue([{
              transcriptId: tr.id,
              title: tr.title || 'תמלול',
              text: tr.text || '',
              driveFolderId: targetFolder.drive_folder_id,
              driveFolderName: targetFolder.drive_folder_name || targetFolder.name,
            }]);
          }
        }
      } else if (item.kind === 'folder') {
        if (item.id === targetId) return;
        await moveFolder(item.id, targetId);
        emitDropSnap(targetId);
        toast({ title: '✅ תיקייה הועברה' });
      }
    } catch (err: any) {
      toast({ title: 'שגיאה בהעברה', description: err.message, variant: 'destructive' });
    } finally {
      setDragPreview(null);
    }
  }, [emitDropSnap, folders, moveFolder, transcripts, updateTranscript]);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    try {
      if (!over) return;
      const a = active.data.current as any;
      const o = over.data.current as any;
      if (!a || !o || o.kind !== 'folder') return;
      await handleDropLocalItemToFolder(o.id as string | null, { kind: a.kind, id: a.id });
    } finally {
      setDragPreview(null);
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

  const invokeDrive = async <T,>(body: Record<string, any>): Promise<T> => {
    const { data, error } = await supabase.functions.invoke('google-drive', { body });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as T;
  };

  const askCrossSystemAction = (label: string): CrossSystemAction => {
    const raw = window.prompt(`${label}\nבחר פעולה: copy / move / cancel`, 'copy');
    const v = (raw || '').trim().toLowerCase();
    if (v === 'move' || v === 'העבר') return 'move';
    if (v === 'cancel' || v === 'בטל') return 'cancel';
    return 'copy';
  };

  const askConflictResolution = (name: string): 'replace' | 'rename' | 'skip' => {
    const raw = window.prompt(`קיים כבר פריט בשם "${name}". בחר: replace / rename / skip`, 'rename');
    const v = (raw || '').trim().toLowerCase();
    if (v === 'replace' || v === 'דרוס') return 'replace';
    if (v === 'skip' || v === 'דלג') return 'skip';
    return 'rename';
  };

  const isDriveFolder = (mimeType: string) => mimeType === 'application/vnd.google-apps.folder';
  const isTextLike = (mimeType: string, name: string) =>
    /^text\//.test(mimeType) || /(json|xml|csv)/i.test(mimeType) || /\.(txt|md|json|csv|srt|vtt)$/i.test(name);

  const indexedName = (name: string, idx: number) => {
    const dot = name.lastIndexOf('.');
    if (dot > 0) return `${name.slice(0, dot)} (${idx})${name.slice(dot)}`;
    return `${name} (${idx})`;
  };

  const findDriveByName = async (name: string, parentId: string | null) => {
    const data = await invokeDrive<{ files?: Array<{ id: string; name: string; mimeType: string }> }>({
      action: 'findByName',
      name,
      parentId: parentId || undefined,
    });
    return data.files || [];
  };

  const resolveUniqueDriveName = async (name: string, parentId: string | null, folderOnly: boolean) => {
    for (let i = 1; i < 500; i++) {
      const candidate = i === 1 ? name : indexedName(name, i);
      const matches = (await findDriveByName(candidate, parentId)).filter((f) => folderOnly ? isDriveFolder(f.mimeType) : !isDriveFolder(f.mimeType));
      if (matches.length === 0) return candidate;
    }
    return `${name}-${Date.now()}`;
  };

  const ensureUserId = async () => {
    if (user?.id) return user.id;
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) throw new Error('יש להתחבר כדי לבצע פעולה זו');
    return data.user.id;
  };

  const createLocalTranscriptFromText = async (folderId: string | null, title: string, text: string) => {
    const uid = await ensureUserId();
    const existing = transcripts.find((t: any) => (t.folder_id || null) === folderId && (t.title || '').trim() === title.trim());
    let finalTitle = title;
    if (existing) {
      const resolution = askConflictResolution(title);
      if (resolution === 'skip') return false;
      if (resolution === 'replace') await deleteTranscript(existing.id);
      if (resolution === 'rename') {
        for (let i = 1; i < 500; i++) {
          const candidate = indexedName(title, i);
          const clash = transcripts.find((t: any) => (t.folder_id || null) === folderId && (t.title || '').trim() === candidate.trim());
          if (!clash) { finalTitle = candidate; break; }
        }
      }
    }

    const { error } = await supabase.from('transcripts').insert({
      user_id: uid,
      text,
      engine: 'drive-import',
      title: finalTitle,
      notes: 'Imported from Google Drive',
      tags: [],
      folder_id: folderId,
    } as any);
    if (error) throw error;
    return true;
  };

  const uploadTranscriptToDriveWithConflicts = async (
    targetFolder: { id: string | null; name: string },
    transcriptId: string,
  ) => {
    const tr = transcripts.find((t: any) => t.id === transcriptId);
    if (!tr) return false;

    const safeTitle = (tr.title || 'transcript').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'transcript';
    const fileName = `${safeTitle}.txt`;
    const existing = (await findDriveByName(fileName, targetFolder.id)).filter((f) => !isDriveFolder(f.mimeType));

    if (existing.length > 0) {
      const resolution = askConflictResolution(fileName);
      if (resolution === 'skip') return false;
      if (resolution === 'replace') {
        const base64 = btoa(unescape(encodeURIComponent(tr.text || '')));
        await invokeDrive({
          action: 'updateContent',
          fileId: existing[0].id,
          mimeType: 'text/plain;charset=utf-8',
          base64,
        });
        return true;
      }
      const uniqueName = await resolveUniqueDriveName(fileName, targetFolder.id, false);
      await uploadToDrive({
        name: uniqueName,
        mimeType: 'text/plain;charset=utf-8',
        content: tr.text || '',
        parents: targetFolder.id ? [targetFolder.id] : undefined,
      });
      return true;
    }

    await uploadToDrive({
      name: fileName,
      mimeType: 'text/plain;charset=utf-8',
      content: tr.text || '',
      parents: targetFolder.id ? [targetFolder.id] : undefined,
    });
    return true;
  };

  const copyLocalFolderToDriveRecursive = async (localFolderId: string, targetDriveParentId: string | null) => {
    const localFolder = folders.find((f) => f.id === localFolderId);
    if (!localFolder) return;

    const existingFolders = (await findDriveByName(localFolder.name, targetDriveParentId)).filter((f) => isDriveFolder(f.mimeType));
    let destinationId: string | null = null;
    if (existingFolders.length > 0) {
      const resolution = askConflictResolution(localFolder.name);
      if (resolution === 'skip') return;
      if (resolution === 'replace') destinationId = existingFolders[0].id;
    }
    if (!destinationId) {
      const folderName = existingFolders.length > 0 ? await resolveUniqueDriveName(localFolder.name, targetDriveParentId, true) : localFolder.name;
      const created = await invokeDrive<{ id: string }>({
        action: 'createFolder',
        name: folderName,
        parents: targetDriveParentId ? [targetDriveParentId] : undefined,
      });
      destinationId = created.id;
    }

    const childTranscripts = transcripts.filter((t: any) => (t.folder_id || null) === localFolderId);
    for (const tr of childTranscripts) {
      await uploadTranscriptToDriveWithConflicts({ id: destinationId, name: localFolder.name }, tr.id);
    }

    const childFolders = folders.filter((f) => f.parent_id === localFolderId);
    for (const child of childFolders) {
      await copyLocalFolderToDriveRecursive(child.id, destinationId);
    }
  };

  const handleDropLocalItemToDriveFolder = async (
    targetFolder: { id: string | null; name: string },
    item: LocalDragItem,
  ) => {
    const action = askCrossSystemAction(`מקומי -> Drive (${targetFolder.name})`);
    if (action === 'cancel') return;

    try {
      if (item.kind === 'transcript') {
        const uploaded = await uploadTranscriptToDriveWithConflicts(targetFolder, item.id);
        if (!uploaded) return;
        if (action === 'move') await deleteTranscript(item.id);
        toast({ title: action === 'move' ? '✅ הועבר ל-Drive' : '✅ הועתק ל-Drive' });
        return;
      }

      await copyLocalFolderToDriveRecursive(item.id, targetFolder.id);
      if (action === 'move') await deleteFolder(item.id);
      toast({ title: action === 'move' ? '✅ תיקייה הועברה ל-Drive' : '✅ תיקייה הועתקה ל-Drive', description: item.name || '' });
    } catch (e: any) {
      toast({ title: 'שגיאת העברה ל-Drive', description: e.message, variant: 'destructive' });
    }
  };

  const importDriveFileToLocalFolder = async (folderId: string | null, file: DriveDropFile, shouldMove: boolean) => {
    const data = await invokeDrive<{ base64: string; contentType?: string }>({ action: 'download', fileId: file.id });
    const mime = data.contentType || file.mimeType;

    if (isTextLike(mime, file.name)) {
      const title = file.name.replace(/\.[^.]+$/, '') || file.name;
      const text = new TextDecoder('utf-8').decode(Uint8Array.from(atob(data.base64), c => c.charCodeAt(0)));
      const created = await createLocalTranscriptFromText(folderId, title, text);
      if (!created) return;
    } else {
      const bin = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const importedFile = new File([bin], file.name, { type: mime });
      navigate('/', { state: { file: importedFile, targetFolderId: folderId } });
    }

    if (shouldMove) {
      await invokeDrive({ action: 'delete', fileId: file.id });
    }
  };

  const handleDropDriveFileToLocal = async (folderId: string | null, file: DriveDropFile) => {
    const action = askCrossSystemAction(`Drive -> מקומי (${file.name})`);
    if (action === 'cancel') return;
    try {
      await importDriveFileToLocalFolder(folderId, file, action === 'move');
      toast({ title: action === 'move' ? '✅ הועבר מ-Drive' : '✅ הועתק מ-Drive', description: file.name });
    } catch (e: any) {
      toast({ title: 'שגיאת ייבוא מ-Drive', description: e.message, variant: 'destructive' });
    }
  };

  const handleDropDriveFileToTreeFolder = async (parentLocalId: string | null, file: DriveDropFile) => {
    await handleDropDriveFileToLocal(parentLocalId, file);
  };

  const handleDropDriveFolderToTree = async (parentLocalId: string | null, drive: DriveDropFolder) => {
    const action = askCrossSystemAction(`תיקיית Drive -> מקומי (${drive.name})`);
    if (action === 'cancel') return;

    let createdFolders = 0;
    let importedTextFiles = 0;
    let skippedBinaryFiles = 0;
    const tInfo = toast({ title: '⏳ מייבא מבנה תיקיות מ-Drive…', description: drive.name });
    const mirror = async (driveFolderId: string, driveFolderName: string, localParentId: string | null) => {
      const created = await createFolder({
        name: driveFolderName,
        parent_id: localParentId,
        drive_folder_id: driveFolderId,
        drive_folder_name: driveFolderName,
        drive_synced_at: new Date().toISOString(),
      } as any);
      createdFolders++;
      const data = await invokeDrive<{ files?: Array<{ id: string; name: string; mimeType: string }> }>({
        action: 'list',
        folderId: driveFolderId,
        audioOnly: false,
        pageSize: 200,
      });
      const children = data.files || [];
      for (const c of children) {
        if (isDriveFolder(c.mimeType)) {
          await mirror(c.id, c.name, created.id);
        } else if (isTextLike(c.mimeType, c.name)) {
          await importDriveFileToLocalFolder(created.id, c, false);
          importedTextFiles++;
        } else {
          skippedBinaryFiles++;
        }
      }
    };
    try {
      await mirror(drive.id, drive.name, parentLocalId);
      if (action === 'move') {
        await invokeDrive({ action: 'delete', fileId: drive.id });
      }
      try { (tInfo as any)?.dismiss?.(); } catch {}
      toast({
        title: action === 'move' ? '✅ תיקייה הועברה מ-Drive' : '✅ תיקייה הועתקה מ-Drive',
        description: `${createdFolders} תיקיות · ${importedTextFiles} קבצי טקסט · ${skippedBinaryFiles} קבצים בינאריים דולגו`,
      });
    } catch (e: any) {
      toast({ title: 'שגיאת ייבוא מבנה', description: e.message, variant: 'destructive' });
    }
  };


  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        const a = e.active.data.current as any;
        if (!a || (a.kind !== 'folder' && a.kind !== 'transcript')) return;
        setDragPreview({
          kind: a.kind,
          id: a.id,
          name: resolveItemName(a.kind, a.id),
          targetName: null,
        });
      }}
      onDragOver={(e) => {
        if (!dragPreview) return;
        const o = e.over?.data?.current as any;
        if (!o || o.kind !== 'folder') {
          setDragPreview((prev) => (prev ? { ...prev, targetName: null } : prev));
          return;
        }
        const targetName = resolveTargetName(o.id as string | null);
        setDragPreview((prev) => (prev ? { ...prev, targetName } : prev));
      }}
      onDragCancel={() => setDragPreview(null)}
      onDragEnd={onDragEnd}
    >
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
          <div className="h-6 w-px bg-border mx-1 hidden sm:block" />
          <Button
            size="sm"
            variant={inlineDriveSplit ? 'default' : 'outline'}
            onClick={() => setInlineDriveSplit(v => !v)}
            title="תצוגה מפוצלת — מקומי לצד Google Drive עם גרירה בין העמודות"
            className="gap-1"
          >
            <Columns2 className="w-4 h-4" />
            <Cloud className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{inlineDriveSplit ? 'סגור מפוצל' : 'מפוצל + Drive'}</span>
          </Button>
        </div>

        {/* Body: tree + grid (+ optional Drive column). Stacks on mobile, splits on lg+ */}
        <div
          className={
            inlineDriveSplit
              ? 'grid grid-cols-1 lg:grid-cols-[240px_1fr_minmax(360px,1fr)] min-h-[600px]'
              : 'grid grid-cols-1 md:grid-cols-[260px_1fr] min-h-[600px]'
          }
        >
          <div className="border-b md:border-b-0 md:border-l bg-muted/10 max-h-[260px] md:max-h-none overflow-y-auto">
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
              onDropLocalItem={(parentId, item) => void handleDropLocalItemToFolder(parentId, item)}
              onDropDriveFolder={(parentId, drive) => void handleDropDriveFolderToTree(parentId, drive)}
              onDropDriveFile={(parentId, drive) => void handleDropDriveFileToTreeFolder(parentId, drive)}
            />
          </div>

          <div
            className="flex flex-col border-b lg:border-b-0 lg:border-l min-w-0"
            onDragOver={(e) => {
              if (!inlineDriveSplit) return;
              if (e.dataTransfer.types.includes('application/x-sht-drive-file')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(e) => {
              if (!inlineDriveSplit) return;
              const raw = e.dataTransfer.getData('application/x-sht-drive-file');
              if (!raw) return;
              e.preventDefault();
              try {
                const file = JSON.parse(raw) as DriveDropFile;
                void handleDropDriveFileToLocal(currentFolderId, file);
              } catch { /* ignore */ }
            }}
          >
            <div className="px-3 sm:px-4 py-2 border-b flex items-center justify-between gap-2" dir="rtl">
              <Breadcrumbs path={path} onNavigate={setCurrentFolderId} />
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={cycleLocalViewMode}
                  title={`תצוגת קבצים: ${localViewLabel}`}
                >
                  <LocalViewIcon className="w-4 h-4" />
                </Button>
                {selected.size > 0 && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2 shrink-0">
                    {selected.size} נבחרו
                    <button onClick={() => setSelected(new Set())}><X className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
            </div>
            {inlineDriveSplit && (
              <div className="px-3 sm:px-4 py-1.5 text-[11px] text-muted-foreground bg-yellow-50/40 dark:bg-yellow-950/10 border-b text-right" dir="rtl">
                גרור תמלול ל-Drive להעלאה · גרור תיקייה/קובץ מ-Drive לעץ התיקיות כדי לייבא (תיקייה = שכפול מבנה)
              </div>
            )}
            <div className="flex-1 p-3 sm:p-4 overflow-y-auto">
              <FileGrid
                items={itemsInCurrent}
                viewMode={localViewMode}
                selected={selected}
                cutIds={cutIds}
                onSelect={onSelect}
                onOpenFolder={setCurrentFolderId}
                onOpenTranscript={(id) => navigate(`/editor/${id}`)}
                onDeleteTranscript={async (id) => { if (confirm('למחוק תמלול זה?')) await deleteTranscript(id); }}
                onToggleFavorite={(t) => updateTranscript(t.id, { is_favorite: !t.is_favorite })}
                onTogglePinFolder={togglePin}
                onDeleteFolder={async (f) => { if (confirm(`למחוק את "${f.name}"?`)) await deleteFolder(f.id); }}
                onDropLocalItemToFolder={(targetFolderId, item) => void handleDropLocalItemToFolder(targetFolderId, item)}
              />
            </div>
          </div>

          {inlineDriveSplit && (
            <div className="bg-muted/5 p-2 sm:p-3 overflow-y-auto min-w-0" dir="rtl">
              <GoogleDriveBrowser
                onDropLocalItemToFolder={(folder, item) =>
                  void handleDropLocalItemToDriveFolder(folder, item)
                }
                onImportAudio={(file) => {
                  navigate('/', { state: { file } });
                }}
              />
            </div>
          )}
        </div>
      </Card>



      {/* New folder */}
      <Dialog open={!!newFolderOpen} onOpenChange={(o) => !o && setNewFolderOpen(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>תיקייה חדשה</DialogTitle>
            <DialogDescription>יצירת תיקייה חדשה בתוך עץ התיקיות המקומי.</DialogDescription>
          </DialogHeader>
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
          <DialogHeader>
            <DialogTitle>שינוי שם</DialogTitle>
            <DialogDescription>עדכון שם התיקייה הנוכחית.</DialogDescription>
          </DialogHeader>
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

      {/* (Drive browser dialog removed — the inline split view is the single source for Drive operations) */}


      {/* Floating upload status panel */}
      <DriveUploadStatus />

      <DragOverlay>
        {dragPreview ? (
          <div className="pointer-events-none rounded-lg border border-primary/30 bg-card/95 px-3 py-2 shadow-xl backdrop-blur-sm" dir="rtl">
            <div className="flex items-center gap-2 text-sm font-medium">
              {dragPreview.kind === 'folder' ? (
                <FolderIcon className="w-4 h-4 text-yellow-600" />
              ) : (
                <FileText className="w-4 h-4 text-blue-700" />
              )}
              <span className="max-w-[220px] truncate">{dragPreview.name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {dragPreview.targetName
                ? `העבר אל ${dragPreview.targetName}`
                : 'גרור אל תיקייה כדי להעביר'}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
