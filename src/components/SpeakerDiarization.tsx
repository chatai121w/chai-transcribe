import { useState, useRef, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Users, Upload, Loader2, Copy, Download, BarChart3, Clock, MessageSquare, Mic, Pencil, Check, X, Subtitles, Cloud, Server, Save, FolderOpen, Search, Merge, Globe, ArrowLeftRight, FileText, Play, Square, Pause, Tag, RefreshCw, Zap, Music, Sparkles, BookmarkPlus, Share2, FileDown, AlertTriangle, Maximize2, GitCompareArrows, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { diarizeInBrowser, type DiarizationProgress } from "@/utils/browserDiarization";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";
import { DiarizationCompare } from "@/components/DiarizationCompare";
import { useDiarizationJobs } from "@/hooks/useDiarizationJobs";
import { useDiarizationQueueOptional, type QueueJob } from "@/contexts/DiarizationQueueContext";
import { isVideoFile, extractAudioFromVideo } from "@/lib/videoUtils";
import { extractAudioSegment, probeAudioDurationSec } from "@/lib/audioSegment";
import type { SyncAudioPlayerRef, WordTiming } from "@/components/SyncAudioPlayer";
import { DiarizationNotes } from "@/components/DiarizationNotes";
import { DiarizationAI } from "@/components/DiarizationAI";
import {
  detectOverlaps,
  exportAsVTT,
  exportAsASS,
  exportAsPDFHtml,
  generateShareableText,
  type OverlapRegion,
  type SegmentNote,
} from "@/utils/diarizationEnhancements";

const SyncAudioPlayer = lazy(() => import("@/components/SyncAudioPlayer").then(m => ({ default: m.SyncAudioPlayer })));

interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
  words?: Array<{ word: string; start: number; end: number; probability: number }>;
}

interface DiarizationResult {
  text: string;
  segments: DiarizedSegment[];
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

interface SpeakerStats {
  label: string;
  totalTime: number;
  percentage: number;
  segmentCount: number;
  wordCount: number;
  avgSegmentLength: number;
  longestSegment: number;
}

interface SavedDiarization {
  id: string;
  file_name: string | null;
  speaker_count: number;
  duration: number;
  engine: string | null;
  created_at: string;
}

const SPEAKER_COLORS = [
  "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700",
  "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700",
  "bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700",
  "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700",
  "bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700",
  "bg-cyan-100 dark:bg-cyan-900/30 border-cyan-300 dark:border-cyan-700",
  "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700",
  "bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700",
  "bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700",
  "bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700",
];

const SPEAKER_BADGE_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500", "bg-pink-500",
  "bg-cyan-500", "bg-yellow-500", "bg-red-500", "bg-indigo-500", "bg-teal-500",
];

const SPEAKER_BAR_COLORS = [
  "#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#6366f1", "#14b8a6",
];

