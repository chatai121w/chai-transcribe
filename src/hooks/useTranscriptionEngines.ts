import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocalTranscription } from "@/hooks/useLocalTranscription";
import { useLocalServer, type TranscriptionStats, type CudaOptions } from "@/hooks/useLocalServer";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { debugLog } from "@/lib/debugLogger";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useTranscriptionAnalytics } from "@/hooks/useTranscriptionAnalytics";
import { usePerfMonitor } from "@/hooks/usePerfMonitor";
import { useTranscriptionJobs } from "@/hooks/useTranscriptionJobs";
import { useLocalTranscriptionQueue } from "@/hooks/useLocalTranscriptionQueue";
import { useKeyRotation } from "@/hooks/useKeyRotation";
import type { CloudProvider } from "@/hooks/useKeyRotation";
import { applyLearnedCorrections } from "@/utils/correctionLearning";
import { isPersonalPronunciationEnabled } from "@/lib/personalPronunciationModel";
import {
  applyProfileCorrections,
  getActiveProfileId,
  buildProfileHotwords,
  getProfileInitialPrompt,
  isProfileLoshonKodesh,
} from "@/lib/pronunciationProfiles";
import { getHotwordsString, applyVocabularyCorrections } from "@/utils/customVocabulary";
import { addNotification } from "@/hooks/useNotifications";
import { isVideoFile, extractAudioFromVideo, VIDEO_NEEDS_EXTRACTION, MAX_VIDEO_SIZE_MB, MAX_AUDIO_SIZE_MB } from "@/lib/videoUtils";
import { compressAudio, needsCompression, formatFileSize, CLOUD_API_LIMIT } from "@/lib/audioCompression";
import { db } from "@/lib/localDb";
import { isLoshonKodeshEnabled } from "@/lib/loshonKodesh";

type Engine = 'openai' | 'groq' | 'google' | 'local' | 'local-server' | 'assemblyai' | 'deepgram';
type SourceLanguage = 'auto' | 'he' | 'yi' | 'en';
type WordTiming = { word: string; start: number; end: number; probability?: number };

interface TranscriptionState {
  transcript: string;
  setTranscript: (t: string) => void;
  wordTimings: WordTiming[];
  setWordTimings: (w: WordTiming[]) => void;
  isUploading: boolean;
  setIsUploading: (b: boolean) => void;
  uploadProgress: number;
  setUploadProgress: (p: number) => void;
  lastStats: TranscriptionStats | null;
  setLastStats: (s: TranscriptionStats | null) => void;
  audioUrl: string | null;
  setAudioUrl: (u: string | null) => void;
  recoveredPartialInfo: { progress: number; wordCount: number; lastSegEnd?: number } | null;
  setRecoveredPartialInfo: (i: { progress: number; wordCount: number; lastSegEnd?: number } | null) => void;
  diarize: boolean;
}

interface TranscriptionPreferences {
  engine: string;
  source_language: string;
  cuda_hotwords?: string;
  cuda_preset?: string;
  cuda_fast_mode?: boolean;
  cuda_compute_type?: string;
  cuda_beam_size?: number;
  cuda_no_condition_prev?: boolean;
  cuda_vad_aggressive?: boolean;
  cuda_paragraph_threshold?: number;
  cuda_cloud_save?: string;
  [key: string]: any;
}

