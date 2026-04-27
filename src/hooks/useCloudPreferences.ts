import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { db, isDbAvailable } from '@/lib/localDb';
import { getLocalPreferences, savePreferencesLocally, syncPreferencesDown } from '@/lib/syncEngine';

export interface UserPreferences {
  font_size: number;
  font_family: string;
  text_color: string;
  line_height: number;
  sidebar_pinned: boolean;
  theme: string;          // theme ID (e.g. 'default', 'royal-gold')
  engine: string;         // transcription engine
  source_language: string; // source language for transcription
  custom_themes: string;  // JSON string of custom themes array
  editor_columns: number; // 1, 2, or 3 column text display
  // UI view preferences
  dashboard_view_mode: string; // 'cards' | 'table' | 'rectangles' | 'grid'
  folder_view_mode: string;    // 'cards' | 'table' | 'rectangles' | 'grid'
  folder_sort_key: string;     // 'date' | 'name' | 'engine' | 'folder'
  folder_sort_asc: boolean;
  player_layout: string;       // 'split' | 'stacked' | 'full'
  tab_settings_json: string;   // JSON string of { visible, order }
  default_ai_model: string;    // preferred AI editing model
  // CUDA / transcription settings
  cuda_preset: string;         // 'fast' | 'balanced' | 'accurate'
  cuda_fast_mode: boolean;
  cuda_compute_type: string;   // 'int8_float16' | 'float16' | 'int8'
  cuda_beam_size: number;
  cuda_no_condition_prev: boolean;
  cuda_vad_aggressive: boolean;
  cuda_hotwords: string;
  cuda_paragraph_threshold: number;
  cuda_preload_mode: string;   // 'preload' | 'direct'
  cuda_cloud_save: string;     // 'immediate' | 'text-only' | 'skip'
}

const DEFAULT_PREFERENCES: UserPreferences = {
  font_size: 16,
  font_family: 'Assistant',
  text_color: 'hsl(var(--foreground))',
  line_height: 1.6,
  sidebar_pinned: false,
  theme: 'default',
  engine: 'groq',
  source_language: 'auto',
  custom_themes: '[]',
  editor_columns: 1,
  dashboard_view_mode: 'cards',
  folder_view_mode: 'cards',
  folder_sort_key: 'date',
  folder_sort_asc: false,
  player_layout: 'split',
  tab_settings_json: '',
  default_ai_model: '',
  cuda_preset: 'balanced',
  cuda_fast_mode: true,
  cuda_compute_type: 'int8_float16',
  cuda_beam_size: 1,
  cuda_no_condition_prev: true,
  cuda_vad_aggressive: false,
  cuda_hotwords: '',
  cuda_paragraph_threshold: 0,
  cuda_preload_mode: 'preload',
  cuda_cloud_save: 'immediate',
};

