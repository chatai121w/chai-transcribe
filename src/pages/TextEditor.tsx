import { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PlayerTranscriptEditor } from "@/components/PlayerTranscriptEditor";
import { SyncMirrorLayout } from "@/components/SyncMirrorLayout";
import { TranscriptFolderDialog } from "@/components/TranscriptFolderDialog";
import { RetranscribeDialog } from "@/components/RetranscribeDialog";
import { useFolderTree } from "@/hooks/useFolderTree";
import { AttachTranscriptToVideoDialog } from "@/components/AttachTranscriptToVideoDialog";
import { debugLog } from "@/lib/debugLogger";
import { AlignmentStatusBanner } from "@/components/AlignmentStatusBanner";
import type { TextVersion } from "@/components/TextEditHistory";
import type { WordTiming, SyncAudioPlayerRef } from "@/components/SyncAudioPlayer";
import { TextStyleControl } from "@/components/TextStyleControl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Check as CheckIcon, Eraser, FolderOpen } from "lucide-react";

// Lazy-loaded heavy components
const SyncAudioPlayer = lazy(() => import("@/components/SyncAudioPlayer").then(m => ({ default: m.SyncAudioPlayer })));
const AIEditorDual = lazy(() => import("@/components/AIEditorDual").then(m => ({ default: m.AIEditorDual })));

const EditingTemplates = lazy(() => import("@/components/EditingTemplates").then(m => ({ default: m.EditingTemplates })));
const AdvancedDiffView = lazy(() => import("@/components/AdvancedDiffView").then(m => ({ default: m.AdvancedDiffView })));
// TextStyleControl is in the header (always rendered) — must be eager to avoid triggering outer Suspense
const TextEditHistory = lazy(() => import("@/components/TextEditHistory").then(m => ({ default: m.TextEditHistory })));
const PromptLibrary = lazy(() => import("@/components/PromptLibrary").then(m => ({ default: m.PromptLibrary })));
const EditPipeline = lazy(() => import("@/components/EditPipeline").then(m => ({ default: m.EditPipeline })));
const OllamaManager = lazy(() => import("@/components/OllamaManager").then(m => ({ default: m.OllamaManager })));
const SyncEditableView = lazy(() => import("@/components/SyncEditableView").then(m => ({ default: m.SyncEditableView })));
const SyncTranscriptView = lazy(() => import("@/components/SyncTranscriptView").then(m => ({ default: m.SyncTranscriptView })));
const VerifiedTranscriptLabTransfer = lazy(() => import("@/components/VerifiedTranscriptLabTransfer").then(m => ({ default: m.VerifiedTranscriptLabTransfer })));
const AudioLearningQueue = lazy(() => import("@/components/AudioLearningQueue").then(m => ({ default: m.AudioLearningQueue })));
const DictionaryValidator = lazy(() => import("@/components/DictionaryValidator").then(m => ({ default: m.DictionaryValidator })));
const AutoSummaryCard = lazy(() => import("@/components/AutoSummaryCard").then(m => ({ default: m.AutoSummaryCard })));
const TranscriptSummary = lazy(() => import("@/components/TranscriptSummary").then(m => ({ default: m.TranscriptSummary })));
const EngineCompare = lazy(() => import("@/components/EngineCompare").then(m => ({ default: m.EngineCompare })));
const AnalyticsDashboard = lazy(() => import("@/components/AnalyticsDashboard").then(m => ({ default: m.AnalyticsDashboard })));
const SpeakerDiarization = lazy(() => import("@/components/SpeakerDiarization").then(m => ({ default: m.SpeakerDiarization })));
const FloatingPlayerPortal = lazy(() => import("@/components/FloatingPlayerPortal").then(m => ({ default: m.FloatingPlayerPortal })));
const KeyboardShortcutsDialog = lazy(() => import("@/components/KeyboardShortcutsDialog").then(m => ({ default: m.KeyboardShortcutsDialog })));
const LoshonKodeshRules = lazy(() => import("@/pages/LoshonKodeshRules"));
const AIVersionsGrid = lazy(() => import("@/components/AIVersionsGrid").then(m => ({ default: m.AIVersionsGrid })));
import { Home, Wand2, SplitSquareVertical, SpellCheck, Loader2, Rows3, Save, Copy, LayoutPanelLeft, Square, PictureInPicture2, SlidersHorizontal, Search, ChevronUp, ChevronDown, X, Keyboard, Cloud, Type, ShoppingBasket, ScrollText, ArrowLeftCircle, Link, AudioWaveform, Captions, RotateCcw } from "lucide-react";
import type { RetranscriptionResult } from "@/lib/retranscriptionRunner";
import { uploadToDrive } from "@/components/GoogleDriveBrowser";
import { DriveFolderPicker } from "@/components/DriveFolderPicker";
import { TabSettingsManager, TabConfig, loadTabSettings, saveTabSettings, getDefaultTabConfig } from "@/components/TabSettingsManager";

const getAudioComparisonKey = (path?: string | null): string | null => {
  if (!path) return null;
  const fileName = decodeURIComponent(path.split('/').pop() || '')
    .replace(/^\d+_/, '')
    .trim()
    .toLocaleLowerCase();
  return fileName || null;
};

const joinVersionLabels = (...labels: Array<string | null | undefined>): string | undefined => {
  const unique = Array.from(new Set(labels.map(label => label?.trim()).filter(Boolean) as string[]));
  return unique.length ? unique.join(' • ') : undefined;
};

const formatVersionTime = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
import { supabase } from "@/integrations/supabase/client";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { toast } from "@/hooks/use-toast";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useCloudVersions } from "@/hooks/useCloudVersions";
import { useOllama, isOllamaModel } from "@/hooks/useOllama";
import {
  chooseTranscriptFormattingModel,
  preservesTranscriptWords,
  requiresExactWordPreservation,
} from "@/lib/transcriptFormatting";
import { db, buildAudioFingerprint, clearLastAudioAlias, retainAudioBlob } from "@/lib/localDb";
import { fingerprintFile } from "@/lib/recordingFingerprint";
import { useCorrectionLearning } from "@/hooks/useCorrectionLearning";
import { getServerUrl } from "@/lib/serverConfig";
import {
  addProfileLearningSample,
  bulkTrainProfile,
  diffForTraining,
  getProfile,
  listProfiles,
} from "@/lib/pronunciationProfiles";
import { alignEditedToWhisper, findActiveWordIndex, fitTimingsToDuration } from "@/lib/whisperAlignment";
import { syncLog, startLongTaskWatch } from "@/lib/syncPerfTrace";
import { LazyErrorBoundary } from "@/components/LazyErrorBoundary";
import { CollapsibleWidget } from "@/components/ui/CollapsibleWidget";
import {
  readAudioLearningCandidates,
  writeAudioLearningCandidates,
  getAudioLearningOperation,
  type AudioLearningCandidate,
} from "@/lib/audioLearning";
import "@/styles/mobile-pages.css";

type PlayerLayout = 'split' | 'full' | 'eq-wide';

// Inline editor for the transcript's title — shown at the top of the AI tab.
function TranscriptTitleEditor({
  transcriptId,
  transcripts,
  updateTranscript,
}: {
  transcriptId: string | null;
  transcripts: any[];
  updateTranscript: (id: string, updates: { title?: string }) => Promise<unknown>;
}) {
  const current = transcriptId ? transcripts.find((t) => t.id === transcriptId) : null;
  const remoteTitle = (current?.title as string | undefined) || "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(remoteTitle);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setValue(remoteTitle);
  }, [remoteTitle, editing]);

  if (!transcriptId) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        שמור את התמלול בענן כדי לערוך את שמו
      </div>
    );
  }

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === remoteTitle) {
      setEditing(false);
      setValue(remoteTitle);
      return;
    }
    setSaving(true);
    try {
      await updateTranscript(transcriptId, { title: trimmed });
      toast({ title: "שם התמלול עודכן ✅" });
      setEditing(false);
    } catch (e) {
      toast({
        title: "שגיאה בעדכון השם",
        description: e instanceof Error ? e.message : "נסה שוב",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-right" dir="rtl">
      <span className="text-xs text-muted-foreground shrink-0">שם התמלול:</span>
      {editing ? (
        <>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setEditing(false);
                setValue(remoteTitle);
              }
            }}
            className="h-8 flex-1 text-right"
            dir="rtl"
            disabled={saving}
          />
          <Button size="sm" variant="default" onClick={save} disabled={saving}>
            <CheckIcon className="h-4 w-4 me-1" /> שמור
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-right text-sm font-medium" title={remoteTitle} dir="auto">
            {remoteTitle || "ללא שם"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4 me-1" /> ערוך
          </Button>
        </>
      )}
    </div>
  );
}

