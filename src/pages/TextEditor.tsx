import { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PlayerTranscriptEditor } from "@/components/PlayerTranscriptEditor";
import { debugLog } from "@/lib/debugLogger";
import type { TextVersion } from "@/components/TextEditHistory";
import type { WordTiming } from "@/components/SyncAudioPlayer";

// Lazy-loaded heavy components
const AIEditorDual = lazy(() => import("@/components/AIEditorDual").then(m => ({ default: m.AIEditorDual })));
const TextComparisonMulti = lazy(() => import("@/components/TextComparisonMulti").then(m => ({ default: m.TextComparisonMulti })));
const EditingTemplates = lazy(() => import("@/components/EditingTemplates").then(m => ({ default: m.EditingTemplates })));
const AdvancedDiffView = lazy(() => import("@/components/AdvancedDiffView").then(m => ({ default: m.AdvancedDiffView })));
const TextStyleControl = lazy(() => import("@/components/TextStyleControl").then(m => ({ default: m.TextStyleControl })));
const TextEditHistory = lazy(() => import("@/components/TextEditHistory").then(m => ({ default: m.TextEditHistory })));
const PromptLibrary = lazy(() => import("@/components/PromptLibrary").then(m => ({ default: m.PromptLibrary })));
const EditPipeline = lazy(() => import("@/components/EditPipeline").then(m => ({ default: m.EditPipeline })));
const OllamaManager = lazy(() => import("@/components/OllamaManager").then(m => ({ default: m.OllamaManager })));
const CorrectionLearningPanel = lazy(() => import("@/components/CorrectionLearningPanel").then(m => ({ default: m.CorrectionLearningPanel })));
const SyncAudioPlayer = lazy(() => import("@/components/SyncAudioPlayer").then(m => ({ default: m.SyncAudioPlayer })));
const SyncEditableView = lazy(() => import("@/components/SyncEditableView").then(m => ({ default: m.SyncEditableView })));
const SyncTranscriptView = lazy(() => import("@/components/SyncTranscriptView").then(m => ({ default: m.SyncTranscriptView })));
const VocabularyPanel = lazy(() => import("@/components/VocabularyPanel").then(m => ({ default: m.VocabularyPanel })));
const DictionaryValidator = lazy(() => import("@/components/DictionaryValidator").then(m => ({ default: m.DictionaryValidator })));
const TextMarkingOverlay = lazy(() => import("@/components/TextMarkingOverlay").then(m => ({ default: m.TextMarkingOverlay })));
const AutoSummaryCard = lazy(() => import("@/components/AutoSummaryCard").then(m => ({ default: m.AutoSummaryCard })));
const TranscriptSummary = lazy(() => import("@/components/TranscriptSummary").then(m => ({ default: m.TranscriptSummary })));
const EngineCompare = lazy(() => import("@/components/EngineCompare").then(m => ({ default: m.EngineCompare })));
const AnalyticsDashboard = lazy(() => import("@/components/AnalyticsDashboard").then(m => ({ default: m.AnalyticsDashboard })));
const SpeakerDiarization = lazy(() => import("@/components/SpeakerDiarization").then(m => ({ default: m.SpeakerDiarization })));
const FloatingPlayerPortal = lazy(() => import("@/components/FloatingPlayerPortal").then(m => ({ default: m.FloatingPlayerPortal })));
const KeyboardShortcutsDialog = lazy(() => import("@/components/KeyboardShortcutsDialog").then(m => ({ default: m.KeyboardShortcutsDialog })));
import { ArrowRight, Home, Wand2, SplitSquareVertical, SpellCheck, Loader2, Columns2, Columns3, AlignJustify, LayoutGrid, Rows3, Save, Copy, LayoutPanelTop, LayoutPanelLeft, Square, StretchHorizontal, PictureInPicture2, SlidersHorizontal, Search, ChevronUp, ChevronDown, X, Keyboard } from "lucide-react";
import { TabSettingsManager, TabConfig, loadTabSettings, saveTabSettings, getDefaultTabConfig } from "@/components/TabSettingsManager";
import { supabase } from "@/integrations/supabase/client";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { toast } from "@/hooks/use-toast";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useCloudVersions } from "@/hooks/useCloudVersions";
import { useOllama, isOllamaModel } from "@/hooks/useOllama";
import { db } from "@/lib/localDb";
import { useCorrectionLearning } from "@/hooks/useCorrectionLearning";
import { LazyErrorBoundary } from "@/components/LazyErrorBoundary";

const sourceLabels: Record<string, string> = {
  original: 'תמלול מקורי',
  manual: 'עריכה ידנית',
  'ai-improve': 'שיפור ניסוח',
  'ai-sources': 'הוספת מקורות',
  'ai-readable': 'זורם לקריאה',
  'ai-custom': 'פרומפט מותאם',
  'ai-fix': 'תיקון ועיבוד',
  'ai-grammar': 'דקדוק ואיות',
  'ai-punctuation': 'פיסוק',
  'ai-paragraphs': 'חלוקה לפסקאות',
  'ai-bullets': 'נקודות מפתח',
  'ai-headings': 'כותרות',
  'ai-expand': 'הרחבה',
  'ai-shorten': 'קיצור',
  'ai-summarize': 'סיכום',
  'ai-translate': 'תרגום',
  'ai-speakers': 'זיהוי דוברים',
  'ai-tone': 'שינוי טון',
};

const KNOWN_SOURCES = new Set<TextVersion['source']>([
  'original',
  'manual',
  'ai-improve',
  'ai-sources',
  'ai-readable',
  'ai-custom',
  'ai-fix',
  'ai-grammar',
  'ai-punctuation',
  'ai-paragraphs',
  'ai-bullets',
  'ai-headings',
  'ai-expand',
  'ai-shorten',
  'ai-summarize',
  'ai-translate',
  'ai-speakers',
  'ai-tone',
]);