export const useCloudPreferences = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load preferences: local DB → localStorage → cloud
  useEffect(() => {
    if (!user) {
      // Load from localStorage as fallback
      try {
        const saved = localStorage.getItem('user_preferences');
        if (saved) {
          const parsed = JSON.parse(saved);
          setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
        } else {
          // Try individual keys for backward compat
          const prefs = { ...DEFAULT_PREFERENCES };
          const engine = localStorage.getItem('transcript_engine');
          const srcLang = localStorage.getItem('transcript_sourceLanguage');
          const fontSize = localStorage.getItem('transcript_fontSize');
          const fontFamily = localStorage.getItem('transcript_fontFamily');
          const textColor = localStorage.getItem('transcript_textColor');
          const lineHeight = localStorage.getItem('transcript_lineHeight');
          const themeId = localStorage.getItem('app_theme_id');
          const customThemes = localStorage.getItem('app_custom_themes');
          const editorCols = localStorage.getItem('editor_columns');
          if (engine) prefs.engine = engine;
          if (srcLang) prefs.source_language = srcLang;
          if (editorCols) prefs.editor_columns = Number(editorCols);
          if (fontSize) prefs.font_size = Number(fontSize);
          if (fontFamily) prefs.font_family = fontFamily;
          if (textColor) prefs.text_color = textColor;
          if (lineHeight) prefs.line_height = Number(lineHeight);
          if (themeId) prefs.theme = themeId;
          if (customThemes) prefs.custom_themes = customThemes;
          // CUDA keys
          const cPreset = localStorage.getItem('cuda_preset');
          const cFast = localStorage.getItem('cuda_fast_mode');
          const cCompute = localStorage.getItem('cuda_compute_type');
          const cBeam = localStorage.getItem('cuda_beam_size');
          const cNoCond = localStorage.getItem('cuda_no_condition_prev');
          const cVad = localStorage.getItem('cuda_vad_aggressive');
          const cHotwords = localStorage.getItem('cuda_hotwords');
          const cParagraph = localStorage.getItem('cuda_paragraph_threshold');
          const cPreload = localStorage.getItem('cuda_preload_mode');
          const cCloudSave = localStorage.getItem('cuda_cloud_save');
          if (cPreset) prefs.cuda_preset = cPreset;
          if (cFast !== null) prefs.cuda_fast_mode = cFast === '1';
          if (cCompute) prefs.cuda_compute_type = cCompute;
          if (cBeam) prefs.cuda_beam_size = Number(cBeam);
          if (cNoCond !== null) prefs.cuda_no_condition_prev = cNoCond === '1';
          if (cVad !== null) prefs.cuda_vad_aggressive = cVad === '1';
          if (cHotwords !== null) prefs.cuda_hotwords = cHotwords;
          if (cParagraph) prefs.cuda_paragraph_threshold = Number(cParagraph);
          if (cPreload) prefs.cuda_preload_mode = cPreload;
          if (cCloudSave) prefs.cuda_cloud_save = cCloudSave;
          setPreferences(prefs);
        }
      } catch {}
      setIsLoaded(true);
      return;
    }

    const load = async () => {
      // 1) Try local DB first (instant)
      const localPrefs = await getLocalPreferences();
      if (localPrefs) {
        const { id: _id, _dirty, ...rest } = localPrefs;
        setPreferences({ ...DEFAULT_PREFERENCES, ...rest });
        setIsLoaded(true);
      }

      // 2) Then fetch from cloud in background
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        // ── Conflict resolution: prefer local theme if it changed AFTER cloud's updated_at
        const localThemeMtime = Number(localStorage.getItem('app_theme_updated_at') || 0);
        const cloudUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
        const localTheme = localStorage.getItem('app_theme_id');
        const localCustomThemes = localStorage.getItem('app_custom_themes');
        const localIsNewer = localThemeMtime > 0 && localThemeMtime > cloudUpdatedAt;

        const loaded: UserPreferences = {
          font_size: data.font_size ?? DEFAULT_PREFERENCES.font_size,
          font_family: data.font_family ?? DEFAULT_PREFERENCES.font_family,
          text_color: data.text_color ?? DEFAULT_PREFERENCES.text_color,
          line_height: Number(data.line_height) || DEFAULT_PREFERENCES.line_height,
          sidebar_pinned: data.sidebar_pinned ?? DEFAULT_PREFERENCES.sidebar_pinned,
          theme: localIsNewer && localTheme ? localTheme : (data.theme ?? DEFAULT_PREFERENCES.theme),
          engine: (data as any).engine ?? DEFAULT_PREFERENCES.engine,
          source_language: (data as any).source_language ?? DEFAULT_PREFERENCES.source_language,
          custom_themes: localIsNewer && localCustomThemes
            ? localCustomThemes
            : (typeof (data as any).custom_themes === 'string'
              ? (data as any).custom_themes
              : JSON.stringify((data as any).custom_themes ?? [])),
          editor_columns: (data as any).editor_columns ?? DEFAULT_PREFERENCES.editor_columns,
          dashboard_view_mode: (data as any).dashboard_view_mode ?? DEFAULT_PREFERENCES.dashboard_view_mode,
          folder_view_mode: (data as any).folder_view_mode ?? DEFAULT_PREFERENCES.folder_view_mode,
          folder_sort_key: (data as any).folder_sort_key ?? DEFAULT_PREFERENCES.folder_sort_key,
          folder_sort_asc: (data as any).folder_sort_asc ?? DEFAULT_PREFERENCES.folder_sort_asc,
          player_layout: (data as any).player_layout ?? DEFAULT_PREFERENCES.player_layout,
          tab_settings_json: typeof (data as any).tab_settings_json === 'string'
            ? (data as any).tab_settings_json
            : JSON.stringify((data as any).tab_settings_json ?? ''),
          default_ai_model: (data as any).default_ai_model ?? DEFAULT_PREFERENCES.default_ai_model,
          cuda_preset: (data as any).cuda_preset ?? DEFAULT_PREFERENCES.cuda_preset,
          cuda_fast_mode: (data as any).cuda_fast_mode ?? DEFAULT_PREFERENCES.cuda_fast_mode,
          cuda_compute_type: (data as any).cuda_compute_type ?? DEFAULT_PREFERENCES.cuda_compute_type,
          cuda_beam_size: (data as any).cuda_beam_size ?? DEFAULT_PREFERENCES.cuda_beam_size,
          cuda_no_condition_prev: (data as any).cuda_no_condition_prev ?? DEFAULT_PREFERENCES.cuda_no_condition_prev,
          cuda_vad_aggressive: (data as any).cuda_vad_aggressive ?? DEFAULT_PREFERENCES.cuda_vad_aggressive,
          cuda_hotwords: (data as any).cuda_hotwords ?? DEFAULT_PREFERENCES.cuda_hotwords,
          cuda_paragraph_threshold: (data as any).cuda_paragraph_threshold ?? DEFAULT_PREFERENCES.cuda_paragraph_threshold,
          cuda_preload_mode: (data as any).cuda_preload_mode ?? DEFAULT_PREFERENCES.cuda_preload_mode,
          cuda_cloud_save: (data as any).cuda_cloud_save ?? DEFAULT_PREFERENCES.cuda_cloud_save,
        };
        setPreferences(loaded);
        // Mirror to localStorage so useTheme picks up cloud values
        localStorage.setItem('app_theme_id', loaded.theme);
        localStorage.setItem('app_custom_themes', loaded.custom_themes);
        localStorage.setItem('editor_columns', String(loaded.editor_columns));
        // Mirror CUDA settings to localStorage for backward compat
        localStorage.setItem('cuda_preset', loaded.cuda_preset);
        localStorage.setItem('cuda_fast_mode', loaded.cuda_fast_mode ? '1' : '0');
        localStorage.setItem('cuda_compute_type', loaded.cuda_compute_type);
        localStorage.setItem('cuda_beam_size', String(loaded.cuda_beam_size));
        localStorage.setItem('cuda_no_condition_prev', loaded.cuda_no_condition_prev ? '1' : '0');
        localStorage.setItem('cuda_vad_aggressive', loaded.cuda_vad_aggressive ? '1' : '0');
        localStorage.setItem('cuda_hotwords', loaded.cuda_hotwords);
        localStorage.setItem('cuda_paragraph_threshold', String(loaded.cuda_paragraph_threshold));
        localStorage.setItem('cuda_preload_mode', loaded.cuda_preload_mode);
        localStorage.setItem('cuda_cloud_save', loaded.cuda_cloud_save);
        window.dispatchEvent(new CustomEvent('cloud-prefs-loaded'));

        // If local theme is newer than cloud's stored theme, immediately push it back
        if (localIsNewer && localTheme && (data.theme !== localTheme || (typeof (data as any).custom_themes === 'string' ? (data as any).custom_themes : JSON.stringify((data as any).custom_themes ?? [])) !== loaded.custom_themes)) {
          let parsedCustom: unknown = [];
          try { parsedCustom = JSON.parse(loaded.custom_themes); } catch { /* */ }
          supabase.from('user_preferences').upsert({
            user_id: user.id,
            theme: loaded.theme,
            custom_themes: parsedCustom,
            updated_at: new Date().toISOString(),
          } as any, { onConflict: 'user_id' }).then(() => {
            localStorage.setItem('app_theme_updated_at', String(Date.now()));
          });
        }

        // Save to local DB for next time
        await savePreferencesLocally({
          id: 'current',
          user_id: user.id,
          ...loaded,
          updated_at: data.updated_at || new Date().toISOString(),
        });
        // Mark not dirty since it came from cloud
        await db.preferences.update('current', { _dirty: false });
      } else if (!error) {
        // Create initial record
        await supabase.from('user_preferences').insert({
          user_id: user.id,
          ...DEFAULT_PREFERENCES,
        });
      }
      setIsLoaded(true);
    };

    load();

    // ── Realtime: react to theme changes from other devices ──
    const channel = supabase
      .channel(`user_preferences:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const row = payload?.new;
          if (!row) return;
          const cloudTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          const localTime = Number(localStorage.getItem('app_theme_updated_at') || 0);
          // Ignore echoes of our own writes
          if (localTime >= cloudTime) return;
          if (row.theme && row.theme !== localStorage.getItem('app_theme_id')) {
            localStorage.setItem('app_theme_id', row.theme);
            localStorage.setItem('app_theme_updated_at', String(cloudTime));
            if (row.custom_themes != null) {
              const cs = typeof row.custom_themes === 'string' ? row.custom_themes : JSON.stringify(row.custom_themes);
              localStorage.setItem('app_custom_themes', cs);
            }
            window.dispatchEvent(new CustomEvent('cloud-prefs-loaded'));
            window.dispatchEvent(new CustomEvent('cloud-theme-external-update', {
              detail: { source: 'remote', themeId: row.theme }
            }));
          }
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch { /* */ }
    };
  }, [user]);

  // Debounced save to cloud
  const saveToCloud = useCallback((updated: UserPreferences) => {
    // Always save to localStorage for quick access
    localStorage.setItem('user_preferences', JSON.stringify(updated));

    // Also mirror individual localStorage keys for backward compat
    localStorage.setItem('transcript_engine', updated.engine);
    localStorage.setItem('transcript_sourceLanguage', updated.source_language);
    localStorage.setItem('transcript_fontSize', String(updated.font_size));
    localStorage.setItem('transcript_fontFamily', updated.font_family);
    localStorage.setItem('transcript_textColor', updated.text_color);
    localStorage.setItem('transcript_lineHeight', String(updated.line_height));
    localStorage.setItem('app_theme_id', updated.theme);
    localStorage.setItem('app_theme_updated_at', String(Date.now()));
    localStorage.setItem('app_custom_themes', updated.custom_themes);
    localStorage.setItem('editor_columns', String(updated.editor_columns));
    // Mirror CUDA settings
    localStorage.setItem('cuda_preset', updated.cuda_preset);
    localStorage.setItem('cuda_fast_mode', updated.cuda_fast_mode ? '1' : '0');
    localStorage.setItem('cuda_compute_type', updated.cuda_compute_type);
    localStorage.setItem('cuda_beam_size', String(updated.cuda_beam_size));
    localStorage.setItem('cuda_no_condition_prev', updated.cuda_no_condition_prev ? '1' : '0');
    localStorage.setItem('cuda_vad_aggressive', updated.cuda_vad_aggressive ? '1' : '0');
    localStorage.setItem('cuda_hotwords', updated.cuda_hotwords);
    localStorage.setItem('cuda_paragraph_threshold', String(updated.cuda_paragraph_threshold));
    localStorage.setItem('cuda_preload_mode', updated.cuda_preload_mode);
    localStorage.setItem('cuda_cloud_save', updated.cuda_cloud_save);

    // Save to local DB (instant, offline-capable)
    if (user) {
      savePreferencesLocally({
        id: 'current',
        user_id: user.id,
        ...updated,
        updated_at: new Date().toISOString(),
      });
    }

    if (!user) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // Parse custom_themes string to JSON for DB storage
      let customThemesParsed: unknown = [];
      try { customThemesParsed = JSON.parse(updated.custom_themes); } catch {}
      let tabSettingsParsed: unknown = null;
      try { if (updated.tab_settings_json) tabSettingsParsed = JSON.parse(updated.tab_settings_json); } catch {}

      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          font_size: updated.font_size,
          font_family: updated.font_family,
          text_color: updated.text_color,
          line_height: updated.line_height,
          sidebar_pinned: updated.sidebar_pinned,
          theme: updated.theme,
          engine: updated.engine,
          source_language: updated.source_language,
          custom_themes: customThemesParsed,
          editor_columns: updated.editor_columns,
          dashboard_view_mode: updated.dashboard_view_mode,
          folder_view_mode: updated.folder_view_mode,
          folder_sort_key: updated.folder_sort_key,
          folder_sort_asc: updated.folder_sort_asc,
          player_layout: updated.player_layout,
          tab_settings_json: tabSettingsParsed,
          default_ai_model: updated.default_ai_model || null,
          cuda_preset: updated.cuda_preset,
          cuda_fast_mode: updated.cuda_fast_mode,
          cuda_compute_type: updated.cuda_compute_type,
          cuda_beam_size: updated.cuda_beam_size,
          cuda_no_condition_prev: updated.cuda_no_condition_prev,
          cuda_vad_aggressive: updated.cuda_vad_aggressive,
          cuda_hotwords: updated.cuda_hotwords,
          cuda_paragraph_threshold: updated.cuda_paragraph_threshold,
          cuda_preload_mode: updated.cuda_preload_mode,
          cuda_cloud_save: updated.cuda_cloud_save,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'user_id' });

      // Fallback: if CUDA columns don't exist yet, save without them
      if (error) {
        const { error: error2 } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            font_size: updated.font_size,
            font_family: updated.font_family,
            text_color: updated.text_color,
            line_height: updated.line_height,
            sidebar_pinned: updated.sidebar_pinned,
            theme: updated.theme,
            engine: updated.engine,
            source_language: updated.source_language,
            custom_themes: customThemesParsed,
            editor_columns: updated.editor_columns,
            dashboard_view_mode: updated.dashboard_view_mode,
            folder_view_mode: updated.folder_view_mode,
            folder_sort_key: updated.folder_sort_key,
            folder_sort_asc: updated.folder_sort_asc,
            player_layout: updated.player_layout,
            tab_settings_json: tabSettingsParsed,
            default_ai_model: updated.default_ai_model || null,
            updated_at: new Date().toISOString(),
          } as any, { onConflict: 'user_id' });

        // Last resort: save only original columns
        if (error2) {
          await supabase
            .from('user_preferences')
            .upsert({
              user_id: user.id,
              font_size: updated.font_size,
              font_family: updated.font_family,
              text_color: updated.text_color,
              line_height: updated.line_height,
              sidebar_pinned: updated.sidebar_pinned,
              theme: updated.theme,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
        }
      }
    }, 500);
  }, [user]);

  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      saveToCloud(updated);
      return updated;
    });
  }, [saveToCloud]);

  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferences(prev => {
      const updated = { ...prev, ...partial };
      saveToCloud(updated);
      return updated;
    });
  }, [saveToCloud]);

  return {
    preferences,
    isLoaded,
    updatePreference,
    updatePreferences,
  };
};
