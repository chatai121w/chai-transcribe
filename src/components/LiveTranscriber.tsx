import { useState, useRef, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Mic, Square, Copy, Trash2, Radio, Cpu, Globe, Volume2, Clock, Zap,
  AlertTriangle, Pause, Play, Save, FolderOpen, FolderPlus, Download,
  X, FileText, Trophy, Target, RefreshCw
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { getServerUrl } from "@/lib/serverConfig";
import { supabase } from "@/integrations/supabase/client";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { isLoshonKodeshEnabled } from "@/lib/loshonKodesh";
import { buildProfileHotwords, getProfileInitialPrompt, isProfileLoshonKodesh } from "@/lib/pronunciationProfiles";
import { LiveChunkQueue, type LiveChunkJob } from "@/lib/liveChunkQueue";
import {
  getBrowserLanguage,
  normalizeSourceLanguage,
  resolveCudaModel,
} from "@/lib/transcriptionLanguages";

export type LiveMode = "browser" | "cuda" | "groq" | "openai" | "deepgram" | "assemblyai" | "google";

const CLOUD_LIVE_MODES: LiveMode[] = ["groq", "openai", "deepgram", "assemblyai", "google"];
const isRecordedLiveMode = (mode: LiveMode) => mode !== "browser";
const isCloudLiveMode = (mode: LiveMode) => CLOUD_LIVE_MODES.includes(mode);

const LIVE_ENGINE_LABELS: Record<LiveMode, string> = {
  browser: "Web Speech API",
  cuda: "CUDA Whisper",
  groq: "Groq Whisper",
  openai: "OpenAI Whisper",
  deepgram: "Deepgram Nova-2",
  assemblyai: "AssemblyAI",
  google: "Google Speech-to-Text",
};

const DEFAULT_CHUNK_SEC = 5;
const LIVE_RECORDING_TIMESLICE_MS = 150;
const LIVE_MIN_BLOB_BYTES = 800;
const SILENCE_THRESHOLD = 2;          // Skip chunks below this audio level (averaged over chunk window) — lowered so quiet mics still register speech
const LIVE_CONTEXT_WORDS = 10;        // Last N words carried as context into next chunk (initial_prompt)
const MAX_CONSECUTIVE_ERRORS = 5;
const SEND_TIMEOUT_MS = 90000;        // 90s timeout — allows for long chunks (up to 60s) at high quality

interface LiveStats {
  chunksCaptured: number;
  chunksProcessed: number;
  chunksQueued: number;
  chunksDropped: number;
  totalLatencyMs: number;
  wordsTranscribed: number;
  errorsCount: number;
  silenceSkips: number;
}

const SAVE_FORMATS = ['txt', 'docx', 'srt', 'json', 'vtt'] as const;
type SaveFormat = typeof SAVE_FORMATS[number];

export interface LiveTranscriptResult {
  text: string;
  engine: LiveMode;
  engineLabel: string;
  audioBlob?: Blob;
  wordTimings?: Array<{word: string; start: number; end: number; probability?: number}>;
  folder?: string;
  durationSec?: number;
  fileName?: string;
  format?: string;
  language?: string;
}

interface LiveTranscriberProps {
  onTranscriptComplete: (result: LiveTranscriptResult) => void;
  serverConnected?: boolean;
}

export const LiveTranscriber = ({ onTranscriptComplete, serverConnected }: LiveTranscriberProps) => {
  const { keys: apiKeys } = useCloudApiKeys();
  const { preferences, updatePreference, isLoaded: prefsLoaded } = useCloudPreferences();
  const sourceLanguage = normalizeSourceLanguage(preferences.source_language);
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const hasSavedModeRef = useRef(false);
  const preferredModeRef = useRef<LiveMode | null>(null);
  const [mode, setModeState] = useState<LiveMode>(() => {
    try {
      const saved = localStorage.getItem("live_transcription_engine") as LiveMode | null;
      if (saved && [...CLOUD_LIVE_MODES, "browser", "cuda"].includes(saved)) {
        hasSavedModeRef.current = true;
        preferredModeRef.current = saved;
        return saved;
      }
    } catch { /* */ }
    return serverConnected ? "cuda" : "groq";
  });
  const setMode = useCallback((next: LiveMode) => {
    hasSavedModeRef.current = true;
    preferredModeRef.current = next;
    setModeState(next);
    try { localStorage.setItem("live_transcription_engine", next); } catch { /* */ }
  }, []);
  const chunkSec = preferences.live_chunk_sec ?? DEFAULT_CHUNK_SEC;
  const setChunkSec = useCallback((v: number) => updatePreference('live_chunk_sec', v), [updatePreference]);
  const chunkSecRef = useRef<number>(DEFAULT_CHUNK_SEC);
  useEffect(() => { chunkSecRef.current = chunkSec; }, [chunkSec]);

  // Full re-transcribe on save: chunks are preview-only; on stop, the whole
  // recording is sent as one unit and replaces the chunked text.
  const [fullRetranscribe, setFullRetranscribe] = useState<boolean>(() => {
    try { return localStorage.getItem('live_full_retranscribe') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('live_full_retranscribe', fullRetranscribe ? '1' : '0'); } catch { /* */ }
  }, [fullRetranscribe]);
  const fullRetranscribeRef = useRef(fullRetranscribe);
  useEffect(() => { fullRetranscribeRef.current = fullRetranscribe; }, [fullRetranscribe]);
  const [geminiFinalPass, setGeminiFinalPass] = useState(() => {
    try { return localStorage.getItem("live_gemini_final_pass") === "1"; } catch { return false; }
  });
  const geminiFinalPassRef = useRef(geminiFinalPass);
  useEffect(() => {
    geminiFinalPassRef.current = geminiFinalPass;
    try { localStorage.setItem("live_gemini_final_pass", geminiFinalPass ? "1" : "0"); } catch { /* */ }
  }, [geminiFinalPass]);
  const recognitionRef = useRef<any>(null);
  const [isRefining, setIsRefining] = useState(false);

  // Folder selector
  const [selectedFolder, setSelectedFolder] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('local_folders') || '[]'); } catch { return []; }
  });

  // Save settings
  const [fileName, setFileName] = useState("");
  const [saveFormat, setSaveFormat] = useState<SaveFormat>('txt');
  const micGain = preferences.live_mic_gain ?? 3.5; // sensitivity (1x..4x)
  const setMicGain = useCallback((v: number) => updatePreference('live_mic_gain', v), [updatePreference]);
  const micGainRef = useRef(micGain);
  useEffect(() => {
    micGainRef.current = micGain;
    if (gainNodeRef.current) {
      try { gainNodeRef.current.gain.value = micGain; } catch { /* */ }
    }
  }, [micGain]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  // Pause timer tracking
  const pausedAtRef = useRef(0);
  const totalPausedMsRef = useRef(0);

  // Word timings from refine pass
  const wordTimingsRef = useRef<Array<{word: string; start: number; end: number; probability?: number}>>([]);

  // CUDA live mode refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const archiveRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allChunksRef = useRef<Blob[]>([]);
  const gpuBusyToastAtRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);
  const queueRef = useRef<LiveChunkQueue | null>(null);
  const audioLevelSamplesRef = useRef<number[]>([]);
  const finalTextRef = useRef("");
  const detectedLanguageRef = useRef<string | undefined>(undefined);

  // Groq word-timestamp accumulation
  const cumulativeAudioSecRef = useRef(0);
  const currentGroqRecorderRef = useRef<{
    rec: MediaRecorder;
    chunks: Blob[];
    startMs: number;
    offsetSec: number;
  } | null>(null);
  const startCloudRecorderRef = useRef<(() => void) | null>(null);

  // Audio level indicator refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelRef = useRef(0);

  // Timer & stats
  const startTimeRef = useRef(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef("audio/webm");
  const [stats, setStats] = useState<LiveStats>({
    chunksCaptured: 0, chunksProcessed: 0, chunksQueued: 0, chunksDropped: 0,
    totalLatencyMs: 0, wordsTranscribed: 0, errorsCount: 0, silenceSkips: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep finalTextRef in sync
  useEffect(() => { finalTextRef.current = finalText; }, [finalText]);

  const appendDedupText = useCallback((prev: string, nextRaw: string) => {
    const next = nextRaw.trim();
    if (!next) return prev;
    if (!prev.trim()) return next;

    const prevWords = prev.trim().split(/\s+/);
    const nextWords = next.split(/\s+/);
    const maxOverlap = Math.min(8, prevWords.length, nextWords.length);

    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
      const prevTail = prevWords.slice(-overlap).join(" ");
      const nextHead = nextWords.slice(0, overlap).join(" ");
      if (prevTail === nextHead) {
        const suffix = nextWords.slice(overlap).join(" ");
        return suffix ? `${prev} ${suffix}` : prev;
      }
    }

    return `${prev} ${next}`;
  }, []);

  useEffect(() => {
    // Groq is always available (no browser/server requirement), so isSupported stays true.
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      queueRef.current?.stop();
      queueRef.current = null;
      stopCudaCleanup();
    };
  }, []);

  // Preserve the user's selected engine; only recover from unavailable CUDA.
  useEffect(() => {
    if (!serverConnected && mode === "cuda" && !isListening) setModeState("groq");
    const shouldUseCuda = !hasSavedModeRef.current || preferredModeRef.current === "cuda";
    if (serverConnected && shouldUseCuda && !isListening && mode !== "cuda") {
      setModeState("cuda");
    }
  }, [serverConnected, isListening, mode]);

  // ─── Browser Web Speech API ───
  const startBrowser = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "לא נתמך", description: "הדפדפן שלך לא תומך בתמלול בזמן אמת. נסה Chrome.", variant: "destructive" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getBrowserLanguage(sourceLanguage) || navigator.language || "en-US";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }

      if (final) {
        setFinalText(prev => prev + final);
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        toast({ title: "גישה למיקרופון נדחתה", description: "אנא אפשר גישה למיקרופון", variant: "destructive" });
      }
      setIsListening(false);
      isListeningRef.current = false;
    };

    recognition.onend = () => {
      if (recognitionRef.current && isListeningRef.current) {
        try {
          recognition.start();
        } catch {
          isListeningRef.current = false;
          setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    isListeningRef.current = true;
    setIsListening(true);
  }, []);

  const stopBrowser = useCallback(() => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText("");
  }, []);

  // ─── CUDA Whisper Live Mode ───
  const getBaseUrl = () => getServerUrl();

  const getLiveBiasOptions = useCallback(() => {
    if (sourceLanguage !== "he") {
      return { hotwords: "", initialPrompt: "", loshonKodesh: false };
    }
    const profileHotwords = buildProfileHotwords();
    const profilePrompt = getProfileInitialPrompt();
    const profileForcesLk = isProfileLoshonKodesh();
    const mergedHotwords = [preferences.cuda_hotwords || "", profileHotwords]
      .filter(Boolean)
      .join(", ")
      .trim();
    return {
      hotwords: mergedHotwords,
      initialPrompt: profilePrompt,
      loshonKodesh: isLoshonKodeshEnabled() || profileForcesLk,
    };
  }, [preferences.cuda_hotwords, sourceLanguage]);

  const sendChunk = useCallback(async (job: LiveChunkJob): Promise<"done" | "retry"> => {
    const { blob, offsetSec, averageLevel } = job;
    if (blob.size < LIVE_MIN_BLOB_BYTES) {
      setStats(prev => ({ ...prev, silenceSkips: prev.silenceSkips + 1 }));
      return "done";
    }

    if (averageLevel < SILENCE_THRESHOLD) {
      setStats(prev => ({ ...prev, silenceSkips: prev.silenceSkips + 1 }));
      setInterimText("שקט — ממתין לדיבור...");
      return "done";
    }

    setInterimText("מעבד...");
    const sendStart = performance.now();
    try {
      const formData = new FormData();
      formData.append("file", blob, "chunk.webm");
      const chunkLanguage = sourceLanguage === "auto"
        ? (detectedLanguageRef.current || "auto")
        : sourceLanguage;
      formData.append("language", chunkLanguage);
      const bias = getLiveBiasOptions();
      if (bias.hotwords) formData.append("hotwords", bias.hotwords);
      if (bias.initialPrompt) formData.append("initial_prompt", bias.initialPrompt);
      if (bias.loshonKodesh) formData.append("loshon_kodesh", "1");
      // Carry last N words of previous transcript as context (initial_prompt on server)
      const prevWords = finalTextRef.current.trim().split(/\s+/).filter(Boolean);
      if (prevWords.length > 0) {
        formData.append("context", prevWords.slice(-LIVE_CONTEXT_WORDS).join(" "));
      }

      let status = 0;
      let data: any = null;
      let ok = false;

      if (isCloudLiveMode(mode)) {
        const keyConfig = {
          groq: [apiKeys.groq_key, apiKeys.groq_keys_pool],
          openai: [apiKeys.openai_key, apiKeys.openai_keys_pool],
          deepgram: [apiKeys.deepgram_key, apiKeys.deepgram_keys_pool],
          assemblyai: [apiKeys.assemblyai_key, apiKeys.assemblyai_keys_pool],
          google: [apiKeys.google_key, apiKeys.google_keys_pool],
        } as const;
        const [singleKey, rawPool] = keyConfig[mode];
        const pool = rawPool?.filter(Boolean) || [];
        const apiKey = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : singleKey;
        if (!apiKey) {
          toast({
            title: `חסר מפתח ${LIVE_ENGINE_LABELS[mode]}`,
            description: "הוסף מפתח מתאים בהגדרות API",
            variant: "destructive",
          });
          setInterimText("חסר מפתח API — בדוק הגדרות");
          consecutiveErrorsRef.current = MAX_CONSECUTIVE_ERRORS;
          setStats(prev => ({ ...prev, chunksDropped: prev.chunksDropped + 1 }));
          return "done";
        }
        let response: { data: any; error: any };
        if (mode === "google") {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          response = await supabase.functions.invoke("transcribe-google", {
            body: { audio: btoa(binary), fileName: "chunk.webm", apiKey, language: sourceLanguage },
          });
        } else {
          formData.append("apiKey", apiKey);
          if (mode === "groq") {
            formData.append("model", chunkSecRef.current >= 6 ? "whisper-large-v3" : "whisper-large-v3-turbo");
          }
          response = await supabase.functions.invoke(`transcribe-${mode}`, { body: formData });
        }
        if (response.error) {
          const msg = String(response.error.message || response.error);
          if (msg.includes('429') || /rate/i.test(msg)) {
            const now = Date.now();
            if (now - gpuBusyToastAtRef.current > 4000) {
              gpuBusyToastAtRef.current = now;
              toast({ title: `${LIVE_ENGINE_LABELS[mode]} עסוק`, description: "המקטע נשמר בתור וינוסה שוב" });
            }
            setInterimText("המנוע עסוק — המקטע נשמר בתור");
            return "retry";
          }
          throw new Error(msg);
        }
        data = response.data;
        ok = true;
      } else {
        const cudaModel = resolveCudaModel(sourceLanguage, localStorage.getItem("preferred_local_model"));
        if (cudaModel) formData.append("model", cudaModel);
        const res = await fetch(`${getBaseUrl()}/transcribe-live`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        status = res.status;
        ok = res.ok;
        if (status === 429) {
          const now = Date.now();
          if (now - gpuBusyToastAtRef.current > 4000) {
            gpuBusyToastAtRef.current = now;
            toast({ title: "GPU עסוק", description: "ממשיך אוטומטית כשהשרת יתפנה" });
          }
          setInterimText("GPU עסוק — ממתין...");
          return "retry";
        }
        if (status === 500) {
          consecutiveErrorsRef.current++;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
            toast({ title: "שגיאות חוזרות", description: "מנותק מהשרת — בדוק את שרת CUDA", variant: "destructive" });
            setInterimText("שגיאה — שרת לא מגיב");
            return "done";
          }
          setStats(prev => ({ ...prev, errorsCount: prev.errorsCount + 1 }));
          return "retry";
        }
        if (ok) data = await res.json();
      }

      if (ok && data) {
        consecutiveErrorsRef.current = 0;
        if (typeof data.language === "string" && data.language) {
          detectedLanguageRef.current = data.language;
        }
        const text = data.text?.trim();
        const latencyMs = Math.round(performance.now() - sendStart);
        const newWords = text ? text.split(/\s+/).length : 0;

        // Accumulate word-level timings (Groq returns them per chunk; shift by offset)
        if (Array.isArray(data.wordTimings) && data.wordTimings.length > 0) {
          for (const w of data.wordTimings) {
            if (typeof w?.start === 'number' && typeof w?.end === 'number' && w?.word) {
              wordTimingsRef.current.push({
                word: String(w.word),
                start: w.start + offsetSec,
                end: w.end + offsetSec,
              });
            }
          }
        }

        setStats(prev => ({
          ...prev,
          chunksProcessed: prev.chunksProcessed + 1,
          totalLatencyMs: prev.totalLatencyMs + latencyMs,
          wordsTranscribed: prev.wordsTranscribed + newWords,
        }));

        if (text) {
          setFinalText(prev => appendDedupText(prev, text));
          setInterimText("");
          // Auto-scroll
          setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
        } else {
          setInterimText("מאזין...");
        }
        return "done";
      }
      return "retry";
    } catch (err) {
      console.error("Live chunk error:", err);
      consecutiveErrorsRef.current++;
      setStats(prev => ({ ...prev, errorsCount: prev.errorsCount + 1 }));
      if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        setInterimText("שרת לא מגיב — בדוק חיבור");
      }
      return consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS ? "done" : "retry";
    }
  }, [appendDedupText, mode, apiKeys, getLiveBiasOptions, sourceLanguage]);

  const ensureQueue = useCallback(() => {
    if (!queueRef.current) {
      queueRef.current = new LiveChunkQueue({
        process: sendChunk,
        maxAttempts: 3,
        retryDelayMs: 1000,
        onDepthChange: (depth) => setStats(prev => ({ ...prev, chunksQueued: depth })),
        onDropped: () => setStats(prev => ({
          ...prev,
          chunksDropped: prev.chunksDropped + 1,
          errorsCount: prev.errorsCount + 1,
        })),
      });
    }
    return queueRef.current;
  }, [sendChunk]);

  const enqueueChunk = useCallback((blob: Blob, offsetSec = 0) => {
    const samples = audioLevelSamplesRef.current;
    const averageLevel = samples.length > 0
      ? samples.reduce((sum, level) => sum + level, 0) / samples.length
      : audioLevelRef.current;
    audioLevelSamplesRef.current = [];
    setStats(prev => ({ ...prev, chunksCaptured: prev.chunksCaptured + 1 }));
    ensureQueue().enqueue({ blob, offsetSec, averageLevel });
  }, [ensureQueue]);

  const runFinalRefinePass = useCallback(async (): Promise<string | null> => {
    if (allChunksRef.current.length === 0) return null;
    setIsRefining(true);
    setInterimText("משפר דיוק — refine pass...");
    try {
      const mimeType = mimeTypeRef.current;
      const fullBlob = new Blob(allChunksRef.current, { type: mimeType });

      const formData = new FormData();
      formData.append("file", fullBlob, "live-final.webm");
      formData.append("language", sourceLanguage);
      const cudaModel = resolveCudaModel(sourceLanguage, localStorage.getItem("preferred_local_model"));
      if (cudaModel) formData.append("model", cudaModel);
      formData.append("final", "1");
      const bias = getLiveBiasOptions();
      if (bias.hotwords) formData.append("hotwords", bias.hotwords);
      if (bias.initialPrompt) formData.append("initial_prompt", bias.initialPrompt);
      if (bias.loshonKodesh) formData.append("loshon_kodesh", "1");

      const res = await fetch(`${getBaseUrl()}/transcribe-live`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.language === "string" && data.language) {
        detectedLanguageRef.current = data.language;
      }
      const refinedText = data.text?.trim();
      // Capture word timings from the refine pass
      if (data.wordTimings && Array.isArray(data.wordTimings)) {
        wordTimingsRef.current = data.wordTimings;
      }
      if (refinedText) {
        toast({ title: "✅ שופר דיוק", description: `refine הושלם — ${data.wordTimings?.length || '?'} מילים | ${data.processing_time || '?'}s` });
        return refinedText;
      }
      return null;
    } catch {
      toast({ title: "refine נכשל", description: "משתמש בטקסט שנצבר", variant: "destructive" });
      return null;
    } finally {
      setIsRefining(false);
      setInterimText("");
    }
  }, [getLiveBiasOptions, sourceLanguage]);

  // Re-transcribe the entire recording via Groq edge function as one unit.
  // Used when fullRetranscribe is ON and mode=groq.
  const runGroqFullRetranscribe = useCallback(async (): Promise<string | null> => {
    if (allChunksRef.current.length === 0) return null;
    const pool = apiKeys.groq_keys_pool?.filter(Boolean) || [];
    const groqKey = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : apiKeys.groq_key;
    if (!groqKey) {
      toast({ title: "חסר מפתח Groq", description: "לא ניתן לתמלל מחדש את ההקלטה המלאה", variant: "destructive" });
      return null;
    }
    setIsRefining(true);
    setInterimText("מתמלל מחדש את ההקלטה המלאה...");
    try {
      const mimeType = mimeTypeRef.current;
      const fullBlob = new Blob(allChunksRef.current, { type: mimeType });
      const fd = new FormData();
      fd.append("file", fullBlob, "live-full.webm");
      fd.append("apiKey", groqKey);
      fd.append("language", sourceLanguage);
      fd.append("model", "whisper-large-v3");
      const bias = getLiveBiasOptions();
      if (bias.hotwords) fd.append("hotwords", bias.hotwords);
      if (bias.initialPrompt) fd.append("initial_prompt", bias.initialPrompt);

      const { data, error } = await supabase.functions.invoke('transcribe-groq', { body: fd });
      if (error) throw new Error(String(error.message || error));
      const text = (data?.text || '').trim();
      if (!text) return null;
      if (Array.isArray(data?.wordTimings) && data.wordTimings.length > 0) {
        wordTimingsRef.current = data.wordTimings.map((w: any) => ({
          word: String(w.word), start: Number(w.start) || 0, end: Number(w.end) || 0,
        }));
      }
      toast({ title: "✅ תמלול מלא הושלם", description: `${text.split(/\s+/).length} מילים` });
      return text;
    } catch (e: any) {
      toast({ title: "תמלול מחדש נכשל", description: "משתמש בטקסט המקטעי כגיבוי", variant: "destructive" });
      return null;
    } finally {
      setIsRefining(false);
      setInterimText("");
    }
  }, [apiKeys.groq_key, apiKeys.groq_keys_pool, getLiveBiasOptions, sourceLanguage]);

  const runGeminiFinalPass = useCallback(async (audioBlob: Blob): Promise<string | null> => {
    setIsRefining(true);
    setInterimText("Gemini מבצע תמלול סופי מלא...");
    try {
      const { getPersonalGeminiKey, getPersonalGeminiModel } = await import("@/lib/personalGemini");
      const personalKey = getPersonalGeminiKey();
      const model = (localStorage.getItem("gemini_transcription_model") || getPersonalGeminiModel() || "gemini-flash-latest")
        .replace(/^google\//, "");
      const form = new FormData();
      form.append("file", audioBlob, "live-final.webm");
      form.append("model", model);
      form.append("language", sourceLanguage);
      if (personalKey) form.append("apiKey", personalKey);
      const { data, error } = await supabase.functions.invoke("transcribe-gemini", { body: form });
      if (error) throw error;
      const text = String(data?.text || "").trim();
      if (!text) throw new Error("לא התקבל תמלול מ-Gemini");
      toast({ title: "תמלול Gemini הושלם", description: `${text.split(/\s+/).length} מילים` });
      return text;
    } catch (error) {
      console.error("Gemini live final pass failed:", error);
      toast({ title: "שיפור Gemini נכשל", description: "נשמר התמלול החי שנצבר", variant: "destructive" });
      return null;
    } finally {
      setIsRefining(false);
      setInterimText("");
    }
  }, [sourceLanguage]);

  const startCuda = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      consecutiveErrorsRef.current = 0;
      queueRef.current?.stop();
      queueRef.current = null;
      setStats({
        chunksCaptured: 0, chunksProcessed: 0, chunksQueued: 0, chunksDropped: 0,
        totalLatencyMs: 0, wordsTranscribed: 0, errorsCount: 0, silenceSkips: 0,
      });
      detectedLanguageRef.current = undefined;

      // Recording timer
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      timerIntervalRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Audio level monitoring with smoothing + mic gain boost
      try {
        const actx = new AudioContext({ sampleRate: 16000 });
        const src = actx.createMediaStreamSource(stream);

        // DynamicsCompressor prevents clipping even at high gain settings
        const compressor = actx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        // Gain boost — amplifies quiet microphones before sending to Whisper
        const gainNode = actx.createGain();
        gainNode.gain.value = micGain;
        gainNodeRef.current = gainNode;

        // Destination: records the processed (boosted) audio instead of raw mic
        const dest = actx.createMediaStreamDestination();

        const analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;

        // Chain: raw mic → compressor → gain → VU meter analyser + recording dest
        src.connect(compressor);
        compressor.connect(gainNode);
        gainNode.connect(analyser);
        gainNode.connect(dest);
        processedStreamRef.current = dest.stream;

        audioCtxRef.current = actx;
        analyserRef.current = analyser;
        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(dataArr);
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
          const avg = sum / dataArr.length;
          const level = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(level);
          audioLevelRef.current = level;
          // Collect samples for silence detection averaging (used by sendChunk)
          audioLevelSamplesRef.current.push(level);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // AudioContext not critical — continue without level indicator
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mimeTypeRef.current = mimeType;

      const recorderStream = processedStreamRef.current ?? stream;

      // Keep one continuous archive for saving/refinement. Live chunks use a
      // separate recorder so every request is a self-contained WebM file.
      allChunksRef.current = [];
      const archiveRecorder = new MediaRecorder(recorderStream, { mimeType });
      archiveRecorderRef.current = archiveRecorder;
      archiveRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) allChunksRef.current.push(event.data);
      };
      archiveRecorder.start(LIVE_RECORDING_TIMESLICE_MS);

      cumulativeAudioSecRef.current = 0;
      wordTimingsRef.current = [];

      const startStandaloneRecorder = () => {
        const rec = new MediaRecorder(recorderStream, { mimeType });
        const localChunks: Blob[] = [];
        const ctx = {
          rec,
          chunks: localChunks,
          startMs: Date.now(),
          offsetSec: cumulativeAudioSecRef.current,
        };
        rec.ondataavailable = (event) => {
          if (event.data.size > 0) localChunks.push(event.data);
        };
        // Start the next recorder before network processing so speech capture
        // never waits for CUDA or a cloud provider.
        rec.onstop = () => {
          const durationSec = (Date.now() - ctx.startMs) / 1000;
          cumulativeAudioSecRef.current += durationSec;
          if (isListeningRef.current && !isPausedRef.current && currentGroqRecorderRef.current === ctx) {
            startStandaloneRecorder();
          }
          if (localChunks.length > 0) {
            enqueueChunk(new Blob(localChunks, { type: mimeType }), ctx.offsetSec);
          }
        };
        currentGroqRecorderRef.current = ctx;
        mediaRecorderRef.current = rec;
        rec.start();
      };
      startCloudRecorderRef.current = startStandaloneRecorder;
      startStandaloneRecorder();

      chunkIntervalRef.current = setInterval(() => {
        const ctx = currentGroqRecorderRef.current;
        if (ctx && ctx.rec.state === "recording") ctx.rec.stop();
      }, chunkSecRef.current * 1000);

      setInterimText("מאזין...");
      isListeningRef.current = true;
      setIsListening(true);
    } catch (err) {
      console.error("Microphone access error:", err);
      toast({ title: "גישה למיקרופון נדחתה", description: "אנא אפשר גישה למיקרופון בהגדרות הדפדפן", variant: "destructive" });
    }
  }, [enqueueChunk, mode]);

  const stopCudaCleanup = useCallback(() => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    gainNodeRef.current = null;
    processedStreamRef.current = null;
    audioLevelRef.current = 0;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      // Override any pending onstop to avoid auto-restart or stray sends
      try { mediaRecorderRef.current.onstop = null as any; } catch { /* noop */ }
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (archiveRecorderRef.current && archiveRecorderRef.current.state !== "inactive") {
      try { archiveRecorderRef.current.stop(); } catch { /* noop */ }
    }
    archiveRecorderRef.current = null;
    currentGroqRecorderRef.current = null;
    startCloudRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // NOTE: allChunksRef is NOT cleared here — used to build audio file
    audioLevelSamplesRef.current = [];
    consecutiveErrorsRef.current = 0;
    isListeningRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsListening(false);
    setInterimText("");
    totalPausedMsRef.current = 0;
    pausedAtRef.current = 0;
  }, []);

  // ─── Pause / Resume for recorded live engines ───
  const pauseCuda = useCallback(() => {
    if (!isListeningRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);
    pausedAtRef.current = Date.now();
    // Stop sending new chunks
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    const ctx = currentGroqRecorderRef.current;
    if (ctx && ctx.rec.state === "recording") ctx.rec.stop();
    if (archiveRecorderRef.current?.state === "recording") archiveRecorderRef.current.pause();
    // Pause timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    // Stop audio level animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    setAudioLevel(0);
    setInterimText("מושהה ⏸");
    toast({ title: "⏸ תמלול מושהה", description: "לחץ המשך כדי לחזור להקלטה" });
  }, []);

  const resumeCuda = useCallback(() => {
    if (!isListeningRef.current || !isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
    // Track total paused time
    if (pausedAtRef.current > 0) {
      totalPausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
    }
    if (archiveRecorderRef.current?.state === "paused") archiveRecorderRef.current.resume();
    startCloudRecorderRef.current?.();
    // Restart timer
    timerIntervalRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current - totalPausedMsRef.current) / 1000));
    }, 1000);
    // Restart audio level monitoring
    if (analyserRef.current) {
      const analyser = analyserRef.current;
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        const avg = sum / dataArr.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(level);
        audioLevelRef.current = level;
        audioLevelSamplesRef.current.push(level);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    }
    // Restart chunk capture; queued processing continues independently.
    chunkIntervalRef.current = setInterval(() => {
      const ctx = currentGroqRecorderRef.current;
      if (ctx && ctx.rec.state === "recording") ctx.rec.stop();
    }, chunkSecRef.current * 1000);
    setInterimText("מאזין...");
    toast({ title: "▶ תמלול ממשיך" });
  }, []);

  // ─── Unified controls ───
  const startListening = useCallback(() => {
    if (isRecordedLiveMode(mode)) {
      startCuda();
    } else {
      startBrowser();
    }
  }, [mode, startCuda, startBrowser]);

  // Flush the active standalone live chunk, then wait for the whole queue.
  const flushCloudTail = useCallback(async (): Promise<void> => {
    const ctx = currentGroqRecorderRef.current;
    currentGroqRecorderRef.current = null;
    if (!ctx) return;
    if (ctx.rec.state === "inactive") return;
    await new Promise<void>((resolve) => {
      ctx.rec.onstop = async () => {
        const durationSec = (Date.now() - ctx.startMs) / 1000;
        cumulativeAudioSecRef.current += durationSec;
        if (ctx.chunks.length > 0 && durationSec >= 1) {
          const blob = new Blob(ctx.chunks, { type: mimeTypeRef.current });
          setInterimText("מתמלל את הסיום...");
          enqueueChunk(blob, ctx.offsetSec);
        }
        resolve();
      };
      try { ctx.rec.stop(); } catch { resolve(); }
    });
    await queueRef.current?.idle();
  }, [enqueueChunk]);

  const flushArchiveRecording = useCallback(async (): Promise<void> => {
    const recorder = archiveRecorderRef.current;
    archiveRecorderRef.current = null;
    if (!recorder || recorder.state === "inactive") return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try { recorder.stop(); } catch { resolve(); }
    });
  }, []);

  const stopListening = useCallback(async () => {
    if (isRecordedLiveMode(mode)) {
      // Stop the chunk timer first so no new cycles trigger during flush
      if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
      // Prevent auto-restart of groq recorder during flush
      isListeningRef.current = false;

      await flushCloudTail();
      await flushArchiveRecording();
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }

      // Build audio blob from all chunks BEFORE cleanup
      const mimeType = mimeTypeRef.current;
      const audioBlob = allChunksRef.current.length > 0
        ? new Blob(allChunksRef.current, { type: mimeType })
        : undefined;
      const duration = Math.floor((Date.now() - startTimeRef.current - totalPausedMsRef.current) / 1000);

      // Full re-transcribe path (toggle ON): the whole recording is sent as one
      // unit and REPLACES the chunked text. Falls back to chunked text on failure.
      // For CUDA, this also enables the existing refine pass.
      let merged = finalTextRef.current;
      if (geminiFinalPassRef.current && audioBlob) {
        const geminiText = await runGeminiFinalPass(audioBlob);
        if (geminiText) {
          merged = geminiText;
          wordTimingsRef.current = [];
          setFinalText(geminiText);
        }
      } else {
        const doFullRetranscribe = fullRetranscribeRef.current && (mode === "cuda" || mode === "groq");
        if (doFullRetranscribe || mode === "cuda") {
        const prevTimings = [...wordTimingsRef.current];
        wordTimingsRef.current = [];
        const refinedText = mode === "groq"
          ? await runGroqFullRetranscribe()
          : await runFinalRefinePass();
        if (!refinedText && wordTimingsRef.current.length === 0) {
          wordTimingsRef.current = prevTimings;
        }
        const currentFinalText = finalTextRef.current;
        if (refinedText) {
          // When the user explicitly asked for full re-transcribe, replace.
          // Otherwise (legacy CUDA refine), keep the prior heuristic.
          merged = fullRetranscribeRef.current
            ? refinedText
            : (refinedText.length >= Math.max(20, Math.floor(currentFinalText.length * 0.8))
              ? refinedText
              : appendDedupText(currentFinalText, refinedText));
          setFinalText(merged);
        } else {
          merged = currentFinalText;
        }
        }
      }
      stopCudaCleanup();
      queueRef.current?.stop();
      queueRef.current = null;
      allChunksRef.current = [];
      if (merged.trim()) {
        onTranscriptComplete({
          text: merged.trim(),
          engine: mode,
          engineLabel: LIVE_ENGINE_LABELS[mode],
          audioBlob,
          wordTimings: wordTimingsRef.current.length > 0 ? wordTimingsRef.current : undefined,
          folder: selectedFolder || undefined,
          durationSec: duration,
          fileName: fileName.trim() || undefined,
          format: saveFormat,
          language: sourceLanguage === "auto" ? detectedLanguageRef.current : sourceLanguage,
        });
      }
    } else {
      stopBrowser();
      const currentText = finalTextRef.current;
      if (currentText.trim()) {
        onTranscriptComplete({
          text: currentText.trim(),
          engine: mode,
          engineLabel: LIVE_ENGINE_LABELS[mode],
          folder: selectedFolder || undefined,
          fileName: fileName.trim() || undefined,
          format: saveFormat,
          language: sourceLanguage === "auto" ? undefined : sourceLanguage,
        });
      }
    }
  }, [appendDedupText, fileName, mode, saveFormat, selectedFolder, onTranscriptComplete, runFinalRefinePass, runGroqFullRetranscribe, runGeminiFinalPass, stopCudaCleanup, stopBrowser, flushCloudTail, flushArchiveRecording, sourceLanguage]);

  const handleCopy = () => {
    navigator.clipboard.writeText(finalText);
    toast({ title: "הועתק ללוח" });
  };

  const handleClear = () => {
    setFinalText("");
    setInterimText("");
    wordTimingsRef.current = [];
  };

  // Cancel recording — discard everything, do not save
  const handleCancel = useCallback(() => {
    if (isRecordedLiveMode(mode)) {
      isListeningRef.current = false;
      if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      if (archiveRecorderRef.current && archiveRecorderRef.current.state !== "inactive") {
        archiveRecorderRef.current.ondataavailable = null;
        archiveRecorderRef.current.stop();
      }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
      allChunksRef.current = [];
      queueRef.current?.stop();
      queueRef.current = null;
      stopCudaCleanup();
    } else {
      stopBrowser();
    }
    setFinalText("");
    setInterimText("");
    setIsRefining(false);
    wordTimingsRef.current = [];
    toast({ title: "❌ התמלול בוטל" });
  }, [mode, stopCudaCleanup, stopBrowser]);

  // Save current transcription without stopping
  const handleSaveIntermediate = () => {
    if (!finalText.trim()) return;
    onTranscriptComplete({
      text: finalText.trim(),
      engine: mode,
      engineLabel: LIVE_ENGINE_LABELS[mode],
      folder: selectedFolder || undefined,
      fileName: fileName.trim() || undefined,
      format: saveFormat,
      language: sourceLanguage === "auto" ? detectedLanguageRef.current : sourceLanguage,
    });
    toast({ title: "✅ תמלול נשמר", description: "ניתן להמשיך להקליט" });
  };

  // Download audio recording locally
  const handleDownloadAudio = () => {
    if (allChunksRef.current.length === 0) {
      toast({ title: "אין הקלטה לשמירה", variant: "destructive" });
      return;
    }
    const blob = new Blob(allChunksRef.current, { type: mimeTypeRef.current });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `live-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "✅ הקלטה הורדה" });
  };

  const handleAddFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (customFolders.includes(name)) {
      toast({ title: "תיקייה כבר קיימת", variant: "destructive" });
      return;
    }
    const updated = [...customFolders, name];
    setCustomFolders(updated);
    localStorage.setItem('local_folders', JSON.stringify(updated));
    setSelectedFolder(name);
    setNewFolderName("");
    setShowNewFolder(false);
    toast({ title: `📁 תיקייה "${name}" נוצרה` });
  };

  const browserSupported = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  // Keyboard shortcut: Space to start/stop (when not typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        if (isListening) {
          stopListening();
        } else {
          startListening();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isListening, startListening, stopListening]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const avgLatency = stats.chunksProcessed > 0
    ? Math.round(stats.totalLatencyMs / stats.chunksProcessed)
    : 0;

  const hasLiveEngineKey = (engine: LiveMode) => {
    if (engine === "browser") return browserSupported;
    if (engine === "cuda") return !!serverConnected;
    const keyMap = {
      groq: [apiKeys.groq_key, apiKeys.groq_keys_pool],
      openai: [apiKeys.openai_key, apiKeys.openai_keys_pool],
      deepgram: [apiKeys.deepgram_key, apiKeys.deepgram_keys_pool],
      assemblyai: [apiKeys.assemblyai_key, apiKeys.assemblyai_keys_pool],
      google: [apiKeys.google_key, apiKeys.google_keys_pool],
    } as const;
    const [single, pool] = keyMap[engine];
    return Boolean(single || pool?.some(Boolean));
  };

  if (!isSupported && !serverConnected) {
    return (
      <Card className="p-6" dir="rtl">
        <div className="text-center text-muted-foreground">
          <p>הדפדפן שלך לא תומך בתמלול בזמן אמת.</p>
          <p className="text-sm mt-1">נסה להשתמש ב-Google Chrome או הפעל את שרת CUDA.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radio className={`w-5 h-5 ${isListening && !isPaused ? 'text-red-500 animate-pulse' : isPaused ? 'text-yellow-500' : 'text-primary'}`} />
          <h3 className="text-lg font-semibold">תמלול בזמן אמת</h3>
          {isListening && !isPaused && (
            <Badge variant="destructive" className="animate-pulse text-xs gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive-foreground" />
              מאזין
            </Badge>
          )}
          {isPaused && (
            <Badge variant="secondary" className="text-xs gap-1 bg-yellow-100 text-yellow-800">
              <Pause className="w-3 h-3" />
              מושהה
            </Badge>
          )}
          {isRefining && (
            <Badge variant="secondary" className="animate-pulse text-xs gap-1">
              <Zap className="w-3 h-3" />
              משפר דיוק...
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Timer */}
          {isListening && isRecordedLiveMode(mode) && (
            <Badge variant="outline" className="text-xs gap-1 font-mono">
              <Clock className="w-3 h-3" />
              {formatTime(elapsedSec)}
            </Badge>
          )}
          {finalText && (
            <>
              <Button variant="ghost" size="sm" onClick={handleSaveIntermediate} title="שמור תמלול נוכחי">
                <Save className="w-4 h-4" />
              </Button>
              {isListening && isRecordedLiveMode(mode) && (
                <Button variant="ghost" size="sm" onClick={handleDownloadAudio} title="הורד הקלטה">
                  <Download className="w-4 h-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleCopy} title="העתק">
                <Copy className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClear} title="נקה">
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Audio level and loss-accounting stats for recorded engines. */}
      {isListening && isRecordedLiveMode(mode) && !isPaused && (
        <div className="mb-3 space-y-2">
          {/* Waveform-style VU meter */}
          <div className="flex items-center gap-2">
            <Volume2 className={`w-4 h-4 shrink-0 ${audioLevel > 2 ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}`} />
            <div className="flex-1 h-3 bg-muted/50 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${Math.min(100, audioLevel)}%`,
                  background: audioLevel > 70 ? '#ef4444' : audioLevel > 40 ? '#f59e0b' : '#22c55e',
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-mono w-8 text-left">{audioLevel}%</span>
          </div>
          {/* Live stats bar */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>נקלטו: {stats.chunksCaptured}</span>
            <span>עובדו: {stats.chunksProcessed + stats.silenceSkips}</span>
            {stats.chunksQueued > 0 && <span className="text-yellow-700">בתור: {stats.chunksQueued}</span>}
            {stats.chunksDropped > 0 && <span className="text-destructive">נכשלו: {stats.chunksDropped}</span>}
            <span>מילים: {stats.wordsTranscribed}</span>
            {avgLatency > 0 && <span>השהיה: {avgLatency}ms</span>}
            {stats.silenceSkips > 0 && <span>שקט: {stats.silenceSkips}</span>}
            {stats.errorsCount > 0 && (
              <span className="text-orange-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                שגיאות: {stats.errorsCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Mode selector + Folder selector */}
      {!isListening && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 justify-center flex-wrap">
            {mode === "cuda" ? <Cpu className="w-4 h-4 text-primary" /> : mode === "browser" ? <Globe className="w-4 h-4 text-primary" /> : <Zap className="w-4 h-4 text-primary" />}
            <Label htmlFor="live-engine">מנוע חי</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as LiveMode)}>
              <SelectTrigger id="live-engine" className="w-[240px]" aria-label="מנוע תמלול חי">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {(["cuda", "groq", "deepgram", "openai", "assemblyai", "google", "browser"] as LiveMode[]).map((engine) => (
                  <SelectItem key={engine} value={engine} disabled={!hasLiveEngineKey(engine)}>
                    {LIVE_ENGINE_LABELS[engine]}{!hasLiveEngineKey(engine) ? " — לא מוגדר" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline">{isCloudLiveMode(mode) ? "ענן · מקטעים רציפים" : mode === "cuda" ? "מקומי · GPU" : "דפדפן"}</Badge>
          </div>

          {isRecordedLiveMode(mode) && (
            <div className="flex items-center gap-3 justify-center px-2">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">גודל צ'אנק</span>
              <Slider
                min={2}
                max={60}
                step={1}
                value={[chunkSec]}
                onValueChange={([v]) => setChunkSec(v)}
                className="w-[140px]"
              />
              <span className="text-xs font-mono text-muted-foreground w-12">{chunkSec}s</span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {chunkSec <= 3 ? <><Zap className="inline w-3 h-3 text-[#0f1e43]" /> מהיר</> : chunkSec >= 20 ? <><Trophy className="inline w-3 h-3 text-[#0f1e43]" /> איכות מקסימלית</> : chunkSec >= 8 ? <><Target className="inline w-3 h-3 text-[#0f1e43]" /> מדויק</> : 'מאוזן'}
              </span>
            </div>
          )}

          {/* Full re-transcribe toggle — applies to CUDA & Groq */}
          {(mode === "cuda" || mode === "groq") && (
            <div className="flex items-center justify-center gap-3 px-2">
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-1.5">
                <RefreshCw className={`w-4 h-4 ${fullRetranscribe ? 'text-yellow-600' : 'text-muted-foreground'}`} />
                <Label htmlFor="full-retranscribe" className="text-xs cursor-pointer select-none">
                  תמלול מחדש מלא בשמירה
                </Label>
                <Switch
                  id="full-retranscribe"
                  checked={fullRetranscribe}
                  onCheckedChange={setFullRetranscribe}
                  disabled={geminiFinalPass}
                  className="data-[state=checked]:bg-yellow-500"
                />
              </div>
              <span className="text-[10px] text-muted-foreground max-w-[220px] leading-tight">
                {fullRetranscribe
                  ? 'הצ׳אנקים הם רק תצוגה מקדימה. בלחיצה על שמור — כל ההקלטה תתמלל מחדש כיחידה אחת.'
                  : 'הטקסט שנצבר בצ׳אנקים יישמר כמו שהוא.'}
              </span>
            </div>
          )}

          {isRecordedLiveMode(mode) && (
            <div className="flex items-center justify-center gap-3 px-2">
              <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-1.5">
                <Zap className={`w-4 h-4 ${geminiFinalPass ? "text-green-600" : "text-muted-foreground"}`} />
                <Label htmlFor="gemini-final-pass" className="text-xs cursor-pointer select-none">
                  תמלול סופי מלא עם Gemini
                </Label>
                <Switch
                  id="gemini-final-pass"
                  checked={geminiFinalPass}
                  onCheckedChange={setGeminiFinalPass}
                  className="data-[state=checked]:bg-green-600"
                />
              </div>
              <span className="text-[10px] text-muted-foreground max-w-[220px] leading-tight">
                לאחר העצירה Gemini יקבל את כל ההקלטה ויחליף את תצוגת המקטעים. כרוך בשימוש API.
              </span>
            </div>
          )}



          {/* File name + format selector */}
          <div className="flex items-center gap-2 justify-center flex-wrap">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder="שם הקובץ (אופציונלי)..."
              className="h-8 w-[190px] text-sm"
              dir="rtl"
            />
            <Select value={saveFormat} onValueChange={v => setSaveFormat(v as SaveFormat)}>
              <SelectTrigger className="h-8 w-[82px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAVE_FORMATS.map(f => (
                  <SelectItem key={f} value={f} className="text-xs">.{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Folder selector */}
          <div className="flex items-center gap-2 justify-center">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            <Select value={selectedFolder || "__none__"} onValueChange={v => setSelectedFolder(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-[180px] h-8 text-sm">
                <SelectValue placeholder="בחר תיקייה..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">ללא תיקייה</SelectItem>
                {customFolders.map(f => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!showNewFolder ? (
              <Button variant="ghost" size="sm" onClick={() => setShowNewFolder(true)} title="תיקייה חדשה">
                <FolderPlus className="w-4 h-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <Input
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="שם תיקייה..."
                  className="h-8 w-[120px] text-sm"
                  onKeyDown={e => e.key === 'Enter' && handleAddFolder()}
                  autoFocus
                />
                <Button variant="ghost" size="sm" onClick={handleAddFolder}>✓</Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}>✕</Button>
              </div>
            )}
          </div>

          {isRecordedLiveMode(mode) && (
            <div className="flex items-center gap-3 justify-center px-2">
              <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">רגישות מיקרופון</span>
              <Slider
                min={1}
                max={4}
                step={0.5}
                value={[micGain]}
                onValueChange={([v]) => setMicGain(v)}
                className="w-[130px]"
              />
              <span className="text-xs font-mono text-muted-foreground w-8">{micGain}x</span>
            </div>
          )}
        </div>
      )}

      {/* Live text display */}
      <ScrollArea className="h-[220px] mb-4 rounded-md border p-4 bg-muted/30" ref={scrollRef}>
        <div className="text-right whitespace-pre-wrap leading-relaxed text-base">
          {finalText && <span>{finalText}</span>}
          {interimText && (
            <span className="text-muted-foreground opacity-60"> {interimText}</span>
          )}
          {!finalText && !interimText && !isListening && (
            <p className="text-muted-foreground text-center">
              לחץ על הכפתור כדי להתחיל תמלול בזמן אמת
              <br />
              <span className="text-xs opacity-60">או לחץ רווח (Space)</span>
            </p>
          )}
          {!finalText && !interimText && isListening && (
            <p className="text-muted-foreground text-center animate-pulse">מחכה לדיבור...</p>
          )}
        </div>
      </ScrollArea>

      {/* Compact save settings strip — shown during recording */}
      {isListening && (
        <div className="flex items-center justify-center gap-2 mb-3 text-xs flex-wrap">
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>{fileName.trim() || 'שם אוטומטי'}</span>
          </div>
          <Badge variant="outline" className="text-[11px] py-0 h-5 px-1.5">.{saveFormat}</Badge>
          {selectedFolder && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{selectedFolder}</span>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        {!isListening ? (
          <Button onClick={startListening} className="gap-2 rounded-full px-8 h-12 text-base" disabled={isRefining || !hasLiveEngineKey(mode)}>
            <Mic className="w-5 h-5" />
            התחל תמלול חי
          </Button>
        ) : (
          <>
            {isRecordedLiveMode(mode) && !isPaused && (
              <Button onClick={pauseCuda} variant="outline" className="gap-2 rounded-full px-6 h-12 text-base border-yellow-400 text-yellow-700 hover:bg-yellow-50">
                <Pause className="w-5 h-5" />
                השהה
              </Button>
            )}
            {isRecordedLiveMode(mode) && isPaused && (
              <Button onClick={resumeCuda} variant="outline" className="gap-2 rounded-full px-6 h-12 text-base border-green-400 text-green-700 hover:bg-green-50">
                <Play className="w-5 h-5" />
                המשך
              </Button>
            )}
            <Button onClick={handleCancel} variant="outline" className="gap-2 rounded-full px-5 h-12 text-base text-muted-foreground hover:text-destructive hover:border-destructive">
              <X className="w-5 h-5" />
              בטל
            </Button>
            <Button onClick={stopListening} variant="destructive" className="gap-2 rounded-full px-8 h-12 text-base">
              <Square className="w-5 h-5" />
              עצור ושמור
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-3">
        {mode === "browser"
          ? "Web Speech API — עובד ישירות בדפדפן, ללא מפתח API"
          : `${LIVE_ENGINE_LABELS[mode]} — הקלטה רציפה, עיבוד בתור כל ${chunkSec}s${mode === "cuda" ? " + שיפור סופי בעצירה" : ""}`}
      </p>
    </Card>
  );
};