function toKnownSource(source: string): TextVersion['source'] {
  return KNOWN_SOURCES.has(source as TextVersion['source'])
    ? (source as TextVersion['source'])
    : 'manual';
}

const TextEditor = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { value: text, setValue: setText, undo: undoText, redo: redoText, canUndo, canRedo } = useUndoRedo("");
  const [versions, setVersions] = useState<TextVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>("");
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const [playerTime, setPlayerTime] = useState(0);
  const transcriptIdRef = useRef<string | null>(null);
  const manualVersionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { updateTranscript, getAudioUrl } = useCloudTranscripts();
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const { versions: cloudVersions, isLoading: cloudVersionsLoading, saveVersion: saveCloudVersion } = useCloudVersions(transcriptId);
  const ollama = useOllama();
  const { learn: learnCorrections, applyCorrections } = useCorrectionLearning();
  const originalTextRef = useRef<string>("");
  const ownedAudioUrlRef = useRef<string | null>(null);

  // Tab settings (visibility + order)
  const ALL_TABS: TabConfig[] = [
    { id: "player", label: "נגן", emoji: "🎧", group: "primary" },
    { id: "edit", label: "עריכת טקסט", group: "primary" },
    { id: "speakers", label: "זיהוי דוברים", emoji: "👥", group: "primary" },
    { id: "templates", label: "תבניות", group: "primary" },
    { id: "ai", label: "עריכה עם AI", group: "primary" },
    { id: "pipeline", label: "צינור עיבוד", group: "primary" },
    { id: "prompts", label: "ספריית פרומפטים", group: "primary" },
    { id: "ollama", label: "Ollama", emoji: "🖥️", group: "secondary" },
    { id: "learning", label: "למידה", emoji: "🧠", group: "secondary" },
    { id: "vocab", label: "מילון", emoji: "📖", group: "secondary" },
    { id: "summary", label: "סיכום", emoji: "📊", group: "secondary" },
    { id: "ab", label: "A/B", emoji: "⚡", group: "secondary" },
    { id: "analytics", label: "אנליטיקה", emoji: "📈", group: "secondary" },
    { id: "compare", label: "השוואה", group: "secondary" },
    { id: "history", label: "היסטוריה", group: "secondary" },
  ];
  // Cloud-synced style settings (must be before effects that use preferences)
  const { preferences, updatePreference } = useCloudPreferences();

  const [tabSettings, setTabSettings] = useState(() => {
    return loadTabSettings();
  });
  const visibleTabs = tabSettings.visible;
  const tabOrder = tabSettings.order;

  // Load tab settings from cloud when preferences are available
  const cloudTabSettingsLoaded = useRef(false);
  useEffect(() => {
    if (cloudTabSettingsLoaded.current) return;
    if (!preferences.tab_settings_json) return;
    try {
      const parsed = JSON.parse(preferences.tab_settings_json);
      if (parsed?.visible && parsed?.order) {
        cloudTabSettingsLoaded.current = true;
        setTabSettings(parsed);
        saveTabSettings(parsed.visible, parsed.order);
      }
    } catch {}
  }, [preferences.tab_settings_json]);

  // One-time migration: add new tabs from code, remove stale tabs from settings
  const hasMigrated = useRef(false);
  useEffect(() => {
    if (hasMigrated.current) {
      saveTabSettings(tabSettings.visible, tabSettings.order);
      return;
    }
    hasMigrated.current = true;

    const defaults = getDefaultTabConfig();
    const validIds = new Set(defaults.order);

    const sanitizedVisible = tabSettings.visible.filter((id) => validIds.has(id));
    const existingOrder = tabSettings.order.filter((id) => validIds.has(id));

    const knownIds = new Set(tabSettings.order);
    const genuinelyNewTabs = defaults.order.filter((id) => !knownIds.has(id));
    const mergedVisible = [...sanitizedVisible, ...genuinelyNewTabs];
    const mergedOrder = [...existingOrder, ...genuinelyNewTabs];

    const changed =
      mergedVisible.length !== tabSettings.visible.length ||
      mergedOrder.length !== tabSettings.order.length ||
      mergedVisible.some((id, idx) => tabSettings.visible[idx] !== id) ||
      mergedOrder.some((id, idx) => tabSettings.order[idx] !== id);

    if (changed) {
      setTabSettings({ visible: mergedVisible, order: mergedOrder });
      saveTabSettings(mergedVisible, mergedOrder);
    } else {
      saveTabSettings(tabSettings.visible, tabSettings.order);
    }
  }, [tabSettings]);
  const fontSize = preferences.font_size;
  const fontFamily = preferences.font_family;
  const textColor = preferences.text_color;
  const lineHeight = preferences.line_height;
  const setFontSize = (v: number) => updatePreference('font_size', v);
  const setFontFamily = (v: string) => updatePreference('font_family', v);
  const setTextColor = (v: string) => updatePreference('text_color', v);
  const setLineHeight = (v: number) => updatePreference('line_height', v);

  // Column view (cloud-synced)
  const columns = preferences.editor_columns;

  // Player layout (cloud-synced)
  const playerLayout = (preferences.player_layout || 'split') as 'split' | 'stacked' | 'full' | 'wide' | 'eq-wide';
  const setPlayerLayout = useCallback((v: 'split' | 'stacked' | 'full' | 'wide' | 'eq-wide') => updatePreference('player_layout', v), [updatePreference]);
  const [isPlayerFloating, setIsPlayerFloating] = useState(false);
  const togglePlayerFloating = useCallback(() => setIsPlayerFloating(p => !p), []);
  const [isMarkingActive, setIsMarkingActive] = useState(false);
  const [isEqFloating, setIsEqFloating] = useState(false);
  const toggleEqFloating = useCallback(() => setIsEqFloating(p => !p), []);
  const [eqPortalTarget, setEqPortalTarget] = useState<HTMLDivElement | null>(null);

  // Search in transcript
  const [transcriptSearchOpen, setTranscriptSearchOpen] = useState(false);
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState("");
  const [transcriptSearchIdx, setTranscriptSearchIdx] = useState(0);
  const [transcriptMatchCount, setTranscriptMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const setColumns = (v: number) => updatePreference('editor_columns', v);

  const columnStyle: React.CSSProperties = columns > 1 ? {
    columnCount: columns,
    columnGap: '2rem',
    columnRule: '1px solid hsl(var(--border))',
  } : {};

  // Recover audio from Dexie IndexedDB (last saved blob)
  const tryRecoverAudioFromDexie = useCallback(async () => {
    try {
      const entry = await db.audioBlobs.get('last_audio');
      if (entry?.blob) {
        if (ownedAudioUrlRef.current) {
          URL.revokeObjectURL(ownedAudioUrlRef.current);
          ownedAudioUrlRef.current = null;
        }
        const url = URL.createObjectURL(entry.blob);
        ownedAudioUrlRef.current = url;
        setAudioUrl(url);
        setAudioBlob(entry.blob);
        setAudioFileName(entry.name || '');
        debugLog.info('TextEditor', `Audio recovered from Dexie: ${entry.name}`);
      }
    } catch { /* Dexie not available */ }
  }, []);

  const setOwnedAudioFromBlob = useCallback((blob: Blob, name?: string) => {
    if (ownedAudioUrlRef.current) {
      URL.revokeObjectURL(ownedAudioUrlRef.current);
      ownedAudioUrlRef.current = null;
    }
    const nextUrl = URL.createObjectURL(blob);
    ownedAudioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
    setAudioBlob(blob);
    if (name) setAudioFileName(name);
  }, []);

  useEffect(() => {
    debugLog.info('TextEditor', '📝 TextEditor mounted');

    // Keyboard shortcut: Ctrl+Shift+F → toggle floating player
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setIsPlayerFloating(p => !p);
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        setIsEqFloating(p => !p);
      }
      if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setTranscriptSearchOpen(p => {
          if (!p) setTimeout(() => searchInputRef.current?.focus(), 50);
          else { setTranscriptSearchQuery(""); setTranscriptSearchIdx(0); }
          return !p;
        });
      }
      // Global undo/redo (only when not in an input/contenteditable)
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isEditable = (document.activeElement as HTMLElement)?.isContentEditable;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || isEditable;
      if (e.ctrlKey && e.shiftKey && e.key === 'Z' && !inInput) {
        e.preventDefault();
        redoText();
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'z' && !inInput) {
        e.preventDefault();
        undoText();
      }
      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setShortcutsOpen(p => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (ownedAudioUrlRef.current) {
        URL.revokeObjectURL(ownedAudioUrlRef.current);
        ownedAudioUrlRef.current = null;
      }
      debugLog.info('TextEditor', '📝 TextEditor unmounted');
    };
  }, []);

  // Always try to load audio blob from Dexie for SpeakerDiarization passthrough
  useEffect(() => {
    (async () => {
      try {
        const entry = await db.audioBlobs.get('last_audio');
        if (entry?.blob) {
          setAudioBlob(entry.blob);
          setAudioFileName(entry.name || '');
        }
      } catch { /* Dexie not available */ }
    })();
  }, []);

  // Fallback: if audioUrl exists but audioBlob is still null, fetch the blob from URL
  useEffect(() => {
    if (audioBlob || !audioUrl) return;
    (async () => {
      try {
        const resp = await fetch(audioUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          setAudioBlob(blob);
          // Also persist to Dexie for diarization recovery
          try {
            await db.audioBlobs.put({ id: 'last_audio', blob, type: blob.type, name: audioFileName || 'audio', saved_at: Date.now() });
          } catch { /* Dexie not available */ }
        }
      } catch { /* fetch failed */ }
    })();
  }, [audioUrl, audioBlob, audioFileName]);

  useEffect(() => {
    // Get text from navigation state or localStorage
    const stateText = location.state?.text;
    if (stateText) {
      setText(stateText);
      originalTextRef.current = stateText;
      const initialVersion: TextVersion = {
        id: crypto.randomUUID(),
        text: stateText,
        timestamp: new Date(),
        source: 'original'
      };
      setVersions([initialVersion]);
      setSelectedVersionId(initialVersion.id);
      // Save to localStorage for persistence
      localStorage.setItem('current_editing_text', stateText);
      localStorage.setItem('text_versions', JSON.stringify([initialVersion]));
      // Save initial version to cloud
      if (location.state?.transcriptId) {
        // Defer to avoid calling saveCloudVersion before hook is ready
        setTimeout(() => {
          saveCloudVersion(stateText, 'original', null, 'תמלול מקורי');
        }, 500);
      }
    } else {
      // Try to load from localStorage
      const savedText = localStorage.getItem('current_editing_text');
      const savedVersions = localStorage.getItem('text_versions');
      
      if (savedVersions) {
        try {
          const parsedVersions = JSON.parse(savedVersions).map((v: any) => ({
            ...v,
            timestamp: new Date(v.timestamp)
          }));
          setVersions(parsedVersions);
          setSelectedVersionId(parsedVersions[parsedVersions.length - 1]?.id);
        } catch {
          // Corrupted localStorage — reset
          localStorage.removeItem('text_versions');
        }
      }
      
      if (savedText) {
        setText(savedText);
      }
    }

    // Track transcript ID for cloud saves
    if (location.state?.transcriptId) {
      transcriptIdRef.current = location.state.transcriptId;
      setTranscriptId(location.state.transcriptId);
    }

    // Load audio URL from navigation state or resolve from Supabase Storage
    if (location.state?.audioUrl) {
      const url = location.state.audioUrl as string;
      if (url.startsWith('blob:')) {
        // Clone blob URL into an owned URL so playback survives source-route cleanup.
        fetch(url)
          .then(async (resp) => {
            if (!resp.ok && resp.status !== 206) throw new Error('blob fetch failed');
            const blob = await resp.blob();
            setOwnedAudioFromBlob(blob, location.state?.audioFileName || undefined);
            try {
              await db.audioBlobs.put({ id: 'last_audio', blob, type: blob.type, name: location.state?.audioFileName || audioFileName || 'audio', saved_at: Date.now() });
            } catch { /* Dexie not available */ }
          })
          .catch(() => {
            // Blob URL expired — try recovering from Dexie
            tryRecoverAudioFromDexie();
          });
      } else {
        setAudioUrl(url);
      }
    } else if (location.state?.audioFilePath) {
      // Load audio from Supabase Storage (when opening from history)
      getAudioUrl(location.state.audioFilePath).then((url) => {
        if (url) setAudioUrl(url);
      });
    } else {
      // No audio URL in navigation state — try recovering from Dexie
      tryRecoverAudioFromDexie();
    }

    // Load word timings from state, or fallback to localStorage, or fetch from cloud
    if (location.state?.wordTimings) {
      setWordTimings(location.state.wordTimings);
    } else if (location.state?.transcriptId) {
      // Try fetching word_timings from cloud
      supabase
        .from('transcripts')
        .select('word_timings')
        .eq('id', location.state.transcriptId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.word_timings && Array.isArray(data.word_timings) && data.word_timings.length > 0) {
            setWordTimings(data.word_timings as unknown as WordTiming[]);
            debugLog.info('TextEditor', `Loaded ${(data.word_timings as any[]).length} word timings from cloud`);
          }
        });
    } else {
      try {
        const saved = localStorage.getItem('last_word_timings');
        if (saved) setWordTimings(JSON.parse(saved));
      } catch { /* corrupted */ }
    }

  }, [location.state, tryRecoverAudioFromDexie, setOwnedAudioFromBlob, getAudioUrl, audioFileName]);

  // Auto-save text and versions to localStorage + debounce cloud save
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Debounce localStorage writes (500ms)
    if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = setTimeout(() => {
      if (text) {
        localStorage.setItem('current_editing_text', text);
      }
      if (versions.length > 0) {
        localStorage.setItem('text_versions', JSON.stringify(versions));
      }
    }, 500);
    // Debounce save edited_text to cloud (3s after last change)
    if (transcriptIdRef.current && text) {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = setTimeout(() => {
        if (transcriptIdRef.current) {
          updateTranscript(transcriptIdRef.current, { edited_text: text });
          debugLog.info('TextEditor', 'Auto-saved edited_text to cloud');
        }
      }, 3000);
    }
    return () => {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    };
  }, [text, versions]);

  const addVersion = (newText: string, source: TextVersion['source'], customPrompt?: string) => {
    const newVersion: TextVersion = {
      id: crypto.randomUUID(),
      text: newText,
      timestamp: new Date(),
      source,
      customPrompt
    };
    setVersions(prev => [...prev, newVersion]);
    setSelectedVersionId(newVersion.id);
    setText(newText);
    // Also save to cloud versions
    if (transcriptId) {
      saveCloudVersion(newText, source, customPrompt || null, sourceLabels[source] || source);
    }
  };

  const handleSaveVersion = (text: string, source: string, engineLabel: string, actionLabel: string) => {
    // Save version to cloud WITHOUT replacing the main text
    if (transcriptId) {
      saveCloudVersion(text, source, engineLabel, actionLabel);
      toast({ title: 'גרסה נשמרה בענן ☁️', description: `${engineLabel} — ${actionLabel}` });
    } else {
      toast({ title: 'לא ניתן לשמור', description: 'יש צורך בתמלול שמור בענן', variant: 'destructive' });
    }
  };

  const handleVersionSelect = (version: TextVersion) => {
    setSelectedVersionId(version.id);
    setText(version.text);
  };

  const handleRestoreVersion = (newText: string) => {
    setText(newText);
    addVersion(newText, 'manual', 'שחזור גרסה');
    toast({ title: 'גרסה שוחזרה ✅' });
  };

  

  const [aiAction, setAiAction] = useState<string | null>(null);
  const [showCompareAi, setShowCompareAi] = useState(false);

  const compareVersions = useMemo<TextVersion[]>(() => {
    const byId = new Map<string, TextVersion>();

    for (const v of versions) {
      byId.set(v.id, v);
    }

    for (const cv of cloudVersions) {
      if (byId.has(cv.id)) continue;
      byId.set(cv.id, {
        id: cv.id,
        text: cv.text,
        timestamp: new Date(cv.created_at),
        source: toKnownSource(cv.source),
        customPrompt: cv.action_label || cv.engine_label || undefined,
      });
    }

    return Array.from(byId.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }, [versions, cloudVersions]);

  const handleAiQuickAction = async (action: 'fix_errors' | 'split_paragraphs' | 'fix_and_split') => {
    if (!text.trim()) {
      toast({ title: "אין טקסט לעיבוד", variant: "destructive" });
      return;
    }
    setAiAction(action);
    const labels: Record<string, string> = {
      fix_errors: 'תיקון שגיאות',
      split_paragraphs: 'חלוקה לפסקאות',
      fix_and_split: 'תיקון + חלוקה',
    };
    try {
      let resultText: string | undefined;

      // Prefer Ollama if connected (offline-first)
      if (ollama.isConnected && ollama.models.length > 0) {
        const model = ollama.models[0].name;
        resultText = await ollama.editText({ text, action, model });
      } else {
        // Cloud: DB proxy → edge function fallback
        resultText = await editTranscriptCloud({ text, action });
      }

      if (!resultText) throw new Error('לא התקבלה תשובה מ-AI');
      addVersion(resultText, 'ai-fix', labels[action]);
      toast({ title: `${labels[action]} הושלם ✅` });
    } catch (err) {
      // If Ollama failed, try cloud as fallback
      if (ollama.isConnected) {
        try {
          const cloudText = await editTranscriptCloud({ text, action });
          if (cloudText) {
            addVersion(cloudText, 'ai-fix', labels[action]);
            toast({ title: `${labels[action]} הושלם ✅ (ענן)` });
            return;
          }
        } catch { /* cloud also failed */ }
      }
      console.error('AI action error:', err);
      toast({ title: "שגיאה בעיבוד AI", description: err instanceof Error ? err.message : 'שגיאה', variant: "destructive" });
    } finally {
      setAiAction(null);
    }
  };

  const handleEditorChange = useCallback((newText: string) => {
    setText(newText);
    // Debounce manual version creation (2s)
    if (manualVersionTimerRef.current) clearTimeout(manualVersionTimerRef.current);
    manualVersionTimerRef.current = setTimeout(() => {
      addVersion(newText, 'manual');
      // Learn from user corrections
      if (originalTextRef.current && newText !== originalTextRef.current) {
        learnCorrections(originalTextRef.current, newText, 'manual');
      }
    }, 2000);
  }, [learnCorrections]);

  const handlePlayerEditorChange = useCallback((newText: string) => {
    handleEditorChange(newText);
  }, [handleEditorChange]);

  const handleSyncedWordReplace = useCallback((wordIndex: number, replacement: string) => {
    const fixed = replacement.trim();
    const isDelete = fixed === "__DELETE__";

    setWordTimings((prev) => {
      if (!prev.length || wordIndex < 0 || wordIndex >= prev.length) return prev;
      if (isDelete) {
        const next = prev.filter((_, i) => i !== wordIndex);
        setText(next.map((w) => w.word).join(' '));
        return next;
      }
      if (!fixed) return prev;
      const next = prev.map((w, i) => (i === wordIndex ? { ...w, word: fixed } : w));
      setText(next.map((w) => w.word).join(' '));
      return next;
    });
  }, []);

  const buildSyncedTimings = useCallback((editedText: string): WordTiming[] | null => {
    if (!wordTimings.length) return null;
    const totalDuration = wordTimings[wordTimings.length - 1]?.end || 0;
    if (totalDuration <= 0) return null;
    const words = editedText.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;

    const wordDuration = totalDuration / words.length;
    return words.map((word, i) => ({
      word,
      start: i * wordDuration,
      end: (i + 1) * wordDuration,
    }));
  }, [wordTimings]);

  const handleSyncToPlayer = useCallback((editedText: string) => {
    const newTimings = buildSyncedTimings(editedText);
    if (!newTimings) {
      toast({ title: "אין נתוני תזמון", description: "צריך אודיו עם תזמונים כדי לסנכרן", variant: "destructive" });
      return;
    }

    setWordTimings(newTimings);
    setText(editedText);
    toast({ title: "מסונכרן לנגן ✅", description: `${newTimings.length} מילים סונכרנו עם האודיו` });
  }, [buildSyncedTimings]);

  const handleSaveAndReplaceOriginal = useCallback(async (
    editedText: string,
    source: string,
    engineLabel: string,
    actionLabel: string,
  ) => {
    const id = transcriptIdRef.current;
    if (!id) {
      toast({ title: 'לא ניתן לשמור', description: 'יש צורך בתמלול שמור בענן', variant: 'destructive' });
      return;
    }

    const syncedTimings = buildSyncedTimings(editedText);
    await updateTranscript(id, {
      text: editedText,
      edited_text: editedText,
      ...(syncedTimings ? { word_timings: syncedTimings } : {}),
    });

    setText(editedText);
    if (syncedTimings) setWordTimings(syncedTimings);
    if (transcriptId) {
      saveCloudVersion(editedText, source, engineLabel, `${actionLabel} • החלפת מקור`);
    }

    toast({
      title: 'נשמר והוחלף במקור ✅',
      description: syncedTimings ? 'הטקסט והסנכרון לנגן עודכנו במקור' : 'הטקסט במקור עודכן',
    });
  }, [buildSyncedTimings, saveCloudVersion, transcriptId, updateTranscript]);

  const handleDuplicateAndSave = useCallback(async (
    editedText: string,
    source: string,
    engineLabel: string,
    actionLabel: string,
  ) => {
    const id = transcriptIdRef.current;
    if (!id) {
      toast({ title: 'לא ניתן לשכפל', description: 'יש צורך בתמלול שמור בענן', variant: 'destructive' });
      return;
    }

    const { data: current, error: loadError } = await supabase
      .from('transcripts')
      .select('user_id, engine, tags, notes, title, folder, category, is_favorite, audio_file_path, word_timings')
      .eq('id', id)
      .maybeSingle();

    if (loadError || !current) {
      toast({ title: 'שגיאה בשכפול', description: 'לא ניתן לקרוא את התמלול המקורי', variant: 'destructive' });
      return;
    }

    const syncedTimings = buildSyncedTimings(editedText);
    const duplicateTitle = `${current.title || 'תמלול'} (עותק)`;
    const { data: inserted, error: insertError } = await supabase
      .from('transcripts')
      .insert([{
        user_id: current.user_id,
        text: editedText,
        edited_text: editedText,
        engine: current.engine,
        tags: current.tags || [],
        notes: current.notes || '',
        title: duplicateTitle,
        folder: current.folder || '',
        category: current.category || '',
        is_favorite: current.is_favorite || false,
        audio_file_path: current.audio_file_path,
        word_timings: (syncedTimings || current.word_timings || null) as any,
      }])
      .select('id')
      .single();

    if (insertError) {
      toast({ title: 'שגיאה בשכפול', description: 'לא ניתן ליצור עותק חדש', variant: 'destructive' });
      return;
    }

    if (transcriptId) {
      saveCloudVersion(editedText, source, engineLabel, `${actionLabel} • שכפל ושמור`);
    }

    toast({
      title: 'שוכפל ונשמר ✅',
      description: `נוצר עותק חדש מחובר לאודיו (${inserted.id.slice(0, 8)}...)`,
    });
  }, [buildSyncedTimings, saveCloudVersion, transcriptId]);

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
    <div className="min-h-screen bg-background p-4 md:p-8 lg:p-10" dir="rtl">
      <div className="max-w-full mx-auto space-y-6">
        {/* Compact Header */}
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">עריכת טקסט</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">ערוך · שפר · השווה</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Column view selector */}
            <div className="flex items-center border rounded-md overflow-hidden">
              {[
                { cols: 1, icon: AlignJustify, label: "עמודה אחת" },
                { cols: 2, icon: Columns2, label: "2 עמודות" },
                { cols: 3, icon: Columns3, label: "3 עמודות" },
              ].map(({ cols, icon: Icon, label }) => (
                <Button
                  key={cols}
                  variant={columns === cols ? "default" : "ghost"}
                  size="icon"
                  className="h-7 w-7 rounded-none"
                  onClick={() => setColumns(cols)}
                  title={label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
            <TextStyleControl
              fontSize={fontSize}
              fontFamily={fontFamily}
              textColor={textColor}
              lineHeight={lineHeight}
              onFontSizeChange={setFontSize}
              onFontFamilyChange={setFontFamily}
              onTextColorChange={setTextColor}
              onLineHeightChange={setLineHeight}
            />
            <TabSettingsManager
              allTabs={ALL_TABS}
              visibleTabs={visibleTabs}
              tabOrder={tabOrder}
              onVisibilityChange={(v) => {
                setTabSettings(prev => {
                  const next = { ...prev, visible: v };
                  updatePreference('tab_settings_json', JSON.stringify(next));
                  return next;
                });
              }}
              onOrderChange={(o) => {
                setTabSettings(prev => {
                  const next = { ...prev, order: o };
                  updatePreference('tab_settings_json', JSON.stringify(next));
                  return next;
                });
              }}
            />
            <Button 
              variant="ghost" 
              size="icon"
              className="h-7 w-7"
              onClick={() => navigate("/")}
              title="חזרה לדף הראשי"
            >
              <Home className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Unified action bar — AI quick actions + save, single compact row */}
        {text.trim() && (
          <div className="flex items-center gap-2 flex-wrap py-3 px-4 rounded-xl border bg-muted/20">
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleAiQuickAction('fix_and_split')}
              disabled={!!aiAction}
            >
              {aiAction === 'fix_and_split' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              תקן + פסקאות
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleAiQuickAction('fix_errors')}
              disabled={!!aiAction}
            >
              {aiAction === 'fix_errors' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SpellCheck className="w-3.5 h-3.5" />}
              תקן שגיאות
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleAiQuickAction('split_paragraphs')}
              disabled={!!aiAction}
            >
              {aiAction === 'split_paragraphs' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SplitSquareVertical className="w-3.5 h-3.5" />}
              פסקאות
            </Button>
            <div className="w-px h-5 bg-border mx-1 hidden sm:block" />
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleSaveAndReplaceOriginal(text, 'manual', 'עורך טקסט', 'שמירה ידנית')}
            >
              <Save className="w-3.5 h-3.5" />
              שמור והחלף מקור
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => handleDuplicateAndSave(text, 'manual', 'עורך טקסט', 'שכפול ידני')}
            >
              <Copy className="w-3.5 h-3.5" />
              שכפל ושמור
            </Button>
          </div>
        )}

        {/* Main Content */}
        <Tabs defaultValue="edit" className="w-full" dir="rtl">
          {/* Primary tabs — core workflow */}
          {(() => {
            const orderedPrimary = tabOrder
              .filter((id) => visibleTabs.includes(id))
              .map((id) => ALL_TABS.find((t) => t.id === id))
              .filter((t): t is TabConfig => !!t && t.group === "primary");
            const orderedSecondary = tabOrder
              .filter((id) => visibleTabs.includes(id))
              .map((id) => ALL_TABS.find((t) => t.id === id))
              .filter((t): t is TabConfig => !!t && t.group === "secondary");
            return (
              <>
                {orderedPrimary.length > 0 && (
                  <TabsList className="flex w-full flex-wrap h-auto gap-1 p-1.5 mb-2">
                    {orderedPrimary.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="flex-1 min-w-[5rem] text-xs sm:text-sm py-2 px-3 rounded-lg">
                        {tab.emoji && <span className="ml-1">{tab.emoji}</span>}{tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
                {orderedSecondary.length > 0 && (
                  <TabsList className="flex w-full flex-wrap h-auto gap-1 p-1.5 bg-muted/40 mb-6 rounded-lg">
                    {orderedSecondary.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="flex-1 min-w-[4.5rem] text-xs py-1.5 px-2 rounded-md">
                        {tab.emoji && <span className="ml-1">{tab.emoji}</span>}{tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
              </>
            );
          })()}

          <TabsContent value="player" className="space-y-6">
            <LazyErrorBoundary label="נגן מסונכרן">
            {/* Layout toggle */}
            <div className="flex justify-end mb-2 gap-2" dir="rtl">
              <Button
                variant={isPlayerFloating ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={togglePlayerFloating}
                title="נגן צף (Ctrl+Shift+F)"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                נגן צף
              </Button>
              <Button
                variant={isEqFloating ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={toggleEqFloating}
                title="איקולייזר צף (Ctrl+Shift+E)"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                EQ צף
              </Button>
              <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1 border border-border/50 shadow-sm">
                <Button
                  variant={playerLayout === 'split' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg"
                  onClick={() => setPlayerLayout('split')}
                  title="פריסה מפוצלת"
                >
                  <LayoutPanelLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={playerLayout === 'stacked' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg"
                  onClick={() => setPlayerLayout('stacked')}
                  title="פריסה מוערמת"
                >
                  <LayoutPanelTop className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={playerLayout === 'wide' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg"
                  onClick={() => setPlayerLayout('wide')}
                  title="פריסה רחבה — נגן+אקווילייזר רוחב מלא, תמלולים צד-בצד"
                >
                  <StretchHorizontal className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={playerLayout === 'full' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg"
                  onClick={() => setPlayerLayout('full')}
                  title="נגן מלא"
                >
                  <Square className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={playerLayout === 'eq-wide' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-lg"
                  onClick={() => setPlayerLayout('eq-wide')}
                  title="אקולייזר פרוס — מיקסר רוחב מלא מתחת לנגן"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Top section: Player + Audio Processing */}
            {isPlayerFloating ? (
              <Suspense fallback={null}>
                <FloatingPlayerPortal onClose={togglePlayerFloating}>
                  <SyncAudioPlayer
                    audioUrl={audioUrl}
                    wordTimings={wordTimings}
                    currentTime={playerTime}
                    onTimeUpdate={setPlayerTime}
                    syncEnabled={syncEnabled}
                    onSyncToggle={setSyncEnabled}
                    compact={!isEqFloating}
                    eqFloating={isEqFloating}
                    eqPortalTarget={eqPortalTarget}
                  />
                </FloatingPlayerPortal>
              </Suspense>
            ) : (
              <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm p-1">
                <SyncAudioPlayer
                  audioUrl={audioUrl}
                  wordTimings={wordTimings}
                  currentTime={playerTime}
                  onTimeUpdate={setPlayerTime}
                  syncEnabled={syncEnabled}
                  onSyncToggle={setSyncEnabled}
                  eqWide={playerLayout === 'eq-wide'}
                  eqFloating={isEqFloating}
                  eqPortalTarget={eqPortalTarget}
                />
              </div>
            )}

            {/* Floating EQ window */}
            {isEqFloating && (
              <Suspense fallback={null}>
                <FloatingPlayerPortal
                  onClose={toggleEqFloating}
                  title="🎛️ איקולייזר צף"
                  storageKey="floating_eq_pos_v1"
                  defaultWidth={600}
                  defaultHeight={500}
                  contentRef={setEqPortalTarget}
                />
              </Suspense>
            )}

            {/* Search bar for transcript */}
            {transcriptSearchOpen && (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-primary/30 bg-muted/50 shadow-sm" dir="rtl">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  ref={searchInputRef}
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
                  placeholder="חיפוש בתמלול..."
                  value={transcriptSearchQuery}
                  onChange={(e) => { setTranscriptSearchQuery(e.target.value); setTranscriptSearchIdx(0); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setTranscriptSearchOpen(false);
                      setTranscriptSearchQuery("");
                      setTranscriptSearchIdx(0);
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      setTranscriptSearchIdx(i => (i + 1) % Math.max(1, transcriptMatchCount));
                    }
                    if (e.key === 'Enter' && e.shiftKey) {
                      setTranscriptSearchIdx(i => (i - 1 + Math.max(1, transcriptMatchCount)) % Math.max(1, transcriptMatchCount));
                    }
                  }}
                  autoFocus
                />
                <span className="text-xs text-muted-foreground min-w-[60px] text-center">
                  {transcriptMatchCount > 0 ? `${transcriptSearchIdx + 1} / ${transcriptMatchCount}` : transcriptSearchQuery ? 'לא נמצא' : ''}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTranscriptSearchIdx(i => (i - 1 + Math.max(1, transcriptMatchCount)) % Math.max(1, transcriptMatchCount))} title="הקודם (Shift+Enter)">
                  <ChevronUp className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTranscriptSearchIdx(i => (i + 1) % Math.max(1, transcriptMatchCount))} title="הבא (Enter)">
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setTranscriptSearchOpen(false); setTranscriptSearchQuery(""); setTranscriptSearchIdx(0); }} title="סגור (Escape)">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* Bottom section: Two synced transcript views */}
            {playerLayout !== 'full' && (
              <div className={`grid gap-5 flex-1 ${playerLayout === 'stacked' || playerLayout === 'eq-wide' ? 'grid-cols-1' : playerLayout === 'wide' ? 'grid-cols-2' : 'grid-cols-1 lg:grid-cols-2'}`} style={{ minHeight: '60vh' }}>
                <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm overflow-hidden flex flex-col" style={{ minHeight: '60vh' }}>
                  <SyncTranscriptView
                    wordTimings={wordTimings}
                    currentTime={playerTime}
                    onWordClick={(time) => setPlayerTime(time)}
                    onWordReplace={handleSyncedWordReplace}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    syncEnabled={syncEnabled}
                    searchQuery={transcriptSearchOpen ? transcriptSearchQuery : undefined}
                    searchActiveIndex={transcriptSearchIdx}
                    onSearchMatchCount={setTranscriptMatchCount}
                  />
                </div>
                <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm overflow-hidden flex flex-col" style={{ minHeight: '60vh' }}>
                  <SyncEditableView
                    wordTimings={wordTimings}
                    currentTime={playerTime}
                    text={text}
                    onTextChange={handlePlayerEditorChange}
                    onWordClick={(time) => setPlayerTime(time)}
                    onWordReplace={handleSyncedWordReplace}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    syncEnabled={syncEnabled}
                    searchQuery={transcriptSearchOpen ? transcriptSearchQuery : undefined}
                    searchActiveIndex={transcriptSearchIdx}
                  />
                </div>
              </div>
            )}

            </LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="edit" className="space-y-5">
            {/* Marking toolbar — always visible, text display only when active */}
            <LazyErrorBoundary label="סימון ויזואלי">
              <TextMarkingOverlay
                text={text}
                onTextChange={handleEditorChange}
                fontSize={fontSize}
                fontFamily={fontFamily}
                lineHeight={lineHeight}
                toolbarOnly={!isMarkingActive}
                onActiveChange={setIsMarkingActive}
              />
            </LazyErrorBoundary>
            {/* Editable text — hidden when marking analysis is shown */}
            {!isMarkingActive && (
              <div
                style={{
                  fontSize: `${fontSize}px`,
                  fontFamily: fontFamily,
                  color: textColor,
                  lineHeight: lineHeight,
                }}
              >
                <RichTextEditor 
                  text={text} 
                  onChange={handleEditorChange}
                  columnStyle={columnStyle}
                  onSaveReplaceOriginal={() => handleSaveAndReplaceOriginal(text, 'manual', 'עורך טקסט', 'שמירה מסרגל העורך')}
                  onDuplicateSave={() => handleDuplicateAndSave(text, 'manual', 'עורך טקסט', 'שכפול מסרגל העורך')}
                  onWordCorrected={(original, corrected) => {
                    debugLog.info('TextEditor', `Spell correction: "${original}" → "${corrected}"`);
                  }}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="speakers" className="space-y-5">
            <LazyErrorBoundary label="זיהוי דוברים">
              <SpeakerDiarization serverUrl="/whisper" initialAudioBlob={audioBlob} initialAudioName={audioFileName} initialText={text} />
            </LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="templates" className="space-y-5">
            <LazyErrorBoundary label="תבניות עריכה"><EditingTemplates
              text={text}
              onApply={(newText, templateName) => {
                addVersion(newText, 'ai-custom', templateName);
              }}
            /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="ai" className="space-y-5">
            <div
              style={{
                fontSize: `${fontSize}px`,
                fontFamily: fontFamily,
                color: textColor,
                lineHeight: lineHeight,
                ...columnStyle,
              }}
            >
              <LazyErrorBoundary label="עורך AI"><AIEditorDual 
                text={text} 
                onTextChange={(newText, source, customPrompt) => {
                  setText(newText);
                  addVersion(newText, source as TextVersion['source'], customPrompt);
                }}
                onSaveVersion={handleSaveVersion}
                onSaveAndReplaceOriginal={handleSaveAndReplaceOriginal}
                onDuplicateAndSave={handleDuplicateAndSave}
                onSyncToPlayer={handleSyncToPlayer}
              /></LazyErrorBoundary>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                במסך הזה אפשר גם להשוות בין כל הגרסאות (מקומי + ענן) וגם להריץ עריכת AI ישירות.
              </p>
              <Button
                variant={showCompareAi ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowCompareAi((v) => !v)}
              >
                {showCompareAi ? "הסתר עריכת AI" : "עריכת AI במסך ההשוואה"}
              </Button>
            </div>

            {compareVersions.length >= 2 ? (
              <LazyErrorBoundary label="השוואה מתקדמת"><AdvancedDiffView 
                versions={compareVersions}
                fontSize={fontSize}
                fontFamily={fontFamily}
                textColor={textColor}
                lineHeight={lineHeight}
                onApplyVersion={(newText) => {
                  setText(newText);
                }}
              /></LazyErrorBoundary>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                יש צורך בלפחות שתי גרסאות כדי להשוות
              </div>
            )}

            {showCompareAi && (
              <div
                style={{
                  fontSize: `${fontSize}px`,
                  fontFamily: fontFamily,
                  color: textColor,
                  lineHeight: lineHeight,
                }}
              >
                <LazyErrorBoundary label="עורך AI בתוך השוואה"><AIEditorDual
                  text={text}
                  onTextChange={(newText, source, customPrompt) => {
                    setText(newText);
                    addVersion(newText, source as TextVersion['source'], customPrompt);
                  }}
                  onSaveVersion={handleSaveVersion}
                  onSaveAndReplaceOriginal={handleSaveAndReplaceOriginal}
                  onDuplicateAndSave={handleDuplicateAndSave}
                  onSyncToPlayer={handleSyncToPlayer}
                /></LazyErrorBoundary>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pipeline" className="space-y-5">
            <LazyErrorBoundary label="צינור עריכה"><EditPipeline
              text={text}
              onTextChange={(newText, source, customPrompt) => {
                setText(newText);
                addVersion(newText, source as TextVersion['source'], customPrompt);
              }}
            /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="prompts" className="space-y-5">
            <LazyErrorBoundary label="ספריית פרומפטים"><PromptLibrary
              text={text}
              onTextChange={(newText, source, customPrompt) => {
                setText(newText);
                addVersion(newText, source as TextVersion['source'], customPrompt);
              }}
            /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="ollama" className="space-y-5">
            <LazyErrorBoundary label="Ollama"><OllamaManager /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="learning" className="space-y-5">
            <LazyErrorBoundary label="למידת תיקונים"><CorrectionLearningPanel /></LazyErrorBoundary>
          </TabsContent>
          <TabsContent value="vocab" className="space-y-5">
            <LazyErrorBoundary label="בדיקת מילון">
              <DictionaryValidator text={text} onApplyFix={(original, fixed) => {
                const newText = text.replace(new RegExp(`\\b${original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), fixed);
                if (newText !== text) {
                  setText(newText);
                  toast({ title: "תוקן", description: `"${original}" → "${fixed}"` });
                }
              }} />
            </LazyErrorBoundary>
            <LazyErrorBoundary label="אוצר מילים"><VocabularyPanel /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="summary" className="space-y-5">
            <LazyErrorBoundary label="סיכום"><AutoSummaryCard text={text} /></LazyErrorBoundary>
            <LazyErrorBoundary label="סיכום AI"><TranscriptSummary transcript={text} /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="ab" className="space-y-5">
            <LazyErrorBoundary label="השוואת מנועים"><EngineCompare text={text} /></LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-5">
            <LazyErrorBoundary label="אנליטיקס"><AnalyticsDashboard /></LazyErrorBoundary>
          </TabsContent>
          <TabsContent value="history" className="space-y-5">
            <LazyErrorBoundary label="היסטוריית עריכה"><TextEditHistory 
              versions={versions}
              onSelectVersion={handleVersionSelect}
              selectedVersionId={selectedVersionId}
              cloudVersions={cloudVersions}
              cloudLoading={cloudVersionsLoading}
              onRestoreVersion={handleRestoreVersion}
            /></LazyErrorBoundary>
          </TabsContent>
        </Tabs>

        {/* Back Button */}
        <div className="flex justify-center pt-4 mt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            חזרה לעמוד הראשי
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShortcutsOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            title="קיצורי מקלדת"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
    <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </Suspense>
  );
};

export default TextEditor;