function TranscriptFolderNameEditor({
  transcriptId,
  transcripts,
  updateTranscript,
  onChooseFolder,
}: {
  transcriptId: string | null;
  transcripts: any[];
  updateTranscript: (id: string, updates: { folder?: string }) => Promise<unknown>;
  onChooseFolder: () => void;
}) {
  const { folders, updateFolder, getPath } = useFolderTree();
  const current = transcriptId ? transcripts.find((item) => item.id === transcriptId) : null;
  const folderId = (current?.folder_id as string | null | undefined) || null;
  const folder = folderId ? folders.find((item) => item.id === folderId) : null;
  const remoteName = folder?.name || (current?.folder as string | undefined) || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(remoteName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setValue(remoteName);
  }, [editing, remoteName]);

  const save = async () => {
    const trimmed = value.trim();
    if (!transcriptId || !folderId || !trimmed || trimmed === remoteName) {
      setEditing(false);
      setValue(remoteName);
      return;
    }
    setSaving(true);
    try {
      await updateFolder(folderId, { name: trimmed });
      const fullPath = getPath(folderId).map((item) => item.id === folderId ? trimmed : item.name).join(' / ');
      await updateTranscript(transcriptId, { folder: fullPath || trimmed });
      toast({ title: 'שם התיקייה עודכן' });
      setEditing(false);
    } catch (error) {
      toast({ title: 'שגיאה בעדכון שם התיקייה', description: error instanceof Error ? error.message : 'נסה שוב', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-right" dir="rtl">
      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs text-muted-foreground">שם התיקייה:</span>
      {editing ? (
        <>
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') { setEditing(false); setValue(remoteName); }
            }}
            className="h-8 flex-1 text-right"
            dir="rtl"
            disabled={saving}
            aria-label="עריכת שם התיקייה"
          />
          <Button size="sm" onClick={() => void save()} disabled={saving || !value.trim()}>
            <CheckIcon className="h-4 w-4 me-1" /> שמור
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-right text-sm font-medium" dir="auto">{remoteName || 'ללא תיקייה'}</span>
          {folderId && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="h-4 w-4 me-1" /> ערוך</Button>}
          <Button size="sm" variant="outline" onClick={onChooseFolder}>{folderId ? 'החלף' : 'בחר'}</Button>
        </>
      )}
    </div>
  );
}


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
  const latestTextRef = useRef("");
  const latestVersionsRef = useRef<TextVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>("");
  const [sourceRecordingId, setSourceRecordingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!audioBlob) {
      setSourceRecordingId(null);
      return () => { cancelled = true; };
    }
    fingerprintFile(audioBlob)
      .then((fingerprint) => {
        if (!cancelled) setSourceRecordingId(fingerprint);
      })
      .catch(() => {
        if (!cancelled) setSourceRecordingId(null);
      });
    return () => { cancelled = true; };
  }, [audioBlob]);
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const wordTimingsRef = useRef<WordTiming[]>([]);
  const wordTimingsRevisionRef = useRef(0);
  const [audioLearningCandidates, setAudioLearningCandidates] = useState<AudioLearningCandidate[]>([]);

  useEffect(() => {
    wordTimingsRef.current = wordTimings;
  }, [wordTimings]);
  const [playerTime, setPlayerTime] = useState(0);
  const lastWordIdxRef = useRef(-2); // -2 = uninitialised
  const playerTimeRef = useRef(0);
  const lastPlayerRenderAtRef = useRef(-1);
  const clockStats = useRef({ ticks: 0, renders: 0, wordChanges: 0, since: 0 });
  const transcriptIdRef = useRef<string | null>(null);
  const manualVersionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { updateTranscript, getAudioUrl, saveTranscript, transcripts, ensureTranscriptAudioUploaded } = useCloudTranscripts();
  const [labTransferBusy, setLabTransferBusy] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [forcedAlignmentState, setForcedAlignmentState] = useState<{
    status: 'idle' | 'aligning' | 'aligned' | 'partial' | 'error';
    coverage?: number;
    confidence?: number;
    progress?: number;
  }>({ status: 'idle' });
  const alignmentAbortRef = useRef<AbortController | null>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const { versions: cloudVersions, isLoading: cloudVersionsLoading, saveVersion: saveCloudVersion } = useCloudVersions(transcriptId);
  const ollama = useOllama();
  const { learn: learnCorrections, applyCorrections } = useCorrectionLearning();
  const originalTextRef = useRef<string>("");
  // Baseline used for correction-learning. Resets to the latest AI/version output
  // so that learning captures only the user's manual edits *on top of* the AI text,
  // not the AI's stylistic changes (punctuation, paragraph splits, rewording).
  const learningBaselineRef = useRef<string>("");
  const ownedAudioUrlRef = useRef<string | null>(null);
  const audioLearningStorageKey = useMemo(
    () => `audio_learning_candidates_v1:${transcriptId || audioFileName || 'current-transcript'}`,
    [transcriptId, audioFileName],
  );

  useEffect(() => {
    setAudioLearningCandidates(readAudioLearningCandidates(audioLearningStorageKey));
  }, [audioLearningStorageKey]);

  const updateAudioLearningCandidates = useCallback(
    (updater: (current: AudioLearningCandidate[]) => AudioLearningCandidate[]) => {
      setAudioLearningCandidates((current) => {
        const next = updater(current);
        writeAudioLearningCandidates(audioLearningStorageKey, next);
        return next;
      });
    },
    [audioLearningStorageKey],
  );

  // Tab settings (visibility + order)
  const ALL_TABS: TabConfig[] = [
    { id: "player", label: "עורך טקסט", emoji: "🎧", group: "primary" },
    { id: "loshon", label: "לשון הקודש", emoji: "🕮", group: "primary" },
    { id: "speakers", label: "זיהוי דוברים", group: "primary" },
    { id: "templates", label: "תבניות", group: "primary" },
    { id: "ai", label: "עריכה עם AI", group: "primary" },
    { id: "pipeline", label: "צינור עיבוד", group: "primary" },
    { id: "prompts", label: "ספריית פרומפטים", group: "primary" },
    { id: "ollama", label: "Ollama", group: "secondary" },
    { id: "vocab", label: "בדיקת איות", group: "secondary" },
    { id: "summary", label: "סיכום", group: "secondary" },
    
    { id: "analytics", label: "אנליטיקה", group: "secondary" },
    { id: "compare", label: "השוואה", group: "secondary" },
    { id: "history", label: "היסטוריה", group: "secondary" },
  ];
  // Cloud-synced style settings (must be before effects that use preferences)
  const { preferences, updatePreference, patchTabSettings, isLoaded: cloudPreferencesLoaded } = useCloudPreferences();

  const [tabSettings, setTabSettings] = useState(() => {
    return loadTabSettings();
  });
  const visibleTabs = tabSettings.visible;
  const tabOrder = tabSettings.order;

  const mergeCloudUiSettings = useCallback((patch: Record<string, unknown>) => {
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(preferences.tab_settings_json || '{}'); } catch { /* use defaults */ }
    updatePreference('tab_settings_json', JSON.stringify({ ...current, ...patch }));
  }, [preferences.tab_settings_json, updatePreference]);

  const studioLayoutJson = useMemo(() => {
    try {
      const parsed = JSON.parse(preferences.tab_settings_json || '{}');
      return parsed.studioLayout ? JSON.stringify(parsed.studioLayout) : '';
    } catch { return ''; }
  }, [preferences.tab_settings_json]);

  const handleStudioLayoutChange = useCallback((value: string) => {
    try { mergeCloudUiSettings({ studioLayout: JSON.parse(value) }); } catch { /* ignore malformed state */ }
  }, [mergeCloudUiSettings]);

  const aiTaskModels = useMemo<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(preferences.tab_settings_json || '{}');
      return parsed.aiTaskModels && typeof parsed.aiTaskModels === 'object' ? parsed.aiTaskModels : {};
    } catch {
      return {};
    }
  }, [preferences.tab_settings_json]);

  const selectedAiTaskModel = useCallback((action: string) => aiTaskModels[action] || 'auto', [aiTaskModels]);

  const saveAiTaskModel = useCallback((action: string, model: string) => {
    patchTabSettings({ aiTaskModels: { ...aiTaskModels, [action]: model } });
    toast({ title: 'בחירת המנוע נשמרה', description: 'הבחירה תישמר גם לאחר רענון ותסונכרן לענן' });
  }, [aiTaskModels, patchTabSettings]);

  // Load tab settings from cloud when preferences are available
  useEffect(() => {
    if (!preferences.tab_settings_json) return;
    try {
      const parsed = JSON.parse(preferences.tab_settings_json);
      if (parsed?.visible && parsed?.order) {
        const defaults = getDefaultTabConfig();
        const validIds = new Set(defaults.order);
        const visible = parsed.visible.filter((id: string) => validIds.has(id));
        const order = parsed.order.filter((id: string) => validIds.has(id));
        for (const id of defaults.order) {
          if (!order.includes(id)) order.push(id);
          if (!parsed.order.includes(id) && !visible.includes(id)) visible.push(id);
        }
        const migrated = { ...parsed, visible, order };
        setTabSettings(current => {
          if (JSON.stringify(current) === JSON.stringify(migrated)) return current;
          saveTabSettings(visible, order);
          return migrated;
        });
        if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
          updatePreference('tab_settings_json', JSON.stringify(migrated));
        }
      }
    } catch {}
  }, [preferences.tab_settings_json, updatePreference]);

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

  // Player layout (cloud-synced)
  const storedPlayerLayout = preferences.player_layout || 'split';
  const playerLayout: PlayerLayout = storedPlayerLayout === 'full' || storedPlayerLayout === 'eq-wide'
    ? storedPlayerLayout
    : 'split';
  const setPlayerLayout = useCallback((v: PlayerLayout) => updatePreference('player_layout', v), [updatePreference]);
  useEffect(() => {
    if (!cloudPreferencesLoaded || storedPlayerLayout === playerLayout) return;
    updatePreference('player_layout', playerLayout);
  }, [cloudPreferencesLoaded, playerLayout, storedPlayerLayout, updatePreference]);
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
  const playerRef = useRef<SyncAudioPlayerRef>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Loshon Kodesh embedded tab
  const [activeTab, setActiveTab] = useState<string>("player");
  // Migrate removed workflow tabs to their surviving focused tools.
  useEffect(() => {
    if (activeTab === "edit") setActiveTab("player");
    if (activeTab === "learning") setActiveTab("vocab");
  }, [activeTab]);

  // AI Polish opt-in — saves Lovable credits when off. Persists in localStorage.
  const [aiPolishEnabled, setAiPolishEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('ai_polish_enabled') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('ai_polish_enabled', aiPolishEnabled ? '1' : '0'); } catch {}
  }, [aiPolishEnabled]);
  const [comparePreselect, setComparePreselect] = useState<{ leftId: string; rightId: string } | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [retranscribeDialogOpen, setRetranscribeDialogOpen] = useState(false);
  const [retranscribeRestoreRequest, setRetranscribeRestoreRequest] = useState(0);
  const [attachVideoDialogOpen, setAttachVideoDialogOpen] = useState(false);
  const [comparisonLibraryVersions, setComparisonLibraryVersions] = useState<TextVersion[]>([]);
  const [lkEmbeddedText, setLkEmbeddedText] = useState<string>("");
  const sendTextToLoshonKodesh = useCallback((opts?: { jump?: boolean }) => {
    const t = (text || "").trim();
    if (!t) {
      toast({ title: "אין טקסט לשליחה", description: "כתוב או טען תמלול תחילה", variant: "destructive" });
      return;
    }
    setLkEmbeddedText(t);
    toast({ title: "הטקסט נשלח ללשון הקודש", description: "פתח את הטאב כדי לבדוק ולהמיר" });
    if (opts?.jump) setActiveTab("loshon");
  }, [text]);

  const textWordCount = useMemo(() => {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [text]);
  const isLargeEditorSession = text.length > 18_000 || textWordCount > 2_500 || wordTimings.length > 2_500;
  const [forceFullSyncView, setForceFullSyncView] = useState(false);
  const shouldUseFastEditor = isLargeEditorSession && !forceFullSyncView;

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
    const stopLongTaskWatch = startLongTaskWatch();

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

    // Preload SyncAudioPlayer after first paint. Immediate preloading competes
    // with the editor's first render on long Groq transcripts and can freeze UI.
    const preloadTimer = window.setTimeout(() => {
      import("@/components/SyncAudioPlayer").catch(() => {});
    }, 1200);

    return () => {
      window.clearTimeout(preloadTimer);
      window.removeEventListener('keydown', handleKeyDown);
      stopLongTaskWatch();
      if (ownedAudioUrlRef.current) {
        URL.revokeObjectURL(ownedAudioUrlRef.current);
        ownedAudioUrlRef.current = null;
      }
      debugLog.info('TextEditor', '📝 TextEditor unmounted');
    };
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
            await retainAudioBlob(blob, audioFileName || 'audio', blob.type);
          } catch { /* Dexie not available */ }
        }
      } catch { /* fetch failed */ }
    })();
  }, [audioUrl, audioBlob, audioFileName]);

  useEffect(() => {
    // Get text from navigation state or localStorage
    const stateText = location.state?.text;
    const stateTranscriptId = location.state?.transcriptId as string | undefined;
    const stateTranscript = stateTranscriptId ? transcripts.find((item) => item.id === stateTranscriptId) : undefined;
    const stateEngineLabel = (location.state?.engineLabel as string | undefined) || stateTranscript?.engine || null;
    const savedTranscriptId = localStorage.getItem('current_transcript_id');
    const effectiveTranscriptId = stateTranscriptId || (!stateText ? savedTranscriptId || undefined : undefined);
    const savedText = localStorage.getItem('current_editing_text');
    const savedVersions = localStorage.getItem('text_versions');
    if (stateText) {
      // Browser refresh preserves router state. For the same transcript, resume
      // the newer local edit instead of re-importing the original state text.
      const resumeLocalEdit = Boolean(stateTranscriptId && savedTranscriptId === stateTranscriptId && savedText);
      const editorText = resumeLocalEdit ? savedText! : stateText;
      setText(editorText);
      originalTextRef.current = stateText;
      learningBaselineRef.current = editorText;
      const initialVersion: TextVersion = {
        id: crypto.randomUUID(),
        text: stateText,
        timestamp: new Date(),
        source: 'original',
        engineLabel: stateEngineLabel,
        actionLabel: 'תמלול ראשון',
        wordCount: stateText.split(/\s+/).filter(Boolean).length,
      };
      let restoredVersions: TextVersion[] = [];
      if (resumeLocalEdit && savedVersions) {
        try {
          restoredVersions = JSON.parse(savedVersions).map((version: TextVersion) => ({
            ...version,
            timestamp: new Date(version.timestamp),
          }));
        } catch { /* fall back to the original version */ }
      }
      const initialVersions = restoredVersions.length ? restoredVersions : [initialVersion];
      setVersions(initialVersions);
      setSelectedVersionId(initialVersions[initialVersions.length - 1].id);
      localStorage.setItem('current_editing_text', editorText);
      localStorage.setItem('text_versions', JSON.stringify(initialVersions));
      // Save initial version to cloud
      if (stateTranscriptId && !resumeLocalEdit) {
        // Defer to avoid calling saveCloudVersion before hook is ready
        setTimeout(() => {
          saveCloudVersion(stateText, 'original', stateEngineLabel, 'תמלול ראשון', { transcriptId: stateTranscriptId });
        }, 500);
      }
    } else {
      // Try to load from localStorage
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
        if (!originalTextRef.current) originalTextRef.current = savedText;
        if (!learningBaselineRef.current) learningBaselineRef.current = savedText;
      }
    }

    // Track transcript ID for cloud saves — persist it so re-entering the editor restores compare/AI versions.
    if (location.state?.transcriptId) {
      transcriptIdRef.current = location.state.transcriptId;
      setTranscriptId(location.state.transcriptId);
      try { localStorage.setItem('current_transcript_id', location.state.transcriptId); } catch { /* noop */ }
    } else if (!stateText) {
      try {
        const saved = localStorage.getItem('current_transcript_id');
        if (saved) {
          transcriptIdRef.current = saved;
          setTranscriptId(saved);
        }
      } catch { /* noop */ }
    } else {
      transcriptIdRef.current = null;
      setTranscriptId(null);
      try { localStorage.removeItem('current_transcript_id'); } catch { /* noop */ }
    }

    // Load audio URL from navigation state or resolve from Supabase Storage
    if (location.state?.openFloatingPlayer) {
      setActiveTab('player');
      setIsPlayerFloating(true);
    } else {
      const requestedTab = location.state?.initialTab as string | undefined;
      if (requestedTab === 'player' || requestedTab === 'ai' || requestedTab === 'compare') {
        setActiveTab(requestedTab);
      }
    }

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
              await retainAudioBlob(blob, location.state?.audioFileName || 'audio', blob.type);
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
    } else if (effectiveTranscriptId) {
      // Restore audio only from the same transcript. A global "last audio"
      // can belong to another recording and makes word highlighting misleading.
      setAudioUrl(null);
      setAudioBlob(null);
      db.transcripts.get(effectiveTranscriptId).then(async (localTranscript) => {
        if (transcriptIdRef.current !== effectiveTranscriptId) return;
        if (localTranscript?.audio_blob) {
          setOwnedAudioFromBlob(localTranscript.audio_blob, localTranscript.title || undefined);
          return;
        }
        if (localTranscript?.audio_file_path) {
          const url = await getAudioUrl(localTranscript.audio_file_path);
          if (url && transcriptIdRef.current === effectiveTranscriptId) setAudioUrl(url);
        }
      }).catch(() => { /* Dexie not available */ });
    } else if (!stateText) {
      // Legacy recovery is allowed only when no transcript or text was selected.
      tryRecoverAudioFromDexie();
    }

    // Load word timings from state, or fallback to localStorage, or fetch from cloud
    if (location.state?.wordTimings) {
      wordTimingsRef.current = location.state.wordTimings;
      setWordTimings(location.state.wordTimings);
    } else if (effectiveTranscriptId) {
      // Load timings by transcript identity. Prefer the local coherent record,
      // then refresh from cloud if available.
      wordTimingsRef.current = [];
      setWordTimings([]);
      try {
        const storedTranscriptId = localStorage.getItem('last_word_timings_transcript_id');
        const storedTimings = JSON.parse(localStorage.getItem('last_word_timings') || '[]');
        if (storedTranscriptId === effectiveTranscriptId
            && Array.isArray(storedTimings)
            && storedTimings.length > 0) {
          wordTimingsRef.current = storedTimings as WordTiming[];
          setWordTimings(storedTimings as WordTiming[]);
        }
      } catch { /* malformed or unavailable local cache */ }
      const requestedAtRevision = wordTimingsRevisionRef.current;
      db.transcripts.get(effectiveTranscriptId).then((localTranscript) => {
        if (localTranscript?.word_timings?.length
            && transcriptIdRef.current === effectiveTranscriptId
            && wordTimingsRevisionRef.current === requestedAtRevision) {
          const localTimings = localTranscript.word_timings as WordTiming[];
          wordTimingsRef.current = localTimings;
          setWordTimings(localTimings);
        }
      }).catch(() => { /* Dexie not available */ });
      supabase
        .from('transcripts')
        .select('word_timings')
        .eq('id', effectiveTranscriptId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.word_timings && Array.isArray(data.word_timings) && data.word_timings.length > 0
              && transcriptIdRef.current === effectiveTranscriptId
              && wordTimingsRevisionRef.current === requestedAtRevision) {
            const cloudTimings = data.word_timings as unknown as WordTiming[];
            wordTimingsRef.current = cloudTimings;
            setWordTimings(cloudTimings);
            debugLog.info('TextEditor', `Loaded ${(data.word_timings as any[]).length} word timings from cloud`);
          }
        });
    } else {
      // No matching identity means no trustworthy synchronization. Showing no
      // highlight is safer than highlighting words from another recording.
      wordTimingsRef.current = [];
      setWordTimings([]);
    }

  }, [location.state, tryRecoverAudioFromDexie, setOwnedAudioFromBlob, getAudioUrl]);

  // Direct entry fallback: when /text-editor opens without navigation state,
  // restore the latest cloud transcript so compare/history are not empty.
  useEffect(() => {
    if (transcriptIdRef.current || transcriptId) return;
    if (location.state?.text || !transcripts.length) return;

    const latest = [...transcripts].sort(
      (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    )[0];
    if (!latest?.id || !latest.text?.trim()) return;

    const editorText = latest.edited_text || latest.text;
    transcriptIdRef.current = latest.id;
    setTranscriptId(latest.id);
    originalTextRef.current = latest.text;
    learningBaselineRef.current = editorText;
    setText(editorText);

    const initialVersion: TextVersion = {
      id: 'current-original',
      text: latest.text,
      timestamp: new Date(latest.created_at),
      source: 'original',
      customPrompt: 'תמלול מקורי',
      engineLabel: latest.engine || null,
      actionLabel: 'תמלול ראשון',
      wordCount: latest.text.split(/\s+/).filter(Boolean).length,
      storage: latest.local_only ? 'local' : 'cloud',
    };
    setVersions(prev => prev.length ? prev : [initialVersion]);
    setSelectedVersionId(initialVersion.id);
    if (latest.word_timings?.length) {
      const latestTimings = latest.word_timings as WordTiming[];
      wordTimingsRef.current = latestTimings;
      setWordTimings(latestTimings);
    } else {
      try {
        const storedTranscriptId = localStorage.getItem('last_word_timings_transcript_id');
        const storedTimings = JSON.parse(localStorage.getItem('last_word_timings') || '[]');
        if (storedTranscriptId === latest.id
            && Array.isArray(storedTimings)
            && storedTimings.length > 0) {
          wordTimingsRef.current = storedTimings as WordTiming[];
          setWordTimings(storedTimings as WordTiming[]);
        }
      } catch { /* malformed or unavailable local cache */ }
    }
    if (latest.audio_blob) {
      setOwnedAudioFromBlob(latest.audio_blob, latest.title || undefined);
    } else if (latest.audio_file_path) {
      getAudioUrl(latest.audio_file_path).then((url) => {
        if (url) setAudioUrl(url);
      });
    }
    try {
      localStorage.setItem('current_transcript_id', latest.id);
      localStorage.setItem('current_editing_text', editorText);
    } catch { /* noop */ }
  }, [transcripts, transcriptId, location.state, setText, setOwnedAudioFromBlob, getAudioUrl]);

  // Auto-save text and versions to localStorage + debounce cloud save
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestTextRef.current = text;
  latestVersionsRef.current = versions;

  // A refresh can happen before the debounced save fires. Persist the latest
  // render synchronously so recent corrections survive reload/navigation.
  useEffect(() => {
    const flushLocalEdits = () => {
      try {
        localStorage.setItem('current_editing_text', latestTextRef.current);
        if (latestVersionsRef.current.length > 0) {
          localStorage.setItem('text_versions', JSON.stringify(latestVersionsRef.current));
        }
      } catch { /* storage can be unavailable during teardown */ }
    };
    window.addEventListener('pagehide', flushLocalEdits);
    window.addEventListener('beforeunload', flushLocalEdits);
    return () => {
      window.removeEventListener('pagehide', flushLocalEdits);
      window.removeEventListener('beforeunload', flushLocalEdits);
    };
  }, []);

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
          updateTranscript(transcriptIdRef.current, {
            edited_text: text,
            word_timings: wordTimingsRef.current,
          });
          debugLog.info('TextEditor', 'Auto-saved edited_text to cloud');
        }
      }, 3000);
    }
    return () => {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    };
  }, [text, versions]);

  useEffect(() => {
    if (!wordTimings.length || !transcriptId) return;
    try {
      localStorage.setItem('last_word_timings', JSON.stringify(wordTimings));
      localStorage.setItem('last_word_timings_transcript_id', transcriptId);
    } catch { /* quota/unavailable */ }
  }, [wordTimings, transcriptId]);

  // Pin any timings we hold to the audio itself, whatever produced them — an
  // alignment pass, or a transcription that already carried word timings.
  useEffect(() => {
    if (!wordTimings.length || !audioBlob) return;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    if (!words) return;
    const handle = setTimeout(() => {
      void db.audioTimings.put({
        id: buildAudioFingerprint(
          { size: audioBlob.size, name: audioFileName || 'audio' },
          wordTimings.at(-1)?.end || 0,
        ),
        word_timings: wordTimings,
        word_count: words,
        transcript_id: transcriptIdRef.current,
        audio_name: audioFileName || undefined,
        saved_at: Date.now(),
      }).catch(() => { /* Dexie unavailable */ });
    }, 1500);
    return () => clearTimeout(handle);
  }, [wordTimings, audioBlob, audioFileName, text]);

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
    // Persist immediately to local + cloud so re-renders never lose AI output.
    // If no cloud transcript yet, create one first then save the version.
    (async () => {
      try {
        let id = transcriptIdRef.current || transcriptId;
        if (!id) id = await ensureCloudTranscript();
        if (id) {
          await saveCloudVersion(newText, source, customPrompt || null, sourceLabels[source] || source, { transcriptId: id });
        }
      } catch (e) {
        console.error('[addVersion] persist failed', e);
        toast({ title: 'שמירת גרסה נכשלה', description: 'נשמר מקומית בלבד', variant: 'destructive' });
      }
    })();
  };

  const ensureCloudTranscript = useCallback(async (): Promise<string | null> => {
    if (transcriptIdRef.current) return transcriptIdRef.current;
    if (transcriptId) return transcriptId;
    const baseText = (text || '').trim();
    if (!baseText) {
      toast({ title: 'אין טקסט לשמירה', variant: 'destructive' });
      return null;
    }
    const navEngine = (location.state as any)?.engine;
    const engineName = typeof navEngine === 'string' && navEngine ? navEngine : 'manual';
    try {
      const audioFile = audioBlob
        ? new File([audioBlob], audioFileName || 'recording.wav', { type: audioBlob.type || 'audio/wav' })
        : undefined;
      const created = await saveTranscript(
        baseText,
        engineName,
        audioFileName || undefined,
        audioFile,
        wordTimingsRef.current,
      );
      if (created?.id) {
        transcriptIdRef.current = created.id;
        setTranscriptId(created.id);
        try { localStorage.setItem('current_transcript_id', created.id); } catch { /* noop */ }
        toast({ title: 'התמלול נשמר בענן ☁️' });
        return created.id;
      }
    } catch (e: any) {
      toast({ title: 'שמירה לענן נכשלה', description: e?.message, variant: 'destructive' });
    }
    return null;
  }, [transcriptId, text, saveTranscript, location.state, audioBlob, audioFileName]);

  const approveAndOpenTranscriptionLab = useCallback(async () => {
    if (!text.trim() || labTransferBusy) return;
    setLabTransferBusy(true);
    try {
      const id = transcriptIdRef.current || transcriptId || await ensureCloudTranscript();
      if (!id) throw new Error('לא ניתן ליצור רשומת מקור עבור התמלול');

      const current = transcripts.find((item) => item.id === id);
      await updateTranscript(id, {
        edited_text: text.trim(),
        word_timings: wordTimingsRef.current,
      });

      const audioPath = current?.audio_file_path || await ensureTranscriptAudioUploaded(id);
      if (!audioPath) throw new Error('לא נמצא אודיו מקושר. יש לשמור או לטעון את ההקלטה לפני המעבר למעבדה');

      const alreadySaved = cloudVersions.some((version) =>
        version.source === 'manual'
        && version.action_label === 'טקסט אמת מאומת'
        && typeof version.text === 'string'
        && version.text.trim() === text.trim(),
      );
      if (!alreadySaved) {
        await saveCloudVersion(text.trim(), 'manual', 'בדיקה אנושית', 'טקסט אמת מאומת', {
          transcriptId: id,
          audioFilePath: audioPath,
          folderId: current?.folder_id || null,
          wordTimings: wordTimingsRef.current,
        });
      }

      debugLog.info('TextEditor', 'Verified text linked to the central transcription lab', {
        transcriptId: id,
        audioFilePath: audioPath,
        reusedCloudAudio: Boolean(current?.audio_file_path),
      });
      navigate('/transcription-lab', {
        state: {
          source: 'verified-text-editor',
          sourceTranscriptId: id,
          audioFilePath: audioPath,
          audioFileName: audioFileName || current?.title || 'recording',
          initialTranscript: current?.text || originalTextRef.current,
          groundTruth: text.trim(),
        },
      });
    } catch (error) {
      debugLog.error('TextEditor', 'Failed to open verified transcript in lab', error instanceof Error ? error.message : String(error));
      toast({
        title: 'העברה למעבדה נכשלה',
        description: error instanceof Error ? error.message : 'שגיאה לא ידועה',
        variant: 'destructive',
      });
    } finally {
      setLabTransferBusy(false);
    }
  }, [
    audioFileName,
    cloudVersions,
    ensureCloudTranscript,
    ensureTranscriptAudioUploaded,
    labTransferBusy,
    navigate,
    saveCloudVersion,
    text,
    transcriptId,
    transcripts,
    updateTranscript,
  ]);

  const openRetranscriptionDialog = useCallback(async () => {
    const id = transcriptIdRef.current || transcriptId || await ensureCloudTranscript();
    if (!id) return;
    setRetranscribeRestoreRequest((current) => current + 1);
    setRetranscribeDialogOpen(true);
  }, [ensureCloudTranscript, transcriptId]);

  const assignCurrentTranscriptToFolder = useCallback(async (folderId: string | null, folderName: string) => {
    const id = transcriptIdRef.current || transcriptId || await ensureCloudTranscript();
    if (!id) throw new Error("לא ניתן לשמור את התמלול לפני השיוך");
    await updateTranscript(id, { folder_id: folderId, folder: folderName });
    toast({
      title: folderId ? "התמלול שויך לתיקייה" : "שיוך התיקייה הוסר",
      description: folderName || "ללא תיקייה",
    });
  }, [ensureCloudTranscript, transcriptId, updateTranscript]);

  const openCurrentTranscriptInCompare = useCallback(async () => {
    const id = transcriptIdRef.current || transcriptId || await ensureCloudTranscript();
    if (!id) return;
    setCompareSubTab("versions");
    setActiveTab("compare");
    toast({ title: "התמלול הועבר להשוואה", description: "בחר גרסה נוספת מהרשימה או מעץ התיקיות." });
  }, [ensureCloudTranscript, transcriptId]);

  const handleSaveVersion = async (text: string, source: string, engineLabel: string, actionLabel: string) => {
    // Save version to cloud WITHOUT replacing the main text
    let id = transcriptId;
    if (!id) id = await ensureCloudTranscript();
    if (id) {
      saveCloudVersion(text, source, engineLabel, actionLabel, { transcriptId: id });
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
  const [nikudStyle, setNikudStyle] = useState<'male' | 'haser'>(
    () => (localStorage.getItem('nikud_style') as 'male' | 'haser') || 'male'
  );
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [showCompareAi, setShowCompareAi] = useState(false);
  const [compareSubTab, setCompareSubTab] = useState("versions");
  const [aiPreselectSourceId, setAiPreselectSourceId] = useState<string | undefined>(undefined);

  const compareVersions = useMemo<TextVersion[]>(() => {
    const byId = new Map<string, TextVersion>();

    const currentTranscriptId = transcriptIdRef.current || transcriptId;
    const currentCloudTranscript = currentTranscriptId
      ? transcripts.find(t => t.id === currentTranscriptId)
      : undefined;

    const originalText = currentCloudTranscript?.text || originalTextRef.current || text;
    if (originalText?.trim()) {
      const matchingOriginalVersion = cloudVersions.find((version) => (
        typeof version.text === 'string'
        && version.text.normalize('NFKC').replace(/\s+/g, ' ').trim()
          === originalText.normalize('NFKC').replace(/\s+/g, ' ').trim()
        && Boolean(version.engine_label)
      ));
      byId.set('current-original', {
        id: 'current-original',
        text: originalText,
        timestamp: currentCloudTranscript?.created_at ? new Date(currentCloudTranscript.created_at) : new Date(0),
        source: 'original',
        customPrompt: joinVersionLabels(currentCloudTranscript?.engine, 'תמלול מקורי'),
        engineLabel: currentCloudTranscript?.engine || matchingOriginalVersion?.engine_label || null,
        actionLabel: 'תמלול ראשון',
        detectedLanguage: matchingOriginalVersion?.detected_language || null,
        wordCount: originalText.split(/\s+/).filter(Boolean).length,
        storage: currentCloudTranscript?.local_only ? 'local' : 'cloud',
      });
    }

    const editedText = currentCloudTranscript?.edited_text || text;
    if (editedText?.trim() && editedText !== originalText) {
      byId.set('current-edited', {
        id: 'current-edited',
        text: editedText,
        timestamp: currentCloudTranscript?.updated_at ? new Date(currentCloudTranscript.updated_at) : new Date(),
        source: 'manual',
        customPrompt: 'הטקסט הנוכחי בעורך',
        actionLabel: 'עריכה ידנית',
        wordCount: editedText.split(/\s+/).filter(Boolean).length,
        storage: currentCloudTranscript?.local_only ? 'local' : 'cloud',
      });
    }

    for (const v of versions) {
      if (typeof v.text !== 'string' || !v.text.trim()) continue;
      byId.set(v.id, {
        ...v,
        wordCount: v.wordCount ?? v.text.split(/\s+/).filter(Boolean).length,
        storage: v.storage || ((transcriptIdRef.current || transcriptId) ? 'cloud' : 'local'),
      });
    }

    for (const cv of cloudVersions) {
      if (byId.has(cv.id) || typeof cv.text !== 'string' || !cv.text.trim()) continue;
      byId.set(cv.id, {
        id: cv.id,
        text: cv.text,
        timestamp: new Date(cv.created_at),
        source: toKnownSource(cv.source),
        customPrompt: joinVersionLabels(cv.engine_label, cv.action_label),
        engineLabel: cv.engine_label,
        actionLabel: cv.action_label,
        detectedLanguage: cv.detected_language,
        wordCount: cv.word_count ?? cv.text.split(/\s+/).filter(Boolean).length,
        storage: 'cloud',
      });
    }

    for (const libraryVersion of comparisonLibraryVersions) {
      byId.set(libraryVersion.id, libraryVersion);
    }

    // A transcription engine run creates a transcript record of its own. Include
    // sibling runs made from the same uploaded audio so Gemini/Groq/local results
    // can be compared without manually converting them into editor versions.
    const audioKey = getAudioComparisonKey(currentCloudTranscript?.audio_file_path);
    if (audioKey) {
      for (const sibling of transcripts) {
        if (
          sibling.id === currentCloudTranscript?.id
          || getAudioComparisonKey(sibling.audio_file_path) !== audioKey
          || !sibling.text?.trim()
        ) continue;
        byId.set(`transcript-${sibling.id}`, {
          id: `transcript-${sibling.id}`,
          text: sibling.edited_text?.trim() || sibling.text,
          timestamp: new Date(sibling.created_at),
          source: 'original',
          customPrompt: joinVersionLabels(
            sibling.engine,
            'אותו קובץ אודיו',
            formatVersionTime(sibling.created_at),
          ),
          engineLabel: sibling.engine || null,
          actionLabel: 'תמלול נוסף',
          wordCount: (sibling.edited_text?.trim() || sibling.text).split(/\s+/).filter(Boolean).length,
          storage: sibling.local_only ? 'local' : 'cloud',
        });
      }
    }

    const sorted = Array.from(byId.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const uniqueByText = new Map<string, TextVersion>();
    const duplicateCounts = new Map<string, number>();
    for (const version of sorted) {
      if (typeof version.text !== 'string' || !version.text.trim()) continue;
      const signature = version.text.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!uniqueByText.has(signature)) {
        uniqueByText.set(signature, { ...version });
        duplicateCounts.set(signature, 1);
        continue;
      }
      duplicateCounts.set(signature, (duplicateCounts.get(signature) || 1) + 1);
      const existing = uniqueByText.get(signature)!;
      const duplicateEngine = version.engineLabel?.trim();
      const mergedEngines = Array.from(new Set([
        ...(existing.duplicateEngines || []),
        ...(existing.engineLabel ? [existing.engineLabel] : []),
        ...(duplicateEngine ? [duplicateEngine] : []),
      ]));
      uniqueByText.set(signature, {
        ...existing,
        engineLabel: existing.engineLabel || version.engineLabel || null,
        duplicateEngines: mergedEngines,
      });
    }
    return Array.from(uniqueByText.entries()).map(([signature, version]) => {
      const count = duplicateCounts.get(signature) || 1;
      return count === 1
        ? version
        : {
            ...version,
            customPrompt: joinVersionLabels(version.customPrompt, `${count} הרצות עם טקסט זהה`),
            runCount: count,
          };
    });
  }, [versions, cloudVersions, transcripts, transcriptId, text, comparisonLibraryVersions]);

  const selectLibraryTranscriptForCompare = useCallback((side: 'base' | 'new', item: (typeof transcripts)[number]) => {
    const libraryVersion: TextVersion = {
      id: `library-${item.id}`,
      text: item.edited_text?.trim() || item.text,
      timestamp: new Date(item.updated_at || item.created_at),
      source: 'original',
      customPrompt: joinVersionLabels(item.title, item.engine, item.folder || undefined),
      engineLabel: item.title?.trim()
        ? `${item.title.trim()}${item.engine ? ` · ${item.engine}` : ''}`
        : item.engine || null,
      actionLabel: 'תמלול מהספרייה',
      wordCount: (item.edited_text?.trim() || item.text).split(/\s+/).filter(Boolean).length,
      storage: item.local_only ? 'local' : 'cloud',
    };
    setComparisonLibraryVersions((previous) => [
      ...previous.filter((version) => version.id !== libraryVersion.id),
      libraryVersion,
    ]);
    setComparePreselect((previous) => ({
      leftId: side === 'base' ? libraryVersion.id : previous?.leftId || compareVersions[0]?.id || libraryVersion.id,
      rightId: side === 'new' ? libraryVersion.id : previous?.rightId || compareVersions[compareVersions.length - 1]?.id || libraryVersion.id,
    }));
    toast({ title: side === 'base' ? "גרסת הבסיס נבחרה" : "הגרסה החדשה נבחרה", description: item.title || item.engine });
  }, [compareVersions]);

  const sendVersionToCompare = useCallback((versionId: string) => {
    const original = compareVersions.find(v => v.source === 'original') || compareVersions[0];
    const target = compareVersions.find(v => v.id === versionId);
    if (!original || !target) {
      toast({ title: 'אין מספיק גרסאות להשוואה', variant: 'destructive' });
      return;
    }
    setComparePreselect({ leftId: original.id, rightId: target.id });
    setCompareSubTab("versions");
    setActiveTab('compare');
    toast({ title: 'נשלח להשוואה' });
  }, [compareVersions]);

  const handleRetranscriptionComplete = useCallback(async (result: RetranscriptionResult, jobId: string | null) => {
    const id = transcriptIdRef.current || transcriptId;
    if (!id) throw new Error("לא נמצא תמלול בסיס לשמירת הגרסה");
    const current = transcripts.find((item) => item.id === id);
    const saved = await saveCloudVersion(
      result.text,
      "transcription",
      result.engineLabel,
      "תמלול נוסף מאותה הקלטה",
      {
        transcriptId: id,
        audioFilePath: current?.audio_file_path || null,
        folderId: current?.folder_id || null,
        wordTimings: result.wordTimings,
        detectedLanguage: result.detectedLanguage || null,
        transcriptionJobId: jobId,
      },
    );
    if (!saved) throw new Error("לא ניתן לשמור את גרסת התמלול החדשה");
    setComparePreselect({
      leftId: current?.edited_text?.trim() && current.edited_text !== current.text ? "current-edited" : "current-original",
      rightId: saved.id,
    });
    setCompareSubTab("versions");
    setActiveTab("compare");
    toast({ title: "התמלול הנוסף הושלם", description: `${result.engineLabel} נשמר כגרסה חדשה ונפתח להשוואה` });
  }, [saveCloudVersion, transcriptId, transcripts]);

  const sendVersionToAiEditor = useCallback((versionId: string) => {
    const target = compareVersions.find(v => v.id === versionId);
    if (!target) {
      toast({ title: 'גרסה לא נמצאה', variant: 'destructive' });
      return;
    }
    setAiPreselectSourceId(versionId);
    // If we're inside the compare tab, open the inline AI editor; otherwise jump to AI tab
    if (activeTab === 'compare') {
      setShowCompareAi(true);
    } else {
      setActiveTab('ai');
    }
    toast({ title: 'נשלח לעריכת AI' });
  }, [compareVersions, activeTab]);

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
    const selectedModel = selectedAiTaskModel(action);
    try {
      let resultText: string | undefined;

      const useCloud = selectedModel.startsWith('cloud:') || (!ollama.isConnected && selectedModel === 'auto');

      if (!useCloud && ollama.isConnected && ollama.models.length > 0) {
        const model = selectedModel.startsWith('ollama:')
          ? selectedModel.slice('ollama:'.length)
          : chooseTranscriptFormattingModel(ollama.models);
        if (!model) throw new Error('לא נמצא מודל מקומי מתאים לעריכת תמלול');
        if (!ollama.models.some((item) => item.name === model)) {
          throw new Error(`המנוע שנבחר אינו מותקן: ${model}`);
        }
        resultText = await ollama.editText({ text, action, model });
      } else {
        const cloudModel = selectedModel === 'cloud:auto' || selectedModel === 'auto'
          ? undefined
          : selectedModel.replace(/^cloud:/, '');
        resultText = await editTranscriptCloud({ text, action, model: cloudModel });
      }

      if (!resultText) throw new Error('לא התקבלה תשובה מ-AI');
      if (requiresExactWordPreservation(action) && !preservesTranscriptWords(text, resultText)) {
        throw new Error('התוצאה נפסלה: המנוע שינה או השמיט מילים');
      }
      addVersion(resultText, 'ai-fix', labels[action]);
      toast({ title: `${labels[action]} הושלם ✅` });
    } catch (err) {
      // If Ollama failed, try cloud as fallback
      if (ollama.isConnected && selectedModel === 'auto') {
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

  const renderAiModelSelect = (action: 'fix_errors' | 'split_paragraphs' | 'fix_and_split', label: string) => (
    <Select value={selectedAiTaskModel(action)} onValueChange={(value) => saveAiTaskModel(action, value)}>
      <SelectTrigger className="h-7 w-[150px] text-xs bg-background" dir="rtl" aria-label={`בחירת מנוע עבור ${label}`}>
        <SelectValue placeholder="בחר מנוע" />
      </SelectTrigger>
      <SelectContent dir="rtl" align="end">
        <SelectItem value="auto">מומלץ אוטומטית</SelectItem>
        <SelectItem value="cloud:auto">ענן אוטומטי</SelectItem>
        <SelectItem value="cloud:gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
        <SelectItem value="cloud:gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
        {ollama.models.filter((model) => !/embedding|translate/i.test(model.name)).map((model) => (
          <SelectItem key={model.name} value={`ollama:${model.name}`}>{model.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  /** Add nikud (diacritics) to the Hebrew text via the local DICTA model. */
  const handleNikud = async (style: 'male' | 'haser' = nikudStyle) => {
    if (!text.trim()) {
      toast({ title: "אין טקסט לניקוד", variant: "destructive" });
      return;
    }
    if (style !== nikudStyle) {
      setNikudStyle(style);
      localStorage.setItem('nikud_style', style);
    }
    setAiAction('nikud');
    try {
      const res = await fetch(`${getServerUrl()}/nikud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 503) {
          throw new Error('מנוע הניקוד לא מותקן בשרת (דרוש transformers)');
        }
        throw new Error(body.error || `שגיאה ${res.status}`);
      }
      const data = await res.json();
      if (!data.text) throw new Error('לא התקבל טקסט מנוקד');
      const styleLabel = style === 'haser' ? 'כתיב חסר' : 'כתיב מלא';
      addVersion(data.text, 'ai-fix', `ניקוד · ${styleLabel} (DICTA)`);
      toast({
        title: 'ניקוד הושלם ✅',
        description: `${styleLabel} · רץ על ${data.device === 'cuda' ? 'GPU' : 'CPU'}`,
      });
    } catch (err) {
      console.error('Nikud error:', err);
      toast({ title: "שגיאה בניקוד", description: err instanceof Error ? err.message : 'שגיאה', variant: "destructive" });
    } finally {
      setAiAction(null);
    }
  };

  // Pre-warm the nikud model in the background when the editor opens, so the
  // first ניקוד click is instant instead of waiting ~5s for a cold start.
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${getServerUrl()}/nikud/warmup`, { method: 'POST', signal: ctrl.signal }).catch(() => {});
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  const handleEditorChange = useCallback((newText: string) => {
    setText(newText);
    // Debounce manual version creation (2s)
    if (manualVersionTimerRef.current) clearTimeout(manualVersionTimerRef.current);
    manualVersionTimerRef.current = setTimeout(() => {
      addVersion(newText, 'manual');
      // Learn from user corrections — compare against the learning baseline
      // (latest AI/loaded text), so AI Polish changes don't pollute the dataset.
      const baseline = learningBaselineRef.current || originalTextRef.current;
      if (baseline && newText !== baseline) {
        learnCorrections(baseline, newText, 'manual');
        // Advance the baseline so the next manual edit only diffs from here.
        learningBaselineRef.current = newText;
      }
    }, 2000);
  }, [learnCorrections]);

  // The player publishes a 20 Hz clock, but a full editor render is only worth
  // doing when the highlighted word actually moves — which on real speech is
  // closer to twice a second. The elapsed threshold used to be 0.05s, i.e. the
  // publish interval itself, so it let every single tick through and the whole
  // editor re-rendered twenty times a second. On a long transcript the synced
  // view renders thousands of word spans, and that was enough to hold the main
  // thread for seconds at a time.
  //
  // Word changes still render immediately, so the highlight is never late; the
  // interval only governs how often the clock readout refreshes in between.
  const PLAYER_CLOCK_RENDER_INTERVAL = 0.25;
  const handlePlayerTimeUpdate = useCallback((t: number) => {
    playerTimeRef.current = t;
    clockStats.current.ticks += 1;
    if (!wordTimings.length) {
      setPlayerTime(t);
      return;
    }
    const idx = findActiveWordIndex(wordTimings, t);
    const elapsed = Math.abs(t - lastPlayerRenderAtRef.current);
    if (idx !== lastWordIdxRef.current || elapsed >= PLAYER_CLOCK_RENDER_INTERVAL || t < lastPlayerRenderAtRef.current) {
      if (idx !== lastWordIdxRef.current) clockStats.current.wordChanges += 1;
      lastWordIdxRef.current = idx;
      lastPlayerRenderAtRef.current = t;
      clockStats.current.renders += 1;
      setPlayerTime(t);
    }
    // How many of the player's ticks actually reach React, and why. If `renders`
    // tracks `ticks` the gate is doing nothing; it should track `wordChanges`
    // plus roughly four clock refreshes a second.
    const now = performance.now();
    if (now - clockStats.current.since >= 3000) {
      const secs = (now - clockStats.current.since) / 1000;
      syncLog('🕐 player clock', {
        ticksPerSec: +(clockStats.current.ticks / secs).toFixed(1),
        rendersPerSec: +(clockStats.current.renders / secs).toFixed(1),
        wordChangesPerSec: +(clockStats.current.wordChanges / secs).toFixed(1),
      });
      clockStats.current = { ticks: 0, renders: 0, wordChanges: 0, since: now };
    }
  }, [wordTimings]);

  // Stable identity: the synced view memoizes its word rows against its props,
  // and a fresh arrow here would invalidate that on every clock tick.
  const handleSyncedWordClick = useCallback((time: number) => setPlayerTime(time), []);

  const handlePlayerEditorChange = useCallback((newText: string) => {
    handleEditorChange(newText);
  }, [handleEditorChange]);



  const handleSyncedWordReplace = useCallback((wordIndex: number, replacement: string) => {
    const fixed = replacement.trim();
    const isDelete = fixed === "__DELETE__";
    const visibleWords = latestTextRef.current.trim().split(/\s+/).filter(Boolean);
    const storedTimings = wordTimingsRef.current;
    const timingsMatchVisibleText = storedTimings.length === visibleWords.length
      && storedTimings.every((timing, index) => timing.word === visibleWords[index]);
    const currentTimings = timingsMatchVisibleText
      ? storedTimings
      : storedTimings.length === visibleWords.length
        ? storedTimings.map((timing, index) => ({ ...timing, word: visibleWords[index] }))
        : alignEditedToWhisper(visibleWords, storedTimings);
    if (!currentTimings.length || wordIndex < 0 || wordIndex >= currentTimings.length) return;
    if (!fixed && !isDelete) return;

    const correctedAt = Date.now();
    const originalTiming = currentTimings[wordIndex];
    const replacementWords = isDelete ? [] : fixed.split(/\s+/).filter(Boolean);
    const duration = Math.max(0, originalTiming.end - originalTiming.start);
    const replacementTimings = replacementWords.map((word, replacementIndex) => ({
      ...originalTiming,
      word,
      start: originalTiming.start + (duration * replacementIndex) / replacementWords.length,
      end: originalTiming.start + (duration * (replacementIndex + 1)) / replacementWords.length,
      correctionOriginal: originalTiming.correctionOriginal || originalTiming.word,
      correctedAt,
    }));
    const next = [
      ...currentTimings.slice(0, wordIndex),
      ...replacementTimings,
      ...currentTimings.slice(wordIndex + 1),
    ];
    const nextText = next.map((w) => w.word).join(' ');
    wordTimingsRef.current = next;
    wordTimingsRevisionRef.current += 1;
    setWordTimings(next);
    handleEditorChange(nextText);
    const correctedValue = isDelete ? '' : fixed;
    if (originalTiming.word !== correctedValue && audioBlob) {
      const contextStart = Math.max(0, wordIndex - 4);
      const contextEnd = Math.min(next.length, wordIndex + replacementTimings.length + 4);
      const context = next.slice(contextStart, contextEnd);
      const candidate: AudioLearningCandidate = {
        id: crypto.randomUUID(),
        recordingKey: sourceRecordingId || transcriptId || audioFileName || 'current-transcript',
        original: originalTiming.word,
        corrected: correctedValue,
        operation: getAudioLearningOperation(originalTiming.word, correctedValue),
        referenceText: context.map((item) => item.word).join(' '),
        start: Math.max(0, Math.min(context[0]?.start ?? originalTiming.start, originalTiming.start) - 1),
        end: Math.max(context[context.length - 1]?.end ?? originalTiming.end, originalTiming.end) + 1,
        createdAt: new Date().toISOString(),
      };
      updateAudioLearningCandidates((current) => [
        candidate,
        ...current.filter((item) => !(
          item.recordingKey === candidate.recordingKey
          && item.original === candidate.original
          && item.corrected === candidate.corrected
          && Math.abs(item.start - candidate.start) < 0.25
        )),
      ]);
    }
    try {
      localStorage.setItem('current_editing_text', nextText);
      localStorage.setItem('last_word_timings', JSON.stringify(next));
    } catch { /* quota/unavailable */ }
    addVersion(nextText, 'manual', isDelete ? 'מחיקת מילה' : `תיקון ידני: ${originalTiming.word} → ${fixed}`);
  }, [audioBlob, audioFileName, handleEditorChange, sourceRecordingId, transcriptId, updateAudioLearningCandidates]);

  const buildSyncedTimings = useCallback((editedText: string): WordTiming[] | null => {
    if (!wordTimings.length) return null;
    const words = editedText.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return alignEditedToWhisper(words, wordTimings);
  }, [wordTimings]);

  // Auto forced-alignment: when the editor has audio + text but no word timings
  // (e.g. Gemini/cloud engines that return text only), compute timings in the
  // background via the local server so word tracking works without a manual click.
  const autoAlignAttemptedRef = useRef<string | null>(null);

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

  const handleForcedAlignment = useCallback(async () => {
    const referenceText = latestTextRef.current.trim();
    if (!audioBlob || !referenceText) {
      toast({
        title: "לא ניתן לבצע יישור מדויק",
        description: "נדרשים אודיו וטקסט לפני הפעלת היישור",
        variant: "destructive",
      });
      return;
    }

    alignmentAbortRef.current?.abort();
    const controller = new AbortController();
    alignmentAbortRef.current = controller;
    setForcedAlignmentState({ status: 'aligning' });

    const approximateTimings = buildSyncedTimings(referenceText) || wordTimingsRef.current;
    const formData = new FormData();
    formData.append('file', audioBlob, audioFileName || 'audio.webm');
    formData.append('text', referenceText);
    formData.append('language', 'he');
    if (approximateTimings.length > 0) {
      formData.append('approximate_timings', JSON.stringify(approximateTimings));
    }

    // Progressive application: each aligned segment is final for its own audio
    // window, so we surface the covered prefix immediately instead of making the
    // user wait for the whole recording. The tail stays untimed until it arrives.
    const referenceWords = referenceText.split(/\s+/).filter(Boolean);
    const streamedRaw: WordTiming[] = [];
    const applyProgressive = (coveredUntil: number) => {
      if (!streamedRaw.length) return;
      if (latestTextRef.current.trim() !== referenceText) return;
      const mapped = alignEditedToWhisper(referenceWords, streamedRaw);
      const prefix: WordTiming[] = [];
      for (const item of mapped) {
        if (item.start > coveredUntil + 0.25) break;
        prefix.push(item);
      }
      if (!prefix.length) return;
      wordTimingsRevisionRef.current += 1;
      wordTimingsRef.current = prefix;
      setWordTimings(prefix);
      setSyncEnabled(true);
    };

    try {
      let result: Record<string, unknown> | null = null;

      // Preferred path: SSE stream — word tracking lights up segment by segment.
      const streamResponse = await fetch(`${getServerUrl()}/align-text-stream`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      }).catch(() => null);

      if (streamResponse?.ok && streamResponse.body) {
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamError: string | null = null;

        while (!result && !streamError) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(6));
            } catch { continue; }

            if (event.type === 'segment') {
              const segTimings = Array.isArray(event.wordTimings) ? event.wordTimings as WordTiming[] : [];
              streamedRaw.push(...segTimings);
              const coveredUntil = segTimings.at(-1)?.end ?? 0;
              applyProgressive(coveredUntil);
              setForcedAlignmentState({ status: 'aligning', progress: Number(event.progress) || 0 });
            } else if (event.type === 'done') {
              result = event;
            } else if (event.type === 'error') {
              streamError = String(event.error || 'Alignment failed');
            }
          }
        }
        if (streamError) throw new Error(streamError);
      }

      // Fallback: older server without the streaming endpoint.
      if (!result) {
        const response = await fetch(`${getServerUrl()}/align-text`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        result = await response.json();
        if (!response.ok) throw new Error((result?.error as string) || `Alignment failed (${response.status})`);
      }

      if (latestTextRef.current.trim() !== referenceText) {
        setForcedAlignmentState({ status: 'partial' });
        toast({
          title: "הטקסט השתנה בזמן היישור",
          description: "התוצאה לא הוחלה כדי לא לדרוס את העריכה החדשה",
        });
        return;
      }

      const rawTimings = Array.isArray(result?.wordTimings)
        ? result.wordTimings.filter((item: WordTiming) =>
          item
          && typeof item.word === 'string'
          && Number.isFinite(item.start)
          && Number.isFinite(item.end)
          && item.end >= item.start
        ).sort((a: WordTiming, b: WordTiming) => a.start - b.start || a.end - b.end)
        : [];
      const monotonic = rawTimings.every((item: WordTiming, index: number) =>
        index === 0 || item.start >= rawTimings[index - 1].start
      );
      const alignmentCoverage = Number(result?.coverage) || 0;
      const confidence = Number(result?.meanConfidence) || 0;
      // WhisperX confidence is conservative for Hebrew and especially chanting.
      // Normalize 0.70 as excellent while still requiring broad word coverage.
      const quality = alignmentCoverage * Math.min(1, confidence / 0.7);
      const words = referenceText.split(/\s+/).filter(Boolean);

      const minimumAlignedWords = Math.max(3, Math.floor(words.length * 0.5));
      if (!monotonic
          || alignmentCoverage < 0.5
          || confidence < 0.18
          || rawTimings.length < minimumAlignedWords) {
        setForcedAlignmentState({ status: 'error', coverage: quality, confidence });
        toast({
          title: "היישור לא עבר בדיקת איכות",
          description: `איכות ${Math.round(quality * 100)}% • כיסוי ${Math.round(alignmentCoverage * 100)}% — התזמון הקיים נשמר ללא שינוי`,
          variant: "destructive",
        });
        return;
      }

      const alignedTimings = fitTimingsToDuration(
        alignEditedToWhisper(words, rawTimings),
        Number(result?.audioDuration) || 0,
      );
      wordTimingsRef.current = alignedTimings;
      wordTimingsRevisionRef.current += 1;
      setWordTimings(alignedTimings);
      setSyncEnabled(true);
      setForcedAlignmentState({
        status: quality >= 0.72 ? 'aligned' : 'partial',
        coverage: quality,
        confidence,
      });
      try {
        localStorage.setItem('last_word_timings', JSON.stringify(alignedTimings));
      } catch { /* quota/unavailable */ }

      const id = transcriptIdRef.current;
      if (id) {
        await updateTranscript(id, { word_timings: alignedTimings });
      }
      // Pin the timings to the audio itself as well, so this alignment is never
      // lost — it comes back for this recording even without a transcript record.
      try {
        await db.audioTimings.put({
          id: buildAudioFingerprint(
            { size: audioBlob.size, name: audioFileName || 'audio' },
            Number(result?.audioDuration) || 0,
          ),
          word_timings: alignedTimings,
          word_count: words.length,
          transcript_id: id || null,
          audio_name: audioFileName || undefined,
          saved_at: Date.now(),
        });
      } catch { /* Dexie unavailable — cloud/local transcript copy still applies */ }
      toast({
        title: "הטקסט יושר לאודיו",
        description: `${Math.round(quality * 100)}% איכות • ${Math.round(alignmentCoverage * 100)}% עוגנים • ${alignedTimings.length} מילים`,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setForcedAlignmentState({ status: 'error' });
      toast({
        title: "היישור המדויק נכשל",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      if (alignmentAbortRef.current === controller) alignmentAbortRef.current = null;
    }
  }, [audioBlob, audioFileName, buildSyncedTimings, updateTranscript]);

  useEffect(() => () => alignmentAbortRef.current?.abort(), []);

  // Trigger the auto-alignment once per audio+transcript combination. Runs only
  // when there is audio and text but zero word timings, the local server is
  // reachable, and no alignment is already in flight.
  useEffect(() => {
    if (!audioBlob || !text.trim() || wordTimings.length > 0) return;
    if (forcedAlignmentState.status !== 'idle') return;
    const attemptKey = `${transcriptIdRef.current || audioFileName || 'audio'}:${audioBlob.size}`;
    if (autoAlignAttemptedRef.current === attemptKey) return;
    autoAlignAttemptedRef.current = attemptKey;

    let cancelled = false;
    const healthCtrl = new AbortController();
    const healthTimer = setTimeout(() => healthCtrl.abort(), 3000);

    void (async () => {
      // Cheapest path first: a previous alignment pinned to this same audio.
      // Restoring it costs nothing and spares the user a redundant re-align.
      try {
        const matches = await db.audioTimings
          .where('id').startsWith(`a_${audioBlob.size}_`).toArray();
        const best = matches
          .filter(entry => entry.word_timings?.length)
          .sort((a, b) => b.saved_at - a.saved_at)[0];
        if (best && !cancelled) {
          const currentWordCount = text.trim().split(/\s+/).filter(Boolean).length;
          // Only reuse when the text still matches what was aligned; otherwise
          // the pinned timings belong to different words and would mislead.
          const drift = Math.abs(best.word_count - currentWordCount) / Math.max(1, best.word_count);
          if (drift <= 0.15) {
            debugLog.info('TextEditor', `שוחזרו ${best.word_timings.length} תזמוני מילים המוצמדים לאודיו`);
            wordTimingsRevisionRef.current += 1;
            wordTimingsRef.current = best.word_timings;
            setWordTimings(best.word_timings);
            setSyncEnabled(true);
            clearTimeout(healthTimer);
            return;
          }
        }
      } catch { /* Dexie unavailable — fall through to alignment */ }

      if (cancelled) return;
      try {
        const res = await fetch(`${getServerUrl()}/health`, { signal: healthCtrl.signal });
        if (cancelled || !res.ok) return;
        debugLog.info('TextEditor', 'אין תזמוני מילים — מפעיל יישור מדויק אוטומטי');
        toast({ title: '🎯 מסנכרן טקסט לאודיו...', description: 'מחשב תזמוני מילים ברקע — המעקב יופעל בסיום' });
        void handleForcedAlignment();
      } catch { /* local server unavailable — skip silently */ }
      finally { clearTimeout(healthTimer); }
    })();

    return () => { cancelled = true; healthCtrl.abort(); };
  }, [audioBlob, text, wordTimings.length, forcedAlignmentState.status, audioFileName, handleForcedAlignment]);

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
    if (id) {
      saveCloudVersion(editedText, source, engineLabel, `${actionLabel} • החלפת מקור`, { transcriptId: id });
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
    customTitle?: string,
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
    const duplicateTitle = customTitle?.trim() || `${current.title || 'תמלול'} (עותק)`;
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

    if (id) {
      saveCloudVersion(editedText, source, engineLabel, `${actionLabel} • שכפל ושמור`, { transcriptId: id });
    }

    toast({
      title: 'שוכפל ונשמר ✅',
      description: `נוצר עותק חדש מחובר לאודיו (${inserted.id.slice(0, 8)}...)`,
    });
  }, [buildSyncedTimings, saveCloudVersion, transcriptId]);

  const learningProfiles = useMemo(
    () => listProfiles().map((p) => ({ id: p.id, name: p.name })),
    [preferences.active_pronunciation_profile],
  );

  const handleSaveLearningToProfile = useCallback(async (
    payload: { editedText: string; profileId: string; mode: 'quick' | 'advanced'; note?: string }
  ): Promise<boolean> => {
    const profile = getProfile(payload.profileId);
    if (!profile) {
      toast({ title: 'פרופיל לא נמצא', description: 'בחר פרופיל תקין ונסה שוב.', variant: 'destructive' });
      return false;
    }

    const editedText = payload.editedText.trim();
    const originalText = (originalTextRef.current || text).trim();
    if (!editedText || !originalText) {
      toast({ title: 'אין מספיק נתונים', description: 'נדרש טקסט מקורי וערוך כדי ללמוד.', variant: 'destructive' });
      return false;
    }

    const pairs = diffForTraining(originalText, editedText);
    const accepted = bulkTrainProfile(payload.profileId, pairs);
    if (accepted <= 0) {
      toast({
        title: 'לא נמצאו שינויים ללמידה',
        description: 'הטקסט הערוך כמעט זהה לטקסט המקורי.',
        variant: 'destructive',
      });
      return false;
    }

    const navState = (location.state || {}) as Record<string, unknown>;
    const navAudioUrl = typeof navState.audioUrl === 'string' ? navState.audioUrl : undefined;
    const navAudioFilePath = typeof navState.audioFilePath === 'string' ? navState.audioFilePath : undefined;
    const effectiveAudioUrl = audioUrl || navAudioUrl;
    const audioSource = navAudioFilePath
      ? 'supabase'
      : effectiveAudioUrl?.startsWith('blob:')
        ? 'blob'
        : effectiveAudioUrl
          ? 'url'
          : 'unknown';

    addProfileLearningSample(payload.profileId, {
      source: 'text-editor-sync-mirror',
      transcriptId: transcriptIdRef.current || transcriptId || undefined,
      engineLabel: typeof navState.engine === 'string' ? navState.engine : undefined,
      actionLabel: payload.mode === 'advanced' ? 'שמירה מתקדמת מהעורך' : 'שמירה מהירה מהעורך',
      note: payload.note,
      originalText,
      correctedText: editedText,
      correctionPairs: pairs.map((p) => ({
        original: p.original,
        corrected: p.corrected,
        count: Math.max(1, p.count || 1),
      })),
      audio: {
        source: audioSource,
        audioUrl: effectiveAudioUrl,
        audioFilePath: navAudioFilePath,
        fileName: audioFileName || (typeof navState.audioFileName === 'string' ? navState.audioFileName : undefined),
        mimeType: audioBlob?.type,
        sizeBytes: audioBlob?.size,
        durationSec: wordTimings[wordTimings.length - 1]?.end,
      },
    });

    toast({
      title: 'נשמר ללמידת פרופיל ✅',
      description: `${profile.name} · ${accepted} זוגות תיקון נשמרו`,
    });
    return true;
  }, [
    text,
    location.state,
    audioUrl,
    transcriptId,
    audioFileName,
    audioBlob,
    wordTimings,
  ]);

  // Text of the "original" version — used as the baseline reference for the AI editor.
  const originalVersionText = useMemo(
    () => compareVersions.find(v => v.source === 'original')?.text || originalTextRef.current,
    [compareVersions],
  );

  // The AI dual-editor is rendered in two places (the "ai" tab and inside the
  // "compare" tab). Both share identical wiring; this builder keeps them in sync.
  const renderAiEditor = (opts: { label: string }) => (
    <div
      style={{
        fontSize: `${fontSize}px`,
        fontFamily,
        color: textColor,
        lineHeight,
      }}
    >
      <LazyErrorBoundary label={opts.label}>
        <AIEditorDual
          text={text}
          onTextChange={(newText, source, customPrompt) => {
            setText(newText);
            addVersion(newText, source as TextVersion['source'], customPrompt);
            // AI rewrote the text — advance baseline so we only learn from
            // future manual edits, not the AI's stylistic changes.
            if (typeof source === 'string' && source.startsWith('ai-')) {
              learningBaselineRef.current = newText;
            }
          }}
          onSaveVersion={handleSaveVersion}
          onSaveAndReplaceOriginal={handleSaveAndReplaceOriginal}
          onDuplicateAndSave={handleDuplicateAndSave}
          onSyncToPlayer={handleSyncToPlayer}
          versions={compareVersions}
          originalText={originalVersionText}
          initialSourceId={aiPreselectSourceId}
        />
      </LazyErrorBoundary>
    </div>
  );

  return (
    <Suspense fallback={null}>
    <div className="mobile-optimized-page text-editor-page min-h-screen bg-background p-2 md:p-4" dir="rtl">
      <div className="max-w-full mx-auto space-y-3">
        {/* Compact Header */}
        <div className="flex items-center justify-between py-1 border-b border-border/30">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">עריכת טקסט</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">ערוך · שפר · השווה</span>
          </div>
          <div className="flex items-center gap-2">
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
                  mergeCloudUiSettings(next);
                  return next;
                });
              }}
              onOrderChange={(o) => {
                setTabSettings(prev => {
                  const next = { ...prev, order: o };
                  mergeCloudUiSettings(next);
                  return next;
                });
              }}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShortcutsOpen(true)}
              title="קיצורי מקלדת"
            >
              <Keyboard className="h-3.5 w-3.5 text-[#0f1e43]" />
            </Button>
          </div>
        </div>

        {/* Unified action bar — AI quick actions + save, single compact row */}
        {text.trim() && (
          <div className="flex items-center gap-2 flex-wrap py-2 px-3 rounded-xl border bg-muted/20">
            <div className="inline-flex items-center gap-1" dir="rtl">
              <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={() => handleAiQuickAction('fix_and_split')} disabled={!!aiAction}>
                {aiAction === 'fix_and_split' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                פיסוק + פסקאות
              </Button>
              {renderAiModelSelect('fix_and_split', 'פיסוק ופסקאות')}
            </div>
            <div className="inline-flex items-center gap-1" dir="rtl">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleAiQuickAction('fix_errors')} disabled={!!aiAction}>
                {aiAction === 'fix_errors' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SpellCheck className="w-3.5 h-3.5" />}
                תיקון
              </Button>
              {renderAiModelSelect('fix_errors', 'תיקון')}
            </div>
            <div className="inline-flex items-center gap-1" dir="rtl">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleAiQuickAction('split_paragraphs')} disabled={!!aiAction}>
                {aiAction === 'split_paragraphs' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SplitSquareVertical className="w-3.5 h-3.5" />}
                פסקאות
              </Button>
              {renderAiModelSelect('split_paragraphs', 'פסקאות')}
            </div>
            {/* Nikud — split button: main action uses the chosen style, caret picks style */}
            <div className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 rounded-l-none border-l-0"
                onClick={() => handleNikud()}
                disabled={!!aiAction}
                title={`הוספת ניקוד (${nikudStyle === 'haser' ? 'כתיב חסר' : 'כתיב מלא'}) — מנוע DICTA מקומי`}
              >
                {aiAction === 'nikud' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Type className="w-3.5 h-3.5" />}
                ניקוד
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-1.5 rounded-r-none"
                    disabled={!!aiAction}
                    title="בחירת סגנון ניקוד ומנוע"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>מנוע ניקוד</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => handleNikud('male')}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">כתיב מלא {nikudStyle === 'male' && '✓'}</span>
                    <span className="text-[10px] text-muted-foreground">שומר על כל האותיות, מוסיף ניקוד בלבד</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleNikud('haser')}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">כתיב חסר {nikudStyle === 'haser' && '✓'}</span>
                    <span className="text-[10px] text-muted-foreground">מסיר אמות קריאה מיותרות (א/ו/י)</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground py-1">
                    DICTA מקומי · פרטי · ~0.25 שנ׳ למשפט
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
              className="h-7 gap-1 border-sky-500/50 text-xs hover:bg-sky-500/10"
              onClick={() => void openRetranscriptionDialog()}
              disabled={!text.trim()}
              data-testid="retranscribe-audio"
              title={!text.trim() ? "טען או כתוב תמלול תחילה" : audioBlob ? "צור תמלול נוסף מאותה הקלטה באמצעות מנוע אחר" : "בחר מחדש את קובץ ההקלטה וצור תמלול נוסף"}
            >
              <RotateCcw className="h-3.5 w-3.5 text-sky-600" />
              תמלל שוב
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
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-yellow-500/50 hover:bg-yellow-500/10"
              onClick={() => setDrivePickerOpen(true)}
            >
              <Cloud className="w-3.5 h-3.5 text-yellow-600" />
              ייצא ל-Drive
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-emerald-500/50 text-xs hover:bg-emerald-500/10"
              onClick={() => setAttachVideoDialogOpen(true)}
              data-testid="attach-transcript-to-video"
              title="חבר את התמלול והתזמונים לקובץ וידאו"
            >
              <Captions className="h-3.5 w-3.5 text-emerald-600" />
              חבר לווידאו
            </Button>
            <div className="w-px h-5 bg-border mx-1 hidden sm:block" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-yellow-500/50 hover:bg-yellow-500/10"
              onClick={() => sendTextToLoshonKodesh()}
              title="שלח את הטקסט לטאב לשון הקודש (השאר אותי כאן)"
            >
              <ShoppingBasket className="w-3.5 h-3.5 text-yellow-600" />
              שלח ללשון הקודש
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-yellow-500/50 hover:bg-yellow-500/10"
              onClick={() => sendTextToLoshonKodesh({ jump: true })}
              title="שלח את הטקסט וקפוץ לטאב לשון הקודש"
            >
              <ScrollText className="w-3.5 h-3.5 text-yellow-600" />
              פתח לשון הקודש
            </Button>
          </div>
        )}

        {/* Title editor — always visible above tabs */}
        <div className="mb-3 grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" dir="rtl">
          <div className="min-w-0">
            <TranscriptTitleEditor
              transcriptId={transcriptId}
              transcripts={transcripts}
              updateTranscript={updateTranscript}
            />
          </div>
          <div className="min-w-0">
            <TranscriptFolderNameEditor
              transcriptId={transcriptIdRef.current || transcriptId}
              transcripts={transcripts}
              updateTranscript={updateTranscript}
              onChooseFolder={() => setFolderDialogOpen(true)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-12 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive lg:self-stretch"
            title="נקה הכל — טקסט, אודיו ותזמונים"
            onClick={async () => {
              const ok = window.confirm("לנקות את כל התוכן בעורך? פעולה זו תמחק את הטקסט, קובץ האודיו והתזמונים מהזיכרון המקומי. רשומות שכבר נשמרו בענן יישארו.");
              if (!ok) return;
              try {
                setText("");
                setWordTimings([]);
                if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch { /* noop */ } }
                setAudioUrl(null);
                setAudioBlob(null);
                setAudioFileName("");
                transcriptIdRef.current = null;
                setTranscriptId(null);
                try { await clearLastAudioAlias(); } catch { /* noop */ }
                try { localStorage.removeItem('current_transcript_id'); } catch { /* noop */ }
                try { localStorage.removeItem('editor_text'); } catch { /* noop */ }
                try { localStorage.removeItem('editor_word_timings'); } catch { /* noop */ }
                toast({ title: "נוקה בהצלחה", description: "הטקסט והאודיו הוסרו מהעורך." });
              } catch (e) {
                toast({ title: "שגיאה בניקוי", description: (e as Error).message, variant: "destructive" });
              }
            }}
          >
            <Eraser className="w-4 h-4" />
            נקה
          </Button>
        </div>


        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" dir="rtl">
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
                  <TabsList dir="rtl" className="mb-2 flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto p-1.5 text-right sm:flex-wrap">
                    {orderedPrimary.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="min-w-max shrink-0 rounded-lg px-4 py-2 text-right text-xs sm:text-sm">
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
                {orderedSecondary.length > 0 && (
                  <TabsList dir="rtl" className="mb-2 flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-lg bg-muted/40 p-1.5 text-right sm:flex-wrap">
                    {orderedSecondary.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="min-w-max shrink-0 rounded-md px-3 py-1.5 text-right text-xs">
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
              </>
            );
          })()}

          <TabsContent value="player" className="flex flex-col gap-3">
            <LazyErrorBoundary label="עורך טקסט">

            {/* ── Toolbar: layout controls ── */}
            <div className="flex flex-wrap items-center justify-between gap-3" dir="rtl">

              {/* Left: floating toggles */}
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
                <Button
                  variant={forcedAlignmentState.status === 'aligned' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={handleForcedAlignment}
                  disabled={!audioBlob || !text.trim() || forcedAlignmentState.status === 'aligning'}
                  title="יישור כפוי של הטקסט המתוקן לאודיו באמצעות WhisperX"
                >
                  {forcedAlignmentState.status === 'aligning'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <AudioWaveform className="w-3.5 h-3.5" />}
                  {forcedAlignmentState.status === 'aligning' ? 'מיישר...' : 'יישור מדויק'}
                </Button>
                {forcedAlignmentState.coverage != null && wordTimings.length > 0 && (
                  <span
                    className={`text-[10px] rounded border px-2 py-1 ${
                      forcedAlignmentState.status === 'error'
                        ? 'border-destructive/40 text-destructive'
                        : forcedAlignmentState.status === 'aligned'
                          ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/40 text-amber-700 dark:text-amber-300'
                    }`}
                    title="מדד איכות משולב של כיסוי וביטחון אקוסטי"
                  >
                    {Math.round(forcedAlignmentState.coverage * 100)}% איכות
                  </span>
                )}
                <Button
                  variant={isPlayerFloating ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={togglePlayerFloating}
                  title="נגן צף (Ctrl+Shift+F)"
                >
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                  נגן צף
                </Button>
                <Button
                  variant={isEqFloating ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={toggleEqFloating}
                  title="איקולייזר צף (Ctrl+Shift+E)"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  EQ צף
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={() => playerRef.current?.openFeatures()}
                  title="פיצ'רים — הגדרות נגן"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  פיצ'רים
                </Button>
              </div>

              {/* Right: layout presets */}
              <div className="flex shrink-0 items-center gap-1.5 bg-muted/50 rounded-xl p-1 border border-border/40">
                {([
                  { id: 'split',   icon: LayoutPanelLeft,   title: 'נגן ותמלול' },
                  { id: 'full',    icon: Square,            title: 'נגן בלבד' },
                  { id: 'eq-wide', icon: SlidersHorizontal, title: 'נגן ותמלול עם מיקסר רחב' },
                ] as const).map(({ id, icon: Icon, title }) => (
                  <Button
                    key={id}
                    variant={playerLayout === id ? 'default' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-lg"
                    onClick={() => setPlayerLayout(id)}
                    title={title}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </Button>
                ))}
              </div>
            </div>

            {/* ── Alignment status strip ── */}
            <AlignmentStatusBanner
              status={forcedAlignmentState.status}
              hasTimings={wordTimings.length > 0}
              hasAudio={Boolean(audioUrl || audioBlob)}
              hasText={Boolean(text.trim())}
              wordCount={wordTimings.length}
              coverage={forcedAlignmentState.coverage}
              progress={forcedAlignmentState.progress}
              onRetry={handleForcedAlignment}
            />

            {/* ── Player card ── */}
            {isPlayerFloating ? (
              <Suspense fallback={null}>
                <FloatingPlayerPortal onClose={togglePlayerFloating} defaultHeight={440}>
                  <SyncAudioPlayer
                    audioUrl={audioUrl}
                    wordTimings={wordTimings}
                    currentTime={playerTime}
                    onTimeUpdate={handlePlayerTimeUpdate}
                    syncEnabled={syncEnabled}
                    onSyncToggle={setSyncEnabled}
                    compact={!isEqFloating}
                    eqFloating={isEqFloating}
                    eqPortalTarget={eqPortalTarget}
                    studioLayoutJson={studioLayoutJson}
                    onStudioLayoutChange={cloudPreferencesLoaded ? handleStudioLayoutChange : undefined}
                  />
                </FloatingPlayerPortal>
              </Suspense>
            ) : (
              <Suspense fallback={null}>
              <div className="relative rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
                {/* Quick access to floating mode, right on the player itself */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 left-2 z-10 h-7 w-7 rounded-md border border-border/50 bg-background/80 backdrop-blur-sm shadow-sm hover:bg-primary/10"
                  onClick={togglePlayerFloating}
                  title="נגן צף (Ctrl+Shift+F)"
                >
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                </Button>
                <SyncAudioPlayer
                  ref={playerRef}
                  audioUrl={audioUrl}
                  wordTimings={wordTimings}
                  currentTime={playerTime}
                  onTimeUpdate={handlePlayerTimeUpdate}
                  syncEnabled={syncEnabled}
                  onSyncToggle={setSyncEnabled}
                  eqWide={playerLayout === 'eq-wide'}
                  eqFloating={isEqFloating}
                  eqPortalTarget={eqPortalTarget}
                  studioLayoutJson={studioLayoutJson}
                  onStudioLayoutChange={cloudPreferencesLoaded ? handleStudioLayoutChange : undefined}
                  learningWidget={(
                    <>
                      <VerifiedTranscriptLabTransfer
                        hasAudio={Boolean(audioBlob || audioUrl || transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.audio_file_path)}
                        hasText={Boolean(text.trim())}
                        busy={labTransferBusy}
                        onApproveAndOpenLab={() => void approveAndOpenTranscriptionLab()}
                      />
                      {!shouldUseFastEditor && (
                        <AudioLearningQueue
                          audioBlob={audioBlob}
                          audioFileName={audioFileName}
                          candidates={audioLearningCandidates}
                          onRemove={(id) => updateAudioLearningCandidates((current) => current.filter((item) => item.id !== id))}
                          onApproved={(id) => updateAudioLearningCandidates((current) => current.filter((item) => item.id !== id))}
                        />
                      )}
                    </>
                  )}
                />
              </div>
              </Suspense>
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

            {/* ── Search bar ── */}
            {transcriptSearchOpen && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-primary/30 bg-primary/5 shadow-sm" dir="rtl">
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
                <span className="text-xs text-muted-foreground min-w-[60px] text-center tabular-nums">
                  {transcriptMatchCount > 0 ? `${transcriptSearchIdx + 1} / ${transcriptMatchCount}` : transcriptSearchQuery ? 'לא נמצא' : ''}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTranscriptSearchIdx(i => (i - 1 + Math.max(1, transcriptMatchCount)) % Math.max(1, transcriptMatchCount))} title="הקודם (Shift+Enter)"><ChevronUp className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTranscriptSearchIdx(i => (i + 1) % Math.max(1, transcriptMatchCount))} title="הבא (Enter)"><ChevronDown className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setTranscriptSearchOpen(false); setTranscriptSearchQuery(""); setTranscriptSearchIdx(0); }} title="סגור (Escape)"><X className="w-3.5 h-3.5" /></Button>
              </div>
            )}

            {/* ── Sync transcript mirror ── */}
            {playerLayout !== 'full' && shouldUseFastEditor && (
              <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden p-3 space-y-3" dir="rtl">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    מצב מהיר פעיל לתמלול גדול · {textWordCount.toLocaleString('he-IL')} מילים
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      // The exact size of the job the view is about to be handed.
                      syncLog('▶ full sync requested', {
                        words: textWordCount,
                        chars: text.length,
                        wordTimings: wordTimings.length,
                        // Each word becomes a span in both panes.
                        expectedSpans: wordTimings.length * 2,
                      });
                      setForceFullSyncView(true);
                    }}
                  >
                    <Link className="w-3.5 h-3.5" />
                    פתח סנכרון מלא
                  </Button>
                </div>
                <Textarea
                  value={text}
                  onChange={(event) => handlePlayerEditorChange(event.target.value)}
                  dir="rtl"
                  className="min-h-[55vh] resize-y text-base leading-8"
                  style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight }}
                />
              </div>
            )}
            {playerLayout !== 'full' && !shouldUseFastEditor && (
              <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden" style={{ minHeight: '55vh' }}>
                <SyncMirrorLayout
                  wordTimings={wordTimings}
                  currentTime={playerTime}
                  text={text}
                  onTextChange={handlePlayerEditorChange}
                  onWordReplace={handleSyncedWordReplace}
                  onWordClick={handleSyncedWordClick}
                  correctionStorageKey={transcriptId || audioFileName || 'current-transcript'}
                  fontSize={fontSize}
                  fontFamily={fontFamily}
                  syncEnabled={syncEnabled}
                  searchQuery={transcriptSearchOpen ? transcriptSearchQuery : undefined}
                  searchActiveIndex={transcriptSearchIdx}
                  onSearchMatchCount={setTranscriptMatchCount}
                  onSaveReplace={() => handleSaveAndReplaceOriginal(text, 'manual', 'עורך טקסט', 'שמירה מהעורך')}
                  onDuplicateSave={(newName) => handleDuplicateAndSave(text, 'manual', 'עורך טקסט', 'שכפול מהעורך', newName)}
                  onAssignFolder={() => setFolderDialogOpen(true)}
                  onSendToCompare={() => { void openCurrentTranscriptInCompare(); }}
                  exportTitle={transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.title || "תמלול"}
                  learningProfiles={learningProfiles}
                  learningEnabled={true}
                  onSaveLearning={handleSaveLearningToProfile}
                  enableRichEdit
                  onWordCorrected={(original, corrected) => {
                    debugLog.info('TextEditor', `Spell correction: "${original}" → "${corrected}"`);
                  }}
                />
              </div>
            )}

            </LazyErrorBoundary>
          </TabsContent>


          <TabsContent value="loshon" className="flex flex-col gap-3">
            <LazyErrorBoundary label="לשון הקודש">
              <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="w-4 h-4 animate-spin" />טוען לשון הקודש…</div>}>
                <LoshonKodeshRules embeddedText={lkEmbeddedText} defaultTab="test" embedded />
              </Suspense>
            </LazyErrorBoundary>
          </TabsContent>


          <TabsContent value="speakers" className="flex flex-col gap-3">
            <CollapsibleWidget title="זיהוי דוברים" storageKey="te_speakers">
              <LazyErrorBoundary label="זיהוי דוברים">
                <SpeakerDiarization serverUrl="/whisper" initialAudioBlob={audioBlob} initialAudioName={audioFileName} initialText={text} />
              </LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>

          <TabsContent value="templates" className="flex flex-col gap-3">
            <CollapsibleWidget title="תבניות עריכה" storageKey="te_templates">
              <LazyErrorBoundary label="תבניות עריכה"><EditingTemplates
                text={text}
                onApply={(newText, templateName) => {
                  addVersion(newText, 'ai-custom', templateName);
                }}
              /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>

          <TabsContent value="ai" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={aiPolishEnabled}
                  onChange={(e) => setAiPolishEnabled(e.target.checked)}
                />
                <span className="text-sm font-medium">הפעל עריכת AI (AI Polish)</span>
              </label>
              <span className="text-[11px] text-muted-foreground">
                {aiPolishEnabled
                  ? "פעיל — קריאות AI צורכות קרדיטים של Lovable"
                  : "כבוי — חוסך קרדיטים. אפשר להפעיל בכל עת."}
              </span>
            </div>

            {aiPolishEnabled ? (
              renderAiEditor({ label: "עורך AI" })
            ) : (
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                עריכת AI כבויה. סמן את ה-V למעלה כדי להפעיל אותה ולהשתמש בשיפורי הניסוח, פיסוק והפסקאות.
              </div>
            )}

            <LazyErrorBoundary label="גרסאות AI">
              <AIVersionsGrid
                transcriptId={transcriptId}
                audioFilePath={(location.state as any)?.audioFilePath || null}
                onOpenInEditor={(t) => { setText(t); learningBaselineRef.current = t; }}
                onCreateCloudTranscript={ensureCloudTranscript}
                onSendToCompare={sendVersionToCompare}
              />
            </LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="compare" className="flex flex-col gap-3">
            <Tabs value={compareSubTab} onValueChange={setCompareSubTab} dir="rtl">
              <TabsList dir="rtl" className="grid w-full max-w-md grid-cols-2 text-right">
                <TabsTrigger value="versions" className="text-xs">גרסאות (Diff)</TabsTrigger>
                <TabsTrigger value="engines" className="text-xs">מנועי AI (A/B)</TabsTrigger>
              </TabsList>

              <TabsContent value="versions" className="flex flex-col gap-3 mt-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    השוואה בין כל הגרסאות (מקומי + ענן) — וגם אפשרות להריץ עריכת AI ישירות מכאן.
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

                {compareVersions.length >= 1 ? (
                  <LazyErrorBoundary label="השוואה מתקדמת"><AdvancedDiffView 
                    versions={compareVersions}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    textColor={textColor}
                    lineHeight={lineHeight}
                    preselectedLeftId={comparePreselect?.leftId}
                    preselectedRightId={comparePreselect?.rightId}
                    onApplyVersion={(newText, versionId) => {
                      setText(newText);
                      const selectedCloudVersion = versionId ? cloudVersions.find((version) => version.id === versionId) : undefined;
                      if (selectedCloudVersion?.word_timings?.length) {
                        const timings = selectedCloudVersion.word_timings as WordTiming[];
                        wordTimingsRef.current = timings;
                        wordTimingsRevisionRef.current += 1;
                        setWordTimings(timings);
                        toast({ title: "הגרסה והתזמונים נטענו לנגן", description: selectedCloudVersion.engine_label || undefined });
                      }
                    }}
                    onSaveVerifiedVersion={(newText) => {
                      addVersion(newText, 'manual', 'נוסח מאומת מהשוואה');
                    }}
                    onSaveImmediateVersion={(newText, label) => {
                      addVersion(newText, 'manual', label);
                    }}
                    onSendToAiEditor={sendVersionToAiEditor}
                    preferenceStorageKey={transcriptIdRef.current || transcriptId || "current"}
                    transcripts={transcripts}
                    onSelectLibraryTranscript={selectLibraryTranscriptForCompare}
                  /></LazyErrorBoundary>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    לא נמצא תמלול להשוואה. טען או צור תמלול תחילה.
                  </div>
                )}

                {showCompareAi && aiPolishEnabled && (
                  renderAiEditor({ label: "עורך AI בתוך השוואה" })
                )}
              </TabsContent>

              <TabsContent value="engines" className="flex flex-col gap-3 mt-3">
                <CollapsibleWidget title="השוואת מנועי AI" storageKey="te_ab_compare">
                  <LazyErrorBoundary label="השוואת מנועים"><EngineCompare text={text} /></LazyErrorBoundary>
                </CollapsibleWidget>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="pipeline" className="flex flex-col gap-3">
            <CollapsibleWidget title="צינור עריכה" storageKey="te_pipeline">
              <LazyErrorBoundary label="צינור עריכה"><EditPipeline
                text={text}
                onTextChange={(newText, source, customPrompt) => {
                  setText(newText);
                  addVersion(newText, source as TextVersion['source'], customPrompt);
                }}
              /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>

          <TabsContent value="prompts" className="flex flex-col gap-3">
            <CollapsibleWidget title="ספריית פרומפטים" storageKey="te_prompts">
              <LazyErrorBoundary label="ספריית פרומפטים"><PromptLibrary
                text={text}
                onTextChange={(newText, source, customPrompt) => {
                  setText(newText);
                  addVersion(newText, source as TextVersion['source'], customPrompt);
                }}
              /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>

          <TabsContent value="ollama" className="flex flex-col gap-3">
            <CollapsibleWidget title="Ollama" storageKey="te_ollama">
              <LazyErrorBoundary label="Ollama"><OllamaManager /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>

          <TabsContent value="vocab" className="flex flex-col gap-3">
            <LazyErrorBoundary label="בדיקת איות ודקדוק">
              <DictionaryValidator text={text} onApplyFix={(_original, fixed, wordIndex) => {
                const tokens = text.split(/(\s+)/);
                let currentWord = -1;
                const newText = tokens.map((token) => {
                  if (/^\s+$/.test(token) || !token) return token;
                  currentWord += 1;
                  return currentWord === wordIndex ? fixed : token;
                }).join('');
                if (newText !== text) handleEditorChange(newText);
              }} />
            </LazyErrorBoundary>
          </TabsContent>

          <TabsContent value="summary" className="flex flex-col gap-3">
            <CollapsibleWidget title="סיכום אוטומטי" storageKey="te_auto_summary">
              <LazyErrorBoundary label="סיכום"><AutoSummaryCard text={text} /></LazyErrorBoundary>
            </CollapsibleWidget>
            <CollapsibleWidget title="סיכום AI" storageKey="te_ai_summary">
              <LazyErrorBoundary label="סיכום AI"><TranscriptSummary transcript={text} /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>


          <TabsContent value="analytics" className="flex flex-col gap-3">
            <CollapsibleWidget title="אנליטיקס" storageKey="te_analytics">
              <LazyErrorBoundary label="אנליטיקס"><AnalyticsDashboard /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>
          <TabsContent value="history" className="flex flex-col gap-3">
            <CollapsibleWidget title="היסטוריית עריכה" storageKey="te_history">
              <LazyErrorBoundary label="היסטוריית עריכה"><TextEditHistory 
                versions={compareVersions}
                onSelectVersion={handleVersionSelect}
                selectedVersionId={selectedVersionId}
                cloudVersions={cloudVersions}
                cloudLoading={cloudVersionsLoading}
                onRestoreVersion={handleRestoreVersion}
                onCompareVersion={sendVersionToCompare}
              /></LazyErrorBoundary>
            </CollapsibleWidget>
          </TabsContent>
        </Tabs>

        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <TranscriptFolderDialog
          open={folderDialogOpen}
          onOpenChange={setFolderDialogOpen}
          currentFolderId={transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.folder_id || null}
          onAssign={assignCurrentTranscriptToFolder}
        />
        <RetranscribeDialog
          open={retranscribeDialogOpen}
          onOpenChange={setRetranscribeDialogOpen}
          restoreRequest={retranscribeRestoreRequest}
          transcriptId={transcriptIdRef.current || transcriptId}
          currentEngine={transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.engine}
          audioBlob={audioBlob}
          audioFileName={audioFileName || transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.title || undefined}
          audioFilePath={transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.audio_file_path || null}
          onComplete={handleRetranscriptionComplete}
        />
        <AttachTranscriptToVideoDialog
          open={attachVideoDialogOpen}
          onOpenChange={setAttachVideoDialogOpen}
          wordTimings={wordTimings}
          transcriptTitle={transcripts.find((item) => item.id === (transcriptIdRef.current || transcriptId))?.title}
        />
        <DriveFolderPicker
          open={drivePickerOpen}
          onOpenChange={setDrivePickerOpen}
          title="בחר תיקייה ב-Drive לשמירת התמליל"
          onPick={async (folder) => {
            try {
              toast({ title: '☁️ מעלה ל-Google Drive...', description: `יעד: ${folder.name}` });
              const name = `transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
              const res = await uploadToDrive({
                name,
                content: text,
                mimeType: 'text/plain',
                parents: folder.id ? [folder.id] : undefined,
              });
              toast({ title: '✅ הועלה ל-Drive', description: `${res.name} → ${folder.name}` });
            } catch (e: any) {
              toast({ title: 'שגיאה בהעלאה ל-Drive', description: e.message, variant: 'destructive' });
            }
          }}
        />
      </div>
    </div>
    </Suspense>
  );
};

export default TextEditor;
