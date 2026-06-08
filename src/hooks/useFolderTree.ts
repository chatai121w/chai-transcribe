import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

export interface FolderNode {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  emoji: string | null;
  pinned: boolean;
  position: number;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  drive_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderTreeNode extends FolderNode {
  children: FolderTreeNode[];
  depth: number;
}

export const useFolderTree = () => {
  const { user, isAuthenticated } = useAuth();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('folders' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('pinned', { ascending: false })
        .order('position', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setFolders((data || []) as unknown as FolderNode[]);
    } catch (e: any) {
      toast({ title: 'שגיאה בטעינת תיקיות', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (isAuthenticated) refetch(); }, [isAuthenticated, refetch]);

  // realtime
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const ch = supabase
      .channel(`folders-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folders', filter: `user_id=eq.${user.id}` }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAuthenticated, user, refetch]);

  const tree = useMemo<FolderTreeNode[]>(() => {
    const byParent = new Map<string | null, FolderNode[]>();
    folders.forEach(f => {
      const k = f.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(f);
    });
    const build = (parent: string | null, depth: number): FolderTreeNode[] => {
      const arr = byParent.get(parent) || [];
      return arr.map(f => ({ ...f, depth, children: build(f.id, depth + 1) }));
    };
    return build(null, 0);
  }, [folders]);

  const createFolder = useCallback(async (input: Partial<FolderNode> & { name: string }) => {
    if (!user) throw new Error('not authed');
    const payload = {
      user_id: user.id,
      name: input.name,
      parent_id: input.parent_id ?? null,
      color: input.color ?? null,
      emoji: input.emoji ?? null,
      pinned: input.pinned ?? false,
      position: input.position ?? 0,
    };
    const { data, error } = await supabase.from('folders' as any).insert(payload).select().single();
    if (error) throw error;
    await refetch();
    return data as unknown as FolderNode;
  }, [user, refetch]);

  const updateFolder = useCallback(async (id: string, patch: Partial<FolderNode>) => {
    const { error } = await supabase.from('folders' as any).update(patch).eq('id', id);
    if (error) throw error;
    await refetch();
  }, [refetch]);

  const deleteFolder = useCallback(async (id: string) => {
    const { error } = await supabase.from('folders' as any).delete().eq('id', id);
    if (error) throw error;
    await refetch();
  }, [refetch]);

  const moveFolder = useCallback(async (id: string, newParentId: string | null) => {
    // prevent moving into self/descendants
    const isDescendant = (parent: string | null): boolean => {
      if (!parent) return false;
      if (parent === id) return true;
      const f = folders.find(x => x.id === parent);
      return f ? isDescendant(f.parent_id) : false;
    };
    if (isDescendant(newParentId)) {
      toast({ title: 'לא ניתן להעביר תיקייה אל תוך עצמה', variant: 'destructive' });
      return;
    }
    await updateFolder(id, { parent_id: newParentId });
  }, [folders, updateFolder]);

  const togglePin = useCallback(async (id: string) => {
    const f = folders.find(x => x.id === id);
    if (!f) return;
    await updateFolder(id, { pinned: !f.pinned });
  }, [folders, updateFolder]);

  const getPath = useCallback((id: string | null): FolderNode[] => {
    const path: FolderNode[] = [];
    let cur = id;
    while (cur) {
      const f = folders.find(x => x.id === cur);
      if (!f) break;
      path.unshift(f);
      cur = f.parent_id;
    }
    return path;
  }, [folders]);

  return { folders, tree, loading, refetch, createFolder, updateFolder, deleteFolder, moveFolder, togglePin, getPath };
};
