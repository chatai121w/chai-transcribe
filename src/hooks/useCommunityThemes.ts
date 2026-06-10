import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { AppTheme } from './useTheme';
import { useAuth } from '@/contexts/AuthContext';

const ADMIN_EMAIL = 'jj1212t@gmail.com';
const LOCAL_KEY = 'app_community_themes';

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  name_he: string;
  colors: unknown;
  style: unknown;
  element_overrides: unknown;
}

function rowToTheme(row: CommunityRow): AppTheme {
  return {
    id: `community:${row.slug}`,
    name: row.name,
    nameHe: row.name_he,
    colors: row.colors as AppTheme['colors'],
    style: (row.style ?? undefined) as AppTheme['style'],
    elementOverrides: (row.element_overrides ?? []) as AppTheme['elementOverrides'],
    isCustom: false,
    source: 'community',
  };
}

export function useCommunityThemes() {
  const { user } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [themes, setThemes] = useState<AppTheme[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('community_themes')
        .select('id, slug, name, name_he, colors, style, element_overrides')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const mapped = (data ?? []).map(rowToTheme as (r: any) => AppTheme);
      setThemes(mapped);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(mapped));
      window.dispatchEvent(new Event('community-themes-updated'));
    } catch (e) {
      console.warn('[community-themes] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  /** Publish (insert/update) a theme to the community table. Admin only. */
  const publishTheme = useCallback(async (theme: AppTheme): Promise<{ ok: boolean; error?: string }> => {
    if (!isAdmin) return { ok: false, error: 'רק מנהל יכול לפרסם ערכות לכלל המשתמשים' };
    const slug = (theme.id.startsWith('community:') ? theme.id.slice('community:'.length) : theme.id)
      .replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    const payload = {
      slug,
      name: theme.name,
      name_he: theme.nameHe,
      colors: theme.colors as unknown as Record<string, unknown>,
      style: (theme.style ?? null) as unknown as Record<string, unknown> | null,
      element_overrides: (theme.elementOverrides ?? []) as unknown as Record<string, unknown>[],
      created_by: user?.id ?? null,
    };
    const { error } = await supabase
      .from('community_themes')
      .upsert([payload as any], { onConflict: 'slug' });
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }, [isAdmin, user, refresh]);

  return { themes, loading, refresh, publishTheme, isAdmin };
}
