import { useState } from 'react';
import { Save, ChevronDown, Copy, FilePlus, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { BUILT_IN_THEMES, useTheme } from '@/hooks/useTheme';
import { useCommunityThemes } from '@/hooks/useCommunityThemes';
import { useCloudPreferences } from '@/hooks/useCloudPreferences';
import { useDesignMode } from './DesignModeProvider';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/** Persist current design overrides globally — local already done; cloud with retry. */
async function syncGlobalOverridesToCloud(userId: string, overrides: unknown[], attempt = 1): Promise<boolean> {
  try {
    const { error } = await (supabase.from('user_preferences') as any).upsert(
      { user_id: userId, design_overrides: overrides, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    return true;
  } catch (e) {
    if (attempt < 4) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return syncGlobalOverridesToCloud(userId, overrides, attempt + 1);
    }
    console.warn('[design-save] cloud sync failed after retries', e);
    return false;
  }
}

/**
 * Save menu for Live Design Mode.
 * - Save        → overwrite the currently active CUSTOM theme.
 * - Save as new → create a brand-new custom theme from current state.
 * - Publish     → admin-only: push active theme to community_themes (visible to all users).
 * All theme writes are persisted both locally and to the cloud (custom_themes column).
 */
export function DesignModeSaveMenu() {
  const { activeThemeId, allThemes, customThemes, saveCustomTheme, setTheme } = useTheme();
  const { publishTheme, isAdmin } = useCommunityThemes();
  const { updatePreferences } = useCloudPreferences();
  const { overrides, clearAll } = useDesignMode();
  const [busy, setBusy] = useState(false);

  const activeTheme = allThemes.find(t => t.id === activeThemeId) ?? BUILT_IN_THEMES[0];
  const isBuiltInActive = BUILT_IN_THEMES.some(t => t.id === activeThemeId);
  const isCommunityActive = activeTheme.source === 'community';
  const hasChanges = overrides.length > 0;

  const syncCustomToCloud = (nextCustom: typeof customThemes) => {
    try {
      updatePreferences({ custom_themes: JSON.stringify(nextCustom) });
    } catch (e) {
      console.warn('[design-save] cloud sync failed', e);
    }
  };

  const { user } = useAuth();

  /** Save → overwrite active custom theme, OR save globally if active is built-in/community. */
  const handleSave = async () => {
    setBusy(true);
    try {
      // Built-in or community theme → save as GLOBAL overrides (no new theme).
      if (isBuiltInActive || isCommunityActive) {
        // Local persistence already happened on every change (design_overrides_v1).
        // Now sync to cloud in the background with retry + warning toast on failure.
        toast.success(`נשמר במחשב (${overrides.length} שינויים) — מסנכרן לענן…`);
        if (user?.id) {
          syncGlobalOverridesToCloud(user.id, overrides).then(ok => {
            if (ok) toast.success('סונכרן לענן ✓');
            else toast.warning('שינויים שמורים מקומית — סנכרון לענן נכשל. ננסה שוב בהפעלה הבאה.');
          });
        } else {
          toast.warning('שינויים שמורים מקומית בלבד — לא מחובר לחשבון.');
        }
        return;
      }
      // Custom theme → overwrite it.
      const updated = { ...activeTheme, elementOverrides: [...overrides], isCustom: true };
      saveCustomTheme(updated);
      const next = customThemes.some(t => t.id === updated.id)
        ? customThemes.map(t => t.id === updated.id ? updated : t)
        : [...customThemes, updated];
      syncCustomToCloud(next);
      clearAll();
      toast.success(`נשמר ב-"${updated.nameHe}"`);
    } finally {
      setBusy(false);
    }
  };

  /** Save As New → prompt for name, create new custom theme. */
  const handleSaveAsNew = async () => {
    const name = window.prompt('שם הערכה החדשה:', `${activeTheme.nameHe} (עותק)`);
    if (!name) return;
    setBusy(true);
    try {
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newTheme = {
        ...activeTheme,
        id,
        name,
        nameHe: name,
        isCustom: true,
        source: 'custom' as const,
        elementOverrides: [...overrides],
      };
      saveCustomTheme(newTheme);
      const next = [...customThemes, newTheme];
      syncCustomToCloud(next);
      setTheme(id);
      clearAll();
      toast.success(`נוצרה ערכה חדשה: "${name}"`);
    } finally {
      setBusy(false);
    }
  };

  /** Publish (admin only) → upload active theme to community_themes. */
  const handlePublish = async () => {
    if (!isAdmin) {
      toast.error('רק מנהל יכול לפרסם ערכות לכלל המשתמשים');
      return;
    }
    const themeToPublish = (isBuiltInActive || hasChanges)
      ? { ...activeTheme, elementOverrides: [...overrides] }
      : activeTheme;
    const name = window.prompt('שם הערכה לפרסום לכל המשתמשים:', themeToPublish.nameHe);
    if (!name) return;
    setBusy(true);
    try {
      const res = await publishTheme({ ...themeToPublish, name, nameHe: name });
      if (res.ok) {
        toast.success(`"${name}" פורסם לכל המשתמשים`);
      } else {
        toast.error(`פרסום נכשל: ${res.error ?? 'שגיאה לא ידועה'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title="אפשרויות שמירה"
          className="gap-1"
        >
          <Save className="h-3.5 w-3.5" />
          שמור
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuLabel className="text-right text-[11px] text-muted-foreground">
          ערכה פעילה: {activeTheme.nameHe}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSave}
          disabled={busy || (!hasChanges && !isBuiltInActive && !isCommunityActive)}
          className="flex flex-row-reverse items-center justify-between gap-2"
        >
          <Save className="h-4 w-4" />
          <div className="text-right">
            <div>שמור (דרוס את הערכה הפעילה)</div>
            <div className="text-[10px] text-muted-foreground">
              {isBuiltInActive || isCommunityActive ? 'מובנית — ייפתח שמור כחדשה' : `${overrides.length} שינויים`}
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleSaveAsNew}
          disabled={busy}
          className="flex flex-row-reverse items-center justify-between gap-2"
        >
          <FilePlus className="h-4 w-4" />
          <div className="text-right">
            <div>שמור כערכה חדשה</div>
            <div className="text-[10px] text-muted-foreground">שכפול ושינוי שם</div>
          </div>
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handlePublish}
              disabled={busy}
              className="flex flex-row-reverse items-center justify-between gap-2"
            >
              <UploadCloud className="h-4 w-4 text-yellow-600" />
              <div className="text-right">
                <div className="text-yellow-700 dark:text-yellow-500">פרסם לכל המשתמשים</div>
                <div className="text-[10px] text-muted-foreground">מנהל בלבד</div>
              </div>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
