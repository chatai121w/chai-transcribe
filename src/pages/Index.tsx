import "@/styles/mobile-pages.css";
import { useState, useEffect, useRef, lazy, Suspense, useCallback, type ChangeEvent } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { TranscriptionEngine } from "@/components/TranscriptionEngine";
import { FileUploader } from "@/components/FileUploader";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocalTranscription } from "@/hooks/useLocalTranscription";
import { useLocalServer, type TranscriptionStats, type CudaOptions } from "@/hooks/useLocalServer";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { debugLog } from "@/lib/debugLogger";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useTranscriptionAnalytics } from "@/hooks/useTranscriptionAnalytics";
import { Settings, FileEdit, ChevronDown, X, Zap, Globe, Chrome, Mic, Waves, Server, Cpu, Film, Pause, Play, Square, Copy, Check, Keyboard, Activity, Users, Scissors, BrainCircuit } from "lucide-react";
import { openQuickCut } from "@/lib/quickCutBus";
import { usePerfMonitor } from "@/hooks/usePerfMonitor";
import { PerfMonitorPanel } from "@/components/PerfMonitorPanel";
import { db } from "@/lib/localDb";
import { useTranscriptionJobs } from "@/hooks/useTranscriptionJobs";
import { useLocalTranscriptionQueue } from "@/hooks/useLocalTranscriptionQueue";
import { useAuth } from "@/contexts/AuthContext";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { isVideoFile, extractAudioFromVideo, VIDEO_NEEDS_EXTRACTION, MAX_VIDEO_SIZE_MB, MAX_AUDIO_SIZE_MB } from "@/lib/videoUtils";
import { compressAudio, needsCompression, formatFileSize, CLOUD_API_LIMIT } from "@/lib/audioCompression";
import { extractAudioSegment, probeAudioDurationSec } from "@/lib/audioSegment";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { addNotification } from "@/hooks/useNotifications";
import { getApiKey, getEncryptedKey } from "@/lib/keyCrypto";
import { recordKeyUsage } from "@/lib/apiKeyUsage";
import { isLoshonKodeshEnabled, setLoshonKodeshEnabled } from "@/lib/loshonKodesh";
import { isPersonalPronunciationEnabled, setPersonalPronunciationEnabled } from "@/lib/personalPronunciationModel";
import { applyProfileCorrections, buildProfileHotwords, getProfileInitialPrompt, isProfileLoshonKodesh } from "@/lib/pronunciationProfiles";
import { setCurrentAudioFilename, recordProfileUsage } from "@/lib/profileSuggestion";
import { PronunciationProfileSelector } from "@/components/PronunciationProfileSelector";
import { PronunciationStack } from "@/components/PronunciationStack";
import { applyLearnedCorrections } from "@/utils/correctionLearning";
import { addRecentFile } from "@/components/RecentFiles";

// Lazy-loaded heavy components
const LiveTranscriber = lazy(() => import("@/components/LiveTranscriber").then(m => ({ default: m.LiveTranscriber })));
import type { LiveTranscriptResult } from "@/components/LiveTranscriber";
const TranscriptEditor = lazy(() => import("@/components/TranscriptEditor").then(m => ({ default: m.TranscriptEditor })));
const CloudTranscriptHistory = lazy(() => import("@/components/CloudTranscriptHistory").then(m => ({ default: m.CloudTranscriptHistory })));
const TranscriptSummary = lazy(() => import("@/components/TranscriptSummary").then(m => ({ default: m.TranscriptSummary })));
const ShareTranscript = lazy(() => import("@/components/ShareTranscript").then(m => ({ default: m.ShareTranscript })));
const TextStyleControl = lazy(() => import("@/components/TextStyleControl").then(m => ({ default: m.TextStyleControl })));
const LocalModelManager = lazy(() => import("@/components/LocalModelManager").then(m => ({ default: m.LocalModelManager })));
const BackgroundJobsPanel = lazy(() => import("@/components/BackgroundJobsPanel").then(m => ({ default: m.BackgroundJobsPanel })));
const SpeakerDiarization = lazy(() => import("@/components/SpeakerDiarization").then(m => ({ default: m.SpeakerDiarization })));
const YouTubeTranscriber = lazy(() => import("@/components/YouTubeTranscriber").then(m => ({ default: m.YouTubeTranscriber })));
import { WaveformPlayer, type WaveformPlayerHandle } from "@/components/WaveformPlayer";

