import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { debugLog } from "@/lib/debugLogger";
import { FolderManager } from "@/components/FolderManager";
import { RecentFilesWidget } from "@/components/RecentFiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mic, FileText, Settings, LogIn, BarChart3, Clock, Zap, 
  FileEdit, Cloud, Grid3X3, Table2, RectangleHorizontal, LayoutGrid, FolderOpen, Plus, Pencil, Trash2
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { DashboardLayoutManager, type DashboardLayoutPreset, type DashboardStylePreset, type DashboardWidgetKey } from "@/components/dashboard/DashboardLayoutManager";

type RecentViewMode = 'cards' | 'table' | 'rectangles' | 'grid';

const DASHBOARD_STYLE_STORAGE_KEY = 'dashboard_style_preset_v1';
const DASHBOARD_LAYOUT_PRESETS_STORAGE_KEY = 'dashboard_layout_presets_v1';
const DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY = 'dashboard_active_layout_id_v1';

const DEFAULT_LAYOUT_PRESETS: DashboardLayoutPreset[] = [
  { id: 'classic', label: 'קלאסי', baseStyle: 'classic' },
  { id: 'studio', label: 'סטודיו', baseStyle: 'studio' },
  { id: 'compact', label: 'קומפקטי', baseStyle: 'compact' },
];

const BASE_STYLE_META: Record<DashboardStylePreset, { preview: string; blocks: [string, string, string] }> = {
  classic: {
    preview: 'bg-gradient-to-b from-background via-accent/10 to-background',
    blocks: ['bg-primary/50', 'bg-accent/40', 'bg-muted/80'],
  },
  studio: {
    preview: 'bg-gradient-to-b from-background via-primary/15 to-background',
    blocks: ['bg-primary/70', 'bg-secondary/60', 'bg-accent/45'],
  },
  compact: {
    preview: 'bg-muted/30',
    blocks: ['bg-foreground/20', 'bg-foreground/15', 'bg-foreground/10'],
  },
};

function loadDashboardStylePreset(): DashboardStylePreset {
  try {
    const raw = localStorage.getItem(DASHBOARD_STYLE_STORAGE_KEY);
    if (raw === 'classic' || raw === 'studio' || raw === 'compact') return raw;
  } catch {
    // ignore storage errors and fallback to default
  }
  return 'classic';
}

function parseTabSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed payload
  }
  return {};
}

function readPresetFromTabSettings(raw: string | null | undefined): DashboardStylePreset | null {
  const parsed = parseTabSettings(raw);
  const value = parsed.dashboard_style_preset;
  if (value === 'classic' || value === 'studio' || value === 'compact') return value;
  return null;
}

function isBaseStyle(value: unknown): value is DashboardStylePreset {
  return value === 'classic' || value === 'studio' || value === 'compact';
}

function sanitizeLayoutPresets(value: unknown): DashboardLayoutPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const validWidgets = new Set<DashboardWidgetKey>(['recent_transcripts', 'folders', 'stats', 'recorder', 'youtube', 'search']);
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const maybe = item as Record<string, unknown>;
      const id = typeof maybe.id === 'string' ? maybe.id.trim() : '';
      const label = typeof maybe.label === 'string' ? maybe.label.trim() : '';
      const baseStyle = maybe.baseStyle;
      if (!id || !label || !isBaseStyle(baseStyle) || seen.has(id)) return null;
      seen.add(id);
      const widgets = Array.isArray(maybe.widgets)
        ? (maybe.widgets.filter((w): w is DashboardWidgetKey => typeof w === 'string' && validWidgets.has(w as DashboardWidgetKey)))
        : undefined;
      const columnsRaw = maybe.columns;
      const columns = columnsRaw === 1 || columnsRaw === 2 || columnsRaw === 3 ? columnsRaw : undefined;
      const density = typeof maybe.density === 'number' && maybe.density >= 0 && maybe.density <= 100 ? maybe.density : undefined;
      const isDefault = maybe.isDefault === true ? true : undefined;
      return { id, label, baseStyle, widgets, columns, density, isDefault } as DashboardLayoutPreset;
    })
    .filter((preset): preset is DashboardLayoutPreset => !!preset);
}

function readLayoutsFromTabSettings(raw: string | null | undefined): DashboardLayoutPreset[] | null {
  const parsed = parseTabSettings(raw);
  const presets = sanitizeLayoutPresets(parsed.dashboard_layout_presets);
  return presets.length ? presets : null;
}