const SPEAKER_ROLE_OPTIONS = [
  { value: '', label: 'ללא סיווג' },
  { value: 'interviewer', label: '🎤 מראיין' },
  { value: 'interviewee', label: '🎯 מרואיין' },
  { value: 'host', label: '🎙️ מנחה' },
  { value: 'guest', label: '👤 אורח' },
  { value: 'moderator', label: '⚖️ מנהל דיון' },
  { value: 'caller', label: '📞 מתקשר' },
  { value: 'customer', label: '🛒 לקוח' },
  { value: 'agent', label: '💼 נציג שירות' },
  { value: 'teacher', label: '📚 מרצה' },
  { value: 'student', label: '🎓 תלמיד' },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} שנ׳`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m} דק׳ ${s} שנ׳` : `${m} דק׳`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function mergeConsecutiveSegments(segments: DiarizedSegment[]): DiarizedSegment[] {
  if (segments.length === 0) return [];
  const merged: DiarizedSegment[] = [{ ...segments[0] }];
  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];
    if (curr.speaker_label === prev.speaker_label) {
      prev.text = prev.text + " " + curr.text;
      prev.end = curr.end;
      if (prev.words && curr.words) prev.words = [...prev.words, ...curr.words];
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

type DiarizationMode = 'local' | 'assemblyai' | 'deepgram' | 'openai' | 'browser' | 'whisperx';

interface SpeakerDiarizationProps {
  serverUrl?: string;
  initialAudioBlob?: Blob | null;
  initialAudioName?: string;
  initialText?: string;
}

type CloudTranscriptItem = {
  id: string;
  title: string;
  text: string;
  created_at: string;
  audio_file_path: string | null;
  engine?: string | null;
};

type CompareEntry = {
  label: string;
  result: DiarizationResult;
  speakerNames?: Record<string, string>;
};

export const SpeakerDiarization = ({ serverUrl = "/whisper", initialAudioBlob, initialAudioName, initialText }: SpeakerDiarizationProps) => {
  const navigate = useNavigate();
  const [result, setResult] = useState<DiarizationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [minGap, setMinGap] = useState(1.5);
  const [hfToken, setHfToken] = useState("");
  const [pyannoteModel, setPyannoteModel] = useState<'3.1' | 'community-1'>('community-1');
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState<string | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [speakerRoles, setSpeakerRoles] = useState<Record<string, string>>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mode, setMode] = useState<DiarizationMode>('browser');
  const [cloudApiKey, setCloudApiKey] = useState("");
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [rangeStartSec, setRangeStartSec] = useState("0");
  const [rangeEndSec, setRangeEndSec] = useState("");
  const [autoMerge, setAutoMerge] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [savedList, setSavedList] = useState<SavedDiarization[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [browserProgress, setBrowserProgress] = useState<DiarizationProgress | null>(null);
  const [expectedSpeakers, setExpectedSpeakers] = useState<number>(0);
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([]);
  const [mergedText, setMergedText] = useState<string>("");
  const [transcriptList, setTranscriptList] = useState<CloudTranscriptItem[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);
  const [showCloudTranscriptPicker, setShowCloudTranscriptPicker] = useState(false);
  const [, setSelectedTranscriptId] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playingSegIdx, setPlayingSegIdx] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showBgJobs, setShowBgJobs] = useState(false);
  const [useTranscriptAssist, setUseTranscriptAssist] = useState(true);
  const [streamingSegments, setStreamingSegments] = useState<DiarizedSegment[]>([]);
  const [streamProgress, setStreamProgress] = useState<{ stage: string; percent: number } | null>(null);
  const syncPlayerRef = useRef<SyncAudioPlayerRef>(null);
  const segEndRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const compareRunRef = useRef<string | null>(null);

  // Enhancement state
  const [segmentNotes, setSegmentNotes] = useState<SegmentNote[]>([]);
  const [overlaps, setOverlaps] = useState<OverlapRegion[]>([]);
  const [editingBoundary, setEditingBoundary] = useState<{ segIdx: number; edge: 'start' | 'end' } | null>(null);
  const [editingBoundaryValue, setEditingBoundaryValue] = useState("");
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null);
  const [editingSegmentText, setEditingSegmentText] = useState("");

  const prepareFileWithOptionalRange = useCallback(async (sourceFile: File): Promise<File> => {
    const parseRangeValue = (raw: string): number => {
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    };

    if (!rangeEnabled) return sourceFile;

    let workingFile = sourceFile;
    if (isVideoFile(workingFile)) {
      workingFile = await extractAudioFromVideo(workingFile);
    }

    const durationSec = await probeAudioDurationSec(workingFile);
    const startSec = Math.min(parseRangeValue(rangeStartSec), Math.max(0, durationSec - 0.2));
    const requestedEndSec = rangeEndSec.trim() === '' ? durationSec : parseRangeValue(rangeEndSec);
    const endSec = Math.min(Math.max(requestedEndSec, startSec + 0.2), durationSec);

    if (endSec - startSec < 0.2) {
      throw new Error('טווח החיתוך קצר מדי. יש לבחור לפחות 0.2 שניות.');
    }

    if (startSec <= 0 && endSec >= durationSec - 0.05) {
      return workingFile;
    }

    return extractAudioSegment(workingFile, startSec, endSec);
  }, [rangeEnabled, rangeStartSec, rangeEndSec]);

  const { keys: cloudKeys, saveKeys: saveCloudKeys, isLoaded: keysLoaded } = useCloudApiKeys();
  const { jobs: bgJobs, startBackgroundJob, retryJob } = useDiarizationJobs();

  // Queue integration for parallel processing
  const queue = useDiarizationQueueOptional();
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  // Load API key from cloud when mode changes
  useEffect(() => {
    if (!keysLoaded) return;
    if (mode === 'assemblyai') setCloudApiKey(cloudKeys.assemblyai_key);
    else if (mode === 'deepgram') setCloudApiKey(cloudKeys.deepgram_key);
    else if (mode === 'openai') setCloudApiKey(cloudKeys.openai_key);
    else setCloudApiKey('');
    if (cloudKeys.huggingface_key && !hfToken) setHfToken(cloudKeys.huggingface_key);
  }, [mode, keysLoaded, cloudKeys]);

  const saveApiKeyToCloud = useCallback((key: string) => {
    if (!key.trim()) return;
    if (mode === 'assemblyai') saveCloudKeys({ assemblyai_key: key });
    else if (mode === 'deepgram') saveCloudKeys({ deepgram_key: key });
    else if (mode === 'openai') saveCloudKeys({ openai_key: key });
  }, [mode, saveCloudKeys]);

  // Load saved diarizations list
  const loadSavedList = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await (supabase as any)
      .from('diarization_results')
      .select('id, file_name, speaker_count, duration, engine, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setSavedList(data as SavedDiarization[]);
  }, []);

  useEffect(() => { loadSavedList(); }, [loadSavedList]);

  // Auto-populate audio from parent (e.g. after transcription)
  const initialAudioApplied = useRef(false);
  const preloadedFileRef = useRef<File | null>(null);
  useEffect(() => {
    if (!initialAudioBlob || initialAudioApplied.current || audioUrl) return;
    initialAudioApplied.current = true;
    const name = initialAudioName || 'transcribed-audio.webm';
    const file = new File([initialAudioBlob], name, { type: initialAudioBlob.type || 'audio/webm' });
    preloadedFileRef.current = file;
    const url = URL.createObjectURL(initialAudioBlob);
    setAudioUrl(url);
    setCurrentFileName(name);
  }, [initialAudioBlob, initialAudioName]);

  // Auto-merge transcript after diarization completes when assist toggle is on
  const autoMergeApplied = useRef(false);
  useEffect(() => {
    if (!result || !useTranscriptAssist || !initialText?.trim() || autoMergeApplied.current) return;
    autoMergeApplied.current = true;
    mergeWithTranscript(initialText);
  }, [result, useTranscriptAssist, initialText]);

  const getSpeakerName = (originalLabel: string) => speakerNames[originalLabel] || originalLabel;

  const startEditingSpeaker = (label: string) => {
    setEditingSpeaker(label);
    setEditingName(getSpeakerName(label));
  };

  const saveSpeakerName = () => {
    if (!editingSpeaker) return;
    const trimmed = editingName.trim();
    setSpeakerNames(prev => ({ ...prev, [editingSpeaker]: trimmed || editingSpeaker }));
    setEditingSpeaker(null);
    toast({ title: "שם דובר עודכן", description: `${editingSpeaker} → ${trimmed || editingSpeaker}` });
  };

  const setSpeakerRole = (speakerLabel: string, role: string) => {
    setSpeakerRoles(prev => ({ ...prev, [speakerLabel]: role }));
    toast({ title: "סיווג עודכן", description: `${getSpeakerName(speakerLabel)}: ${SPEAKER_ROLE_OPTIONS.find(r => r.value === role)?.label || 'ללא'}` });
  };

  // Save to DB
  const saveToCloud = async () => {
    if (!result) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: "יש להתחבר כדי לשמור", variant: "destructive" }); return; }
    setIsSaving(true);
    try {
      const { error } = await (supabase as any).from('diarization_results').insert({
        user_id: user.id,
        file_name: currentFileName || null,
        segments: result.segments,
        speakers: result.speakers,
        speaker_names: { ...speakerNames, __roles: speakerRoles },
        speaker_count: result.speaker_count,
        duration: result.duration,
        processing_time: result.processing_time,
        diarization_method: result.diarization_method,
        engine: mode,
      });
      if (error) throw error;
      toast({ title: "נשמר בהצלחה", description: "תוצאות זיהוי הדוברים נשמרו" });
      loadSavedList();
    } catch (err: unknown) {
      toast({ title: "שגיאה בשמירה", description: err instanceof Error ? err.message : "Unknown", variant: "destructive" });
    } finally { setIsSaving(false); }
  };

  // Load from DB
  const loadFromCloud = async (id: string) => {
    const { data, error } = await (supabase as any).from('diarization_results').select('*').eq('id', id).single();
    if (error || !data) { toast({ title: "שגיאה בטעינה", variant: "destructive" }); return; }
    const segments = (data.segments as unknown as DiarizedSegment[]) || [];
    const speakers = (data.speakers as unknown as string[]) || [];
    const names = (data.speaker_names as Record<string, string>) || {};
    const roles = (names as any).__roles || {};
    delete (names as any).__roles;
    setResult({
      text: segments.map(s => s.text).join(" "),
      segments, speakers,
      speaker_count: data.speaker_count,
      duration: Number(data.duration),
      processing_time: Number(data.processing_time) || 0,
      diarization_method: data.diarization_method || "loaded",
    });
    setSpeakerNames(names);
    setSpeakerRoles(roles);
    setCurrentFileName(data.file_name || "");
    setShowSaved(false);
    toast({ title: "נטען בהצלחה", description: data.file_name || "תוצאות זיהוי דוברים" });
  };

  // Load result from background job
  const loadFromJob = (job: any) => {
    if (!job.result) return;
    const r = job.result;
    setResult({
      text: r.text || r.segments?.map((s: any) => s.text).join(" ") || "",
      segments: r.segments || [],
      speakers: r.speakers || [],
      speaker_count: r.speaker_count || 0,
      duration: r.duration || 0,
      processing_time: r.processing_time || 0,
      diarization_method: r.diarization_method || "background",
    });
    setSpeakerRoles(job.speaker_roles || {});
    setCurrentFileName(job.file_name || "");
    setShowBgJobs(false);
    toast({ title: "נטען מעבודת רקע", description: job.file_name || "" });
  };

  const speakerStats = useMemo<SpeakerStats[]>(() => {
    if (!result) return [];
    const statsMap: Record<string, { totalTime: number; segmentCount: number; wordCount: number; longestSegment: number }> = {};
    for (const seg of result.segments) {
      const key = seg.speaker_label;
      if (!statsMap[key]) statsMap[key] = { totalTime: 0, segmentCount: 0, wordCount: 0, longestSegment: 0 };
      const segDuration = seg.end - seg.start;
      statsMap[key].totalTime += segDuration;
      statsMap[key].segmentCount += 1;
      statsMap[key].wordCount += seg.text.trim().split(/\s+/).filter(Boolean).length;
      if (segDuration > statsMap[key].longestSegment) statsMap[key].longestSegment = segDuration;
    }
    const totalSpeaking = Object.values(statsMap).reduce((sum, s) => sum + s.totalTime, 0);
    return result.speakers.map(sp => {
      const s = statsMap[sp] || { totalTime: 0, segmentCount: 0, wordCount: 0, longestSegment: 0 };
      return {
        label: sp, totalTime: s.totalTime,
        percentage: totalSpeaking > 0 ? (s.totalTime / totalSpeaking) * 100 : 0,
        segmentCount: s.segmentCount, wordCount: s.wordCount,
        avgSegmentLength: s.segmentCount > 0 ? s.totalTime / s.segmentCount : 0,
        longestSegment: s.longestSegment,
      };
    }).sort((a, b) => b.totalTime - a.totalTime);
  }, [result]);

  const speakerIndex = useMemo<Record<string, number>>(() => {
    const idx: Record<string, number> = {};
    if (result) result.speakers.forEach((sp, i) => { idx[sp] = i; });
    return idx;
  }, [result]);

  const displaySegments = useMemo(() => {
    if (!result) return [];
    let segs = result.segments;
    if (autoMerge) segs = mergeConsecutiveSegments(segs);
    if (activeSpeakerFilter) segs = segs.filter(s => s.speaker_label === activeSpeakerFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      segs = segs.filter(s => s.text.toLowerCase().includes(q));
    }
    return segs;
  }, [result, activeSpeakerFilter, autoMerge, searchQuery]);

  const editableTranscriptSegments = useMemo(() => {
    if (!result) return [] as Array<{ seg: DiarizedSegment; segIdx: number }>;
    let segs = result.segments.map((seg, segIdx) => ({ seg, segIdx }));
    if (activeSpeakerFilter) segs = segs.filter(({ seg }) => seg.speaker_label === activeSpeakerFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      segs = segs.filter(({ seg }) => seg.text.toLowerCase().includes(q));
    }
    return segs;
  }, [result, activeSpeakerFilter, searchQuery]);

  // ──── Audio Player (via SyncAudioPlayer ref) ────
  const handlePlayerTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
    // Stop at segment end when playing a specific segment
    if (segEndRef.current !== null && time >= segEndRef.current) {
      syncPlayerRef.current?.pause();
      setPlayingSegIdx(null);
      segEndRef.current = null;
    }
  }, []);

  const seekTo = useCallback((time: number) => {
    syncPlayerRef.current?.seekTo(time);
    setCurrentTime(time);
  }, []);

  // Find active segment based on current time
  const activeSegIdx = useMemo(() => {
    if (!result || !isPlaying) return -1;
    return displaySegments.findIndex(s => currentTime >= s.start && currentTime <= s.end);
  }, [result, currentTime, isPlaying, displaySegments]);

  // Build word timings from diarization segments for SyncAudioPlayer
  const wordTimingsFromSegments = useMemo<WordTiming[]>(() => {
    if (!result) return [];
    const timings: WordTiming[] = [];
    for (const seg of result.segments) {
      if (seg.words?.length) {
        for (const w of seg.words) timings.push({ word: w.word, start: w.start, end: w.end, probability: w.probability });
      }
    }
    return timings;
  }, [result]);

  // Detect overlapping segments
  useEffect(() => {
    if (!result) { setOverlaps([]); return; }
    const sorted = [...result.segments].sort((a, b) => a.start - b.start);
    setOverlaps(detectOverlaps(sorted));
  }, [result]);

  useEffect(() => {
    setEditingSegmentIdx(null);
    setEditingSegmentText("");
  }, [result?.segments.length]);

  // Auto-add to compare when a compare-run finishes
  useEffect(() => {
    if (!result || !compareRunRef.current) return;
    const label = compareRunRef.current;
    compareRunRef.current = null;
    setCompareEntries(prev => {
      if (prev.some(e => e.label === label)) {
        return prev.map(e => e.label === label ? { ...e, result, speakerNames: { ...speakerNames } } : e);
      }
      return [...prev, { label, result, speakerNames: { ...speakerNames } }];
    });
    toast({ title: "נוסף להשוואה", description: `${label} — ${result.speaker_count} דוברים` });
  }, [result, speakerNames]);

  // Keyboard shortcuts for speaker navigation
  useEffect(() => {
    if (!result) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const segs = displaySegments;
      if (!segs.length) return;

      if (e.key === 'n' || e.key === 'N') {
        if (activeSegIdx < 0) { seekTo(segs[0].start); return; }
        const currentSpeaker = segs[activeSegIdx]?.speaker_label;
        for (let i = activeSegIdx + 1; i < segs.length; i++) {
          if (segs[i].speaker_label !== currentSpeaker) { seekTo(segs[i].start); break; }
        }
      } else if (e.key === 'p' || e.key === 'P') {
        if (activeSegIdx <= 0) return;
        const currentSpeaker = segs[activeSegIdx]?.speaker_label;
        for (let i = activeSegIdx - 1; i >= 0; i--) {
          if (segs[i].speaker_label !== currentSpeaker) { seekTo(segs[i].start); break; }
        }
      } else if (e.key >= '1' && e.key <= '9') {
        const spIdx = parseInt(e.key) - 1;
        if (spIdx < result.speakers.length) {
          const sp = result.speakers[spIdx];
          const seg = segs.find(s => s.speaker_label === sp);
          if (seg) seekTo(seg.start);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [result, displaySegments, activeSegIdx, seekTo]);

  // Update segments (auto-punctuation, boundary edits)
  const handleSegmentsUpdate = useCallback((updatedSegments: DiarizedSegment[]) => {
    if (!result) return;
    const speakers = Array.from(new Set(updatedSegments.map(s => s.speaker_label)));
    setResult({
      ...result,
      segments: updatedSegments,
      speakers,
      speaker_count: speakers.length,
      text: updatedSegments.map(s => s.text).join(' '),
    });
  }, [result]);

  // Boundary editing
  const saveBoundaryEdit = useCallback(() => {
    if (!editingBoundary || !result) return;
    const val = parseFloat(editingBoundaryValue);
    if (isNaN(val) || val < 0) return;
    const updated = [...result.segments];
    const seg = { ...updated[editingBoundary.segIdx] };
    if (editingBoundary.edge === 'start') seg.start = val;
    else seg.end = val;
    if (seg.start >= seg.end) return;
    updated[editingBoundary.segIdx] = seg;
    handleSegmentsUpdate(updated);
    setEditingBoundary(null);
    setEditingBoundaryValue("");
  }, [editingBoundary, editingBoundaryValue, result, handleSegmentsUpdate]);

  const updateSegmentSpeaker = useCallback((segIdx: number, nextSpeakerLabel: string) => {
    if (!result || !nextSpeakerLabel) return;
    const current = result.segments[segIdx];
    if (!current || current.speaker_label === nextSpeakerLabel) return;

    const updated = [...result.segments];
    updated[segIdx] = {
      ...updated[segIdx],
      speaker_label: nextSpeakerLabel,
      speaker: nextSpeakerLabel,
    };

    handleSegmentsUpdate(updated);
  }, [result, handleSegmentsUpdate]);

  const startEditingSegmentText = useCallback((segIdx: number) => {
    if (!result) return;
    const seg = result.segments[segIdx];
    if (!seg) return;
    setEditingSegmentIdx(segIdx);
    setEditingSegmentText(seg.text);
  }, [result]);

  const saveSegmentTextEdit = useCallback(() => {
    if (!result || editingSegmentIdx === null) return;
    const trimmed = editingSegmentText.trim();
    if (!trimmed) return;
    const updated = [...result.segments];
    updated[editingSegmentIdx] = { ...updated[editingSegmentIdx], text: trimmed };
    handleSegmentsUpdate(updated);
    setEditingSegmentIdx(null);
    setEditingSegmentText("");
  }, [result, editingSegmentIdx, editingSegmentText, handleSegmentsUpdate]);

  const splitSegment = useCallback((segIdx: number) => {
    if (!result) return;
    const seg = result.segments[segIdx];
    if (!seg) return;
    const duration = seg.end - seg.start;
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (duration < 0.4 || words.length < 2) {
      toast({ title: "לא ניתן לפצל", description: "נדרש קטע ארוך יותר עם לפחות 2 מילים", variant: "destructive" });
      return;
    }

    const pivot = Math.ceil(words.length / 2);
    const leftText = words.slice(0, pivot).join(" ").trim();
    const rightText = words.slice(pivot).join(" ").trim();
    if (!leftText || !rightText) {
      toast({ title: "לא ניתן לפצל", description: "לא נמצאה נקודת פיצול תקינה", variant: "destructive" });
      return;
    }

    const mid = seg.start + duration / 2;
    const first: DiarizedSegment = { ...seg, end: mid, text: leftText };
    const second: DiarizedSegment = { ...seg, start: mid, text: rightText };
    const updated = [...result.segments];
    updated.splice(segIdx, 1, first, second);
    handleSegmentsUpdate(updated);
    toast({ title: "הקטע פוצל", description: `קטע #${segIdx + 1} חולק לשניים` });
  }, [result, handleSegmentsUpdate]);

  const mergeWithNextSegment = useCallback((segIdx: number) => {
    if (!result) return;
    if (segIdx < 0 || segIdx >= result.segments.length - 1) return;
    const a = result.segments[segIdx];
    const b = result.segments[segIdx + 1];
    if (!a || !b) return;

    const merged: DiarizedSegment = {
      ...a,
      end: Math.max(a.end, b.end),
      text: `${a.text} ${b.text}`.trim(),
      words: a.words && b.words ? [...a.words, ...b.words] : (a.words || b.words),
    };
    const updated = [...result.segments];
    updated.splice(segIdx, 2, merged);
    handleSegmentsUpdate(updated);
    toast({ title: "הקטעים אוחדו", description: `קטעים #${segIdx + 1} ו-#${segIdx + 2} אוחדו` });
  }, [result, handleSegmentsUpdate]);

  // New export functions
  const downloadAsVTT = () => {
    if (!result) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const vtt = exportAsVTT(segs, speakerNames);
    downloadBlob(new Blob([vtt], { type: "text/vtt;charset=utf-8" }), `diarization-${Date.now()}.vtt`);
  };

  const downloadAsASS = () => {
    if (!result) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const ass = exportAsASS(segs, speakerNames, result.speakers);
    downloadBlob(new Blob([ass], { type: "text/plain;charset=utf-8" }), `diarization-${Date.now()}.ass`);
  };

  const exportPDF = () => {
    if (!result) return;
    exportAsPDFHtml(result.segments, result.speakers, speakerNames, speakerRoles, speakerStats, result.duration, result.diarization_method, overlaps);
  };

  const shareResults = () => {
    if (!result) return;
    const text = generateShareableText(result.segments, result.speakers, speakerNames, speakerStats, result.duration);
    if (navigator.share) {
      navigator.share({ title: 'זיהוי דוברים', text }).catch(() => {
        navigator.clipboard.writeText(text);
        toast({ title: "הועתק ללוח" });
      });
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "הועתק ללוח", description: "התוצאות הועתקו — ניתן להדביק ולשתף" });
    }
  };

  const handleDiarize = async (file: File) => {
    setIsProcessing(true);
    setResult(null);
    setActiveSpeakerFilter(null);
    setBrowserProgress(null);
    setPlayingSegIdx(null);
    setSpeakerRoles({});
    segEndRef.current = null;

    let preparedFile = file;
    try {
      preparedFile = await prepareFileWithOptionalRange(file);
    } catch (prepareErr) {
      setIsProcessing(false);
      toast({
        title: "שגיאה בחיתוך אודיו",
        description: prepareErr instanceof Error ? prepareErr.message : "Unknown error",
        variant: "destructive",
      });
      return;
    }

    setCurrentFileName(preparedFile.name);

    // Keep reference to file for re-runs & comparisons
    preloadedFileRef.current = preparedFile;

    const url = URL.createObjectURL(preparedFile);
    setAudioUrl(url);

    try {
      if (mode === 'browser') {
        const data = await diarizeInBrowser(preparedFile, (p) => setBrowserProgress(p), expectedSpeakers || undefined);
        setResult({ text: data.segments.map(s => s.text).join(" "), ...data });
        setBrowserProgress(null);
        toast({ title: "זיהוי דוברים הושלם", description: `${data.speaker_count} דוברים זוהו (בדפדפן) — ${data.processing_time} שניות` });
      } else if (mode === 'local' || mode === 'whisperx') {
        const formData = new FormData();
        formData.append("file", preparedFile);
        formData.append("min_gap", minGap.toString());
        if (hfToken.trim()) formData.append("hf_token", hfToken.trim());
        if (mode === 'local') {
          formData.append("diarization_engine", hfToken.trim() ? "pyannote" : "silence-gap");
          if (hfToken.trim()) {
            formData.append("pyannote_model", pyannoteModel === 'community-1' ? 'pyannote/speaker-diarization-community-1' : 'pyannote/speaker-diarization-3.1');
          }
        }
        if (mode === 'whisperx') {
          formData.append("use_whisperx", "1");
          formData.append("diarization_engine", "whisperx");
          if (hfToken.trim()) {
            formData.append("pyannote_model", pyannoteModel === 'community-1' ? 'pyannote/speaker-diarization-community-1' : 'pyannote/speaker-diarization-3.1');
          }
        }

        // Use streaming endpoint for live progress
        setStreamingSegments([]);
        setStreamProgress({ stage: 'מתחבר לשרת...', percent: 0 });
        let resp: Response;
        try {
          resp = await fetch(`${serverUrl}/diarize-stream`, { method: "POST", body: formData });
        } catch (fetchErr) {
          throw new Error(`לא ניתן להתחבר לשרת המקומי (${serverUrl}). וודא שהשרת רץ או בחר מנוע ענן.`);
        }
        if (!resp.ok || !resp.body) {
          const err = await resp.json().catch(() => ({ error: "Server error" }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: DiarizationResult | null = null;
        const collectedSegments: DiarizedSegment[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'progress') {
                setStreamProgress({ stage: event.stage, percent: event.percent });
              } else if (event.type === 'segment') {
                const seg = event.segment as DiarizedSegment;
                collectedSegments.push(seg);
                setStreamingSegments([...collectedSegments]);
                setStreamProgress({ stage: `קטע ${event.index + 1}/${event.total}`, percent: event.percent });
                // Save partial progress
                try {
                  localStorage.setItem('diarize_partial_segments', JSON.stringify(collectedSegments));
                  localStorage.setItem('diarize_partial_file', preparedFile.name);
                } catch { /* quota */ }
              } else if (event.type === 'done') {
                finalResult = event as DiarizationResult;
              } else if (event.type === 'error') {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
            }
          }
        }

        if (finalResult) {
          setResult(finalResult);
          setStreamingSegments([]);
          setStreamProgress(null);
          // Clean up partial progress
          localStorage.removeItem('diarize_partial_segments');
          localStorage.removeItem('diarize_partial_file');
          toast({ title: "זיהוי דוברים הושלם", description: `${finalResult.speaker_count} דוברים זוהו (${mode === 'whisperx' ? 'WhisperX' : 'מקומי'})` });
        } else {
          throw new Error("השרת לא החזיר תוצאה מלאה");
        }
      } else if (mode === 'openai') {
        if (!cloudApiKey.trim()) throw new Error("נדרש מפתח API של OpenAI");
        const formData = new FormData();
        formData.append("file", preparedFile);
        formData.append("model", "whisper-1");
        formData.append("language", "he");
        formData.append("response_format", "verbose_json");
        formData.append("timestamp_granularities[]", "segment");
        formData.append("timestamp_granularities[]", "word");
        const startTime = Date.now();
        const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${cloudApiKey.trim()}` },
          body: formData,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "OpenAI error" }));
          throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const processingTime = (Date.now() - startTime) / 1000;
        const segments: DiarizedSegment[] = (data.segments || []).map((seg: any, i: number) => ({
          text: seg.text?.trim() || "", start: seg.start || 0, end: seg.end || 0,
          speaker: `Speaker ${i % 2 + 1}`, speaker_label: `דובר ${i % 2 + 1}`,
          words: seg.words?.map((w: any) => ({ word: w.word, start: w.start, end: w.end, probability: 1 })),
        }));
        let currentSpeaker = 1;
        for (let i = 1; i < segments.length; i++) {
          const gap = segments[i].start - segments[i - 1].end;
          if (gap > 1.5) currentSpeaker = currentSpeaker === 1 ? 2 : 1;
          segments[i].speaker = `Speaker ${currentSpeaker}`;
          segments[i].speaker_label = `דובר ${currentSpeaker}`;
        }
        const speakers = [...new Set(segments.map(s => s.speaker_label))];
        setResult({
          text: data.text || "", segments, speakers,
          speaker_count: speakers.length,
          duration: segments.length > 0 ? segments[segments.length - 1].end : data.duration || 0,
          processing_time: Math.round(processingTime * 10) / 10,
          diarization_method: "OpenAI Whisper + gap-detection",
        });
        toast({ title: "זיהוי דוברים הושלם", description: `${speakers.length} דוברים זוהו (OpenAI Whisper)` });
      } else {
        if (!cloudApiKey.trim()) throw new Error(`נדרש מפתח API של ${mode === 'assemblyai' ? 'AssemblyAI' : 'Deepgram'}`);
        const formData = new FormData();
        formData.append("file", preparedFile);
        formData.append("engine", mode);
        formData.append("apiKey", cloudApiKey.trim());
        formData.append("language", "he");
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const fnUrl = `https://${projectId}.supabase.co/functions/v1/diarize-cloud`;
        const resp = await fetch(fnUrl, { method: "POST", headers: { apikey: anonKey }, body: formData });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Cloud error" }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const data: DiarizationResult = await resp.json();
        setResult(data);
        toast({ title: "זיהוי דוברים הושלם", description: `${data.speaker_count} דוברים זוהו ב-${data.processing_time} שניות` });
      }
    } catch (err: unknown) {
      toast({ title: "שגיאה בזיהוי דוברים", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally { setIsProcessing(false); }
  };

  const handleBackgroundDiarize = async (file: File) => {
    if (mode !== 'assemblyai' && mode !== 'deepgram') {
      toast({ title: "עיבוד ברקע נתמך רק ב-AssemblyAI ו-Deepgram", variant: "destructive" });
      return;
    }
    try {
      const prepared = await prepareFileWithOptionalRange(file);
      await startBackgroundJob(prepared, mode);
    } catch (err) {
      toast({
        title: "שגיאה בחיתוך אודיו",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      return;
    }
    setShowBgJobs(true);
  };

  // ──── Queue: Send to Background Queue (parallel, survives navigation) ────
  const handleQueueFile = async (file: File) => {
    if (!queue) {
      toast({ title: 'מערכת התור לא זמינה', variant: 'destructive' });
      return;
    }
    try {
      const prepared = await prepareFileWithOptionalRange(file);
      queue.enqueue(prepared, mode, { serverUrl, minGap, hfToken, pyannoteModel, expectedSpeakers, cloudApiKey, autoSaveToCloud: true });
    } catch (err) {
      toast({
        title: "שגיאה בחיתוך אודיו",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleQueueMultipleFiles = async (files: File[]) => {
    if (!queue) {
      toast({ title: 'מערכת התור לא זמינה', variant: 'destructive' });
      return;
    }
    try {
      const preparedFiles: File[] = [];
      for (const file of files) {
        preparedFiles.push(await prepareFileWithOptionalRange(file));
      }
      queue.enqueueMultiple(preparedFiles, mode, { serverUrl, minGap, hfToken, pyannoteModel, expectedSpeakers, cloudApiKey, autoSaveToCloud: true });
    } catch (err) {
      toast({
        title: "שגיאה בחיתוך אודיו",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleMultiFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('audio/') || f.type.startsWith('video/'));
    if (files.length > 0) void handleQueueMultipleFiles(files);
    e.target.value = "";
  };

  // ──── Load result from completed queue job ────
  const loadFromQueueJob = (job: QueueJob) => {
    if (!job.result) return;
    setResult(job.result);
    setCurrentFileName(job.fileName);
    if (job.audioUrl) { setAudioUrl(job.audioUrl); }
    toast({ title: "נטען מהתור", description: `${job.fileName} — ${job.result.speaker_count} דוברים` });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleDiarize(file);
    e.target.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current++; setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files || []);
    const validFiles = files.filter(f => f.type.startsWith('audio/') || f.type.startsWith('video/'));
    if (validFiles.length > 1 && queue) {
      void handleQueueMultipleFiles(validFiles);
    } else if (validFiles.length === 1) {
      void handleDiarize(validFiles[0]);
    } else if (files.length > 0) {
      toast({ title: "סוג קובץ לא נתמך", description: "יש להעלות קובץ אודיו או וידאו", variant: "destructive" });
    }
  };

  const copyAsText = () => {
    if (!result) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const text = segs.map(s => {
      const role = speakerRoles[s.speaker_label];
      const roleStr = role ? ` (${SPEAKER_ROLE_OPTIONS.find(r => r.value === role)?.label || role})` : '';
      return `[${getSpeakerName(s.speaker_label)}${roleStr}] (${formatTime(s.start)}) ${s.text}`;
    }).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "הועתק", description: "התמלול עם דוברים הועתק ללוח" });
  };

  const downloadAsText = () => {
    if (!result) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const header = `זיהוי דוברים — ${result.speaker_count} דוברים | ${formatTime(result.duration)} | ${result.diarization_method}\n`;
    const statsSection = speakerStats.map(s => {
      const role = speakerRoles[s.label];
      const roleStr = role ? ` [${SPEAKER_ROLE_OPTIONS.find(r => r.value === role)?.label || role}]` : '';
      return `${getSpeakerName(s.label)}${roleStr}: ${formatDuration(s.totalTime)} (${Math.round(s.percentage)}%) | ${s.wordCount} מילים | ${s.segmentCount} קטעים`;
    }).join("\n");
    const separator = "\n" + "─".repeat(50) + "\n\n";
    const segments = segs.map(s => `[${getSpeakerName(s.speaker_label)}] (${formatTime(s.start)}-${formatTime(s.end)}) ${s.text}`).join("\n");
    downloadBlob(new Blob([header + "\n" + statsSection + separator + segments], { type: "text/plain;charset=utf-8" }), `diarization-${Date.now()}.txt`);
  };

  const downloadAsSrt = () => {
    if (!result) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const pad = (n: number) => n.toString().padStart(2, "0");
    const formatSrt = (sec: number) => {
      const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60); const ms = Math.round((sec % 1) * 1000);
      return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, "0")}`;
    };
    const srt = segs.map((seg, i) => `${i + 1}\n${formatSrt(seg.start)} --> ${formatSrt(seg.end)}\n[${getSpeakerName(seg.speaker_label)}] ${seg.text}`).join("\n\n");
    downloadBlob(new Blob(["\uFEFF" + srt], { type: "text/srt;charset=utf-8" }), `diarization-${Date.now()}.srt`);
  };

  const loadTranscriptsForMerge = useCallback(async () => {
    setIsLoadingTranscripts(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('transcripts')
        .select('id, title, text, created_at, audio_file_path, engine')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) {
        setTranscriptList(data.map(t => ({
          id: t.id,
          title: t.title || '',
          text: t.text,
          created_at: t.created_at,
          audio_file_path: (t as any).audio_file_path || null,
          engine: (t as any).engine || null,
        })));
      }
    } finally { setIsLoadingTranscripts(false); }
  }, []);

  const loadAudioFromCloudTranscript = useCallback(async (item: CloudTranscriptItem) => {
    if (!item.audio_file_path) {
      toast({ title: "אין אודיו לתמלול הזה", description: "לתמלול הזה נשמר רק טקסט ללא קובץ קול", variant: "destructive" });
      return;
    }

    try {
      const { data, error } = await supabase.storage.from('permanent-audio').createSignedUrl(item.audio_file_path, 3600);
      if (error || !data?.signedUrl) throw error || new Error('Missing signed URL');

      const resp = await fetch(data.signedUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const rawName = item.audio_file_path.split('/').pop() || `${item.title || 'cloud-audio'}.webm`;
      const file = new File([blob], rawName, { type: blob.type || 'audio/webm' });

      preloadedFileRef.current = file;
      setAudioUrl(URL.createObjectURL(blob));
      setCurrentFileName(file.name);
      setShowCloudTranscriptPicker(false);
      setShowSaved(false);

      if (item.text?.trim()) {
        setMergedText(item.text.trim());
      }

      toast({ title: "נטען מהענן", description: `${item.title || 'תמלול'} נטען לזיהוי דוברים` });
    } catch (err) {
      toast({ title: "שגיאה בטעינת אודיו", description: err instanceof Error ? err.message : 'Unknown error', variant: "destructive" });
    }
  }, []);

  const clearCurrentDiarization = useCallback(() => {
    setResult(null);
    setActiveSpeakerFilter(null);
    setSpeakerNames({});
    setSpeakerRoles({});
    setSegmentNotes([]);
    setOverlaps([]);
    setMergedText("");
    setCompareEntries([]);
    setEditingBoundary(null);
    setEditingBoundaryValue("");
    setEditingSegmentIdx(null);
    setEditingSegmentText("");
    setStreamingSegments([]);
    setStreamProgress(null);
    setPlayingSegIdx(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setAudioDuration(0);
    setAudioUrl(null);
    setCurrentFileName("");
    preloadedFileRef.current = null;
    toast({ title: "נוקה", description: "תוצאות זיהוי הדוברים נוקו" });
  }, []);

  const mergeWithTranscript = (transcriptText: string) => {
    if (!result || !result.segments.length) return;
    const segs = autoMerge ? mergeConsecutiveSegments(result.segments) : result.segments;
    const sentences = transcriptText.split(/(?<=[.!?،؟\n])\s*/).filter(s => s.trim());
    if (sentences.length === 0) {
      setMergedText(segs.map(s => `[${getSpeakerName(s.speaker_label)}]\n${s.text}`).join("\n\n"));
      return;
    }
    const totalDuration = segs.reduce((sum, s) => sum + (s.end - s.start), 0);
    const merged: string[] = [];
    let sentenceIdx = 0;
    for (const seg of segs) {
      const segDuration = seg.end - seg.start;
      const segProportion = totalDuration > 0 ? segDuration / totalDuration : 1 / segs.length;
      const sentencesForSeg = Math.max(1, Math.round(sentences.length * segProportion));
      const segSentences: string[] = [];
      for (let j = 0; j < sentencesForSeg && sentenceIdx < sentences.length; j++) {
        segSentences.push(sentences[sentenceIdx]); sentenceIdx++;
      }
      if (seg === segs[segs.length - 1]) {
        while (sentenceIdx < sentences.length) { segSentences.push(sentences[sentenceIdx]); sentenceIdx++; }
      }
      const text = segSentences.length > 0 ? segSentences.join(" ") : seg.text;
      merged.push(`[${getSpeakerName(seg.speaker_label)}] (${formatTime(seg.start)}-${formatTime(seg.end)})\n${text}`);
    }
    setMergedText(merged.join("\n\n"));
    toast({ title: "שולב בהצלחה", description: "הטקסט חולק לפי דוברים" });
  };

  const highlightText = (text: string) => {
    if (!searchQuery.trim()) return text;
    const q = searchQuery.trim();
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) => regex.test(part) ? <mark key={i} className="bg-yellow-300 dark:bg-yellow-700 rounded px-0.5">{part}</mark> : part);
  };

  const playSegment = useCallback((segIdx: number, start: number, end: number) => {
    if (!audioUrl || !syncPlayerRef.current) return;
    if (playingSegIdx === segIdx && isPlaying) {
      syncPlayerRef.current.pause();
      setPlayingSegIdx(null);
      segEndRef.current = null;
      return;
    }
    syncPlayerRef.current.seekTo(start);
    setPlayingSegIdx(segIdx);
    segEndRef.current = end;
    syncPlayerRef.current.play();
  }, [audioUrl, playingSegIdx, isPlaying]);

  const pendingBgJobs = bgJobs.filter(j => j.status === 'pending' || j.status === 'processing');

  return (
    <Card className="p-4 sm:p-6 shadow-lg border-0 bg-card/95 backdrop-blur-sm" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold">זיהוי דוברים</h2>
            <p className="text-xs text-muted-foreground">ניתוח וזיהוי דוברים בקבצי אודיו</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {result && (
            <>
              <TooltipProvider>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={saveToCloud} disabled={isSaving}>
                    <Save className="w-3.5 h-3.5" />{isSaving ? "..." : "שמור"}
                  </Button>
                </TooltipTrigger><TooltipContent>שמור תוצאות לענן</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={clearCurrentDiarization}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>נקה תוצאות נוכחיות</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={copyAsText}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>העתק ללוח</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={downloadAsText}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>הורד כטקסט</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={downloadAsSrt}>
                    <Subtitles className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>הורד כ-SRT</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={downloadAsVTT}>
                    <FileDown className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>VTT</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={downloadAsASS}>
                    <FileDown className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>ASS</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={exportPDF}>
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>PDF / הדפסה</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={shareResults}>
                    <Share2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>שתף תוצאות</TooltipContent></Tooltip>
              </TooltipProvider>
              <Button variant="outline" size="sm" className="h-8 text-xs px-2"
                onClick={() => {
                  if (!result) return;
                  const modeLabels: Record<string, string> = { browser: 'דפדפן', whisperx: 'WhisperX', assemblyai: 'AssemblyAI', deepgram: 'Deepgram', openai: 'OpenAI', local: 'מקומי' };
                  const label = modeLabels[mode] || mode;
                  if (compareEntries.some(e => e.label === label)) {
                    setCompareEntries(prev => prev.map(e => e.label === label ? { ...e, result, speakerNames: { ...speakerNames } } : e));
                  } else {
                    setCompareEntries(prev => [...prev, { label, result, speakerNames: { ...speakerNames } }]);
                  }
                  toast({ title: "נוסף להשוואה", description: `${label} — ${result.speaker_count} דוברים` });
                }}>
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">השוואה</span> ({compareEntries.length})
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={() => { setShowSaved(!showSaved); if (!showSaved) loadSavedList(); }}>
            <FolderOpen className="w-3.5 h-3.5" />{showSaved ? "הסתר" : "שמורים"}
          </Button>
          {/* Background jobs badge */}
          <Button
            variant={showBgJobs ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs px-2 relative"
            onClick={() => setShowBgJobs(!showBgJobs)}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">רקע</span>
            {pendingBgJobs.length > 0 && (
              <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center animate-pulse">
                {pendingBgJobs.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Background Jobs Panel */}
      {showBgJobs && (
        <div className="mb-4 border rounded-xl p-3 space-y-2 bg-muted/20 max-h-[250px] overflow-y-auto">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-primary" />
              עבודות רקע
            </Label>
            {pendingBgJobs.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {pendingBgJobs.length} בעיבוד
              </Badge>
            )}
          </div>
          {bgJobs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">אין עבודות רקע עדיין</p>
          ) : bgJobs.slice(0, 10).map(job => (
            <div key={job.id} className="p-2.5 rounded-lg border bg-card text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-xs truncate max-w-[60%]">{job.file_name || "ללא שם"}</span>
                <div className="flex items-center gap-1.5">
                  {job.status === 'completed' && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => loadFromJob(job)}>
                      טען תוצאות
                    </Button>
                  )}
                  {job.status === 'error' && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => retryJob(job.id)}>
                      <RefreshCw className="w-3 h-3" />נסה שוב
                    </Button>
                  )}
                  <Badge variant={job.status === 'completed' ? 'default' : job.status === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {job.status === 'pending' ? '⏳ ממתין' : job.status === 'processing' ? '🔄 מעבד' : job.status === 'completed' ? '✅ הושלם' : '❌ שגיאה'}
                  </Badge>
                </div>
              </div>
              {(job.status === 'pending' || job.status === 'processing') && (
                <Progress value={job.progress} className="h-1.5" />
              )}
              {job.status === 'error' && job.error_message && (
                <p className="text-[10px] text-destructive mt-1 truncate">{job.error_message}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Saved results list */}
      {showSaved && (
        <div className="mb-4 border rounded-xl p-3 space-y-2 bg-muted/20 max-h-[200px] overflow-y-auto">
          <Label className="text-sm font-semibold">תוצאות שמורות</Label>
          {savedList.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין תוצאות שמורות</p>
          ) : savedList.map(item => (
            <button key={item.id} className="w-full text-right p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-sm flex justify-between items-center" onClick={() => loadFromCloud(item.id)}>
              <div>
                <span className="font-medium">{item.file_name || "ללא שם"}</span>
                <span className="text-xs text-muted-foreground mr-2">{item.speaker_count} דוברים · {formatDuration(item.duration)}</span>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString("he-IL")}</span>
            </button>
          ))}
        </div>
      )}

      {/* Settings */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Label className="text-sm whitespace-nowrap font-medium">מקור זיהוי</Label>
          <div className="flex gap-1 flex-wrap w-full sm:flex-1">
            {([
              { value: 'browser' as DiarizationMode, label: 'דפדפן', icon: Globe },
              { value: 'whisperx' as DiarizationMode, label: 'WhisperX', icon: Mic },
              { value: 'assemblyai' as DiarizationMode, label: 'AssemblyAI', icon: Cloud },
              { value: 'deepgram' as DiarizationMode, label: 'Deepgram', icon: Cloud },
              { value: 'openai' as DiarizationMode, label: 'OpenAI', icon: Cloud },
              { value: 'local' as DiarizationMode, label: 'מקומי', icon: Server },
            ]).map(opt => (
              <Button key={opt.value} variant={mode === opt.value ? "default" : "outline"} size="sm"
                className="text-xs gap-1 flex-1 min-w-0 px-2" onClick={() => setMode(opt.value)}>
                <opt.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{opt.label}</span>
              </Button>
            ))}
          </div>
        </div>

        {mode === 'browser' && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5 flex items-start gap-2">
            <Globe className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            <span>זיהוי דוברים בדפדפן — חינמי לחלוטין, עובד אופליין ובמובייל. מבוסס ניתוח MFCC של חתימות קוליות.</span>
          </div>
        )}

        {mode === 'whisperx' && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5 flex items-start gap-2">
            <Mic className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            <span>WhisperX — תמלול + יישור מילים מדויק + זיהוי דוברים באיכות גבוהה. דורש שרת מקומי עם <code className="bg-muted px-1 rounded">pip install whisperx</code>.</span>
          </div>
        )}

        {mode !== 'local' && mode !== 'browser' && mode !== 'whisperx' && (
          <div className="flex items-center gap-4">
            <Label className="text-sm whitespace-nowrap min-w-[100px]">
              מפתח {mode === 'assemblyai' ? 'AssemblyAI' : mode === 'deepgram' ? 'Deepgram' : 'OpenAI'}
            </Label>
            <Input value={cloudApiKey} onChange={e => setCloudApiKey(e.target.value)} onBlur={() => saveApiKeyToCloud(cloudApiKey)}
              type="password" placeholder="הזן מפתח API (נשמר אוטומטית בענן)" className="flex-1 text-sm" />
          </div>
        )}

        {(mode === 'browser' || mode === 'assemblyai' || mode === 'deepgram') && (
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap min-w-[100px]">מספר דוברים</Label>
            <div className="flex gap-1 flex-wrap">
              {[0, 2, 3, 4, 5, 6].map(n => (
                <Button key={n} variant={expectedSpeakers === n ? "default" : "outline"} size="sm" className="text-xs min-w-[40px]" onClick={() => setExpectedSpeakers(n)}>
                  {n === 0 ? "אוטומטי" : n}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <Switch id="range-enabled" checked={rangeEnabled} onCheckedChange={setRangeEnabled} />
            <Label htmlFor="range-enabled" className="text-sm cursor-pointer">חיתוך אודיו לפני זיהוי דוברים</Label>
          </div>
          {rangeEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">התחלה (שניות)</Label>
                <Input type="number" min={0} step={0.1} value={rangeStartSec} onChange={(e) => setRangeStartSec(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">סוף (שניות, ריק = עד הסוף)</Label>
                <Input type="number" min={0} step={0.1} value={rangeEndSec} onChange={(e) => setRangeEndSec(e.target.value)} placeholder="למשל 120" className="h-8 text-sm" />
              </div>
            </div>
          )}
        </div>

        {(mode === 'local' || mode === 'whisperx') && (
          <>
            <div className="flex items-center gap-4">
              <Label className="text-sm whitespace-nowrap min-w-[100px]">שקט מינימלי</Label>
              <Slider value={[minGap]} onValueChange={([v]) => setMinGap(v)} min={0.5} max={5} step={0.5} className="flex-1" />
              <span className="text-sm text-muted-foreground w-8">{minGap}</span>
            </div>
            <div className="flex items-center gap-4">
              <Label className="text-sm whitespace-nowrap min-w-[100px]">מודל pyannote</Label>
              <div className="flex gap-1 flex-1">
                <Button variant={pyannoteModel === 'community-1' ? 'default' : 'outline'} size="sm" className="text-xs flex-1" onClick={() => setPyannoteModel('community-1')}>Community-1 🆕</Button>
                <Button variant={pyannoteModel === '3.1' ? 'default' : 'outline'} size="sm" className="text-xs flex-1" onClick={() => setPyannoteModel('3.1')}>v3.1 (קלאסי)</Button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Label className="text-sm whitespace-nowrap min-w-[100px]">HuggingFace Token</Label>
              <div className="flex-1 flex items-center gap-2">
                <Input value={hfToken} onChange={e => setHfToken(e.target.value)} onBlur={() => { if (hfToken.trim()) saveCloudKeys({ huggingface_key: hfToken.trim() }); }}
                  type="password" placeholder="hf_... (נשמר אוטומטית בענן)" className="flex-1 text-sm" />
                {keysLoaded && cloudKeys.huggingface_key && hfToken === cloudKeys.huggingface_key && (
                  <span className="text-xs text-green-600 whitespace-nowrap flex items-center gap-1">☁️ מסונכרן</span>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap min-w-[100px]">מיזוג אוטומטי</Label>
          <Button variant={autoMerge ? "default" : "outline"} size="sm" className="text-xs gap-1" onClick={() => setAutoMerge(!autoMerge)}>
            <Merge className="w-3.5 h-3.5" />{autoMerge ? "פעיל — קטעים רצופים ממוזגים" : "כבוי"}
          </Button>
        </div>
      </div>

      {/* Drop zone */}
      <input ref={fileInputRef} type="file" accept="audio/*,video/*" onChange={handleFileSelect} className="hidden" />
      <div
        onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
        className={`w-full mb-4 border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
          isDragging ? "border-primary bg-primary/10 scale-[1.02]" : preloadedFileRef.current && !result && !isProcessing ? "border-green-500 bg-green-500/10" : "border-border hover:border-primary/50 hover:bg-muted/30"
        } ${isProcessing ? "opacity-60 pointer-events-none" : preloadedFileRef.current && !result ? "" : "cursor-pointer"}`}
        onClick={() => !isProcessing && !preloadedFileRef.current && fileInputRef.current?.click()}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-2 w-full max-w-sm mx-auto">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {streamProgress ? streamProgress.stage : browserProgress ? browserProgress.stage : "מזהה דוברים..."}
            </span>
            {(streamProgress || browserProgress) && (
              <Progress value={streamProgress?.percent ?? browserProgress?.percent ?? 0} className="w-full h-2.5" />
            )}
            {(streamProgress || browserProgress) && (
              <span className="text-[10px] text-muted-foreground">
                {Math.round(streamProgress?.percent ?? browserProgress?.percent ?? 0)}%
              </span>
            )}
          </div>
        ) : preloadedFileRef.current && !result ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center">
              <Music className="w-7 h-7 text-green-600" />
            </div>
            <div>
              <span className="text-sm font-medium block">🎙️ אודיו מהתמלול נטען אוטומטית</span>
              <span className="text-xs text-muted-foreground">{currentFileName}</span>
            </div>
            {initialText && (
              <div className="flex items-center gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                <Switch
                  id="transcript-assist"
                  checked={useTranscriptAssist}
                  onCheckedChange={setUseTranscriptAssist}
                />
                <Label htmlFor="transcript-assist" className="text-xs cursor-pointer">
                  שלב עם תמלול קיים ({initialText.length > 40 ? initialText.slice(0, 40) + '…' : initialText})
                </Label>
              </div>
            )}
            <Button size="sm" className="gap-1.5 mt-1" onClick={(e) => {
              e.stopPropagation();
              autoMergeApplied.current = false;
              if (preloadedFileRef.current) void handleDiarize(preloadedFileRef.current);
            }}>
              <Users className="w-4 h-4" />
              זהה דוברים
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={(e) => {
              e.stopPropagation();
              preloadedFileRef.current = null;
              setAudioUrl(null);
              setCurrentFileName("");
              fileInputRef.current?.click();
            }}>
              או בחר קובץ אחר
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload className={`w-7 h-7 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <span className="text-sm font-medium block">{isDragging ? "שחרר כאן את הקובץ" : "גרור קובץ אודיו לכאן או לחץ לבחירה"}</span>
              <span className="text-xs text-muted-foreground">MP3, WAV, M4A, MP4 ועוד</span>
            </div>
            {/* Background processing button for cloud engines */}
            {(mode === 'assemblyai' || mode === 'deepgram') && (
              <Button variant="outline" size="sm" className="text-xs gap-1 mt-1" onClick={e => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'audio/*,video/*';
                input.onchange = (ev: any) => { const f = ev.target.files?.[0]; if (f) void handleBackgroundDiarize(f); };
                input.click();
              }}>
                <Zap className="w-3.5 h-3.5" />
                שלח לעיבוד ברקע
              </Button>
            )}
            {/* Multi-file queue button */}
            {queue && (
              <div className="flex gap-1.5 mt-1">
                <input ref={multiFileInputRef} type="file" accept="audio/*,video/*" multiple onChange={handleMultiFileSelect} className="hidden" />
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={e => {
                  e.stopPropagation();
                  multiFileInputRef.current?.click();
                }}>
                  <Users className="w-3.5 h-3.5" />
                  העלה מספר קבצים (במקביל)
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={e => {
                  e.stopPropagation();
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'audio/*,video/*';
                  input.onchange = (ev: any) => { const f = ev.target.files?.[0]; if (f) void handleQueueFile(f); };
                  input.click();
                }}>
                  <Zap className="w-3.5 h-3.5" />
                  שלח לתור רקע
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1 mt-1"
              onClick={async (e) => {
                e.stopPropagation();
                if (transcriptList.length === 0) await loadTranscriptsForMerge();
                setShowCloudTranscriptPicker(v => !v);
              }}
            >
              <Cloud className="w-3.5 h-3.5" />
              בחר מתמלולים בענן
            </Button>

            {showCloudTranscriptPicker && (
              <div className="w-full max-w-xl mt-2 border rounded-lg p-2 bg-background/90" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold">תמלולים מהענן (עם אודיו)</Label>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setShowCloudTranscriptPicker(false)}>
                    סגור
                  </Button>
                </div>
                {isLoadingTranscripts ? (
                  <div className="text-xs text-muted-foreground py-2 flex items-center justify-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />טוען תמלולים...
                  </div>
                ) : transcriptList.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">לא נמצאו תמלולים בענן.</div>
                ) : (
                  <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                    {transcriptList.map(item => {
                      const hasAudio = !!item.audio_file_path;
                      return (
                        <div key={item.id} className="p-2 rounded border flex items-center justify-between gap-2">
                          <div className="text-right flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{item.title || 'ללא כותרת'}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {new Date(item.created_at).toLocaleDateString('he-IL')} · {item.engine || 'unknown'} · {hasAudio ? 'כולל אודיו' : 'ללא אודיו'}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="h-7 text-[10px]"
                            variant={hasAudio ? 'default' : 'outline'}
                            disabled={!hasAudio}
                            onClick={() => void loadAudioFromCloudTranscript(item)}
                          >
                            טען לזיהוי
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ──── Queue Status Panel ──── */}
      {queue && queue.jobs.length > 0 && (
        <div className="mb-4 border rounded-xl p-3 space-y-2 bg-gradient-to-l from-blue-500/5 to-transparent">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" />
              תור עיבוד ({queue.activeCount} פעיל · {queue.jobs.filter(j => j.status === 'queued').length} בתור)
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">במקביל:</span>
              {[1, 2, 3, 4].map(n => (
                <button key={n} className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${queue.maxConcurrent === n ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
                  onClick={() => queue.setMaxConcurrent(n)}>{n}</button>
              ))}
              {queue.completedCount > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={queue.clearCompleted}>נקה הושלמו</Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
            {queue.jobs.slice(0, 20).map(job => (
              <div key={job.id} className={`p-2 rounded-lg border text-xs transition-all ${
                job.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
                job.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
                job.status === 'processing' ? 'border-primary/30 bg-primary/5 shadow-sm' :
                'border-border bg-muted/20'
              }`}>
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <span className="font-medium truncate max-w-[45%]">{job.fileName}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] py-0 h-4">
                      {job.mode === 'browser' ? 'דפדפן' : job.mode === 'whisperx' ? 'WhisperX' : job.mode === 'local' ? 'מקומי' : job.mode}
                    </Badge>
                    {job.status === 'completed' && job.result && (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5"
                        onClick={() => loadFromQueueJob(job)}>טען ←</Button>
                    )}
                    {job.status === 'error' && (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5"
                        onClick={() => queue.retryJob(job.id)}>
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                    {(job.status === 'processing' || job.status === 'queued') && (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-destructive"
                        onClick={() => queue.cancelJob(job.id)}>✕</Button>
                    )}
                    {(job.status === 'completed' || job.status === 'error') && (
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5"
                        onClick={() => queue.removeJob(job.id)}>✕</Button>
                    )}
                  </div>
                </div>
                {(job.status === 'processing' || job.status === 'queued') && (
                  <>
                    <Progress value={job.progress} className="h-1 mb-0.5" />
                    <span className="text-[10px] text-muted-foreground">{job.progressStage} {job.progress > 0 ? `(${Math.round(job.progress)}%)` : ''}</span>
                  </>
                )}
                {job.status === 'completed' && job.result && (
                  <span className="text-[10px] text-green-600">✅ {job.result.speaker_count} דוברים · {job.result.diarization_method}{job.cloudSaveId ? ' · ☁ נשמר' : ''}</span>
                )}
                {job.status === 'error' && (
                  <span className="text-[10px] text-destructive">❌ {job.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ──── Live Streaming Segments Preview ──── */}
      {isProcessing && streamingSegments.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-primary/30 bg-primary/5 space-y-2 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-primary/5 pb-1">
            <span className="text-xs font-medium flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              תצוגה חיה — {streamingSegments.length} קטעים זוהו
            </span>
            <Badge variant="outline" className="text-[10px]">
              {streamingSegments.filter((s, i, a) => a.findIndex(x => x.speaker_label === s.speaker_label) === i).length} דוברים
            </Badge>
          </div>
          {streamingSegments.map((seg, i) => {
            const uniqueSpeakers = [...new Set(streamingSegments.map(s => s.speaker_label))];
            const colorIdx = uniqueSpeakers.indexOf(seg.speaker_label);
            return (
              <div key={i} className="flex gap-2 text-xs animate-in fade-in slide-in-from-bottom-1 duration-300">
                <Badge variant="secondary" className={`shrink-0 text-[10px] ${SPEAKER_BADGE_COLORS[colorIdx % SPEAKER_BADGE_COLORS.length]}`}>
                  {seg.speaker_label}
                </Badge>
                <span className="text-muted-foreground shrink-0 tabular-nums">{formatTime(seg.start)}</span>
                <span className="flex-1 truncate">{seg.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ──── Advanced Audio Player (SyncAudioPlayer) ──── */}
      {audioUrl && result && (
        <div className="mb-4 space-y-2">
          <Suspense fallback={<div className="h-20 rounded-xl border animate-pulse bg-muted/30" />}>
            <SyncAudioPlayer
              ref={syncPlayerRef}
              audioUrl={audioUrl}
              wordTimings={wordTimingsFromSegments}
              onTimeUpdate={handlePlayerTimeUpdate}
              onPlayStateChange={setIsPlaying}
              speakerSegments={result.segments.map(s => ({ start: s.start, end: s.end, speaker: speakerNames[s.speaker_label] || s.speaker_label }))}
              compact
            />
          </Suspense>

          {/* Speaker color timeline */}
          <div className="relative h-4 rounded-full bg-muted/50 overflow-hidden cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const dur = result.duration || 1;
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekTo(pct * dur);
            }}>
            {result.segments.map((seg, i) => {
              const colorIdx = speakerIndex[seg.speaker_label] ?? 0;
              const dur = result.duration || 1;
              const left = (seg.start / dur) * 100;
              const width = Math.max(((seg.end - seg.start) / dur) * 100, 0.3);
              return (
                <div key={i} className="absolute h-full"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: SPEAKER_BAR_COLORS[colorIdx % SPEAKER_BAR_COLORS.length], opacity: 0.7 }}
                />
              );
            })}
            <div className="absolute top-0 h-full w-0.5 bg-foreground/80 z-10"
              style={{ left: `${result.duration > 0 ? (currentTime / result.duration) * 100 : 0}%` }} />
          </div>

          {/* Active speaker indicator */}
          {activeSegIdx >= 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${SPEAKER_BADGE_COLORS[speakerIndex[displaySegments[activeSegIdx]?.speaker_label] ?? 0]}`} />
              <span className="font-medium">{getSpeakerName(displaySegments[activeSegIdx]?.speaker_label)}</span>
              <span className="text-muted-foreground truncate">{displaySegments[activeSegIdx]?.text.slice(0, 80)}...</span>
            </div>
          )}

          {/* Re-run diarization button */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs gap-1.5 h-7" onClick={() => {
              if (preloadedFileRef.current) {
                autoMergeApplied.current = false;
                handleDiarize(preloadedFileRef.current);
              } else {
                fileInputRef.current?.click();
              }
            }}>
              <RefreshCw className="w-3 h-3" />
              הרץ זיהוי מחדש
            </Button>
            {/* Re-run with different engine */}
            <Select value="" onValueChange={(engine) => {
              const prev = mode;
              setMode(engine as DiarizationMode);
              if (preloadedFileRef.current) {
                autoMergeApplied.current = false;
                // brief delay to let mode state update
                setTimeout(() => handleDiarize(preloadedFileRef.current!), 50);
              }
            }}>
              <SelectTrigger className="h-7 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder="הרץ עם מנוע אחר..." />
              </SelectTrigger>
              <SelectContent>
                {(['browser', 'whisperx', 'assemblyai', 'deepgram', 'openai', 'local'] as DiarizationMode[])
                  .filter(m => m !== mode)
                  .map(m => {
                    const labels: Record<string, string> = { browser: 'דפדפן', whisperx: 'WhisperX', assemblyai: 'AssemblyAI', deepgram: 'Deepgram', openai: 'OpenAI', local: 'מקומי' };
                    return <SelectItem key={m} value={m} className="text-xs">{labels[m]}</SelectItem>;
                  })}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-2">
          {/* Quick Compare Button */}
          <div className="flex justify-end mb-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 border-primary/30 hover:bg-primary/10"
                    onClick={() => {
                      const entry = {
                        label: result.diarization_method || mode,
                        result,
                      };
                      navigate('/diarization/compare', {
                        state: {
                          entries: [entry],
                          audioUrl,
                          audioFileName: currentFileName,
                        },
                      });
                    }}
                  >
                    <GitCompareArrows className="w-4 h-4 text-primary" />
                    השוואת מנועים
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>השווה תוצאה זו עם מנוע נוסף</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        <Tabs defaultValue="stats" className="mt-0">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-3">
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-4 lg:grid-cols-8 gap-0.5">
              <TabsTrigger value="stats" className="text-xs gap-1 whitespace-nowrap"><BarChart3 className="w-3.5 h-3.5" />סטטיסטיקות</TabsTrigger>
              <TabsTrigger value="classify" className="text-xs gap-1 whitespace-nowrap"><Tag className="w-3.5 h-3.5" />סיווג</TabsTrigger>
              <TabsTrigger value="timeline" className="text-xs gap-1 whitespace-nowrap"><Clock className="w-3.5 h-3.5" />ציר זמן</TabsTrigger>
              <TabsTrigger value="transcript" className="text-xs gap-1 whitespace-nowrap"><MessageSquare className="w-3.5 h-3.5" />תמלול</TabsTrigger>
              <TabsTrigger value="ai" className="text-xs gap-1 whitespace-nowrap"><Sparkles className="w-3.5 h-3.5" />AI</TabsTrigger>
              <TabsTrigger value="notes" className="text-xs gap-1 whitespace-nowrap"><BookmarkPlus className="w-3.5 h-3.5" />הערות {segmentNotes.length > 0 && `(${segmentNotes.length})`}</TabsTrigger>
              <TabsTrigger value="merge" className="text-xs gap-1 whitespace-nowrap" onClick={() => { if (transcriptList.length === 0) loadTranscriptsForMerge(); }}><FileText className="w-3.5 h-3.5" />שילוב</TabsTrigger>
              <TabsTrigger value="compare" className="text-xs gap-1 whitespace-nowrap" onClick={(e) => {
                if (result) {
                  e.preventDefault();
                  const entry = { label: result.diarization_method || mode, result };
                  navigate('/diarization/compare', {
                    state: { entries: [entry], audioUrl, audioFileName: currentFileName },
                  });
                }
              }}><ArrowLeftRight className="w-3.5 h-3.5" />השוואה</TabsTrigger>
            </TabsList>
          </div>

          {/* === Stats Tab === */}
          <TabsContent value="stats" className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground">{result.speaker_count} דוברים</span>
              <span>·</span><span>{result.segments.length} קטעים</span>
              {autoMerge && <span className="text-xs">(→ {mergeConsecutiveSegments(result.segments).length} אחרי מיזוג)</span>}
              <span>·</span><span>{formatTime(result.duration)}</span>
              <span>·</span><span>{result.diarization_method}</span>
            </div>

            <div className="space-y-3">
              {speakerStats.map((stat) => {
                const colorIdx = speakerIndex[stat.label] ?? 0;
                const barColor = SPEAKER_BAR_COLORS[colorIdx % SPEAKER_BAR_COLORS.length];
                const role = speakerRoles[stat.label];
                const roleLabel = role ? SPEAKER_ROLE_OPTIONS.find(r => r.value === role)?.label : null;
                return (
                  <div key={stat.label}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      activeSpeakerFilter === stat.label
                        ? SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length] + " ring-2 ring-primary/30"
                        : "bg-muted/30 border-border hover:bg-muted/50"
                    }`}
                    onClick={() => setActiveSpeakerFilter(activeSpeakerFilter === stat.label ? null : stat.label)}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${SPEAKER_BADGE_COLORS[colorIdx % SPEAKER_BADGE_COLORS.length]}`} />
                        {editingSpeaker === stat.label ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <Input value={editingName} onChange={e => setEditingName(e.target.value)} className="h-6 text-sm w-28 px-1" autoFocus
                              onKeyDown={e => { if (e.key === "Enter") saveSpeakerName(); if (e.key === "Escape") setEditingSpeaker(null); }} />
                            <button onClick={saveSpeakerName} className="text-green-600"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setEditingSpeaker(null)} className="text-red-500"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm">{getSpeakerName(stat.label)}</span>
                            {roleLabel && <Badge variant="secondary" className="text-[10px] py-0">{roleLabel}</Badge>}
                            <button onClick={e => { e.stopPropagation(); startEditingSpeaker(stat.label); }} className="text-muted-foreground hover:text-foreground">
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="text-lg font-bold" style={{ color: barColor }}>{Math.round(stat.percentage)}%</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-muted mb-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${stat.percentage}%`, backgroundColor: barColor }} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1"><Clock className="w-3 h-3" /><span>זמן: {formatDuration(stat.totalTime)}</span></div>
                      <div className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /><span>{stat.wordCount} מילים</span></div>
                      <div className="flex items-center gap-1"><Mic className="w-3 h-3" /><span>{stat.segmentCount} קטעים</span></div>
                      <div className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /><span>ממוצע: {formatDuration(stat.avgSegmentLength)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2">
              <Label className="text-xs text-muted-foreground mb-1 block">חלוקת זמן דיבור</Label>
              <div className="flex h-6 rounded-full overflow-hidden border">
                <TooltipProvider>
                  {speakerStats.map((stat) => {
                    const colorIdx = speakerIndex[stat.label] ?? 0;
                    return (
                      <Tooltip key={stat.label}><TooltipTrigger asChild>
                        <div className="h-full transition-all duration-500 cursor-pointer hover:opacity-80"
                          style={{ width: `${stat.percentage}%`, backgroundColor: SPEAKER_BAR_COLORS[colorIdx % SPEAKER_BAR_COLORS.length], minWidth: stat.percentage > 0 ? "4px" : "0" }} />
                      </TooltipTrigger><TooltipContent><p>{getSpeakerName(stat.label)}: {Math.round(stat.percentage)}% ({formatDuration(stat.totalTime)})</p></TooltipContent></Tooltip>
                    );
                  })}
                </TooltipProvider>
              </div>
            </div>

            {/* Overlap detection */}
            {overlaps.length > 0 && (
              <div className="mt-3 border rounded-xl p-3 bg-yellow-50/50 dark:bg-yellow-900/10 space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
                  חפיפות — {overlaps.length} אזורים ({formatDuration(overlaps.reduce((s, o) => s + o.duration, 0))} סה״כ)
                </Label>
                <div className="space-y-1 max-h-[150px] overflow-y-auto">
                  {overlaps.map((o, i) => (
                    <button key={i} className="w-full text-right text-xs p-1.5 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-2"
                      onClick={() => seekTo(o.start)}>
                      <span className="tabular-nums text-muted-foreground">{formatTime(o.start)}–{formatTime(o.end)}</span>
                      <span className="font-medium">{o.speakers.map(s => getSpeakerName(s)).join(' + ')}</span>
                      <span className="text-muted-foreground mr-auto">{o.duration.toFixed(1)} שנ׳</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Keyboard shortcuts hint */}
            <div className="mt-2 text-[10px] text-muted-foreground flex gap-3 flex-wrap">
              <span>⌨️ קיצורים:</span>
              <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[9px]">N</kbd> דובר הבא</span>
              <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[9px]">P</kbd> דובר קודם</span>
              <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[9px]">1-9</kbd> קפוץ לדובר</span>
            </div>
          </TabsContent>

          {/* === Classification Tab === */}
          <TabsContent value="classify" className="space-y-4">
            <div className="text-sm text-muted-foreground mb-2">
              סווג כל דובר עם תפקיד — הסיווג יישמר ויופיע בייצוא ובהעתקה.
            </div>
            <div className="space-y-3">
              {result.speakers.map((sp, i) => {
                const colorIdx = speakerIndex[sp] ?? i;
                const currentRole = speakerRoles[sp] || '';
                return (
                  <div key={sp} className={`p-3 rounded-xl border ${SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length]}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <span className={`w-3 h-3 rounded-full shrink-0 ${SPEAKER_BADGE_COLORS[colorIdx % SPEAKER_BADGE_COLORS.length]}`} />
                        <span className="font-semibold text-sm">{getSpeakerName(sp)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(speakerStats.find(s => s.label === sp)?.totalTime || 0)}
                        </span>
                      </div>
                      <Select value={currentRole || '_none'} onValueChange={v => setSpeakerRole(sp, v === '_none' ? '' : v)}>
                        <SelectTrigger className="w-[160px] h-8 text-xs">
                          <SelectValue placeholder="בחר תפקיד..." />
                        </SelectTrigger>
                        <SelectContent>
                          {SPEAKER_ROLE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value || '_none'} value={opt.value || '_none'} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Quick rename */}
                    <div className="mt-2 flex items-center gap-2">
                      <Label className="text-[11px] text-muted-foreground whitespace-nowrap">שם מותאם:</Label>
                      <Input
                        defaultValue={getSpeakerName(sp)}
                        className="h-7 text-xs flex-1"
                        onBlur={e => {
                          const val = e.target.value.trim();
                          if (val && val !== sp) setSpeakerNames(prev => ({ ...prev, [sp]: val }));
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* === Timeline Tab === */}
          <TabsContent value="timeline" className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">ציר זמן — כל קטע מייצג דובר לאורך ההקלטה ({formatTime(result.duration)}). לחץ פעמיים על קטע לעריכת גבולות.</div>
            <div className="space-y-0.5">
              {result.segments.map((seg, i) => {
                const colorIdx = speakerIndex[seg.speaker_label] ?? 0;
                const leftPct = (seg.start / result.duration) * 100;
                const widthPct = Math.max(((seg.end - seg.start) / result.duration) * 100, 0.5);
                return (
                  <TooltipProvider key={i}><Tooltip><TooltipTrigger asChild>
                    <div className="relative h-5 w-full cursor-pointer" onClick={() => seekTo(seg.start)}
                      onDoubleClick={() => { setEditingBoundary({ segIdx: i, edge: 'start' }); setEditingBoundaryValue(seg.start.toFixed(2)); }}>
                      <div className="absolute h-full rounded-sm hover:opacity-100 transition-opacity"
                        style={{ right: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: SPEAKER_BAR_COLORS[colorIdx % SPEAKER_BAR_COLORS.length],
                          opacity: activeSpeakerFilter && activeSpeakerFilter !== seg.speaker_label ? 0.15 : 0.85 }} />
                    </div>
                  </TooltipTrigger><TooltipContent side="top" className="max-w-[250px]">
                    <p className="font-semibold text-xs">{getSpeakerName(seg.speaker_label)}</p>
                    <p className="text-xs">{formatTime(seg.start)} – {formatTime(seg.end)}</p>
                    <p className="text-xs mt-1 line-clamp-2">{seg.text}</p>
                  </TooltipContent></Tooltip></TooltipProvider>
                );
              })}
            </div>

            {/* Overlap markers on timeline */}
            {overlaps.length > 0 && (
              <div className="relative h-3 w-full">
                {overlaps.map((o, i) => {
                  const leftPct = (o.start / result.duration) * 100;
                  const widthPct = Math.max(((o.end - o.start) / result.duration) * 100, 0.3);
                  return (
                    <div key={i} className="absolute h-full rounded-sm bg-yellow-500/60 border border-yellow-600/40 cursor-pointer"
                      style={{ right: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`חפיפה: ${o.speakers.map(s => getSpeakerName(s)).join(' + ')}`}
                      onClick={() => seekTo(o.start)} />
                  );
                })}
              </div>
            )}

            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5" dir="ltr">
              <span>{formatTime(0)}</span><span>{formatTime(result.duration * 0.25)}</span>
              <span>{formatTime(result.duration * 0.5)}</span><span>{formatTime(result.duration * 0.75)}</span>
              <span>{formatTime(result.duration)}</span>
            </div>

            {/* Boundary editor */}
            {editingBoundary && (
              <div className="border rounded-lg p-3 bg-muted/20 space-y-2" onClick={e => e.stopPropagation()}>
                <Label className="text-xs font-semibold">✏️ עריכת גבולות — קטע #{editingBoundary.segIdx + 1}</Label>
                <div className="flex gap-2 items-center flex-wrap">
                  <div className="flex gap-1">
                    <Button variant={editingBoundary.edge === 'start' ? 'default' : 'outline'} size="sm" className="text-xs h-7"
                      onClick={() => { setEditingBoundary({ ...editingBoundary, edge: 'start' }); setEditingBoundaryValue(result.segments[editingBoundary.segIdx].start.toFixed(2)); }}>
                      התחלה
                    </Button>
                    <Button variant={editingBoundary.edge === 'end' ? 'default' : 'outline'} size="sm" className="text-xs h-7"
                      onClick={() => { setEditingBoundary({ ...editingBoundary, edge: 'end' }); setEditingBoundaryValue(result.segments[editingBoundary.segIdx].end.toFixed(2)); }}>
                      סיום
                    </Button>
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    value={editingBoundaryValue}
                    onChange={e => setEditingBoundaryValue(e.target.value)}
                    className="w-24 h-7 text-xs"
                    onKeyDown={e => { if (e.key === 'Enter') saveBoundaryEdit(); if (e.key === 'Escape') setEditingBoundary(null); }}
                  />
                  <span className="text-xs text-muted-foreground">שניות</span>
                  <Button size="sm" className="h-7 text-xs" onClick={saveBoundaryEdit}><Check className="w-3 h-3 ml-1" />שמור</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingBoundary(null)}><X className="w-3 h-3" /></Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  מקור: {formatTime(result.segments[editingBoundary.segIdx].start)} – {formatTime(result.segments[editingBoundary.segIdx].end)} | {getSpeakerName(result.segments[editingBoundary.segIdx].speaker_label)}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              {result.speakers.map((sp, i) => (
                <button key={sp}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-all ${activeSpeakerFilter === sp ? "ring-2 ring-primary/40 font-semibold" : "hover:bg-muted/50"}`}
                  onClick={() => setActiveSpeakerFilter(activeSpeakerFilter === sp ? null : sp)}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SPEAKER_BAR_COLORS[i % SPEAKER_BAR_COLORS.length] }} />
                  {getSpeakerName(sp)}
                </button>
              ))}
              {activeSpeakerFilter && <button className="text-xs text-muted-foreground underline" onClick={() => setActiveSpeakerFilter(null)}>הצג הכל</button>}
            </div>
          </TabsContent>

          {/* === Transcript Tab === */}
          <TabsContent value="transcript" className="space-y-1">
            <div className="relative mb-2">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="חיפוש בתמלול..." className="pr-8 text-sm" />
              {searchQuery && <button className="absolute left-2 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery("")}><X className="w-4 h-4 text-muted-foreground" /></button>}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              <button className={`text-xs px-2 py-0.5 rounded-full border transition-all ${!activeSpeakerFilter ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`} onClick={() => setActiveSpeakerFilter(null)}>
                הכל ({result.segments.length})
              </button>
              {result.speakers.map((sp, i) => {
                const count = result.segments.filter(s => s.speaker_label === sp).length;
                return (
                  <button key={sp} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${activeSpeakerFilter === sp ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`}
                    onClick={() => setActiveSpeakerFilter(activeSpeakerFilter === sp ? null : sp)}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SPEAKER_BAR_COLORS[i % SPEAKER_BAR_COLORS.length] }} />
                    {getSpeakerName(sp)} ({count})
                  </button>
                );
              })}
            </div>

            {searchQuery && <div className="text-xs text-muted-foreground mb-1">{editableTranscriptSegments.length} תוצאות עבור "{searchQuery}"</div>}
            <div className="text-[11px] text-muted-foreground mb-2">
              עריכה ידנית: אפשר לשנות שיוך דובר, לערוך טקסט, לפצל קטע או לאחד עם הקטע הבא.
            </div>

            <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
              {editableTranscriptSegments.map(({ seg, segIdx }) => {
                const colorIdx = speakerIndex[seg.speaker_label] ?? 0;
                const isActive = currentTime >= seg.start && currentTime <= seg.end;
                const isTextEditing = editingSegmentIdx === segIdx;
                const role = speakerRoles[seg.speaker_label];
                const roleLabel = role ? SPEAKER_ROLE_OPTIONS.find(r => r.value === role)?.label : null;
                return (
                  <div key={segIdx} className={`p-2.5 rounded-xl border text-sm transition-all ${
                    isActive ? SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length] + " ring-2 ring-primary/40 shadow-sm" : SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length]
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {audioUrl && (
                        <button onClick={e => { e.stopPropagation(); playSegment(segIdx, seg.start, seg.end); }}
                          className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                            playingSegIdx === segIdx ? "bg-primary text-primary-foreground shadow-md" : "bg-muted hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                          }`}>
                          {playingSegIdx === segIdx ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      )}
                      <span className={`w-2.5 h-2.5 rounded-full ${SPEAKER_BADGE_COLORS[colorIdx % SPEAKER_BADGE_COLORS.length]}`} />
                      <span className="font-semibold text-xs">{getSpeakerName(seg.speaker_label)}</span>
                      {roleLabel && <Badge variant="outline" className="text-[9px] py-0 h-4">{roleLabel}</Badge>}
                      <span className="text-xs text-muted-foreground">{formatTime(seg.start)} – {formatTime(seg.end)}</span>
                      <span className="text-[10px] text-muted-foreground mr-auto">{formatDuration(seg.end - seg.start)}</span>
                    </div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">שיוך דובר:</span>
                      <Select value={seg.speaker_label} onValueChange={(value) => updateSegmentSpeaker(segIdx, value)}>
                        <SelectTrigger className="h-7 w-[150px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {result.speakers.map(sp => (
                            <SelectItem key={sp} value={sp} className="text-xs">{getSpeakerName(sp)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditingBoundary({ segIdx, edge: 'start' });
                          setEditingBoundaryValue(seg.start.toFixed(2));
                        }}
                      >
                        ערוך זמן
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => startEditingSegmentText(segIdx)}
                      >
                        ערוך טקסט
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => splitSegment(segIdx)}
                      >
                        פצל
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={segIdx >= result.segments.length - 1}
                        onClick={() => mergeWithNextSegment(segIdx)}
                      >
                        אחד עם הבא
                      </Button>
                    </div>
                    {isTextEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingSegmentText}
                          onChange={e => setEditingSegmentText(e.target.value)}
                          className="min-h-[80px] text-sm"
                          dir="rtl"
                          onKeyDown={e => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                              e.preventDefault();
                              saveSegmentTextEdit();
                            }
                            if (e.key === 'Escape') {
                              setEditingSegmentIdx(null);
                              setEditingSegmentText("");
                            }
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={saveSegmentTextEdit}>
                            <Check className="w-3 h-3 ml-1" />שמור טקסט
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setEditingSegmentIdx(null);
                              setEditingSegmentText("");
                            }}
                          >
                            <X className="w-3 h-3 ml-1" />ביטול
                          </Button>
                          <span className="text-[10px] text-muted-foreground">Ctrl+Enter לשמירה</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-right leading-relaxed">{highlightText(seg.text)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* === AI Tab === */}
          <TabsContent value="ai">
            <DiarizationAI
              result={result}
              speakerNames={speakerNames}
              openaiKey={cloudKeys.openai_key}
              onSegmentsUpdate={handleSegmentsUpdate}
              onSeek={seekTo}
            />
          </TabsContent>

          {/* === Notes Tab === */}
          <TabsContent value="notes">
            <DiarizationNotes
              segments={displaySegments}
              notes={segmentNotes}
              onNotesChange={setSegmentNotes}
              speakerNames={speakerNames}
              onSeek={seekTo}
            />
          </TabsContent>

          {/* === Merge Tab === */}
          <TabsContent value="merge" className="space-y-4">
            <div className="text-sm text-muted-foreground">שלב את תוצאות זיהוי הדוברים עם תמלול קיים.</div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">בחר תמלול מהענן</Label>
              {isLoadingTranscripts ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />טוען...</div>
              ) : transcriptList.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  <p>אין תמלולים שמורים.</p>
                  <Button variant="outline" size="sm" className="mt-1 text-xs" onClick={loadTranscriptsForMerge}>רענן</Button>
                </div>
              ) : (
                <div className="border rounded-lg max-h-[180px] overflow-y-auto divide-y">
                  {transcriptList.map(t => (
                    <button key={t.id} className="w-full text-right p-2 hover:bg-muted/50 transition-colors text-sm flex justify-between items-center gap-2"
                      onClick={() => { setSelectedTranscriptId(t.id); mergeWithTranscript(t.text); }}>
                      <div className="flex-1 truncate">
                        <span className="font-medium">{t.title || "ללא כותרת"}</span>
                        <span className="text-xs text-muted-foreground mr-2 truncate">{t.text.slice(0, 60)}...</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(t.created_at).toLocaleDateString("he-IL")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">או הדבק טקסט ידנית</Label>
              <textarea className="w-full min-h-[100px] p-3 rounded-lg border bg-background text-sm resize-y" placeholder="הדבק כאן טקסט תמלול..." dir="rtl"
                onBlur={(e) => { if (e.target.value.trim()) mergeWithTranscript(e.target.value.trim()); }} />
            </div>
            {mergedText && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">תוצאה משולבת</Label>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => { navigator.clipboard.writeText(mergedText); toast({ title: "הועתק" }); }}>
                      <Copy className="w-3.5 h-3.5" />העתק
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => downloadBlob(new Blob(["\uFEFF" + mergedText], { type: "text/plain;charset=utf-8" }), `merged-${Date.now()}.txt`)}>
                      <Download className="w-3.5 h-3.5" />הורד
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg p-3 bg-muted/20 max-h-[400px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap" dir="rtl">{mergedText}</div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="compare" className="space-y-4">
            {/* Quick compare: run with multiple engines */}
            {preloadedFileRef.current && (
              <div className="border rounded-xl p-3 bg-muted/20 space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4 text-primary" />
                  הרץ זיהוי עם מנועים שונים והשווה
                </Label>
                <p className="text-xs text-muted-foreground">
                  לחץ על מנוע כדי להריץ זיהוי ולהוסיף אוטומטית להשוואה. הקובץ: <span className="font-medium">{currentFileName}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { value: 'browser' as DiarizationMode, label: 'דפדפן', icon: Globe },
                    { value: 'whisperx' as DiarizationMode, label: 'WhisperX', icon: Mic },
                    { value: 'assemblyai' as DiarizationMode, label: 'AssemblyAI', icon: Cloud },
                    { value: 'deepgram' as DiarizationMode, label: 'Deepgram', icon: Cloud },
                    { value: 'openai' as DiarizationMode, label: 'OpenAI', icon: Cloud },
                    { value: 'local' as DiarizationMode, label: 'מקומי', icon: Server },
                  ]).map(eng => {
                    const alreadyRan = compareEntries.some(e => e.label === eng.label);
                    return (
                      <Button
                        key={eng.value}
                        variant={alreadyRan ? 'secondary' : 'outline'}
                        size="sm"
                        className="text-xs gap-1"
                        disabled={isProcessing}
                        onClick={async () => {
                          if (!preloadedFileRef.current) return;
                          const prevMode = mode;
                          setMode(eng.value);
                          // Brief delay for state update, then run
                          await new Promise(r => setTimeout(r, 50));
                          // Run diarization and auto-add to compare
                          compareRunRef.current = eng.label;
                          handleDiarize(preloadedFileRef.current!);
                        }}
                      >
                        <eng.icon className="w-3.5 h-3.5" />
                        {eng.label}
                        {alreadyRan && <Check className="w-3 h-3 text-green-600" />}
                      </Button>
                    );
                  })}
                </div>
                {isProcessing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    מריץ זיהוי...
                  </div>
                )}
              </div>
            )}

            <DiarizationCompare entries={compareEntries} />
            {compareEntries.length >= 2 && (
              <Button variant="default" size="sm" className="mt-2 text-xs gap-1.5" onClick={() => navigate('/diarization/compare', { state: { entries: compareEntries, audioUrl } })}>
                <Maximize2 className="w-3.5 h-3.5" />
                פתח השוואה מלאה
              </Button>
            )}
            {compareEntries.length > 0 && (
              <Button variant="ghost" size="sm" className="mt-2 text-xs text-destructive" onClick={() => setCompareEntries([])}>
                <X className="w-3 h-3 ml-1" />נקה השוואה
              </Button>
            )}
          </TabsContent>
        </Tabs>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        {mode === 'local' ? 'זיהוי דוברים מקומי. לזיהוי מדויק יותר, הזן HuggingFace Token.'
          : mode === 'openai' ? 'זיהוי דוברים דרך OpenAI Whisper עם חותמות זמן מדויקות.'
          : mode === 'whisperx' ? 'WhisperX — תמלול + זיהוי דוברים משולב באיכות גבוהה.'
          : `זיהוי דוברים דרך ${mode === 'assemblyai' ? 'AssemblyAI' : mode === 'deepgram' ? 'Deepgram' : mode} בענן.`
        }
      </p>
    </Card>
  );
};