type Engine = 'openai' | 'groq' | 'google' | 'local' | 'local-server' | 'assemblyai' | 'deepgram';
type SourceLanguage = 'auto' | 'he' | 'yi' | 'en';

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const folderFromUrl = searchParams.get('folder') || undefined;
  const { isAuthenticated } = useAuth();

  // Cloud-synced preferences
  const { preferences, updatePreference, isLoaded: prefsLoaded } = useCloudPreferences();
  const engine = preferences.engine as Engine;
  const sourceLanguage = preferences.source_language as SourceLanguage;
  const fontSize = preferences.font_size;
  const fontFamily = preferences.font_family;
  const textColor = preferences.text_color;
  const lineHeight = preferences.line_height;
  const setEngine = (v: Engine) => updatePreference('engine', v);
  const setSourceLanguage = (v: SourceLanguage) => updatePreference('source_language', v);
  const setFontSize = (v: number) => updatePreference('font_size', v);
  const setFontFamily = (v: string) => updatePreference('font_family', v);
  const setTextColor = (v: string) => updatePreference('text_color', v);
  const setLineHeight = (v: number) => updatePreference('line_height', v);

  const loshonKodeshOn = preferences.loshon_kodesh_enabled;
  const setLoshonKodeshOn = (v: boolean) => {
    setLoshonKodeshEnabled(v);
    updatePreference('loshon_kodesh_enabled', v);
  };
  const [personalModelOn, setPersonalModelOn] = useState<boolean>(() => isPersonalPronunciationEnabled());

  useEffect(() => {
    setPersonalModelOn(preferences.personal_pronunciation_enabled);
    setPersonalPronunciationEnabled(preferences.personal_pronunciation_enabled);
    debugLog.info('Index', 'Personal pronunciation toggle synced from preferences', {
      enabled: preferences.personal_pronunciation_enabled,
      prefsLoaded,
      isAuthenticated,
    });
  }, [preferences.personal_pronunciation_enabled, prefsLoaded, isAuthenticated]);

  // Sync loshon kodesh in-memory state whenever cloud preferences load
  useEffect(() => {
    setLoshonKodeshEnabled(preferences.loshon_kodesh_enabled);
  }, [preferences.loshon_kodesh_enabled, prefsLoaded]);

  const [transcript, setTranscript] = useState('');
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Audio & word timing state for sync player
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [wordTimings, setWordTimings] = useState<Array<{word: string, start: number, end: number, probability?: number}>>([]);
  const [recoveredPartialInfo, setRecoveredPartialInfo] = useState<{progress: number, wordCount: number, lastSegEnd?: number} | null>(null);
  const [lastStats, setLastStats] = useState<TranscriptionStats | null>(null);
  const [copied, setCopied] = useState(false);
  const diarize = preferences.diarize_enabled;
  const setDiarize = (v: boolean) => updatePreference('diarize_enabled', v);
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [rangeStartSec, setRangeStartSec] = useState("0");
  const [rangeEndSec, setRangeEndSec] = useState("");

  // Save reference to last uploaded file for resume functionality
  const lastFileRef = useRef<File | null>(null);
  const lastAudioUrlRef = useRef<string | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);

  // Waveform player ref for word click-to-seek
  const waveformRef = useRef<WaveformPlayerHandle | null>(null);

  // Pending file waiting for local server to come up
  const pendingServerFileRef = useRef<{ file: File; audioUrl: string } | null>(null);

  // Audio element ref for queue item playback
  const queueAudioRef = useRef<HTMLAudioElement | null>(null);
  const [queuePlayingId, setQueuePlayingId] = useState<string | null>(null);

  const { transcribe: localTranscribe, isLoading: isLocalLoading, progress: localProgress } = useLocalTranscription();
  const { transcribeStream: serverTranscribeStream, transcribeStreamParallel: serverTranscribeParallel, isLoading: isServerLoading, progress: serverProgress, phase: serverPhase, audioDurationSec: serverAudioDur, audioProcessedSec: serverAudioProcessed, isConnected: serverConnected, modelReady: serverModelReady, recoverPartial, clearPartial, cancelStream: cancelServerStream, checkConnection, startPolling, stopPolling } = useLocalServer();
  const bgTask = useBackgroundTask();
  const { transcripts, isLoading: isCloudLoading, saveTranscript, updateTranscript, deleteTranscript, deleteAll, isCloud, getAudioUrl } = useCloudTranscripts();
  const { jobs, submitJob, submitBatchJobs, retryJob, deleteJob } = useTranscriptionJobs();
  const localQueue = useLocalTranscriptionQueue();
  const serverConnectedRef = useRef(serverConnected);
  const { addRecord: addAnalyticsRecord } = useTranscriptionAnalytics();
  const perfMonitor = usePerfMonitor();
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [groqPoolText, setGroqPoolText] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('groq_api_keys_pool');
      if (!raw) return '';
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.join('\n') : '';
    } catch { return ''; }
  });

  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem('groq_api_keys_pool');
        if (!raw) { setGroqPoolText(''); return; }
        const arr = JSON.parse(raw);
        setGroqPoolText(Array.isArray(arr) ? arr.join('\n') : '');
      } catch { setGroqPoolText(''); }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('api-key-usage-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('api-key-usage-updated', refresh);
    };
  }, []);

  useEffect(() => {
    serverConnectedRef.current = serverConnected;
  }, [serverConnected]);

  // Helper: set transcript from engine result (also stores original for diff)
  const setTranscriptFromEngine = useCallback((text: string) => {
    setTranscript(text);
    setOriginalTranscript(text);
  }, []);

  // Helper to track the start time of each transcription for analytics
  const transcriptionStartRef = useRef<number>(0);

  useEffect(() => {
    // Keep Index's serverConnected in sync (used by LiveTranscriber and resume flow).
    // startPolling already runs an immediate checkConnection() internally,
    // so we don't call it again here (was causing a duplicate /health call).
    if (engine === 'local-server') {
      startPolling(10000);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [engine, startPolling, stopPolling]);


  // Cleanup audio Object URL on unmount
  useEffect(() => {
    return () => {
      if (lastAudioUrlRef.current) {
        URL.revokeObjectURL(lastAudioUrlRef.current);
      }
    };
  }, []);

  // Recover partial transcription on mount (runs once)
  useEffect(() => {
    const partial = recoverPartial();
    if (partial && partial.text) {
      setTranscriptFromEngine(partial.text);
      setWordTimings(partial.wordTimings || []);
      setRecoveredPartialInfo({ progress: partial.progress, wordCount: partial.wordTimings?.length || 0, lastSegEnd: partial.lastSegEnd });
      toast({
        title: "🔄 שוחזר תמלול חלקי",
        description: `נמצא תמלול שהופסק (${partial.progress}%) — ${partial.wordTimings?.length || 0} מילים. אפשר להמשיך מאותו מקום`,
      });
      debugLog.info('Recovery', `Restored partial transcript: ${partial.progress}%, ${partial.text.length} chars`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accept incoming file from other pages (e.g., VideoToMp3 converter)
  // We track the file we already consumed so re-renders can't trigger duplicate runs.
  const consumedIncomingFileRef = useRef<File | null>(null);
  const [incomingFileBanner, setIncomingFileBanner] = useState<{ name: string; size: number } | null>(null);
  useEffect(() => {
    const state = location.state as { file?: File; fileName?: string; filePath?: string } | null;
    debugLog.info('IncomingFile', `🔍 effect run | hasState=${!!state} | hasFile=${!!state?.file} | prefsLoaded=${prefsLoaded} | pathname=${location.pathname}`);

    const incomingFile = state?.file;
    if (!incomingFile) {
      if (state) {
        debugLog.warn('IncomingFile', `⚠️ state present but no File. keys=${Object.keys(state).join(',')} | file type=${typeof state.file}`);
      }
      return;
    }

    // Validate it's a real File object (it might have been serialized through history.state)
    const isRealFile = (incomingFile as unknown) instanceof File || (incomingFile as unknown) instanceof Blob;
    if (!isRealFile) {
      debugLog.error('IncomingFile', `❌ incomingFile is NOT a File/Blob! type=${typeof incomingFile} | constructor=${(incomingFile as any)?.constructor?.name}`);
      toast({ title: "❌ שגיאה בקבלת הקובץ", description: "הקובץ אבד במעבר בין דפים. נסה שוב.", variant: "destructive" });
      consumedIncomingFileRef.current = incomingFile as File;
      return;
    }

    if (!prefsLoaded) {
      debugLog.info('IncomingFile', `⏳ Waiting for prefs to load before processing ${incomingFile.name}`);
      return;
    }
    if (consumedIncomingFileRef.current === incomingFile) {
      debugLog.info('IncomingFile', `↩️ already consumed ${incomingFile.name}, skipping`);
      return;
    }
    consumedIncomingFileRef.current = incomingFile;

    debugLog.info('IncomingFile', `✅ Consuming incoming file: ${incomingFile.name} (${incomingFile.size}b, type=${incomingFile.type}) | engine=${engine}`);
    setIncomingFileBanner({ name: incomingFile.name, size: incomingFile.size });

    toast({ title: "📎 קובץ התקבל", description: `${incomingFile.name} — מתחיל תמלול עם ${engine}...` });
    debugLog.info('Transcription', `קובץ נכנס מדף אחר: ${incomingFile.name} (${formatFileSize(incomingFile.size)})`);

    // Defer to next tick so React state from prior page settles first.
    setTimeout(() => {
      debugLog.info('IncomingFile', `🚀 Calling handleFileSelect for ${incomingFile.name}`);
      try {
        handleFileSelect(incomingFile);
      } catch (err) {
        debugLog.error('IncomingFile', `💥 handleFileSelect threw: ${err instanceof Error ? err.message : String(err)}`);
        toast({ title: "❌ שגיאה", description: err instanceof Error ? err.message : "כשל בהפעלת תמלול", variant: "destructive" });
      }
      // Clear banner after a delay so the loading card takes over visually
      setTimeout(() => setIncomingFileBanner(null), 4000);
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, prefsLoaded]);

  // Clipboard audio paste — Ctrl+V with audio/video blob
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.items) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('audio/') || item.type.startsWith('video/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            const ext = item.type.split('/')[1] || 'wav';
            const file = new File([blob], `pasted-audio.${ext}`, { type: item.type });
            toast({ title: "🎤 אודיו הודבק מהלוח", description: file.name });
            handleFileSelect(file);
          }
          return;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-process persistent queue when server comes up
  useEffect(() => {
    if (!serverConnected || engine !== 'local-server') return;

    // Also handle legacy in-memory pending file
    if (pendingServerFileRef.current) {
      const { file, audioUrl } = pendingServerFileRef.current;
      pendingServerFileRef.current = null;
      toast({ title: "\u2705 \u05d4\u05e9\u05e8\u05ea \u05e2\u05dc\u05d4!", description: `\u05de\u05ea\u05d7\u05d9\u05dc \u05ea\u05de\u05dc\u05d5\u05dc: ${file.name}` });
      currentFileRef.current = file;
      bgTask.run(`local-server \u2014 ${file.name}`, async () => {
        await transcribeWithLocalServer(file, audioUrl);
      }).catch(() => {});
      return;
    }

    // Process next item from persistent queue
    const processNextQueueItem = async () => {
      // Stop processing loop immediately once server is no longer reachable.
      if (!serverConnectedRef.current || engine !== 'local-server') return;
      if (localQueue.processingRef.current) return;
      const next = localQueue.getNextPending();
      if (!next) return;

      localQueue.processingRef.current = true;
      await localQueue.updateItemStatus(next.id, 'processing');
      toast({ title: "\u2705 \u05d4\u05e9\u05e8\u05ea \u05e2\u05dc\u05d4!", description: `\u05de\u05ea\u05d7\u05d9\u05dc \u05ea\u05de\u05dc\u05d5\u05dc \u05de\u05d4\u05ea\u05d5\u05e8: ${next.fileName}` });

      const file = await localQueue.getFile(next.id);
      if (!file) {
        await localQueue.updateItemStatus(next.id, 'failed', 'הקובץ לא נמצא');
        localQueue.processingRef.current = false;
        // Auto-advance to next item
        setTimeout(processNextQueueItem, 500);
        return;
      }

      currentFileRef.current = file;
      setCurrentAudioFilename(file.name);
      try {
        // Timeout protection: 10 minutes max per file
        const timeoutMs = 10 * 60 * 1000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('QUEUE_TIMEOUT')), timeoutMs)
        );
        const outcome = await Promise.race([
          bgTask.run(`local-server \u2014 ${next.fileName}`, async () => {
            return await transcribeWithLocalServer(file, next.audioUrl, undefined, { fromQueue: true });
          }),
          timeoutPromise,
        ]);
        if (outcome === 'queued') {
          await localQueue.updateItemStatus(next.id, 'pending');
          return;
        } else {
          await localQueue.updateItemStatus(next.id, 'completed');
        }
      } catch (err) {
        const msg = err instanceof Error && err.message === 'QUEUE_TIMEOUT'
          ? 'תמלול חרג מזמן מקסימלי (10 דקות)'
          : 'שגיאה בתמלול';
        await localQueue.updateItemStatus(next.id, 'failed', msg);
      } finally {
        localQueue.processingRef.current = false;
        // Auto-advance only when still connected and in CUDA server mode.
        if (serverConnectedRef.current && engine === 'local-server') {
          setTimeout(processNextQueueItem, 1200);
        }
      }
    };

    processNextQueueItem();
  }, [serverConnected, engine, localQueue.queue]);

  // Keep reference to current file for saving with transcript
  const currentFileRef = useRef<File | null>(null);
  const lastSavedTranscriptIdRef = useRef<string | null>(null);

  // Save to cloud history (respects cloud save mode for CUDA engine)
  const saveToHistory = async (text: string, engineUsed: string, skipCloud?: boolean, timings?: Array<{word: string, start: number, end: number, probability?: number}>, audioFile?: File, folder?: string) => {
    // Apply learned corrections to improve transcription
    const personalPronunciationOn = isPersonalPronunciationEnabled();
    const correctionResult = personalPronunciationOn
      ? applyLearnedCorrections(text, { engine: engineUsed })
      : { text, appliedCount: 0 };
    const profileResult = personalPronunciationOn
      ? applyProfileCorrections(correctionResult.text)
      : { text: correctionResult.text, appliedCount: 0 };
    const finalText = profileResult.text;
    if (correctionResult.appliedCount > 0 || profileResult.appliedCount > 0) {
      debugLog.info('Index', `Applied ${correctionResult.appliedCount} learned + ${profileResult.appliedCount} profile corrections`);
    }
    // Record that the active profile was used for this audio file (powers
    // future filename-based profile suggestions).
    const usedFilename = audioFile?.name || currentFileRef.current?.name;
    if (usedFilename) recordProfileUsage(usedFilename);

    if (skipCloud) {
      // Save only to localStorage, skip cloud upload entirely
      let history: any[] = [];
      try { history = JSON.parse(localStorage.getItem('transcript_history') || '[]'); } catch { /* corrupted */ }
      const entry = { text: finalText, timestamp: Date.now(), engine: engineUsed, tags: [], notes: '', word_timings: timings || null, folder: folder || '' };
      const updated = [entry, ...history].slice(0, 50);
      localStorage.setItem('transcript_history', JSON.stringify(updated));
      lastSavedTranscriptIdRef.current = null;
      return;
    }
    const saved = await saveTranscript(finalText, engineUsed, undefined, audioFile || currentFileRef.current || undefined, timings || null, folder);
    lastSavedTranscriptIdRef.current = saved?.id || null;
    addRecentFile({
      fileName: currentFileRef.current?.name || audioFile?.name || 'הקלטה',
      engine: engineUsed,
      wordCount: finalText.split(/\s+/).filter(Boolean).length,
      charCount: finalText.length,
      preview: finalText.slice(0, 120),
    });
    addNotification({ type: 'success', title: 'תמלול הושלם', description: `מנוע: ${engineUsed} — ${finalText.split(/\s+/).length} מילים` });
  };

  // Save text-only to cloud (deferred mode — upload text without audio file)
  const saveTextOnlyToCloud = async (text: string, engineUsed: string, timings?: Array<{word: string, start: number, end: number, probability?: number}>) => {
    const saved = await saveTranscript(text, engineUsed, undefined, undefined, timings || null);
    lastSavedTranscriptIdRef.current = saved?.id || null;
  };

  // Helper: invoke edge function with real upload progress via XHR and multipart form
  const xhrInvoke = (functionName: string, formData: FormData, onProgress: (p: number) => void) => {
    return new Promise<{ data?: any; error?: any }>((resolve) => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`);
      xhr.setRequestHeader('x-client-info', 'xhr-upload');

      // Upload progress = 0-50%
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 50);
          onProgress(percent);
        }
      };

      // Once upload is done, animate processing progress 50-90%
      let processingInterval: ReturnType<typeof setInterval> | null = null;
      xhr.upload.onloadend = () => {
        onProgress(50);
        let current = 50;
        processingInterval = setInterval(() => {
          current = Math.min(current + 2, 90);
          onProgress(current);
          if (current >= 90 && processingInterval) {
            clearInterval(processingInterval);
          }
        }, 500);
      };

      xhr.onload = () => {
        if (processingInterval) clearInterval(processingInterval);
        onProgress(100);
        try {
          const json = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ data: json });
          } else if (xhr.status === 429) {
            const retryAfter = parseInt(xhr.getResponseHeader('Retry-After') || '60', 10);
            resolve({ error: { message: `RATE_LIMIT`, retryAfter } });
          } else {
            resolve({ error: json || { message: `HTTP ${xhr.status}` } });
          }
        } catch (e) {
          resolve({ error: { message: 'Invalid JSON response' } });
        }
      };

      xhr.onerror = () => {
        if (processingInterval) clearInterval(processingInterval);
        resolve({ error: { message: 'Network error' } });
      };

      xhr.send(formData);
    });
  };

  type CloudProvider = 'openai' | 'groq' | 'google' | 'assemblyai' | 'deepgram';

  const providerSingleKeyStorage: Record<CloudProvider, string> = {
    openai: 'openai_api_key',
    groq: 'groq_api_key',
    google: 'google_api_key',
    assemblyai: 'assemblyai_api_key',
    deepgram: 'deepgram_api_key',
  };

  const providerPoolStorage: Record<CloudProvider, string> = {
    openai: 'openai_api_keys_pool',
    groq: 'groq_api_keys_pool',
    google: 'google_api_keys_pool',
    assemblyai: 'assemblyai_api_keys_pool',
    deepgram: 'deepgram_api_keys_pool',
  };

  const providerActiveIndexStorage: Record<CloudProvider, string> = {
    openai: 'openai_api_key_active_index',
    groq: 'groq_api_key_active_index',
    google: 'google_api_key_active_index',
    assemblyai: 'assemblyai_api_key_active_index',
    deepgram: 'deepgram_api_key_active_index',
  };

  const providerLabel: Record<CloudProvider, string> = {
    openai: 'OpenAI',
    groq: 'Groq',
    google: 'Google',
    assemblyai: 'AssemblyAI',
    deepgram: 'Deepgram',
  };

  const getProviderApiKeyPool = async (provider: CloudProvider): Promise<string[]> => {
    // Use async decrypt so keys are available even if CloudKeySync hasn't
    // populated the in-memory cache yet (race on first transcription after refresh).
    const single = (await getEncryptedKey(providerSingleKeyStorage[provider]))?.trim();
    const raw = localStorage.getItem(providerPoolStorage[provider]);
    let pooled: string[] = [];

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          pooled = parsed.map((k) => k.trim()).filter(Boolean);
        }
      } catch {
        // Ignore malformed pool storage and fall back to single key.
      }
    }

    const merged = [...pooled];
    if (single && !merged.includes(single)) {
      merged.unshift(single);
    }
    return Array.from(new Set(merged));
  };

  const shouldRotateProviderKey = (err: any): boolean => {
    const msg = String(err?.message || err?.error || '').toLowerCase();
    return (
      msg.includes('rate_limit') ||
      msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('429') ||
      msg.includes('invalid api key') ||
      msg.includes('api key is invalid') ||
      msg.includes('expired') ||
      msg.includes('insufficient_quota') ||
      msg.includes('unauthorized') ||
      msg.includes('authentication')
    );
  };

  const getProviderStartIndex = (provider: CloudProvider, poolLength: number): number => {
    if (poolLength <= 0) return 0;
    const raw = parseInt(localStorage.getItem(providerActiveIndexStorage[provider]) || '0', 10);
    if (!Number.isFinite(raw)) return 0;
    return ((raw % poolLength) + poolLength) % poolLength;
  };

  const setProviderActiveKey = (provider: CloudProvider, pool: string[], index: number) => {
    localStorage.setItem(providerActiveIndexStorage[provider], String(index));
    localStorage.setItem(providerSingleKeyStorage[provider], pool[index]);
  };

  const parseRangeValue = (raw: string): number => {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  const handleFileSelect = async (file: File) => {
    debugLog.info('handleFileSelect', `🎬 ENTER: ${file.name} | size=${file.size} | type=${file.type} | engine=${engine} | bgTask.isRunning=${bgTask.isRunning}`);
    currentFileRef.current = file;
    lastFileRef.current = file;
    setCurrentAudioFilename(file.name);
    pendingServerFileRef.current = null; // Clear pending queue when new file is selected
    setRecoveredPartialInfo(null); // Clear recovery banner on new transcription
    
    const isVideo = isVideoFile(file);
    const maxMB = isVideo ? MAX_VIDEO_SIZE_MB : MAX_AUDIO_SIZE_MB;
    
    // Check file size (500MB hard limit)
    if (file.size > maxMB * 1024 * 1024) {
      debugLog.error('Upload', 'קובץ גדול מדי', { size: file.size, maxMB });
      toast({
        title: "שגיאה",
        description: `הקובץ גדול מדי. גודל מקסימלי: ${maxMB}MB`,
        variant: "destructive",
      });
      return;
    }

    // Preserve media URL for playback
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    let url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Persist audio blob to IndexedDB (Dexie) for text-editor recovery
    try {
      await db.audioBlobs.put({
        id: 'last_audio',
        blob: file,
        type: file.type,
        name: file.name,
        saved_at: Date.now(),
      });
    } catch { /* IndexedDB not available — ok */ }

    // Show audio/video duration after file select
    try {
      const mediaEl = isVideo ? document.createElement('video') : new Audio();
      mediaEl.preload = 'metadata';
      mediaEl.src = url;
      mediaEl.onloadedmetadata = () => {
        const dur = mediaEl.duration;
        if (dur && isFinite(dur)) {
          const mins = Math.floor(dur / 60);
          const secs = Math.round(dur % 60);
          toast({ title: `${isVideo ? '🎬' : '🎵'} ${file.name}`, description: `משך: ${mins}:${secs.toString().padStart(2, '0')} | ${formatFileSize(file.size)}` });
        }
      };
    } catch { /* ignore duration detection errors */ }

    // Step 1: If video file and engine requires audio-only → extract audio
    let fileToTranscribe = file;
    if (isVideo && (VIDEO_NEEDS_EXTRACTION.has(engine) || rangeEnabled)) {
      debugLog.info('Video', `מחלץ אודיו מוידאו: ${file.name} (${formatFileSize(file.size)})`);
      toast({
        title: "🎬 מחלץ אודיו מוידאו...",
        description: rangeEnabled
          ? "חיתוך טווח דורש מסלול אודיו מדויק — מחלץ אודיו אוטומטית"
          : `${engine === 'google' ? 'Google Speech-to-Text' : engine} דורש קובץ אודיו — מחלץ אוטומטית`,
      });
      try {
        fileToTranscribe = await extractAudioFromVideo(file, (p) => {
          setUploadProgress(Math.round(p * 0.2)); // 0-20% for extraction
        });
        debugLog.info('Video', `חילוץ אודיו הושלם: ${fileToTranscribe.name} (${formatFileSize(fileToTranscribe.size)})`);
      } catch (err) {
        debugLog.error('Video', 'שגיאה בחילוץ אודיו', err);
        toast({
          title: "שגיאה בחילוץ אודיו",
          description: err instanceof Error ? err.message : "לא ניתן לחלץ אודיו מהווידאו",
          variant: "destructive",
        });
        return;
      }
    } else if (isVideo) {
      debugLog.info('Video', `שולח וידאו ישירות ל-${engine} (תומך וידאו)`);
      toast({ title: "🎬 וידאו זוהה", description: `${engine} מעבד וידאו ישירות — מחלץ אודיו בצד השרת` });
    }

    // Step 2: Optional user-selected range trimming
    if (rangeEnabled) {
      try {
        const durationSec = await probeAudioDurationSec(fileToTranscribe);
        const startSec = Math.min(parseRangeValue(rangeStartSec), Math.max(0, durationSec - 0.2));
        const requestedEndSec = rangeEndSec.trim() === '' ? durationSec : parseRangeValue(rangeEndSec);
        const endSec = Math.min(Math.max(requestedEndSec, startSec + 0.2), durationSec);

        if (endSec - startSec < 0.2) {
          throw new Error('טווח החיתוך קצר מדי. יש לבחור לפחות 0.2 שניות.');
        }

        if (startSec > 0 || endSec < durationSec - 0.05) {
          setUploadProgress(10);
          toast({
            title: "✂️ חיתוך אודיו",
            description: `מעבד טווח ${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s`,
          });
          fileToTranscribe = await extractAudioSegment(fileToTranscribe, startSec, endSec);
          debugLog.info('Trim', `Audio trimmed to range ${startSec.toFixed(2)}-${endSec.toFixed(2)} (${fileToTranscribe.name})`);
        }
      } catch (err) {
        debugLog.error('Trim', 'שגיאה בחיתוך טווח', err);
        toast({
          title: "שגיאה בחיתוך אודיו",
          description: err instanceof Error ? err.message : "לא ניתן לחתוך את האודיו",
          variant: "destructive",
        });
        return;
      }
    }

    // Step 3: Auto-compress if file too large for cloud APIs (>25MB)
    // Skip compression for local-server (no limit) and local (ONNX)
    const isCloudEngine = !['local-server', 'local'].includes(engine);
    if (isCloudEngine && needsCompression(fileToTranscribe)) {
      const originalSize = formatFileSize(fileToTranscribe.size);
      debugLog.info('Compression', `כיווץ אודיו: ${fileToTranscribe.name} (${originalSize}) — מנוע ענן דורש <25MB`);
      toast({
        title: "🗜️ מכווץ אודיו...",
        description: `${originalSize} → מכווץ ל-16kHz מונו לשליחה ל-${engine}`,
      });
      try {
        fileToTranscribe = await compressAudio(fileToTranscribe, (p) => {
          setUploadProgress(20 + Math.round(p * 0.3)); // 20-50% for compression
        });
        const compressedSize = formatFileSize(fileToTranscribe.size);
        debugLog.info('Compression', `כיווץ הושלם: ${originalSize} → ${compressedSize}`);
        toast({
          title: "✅ כיווץ הושלם",
          description: `${originalSize} → ${compressedSize}`,
        });

        // If still too large after compression, warn but try anyway
        if (fileToTranscribe.size > CLOUD_API_LIMIT) {
          debugLog.warn('Compression', `הקובץ עדיין גדול לאחר כיווץ: ${compressedSize}`);
          toast({
            title: "⚠️ קובץ עדיין גדול",
            description: `${compressedSize} — ייתכן שה-API ידו חה. מומלץ להשתמש בשרת CUDA מקומי`,
            variant: "destructive",
          });
        }
      } catch (err) {
        debugLog.error('Compression', 'שגיאה בכיווץ', err);
        toast({
          title: "שגיאה בכיווץ",
          description: err instanceof Error ? err.message : "לא ניתן לכווץ את הקובץ",
          variant: "destructive",
        });
        return;
      }
    }

    // Keep media URL and file references aligned with the exact file being processed.
    if (fileToTranscribe !== file) {
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(fileToTranscribe);
      setAudioUrl(url);
      currentFileRef.current = fileToTranscribe;
      lastFileRef.current = fileToTranscribe;
      try {
        await db.audioBlobs.put({
          id: 'last_audio',
          blob: fileToTranscribe,
          type: fileToTranscribe.type,
          name: fileToTranscribe.name,
          saved_at: Date.now(),
        });
      } catch {
        // Ignore IndexedDB write errors.
      }
    }

    debugLog.info('Transcription', `התחלת תמלול: ${fileToTranscribe.name} (${formatFileSize(fileToTranscribe.size)}) עם ${engine}`);

    // Track start time for analytics
    transcriptionStartRef.current = Date.now();
    perfMonitor.startTimer();

    // Run in background — doesn't block tab, sends notification on complete
    debugLog.info('handleFileSelect', `🟢 Dispatching bgTask for engine=${engine} | file=${fileToTranscribe.name}`);
    bgTask.run(`${engine} — ${file.name}`, async () => {
      debugLog.info('bgTask', `▶️ Inside bgTask runner for ${engine}`);
      if (engine === 'openai') {
        await transcribeWithOpenAI(fileToTranscribe, url);
      } else if (engine === 'groq') {
        await transcribeWithGroq(fileToTranscribe, url);
      } else if (engine === 'google') {
        await transcribeWithGoogle(fileToTranscribe, url);
      } else if (engine === 'assemblyai') {
        await transcribeWithAssemblyAI(fileToTranscribe, url);
      } else if (engine === 'deepgram') {
        await transcribeWithDeepgram(fileToTranscribe, url);
      } else if (engine === 'local-server') {
        await transcribeWithLocalServer(fileToTranscribe, url);
      } else {
        await transcribeLocally(fileToTranscribe, url);
      }
      debugLog.info('bgTask', `✅ bgTask runner finished for ${engine}`);
    }).catch((err) => {
      debugLog.error('bgTask', `❌ bgTask rejected: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const transcribeWithOpenAI = async (file: File, fileAudioUrl?: string) => {
    setIsUploading(true);
    
    try {
      debugLog.info('OpenAI', `Starting transcription: ${file.name} (${file.size} bytes)`);
      
      const keyPool = await getProviderApiKeyPool('openai');
      if (keyPool.length === 0) {
        debugLog.error('OpenAI', 'No API key found in localStorage');
        toast({
          title: "נדרש מפתח API",
          description: "יש להגדיר מפתח OpenAI בהגדרות",
          variant: "destructive",
        });
        navigate("/login");
        setIsUploading(false);
        return;
      }

      setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: "מעבד את הקובץ שלך" });

      const safeStartIndex = getProviderStartIndex('openai', keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('fileName', file.name);
        form.append('apiKey', keyPool[idx]);
        form.append('language', sourceLanguage);
        form.append('targetLanguage', 'he');

        debugLog.info('OpenAI', `Uploading via XHR with key #${idx + 1}/${keyPool.length}`);
        const result = await xhrInvoke('transcribe-openai', form, (p) => setUploadProgress(p));
        debugLog.info('OpenAI', 'Response received', { hasData: !!result.data, hasError: !!result.error, keyIndex: idx + 1 });

        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({
            title: `מעביר למפתח ${providerLabel.openai} הבא`,
            description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.`,
          });
          continue;
        }
        break;
      }

      if (!data?.text) {
        throw (lastError || new Error('No transcription received'));
      }

      setProviderActiveKey('openai', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({
          title: `בוצעה החלפת מפתח ${providerLabel.openai}`,
          description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.`,
        });
      }

      if (data?.text) {
        const timings = data.wordTimings || [];
        setTranscriptFromEngine(data.text);
        setWordTimings(timings);
        await saveToHistory(data.text, 'OpenAI Whisper', undefined, timings);
        addAnalyticsRecord({
          engine: 'OpenAI Whisper', status: 'success',
          fileName: file.name, fileSize: file.size,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          charCount: data.text.length, wordCount: data.text.split(/\s+/).length,
        });
        perfMonitor.record({
          engine: 'OpenAI Whisper', status: 'success',
          fileName: file.name, fileSize: file.size,
          audioDuration: data.duration || 0,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          text: data.text, wordTimings: timings,
        });
        toast({
          title: "הצלחה!",
          description: "התמלול הושלם בהצלחה - עובר לעריכת טקסט",
        });
        // Persist word timings for text-editor recovery
        if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
        // Auto-navigate to text editor
        setTimeout(() => {
          navigate('/text-editor', { state: { text: data.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
        }, 1000);
      } else {
        throw new Error('No transcription received');
      }
    } catch (error) {
      debugLog.error('OpenAI', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'OpenAI Whisper', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בתמלול הקובץ",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const transcribeWithGroq = async (file: File, fileAudioUrl?: string) => {
    debugLog.info('Groq', `Starting transcription: ${file.name} (${file.size} bytes)`);
    setIsUploading(true);

    try {
      const keyPool = await getProviderApiKeyPool('groq');

      if (keyPool.length === 0) {
        debugLog.error('Groq', 'No API key found in localStorage');
        toast({
          title: "נדרש מפתח API",
          description: "יש להגדיר מפתח Groq בהגדרות (לחץ על כפתור ההגדרות בראש העמוד)",
          variant: "destructive",
        });
        navigate("/login");
        setIsUploading(false);
        return;
      }

      setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: "מעבד עם Groq - מנוע מהיר במיוחד" });

      const safeStartIndex = getProviderStartIndex('groq', keyPool.length);

      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const groqKey = keyPool[idx];

        const form = new FormData();
        form.append('file', file, file.name);
        form.append('fileName', file.name);
        form.append('apiKey', groqKey);
        form.append('language', sourceLanguage);
        form.append('targetLanguage', 'he');

        debugLog.info('Groq', `Uploading via XHR with key #${idx + 1}/${keyPool.length}`);
        const result = await xhrInvoke('transcribe-groq', form, (p) => setUploadProgress(p));
        debugLog.info('Groq', 'Response received', { hasData: !!result.data, hasError: !!result.error, keyIndex: idx + 1 });

        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received from Groq' };
        const canRotate = shouldRotateProviderKey(lastError);
        const hasNext = offset < keyPool.length - 1;

        if (canRotate && hasNext) {
          toast({
            title: 'מעביר למפתח Groq הבא',
            description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.`,
          });
          continue;
        }

        break;
      }

      if (!data?.text) {
        const errMsg = lastError?.message || lastError?.error || 'שגיאה לא ידועה';
        if (errMsg === 'RATE_LIMIT' || lastError?.retryAfter) {
          const wait = lastError?.retryAfter || 60;
          throw new Error(`כל מפתחות Groq נוצלו/הוגבלו. נסה שוב בעוד ${wait} שניות.`);
        }
        throw new Error(errMsg);
      }

      setProviderActiveKey('groq', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({
          title: 'בוצעה החלפת מפתח Groq',
          description: `התמלול הושלם עם מפתח #${usedIndex + 1}.`,
        });
      }

      if (data?.text) {
        debugLog.info('Groq', `Transcription received, length: ${data.text.length}`);
        const timings = data.wordTimings || [];
        const usedKey = keyPool[usedIndex];
        const usedSeconds = Number(data.duration) || (timings.length ? (timings[timings.length - 1]?.end || 0) : 0);
        const usedWords = (data.text || '').split(/\s+/).filter(Boolean).length;
        recordKeyUsage('groq', usedKey, usedSeconds, usedWords);
        setTranscriptFromEngine(data.text);
        setWordTimings(timings);
        await saveToHistory(data.text, 'Groq Whisper', undefined, timings);
        addAnalyticsRecord({
          engine: 'Groq Whisper', status: 'success',
          fileName: file.name, fileSize: file.size,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          charCount: data.text.length, wordCount: data.text.split(/\s+/).length,
        });
        perfMonitor.record({
          engine: 'Groq Whisper', status: 'success',
          fileName: file.name, fileSize: file.size,
          audioDuration: data.duration || 0,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          text: data.text, wordTimings: timings,
        });
        toast({ 
          title: "הצלחה!", 
          description: "התמלול עם Groq הושלם בהצלחה - עובר לעריכת טקסט" 
        });
        if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
        // Auto-navigate to text editor
        setTimeout(() => {
          navigate('/text-editor', { state: { text: data.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
        }, 1000);
      } else {
        debugLog.error('Groq', 'No text in response data', data);
        throw new Error('No transcription received from Groq');
      }
    } catch (error) {
      debugLog.error('Groq', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'Groq Whisper', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה בתמלול Groq",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const transcribeWithGoogle = async (file: File, fileAudioUrl?: string) => {
    debugLog.info('Google', `Starting transcription: ${file.name}`);
    setIsUploading(true);

    try {
      const keyPool = await getProviderApiKeyPool('google');

      if (keyPool.length === 0) {
        debugLog.error('Google', 'No API key found in localStorage');
        toast({
          title: "נדרש מפתח API",
          description: "יש להגדיר מפתח Google בהגדרות",
          variant: "destructive",
        });
        navigate("/login");
        setIsUploading(false);
        return;
      }

      debugLog.info('Google', 'Converting file to base64...');
      toast({
        title: "מעלה קובץ...",
        description: "מעבד עם Google Speech-to-Text",
      });

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = reader.result?.toString().split(',')[1];
          if (base64) {
            resolve(base64);
          } else reject(new Error('Failed to convert file'));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64Audio = await base64Promise;

      const safeStartIndex = getProviderStartIndex('google', keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        debugLog.info('Google', `Calling edge function with key #${idx + 1}/${keyPool.length}`);
        const result = await supabase.functions.invoke('transcribe-google', {
          body: {
            audio: base64Audio,
            fileName: file.name,
            apiKey: keyPool[idx],
            language: sourceLanguage,
            targetLanguage: 'he'
          }
        });

        debugLog.info('Google', 'Response received', { hasData: !!result.data, hasError: !!result.error, keyIndex: idx + 1 });

        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received from Google' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({
            title: `מעביר למפתח ${providerLabel.google} הבא`,
            description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.`,
          });
          continue;
        }
        break;
      }

      if (!data?.text) {
        debugLog.error('Google', 'Edge function error', lastError);
        throw (lastError || new Error('No transcription received from Google'));
      }

      setProviderActiveKey('google', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({
          title: `בוצעה החלפת מפתח ${providerLabel.google}`,
          description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.`,
        });
      }

      if (data?.text) {
        debugLog.info('Google', `Success, text length: ${data.text.length}`);
        const timings = data.wordTimings || [];
        setTranscriptFromEngine(data.text);
        setWordTimings(timings);
        await saveToHistory(data.text, 'Google Speech-to-Text', undefined, timings);
        addAnalyticsRecord({
          engine: 'Google Speech-to-Text', status: 'success',
          fileName: file.name, fileSize: file.size,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          charCount: data.text.length, wordCount: data.text.split(/\s+/).length,
        });
        perfMonitor.record({
          engine: 'Google Speech-to-Text', status: 'success',
          fileName: file.name, fileSize: file.size,
          audioDuration: 0,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          text: data.text, wordTimings: timings,
        });
        toast({
          title: "הצלחה!",
          description: "התמלול עם Google הושלם בהצלחה - עובר לעריכת טקסט"
        });
        if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
        // Auto-navigate to text editor
        setTimeout(() => {
          navigate('/text-editor', { state: { text: data.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
        }, 1000);
      } else {
        throw new Error('No transcription received from Google');
      }
    } catch (error) {
      debugLog.error('Google', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'Google Speech-to-Text', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה בתמלול Google",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const transcribeLocally = async (file: File, fileAudioUrl?: string) => {
    try {
      const result = await localTranscribe(file);
      setTranscriptFromEngine(result.text);
      setWordTimings(result.wordTimings);
      await saveToHistory(result.text, 'Local (Browser)', undefined, result.wordTimings);
      addAnalyticsRecord({
        engine: 'Local (Browser)', status: 'success',
        fileName: file.name, fileSize: file.size,
        processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
        charCount: result.text.length, wordCount: result.text.split(/\s+/).length,
      });
      perfMonitor.record({
        engine: 'Local (Browser)', status: 'success',
        fileName: file.name, fileSize: file.size,
        audioDuration: 0,
        processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
        text: result.text, wordTimings: result.wordTimings,
      });
      toast({
        title: "הצלחה!",
        description: "התמלול המקומי הושלם בהצלחה - עובר לעריכת טקסט",
      });
      if (result.wordTimings?.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(result.wordTimings));
      // Auto-navigate to text editor
      setTimeout(() => {
        navigate('/text-editor', { state: { text: result.text, audioUrl: fileAudioUrl, wordTimings: result.wordTimings, transcriptId: lastSavedTranscriptIdRef.current } });
      }, 1000);
    } catch (error) {
      debugLog.error('Local', 'Browser transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'Local (Browser)', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בתמלול מקומי",
        variant: "destructive",
      });
      throw error;
    }
  };

  const transcribeWithLocalServer = async (
    file: File,
    fileAudioUrl?: string,
    resumeFrom?: { startFrom: number; existingText: string; existingWords: Array<{word: string, start: number, end: number}> },
    opts?: { fromQueue?: boolean },
  ): Promise<'done' | 'queued'> => {
    // Fresh connection check before transcription (serverConnected state may be stale)
    const isUp = await checkConnection();
    if (!isUp) {
      if (opts?.fromQueue) {
        // Already in queue — do not duplicate items or create loops.
        startPolling(2000);
        return 'queued';
      }
      // Add to persistent queue (survives refresh)
      const queueId = await localQueue.addToQueue(file, fileAudioUrl || '');
      startPolling(2000);
      toast({
        title: "📋 נוסף לתור התמלולים",
        description: `${file.name} ממתין — התמלול יתחיל אוטומטית כשהשרת יעלה`,
      });
      debugLog.info('Queue', `File queued for CUDA transcription: ${file.name} (${queueId})`);
      return 'queued';
    }

    // Track this transcription in the visible status panel (queue)
    let activeQueueId: string | null = null;
    if (!opts?.fromQueue) {
      try {
        activeQueueId = await localQueue.addToQueue(file, fileAudioUrl || '');
        await localQueue.updateItemStatus(activeQueueId, 'processing');
      } catch (qErr) {
        debugLog.warn('Queue', 'Failed to register file in status panel', qErr);
        activeQueueId = null;
      }
    }

    try {
      const preferredModel = localStorage.getItem('preferred_local_model') || undefined;
      const lang = sourceLanguage === 'auto' ? 'auto' : sourceLanguage;
      setTranscript('');
      setWordTimings([]);
      setLastStats(null);
      toast({ title: "מתמלל עם GPU...", description: "מעבד את הקובץ בשרת המקומי עם CUDA — תראה תוצאות בזמן אמת" });

      // Build CUDA options from cloud preferences
      const profileHotwordsStr = buildProfileHotwords();
      const profileInitPrompt = getProfileInitialPrompt();
      const profileForcesLk = isProfileLoshonKodesh();
      const mergedCudaHotwords =
        [preferences.cuda_hotwords || '', profileHotwordsStr].filter(Boolean).join(', ') || undefined;
      const cudaOptions: CudaOptions = {
        preset: preferences.cuda_preset || 'balanced',
        fastMode: preferences.cuda_fast_mode,
        computeType: preferences.cuda_compute_type || undefined,
        beamSize: preferences.cuda_beam_size || undefined,
        noConditionOnPrevious: preferences.cuda_no_condition_prev,
        vadAggressive: preferences.cuda_vad_aggressive,
        hotwords: mergedCudaHotwords,
        paragraphThreshold: preferences.cuda_paragraph_threshold || undefined,
        loshonKodesh: isLoshonKodeshEnabled() || profileForcesLk,
        initialPrompt: profileInitPrompt || undefined,
      };

      // Use parallel mode (stage audio + preload model simultaneously) when model isn't ready
      const useParallel = !serverModelReady;
      const transcribeFn = useParallel ? serverTranscribeParallel : serverTranscribeStream;
      if (useParallel) {
        debugLog.info('CUDA', 'Using parallel mode: staging audio + preloading model simultaneously');
        toast({ title: "⚡ מצב מקבילי", description: "מעלה אודיו + טוען מודל במקביל" });
      }

      let result = await transcribeFn(file, preferredModel, lang, (partial) => {
        // Update live as segments arrive
        setTranscript(partial.text);
        setWordTimings(partial.wordTimings);
        debugLog.info('CUDA Stream', `${partial.progress}% — ${partial.wordTimings.length} מילים`);
      }, resumeFrom, cudaOptions);

      const isHebrewDominant = (txt: string) => {
        const letters = txt.replace(/\s+/g, '');
        if (!letters.length) return false;
        const heCount = (txt.match(/[\u0590-\u05FF]/g) || []).length;
        return heCount / letters.length >= 0.35;
      };
      const hasHeavyRepetition = (txt: string) => /\b(\S+)(?:\s+\1){6,}\b/.test(txt);

      const suspiciousAutoOutput =
        !resumeFrom &&
        lang === 'auto' &&
        (
          (result.language && result.language !== 'he' && !isHebrewDominant(result.text)) ||
          hasHeavyRepetition(result.text)
        );

      if (suspiciousAutoOutput) {
        debugLog.warn('CUDA Server', `Suspicious auto-language output (detected=${result.language}) — retrying with forced he`);
        toast({
          title: 'זוהה תמלול חשוד',
          description: 'מבצע ניסיון נוסף עם עברית כפויה ואיכות גבוהה',
        });

        const retryOptions: CudaOptions = {
          ...cudaOptions,
          preset: 'accurate',
          beamSize: Math.max(2, cudaOptions.beamSize || 2),
          noConditionOnPrevious: false,
          vadAggressive: false,
        };

        const retryResult = await transcribeFn(file, preferredModel, 'he', undefined, undefined, retryOptions);
        if (retryResult.text && retryResult.text.length > result.text.length * 0.5) {
          result = retryResult;
        }
      }

      const timings = result.wordTimings || [];
      setTranscriptFromEngine(result.text);
      setWordTimings(timings);
      if (result.stats) setLastStats(result.stats);

      // Cloud save mode: 'immediate' (default), 'text-only' (no audio upload), 'skip' (local only)
      const cloudSaveMode = preferences.cuda_cloud_save || 'immediate';
      const engineLabel = `Local CUDA (${result.model || 'server'})`;
      if (cloudSaveMode === 'skip') {
        await saveToHistory(result.text, engineLabel, true, timings);  // localStorage only
      } else if (cloudSaveMode === 'text-only') {
        await saveTextOnlyToCloud(result.text, engineLabel, timings);  // text to cloud, no audio upload
      } else {
        await saveToHistory(result.text, engineLabel, undefined, timings);  // full: text + audio to cloud
      }

      clearPartial();
      addAnalyticsRecord({
        engine: engineLabel, status: 'success',
        fileName: file.name, fileSize: file.size,
        audioDuration: result.duration || result.stats?.duration,
        processingTime: result.processing_time || result.stats?.processing_time,
        rtf: result.stats?.rtf,
        segmentCount: timings.length,
        charCount: result.text.length,
        wordCount: result.text.split(/\s+/).length,
        model: result.model,
        computeType: result.stats?.compute_type,
        beamSize: result.stats?.beam_size,
        fastMode: result.stats?.fast_mode,
      });
      perfMonitor.record({
        engine: engineLabel, status: 'success',
        fileName: file.name, fileSize: file.size,
        audioDuration: result.duration || result.stats?.duration || 0,
        processingTime: result.processing_time || result.stats?.processing_time || 0,
        text: result.text, wordTimings: timings,
        computeType: result.stats?.compute_type,
        beamSize: result.stats?.beam_size,
        model: result.model,
      });
      const statsInfo = result.stats ? ` | RTF=${result.stats.rtf} | ${result.stats.compute_type}` : '';
      toast({
        title: "הצלחה!",
        description: `תמלול GPU הושלם ב-${result.processing_time || '?'}s${statsInfo} — עובר לעריכת טקסט`,
      });
      if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
      setTimeout(() => {
        navigate('/text-editor', { state: { text: result.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
      }, 1000);
      if (activeQueueId) {
        await localQueue.updateItemStatus(activeQueueId, 'completed').catch(() => {});
      }
      return 'done';
    } catch (error) {
      if (error instanceof Error && error.message === 'CANCELLED') {
        toast({ title: "תמלול הופסק", description: "התמלול בוטל על ידי המשתמש" });
        if (activeQueueId) {
          await localQueue.updateItemStatus(activeQueueId, 'failed', 'בוטל ידנית').catch(() => {});
        }
        return 'done';
      }
      debugLog.error('CUDA Server', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'Local CUDA', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      // Even on failure, keep what was partially transcribed (already saved to localStorage by hook)
      toast({
        title: "שגיאה בתמלול שרת מקומי",
        description: `${error instanceof Error ? error.message : 'שגיאה לא ידועה'} — מה שהצליח נשמר`,
        variant: "destructive",
      });
      if (activeQueueId) {
        await localQueue.updateItemStatus(
          activeQueueId,
          'failed',
          error instanceof Error ? error.message : 'שגיאה'
        ).catch(() => {});
      }
      throw error;
    }
  };

  const transcribeWithAssemblyAI = async (file: File, fileAudioUrl?: string) => {
    setIsUploading(true);
    
    try {
      const keyPool = await getProviderApiKeyPool('assemblyai');

      if (keyPool.length === 0) {
        toast({
          title: "נדרש מפתח API",
          description: "יש להגדיר מפתח AssemblyAI בהגדרות",
          variant: "destructive",
        });
        navigate("/login");
        setIsUploading(false);
        return;
      }

      setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: "מעבד את הקובץ שלך" });

      const safeStartIndex = getProviderStartIndex('assemblyai', keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('apiKey', keyPool[idx]);
        form.append('language', sourceLanguage);
        if (diarize) form.append('diarize', 'true');

        const result = await xhrInvoke('transcribe-assemblyai', form, (p) => setUploadProgress(p));
        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({
            title: `מעביר למפתח ${providerLabel.assemblyai} הבא`,
            description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.`,
          });
          continue;
        }
        break;
      }

      if (!data?.text) throw (lastError || new Error('No transcription received'));

      setProviderActiveKey('assemblyai', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({
          title: `בוצעה החלפת מפתח ${providerLabel.assemblyai}`,
          description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.`,
        });
      }

      if (data?.text) {
        const timings = data.wordTimings || [];
        setTranscriptFromEngine(data.text);
        setWordTimings(timings);
        await saveToHistory(data.text, 'AssemblyAI', undefined, timings);
        addAnalyticsRecord({
          engine: 'AssemblyAI', status: 'success',
          fileName: file.name, fileSize: file.size,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          charCount: data.text.length, wordCount: data.text.split(/\s+/).length,
        });
        perfMonitor.record({
          engine: 'AssemblyAI', status: 'success',
          fileName: file.name, fileSize: file.size,
          audioDuration: 0,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          text: data.text, wordTimings: timings,
        });
        toast({
          title: "הצלחה!",
          description: "התמלול הושלם בהצלחה - עובר לעריכת טקסט",
        });
        if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
        setTimeout(() => {
          navigate('/text-editor', { state: { text: data.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
        }, 1000);
      } else {
        throw new Error('No transcription received');
      }
    } catch (error) {
      debugLog.error('AssemblyAI', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'AssemblyAI', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בתמלול הקובץ",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const transcribeWithDeepgram = async (file: File, fileAudioUrl?: string) => {
    setIsUploading(true);
    
    try {
      const keyPool = await getProviderApiKeyPool('deepgram');

      if (keyPool.length === 0) {
        toast({
          title: "נדרש מפתח API",
          description: "יש להגדיר מפתח Deepgram בהגדרות",
          variant: "destructive",
        });
        navigate("/login");
        setIsUploading(false);
        return;
      }

      setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: "מעבד את הקובץ שלך" });

      const safeStartIndex = getProviderStartIndex('deepgram', keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('apiKey', keyPool[idx]);
        form.append('language', sourceLanguage);
        if (diarize) form.append('diarize', 'true');

        const result = await xhrInvoke('transcribe-deepgram', form, (p) => setUploadProgress(p));
        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({
            title: `מעביר למפתח ${providerLabel.deepgram} הבא`,
            description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.`,
          });
          continue;
        }
        break;
      }

      if (!data?.text) throw (lastError || new Error('No transcription received'));

      setProviderActiveKey('deepgram', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({
          title: `בוצעה החלפת מפתח ${providerLabel.deepgram}`,
          description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.`,
        });
      }

      if (data?.text) {
        const timings = data.wordTimings || [];
        setTranscriptFromEngine(data.text);
        setWordTimings(timings);
        await saveToHistory(data.text, 'Deepgram', undefined, timings);
        addAnalyticsRecord({
          engine: 'Deepgram', status: 'success',
          fileName: file.name, fileSize: file.size,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          charCount: data.text.length, wordCount: data.text.split(/\s+/).length,
        });
        perfMonitor.record({
          engine: 'Deepgram', status: 'success',
          fileName: file.name, fileSize: file.size,
          audioDuration: 0,
          processingTime: (Date.now() - transcriptionStartRef.current) / 1000,
          text: data.text, wordTimings: timings,
        });
        toast({
          title: "הצלחה!",
          description: "התמלול הושלם בהצלחה - עובר לעריכת טקסט",
        });
        if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
        setTimeout(() => {
          navigate('/text-editor', { state: { text: data.text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
        }, 1000);
      } else {
        throw new Error('No transcription received');
      }
    } catch (error) {
      debugLog.error('Deepgram', 'Transcription failed', error instanceof Error ? error.message : error);
      addAnalyticsRecord({
        engine: 'Deepgram', status: 'failed',
        fileName: file.name, fileSize: file.size,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בתמלול הקובץ",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const isLoading = isUploading || isLocalLoading || isServerLoading || bgTask.isRunning;
  const progress = engine === 'local' ? localProgress : engine === 'local-server' ? serverProgress : (isUploading ? uploadProgress : undefined);

  // Keyboard shortcuts
  const [searchOpen, setSearchOpen] = useState(false);
  const shortcutHandler = useCallback((action: 'show-shortcuts' | 'copy-transcript' | 'cancel-transcription' | 'search-transcript') => {
    if (action === 'copy-transcript' && transcript) {
      navigator.clipboard.writeText(transcript).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast({ title: "הועתק", description: "התמלול הועתק ללוח" });
      });
    } else if (action === 'cancel-transcription' && isLoading) {
      handleCancelTranscription();
    } else if (action === 'search-transcript') {
      setSearchOpen(prev => !prev);
    }
  }, [transcript, isLoading]);
  const { showHelp, setShowHelp } = useKeyboardShortcuts(shortcutHandler as (action: string) => void);

  // Elapsed time counter — starts fresh each time a transcription begins
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval>>();
  // Track when actual transcription progress started (for ETA calc, excludes model loading)
  const transcribeStartTimeRef = useRef<number>(0);
  const [transcribeElapsed, setTranscribeElapsed] = useState(0);
  useEffect(() => {
    if (isLoading) {
      setElapsedSeconds(0);
      setTranscribeElapsed(0);
      transcribeStartTimeRef.current = 0;
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedSeconds(s => s + 1);
        if (transcribeStartTimeRef.current > 0) {
          setTranscribeElapsed(Math.floor((Date.now() - transcribeStartTimeRef.current) / 1000));
        }
      }, 1000);
    } else {
      clearInterval(elapsedIntervalRef.current);
    }
    return () => clearInterval(elapsedIntervalRef.current);
  }, [isLoading]);

  // Mark when first real progress arrives (phase changes to transcribing)
  useEffect(() => {
    if (engine === 'local-server' && serverPhase === 'transcribing' && transcribeStartTimeRef.current === 0) {
      transcribeStartTimeRef.current = Date.now();
    }
  }, [engine, serverPhase]);

  const handleCancelTranscription = () => {
    if (engine === 'local-server') {
      cancelServerStream();
      // Partial is already saved to localStorage by useLocalServer on each segment
      const partial = recoverPartial();
      if (partial && partial.text) {
        setRecoveredPartialInfo({ progress: partial.progress, wordCount: partial.wordTimings?.length || 0, lastSegEnd: partial.lastSegEnd });
        toast({ title: "⏸ תמלול הופסק", description: `נשמר תמלול חלקי (${partial.progress}%) — ${partial.wordTimings?.length || 0} מילים. אפשר להמשיך מאותו מקום` });
      } else {
        toast({ title: "תמלול הופסק" });
      }
    }
    bgTask.reset();
    setIsUploading(false);
  };

  // Cancel the currently processing queue item
  const handleCancelQueueItem = () => {
    cancelServerStream();
    bgTask.reset();
    setIsUploading(false);
    const processing = localQueue.processingItem;
    if (processing) {
      localQueue.updateItemStatus(processing.id, 'failed', 'בוטל ידנית');
      localQueue.processingRef.current = false;
    }
    toast({ title: "⏹ תמלול מהתור בוטל" });
  };

  // Play audio of a queue item
  const handleQueuePlay = async (itemId: string) => {
    // Stop if already playing this item
    if (queuePlayingId === itemId && queueAudioRef.current) {
      queueAudioRef.current.pause();
      queueAudioRef.current.currentTime = 0;
      setQueuePlayingId(null);
      return;
    }
    const url = await localQueue.getPlaybackUrl(itemId);
    if (!url) {
      toast({ title: "הקובץ לא נמצא", variant: "destructive" });
      return;
    }
    if (queueAudioRef.current) {
      queueAudioRef.current.pause();
      URL.revokeObjectURL(queueAudioRef.current.src);
    }
    const audio = new Audio(url);
    audio.onended = () => { setQueuePlayingId(null); URL.revokeObjectURL(url); };
    queueAudioRef.current = audio;
    setQueuePlayingId(itemId);
    audio.play().catch(() => setQueuePlayingId(null));
  };

  const handleResumeTranscription = async (fileOverride?: File) => {
    const partial = recoverPartial();
    if (!partial || !partial.lastSegEnd) {
      toast({ title: "אין מה להמשיך", description: "לא נמצא תמלול חלקי עם נקודת המשך", variant: "destructive" });
      return;
    }
    const file = fileOverride || currentFileRef.current || lastFileRef.current;
    if (!file) {
      toast({ title: "נדרש קובץ", description: "בחר שוב את קובץ המקור כדי להמשיך מאותה נקודה", variant: "destructive" });
      return;
    }
    currentFileRef.current = file;
    lastFileRef.current = file;
    setRecoveredPartialInfo(null);
    try {
      await transcribeWithLocalServer(file, undefined, {
        startFrom: partial.lastSegEnd,
        existingText: partial.text,
        existingWords: partial.wordTimings,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CANCELLED') return;
      console.error('[Index] resume failed:', error);
    }
  };

  const handleResumeFilePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!picked) return;
    toast({ title: 'נבחר קובץ להמשך', description: picked.name });
    await handleResumeTranscription(picked);
  };

  // Batch transcription wrapper - transcribes a single file and returns text
  const batchTranscribeFile = async (file: File, onProgress: (p: number) => void): Promise<string> => {
    if (file.size > MAX_AUDIO_SIZE_MB * 1024 * 1024) throw new Error(`הקובץ גדול מדי (מקסימום ${MAX_AUDIO_SIZE_MB}MB)`);

    const engineMap: Record<string, string> = {
      openai: 'transcribe-openai',
      groq: 'transcribe-groq',
      assemblyai: 'transcribe-assemblyai',
      deepgram: 'transcribe-deepgram',
    };

    if (engine === 'local') {
      const result = await localTranscribe(file);
      return typeof result === 'string' ? result : result.text;
    }

    if (engine === 'google') {
      const keyPool = await getProviderApiKeyPool('google');
      if (keyPool.length === 0) throw new Error('נדרש מפתח API - הגדר בהגדרות');

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = reader.result?.toString().split(',')[1];
          b64 ? resolve(b64) : reject(new Error('Failed to convert'));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const safeStartIndex = getProviderStartIndex('google', keyPool.length);

      let lastErr: any = null;
      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const { data, error } = await supabase.functions.invoke('transcribe-google', {
          body: { audio: base64, fileName: file.name, apiKey: keyPool[idx], language: sourceLanguage, targetLanguage: 'he' }
        });
        if (!error && data?.text) {
          setProviderActiveKey('google', keyPool, idx);
          return data.text;
        }

        lastErr = error || { message: 'שגיאה בתמלול' };
        if (!(shouldRotateProviderKey(lastErr) && offset < keyPool.length - 1)) {
          break;
        }
      }

      const err = new Error(lastErr?.message || lastErr?.error || 'שגיאה בתמלול');
      (err as any).retryAfter = lastErr?.retryAfter;
      throw err;
    }

    if (engine === 'openai' || engine === 'groq' || engine === 'assemblyai' || engine === 'deepgram') {
      const provider = engine as CloudProvider;
      const keyPool = await getProviderApiKeyPool(provider);
      if (keyPool.length === 0) throw new Error('נדרש מפתח API - הגדר בהגדרות');

      const safeStartIndex = getProviderStartIndex(provider, keyPool.length);
      let lastErr: any = null;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('fileName', file.name);
        form.append('apiKey', keyPool[idx]);
        form.append('language', sourceLanguage);
        if (provider === 'openai' || provider === 'groq') form.append('targetLanguage', 'he');

        const { data, error } = await xhrInvoke(engineMap[provider], form, onProgress);
        if (!error && data?.text) {
          setProviderActiveKey(provider, keyPool, idx);
          return data.text;
        }

        lastErr = error || { message: 'שגיאה בתמלול' };
        if (!(shouldRotateProviderKey(lastErr) && offset < keyPool.length - 1)) {
          break;
        }
      }

      const err = new Error(lastErr?.message || lastErr?.error || 'שגיאה בתמלול');
      (err as any).retryAfter = lastErr?.retryAfter;
      throw err;
    }

    throw new Error('Engine not supported for batch transcription');
  };

  const batchSaveTranscript = async (text: string, engineUsed: string, title: string) => {
    await saveTranscript(text, engineUsed, title, undefined);
  };

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
    <div className="mobile-optimized-page transcription-page min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header with Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div className="text-right flex-1">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              מערכת תמלול מתקדמת
            </h1>
            <p className="text-muted-foreground">
              תמלול חכם של אודיו ווידאו לעברית עם עריכה מונעת AI
            </p>
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
            <Button
              variant={perfMonitor.enabled ? "default" : "outline"}
              size="icon"
              onClick={() => {
                perfMonitor.toggle();
                if (!perfMonitor.enabled) setShowPerfPanel(true);
                else setShowPerfPanel(false);
              }}
              title={perfMonitor.enabled ? "מוניטור ביצועים פעיל — לחץ לכיבוי" : "הפעל מוניטור ביצועים"}
              className={perfMonitor.enabled ? "bg-purple-600 hover:bg-purple-700 text-white" : ""}
            >
              <Activity className="h-4 w-4 text-blue-900" />
            </Button>
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setShowHelp(true)}
              title="קיצורי מקלדת (?)"
            >
              <Keyboard className="h-4 w-4 text-blue-900" />
            </Button>
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => navigate("/settings")}
            >
              <Settings className="h-4 w-4 text-blue-900" />
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <Tabs defaultValue="transcribe" className="w-full" dir="rtl">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="transcribe">תמלול</TabsTrigger>
            <TabsTrigger 
              value="edit"
              onClick={() => navigate('/text-editor')}
            >
              <FileEdit className="w-4 h-4 ml-1 text-blue-900" />
              עריכת טקסט
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Incoming file banner — shows immediately when a file is received from another page */}
        {incomingFileBanner && (
          <Card className="p-3 border-primary/40 bg-primary/10 shadow-sm animate-pulse" dir="rtl">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-lg">📎</span>
              <div className="flex-1">
                <div className="font-semibold">קובץ התקבל מדף אחר — מתחיל תמלול...</div>
                <div className="text-xs text-muted-foreground">
                  {incomingFileBanner.name} ({(incomingFileBanner.size / 1024 / 1024).toFixed(1)} MB) — מנוע: {engine}
                </div>
              </div>
            </div>
          </Card>
        )}

        <TranscriptionEngine 
          selected={engine} 
          onChange={setEngine}
          sourceLanguage={sourceLanguage}
          onSourceLanguageChange={setSourceLanguage}
          groqKeysText={groqPoolText}
        />

        {engine === 'local-server' && (
          <div className="flex flex-col gap-2" dir="rtl">
            {/* Cloud save mode selector */}
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2" dir="rtl">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">מה לעשות אחרי התמלול?</span>
                <span className="text-sm font-medium">💾 מצב שמירה</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {([
                  { value: 'immediate', icon: '☁️', label: 'שמור לענן', desc: 'טקסט + אודיו → Supabase' },
                  { value: 'text-only', icon: '📝', label: 'טקסט בלבד', desc: 'רק הטקסט → Supabase' },
                  { value: 'skip',      icon: '🏠', label: 'מקומי בלבד', desc: 'localStorage, לא לענן' },
                ] as const).map(({ value, icon, label, desc }) => {
                  const active = (preferences.cuda_cloud_save || 'immediate') === value;
                  return (
                    <button
                      key={value}
                      onClick={() => updatePreference('cuda_cloud_save', value)}
                      title={desc}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-background text-muted-foreground border-border hover:border-blue-400 hover:text-foreground'
                      }`}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {(preferences.cuda_cloud_save || 'immediate') === 'immediate' && '☁️ טקסט + קובץ אודיו יועלו ל-Supabase אחרי כל תמלול'}
                {(preferences.cuda_cloud_save || 'immediate') === 'text-only'  && '📝 רק הטקסט המתומלל יישמר בענן — האודיו נשאר מקומי'}
                {(preferences.cuda_cloud_save || 'immediate') === 'skip'       && '🏠 שום דבר לא יישמר לענן — רק ב-localStorage של הדפדפן'}
              </p>
            </div>

          </div>
        )}

        <PronunciationStack
          mode={(preferences.pronunciation_layout_mode as any) || 'rich'}
          onModeChange={(m) => updatePreference('pronunciation_layout_mode', m)}
          loshonKodeshSlot={
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm"
              dir="rtl"
            >
              <label className="flex items-center gap-2 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={loshonKodeshOn}
                  onChange={(e) => {
                    setLoshonKodeshOn(e.target.checked);
                  }}
                  className="rounded border-yellow-400"
                />
                <span className="font-medium">לשון הקודש (הגייה אשכנזית)</span>
                <span className="text-xs text-muted-foreground">
                  — מטה את התמלול למינוח תורני וכתיב מסורתי (תורה / גמרא / רמב"ם וכו').
                </span>
              </label>
            </div>
          }
          personalModelSlot={
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 px-3 py-2 text-sm"
              dir="rtl"
            >
              <label className="flex items-center gap-2 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={personalModelOn}
                  onChange={(e) => {
                    setPersonalPronunciationEnabled(e.target.checked);
                    setPersonalModelOn(e.target.checked);
                    updatePreference('personal_pronunciation_enabled', e.target.checked);
                    debugLog.info('Index', 'Personal pronunciation toggle changed', {
                      enabled: e.target.checked,
                      isAuthenticated,
                    });
                  }}
                  className="rounded border-purple-400"
                />
                <span className="font-medium flex items-center gap-1"><BrainCircuit className="w-4 h-4 text-[#0f1e43]" /> מודל הגייה אישי</span>
                <span className="text-xs text-muted-foreground">
                  — תוספת למנוע: מחיל תיקונים שלמדתי בעבר ומילים שאימתתי כנכון.
                </span>
              </label>
            </div>
          }
          profileSelectorSlot={
            <PronunciationProfileSelector onProfileChange={(id) => updatePreference('active_pronunciation_profile', id)} />
          }
        />


        {(engine === 'assemblyai' || engine === 'deepgram') && (
          <div className="flex items-center gap-2 text-sm" dir="rtl">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={diarize}
                onChange={e => setDiarize(e.target.checked)}
                className="rounded border-gray-300"
              />
              <Users className="w-4 h-4" />
              <span>זיהוי דוברים (Speaker Diarization)</span>
            </label>
          </div>
        )}

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3" dir="rtl">
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={rangeEnabled}
                onChange={(e) => setRangeEnabled(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span>חיתוך אודיו לפני עיבוד</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openQuickCut()}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-yellow-500/50 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                title="פתח חיתוך מהיר לקובץ חיצוני"
              >
                <Scissors className="w-3.5 h-3.5" />
                חיתוך מהיר
              </button>
              <span className="text-xs text-muted-foreground">מומלץ לקבצים ארוכים</span>
            </div>
          </div>
          {rangeEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                התחלה (שניות)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={rangeStartSec}
                  onChange={(e) => setRangeStartSec(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                סוף (שניות, ריק = עד הסוף)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={rangeEndSec}
                  onChange={(e) => setRangeEndSec(e.target.value)}
                  placeholder="למשל 120"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
              </label>
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FileUploader 
            onFileSelect={handleFileSelect} 
            isLoading={isLoading}
            progress={progress}
            engine={engine}
            statusText={
              isLoading && engine === 'local-server' && (serverProgress === 0 || serverProgress === undefined)
                ? serverPhase === 'loading-model'
                  ? '⏳ טוען מודל AI...'
                  : '📤 מעלה קובץ לשרת...'
                : undefined
            }
            isAuthenticated={isAuthenticated}
            isCloudEngine={engine !== 'local' && engine !== 'local-server'}
            onSubmitBatch={(files) => submitBatchJobs(files, engine, sourceLanguage)}
            onSaveTranscript={batchSaveTranscript}
            onRetryJob={retryJob}
            onSubmitBackgroundJob={(file) => submitJob(file, engine, sourceLanguage)}
            jobs={jobs}
            maxFileSizeMB={MAX_AUDIO_SIZE_MB}
          />
          <AudioRecorder
            onRecordingComplete={handleFileSelect}
            isTranscribing={isLoading}
            engine={engine}
          />
        </div>

        {/* Recovered partial transcript banner */}
        {recoveredPartialInfo && !isLoading && transcript && (
          <Card className="p-3 border-amber-500/40 bg-amber-500/5" dir="rtl">
            <input
              ref={resumeFileInputRef}
              type="file"
              className="hidden"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.wma,.mp4,.webm,.avi,.mov,.mkv"
              onChange={handleResumeFilePick}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => {
                    clearPartial();
                    setRecoveredPartialInfo(null);
                    setTranscript('');
                    setWordTimings([]);
                    toast({ title: "התמלול החלקי נמחק" });
                  }}
                >
                  <Square className="h-3 w-3" />
                  עצור
                </Button>
                {recoveredPartialInfo.lastSegEnd && (
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => {
                      if (currentFileRef.current || lastFileRef.current) {
                        handleResumeTranscription();
                      } else {
                        resumeFileInputRef.current?.click();
                      }
                    }}
                  >
                    <Play className="h-3 w-3" />
                    {currentFileRef.current || lastFileRef.current ? 'המשך' : 'בחר קובץ והמשך'}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 text-right">
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    ⏸ תמלול חלקי ({recoveredPartialInfo.progress}%)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {recoveredPartialInfo.wordCount} מילים{recoveredPartialInfo.lastSegEnd ? ` — עצר ב-${Math.round(recoveredPartialInfo.lastSegEnd)}s` : ''}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Performance Monitor Panel */}
        {perfMonitor.enabled && showPerfPanel && (
          <PerfMonitorPanel
            records={perfMonitor.records}
            onClear={perfMonitor.clearRecords}
            onClose={() => setShowPerfPanel(false)}
          />
        )}

        {/* Transcription stats — shown after CUDA transcription completes */}
        {lastStats && !isLoading && (
          <Card className="p-3 border-green-500/30 bg-green-500/5" dir="rtl">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2 text-muted-foreground"
                onClick={() => setLastStats(null)}
              >
                ✕
              </Button>
              <div className="flex flex-wrap gap-3 text-xs text-right">
                <span>⏱ {lastStats.processing_time}s</span>
                <span>📊 RTF={lastStats.rtf}</span>
                <span>📐 {lastStats.compute_type}</span>
                <span>🔍 beam={lastStats.beam_size}</span>
                <span>{lastStats.fast_mode ? '⚡ מהיר' : '🐢 רגיל'}</span>
                <span>📁 {(lastStats.file_size / 1024 / 1024).toFixed(1)}MB</span>
                <span>🎵 {lastStats.duration.toFixed(0)}s</span>
              </div>
            </div>
          </Card>
        )}

        {/* Active transcription progress panel */}
        {isLoading && (
          <Card className="p-4 border-primary/40 bg-primary/5 shadow-sm" dir="rtl">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-2.5 text-right">
                {/* Top row: status + engine badge */}
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                    engine === 'groq' ? 'text-primary border-primary/30' :
                    engine === 'google' ? 'text-blue-500 border-blue-500/30' :
                    engine === 'assemblyai' ? 'text-green-500 border-green-500/30' :
                    engine === 'deepgram' ? 'text-purple-500 border-purple-500/30' :
                    engine === 'local-server' ? 'text-purple-500 border-purple-500/30' :
                    engine === 'local' ? 'text-accent border-accent/30' :
                    'text-primary border-primary/30'
                  }`}>
                    {engine === 'groq' && <Zap className="w-3 h-3" />}
                    {engine === 'openai' && <Globe className="w-3 h-3" />}
                    {engine === 'google' && <Chrome className="w-3 h-3" />}
                    {engine === 'assemblyai' && <Mic className="w-3 h-3" />}
                    {engine === 'deepgram' && <Waves className="w-3 h-3" />}
                    {engine === 'local-server' && <Server className="w-3 h-3" />}
                    {engine === 'local' && <Cpu className="w-3 h-3" />}
                    {engine === 'groq' ? 'Groq' : engine === 'openai' ? 'OpenAI' : engine === 'google' ? 'Google' : engine === 'assemblyai' ? 'AssemblyAI' : engine === 'deepgram' ? 'Deepgram' : engine === 'local-server' ? 'CUDA' : 'ONNX'}
                  </span>
                  <span className="font-medium text-sm">
                    {progress !== undefined && progress > 0
                      ? `מתמלל... ${progress}%`
                      : engine === 'local-server' && serverPhase === 'loading-model'
                        ? '⏳ טוען מודל...'
                        : 'מתמלל...'}
                  </span>
                </div>

                {/* Big percentage display — all engines with real progress */}
                {progress !== undefined && progress > 0 && (
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold tabular-nums text-primary leading-none">{progress}</span>
                      <span className="text-base font-medium text-muted-foreground">%</span>
                    </div>
                    {engine === 'local-server' && serverAudioDur > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        🎵 {Math.floor(serverAudioProcessed / 60)}:{String(Math.floor(serverAudioProcessed % 60)).padStart(2, '0')}
                        {' / '}
                        {Math.floor(serverAudioDur / 60)}:{String(Math.floor(serverAudioDur % 60)).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                )}

                {/* Progress bar */}
                <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                  {progress !== undefined && progress > 0 ? (
                    <div
                      className="absolute top-0 right-0 h-full rounded-full bg-primary transition-[width] duration-300 ease-out overflow-hidden"
                      style={{ width: `${Math.max(progress, 2)}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-primary/40 rounded-full animate-pulse" />
                  )}
                </div>
                {engine === 'local-server' && serverPhase === 'loading-model' && (
                  <p className="text-xs text-muted-foreground text-center -mt-0.5">⏳ טוען מודל AI — התמלול יתחיל בקרוב</p>
                )}

                {/* Bottom row: timer + ETA */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    {engine === 'local-server' && progress !== undefined && progress >= 5 && progress < 100 && transcribeElapsed > 3 && (() => {
                      const etaSec = Math.round((transcribeElapsed / progress) * (100 - progress));
                      const etaMin = Math.floor(etaSec / 60);
                      const etaSecRem = etaSec % 60;
                      return <span>נותרו ~{etaMin > 0 ? `${etaMin}:${String(etaSecRem).padStart(2, '0')}` : `${etaSecRem}s`}</span>;
                    })()}
                    {engine === 'local-server' && serverAudioProcessed > 0 && transcribeElapsed > 2 && (() => {
                      const rtf = transcribeElapsed / serverAudioProcessed;
                      const speedX = serverAudioProcessed / Math.max(1, transcribeElapsed);
                      return (
                        <span className="tabular-nums" title={`RTF=${rtf.toFixed(2)} (1 שנייה אודיו = ${rtf.toFixed(2)} שניות עיבוד)`}>
                          ⚡ {speedX.toFixed(1)}x
                        </span>
                      );
                    })()}
                  </span>
                  <span className="font-mono tabular-nums">
                    ⏱ {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={handleCancelTranscription}
                title="השהה תמלול"
              >
                <Pause className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* Live transcript preview during streaming */}
        {isLoading && transcript && (
          <Card className="p-4 border-green-500/30 bg-green-500/5" dir="rtl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-mono">
                {transcript.split(/\s+/).filter(Boolean).length} מילים
              </span>
              <h4 className="text-sm font-semibold text-green-700 dark:text-green-400">📝 תמלול חי — מתעדכן בזמן אמת</h4>
            </div>
            <div
              className="max-h-[200px] overflow-y-auto text-sm leading-relaxed text-right p-3 bg-background/60 rounded-md border"
              dir="rtl"
            >
              {transcript}
            </div>
          </Card>
        )}



        {/* Background Jobs Panel */}
        {isAuthenticated && jobs.length > 0 && (
          <BackgroundJobsPanel
            jobs={jobs}
            onRetry={retryJob}
            onDelete={deleteJob}
            onUseResult={(text, eng) => {
              setTranscriptFromEngine(text);
              saveToHistory(text, eng);
            }}
          />
        )}

        {/* Local CUDA Queue Panel */}
        {localQueue.queue.length > 0 && (
          <Card className="p-4 space-y-3" dir="rtl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Server className="w-4 h-4" />
                תור תמלולים מקומי ({localQueue.pendingCount} ממתינים)
              </h3>
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={localQueue.clearCompleted}>
                נקה הושלמו
              </Button>
            </div>
            {localQueue.queue.map(item => (
              <div key={item.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                <div className="flex items-center gap-2 min-w-0">
                  {item.status === 'pending' && <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />}
                  {item.status === 'processing' && <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse shrink-0" />}
                  {item.status === 'completed' && <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />}
                  {item.status === 'failed' && <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />}
                  <span className="truncate">{item.fileName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {item.status === 'pending' && 'ממתין לשרת'}
                    {item.status === 'processing' && 'מתמלל...'}
                    {item.status === 'completed' && 'הושלם'}
                    {item.status === 'failed' && (item.error || 'נכשל')}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Play / Stop-play button */}
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={queuePlayingId === item.id ? 'עצור השמעה' : 'נגן'}
                    onClick={() => handleQueuePlay(item.id)}>
                    {queuePlayingId === item.id ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </Button>
                  {/* Stop transcription (only for processing item) */}
                  {item.status === 'processing' && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-orange-500" title="עצור תמלול"
                      onClick={handleCancelQueueItem}>
                      <Pause className="w-3 h-3" />
                    </Button>
                  )}
                  {/* Retry (only for failed items) */}
                  {item.status === 'failed' && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-500" title="נסה שוב"
                      onClick={() => localQueue.retryItem(item.id)}>
                      <Zap className="w-3 h-3" />
                    </Button>
                  )}
                  {/* Delete (always available except when processing) */}
                  {item.status !== 'processing' && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" title="מחק"
                      onClick={() => localQueue.removeFromQueue(item.id)}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}

        {/* Live Transcription */}
        <LiveTranscriber
          serverConnected={serverConnected}
          onTranscriptComplete={async (result: LiveTranscriptResult) => {
            const { text, audioBlob, wordTimings, folder, durationSec } = result;
            setTranscriptFromEngine(text);
            const engineLabel = audioBlob ? 'Live (CUDA Whisper)' : 'Live (Web Speech API)';
            const audioFile = audioBlob
              ? new File([audioBlob], `live-${Date.now()}.webm`, { type: audioBlob.type })
              : undefined;
            // Save audio to Dexie so TextEditor & Diarization can recover it
            if (audioBlob) {
              try {
                await db.audioBlobs.put({
                  id: 'last_audio',
                  blob: audioBlob,
                  type: audioBlob.type || 'audio/webm',
                  name: audioFile?.name || `live-${Date.now()}.webm`,
                  saved_at: Date.now(),
                });
              } catch { /* Dexie not available */ }
            }
            const liveAudioUrl = audioBlob ? URL.createObjectURL(audioBlob) : undefined;
            saveToHistory(text, engineLabel, undefined, wordTimings, audioFile, folder).then(() => {
              setTimeout(() => navigate('/text-editor', { state: { text, audioUrl: liveAudioUrl, wordTimings, transcriptId: lastSavedTranscriptIdRef.current } }), 1000);
            });
            addAnalyticsRecord({
              engine: engineLabel, status: 'success',
              charCount: text.length, wordCount: text.split(/\s+/).length,
              audioDuration: durationSec,
            });
            toast({ title: "תמלול חי הושלם!", description: audioFile ? "הקלטה + תמלול נשמרו" : undefined });
          }}
        />



        {/* Local Model Manager - shown when local engine or local-server selected */}
        {(engine === 'local' || engine === 'local-server') && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full mb-4">
                <ChevronDown className="w-4 h-4 ml-2" />
                ניהול מודלים מקומיים
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mb-4">
              <LocalModelManager />
            </CollapsibleContent>
          </Collapsible>
        )}

        <CloudTranscriptHistory
          transcripts={transcripts}
          isCloud={isCloud}
          isLoading={isCloudLoading}
          onSelect={(text) => setTranscriptFromEngine(text)}
          onClearAll={() => {
            deleteAll();
            toast({ title: "ההיסטוריה נמחקה" });
          }}
          onDelete={deleteTranscript}
          onUpdate={(id, updates) => updateTranscript(id, updates)}
          initialFolderFilter={folderFromUrl}
        />

        {transcript && (
          <>
            <div className="flex gap-2 items-center justify-end" dir="rtl">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(transcript);
                    setCopied(true);
                    toast({ title: "הטקסט הועתק!" });
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    toast({ title: "שגיאה", description: "לא ניתן להעתיק ללוח", variant: "destructive" });
                  }
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "הועתק!" : "העתק תמלול"}
              </Button>
              <ShareTranscript transcript={transcript} />
            </div>
            <TranscriptSummary transcript={transcript} />
          </>
        )}

        {/* Waveform player — shown when audio available */}
        {audioUrl && (
          <WaveformPlayer
            ref={waveformRef}
            audioSrc={audioUrl}
            wordTimings={wordTimings}
            className="mt-2"
          />
        )}

        {transcript && (
          <div 
            style={{
              fontSize: `${fontSize}px`,
              fontFamily: fontFamily,
              color: textColor,
              lineHeight: lineHeight,
            }}
          >
            <TranscriptEditor 
              transcript={transcript}
              originalTranscript={originalTranscript}
              onTranscriptChange={setTranscript}
              wordTimings={wordTimings}
              onWordClick={(w) => waveformRef.current?.seekTo(w.start)}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
            />
          </div>
        )}

        {/* YouTube Transcription — available when local server is connected */}
        {serverConnected && (
          <YouTubeTranscriber
            onTranscriptComplete={(text) => {
              setTranscriptFromEngine(text);
              saveToHistory(text, 'YouTube (Whisper GPU)').then(() => {
                setTimeout(() => navigate('/text-editor', { state: { text, transcriptId: lastSavedTranscriptIdRef.current } }), 1000);
              });
              addAnalyticsRecord({
                engine: 'YouTube (Whisper GPU)', status: 'success',
                charCount: text.length, wordCount: text.split(/\s+/).length,
              });
              toast({ title: "תמלול YouTube הושלם!" });
            }}
          />
        )}

        {/* Speaker Diarization — available when local server is connected */}
        {serverConnected && (
          <SpeakerDiarization />
        )}
      </div>
    </div>
    <KeyboardShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />
    </Suspense>
  );
};

export default Index;