export function useTranscriptionEngines(
  state: TranscriptionState,
  preferences: TranscriptionPreferences,
) {
  const navigate = useNavigate();
  const { getPool: getProviderApiKeyPool, shouldRotate: shouldRotateProviderKey, getStartIndex: getProviderStartIndex, setActiveKey: setProviderActiveKey, getLabel: getProviderLabel } = useKeyRotation();
  const { transcribe: localTranscribe, isLoading: isLocalLoading, progress: localProgress } = useLocalTranscription();
  const { transcribeStream: serverTranscribeStream, transcribeStreamParallel: serverTranscribeParallel, isLoading: isServerLoading, progress: serverProgress, phase: serverPhase, isConnected: serverConnected, modelReady: serverModelReady, recoverPartial, clearPartial, cancelStream: cancelServerStream, checkConnection, startPolling, stopPolling } = useLocalServer();
  const bgTask = useBackgroundTask();
  const { transcripts, isLoading: isCloudLoading, saveTranscript, updateTranscript, deleteTranscript, deleteAll, isCloud, getAudioUrl } = useCloudTranscripts();
  const { jobs, submitJob, submitBatchJobs, retryJob, deleteJob } = useTranscriptionJobs();
  const localQueue = useLocalTranscriptionQueue();
  const { addRecord: addAnalyticsRecord } = useTranscriptionAnalytics();
  const perfMonitor = usePerfMonitor();

  const engine = preferences.engine as Engine;
  const sourceLanguage = preferences.source_language as SourceLanguage;

  const transcriptionStartRef = useRef<number>(0);
  const currentFileRef = useRef<File | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const lastSavedTranscriptIdRef = useRef<string | null>(null);
  const pendingServerFileRef = useRef<{ file: File; audioUrl: string } | null>(null);

  // ── Helpers ─────────────────────────────────────────────────

  const saveToHistory = useCallback(async (text: string, engineUsed: string, skipCloud?: boolean, timings?: WordTiming[], audioFile?: File, folder?: string) => {
    const correctionResult = isPersonalPronunciationEnabled()
      ? applyLearnedCorrections(text, { engine: engineUsed })
      : { text, appliedCount: 0 };
    const profileResult = applyProfileCorrections(correctionResult.text);
    const vocabResult = applyVocabularyCorrections(profileResult.text);
    const finalText = vocabResult.text;
    if (correctionResult.appliedCount > 0 || vocabResult.appliedCount > 0 || profileResult.appliedCount > 0) {
      debugLog.info('Index', `Applied ${correctionResult.appliedCount} learned + ${profileResult.appliedCount} profile + ${vocabResult.appliedCount} vocabulary corrections${getActiveProfileId() ? ` (profile: ${getActiveProfileId()})` : ''}`);
    }

    if (skipCloud) {
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
    addNotification({ type: 'success', title: 'תמלול הושלם', description: `מנוע: ${engineUsed} — ${finalText.split(/\s+/).length} מילים` });
  }, [saveTranscript]);

  const saveTextOnlyToCloud = useCallback(async (text: string, engineUsed: string, timings?: WordTiming[]) => {
    const saved = await saveTranscript(text, engineUsed, undefined, undefined, timings || null);
    lastSavedTranscriptIdRef.current = saved?.id || null;
  }, [saveTranscript]);

  const xhrInvoke = useCallback((functionName: string, formData: FormData, onProgress: (p: number) => void) => {
    return new Promise<{ data?: any; error?: any }>((resolve) => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`);
      xhr.setRequestHeader('x-client-info', 'xhr-upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 50);
          onProgress(percent);
        }
      };

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
  }, []);

  // Common post-transcription handler (reduces per-engine boilerplate)
  const handleSuccess = useCallback(async (
    text: string, timings: WordTiming[], engineLabel: string,
    file: File, fileAudioUrl?: string,
    extra?: { duration?: number; processingTime?: number; model?: string; computeType?: string; beamSize?: number; fastMode?: boolean; rtf?: number; segmentCount?: number; skipCloud?: boolean; cloudSaveMode?: string }
  ) => {
    state.setTranscript(text);
    state.setWordTimings(timings);
    const processingTime = extra?.processingTime ?? (Date.now() - transcriptionStartRef.current) / 1000;

    if (extra?.cloudSaveMode === 'skip') {
      await saveToHistory(text, engineLabel, true, timings);
    } else if (extra?.cloudSaveMode === 'text-only') {
      await saveTextOnlyToCloud(text, engineLabel, timings);
    } else {
      await saveToHistory(text, engineLabel, undefined, timings);
    }

    addAnalyticsRecord({
      engine: engineLabel, status: 'success',
      fileName: file.name, fileSize: file.size,
      processingTime,
      charCount: text.length, wordCount: text.split(/\s+/).length,
      ...(extra?.duration && { audioDuration: extra.duration }),
      ...(extra?.model && { model: extra.model }),
      ...(extra?.computeType && { computeType: extra.computeType }),
      ...(extra?.beamSize && { beamSize: extra.beamSize }),
      ...(extra?.fastMode !== undefined && { fastMode: extra.fastMode }),
      ...(extra?.rtf && { rtf: extra.rtf }),
      ...(extra?.segmentCount && { segmentCount: extra.segmentCount }),
    });
    perfMonitor.record({
      engine: engineLabel, status: 'success',
      fileName: file.name, fileSize: file.size,
      audioDuration: extra?.duration || 0,
      processingTime,
      text, wordTimings: timings,
      ...(extra?.model && { model: extra.model }),
      ...(extra?.computeType && { computeType: extra.computeType }),
      ...(extra?.beamSize && { beamSize: extra.beamSize }),
    });
    toast({ title: "הצלחה!", description: `התמלול עם ${engineLabel} הושלם בהצלחה - עובר לעריכת טקסט` });
    if (timings.length > 0) localStorage.setItem('last_word_timings', JSON.stringify(timings));
    setTimeout(() => {
      navigate('/text-editor', { state: { text, audioUrl: fileAudioUrl, wordTimings: timings, transcriptId: lastSavedTranscriptIdRef.current } });
    }, 1000);
  }, [state, saveToHistory, saveTextOnlyToCloud, addAnalyticsRecord, perfMonitor, navigate]);

  const handleError = useCallback((engineLabel: string, file: File, error: unknown) => {
    debugLog.error(engineLabel, 'Transcription failed', error instanceof Error ? error.message : error);
    addAnalyticsRecord({
      engine: engineLabel, status: 'failed',
      fileName: file.name, fileSize: file.size,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    toast({
      title: `שגיאה בתמלול ${engineLabel}`,
      description: error instanceof Error ? error.message : "שגיאה לא ידועה",
      variant: "destructive",
    });
  }, [addAnalyticsRecord]);

  // ── Cloud engine helper (OpenAI/Groq — using XHR via supabase edge) ──

  const transcribeCloudXhr = useCallback(async (
    provider: 'openai' | 'groq',
    functionName: string,
    engineLabel: string,
    file: File,
    fileAudioUrl?: string,
  ) => {
    state.setIsUploading(true);
    try {
      const keyPool = getProviderApiKeyPool(provider);
      if (keyPool.length === 0) {
        toast({ title: "נדרש מפתח API", description: `יש להגדיר מפתח ${getProviderLabel(provider)} בהגדרות`, variant: "destructive" });
        navigate("/login");
        state.setIsUploading(false);
        return;
      }

      state.setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: `מעבד עם ${engineLabel}` });

      const safeStartIndex = getProviderStartIndex(provider, keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const key = keyPool[idx];

        const form = new FormData();
        form.append('file', file, file.name);
        form.append('fileName', file.name);
        form.append('apiKey', key);
        form.append('language', sourceLanguage);
        form.append('targetLanguage', 'he');

        debugLog.info(engineLabel, `Uploading via XHR with key #${idx + 1}/${keyPool.length}`);
        const result = await xhrInvoke(functionName, form, (p) => state.setUploadProgress(p));
        debugLog.info(engineLabel, 'Response received', { hasData: !!result.data, hasError: !!result.error, keyIndex: idx + 1 });

        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: `No transcription received from ${engineLabel}` };
        const canRotate = shouldRotateProviderKey(lastError);
        const hasNext = offset < keyPool.length - 1;

        if (canRotate && hasNext) {
          toast({ title: `מעביר למפתח ${getProviderLabel(provider)} הבא`, description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.` });
          continue;
        }
        break;
      }

      if (!data?.text) {
        const errMsg = lastError?.message || lastError?.error || 'שגיאה לא ידועה';
        if (errMsg === 'RATE_LIMIT' || lastError?.retryAfter) {
          const wait = lastError?.retryAfter || 60;
          throw new Error(`כל מפתחות ${engineLabel} נוצלו/הוגבלו. נסה שוב בעוד ${wait} שניות.`);
        }
        throw new Error(errMsg);
      }

      setProviderActiveKey(provider, keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({ title: `בוצעה החלפת מפתח ${getProviderLabel(provider)}`, description: `התמלול הושלם עם מפתח #${usedIndex + 1}.` });
      }

      const timings = data.wordTimings || [];
      await handleSuccess(data.text, timings, engineLabel, file, fileAudioUrl);
    } catch (error) {
      handleError(engineLabel, file, error);
      throw error;
    } finally {
      state.setIsUploading(false);
    }
  }, [state, sourceLanguage, xhrInvoke, getProviderApiKeyPool, getProviderStartIndex, shouldRotateProviderKey, setProviderActiveKey, getProviderLabel, handleSuccess, handleError, navigate]);

  // ── Cloud engine helper (AssemblyAI/Deepgram — using XHR with diarize) ──

  const transcribeCloudDiarize = useCallback(async (
    provider: 'assemblyai' | 'deepgram',
    functionName: string,
    engineLabel: string,
    file: File,
    fileAudioUrl?: string,
  ) => {
    state.setIsUploading(true);
    try {
      const keyPool = getProviderApiKeyPool(provider);
      if (keyPool.length === 0) {
        toast({ title: "נדרש מפתח API", description: `יש להגדיר מפתח ${getProviderLabel(provider)} בהגדרות`, variant: "destructive" });
        navigate("/login");
        state.setIsUploading(false);
        return;
      }

      state.setUploadProgress(0);
      toast({ title: "מעלה קובץ...", description: "מעבד את הקובץ שלך" });

      const safeStartIndex = getProviderStartIndex(provider, keyPool.length);
      let data: any = null;
      let lastError: any = null;
      let usedIndex = safeStartIndex;

      for (let offset = 0; offset < keyPool.length; offset++) {
        const idx = (safeStartIndex + offset) % keyPool.length;
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('apiKey', keyPool[idx]);
        form.append('language', sourceLanguage);
        if (state.diarize) form.append('diarize', 'true');

        const result = await xhrInvoke(functionName, form, (p) => state.setUploadProgress(p));
        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({ title: `מעביר למפתח ${getProviderLabel(provider)} הבא`, description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.` });
          continue;
        }
        break;
      }

      if (!data?.text) throw (lastError || new Error('No transcription received'));

      setProviderActiveKey(provider, keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({ title: `בוצעה החלפת מפתח ${getProviderLabel(provider)}`, description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.` });
      }

      const timings = data.wordTimings || [];
      await handleSuccess(data.text, timings, engineLabel, file, fileAudioUrl);
    } catch (error) {
      handleError(engineLabel, file, error);
      throw error;
    } finally {
      state.setIsUploading(false);
    }
  }, [state, sourceLanguage, xhrInvoke, getProviderApiKeyPool, getProviderStartIndex, shouldRotateProviderKey, setProviderActiveKey, getProviderLabel, handleSuccess, handleError, navigate]);

  // ── Google (base64 via supabase edge function) ──

  const transcribeWithGoogle = useCallback(async (file: File, fileAudioUrl?: string) => {
    state.setIsUploading(true);
    try {
      const keyPool = getProviderApiKeyPool('google');
      if (keyPool.length === 0) {
        toast({ title: "נדרש מפתח API", description: "יש להגדיר מפתח Google בהגדרות", variant: "destructive" });
        navigate("/login");
        state.setIsUploading(false);
        return;
      }

      debugLog.info('Google', 'Converting file to base64...');
      toast({ title: "מעלה קובץ...", description: "מעבד עם Google Speech-to-Text" });

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = reader.result?.toString().split(',')[1];
          if (base64) resolve(base64);
          else reject(new Error('Failed to convert file'));
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
        const result = await supabase.functions.invoke('transcribe-google', {
          body: { audio: base64Audio, fileName: file.name, apiKey: keyPool[idx], language: sourceLanguage, targetLanguage: 'he' }
        });

        if (!result.error && result.data?.text) {
          data = result.data;
          usedIndex = idx;
          break;
        }

        lastError = result.error || { message: 'No transcription received from Google' };
        if (shouldRotateProviderKey(lastError) && offset < keyPool.length - 1) {
          toast({ title: `מעביר למפתח ${getProviderLabel('google')} הבא`, description: `מפתח ${idx + 1} נכשל/הוגבל. מנסה מפתח ${idx + 2}.` });
          continue;
        }
        break;
      }

      if (!data?.text) throw (lastError || new Error('No transcription received from Google'));

      setProviderActiveKey('google', keyPool, usedIndex);
      if (usedIndex !== safeStartIndex) {
        toast({ title: `בוצעה החלפת מפתח ${getProviderLabel('google')}`, description: `התמלול המשיך אוטומטית עם מפתח #${usedIndex + 1}.` });
      }

      const timings = data.wordTimings || [];
      await handleSuccess(data.text, timings, 'Google Speech-to-Text', file, fileAudioUrl);
    } catch (error) {
      handleError('Google Speech-to-Text', file, error);
      throw error;
    } finally {
      state.setIsUploading(false);
    }
  }, [state, sourceLanguage, getProviderApiKeyPool, getProviderStartIndex, shouldRotateProviderKey, setProviderActiveKey, getProviderLabel, handleSuccess, handleError, navigate]);

  // ── Local (browser ONNX) ──

  const transcribeLocally = useCallback(async (file: File, fileAudioUrl?: string) => {
    try {
      const result = await localTranscribe(file);
      await handleSuccess(result.text, result.wordTimings, 'Local (Browser)', file, fileAudioUrl);
    } catch (error) {
      handleError('Local (Browser)', file, error);
      throw error;
    }
  }, [localTranscribe, handleSuccess, handleError]);

  // ── Local CUDA server ──

  const transcribeWithLocalServer = useCallback(async (
    file: File, fileAudioUrl?: string,
    resumeFrom?: { startFrom: number; existingText: string; existingWords: WordTiming[] }
  ) => {
    const isUp = await checkConnection();
    if (!isUp) {
      const queueId = await localQueue.addToQueue(file, fileAudioUrl || '');
      startPolling(2000);
      toast({ title: "📋 נוסף לתור התמלולים", description: `${file.name} ממתין — התמלול יתחיל אוטומטית כשהשרת יעלה` });
      debugLog.info('Queue', `File queued for CUDA transcription: ${file.name} (${queueId})`);
      return;
    }

    try {
      const preferredModel = localStorage.getItem('preferred_local_model') || undefined;
      const lang = sourceLanguage === 'auto' ? 'auto' : sourceLanguage;
      state.setTranscript('');
      state.setWordTimings([]);
      state.setLastStats(null);
      toast({ title: "מתמלל עם GPU...", description: "מעבד את הקובץ בשרת המקומי עם CUDA — תראה תוצאות בזמן אמת" });

      const vocabHotwords = getHotwordsString();
      const userHotwords = preferences.cuda_hotwords || '';
      const profileHotwords = buildProfileHotwords();
      const mergedHotwords =
        [userHotwords, vocabHotwords, profileHotwords].filter(Boolean).join(', ') || undefined;
      const profilePrompt = getProfileInitialPrompt();
      const cudaOptions: CudaOptions = {
        preset: preferences.cuda_preset || 'balanced',
        fastMode: preferences.cuda_fast_mode,
        computeType: preferences.cuda_compute_type || undefined,
        beamSize: preferences.cuda_beam_size || undefined,
        noConditionOnPrevious: preferences.cuda_no_condition_prev,
        vadAggressive: preferences.cuda_vad_aggressive,
        hotwords: mergedHotwords,
        paragraphThreshold: preferences.cuda_paragraph_threshold || undefined,
        loshonKodesh: isLoshonKodeshEnabled() || isProfileLoshonKodesh(),
        initialPrompt: profilePrompt || undefined,
      };

      const useParallel = !serverModelReady;
      const transcribeFn = useParallel ? serverTranscribeParallel : serverTranscribeStream;
      if (useParallel) {
        debugLog.info('CUDA', 'Using parallel mode: staging audio + preloading model simultaneously');
        toast({ title: "⚡ מצב מקבילי", description: "מעלה אודיו + טוען מודל במקביל" });
      }

      const result = await transcribeFn(file, preferredModel, lang, (partial) => {
        state.setTranscript(partial.text);
        state.setWordTimings(partial.wordTimings);
        debugLog.info('CUDA Stream', `${partial.progress}% — ${partial.wordTimings.length} מילים`);
      }, resumeFrom, cudaOptions);

      const timings = result.wordTimings || [];
      state.setTranscript(result.text);
      state.setWordTimings(timings);
      if (result.stats) state.setLastStats(result.stats);

      const cloudSaveMode = preferences.cuda_cloud_save || 'immediate';
      const engineLabel = `Local CUDA (${result.model || 'server'})`;

      clearPartial();
      await handleSuccess(result.text, timings, engineLabel, file, fileAudioUrl, {
        duration: result.duration || result.stats?.duration,
        processingTime: result.processing_time || result.stats?.processing_time,
        model: result.model,
        computeType: result.stats?.compute_type,
        beamSize: result.stats?.beam_size,
        fastMode: result.stats?.fast_mode,
        rtf: result.stats?.rtf,
        segmentCount: timings.length,
        cloudSaveMode,
      });

      const statsInfo = result.stats ? ` | RTF=${result.stats.rtf} | ${result.stats.compute_type}` : '';
      toast({
        title: "הצלחה!",
        description: `תמלול GPU הושלם ב-${result.processing_time || '?'}s${statsInfo} — עובר לעריכת טקסט`,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CANCELLED') {
        toast({ title: "תמלול הופסק", description: "התמלול בוטל על ידי המשתמש" });
        return;
      }
      handleError('Local CUDA', file, error);
      toast({
        title: "שגיאה בתמלול שרת מקומי",
        description: `${error instanceof Error ? error.message : 'שגיאה לא ידועה'} — מה שהצליח נשמר`,
        variant: "destructive",
      });
      throw error;
    }
  }, [state, preferences, sourceLanguage, checkConnection, localQueue, startPolling, serverModelReady, serverTranscribeStream, serverTranscribeParallel, clearPartial, handleSuccess, handleError]);

  // ── File selection handler ──

  const handleFileSelect = useCallback(async (file: File) => {
    currentFileRef.current = file;
    lastFileRef.current = file;
    pendingServerFileRef.current = null;
    state.setRecoveredPartialInfo(null);

    const isVideo = isVideoFile(file);
    const maxMB = isVideo ? MAX_VIDEO_SIZE_MB : MAX_AUDIO_SIZE_MB;

    if (file.size > maxMB * 1024 * 1024) {
      debugLog.error('Upload', 'קובץ גדול מדי', { size: file.size, maxMB });
      toast({ title: "שגיאה", description: `הקובץ גדול מדי. גודל מקסימלי: ${maxMB}MB`, variant: "destructive" });
      return;
    }

    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    const url = URL.createObjectURL(file);
    state.setAudioUrl(url);

    try {
      await db.audioBlobs.put({ id: 'last_audio', blob: file, type: file.type, name: file.name, saved_at: Date.now() });
    } catch { /* IndexedDB not available */ }

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
    } catch { /* ignore */ }

    let fileToTranscribe = file;
    if (isVideo && VIDEO_NEEDS_EXTRACTION.has(engine)) {
      debugLog.info('Video', `מחלץ אודיו מוידאו: ${file.name} (${formatFileSize(file.size)})`);
      toast({ title: "🎬 מחלץ אודיו מוידאו...", description: `${engine === 'google' ? 'Google Speech-to-Text' : engine} דורש קובץ אודיו — מחלץ אוטומטית` });
      try {
        fileToTranscribe = await extractAudioFromVideo(file, (p) => state.setUploadProgress(Math.round(p * 0.2)));
        debugLog.info('Video', `חילוץ אודיו הושלם: ${fileToTranscribe.name} (${formatFileSize(fileToTranscribe.size)})`);
      } catch (err) {
        debugLog.error('Video', 'שגיאה בחילוץ אודיו', err);
        toast({ title: "שגיאה בחילוץ אודיו", description: err instanceof Error ? err.message : "לא ניתן לחלץ אודיו מהווידאו", variant: "destructive" });
        return;
      }
    } else if (isVideo) {
      debugLog.info('Video', `שולח וידאו ישירות ל-${engine} (תומך וידאו)`);
      toast({ title: "🎬 וידאו זוהה", description: `${engine} מעבד וידאו ישירות — מחלץ אודיו בצד השרת` });
    }

    const isCloudEngine = !['local-server', 'local'].includes(engine);
    if (isCloudEngine && needsCompression(fileToTranscribe)) {
      const originalSize = formatFileSize(fileToTranscribe.size);
      debugLog.info('Compression', `כיווץ אודיו: ${fileToTranscribe.name} (${originalSize}) — מנוע ענן דורש <25MB`);
      toast({ title: "🗜️ מכווץ אודיו...", description: `${originalSize} → מכווץ ל-16kHz מונו לשליחה ל-${engine}` });
      try {
        fileToTranscribe = await compressAudio(fileToTranscribe, (p) => state.setUploadProgress(20 + Math.round(p * 0.3)));
        const compressedSize = formatFileSize(fileToTranscribe.size);
        debugLog.info('Compression', `כיווץ הושלם: ${originalSize} → ${compressedSize}`);
        toast({ title: "✅ כיווץ הושלם", description: `${originalSize} → ${compressedSize}` });
        if (fileToTranscribe.size > CLOUD_API_LIMIT) {
          debugLog.warn('Compression', `הקובץ עדיין גדול לאחר כיווץ: ${compressedSize}`);
          toast({ title: "⚠️ קובץ עדיין גדול", description: `${compressedSize} — ייתכן שה-API ידחה. מומלץ להשתמש בשרת CUDA מקומי`, variant: "destructive" });
        }
      } catch (err) {
        debugLog.error('Compression', 'שגיאה בכיווץ', err);
        toast({ title: "שגיאה בכיווץ", description: err instanceof Error ? err.message : "לא ניתן לכווץ את הקובץ", variant: "destructive" });
        return;
      }
    }

    debugLog.info('Transcription', `התחלת תמלול: ${fileToTranscribe.name} (${formatFileSize(fileToTranscribe.size)}) עם ${engine}`);
    transcriptionStartRef.current = Date.now();
    perfMonitor.startTimer();

    bgTask.run(`${engine} — ${file.name}`, async () => {
      if (engine === 'openai') {
        await transcribeCloudXhr('openai', 'transcribe-openai', 'OpenAI Whisper', fileToTranscribe, url);
      } else if (engine === 'groq') {
        await transcribeCloudXhr('groq', 'transcribe-groq', 'Groq Whisper', fileToTranscribe, url);
      } else if (engine === 'google') {
        await transcribeWithGoogle(fileToTranscribe, url);
      } else if (engine === 'assemblyai') {
        await transcribeCloudDiarize('assemblyai', 'transcribe-assemblyai', 'AssemblyAI', fileToTranscribe, url);
      } else if (engine === 'deepgram') {
        await transcribeCloudDiarize('deepgram', 'transcribe-deepgram', 'Deepgram', fileToTranscribe, url);
      } else if (engine === 'local-server') {
        await transcribeWithLocalServer(fileToTranscribe, url);
      } else {
        await transcribeLocally(fileToTranscribe, url);
      }
    }).catch(() => {});
  }, [engine, state, bgTask, perfMonitor, transcribeCloudXhr, transcribeCloudDiarize, transcribeWithGoogle, transcribeWithLocalServer, transcribeLocally]);

  // ── Resume transcription ──

  const handleResumeTranscription = useCallback(async (fileOverride?: File) => {
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
    state.setRecoveredPartialInfo(null);
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
  }, [recoverPartial, transcribeWithLocalServer, state]);

  // ── Cancel ──

  const handleCancelTranscription = useCallback(() => {
    if (engine === 'local-server') {
      cancelServerStream();
      const partial = recoverPartial();
      if (partial && partial.text) {
        state.setRecoveredPartialInfo({ progress: partial.progress, wordCount: partial.wordTimings?.length || 0, lastSegEnd: partial.lastSegEnd });
        toast({ title: "⏸ תמלול הופסק", description: `נשמר תמלול חלקי (${partial.progress}%) — ${partial.wordTimings?.length || 0} מילים. אפשר להמשיך מאותו מקום` });
      } else {
        toast({ title: "תמלול הופסק" });
      }
    }
    bgTask.reset();
    state.setIsUploading(false);
  }, [engine, cancelServerStream, recoverPartial, bgTask, state]);

  const handleCancelQueueItem = useCallback(() => {
    cancelServerStream();
    bgTask.reset();
    state.setIsUploading(false);
    const processing = localQueue.processingItem;
    if (processing) {
      localQueue.updateItemStatus(processing.id, 'failed', 'בוטל ידנית');
      localQueue.processingRef.current = false;
    }
    toast({ title: "⏹ תמלול מהתור בוטל" });
  }, [cancelServerStream, bgTask, state, localQueue]);

  // ── Batch transcription ──

  const batchTranscribeFile = useCallback(async (file: File, onProgress: (p: number) => void): Promise<string> => {
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
      const keyPool = getProviderApiKeyPool('google');
      if (keyPool.length === 0) throw new Error('נדרש מפתח API - הגדר בהגדרות');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { const b64 = reader.result?.toString().split(',')[1]; b64 ? resolve(b64) : reject(new Error('Failed to convert')); };
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
        if (!error && data?.text) { setProviderActiveKey('google', keyPool, idx); return data.text; }
        lastErr = error || { message: 'שגיאה בתמלול' };
        if (!(shouldRotateProviderKey(lastErr) && offset < keyPool.length - 1)) break;
      }
      const err = new Error(lastErr?.message || lastErr?.error || 'שגיאה בתמלול');
      (err as any).retryAfter = lastErr?.retryAfter;
      throw err;
    }

    if (engine === 'openai' || engine === 'groq' || engine === 'assemblyai' || engine === 'deepgram') {
      const provider = engine as CloudProvider;
      const keyPool = getProviderApiKeyPool(provider);
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
        if (!error && data?.text) { setProviderActiveKey(provider, keyPool, idx); return data.text; }
        lastErr = error || { message: 'שגיאה בתמלול' };
        if (!(shouldRotateProviderKey(lastErr) && offset < keyPool.length - 1)) break;
      }
      const err = new Error(lastErr?.message || lastErr?.error || 'שגיאה בתמלול');
      (err as any).retryAfter = lastErr?.retryAfter;
      throw err;
    }

    throw new Error('Engine not supported for batch transcription');
  }, [engine, sourceLanguage, localTranscribe, xhrInvoke, getProviderApiKeyPool, getProviderStartIndex, shouldRotateProviderKey, setProviderActiveKey]);

  const batchSaveTranscript = useCallback(async (text: string, engineUsed: string, title: string) => {
    await saveTranscript(text, engineUsed, title, undefined);
  }, [saveTranscript]);

  return {
    // Engine-related state
    isLocalLoading,
    localProgress,
    isServerLoading,
    serverProgress,
    serverPhase,
    serverConnected,
    serverModelReady,
    bgTask,
    transcripts,
    isCloudLoading,
    updateTranscript,
    deleteTranscript,
    deleteAll,
    isCloud,
    getAudioUrl,
    jobs,
    submitJob,
    submitBatchJobs,
    retryJob,
    deleteJob,
    localQueue,
    perfMonitor,

    // Actions
    handleFileSelect,
    handleCancelTranscription,
    handleCancelQueueItem,
    handleResumeTranscription,
    transcribeWithLocalServer,
    batchTranscribeFile,
    batchSaveTranscript,
    saveToHistory,

    // Refs
    currentFileRef,
    lastFileRef,
    lastSavedTranscriptIdRef,
    pendingServerFileRef,
    transcriptionStartRef,

    // Server hooks
    recoverPartial,
    clearPartial,
    cancelServerStream,
    checkConnection,
    startPolling,
    stopPolling,

    // Analytics
    addAnalyticsRecord,
  };
}
