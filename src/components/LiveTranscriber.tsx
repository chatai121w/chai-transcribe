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
  X, FileText
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getServerUrl } from "@/lib/serverConfig";
import { supabase } from "@/integrations/supabase/client";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";

type LiveMode = "browser" | "cuda" | "groq";

const DEFAULT_CHUNK_SEC = 5;
const LIVE_RECORDING_TIMESLICE_MS = 150;
const LIVE_MIN_BLOB_BYTES = 800;
const SILENCE_THRESHOLD = 2;          // Skip chunks below this audio level (averaged over chunk window) — lowered so quiet mics still register speech
const LIVE_CONTEXT_WORDS = 10;        // Last N words carried as context into next chunk (initial_prompt)
const MAX_CONSECUTIVE_ERRORS = 5;
const SEND_TIMEOUT_MS = 90000;        // 90s timeout — allows for long chunks (up to 60s) at high quality

interface LiveStats {
  chunksProcessed: number;
  totalLatencyMs: number;
  wordsTranscribed: number;
  errorsCount: number;
  silenceSkips: number;
}

const SAVE_FORMATS = ['txt', 'docx', 'srt', 'json', 'vtt'] as const;
type SaveFormat = typeof SAVE_FORMATS[number];

export interface LiveTranscriptResult {
  text: string;
  audioBlob?: Blob;
  wordTimings?: Array<{word: string; start: number; end: number; probability?: number}>;
  folder?: string;
  durationSec?: number;
  fileName?: string;
  format?: string;
}

interface LiveTranscriberProps {
  onTranscriptComplete: (result: LiveTranscriptResult) => void;
  serverConnected?: boolean;
}