function readActiveLayoutIdFromTabSettings(raw: string | null | undefined): string | null {
  const parsed = parseTabSettings(raw);
  const value = parsed.dashboard_active_layout_id;
  return typeof value === 'string' && value.trim() ? value : null;
}

function loadLayoutPresetsFromStorage(): DashboardLayoutPreset[] {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_PRESETS_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT_PRESETS;
    const parsed = JSON.parse(raw);
    const presets = sanitizeLayoutPresets(parsed);
    return presets.length ? presets : DEFAULT_LAYOUT_PRESETS;
  } catch {
    return DEFAULT_LAYOUT_PRESETS;
  }
}

function loadActiveLayoutIdFromStorage(): string | null {
  try {
    return localStorage.getItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { transcripts, stats, isLoading, updateTranscript, deleteTranscript, getAudioUrl } = useCloudTranscripts();
  const { preferences, updatePreference } = useCloudPreferences();

  useEffect(() => {
    debugLog.info('Dashboard', '📊 Dashboard mounted');
    return () => debugLog.info('Dashboard', '📊 Dashboard unmounted');
  }, []);

  useEffect(() => {
    if (!isLoading) {
      debugLog.info('Dashboard', `📊 נתונים נטענו: ${transcripts.length} תמלולים`, stats);
    }
  }, [isLoading, transcripts.length, stats]);

  const recentTranscripts = transcripts.slice(0, 5);
  const [layoutPresets, setLayoutPresets] = useState<DashboardLayoutPreset[]>(() => {
    const fromCloud = readLayoutsFromTabSettings(preferences.tab_settings_json);
    return fromCloud ?? loadLayoutPresetsFromStorage();
  });
  const [activeLayoutId, setActiveLayoutId] = useState<string>(() => {
    const cloudId = readActiveLayoutIdFromTabSettings(preferences.tab_settings_json);
    if (cloudId) return cloudId;
    const localId = loadActiveLayoutIdFromStorage();
    if (localId) return localId;
    const legacyStyle = readPresetFromTabSettings(preferences.tab_settings_json) ?? loadDashboardStylePreset();
    const match = DEFAULT_LAYOUT_PRESETS.find((preset) => preset.baseStyle === legacyStyle);
    return match?.id ?? DEFAULT_LAYOUT_PRESETS[0].id;
  });
  const [isLayoutManagerOpen, setIsLayoutManagerOpen] = useState(false);
  const [layoutDrafts, setLayoutDrafts] = useState<DashboardLayoutPreset[]>([]);

  const activeLayout = useMemo(
    () => layoutPresets.find((preset) => preset.id === activeLayoutId) ?? layoutPresets[0] ?? DEFAULT_LAYOUT_PRESETS[0],
    [layoutPresets, activeLayoutId],
  );
  const stylePreset = activeLayout.baseStyle;

  const recentViewMode = (preferences.dashboard_view_mode || 'cards') as RecentViewMode;
  const setRecentViewMode = useCallback((mode: RecentViewMode) => {
    updatePreference('dashboard_view_mode', mode);
  }, [updatePreference]);

  const persistLayoutState = useCallback((nextPresets: DashboardLayoutPreset[], nextActiveId: string) => {
    const safePresets = sanitizeLayoutPresets(nextPresets);
    const finalPresets = safePresets.length ? safePresets : DEFAULT_LAYOUT_PRESETS;
    const hasActive = finalPresets.some((preset) => preset.id === nextActiveId);
    const finalActiveId = hasActive ? nextActiveId : finalPresets[0].id;
    const finalActiveStyle = finalPresets.find((preset) => preset.id === finalActiveId)?.baseStyle ?? 'classic';

    setLayoutPresets(finalPresets);
    setActiveLayoutId(finalActiveId);

    try {
      localStorage.setItem(DASHBOARD_STYLE_STORAGE_KEY, finalActiveStyle);
      localStorage.setItem(DASHBOARD_LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(finalPresets));
      localStorage.setItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY, finalActiveId);
    } catch {
      // ignore storage errors
    }

    const base = parseTabSettings(preferences.tab_settings_json);
    const merged = {
      ...base,
      dashboard_style_preset: finalActiveStyle,
      dashboard_layout_presets: finalPresets,
      dashboard_active_layout_id: finalActiveId,
    };
    updatePreference('tab_settings_json', JSON.stringify(merged));
  }, [preferences.tab_settings_json, updatePreference]);

  const setStylePreset = useCallback((layoutId: string) => {
    persistLayoutState(layoutPresets, layoutId);
  }, [layoutPresets, persistLayoutState]);

  useEffect(() => {
    const cloudLayouts = readLayoutsFromTabSettings(preferences.tab_settings_json);
    const cloudActiveId = readActiveLayoutIdFromTabSettings(preferences.tab_settings_json);

    if (cloudLayouts && cloudLayouts.length) {
      const nextActiveId = cloudActiveId && cloudLayouts.some((preset) => preset.id === cloudActiveId)
        ? cloudActiveId
        : cloudLayouts[0].id;

      const currentSnapshot = JSON.stringify(layoutPresets);
      const cloudSnapshot = JSON.stringify(cloudLayouts);

      if (cloudSnapshot !== currentSnapshot || nextActiveId !== activeLayoutId) {
        setLayoutPresets(cloudLayouts);
        setActiveLayoutId(nextActiveId);
        try {
          localStorage.setItem(DASHBOARD_LAYOUT_PRESETS_STORAGE_KEY, cloudSnapshot);
          localStorage.setItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY, nextActiveId);
          const cloudStyle = cloudLayouts.find((preset) => preset.id === nextActiveId)?.baseStyle ?? 'classic';
          localStorage.setItem(DASHBOARD_STYLE_STORAGE_KEY, cloudStyle);
        } catch {
          // ignore storage errors
        }
      }
      return;
    }

    const legacyStyle = readPresetFromTabSettings(preferences.tab_settings_json);
    if (legacyStyle) {
      const fallbackId = layoutPresets.find((preset) => preset.baseStyle === legacyStyle)?.id ?? layoutPresets[0]?.id;
      if (fallbackId && fallbackId !== activeLayoutId) {
        setActiveLayoutId(fallbackId);
      }
    }
  }, [preferences.tab_settings_json, layoutPresets, activeLayoutId]);

  const pageToneClass =
    stylePreset === 'studio'
      ? 'bg-gradient-to-b from-background via-primary/5 to-background'
      : stylePreset === 'compact'
      ? 'bg-background'
      : 'bg-gradient-to-b from-background via-accent/5 to-background';
  const shellClass = stylePreset === 'compact' ? 'max-w-7xl mx-auto space-y-5' : 'max-w-6xl mx-auto space-y-8';

  const openLayoutManager = useCallback(() => {
    setLayoutDrafts(layoutPresets.map((preset) => ({ ...preset })));
    setIsLayoutManagerOpen(true);
  }, [layoutPresets]);

  const addLayoutDraft = useCallback(() => {
    setLayoutDrafts((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}-${prev.length + 1}`,
        label: `פריסה ${prev.length + 1}`,
        baseStyle: stylePreset,
      },
    ]);
  }, [stylePreset]);

  const saveLayoutDrafts = useCallback(() => {
    const normalized = sanitizeLayoutPresets(
      layoutDrafts.map((preset) => ({
        ...preset,
        label: preset.label.trim() || 'פריסה ללא שם',
      })),
    );
    const finalPresets = normalized.length ? normalized : DEFAULT_LAYOUT_PRESETS;
    const finalActiveId = finalPresets.some((preset) => preset.id === activeLayoutId)
      ? activeLayoutId
      : finalPresets[0].id;
    persistLayoutState(finalPresets, finalActiveId);
    setIsLayoutManagerOpen(false);
  }, [layoutDrafts, activeLayoutId, persistLayoutState]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const estimateWords = (chars: number) => Math.round(chars / 5);

  const normalizeForCompare = (value: string) =>
    value
      .replace(/\s+/g, ' ')
      .replace(/["'`.,;:!?()\[\]{}<>\\/|\-]/g, '')
      .trim()
      .toLowerCase();

  const isDuplicatePreview = (title: string, preview: string) => {
    const normTitle = normalizeForCompare(title);
    const normPreview = normalizeForCompare(preview);
    if (!normTitle || !normPreview) return false;
    return normPreview === normTitle || normPreview.startsWith(normTitle);
  };

  const getSafeTranscriptText = (transcript: { title?: string | null; text?: string | null; edited_text?: string | null }) => {
    const content = (transcript.edited_text ?? transcript.text ?? "").trim();
    const explicitTitle = transcript.title?.trim() || "";
    const title = explicitTitle || content.substring(0, 50) || "ללא טקסט";
    const preview = content || transcript.title?.trim() || "ללא טקסט";
    const showPreview = content.length > 0 && !isDuplicatePreview(title, content);
    return { title, preview, showPreview };
  };

  return (
    <div className={`min-h-screen ${pageToneClass} px-4 pb-4 pt-0 md:px-8 md:pb-8 md:pt-0`} dir="rtl">
      <div className={shellClass}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="fixed top-3 left-3 z-[61]">
            <div className="group/quick-controls relative">
              <div className="h-10 w-24" aria-hidden="true" />
              <div className="absolute left-0 top-0 flex items-center gap-2 rounded-xl border bg-card/80 p-1.5 backdrop-blur-sm opacity-0 translate-y-1 pointer-events-none transition-all duration-150 group-hover/quick-controls:opacity-100 group-hover/quick-controls:translate-y-0 group-hover/quick-controls:pointer-events-auto group-focus-within/quick-controls:opacity-100 group-focus-within/quick-controls:translate-y-0 group-focus-within/quick-controls:pointer-events-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-2 text-foreground hover:text-foreground/80 hover:bg-transparent"
                  onClick={() => navigate("/settings")}
                  title="הגדרות"
                >
                  <Settings className="h-5 w-5" />
                </Button>
                <DropdownMenu dir="rtl">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-2 text-foreground hover:text-foreground/80 hover:bg-transparent"
                      title="פריסות"
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[300px]">
                    <DropdownMenuLabel>בחירת פריסה</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="grid grid-cols-2 gap-2 p-2 max-h-[320px] overflow-auto">
                      {layoutPresets.map((preset) => {
                        const preview = BASE_STYLE_META[preset.baseStyle];
                        return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setStylePreset(preset.id)}
                          className={`rounded-lg border p-1.5 transition-all ${
                            activeLayoutId === preset.id
                              ? 'border-primary bg-primary/10 shadow-sm'
                              : 'border-border/70 hover:border-primary/50 hover:bg-accent/40'
                          }`}
                          title={`החלפה לפריסת ${preset.label}`}
                        >
                          <div className={`h-7 w-full rounded-md p-1 ${preview.preview}`}>
                            <div className={`h-1.5 w-full rounded ${preview.blocks[0]}`} />
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <div className={`h-3 rounded ${preview.blocks[1]}`} />
                              <div className={`h-3 rounded ${preview.blocks[2]}`} />
                            </div>
                          </div>
                          <div className="mt-1 text-center text-[11px] font-medium">{preset.label}</div>
                        </button>
                        );
                      })}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={openLayoutManager}>
                      <Pencil className="w-4 h-4 ml-2" />
                      עריכת פריסות
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          {!isAuthenticated && (
            <Button variant="outline" onClick={() => navigate("/login")}>
              <LogIn className="h-4 w-4 ml-2" />
              התחבר
            </Button>
          )}
        </div>

        {/* Quick Actions */}
        <section className="relative overflow-hidden rounded-3xl border border-accent/45 bg-gradient-to-br from-card via-card to-secondary/35 px-6 py-7 shadow-[var(--app-shadow)] mb-4 md:mb-6 md:px-10 md:py-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent/20 via-accent to-accent/20" />
          <div className="pointer-events-none absolute -left-12 -top-16 h-44 w-44 rounded-full bg-accent/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative space-y-6">
            <div className="space-y-2 text-center">
              <p className="text-xs font-semibold tracking-[0.2em] text-primary/70">SMART HEBREW TRANSCRIBER</p>
              <p className="text-3xl font-black leading-tight text-accent md:text-5xl">מערכת תמלול מתקדמת</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Button
                variant="outline"
                className="h-12 justify-center border-primary/25 bg-background/70 text-foreground hover:bg-primary hover:text-primary-foreground"
                onClick={() => navigate("/transcribe")}
              >
                <Mic className="ml-2 h-4 w-4" />
                תמלול חדש
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-center border-primary/25 bg-background/70 text-foreground hover:bg-primary hover:text-primary-foreground"
                onClick={() => navigate("/text-editor")}
              >
                <FileEdit className="ml-2 h-4 w-4" />
                עריכת טקסט
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-center border-primary/25 bg-background/70 text-foreground hover:bg-primary hover:text-primary-foreground"
                onClick={() => navigate("/folders")}
              >
                <FolderOpen className="ml-2 h-4 w-4" />
                מנהל קבצים
              </Button>
            </div>
          </div>
        </section>
        {/* Stats */}
        {isAuthenticated && (
          <div className={stylePreset === 'compact' ? 'pt-5 grid grid-cols-2 md:grid-cols-4 gap-3 md:pt-7' : 'pt-7 grid grid-cols-2 md:grid-cols-4 gap-4 md:pt-10'}>
            <Card>
              <CardContent className="p-5 text-center md:py-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">סה״כ תמלולים</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center md:py-6">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-2">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <p className="text-2xl font-bold">{estimateWords(stats.totalChars).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">מילים בסה״כ</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center md:py-6">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mx-auto mb-2">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <p className="text-2xl font-bold">{stats.engines.length}</p>
                <p className="text-xs text-muted-foreground">מנועים בשימוש</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center md:py-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <Cloud className="w-5 h-5 text-primary" />
                </div>
                <div className="text-2xl font-bold">
                  <Badge variant="secondary" className="text-xs">מסונכרן</Badge>
                </div>
                <p className="text-xs text-muted-foreground">שמירה בענן</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Transcripts */}
        {recentTranscripts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <CardTitle className="text-xl">תמלולים אחרונים</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu dir="rtl">
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8" title="תצוגה">
                        {recentViewMode === 'cards' ? <LayoutGrid className="w-4 h-4" /> : recentViewMode === 'table' ? <Table2 className="w-4 h-4" /> : recentViewMode === 'rectangles' ? <RectangleHorizontal className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>תצוגה</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className={recentViewMode === 'cards' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('cards')}>
                        <LayoutGrid className="w-4 h-4 ml-2" />כרטיסיות
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'table' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('table')}>
                        <Table2 className="w-4 h-4 ml-2" />טבלה
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'rectangles' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('rectangles')}>
                        <RectangleHorizontal className="w-4 h-4 ml-2" />מלבנים
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'grid' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('grid')}>
                        <Grid3X3 className="w-4 h-4 ml-2" />רשת
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/transcribe")}>
                    הצג הכל
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {recentViewMode === 'table' ? (
                <div className="rounded-lg border overflow-hidden" dir="rtl">
                  <table className="w-full text-sm" dir="rtl">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-right px-3 py-2 font-medium">כותרת</th>
                        <th className="text-right px-3 py-2 font-medium">מנוע</th>
                        <th className="text-right px-3 py-2 font-medium">תאריך</th>
                        <th className="text-right px-3 py-2 font-medium">תגיות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTranscripts.map((t) => {
                        const { title, preview } = getSafeTranscriptText(t);
                        return (
                          <tr
                            key={t.id}
                            className="border-t hover:bg-accent/30 cursor-pointer"
                            onClick={() => navigate('/text-editor', { state: { text: t.edited_text ?? t.text ?? preview, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                          >
                            <td className="px-3 py-2 text-right truncate max-w-[280px]">{title}</td>
                            <td className="px-3 py-2 text-right">{t.engine}</td>
                            <td className="px-3 py-2 text-right">{formatDate(t.created_at)}</td>
                            <td className="px-3 py-2 text-right">{t.tags?.length || 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={recentViewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-2' : 'space-y-2'}>
                  {recentTranscripts.map((t) => {
                    const { title, preview, showPreview } = getSafeTranscriptText(t);
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center justify-between rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer ${
                          recentViewMode === 'rectangles' ? 'p-2' : 'p-3'
                        }`}
                        onClick={() => navigate('/text-editor', { state: { text: t.edited_text ?? t.text ?? preview, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{title}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(t.created_at)}</p>
                            {recentViewMode !== 'rectangles' && showPreview && (
                              <p className="text-xs text-muted-foreground truncate mt-1">{preview.substring(0, 90)}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{t.engine}</Badge>
                          {t.tags && t.tags.length > 0 && (
                            <Badge variant="secondary" className="text-xs">{t.tags.length} תגיות</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Folder Manager */}
        {isAuthenticated && transcripts.length > 0 && (
          <FolderManager
            transcripts={transcripts}
            onUpdate={(id, updates) => updateTranscript(id, updates)}
            onDelete={deleteTranscript}
            onGetAudioUrl={getAudioUrl}
          />
        )}

        {/* Recent Local Files (localStorage-based, works without auth) */}
        <RecentFilesWidget />

        {/* Empty state for non-authenticated */}
        {!isAuthenticated && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Cloud className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">התחבר כדי לשמור את התמלולים שלך</h3>
              <p className="text-sm text-muted-foreground mb-4">
                שמירה בענן, גישה מכל מכשיר, וסטטיסטיקות שימוש
              </p>
              <Button onClick={() => navigate("/login")}>
                <LogIn className="w-4 h-4 ml-2" />
                התחבר עכשיו
              </Button>
            </CardContent>
          </Card>
        )}

        <DashboardLayoutManager
          open={isLayoutManagerOpen}
          onOpenChange={setIsLayoutManagerOpen}
          presets={layoutPresets}
          activeId={activeLayoutId}
          onSave={(nextPresets, nextActive) => persistLayoutState(nextPresets, nextActive)}
        />
      </div>
    </div>
  );
};

export default Dashboard;
