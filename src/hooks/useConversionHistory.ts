import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ConversionHistoryItem {
  id: string;
  user_id: string;
  file_name: string;
  original_name: string;
  output_format: string;
  file_size: number;
  output_size: number;
  duration_ms: number;
  folder: string;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export function useConversionHistory() {
  const { user, isAuthenticated } = useAuth();
  const [items, setItems] = useState<ConversionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("conversion_history" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setItems((data as any[]) || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const addItem = useCallback(async (item: {
    file_name: string;
    original_name: string;
    output_format: string;
    file_size: number;
    output_size: number;
    duration_ms: number;
    file_path?: string | null;
  }) => {
    if (!isAuthenticated || !user) return null;
    const { data, error } = await supabase
      .from("conversion_history" as any)
      .insert({
        user_id: user.id,
        file_name: item.file_name,
        original_name: item.original_name,
        output_format: item.output_format,
        file_size: item.file_size,
        output_size: item.output_size,
        duration_ms: item.duration_ms,
        file_path: item.file_path || null,
        folder: "",
      } as any)
      .select()
      .single();

    if (error) throw error;
    const newItem = data as any as ConversionHistoryItem;
    setItems((prev) => [newItem, ...prev]);
    return newItem;
  }, [isAuthenticated, user]);

  const updateName = useCallback(async (id: string, newName: string) => {
    const { error } = await supabase
      .from("conversion_history" as any)
      .update({ file_name: newName, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) throw error;
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, file_name: newName } : it));
  }, []);

  const updateOriginalName = useCallback(async (id: string, newName: string) => {
    const { error } = await supabase
      .from("conversion_history" as any)
      .update({ original_name: newName, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) throw error;
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, original_name: newName } : it));
  }, []);

  const updateFolder = useCallback(async (id: string, folder: string) => {
    const { error } = await supabase
      .from("conversion_history" as any)
      .update({ folder, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    if (error) throw error;
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, folder } : it));
  }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("conversion_history" as any)
      .delete()
      .in("id", ids);
    if (error) throw error;
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
  }, []);


  const removeItem = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("conversion_history" as any)
      .delete()
      .eq("id", id);
    if (error) throw error;
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const removeAll = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("conversion_history" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) throw error;
    setItems([]);
  }, [user]);

  return {
    items,
    loading,
    addItem,
    updateName,
    updateOriginalName,
    updateFolder,
    removeItem,
    removeMany,
    removeAll,
    refresh: fetchHistory,
  };
}