export const LiveTranscriber = ({ onTranscriptComplete, serverConnected }: LiveTranscriberProps) => {
  const { keys: apiKeys } = useCloudApiKeys();
  const { preferences, updatePreference, isLoaded: prefsLoaded } = useCloudPreferences();
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [mode, setMode] = useState<LiveMode>(serverConnected ? "cuda" : "groq");
  const chunkSec = preferences.live_chunk_sec ?? DEFAULT_CHUNK_SEC;
  const setChunkSec = useCallback((v: number) => updatePreference('live_chunk_sec', v), [updatePreference]);
  const chunkSecRef = useRef<number>(DEFAULT_CHUNK_SEC);
  useEffect(() => { chunkSecRef.current = chunkSec; }, [chunkSec]);
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
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const allChunksRef = useRef<Blob[]>([]);
  const headerChunkRef = useRef<Blob | null>(null);
  const processingRef = useRef(false);
  const gpuBusyToastAtRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);
  const pendingRetryRef = useRef<Blob | null>(null);
  const audioLevelSamplesRef = useRef<number[]>([]);
  const finalTextRef = useRef("");

  // Groq word-timestamp accumulation
  const cumulativeAudioSecRef = useRef(0);
  const currentGroqRecorderRef = useRef<{
    rec: MediaRecorder;
    chunks: Blob[];
    startMs: number;
    offsetSec: number;
  } | null>(null);

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
    chunksProcessed: 0, totalLatencyMs: 0, wordsTranscribed: 0, errorsCount: 0, silenceSkips: 0,
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
      stopCudaCleanup();
    };
  }, []);

  // Switch mode when server connection changes
  useEffect(() => {
    if (serverConnected && !isListening) {
      setMode("cuda");
    }
  }, [serverConnected, isListening]);

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
    recognition.lang = "he-IL";

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

  const sendChunk = useCallback(async (blob: Blob, offsetSec: number = 0) => {
    if (blob.size < LIVE_MIN_BLOB_BYTES || processingRef.current) return;

    // Client-side silence skip — use averaged audio level over chunk window
    const avgLevel = audioLevelSamplesRef.current.length > 0
      ? audioLevelSamplesRef.current.reduce((a, b) => a + b, 0) / audioLevelSamplesRef.current.length
      : audioLevelRef.current;
    audioLevelSamplesRef.current = []; // reset for next chunk window
    if (avgLevel < SILENCE_THRESHOLD) {
      setStats(prev => ({ ...prev, silenceSkips: prev.silenceSkips + 1 }));
      setInterimText("שקט — ממתין לדיבור...");
      return;
    }

    processingRef.current = true;
    setInterimText("מעבד...");
    const sendStart = performance.now();
    try {
      const formData = new FormData();
      formData.append("file", blob, "chunk.webm");
      formData.append("language", "he");
      // Carry last N words of previous transcript as context (initial_prompt on server)
      const prevWords = finalTextRef.current.trim().split(/\s+/).filter(Boolean);
      if (prevWords.length > 0) {
        formData.append("context", prevWords.slice(-LIVE_CONTEXT_WORDS).join(" "));
      }

      let status = 0;
      let data: any = null;
      let ok = false;

      if (mode === "groq") {
        // Pick a Groq key — pool first, then single key
        const pool = apiKeys.groq_keys_pool?.filter(Boolean) || [];
        const groqKey = pool.length > 0
          ? pool[Math.floor(Math.random() * pool.length)]
          : apiKeys.groq_key;
        if (!groqKey) {
          toast({
            title: "חסר מפתח Groq",
            description: "הוסף מפתח Groq בהגדרות → API Keys",
            variant: "destructive",
          });
          setInterimText("חסר מפתח Groq — בדוק הגדרות");
          consecutiveErrorsRef.current = MAX_CONSECUTIVE_ERRORS;
          return;
        }
        formData.append("apiKey", groqKey);
        // Highest-quality model for live: prefer whisper-large-v3 when chunks are large enough
        // (turbo is faster but slightly lower accuracy). For chunks ≥6s we have headroom for quality.
        formData.append("model", chunkSecRef.current >= 6 ? "whisper-large-v3" : "whisper-large-v3-turbo");
        // Groq via edge function — chunked near-live transcription
        const { data: gd, error: gerr } = await supabase.functions.invoke('transcribe-groq', {
          body: formData,
        });
        if (gerr) {
          // 429 from Groq surfaces as error; treat as rate limited
          const msg = String(gerr.message || gerr);
          if (msg.includes('429') || /rate/i.test(msg)) {
            pendingRetryRef.current = blob;
            const now = Date.now();
            if (now - gpuBusyToastAtRef.current > 4000) {
              gpuBusyToastAtRef.current = now;
              toast({ title: "Groq עסוק", description: "ממתין ומנסה שוב" });
            }
            setInterimText("Groq rate limit — ממתין...");
            return;
          }
          throw new Error(msg);
        }
        data = gd;
        ok = true;
      } else {
        const res = await fetch(`${getBaseUrl()}/transcribe-live`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        status = res.status;
        ok = res.ok;
        if (status === 429) {
          pendingRetryRef.current = blob;
          const now = Date.now();
          if (now - gpuBusyToastAtRef.current > 4000) {
            gpuBusyToastAtRef.current = now;
            toast({ title: "GPU עסוק", description: "ממשיך אוטומטית כשהשרת יתפנה" });
          }
          setInterimText("GPU עסוק — ממתין...");
          return;
        }
        if (status === 500) {
          consecutiveErrorsRef.current++;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
            toast({ title: "שגיאות חוזרות", description: "מנותק מהשרת — בדוק את שרת CUDA", variant: "destructive" });
            setInterimText("שגיאה — שרת לא מגיב");
            return;
          }
          pendingRetryRef.current = blob;
          setStats(prev => ({ ...prev, errorsCount: prev.errorsCount + 1 }));
          return;
        }
        if (ok) data = await res.json();
      }

      if (ok && data) {
        consecutiveErrorsRef.current = 0;
        pendingRetryRef.current = null; // clear any pending retry on success
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
      }
    } catch (err) {
      console.error("Live chunk error:", err);
      consecutiveErrorsRef.current++;
      pendingRetryRef.current = blob; // save for retry instead of unshift
      setStats(prev => ({ ...prev, errorsCount: prev.errorsCount + 1 }));
      if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        setInterimText("שרת לא מגיב — בדוק חיבור");
      }
    } finally {
      processingRef.current = false;
    }
  }, [appendDedupText, mode, apiKeys.groq_key, apiKeys.groq_keys_pool]);

  const runFinalRefinePass = useCallback(async (): Promise<string | null> => {
    if (allChunksRef.current.length === 0) return null;
    setIsRefining(true);
    setInterimText("משפר דיוק — refine pass...");
    try {
      const mimeType = mimeTypeRef.current;
      const fullBlob = new Blob(allChunksRef.current, { type: mimeType });

      const formData = new FormData();
      formData.append("file", fullBlob, "live-final.webm");
      formData.append("language", "he");
      formData.append("final", "1");

      const res = await fetch(`${getBaseUrl()}/transcribe-live`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) return null;
      const data = await res.json();
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
  }, []);

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
      setStats({ chunksProcessed: 0, totalLatencyMs: 0, wordsTranscribed: 0, errorsCount: 0, silenceSkips: 0 });

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

      if (mode === "groq") {
        // Groq requires a complete, standalone media file per request.
        // Each chunk = its own standalone webm recording. We track per-chunk
        // start time and cumulative offset to shift word timestamps correctly,
        // and expose the active recorder so stopListening can flush the tail.
        cumulativeAudioSecRef.current = 0;
        wordTimingsRef.current = [];

        const startGroqRecorder = () => {
          const rec = new MediaRecorder(recorderStream, { mimeType });
          const localChunks: Blob[] = [];
          const ctx = {
            rec,
            chunks: localChunks,
            startMs: Date.now(),
            offsetSec: cumulativeAudioSecRef.current,
          };
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) localChunks.push(e.data);
          };
          // Default onstop: auto-cycle; overridden by cycleGroqRecorder / flush.
          rec.onstop = async () => {
            const durationSec = (Date.now() - ctx.startMs) / 1000;
            cumulativeAudioSecRef.current += durationSec;
            if (localChunks.length > 0) {
              const blob = new Blob(localChunks, { type: mimeType });
              allChunksRef.current.push(blob);
              await sendChunk(blob, ctx.offsetSec);
            }
            if (isListeningRef.current && !isPausedRef.current && currentGroqRecorderRef.current === ctx) {
              startGroqRecorder();
            }
          };
          currentGroqRecorderRef.current = ctx;
          mediaRecorderRef.current = rec;
          rec.start();
        };
        startGroqRecorder();

        chunkIntervalRef.current = setInterval(() => {
          const ctx = currentGroqRecorderRef.current;
          if (ctx && ctx.rec.state === "recording") ctx.rec.stop();
        }, chunkSecRef.current * 1000);
      } else {
        const recorder = new MediaRecorder(recorderStream, { mimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            if (!headerChunkRef.current) {
              headerChunkRef.current = e.data;
              allChunksRef.current.push(e.data);
              return;
            }
            chunksRef.current.push(e.data);
            allChunksRef.current.push(e.data);
          }
        };

        recorder.start(LIVE_RECORDING_TIMESLICE_MS);

        chunkIntervalRef.current = setInterval(() => {
          if (processingRef.current) return;
          if (pendingRetryRef.current) {
            const retryBlob = pendingRetryRef.current;
            pendingRetryRef.current = null;
            sendChunk(retryBlob);
            return;
          }
          if (chunksRef.current.length > 0) {
            const parts: Blob[] = [];
            if (headerChunkRef.current) parts.push(headerChunkRef.current);
            parts.push(...chunksRef.current);
            const blob = new Blob(parts, { type: mimeType });
            chunksRef.current = [];
            sendChunk(blob);
          }
        }, chunkSecRef.current * 1000);
      }

      setInterimText("מאזין...");
      isListeningRef.current = true;
      setIsListening(true);
    } catch (err) {
      console.error("Microphone access error:", err);
      toast({ title: "גישה למיקרופון נדחתה", description: "אנא אפשר גישה למיקרופון בהגדרות הדפדפן", variant: "destructive" });
    }
  }, [sendChunk, mode]);

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
    currentGroqRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    // NOTE: allChunksRef is NOT cleared here — used to build audio file
    headerChunkRef.current = null;
    processingRef.current = false;
    pendingRetryRef.current = null;
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

  // ─── Pause / Resume (CUDA only) ───
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
    // Pause MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
    }
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
    // Resume MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
    }
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
    // Restart chunk sending
    const mimeType = mimeTypeRef.current;
    chunkIntervalRef.current = setInterval(() => {
      if (processingRef.current) return;
      if (pendingRetryRef.current) {
        const retryBlob = pendingRetryRef.current;
        pendingRetryRef.current = null;
        sendChunk(retryBlob);
        return;
      }
      if (chunksRef.current.length > 0) {
        const parts: Blob[] = [];
        if (headerChunkRef.current) {
          parts.push(headerChunkRef.current);
        }
        parts.push(...chunksRef.current);
        const blob = new Blob(parts, { type: mimeType });
        chunksRef.current = [];
        sendChunk(blob);
      }
    }, chunkSecRef.current * 1000);
    setInterimText("מאזין...");
    toast({ title: "▶ תמלול ממשיך" });
  }, [sendChunk]);

  // ─── Unified controls ───
  const startListening = useCallback(() => {
    if (mode === "cuda" || mode === "groq") {
      startCuda();
    } else {
      startBrowser();
    }
  }, [mode, startCuda, startBrowser]);

  // Flush the in-flight Groq recorder: stop it, transcribe the tail (if >=1s),
  // and resolve once the final sendChunk completes. No auto-cycle.
  const flushGroqTail = useCallback(async (): Promise<void> => {
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
          allChunksRef.current.push(blob);
          setInterimText("מתמלל את הסיום...");
          try { await sendChunk(blob, ctx.offsetSec); } catch { /* swallow */ }
        }
        resolve();
      };
      try { ctx.rec.stop(); } catch { resolve(); }
    });
  }, [sendChunk]);

  const stopListening = useCallback(async () => {
    if (mode === "cuda" || mode === "groq") {
      // Stop the chunk timer first so no new cycles trigger during flush
      if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
      // Prevent auto-restart of groq recorder during flush
      isListeningRef.current = false;

      if (mode === "groq") {
        await flushGroqTail();
      } else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }

      // Build audio blob from all chunks BEFORE cleanup
      const mimeType = mimeTypeRef.current;
      const audioBlob = allChunksRef.current.length > 0
        ? new Blob(allChunksRef.current, { type: mimeType })
        : undefined;
      const duration = Math.floor((Date.now() - startTimeRef.current - totalPausedMsRef.current) / 1000);

      // Refine pass only available for CUDA (local server). Groq uses accumulated text as-is.
      let merged = finalTextRef.current;
      if (mode === "cuda") {
        const prevTimings = [...wordTimingsRef.current];
        wordTimingsRef.current = [];
        const refinedText = await runFinalRefinePass();
        if (!refinedText && wordTimingsRef.current.length === 0) {
          wordTimingsRef.current = prevTimings;
        }
        const currentFinalText = finalTextRef.current;
        merged = refinedText
          ? (refinedText.length >= Math.max(20, Math.floor(currentFinalText.length * 0.8))
            ? refinedText
            : appendDedupText(currentFinalText, refinedText))
          : currentFinalText;
        if (refinedText) {
          setFinalText(merged);
        }
      }
      stopCudaCleanup();
      allChunksRef.current = [];
      if (merged.trim()) {
        onTranscriptComplete({
          text: merged.trim(),
          audioBlob,
          wordTimings: wordTimingsRef.current.length > 0 ? wordTimingsRef.current : undefined,
          folder: selectedFolder || undefined,
          durationSec: duration,
          fileName: fileName.trim() || undefined,
          format: saveFormat,
        });
      }
    } else {
      stopBrowser();
      const currentText = finalTextRef.current;
      if (currentText.trim()) {
        onTranscriptComplete({
          text: currentText.trim(),
          folder: selectedFolder || undefined,
          fileName: fileName.trim() || undefined,
          format: saveFormat,
        });
      }
    }
  }, [appendDedupText, fileName, mode, saveFormat, selectedFolder, onTranscriptComplete, runFinalRefinePass, stopCudaCleanup, stopBrowser, flushGroqTail]);

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
    if ((mode === "cuda" || mode === "groq")) {
      if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
      allChunksRef.current = [];
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
      folder: selectedFolder || undefined,
      fileName: fileName.trim() || undefined,
      format: saveFormat,
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
          {isListening && (mode === "cuda" || mode === "groq") && (
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
              {isListening && (mode === "cuda" || mode === "groq") && (
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

      {/* Audio Level Bar + Stats (CUDA only, while listening & not paused) */}
      {isListening && (mode === "cuda" || mode === "groq") && !isPaused && (
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
            <span>חלקים: {stats.chunksProcessed}</span>
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
          <div className="flex gap-2 justify-center">
            {browserSupported && (
              <Button
                variant={mode === "browser" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("browser")}
              >
                <Globe className="w-4 h-4 ml-1" />
                Web Speech
              </Button>
            )}
            <Button
              variant={mode === "cuda" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("cuda")}
              disabled={!serverConnected}
              title={!serverConnected ? "שרת CUDA לא מחובר" : "תמלול עם Whisper GPU"}
            >
              <Cpu className="w-4 h-4 ml-1" />
              CUDA Whisper
            </Button>
            <Button
              variant={mode === "groq" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("groq")}
              title="Groq Whisper בענן — לא דורש שרת מקומי"
            >
              <Zap className="w-4 h-4 ml-1" />
              Groq
            </Button>
          </div>

          {/* Chunk size — applies to CUDA & Groq */}
          {(mode === "cuda" || mode === "groq") && (
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
                {chunkSec <= 3 ? '⚡ מהיר' : chunkSec >= 20 ? '🏆 איכות מקסימלית' : chunkSec >= 8 ? '🎯 מדויק' : 'מאוזן'}
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

          {/* Mic sensitivity (gain) — only relevant for CUDA mode */}
          {(mode === "cuda" || mode === "groq") && (
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
          <Button onClick={startListening} className="gap-2 rounded-full px-8 h-12 text-base" disabled={isRefining}>
            <Mic className="w-5 h-5" />
            התחל תמלול חי
          </Button>
        ) : (
          <>
            {/* Pause / Resume (CUDA only) */}
            {(mode === "cuda" || mode === "groq") && !isPaused && (
              <Button onClick={pauseCuda} variant="outline" className="gap-2 rounded-full px-6 h-12 text-base border-yellow-400 text-yellow-700 hover:bg-yellow-50">
                <Pause className="w-5 h-5" />
                השהה
              </Button>
            )}
            {(mode === "cuda" || mode === "groq") && isPaused && (
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
        {mode === "cuda"
          ? `Whisper + GPU — chunks כל ${chunkSec}s + refine בעצירה | השהה/המשך | שמירת הקלטה`
          : mode === "groq"
          ? `Groq Whisper בענן — chunks כל ${chunkSec}s | חכם וזריז`
          : "Web Speech API — עובד ישירות בדפדפן, ללא מפתח API"
        }
      </p>
    </Card>
  );
};
