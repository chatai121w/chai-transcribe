/**
 * SyncMirrorLayout — Dual-panel synchronized transcript view.
 *
 * Guarantees IDENTICAL words-per-line on both panels by computing
 * line breaks once via canvas measureText(), then rendering both
 * columns from the same `lines` array.
 *
 * - Right column: "תמלול מסונכרן" — read-only, timing highlight
 * - Left column:  "עריכה מסונכרנת" — right-click any word to replace/delete;
 *                  "עריכה מלאה" button opens a textarea overlay for bulk edits
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Edit3, AlignRight, Link, Unlink, Check, X, Type, Save, Copy, Eye, EyeOff, Sparkles, Minus, Rows3, Zap, Cpu, LineChart, ChevronDown, Brain, History, Bookmark, GitCompare, Lock, Unlock, CircleDot, Circle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { WordTiming } from "./SyncAudioPlayer";
import { useTextMarking } from "@/hooks/useTextMarking";
import { addDictionaryReplacement, addIgnoredWord } from "@/utils/hebrewGrammarDictionary";
import { WordContextMenu } from "@/components/WordContextMenu";
import { alignEditedToWhisper } from "@/lib/whisperAlignment";
import { getWordHighlightStyle, isWordApproved } from "@/lib/personalPronunciationModel";
import { RichTextEditor } from "@/components/RichTextEditor";
import { TextMarkingOverlay } from "@/components/TextMarkingOverlay";

interface SyncMirrorLayoutProps {
  wordTimings: WordTiming[];
  currentTime: number;
  text: string;
  onTextChange: (text: string) => void;
  onWordReplace: (wordIndex: number, replacement: string) => void;
  onWordClick: (time: number) => void;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  syncEnabled?: boolean;
  searchQuery?: string;
  searchActiveIndex?: number;
  onSearchMatchCount?: (count: number) => void;
  onSaveReplace?: () => void;
  onDuplicateSave?: (newName: string) => void;
  learningProfiles?: Array<{ id: string; name: string }>;
  learningEnabled?: boolean;
  onSaveLearning?: (payload: {
    editedText: string;
    profileId: string;
    mode: 'quick' | 'advanced';
    note?: string;
  }) => Promise<boolean | void> | boolean | void;
  /** When true, the LEFT column renders the full text editor (TextMarkingOverlay + RichTextEditor)
   *  instead of the per-word click/right-click view. */
  enableRichEdit?: boolean;
  /** Fired when RichTextEditor auto-corrects a word (for logging/learning). */
  onWordCorrected?: (original: string, corrected: string) => void;
  /** Optional column style passed to RichTextEditor. */
  richColumnStyle?: React.CSSProperties;
}

function normalizeWord(w: string) {
  return w.replace(/[.,;:!?"'׳״()\[\]{}<>\-–—]/g, "").trim();
}

const FONT_FAMILIES = [
  { value: "Assistant",        label: "Assistant" },
  { value: "Rubik",            label: "Rubik" },
  { value: "Heebo",            label: "Heebo" },
  { value: "Frank Ruhl Libre", label: "Frank Ruhl Libre" },
  { value: "David Libre",      label: "David Libre" },
  { value: "Noto Sans Hebrew", label: "Noto Sans Hebrew" },
  { value: "Arial",            label: "Arial" },
  { value: "system-ui",        label: "מערכת" },
];

// ──────────────────────────────────────────────────────────────────────────────
export const SyncMirrorLayout = ({
  wordTimings,
  currentTime,
  text,
  onTextChange,
  onWordReplace,
  onWordClick,
  fontSize = 18,
  fontFamily = "Assistant",
  lineHeight = 1.6,
  syncEnabled = true,
  searchQuery,
  searchActiveIndex,
  onSearchMatchCount,
  onSaveReplace,
  onDuplicateSave,
  learningProfiles = [],
  learningEnabled = true,
  onSaveLearning,
  enableRichEdit = false,
  onWordCorrected,
  richColumnStyle,
}: SyncMirrorLayoutProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leftRichRef = useRef<HTMLDivElement>(null);
  const leftRowsRef = useRef<HTMLDivElement>(null);
  const [isMarkingActive, setIsMarkingActive] = useState(false);
  const [rightTopOffset, setRightTopOffset] = useState(0);
  // "Precise row alignment" — when true (default), left column renders via the
  // SAME canvas-measured `lines` as the right column, guaranteeing row-for-row
  // horizontal alignment at any viewport. When false, falls back to free-form
  // contentEditable rich editing (line breaks differ between columns).
  const [preciseAlign, setPreciseAlign] = useState<boolean>(() => {
    try { return localStorage.getItem('sync_mirror_precise_align') !== '0'; } catch { return true; }
  });
  const togglePreciseAlign = () => {
    setPreciseAlign(v => {
      const next = !v;
      try { localStorage.setItem('sync_mirror_precise_align', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const effectiveRichEdit = enableRichEdit && !preciseAlign;

  const [colWidth, setColWidth] = useState(0);
  const [fullEditMode, setFullEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState(text);

  // ── Duplicate & save dialog ───────────────────────────────────────────────
  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [dupName, setDupName] = useState("");

  // ── Save-to-learning dialogs ───────────────────────────────────────────────
  const [learnPickerOpen, setLearnPickerOpen] = useState(false);
  const [learnConfirmOpen, setLearnConfirmOpen] = useState(false);
  const [learnMode, setLearnMode] = useState<'quick' | 'advanced'>('quick');
  const [learnProfileId, setLearnProfileId] = useState('');
  const [learnNote, setLearnNote] = useState('');
  const [learnSaving, setLearnSaving] = useState(false);

  // ── Local typography overrides (start from props, user can adjust) ──────────
  const [localFontFamily, setLocalFontFamily] = useState(fontFamily);
  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const [localLineHeight, setLocalLineHeight] = useState(lineHeight ?? 1.6);
  const [localWordSpacing, setLocalWordSpacing] = useState(0); // px extra
  const [localLetterSpacing, setLocalLetterSpacing] = useState(0); // px extra
  const [localFontWeight, setLocalFontWeight] = useState<number>(400);
  const [localTextColor, setLocalTextColor] = useState<string>("");

  // Measure the left column's real first-text surface so the right column starts
  // on the same pixel line even when the left side has marking/edit toolbars.
  useEffect(() => {
    if (!enableRichEdit || fullEditMode) { setRightTopOffset(0); return; }
    const wrapper = leftRichRef.current;
    const scroller = scrollRef.current;
    if (!wrapper || !scroller) return;
    let raf = 0;
    const measure = () => {
      const editable = wrapper.querySelector('[contenteditable="true"]') as HTMLElement | null;
      const firstPreciseLine = leftRowsRef.current?.querySelector<HTMLElement>('[data-line="0"]') ?? null;
      const target = effectiveRichEdit ? editable : firstPreciseLine;
      const anchor = target ?? wrapper;
      const diff = Math.max(0, Math.round(anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop));
      setRightTopOffset(diff);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(wrapper);
    ro.observe(scroller);
    window.addEventListener('resize', schedule);
    const t = window.setInterval(schedule, 800); // catch async toolbar/spell changes
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); window.clearInterval(t); cancelAnimationFrame(raf); };
  }, [enableRichEdit, effectiveRichEdit, fullEditMode, isMarkingActive, localFontSize, localFontFamily, localLineHeight, preciseAlign]);


  // ── User timing anchors ────────────────────────────────────────────────────
  // Map: edited word index → pinned {start, end} timing
  // User right-clicks a word → "סמן כעוגן" → pinned to current displayTimings
  const [userAnchors, setUserAnchors] = useState<Map<number, { start: number; end: number }>>(new Map());

  const toggleUserAnchor = useCallback((wordIdx: number, currentTiming: { start: number; end: number }) => {
    setUserAnchors(prev => {
      const next = new Map(prev);
      if (next.has(wordIdx)) {
        next.delete(wordIdx);
      } else {
        next.set(wordIdx, currentTiming);
      }
      return next;
    });
  }, []);

  // ── Alignment mode ─────────────────────────────────────────────────────────
  // 'auto'  = exact match → Whisper timings, edited → LCS (recommended)
  // 'whisper' = always use original Whisper (best when unchanged, worst when heavily edited)
  // 'lcs'  = always run LCS even on unchanged text (most CPU, maximum fuzzy tolerance)
  type AlignMode = 'auto' | 'whisper' | 'lcs';
  const [alignMode, setAlignMode] = useState<AlignMode>('auto');

  // ── Rebuild display timings proportionally from current edited text ─────────
  const displayTimings = useMemo((): WordTiming[] => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (!wordTimings.length) return words.map((word, i) => ({ word, start: i, end: i + 1 }));

    // Convert userAnchors Map → UserAnchor[] for the alignment function
    const anchorsArr = Array.from(userAnchors.entries()).map(([editedIdx, { start, end }]) => ({
      editedIdx, start, end,
    }));

    // ── MODE: whisper ─────────────────────────────────────────────────────
    // Use Whisper timings directly — only works when word count matches exactly
    if (alignMode === 'whisper') {
      if (wordTimings.length === words.length && anchorsArr.length === 0) {
        return wordTimings.map((wt, i) => ({ ...wt, word: words[i] }));
      }
      // Has user anchors or count mismatch → fall through to LCS
      return alignEditedToWhisper(words, wordTimings, anchorsArr.length ? anchorsArr : undefined);
    }

    // ── MODE: lcs ────────────────────────────────────────────────────────
    // Always run LCS anchor interpolation regardless of word count match
    if (alignMode === 'lcs') {
      return alignEditedToWhisper(words, wordTimings, anchorsArr.length ? anchorsArr : undefined);
    }

    // ── MODE: auto (default) ─────────────────────────────────────────────
    // Exact count + no user anchors → Whisper (zero cost, perfect accuracy)
    // Otherwise → LCS (anchors stay correct, interpolation only in gaps)
    if (wordTimings.length === words.length && anchorsArr.length === 0) {
      return wordTimings.map((wt, i) => ({ ...wt, word: words[i] }));
    }
    return alignEditedToWhisper(words, wordTimings, anchorsArr.length ? anchorsArr : undefined);
  }, [text, wordTimings, alignMode, userAnchors]);

  // ── ResizeObserver: watch container width → column width ───────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // Two equal flex columns, each with 16px horizontal padding
      setColWidth(Math.floor(entry.contentRect.width / 2) - 32);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Canvas-measured line breaks ─────────────────────────────────────────────
  const lines = useMemo((): WordTiming[][] => {
    if (!displayTimings.length) return [];

    // Fallback width estimate before ResizeObserver fires
    const effectiveWidth = colWidth > 0 ? colWidth : 400;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return [displayTimings];
    ctx.font = `${localFontWeight} ${localFontSize}px ${localFontFamily}`;
    const spaceW = ctx.measureText(" ").width + 1 + localWordSpacing;

    const result: WordTiming[][] = [];
    let line: WordTiming[] = [];
    let w = 0;

    for (const wt of displayTimings) {
      // letter spacing adds (word.length * letterSpacing) to each word's width
      const ww = ctx.measureText(wt.word).width + spaceW + wt.word.length * localLetterSpacing;
      if (w + ww > effectiveWidth && line.length > 0) {
        result.push(line);
        line = [wt];
        w = ww;
      } else {
        line.push(wt);
        w += ww;
      }
    }
    if (line.length) result.push(line);
    return result;
  }, [displayTimings, colWidth, localFontSize, localFontFamily, localWordSpacing, localLetterSpacing, localFontWeight]);

  // ── Active word index (timing sync) ────────────────────────────────────────
  const activeIdx = useMemo(() => {
    if (!syncEnabled || !displayTimings.length) return -1;
    for (let i = displayTimings.length - 1; i >= 0; i--) {
      if (currentTime >= displayTimings[i].start) return i;
    }
    return -1;
  }, [displayTimings, currentTime, syncEnabled]);

  // ── Active line index ───────────────────────────────────────────────────────
  const activeLineIdx = useMemo(() => {
    if (activeIdx < 0) return -1;
    let offset = 0;
    for (let li = 0; li < lines.length; li++) {
      if (activeIdx < offset + lines[li].length) return li;
      offset += lines[li].length;
    }
    return -1;
  }, [activeIdx, lines]);

  // ── Auto-scroll to active line ──────────────────────────────────────────────
  useEffect(() => {
    if (activeLineIdx < 0 || !syncEnabled) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-line="${activeLineIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeLineIdx, syncEnabled]);

  // ── Search highlighting ─────────────────────────────────────────────────────
  const searchMatchList = useMemo(() => {
    if (!searchQuery?.trim()) return [] as number[];
    const q = searchQuery.trim().toLowerCase();
    return displayTimings.reduce<number[]>((acc, wt, i) => {
      if (wt.word.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [displayTimings, searchQuery]);

  const activeSearchGlobalIdx = searchMatchList[searchActiveIndex ?? 0] ?? -1;

  useEffect(() => {
    onSearchMatchCount?.(searchMatchList.length);
  }, [searchMatchList.length, onSearchMatchCount]);

  // ── Spell / marking (left side only) ───────────────────────────────────────
  const leftWords = useMemo(() => displayTimings.map((wt) => wt.word), [displayTimings]);
  const marking = useTextMarking(leftWords, onWordReplace);

  // ── Word replace helper (used by WordContextMenu) ───────────────────────
  const [dictionaryVersion, setDictionaryVersion] = useState(0);

  const applyWordReplace = useCallback(
    (globalIdx: number, next: string) => {
      if (next === "__DELETE__") {
        onWordReplace(globalIdx, "__DELETE__");
        const clean = normalizeWord(displayTimings[globalIdx]?.word ?? "");
        if (clean) addIgnoredWord(clean);
      } else {
        const fixed = next.trim();
        if (fixed && fixed !== displayTimings[globalIdx]?.word) {
          onWordReplace(globalIdx, fixed);
          const clean = normalizeWord(displayTimings[globalIdx]?.word ?? "");
          if (clean) addDictionaryReplacement(clean, fixed);
        }
      }
    },
    [displayTimings, onWordReplace],
  );

  // ── Per-column word-highlight toggle + style ──────────────────────────────
  const [rightWordHighlightOn, setRightWordHighlightOn] = useState(true);
  const [leftWordHighlightOn, setLeftWordHighlightOn] = useState(true);
  // 'word' = background pill | 'underline' = underline only | 'line' = full row | 'glow' = ring glow
  type HighlightMode = 'word' | 'underline' | 'line' | 'glow';
  const [wordHighlightMode, setWordHighlightMode] = useState<HighlightMode>('word');
  // Per-mode highlight color & opacity
  const [hlColors, setHlColors] = useState<Record<HighlightMode, string>>({
    word: '#3b82f6', underline: '#3b82f6', line: '#3b82f6', glow: '#3b82f6',
  });
  const [hlOpacity, setHlOpacity] = useState<Record<HighlightMode, number>>({
    word: 100, underline: 100, line: 25, glow: 70,
  });
  // Underline sub-settings
  const [underlineStyle, setUnderlineStyle] = useState<'solid' | 'dashed' | 'dotted' | 'wavy' | 'double'>('solid');
  const [underlineWidth, setUnderlineWidth] = useState(2);
  // Word background sub-settings
  const [wordRadius, setWordRadius] = useState<'none' | 'sm' | 'full'>('sm');
  // Line mode sub-settings
  const [lineLeftOnly, setLineLeftOnly] = useState(false);

  // ── Compare mode: freeze right panel at a snapshot ────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [frozenTimings, setFrozenTimings] = useState<WordTiming[]>([]);

  const toggleCompareMode = useCallback(() => {
    setCompareMode(v => {
      if (!v) {
        // Entering compare mode — snapshot the current displayTimings
        setFrozenTimings([...displayTimings]);
      }
      return !v;
    });
  }, [displayTimings]);

  // Lines for the frozen (right) panel in compare mode
  const frozenLines = useMemo((): WordTiming[][] => {
    if (!compareMode || !frozenTimings.length) return [];
    const effectiveWidth = colWidth > 0 ? colWidth : 400;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return [frozenTimings];
    ctx.font = `${localFontWeight} ${localFontSize}px ${localFontFamily}`;
    const spaceW = ctx.measureText(" ").width + 1 + localWordSpacing;
    const result: WordTiming[][] = [];
    let line: WordTiming[] = [];
    let w = 0;
    for (const wt of frozenTimings) {
      const ww = ctx.measureText(wt.word).width + spaceW + wt.word.length * localLetterSpacing;
      if (w + ww > effectiveWidth && line.length > 0) {
        result.push(line);
        line = [wt];
        w = ww;
      } else {
        line.push(wt);
        w += ww;
      }
    }
    if (line.length) result.push(line);
    return result;
  }, [compareMode, frozenTimings, colWidth, localFontSize, localFontFamily, localWordSpacing, localLetterSpacing, localFontWeight]);

  // ── Baseline (original) snapshot — set once on first non-empty mount, persisted ──
  const BASELINE_KEY = 'sync_mirror_baseline_v1';
  const baselineInitRef = useRef(false);
  const [baselineText, setBaselineText] = useState<string>(() => {
    try { return localStorage.getItem(BASELINE_KEY) || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (baselineInitRef.current) return;
    if (!text || !text.trim()) return;
    baselineInitRef.current = true;
    if (!baselineText) {
      try { localStorage.setItem(BASELINE_KEY, text); } catch {}
      setBaselineText(text);
    }
  }, [text, baselineText]);

  const hasBaseline = !!baselineText && baselineText.trim().length > 0;
  const isModifiedFromBaseline = hasBaseline && baselineText.trim() !== text.trim();

  const restoreToBaseline = useCallback(() => {
    if (!hasBaseline) return;
    if (!confirm('להחזיר את הטקסט לגרסת הבסיס? כל השינויים מאז יאבדו.')) return;
    onTextChange(baselineText);
    toast({ title: 'הוחזר לגרסת בסיס', description: 'הטקסט שוחזר למצב המקורי שנשמר.' });
  }, [hasBaseline, baselineText, onTextChange]);

  const setNewBaseline = useCallback(() => {
    if (!text || !text.trim()) return;
    try { localStorage.setItem(BASELINE_KEY, text); } catch {}
    setBaselineText(text);
    toast({ title: 'בסיס חדש נקבע', description: 'הטקסט הנוכחי הוגדר כגרסת הבסיס.' });
  }, [text]);

  const compareToBaseline = useCallback(() => {
    if (!hasBaseline) return;
    // Snapshot the baseline as the frozen panel and enter compare mode
    const words = baselineText.trim().split(/\s+/).filter(Boolean);
    const baselineTimings: WordTiming[] = words.map((word, i) => ({ word, start: i, end: i + 1 }));
    setFrozenTimings(baselineTimings);
    setCompareMode(true);
    toast({ title: 'משווה לגרסת בסיס', description: 'הצד הימני מציג כעת את גרסת הבסיס.' });
  }, [hasBaseline, baselineText]);

  // Wrap onSaveReplace with a unified local+cloud toast
  const handleSaveLocalAndCloud = useCallback(() => {
    if (!onSaveReplace) return;
    try {
      onSaveReplace();
      toast({ title: 'נשמר ✓', description: 'מקומי + ענן יחד.' });
    } catch (e) {
      toast({ title: 'השמירה נכשלה', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }, [onSaveReplace]);


  // ── Full-text editing overlay ───────────────────────────────────────────────
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTextSync = useCallback((draft: string) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => { onTextChange(draft); }, 10000);
  }, [onTextChange]);

  const flushTextSync = useCallback((draft: string) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    onTextChange(draft);
  }, [onTextChange]);

  useEffect(() => () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); }, []);

  const openFullEdit = () => {
    setEditDraft(text);
    setFullEditMode(true);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  };
  const saveFullEdit = () => {
    onTextChange(editDraft.trim());
    setFullEditMode(false);
  };
  const cancelFullEdit = () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setFullEditMode(false);
  };

  // ── Shared text style ───────────────────────────────────────────────────────
  const textStyle: React.CSSProperties = {
    fontFamily: localFontFamily,
    fontSize: `${localFontSize}px`,
    lineHeight: localLineHeight,
    wordSpacing: `${localWordSpacing}px`,
    letterSpacing: `${localLetterSpacing}px`,
    fontWeight: localFontWeight,
    ...(localTextColor ? { color: localTextColor } : {}),
  };

  const selectedLearningProfile = useMemo(
    () => learningProfiles.find((p) => p.id === learnProfileId),
    [learningProfiles, learnProfileId],
  );

  const editedTextForLearning = useMemo(
    () => (fullEditMode ? editDraft : text).trim(),
    [fullEditMode, editDraft, text],
  );

  const openLearningPicker = useCallback((mode: 'quick' | 'advanced') => {
    if (!onSaveLearning) return;
    setLearnMode(mode);
    setLearnProfileId('');
    setLearnNote('');
    setLearnPickerOpen(true);
  }, [onSaveLearning]);

  const continueToLearningConfirm = useCallback(() => {
    if (!learnProfileId || !editedTextForLearning || !learningEnabled) return;
    setLearnPickerOpen(false);
    setLearnConfirmOpen(true);
  }, [learnProfileId, editedTextForLearning, learningEnabled]);

  const submitLearning = useCallback(async () => {
    if (!onSaveLearning || !learnProfileId || !editedTextForLearning) return;
    setLearnSaving(true);
    try {
      const ok = await onSaveLearning({
        editedText: editedTextForLearning,
        profileId: learnProfileId,
        mode: learnMode,
        note: learnMode === 'advanced' ? (learnNote.trim() || undefined) : undefined,
      });
      if (ok !== false) {
        setLearnConfirmOpen(false);
        setLearnProfileId('');
        setLearnNote('');
      }
    } finally {
      setLearnSaving(false);
    }
  }, [onSaveLearning, learnProfileId, editedTextForLearning, learnMode, learnNote]);

  // ── Highlight helpers ─────────────────────────────────────────────────────
  const hexToRgba = (hex: string, opacityPct: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacityPct / 100})`;
  };

  const getActiveWordStyle = (mode: HighlightMode): React.CSSProperties => {
    const color = hlColors[mode];
    const op = hlOpacity[mode];
    if (mode === 'word') {
      const radMap = { none: '0px', sm: '4px', full: '999px' } as const;
      return { backgroundColor: hexToRgba(color, op), color: '#fff', borderRadius: radMap[wordRadius] };
    }
    if (mode === 'underline') return {
      textDecoration: `underline ${underlineStyle}`,
      textDecorationColor: hexToRgba(color, op),
      textDecorationThickness: underlineWidth + 'px',
    };
    if (mode === 'glow')      return { boxShadow: `0 0 0 2px ${hexToRgba(color, op)}, 0 0 8px ${hexToRgba(color, Math.round(op * 0.5))}` };
    return {}; // line — no per-word style
  };

  // ── Render a single line row for one column ─────────────────────────────────
  const renderLine = (
    line: WordTiming[],
    lineOffset: number,
    lineIdx: number,
    side: "left" | "right",
  ) => {
    const isActiveLine = lineIdx === activeLineIdx;
    const wordHighlightOn = side === "right" ? rightWordHighlightOn : leftWordHighlightOn;
    const showLineMode = wordHighlightMode === 'line' && isActiveLine && wordHighlightOn;
    const showSubtleLine = wordHighlightMode !== 'line' && isActiveLine;
    return (
      <div
        key={lineIdx}
        data-line={lineIdx}
        dir="rtl"
        className={cn(
          "min-h-[1.4em] py-[1px] rounded-sm transition-colors",
          showSubtleLine && side === "right" && "bg-primary/8",
          showSubtleLine && side === "left" && "bg-blue-50 dark:bg-blue-950/30",
        )}
        style={showLineMode && (!lineLeftOnly || side === "left")
          ? { backgroundColor: hexToRgba(hlColors.line, hlOpacity.line) }
          : undefined}
      >
        {line.map((wt, wi) => {
          const globalIdx = lineOffset + wi;
          const isActive = globalIdx === activeIdx;
          const isSearchActive = globalIdx === activeSearchGlobalIdx;
          const isSearchMatch = !isSearchActive && searchMatchList.includes(globalIdx);
          const hasIssue =
            side === "left" && marking.getWordMarkingStyle(globalIdx) !== "";

          const wordApproved = side === "left" && isWordApproved(wt.word);
          const highlightStyle = side === "left" ? getWordHighlightStyle(wt.word) : undefined;
          const wordHasIssue = hasIssue && !wordApproved;
          const { localIssueMap, resultMap } = marking;
          const suggestions = side === "left" && wordHasIssue
            ? [
                ...(localIssueMap.get(globalIdx) ?? []).map((s) => s.text),
                ...(resultMap.get(globalIdx)?.suggestion ? [resultMap.get(globalIdx)!.suggestion!] : []),
              ]
            : [];

          const wordHighlightOn = side === "right" ? rightWordHighlightOn : leftWordHighlightOn;
          const isActiveVisible = isActive && wordHighlightOn;
          const isAnchor = userAnchors.has(globalIdx);

          const wordSpan = (
            <span
              key={globalIdx}
              style={{ ...highlightStyle, ...(isActiveVisible ? getActiveWordStyle(wordHighlightMode) : {}) }}
              className={cn(
                "inline cursor-pointer select-text transition-all px-[1px]",
                // base rounding only when NOT active-word (active word controls its own radius via style)
                !isActiveVisible && "rounded-sm",
                side === "left" && !isActive && "hover:bg-muted/70",
                // anchor indicator
                isAnchor && "ring-1 ring-amber-400 ring-offset-[1px]",
                // active word structural classes (no color — handled by inline style)
                isActiveVisible && wordHighlightMode === 'word' && "font-bold",
                isActiveVisible && wordHighlightMode === 'underline' && "font-semibold",
                isActiveVisible && wordHighlightMode === 'glow' && "rounded-sm font-bold",
                // line mode: no word-level highlight, line bg handles it
                !isActive && isSearchActive && "bg-yellow-400 dark:bg-yellow-600 rounded-sm",
                !isActive && isSearchMatch && "bg-yellow-200 dark:bg-yellow-800 rounded-sm",
                !isActive && wordHasIssue && "underline decoration-red-500 decoration-wavy underline-offset-2",
              )}
              onClick={() => onWordClick(wt.start)}
              title={isAnchor ? `⚓ עוגן (${wt.start.toFixed(2)}s) — קליק לקפיצה` : `קליק לקפיצה (${wt.start.toFixed(1)}s)`}
            >
              {isAnchor && <span className="text-amber-500 text-[8px] me-[1px] select-none">⚓</span>}
              {wt.word}
            </span>
          );

          return (
            <React.Fragment key={globalIdx}>
              {side === "left" ? (
                <WordContextMenu
                  word={wt.word}
                  suggestions={suggestions}
                  onReplace={(next) => { applyWordReplace(globalIdx, next); setDictionaryVersion((v) => v + 1); }}
                  onApproveAsCorrect={() => setDictionaryVersion((v) => v + 1)}
                  isAnchor={isAnchor}
                  onToggleAnchor={() => toggleUserAnchor(globalIdx, { start: wt.start, end: wt.end })}
                >
                  {wordSpan}
                </WordContextMenu>
              ) : wordSpan}
              {' '}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!displayTimings.length) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm" dir="rtl">
        <AlignRight className="w-10 h-10 mx-auto mb-3 opacity-30" />
        נדרש תמלול עם תזמונים
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="flex flex-col h-full relative overflow-hidden">
      {/* Full-text edit — two-panel side-by-side (replaces old overlay) */}
      {fullEditMode && (
        <div className="flex flex-col flex-1 min-h-0" dir="rtl">
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/10 shrink-0 gap-3">
            <span className="text-sm font-semibold">עריכת טקסט מלאה</span>
            <span className="text-[11px] text-muted-foreground">מתעדכן אוטומטית אחרי 10 שניות או בסיום מילה</span>
            <div className="flex gap-2 ms-auto shrink-0">
              {onSaveLearning && (
                <div className="inline-flex items-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openLearningPicker('quick')}
                    disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}
                    title="שמור ללמידה עם בחירת פרופיל"
                    className="rounded-e-none"
                  >
                    <Brain className="w-3.5 h-3.5 me-1" />
                    שמור ללמידה
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-s-none border-s-0 px-2"
                        disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}
                        title="אפשרויות שמירה ללמידה"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-xs">
                      <DropdownMenuItem onClick={() => openLearningPicker('quick')}>
                        שמירה מהירה ללמידה
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openLearningPicker('advanced')}>
                        שמירה מתקדמת (עם הערה)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              <Button size="sm" variant="default" onClick={saveFullEdit}>
                <Check className="w-3.5 h-3.5 me-1" />
                שמור
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelFullEdit}>
                <X className="w-3.5 h-3.5 me-1" />
                ביטול
              </Button>
            </div>
          </div>
          {/* Two panels */}
          <div className="flex flex-1 min-h-0">
            {/* Right (RTL) — original text with live sync highlight */}
            <div className="flex-1 min-w-0 flex flex-col border-s border-border/40">
              <div className="px-3 py-1.5 border-b border-border/20 bg-muted/10 text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1.5">
                תמלול מקורי
                <span className="text-[9px] opacity-60">(לעיון בלבד)</span>
                {activeIdx >= 0 && (
                  <span className="ms-auto text-[10px] tabular-nums text-blue-500 font-medium">
                    {displayTimings[activeIdx]?.start.toFixed(1)}s
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {activeIdx >= 0 && (
                <div className="h-0.5 bg-muted shrink-0">
                  <div
                    className="h-full bg-blue-400 transition-all duration-300"
                    style={{ width: `${(activeIdx / Math.max(displayTimings.length - 1, 1)) * 100}%` }}
                  />
                </div>
              )}
              <div
                className="flex-1 overflow-y-auto break-words select-none text-muted-foreground/80"
                dir="rtl"
                style={{ ...textStyle, padding: '8px 12px', boxSizing: 'border-box' }}
              >
                {displayTimings.map((wt, i) => (
                  <React.Fragment key={i}>
                    <span
                      ref={i === activeIdx ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) : undefined}
                      style={i === activeIdx ? getActiveWordStyle(wordHighlightMode) : undefined}
                      className={cn(
                        "rounded-sm px-[1px] transition-all duration-150",
                        i === activeIdx && wordHighlightMode === 'word' && "font-bold",
                        i === activeIdx && wordHighlightMode === 'underline' && "font-semibold pb-px",
                        i === activeIdx && wordHighlightMode === 'glow' && "rounded-sm font-bold",
                        i === activeIdx && wordHighlightMode === 'line' && "font-bold",
                      )}
                    >
                      {wt.word}
                    </span>
                    {' '}
                  </React.Fragment>
                ))}
              </div>
            </div>
            {/* Left (RTL) — editable textarea + current-word indicator */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="px-3 py-1.5 border-b border-border/20 bg-muted/10 text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1.5">
                עריכה מלאה
                {activeIdx >= 0 && displayTimings[activeIdx] && (
                  <span className="ms-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-[10px] font-medium">
                    {displayTimings[activeIdx].word}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {activeIdx >= 0 && (
                <div className="h-0.5 bg-muted shrink-0">
                  <div
                    className="h-full bg-blue-400 transition-all duration-300"
                    style={{ width: `${(activeIdx / Math.max(displayTimings.length - 1, 1)) * 100}%` }}
                  />
                </div>
              )}
              <Textarea
                value={editDraft}
                onChange={(e) => { setEditDraft(e.target.value); scheduleTextSync(e.target.value); }}
                onBlur={(e) => flushTextSync(e.target.value)}
                className="flex-1 resize-none text-right border-none rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                dir="rtl"
                style={{ ...textStyle, padding: '8px 12px', boxSizing: 'border-box' } as React.CSSProperties}
                autoFocus
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Regular word-view (hidden in full-edit mode) ── */}
      {!fullEditMode && <>
      <div className="flex items-center border-b bg-muted/10 sticky top-0 z-10 shrink-0" dir="rtl">
        {/* Right column label */}
        <div className="flex-1 flex items-center gap-1.5 px-3 py-2 border-s border-border/40">
          <AlignRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className={cn("text-xs font-semibold", compareMode ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {compareMode ? "גרסה קפואה להשוואה" : "תמלול מסונכרן"}
          </span>
          <div className="ms-auto flex items-center gap-1">
            {/* Highlight style picker */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="h-5 px-1.5 rounded border border-border/60 text-[10px] text-muted-foreground hover:bg-muted flex items-center gap-1" title="סגנון הדגשה">
                  {wordHighlightMode === 'word' && <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: hlColors.word }} />}
                  {wordHighlightMode === 'underline' && <Minus className="w-3 h-3" style={{ color: hlColors.underline }} />}
                  {wordHighlightMode === 'line' && <Rows3 className="w-3 h-3" style={{ color: hlColors.line }} />}
                  {wordHighlightMode === 'glow' && <Sparkles className="w-3 h-3" style={{ color: hlColors.glow }} />}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start" dir="rtl">
                <p className="text-[10px] text-muted-foreground mb-2 font-medium">סגנון הדגשת מילה פעילה</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: 'word',      label: 'רקע מלא',      icon: <span className="inline-block w-4 h-4 rounded-sm" style={{ backgroundColor: hlColors.word }} /> },
                    { id: 'underline', label: 'קו תחתון',     icon: <Minus className="w-4 h-4" style={{ color: hlColors.underline }} /> },
                    { id: 'line',      label: 'שורה מלאה',    icon: <Rows3 className="w-4 h-4" style={{ color: hlColors.line }} /> },
                    { id: 'glow',      label: 'זוהר (Glow)',  icon: <Sparkles className="w-4 h-4" style={{ color: hlColors.glow }} /> },
                  ] as const).map(({ id, label, icon }) => (
                    <button
                      key={id}
                      onClick={() => setWordHighlightMode(id)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs transition-all",
                        wordHighlightMode === id
                          ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                          : "border-border hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {icon}{label}
                    </button>
                  ))}
                </div>
                {/* Per-mode customization */}
                <div className="mt-2 pt-2 border-t border-border/40 space-y-2.5">
                  {/* Color + Opacity — always */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground flex-1">צבע</span>
                    <input
                      type="color"
                      value={hlColors[wordHighlightMode]}
                      onChange={e => setHlColors(prev => ({ ...prev, [wordHighlightMode]: e.target.value }))}
                      className="w-6 h-6 rounded cursor-pointer border border-border/60 p-0"
                      style={{ padding: 0 }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">שקיפות</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{hlOpacity[wordHighlightMode]}%</span>
                    </div>
                    <Slider
                      value={[hlOpacity[wordHighlightMode]]}
                      onValueChange={([v]) => setHlOpacity(prev => ({ ...prev, [wordHighlightMode]: v }))}
                      min={0} max={100} step={5}
                    />
                  </div>
                  {/* Word mode — corner radius */}
                  {wordHighlightMode === 'word' && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">פינות</p>
                      <div className="flex gap-1">
                        {([{ v: 'none', label: 'ישר' }, { v: 'sm', label: 'עגול' }, { v: 'full', label: 'Pill' }] as const).map(({ v, label }) => (
                          <button key={v} onClick={() => setWordRadius(v)}
                            className={cn("flex-1 py-0.5 rounded border text-[9px] transition-colors",
                              wordRadius === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted text-muted-foreground"
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Underline sub-settings */}
                  {wordHighlightMode === 'underline' && (<>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">סגנון קו</p>
                      <div className="grid grid-cols-3 gap-1">
                        {([
                          { v: 'solid',  label: 'ישר' },
                          { v: 'dashed', label: 'מקווקו' },
                          { v: 'dotted', label: 'נקודות' },
                          { v: 'wavy',   label: 'גל' },
                          { v: 'double', label: 'כפול' },
                        ] as const).map(({ v, label }) => (
                          <button key={v} onClick={() => setUnderlineStyle(v)}
                            className={cn("py-0.5 rounded border text-[9px] transition-colors",
                              underlineStyle === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted text-muted-foreground"
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">עובי</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{underlineWidth}px</span>
                      </div>
                      <Slider value={[underlineWidth]} onValueChange={([v]) => setUnderlineWidth(v)} min={1} max={4} step={1} />
                    </div>
                  </>)}
                  {/* Line mode sub-settings */}
                  {wordHighlightMode === 'line' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">רק צד עריכה</span>
                      <button
                        onClick={() => setLineLeftOnly(v => !v)}
                        className={cn("relative h-4 w-8 rounded-full transition-colors shrink-0",
                          lineLeftOnly ? "bg-primary" : "bg-muted border border-border")}
                      >
                        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                          lineLeftOnly ? "right-0.5" : "left-0.5")} />
                      </button>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {/* Right column sync toggle */}
            <button
              onClick={() => setRightWordHighlightOn(v => !v)}
              className={cn("h-5 w-5 rounded flex items-center justify-center border transition-colors",
                rightWordHighlightOn ? "border-blue-400 text-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-border text-muted-foreground hover:bg-muted"
              )}
              title={rightWordHighlightOn ? "כבה הצגת מילה פעילה" : "הפעל הצגת מילה פעילה"}
            >
              {rightWordHighlightOn ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <Badge variant={syncEnabled ? "secondary" : "outline"} className="text-[10px] h-4 gap-0.5">
              {syncEnabled ? <Link className="w-2.5 h-2.5" /> : <Unlink className="w-2.5 h-2.5" />}
              {syncEnabled ? "חי" : "מושהה"}
            </Badge>
          </div>
        </div>

        {/* Left column label + controls */}
        <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
          <Edit3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <button
            onClick={toggleCompareMode}
            className={cn(
              "text-xs font-semibold transition-colors",
              compareMode ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:text-foreground"
            )}
            title={compareMode ? "לחץ לחזרה לעריכה מסונכרנת" : "לחץ לעריכה לא מסונכרנת (השוואה)"}
          >
            {compareMode ? "לא מסונכרנת" : "עריכה מסונכרנת"}
          </button>
          <div className="ms-auto flex items-center gap-1.5">
            {/* Left column sync toggle */}
            <button
              onClick={() => setLeftWordHighlightOn(v => !v)}
              className={cn("h-5 w-5 rounded flex items-center justify-center border transition-colors",
                leftWordHighlightOn ? "border-blue-400 text-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-border text-muted-foreground hover:bg-muted"
              )}
              title={leftWordHighlightOn ? "כבה הצגת מילה פעילה" : "הפעל הצגת מילה פעילה"}
            >
              {leftWordHighlightOn ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            {/* Save buttons */}
            {onSaveReplace && (
              <Button
                size="sm"
                variant="default"
                className="h-6 text-[10px] px-2 gap-0.5"
                onClick={handleSaveLocalAndCloud}
                title="שמור — מקומי + ענן יחד"
              >
                <Save className="w-2.5 h-2.5" />
                שמור
              </Button>
            )}

            {/* Baseline controls — restore / compare / set-new */}
            <div className="inline-flex items-center gap-0.5 ms-0.5 ps-1 border-s border-border/40">
              <Button
                size="sm"
                variant="outline"
                className="h-6 w-6 p-0"
                onClick={restoreToBaseline}
                disabled={!isModifiedFromBaseline}
                title={hasBaseline ? (isModifiedFromBaseline ? 'החזר לגרסת בסיס' : 'הטקסט זהה לבסיס') : 'אין בסיס שמור'}
              >
                <History className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant={compareMode ? 'default' : 'outline'}
                className="h-6 w-6 p-0"
                onClick={compareMode ? toggleCompareMode : compareToBaseline}
                disabled={!hasBaseline}
                title={compareMode ? 'סיים השוואה' : 'השווה לגרסת בסיס'}
              >
                <GitCompare className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 w-6 p-0"
                onClick={setNewBaseline}
                title="קבע את הטקסט הנוכחי כבסיס חדש"
              >
                <Bookmark className="w-3 h-3" />
              </Button>
            </div>

            {onDuplicateSave && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-0.5"
                onClick={() => { setDupName(""); setDupDialogOpen(true); }}
                title="שכפל ושמור עם שם חדש"
              >
                <Copy className="w-2.5 h-2.5" />
                שכפל ושמור
              </Button>
            )}
            {onSaveLearning && (
              <div className="inline-flex items-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 gap-0.5 rounded-e-none"
                  onClick={() => openLearningPicker('quick')}
                  disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}
                  title="שמור ללמידה עם בחירת פרופיל"
                >
                  <Brain className="w-2.5 h-2.5" />
                  שמור ללמידה
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 rounded-s-none border-s-0 px-1"
                      disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}
                      title="אפשרויות שמירה ללמידה"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="text-xs">
                    <DropdownMenuItem onClick={() => openLearningPicker('quick')}>
                      שמירה מהירה ללמידה
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openLearningPicker('advanced')}>
                      שמירה מתקדמת (עם הערה)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {/* Typography popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0"
                  title="הגדרות גופן ומרווח"
                >
                  <Type className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-4"
                align="end"
                side="bottom"
                dir="rtl"
              >
                <div className="flex flex-col gap-4">
                  <div className="text-sm font-semibold text-foreground">עיצוב טקסט</div>

                  {/* Alignment mode picker */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">מצב יישור מילה ↔ תזמון</Label>
                    <div className="flex gap-1">
                      {([
                        { id: 'auto' as const,    label: 'אוטו',    icon: <Zap className="w-3 h-3" />,      desc: 'מדויק + חכם' },
                        { id: 'whisper' as const, label: 'Whisper', icon: <LineChart className="w-3 h-3" />, desc: 'מקורי בלבד' },
                        { id: 'lcs' as const,     label: 'LCS',     icon: <Cpu className="w-3 h-3" />,       desc: 'עוגנים + אינטרפולציה' },
                      ]).map(({ id, label, icon, desc }) => (
                        <button
                          key={id}
                          onClick={() => setAlignMode(id)}
                          title={desc}
                          className={cn(
                            "flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded border text-[10px] transition-all",
                            alignMode === id
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:border-primary/60 text-muted-foreground"
                          )}
                        >
                          {icon}
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {alignMode === 'auto' && 'כשאין עריכה — Whisper מדויק. כשיש עריכה — LCS מוצא עוגנים.'}
                      {alignMode === 'whisper' && 'תזמוני Whisper בלבד. מושלם לטקסט לא ערוך.'}
                      {alignMode === 'lcs' && 'LCS תמיד: עוגנים + אינטרפולציה. הכי חכם, קצת יותר חישוב.'}
                    </p>
                  </div>

                  {/* User anchors summary */}
                  {userAnchors.size > 0 && (
                    <div className="flex items-center justify-between gap-2 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                        <span>⚓</span>
                        <span>{userAnchors.size} עוגנים ידניים פעילים</span>
                      </div>
                      <button
                        onClick={() => setUserAnchors(new Map())}
                        className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                      >
                        נקה הכל
                      </button>
                    </div>
                  )}

                  {/* Font family */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">גופן</Label>
                    <Select value={localFontFamily} onValueChange={setLocalFontFamily}>
                      <SelectTrigger className="h-7 text-xs" dir="ltr">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        {FONT_FAMILIES.map((f) => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">
                            <span style={{ fontFamily: f.value }}>{f.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Font weight */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">עובי כתב</Label>
                    <div className="flex gap-1 flex-wrap">
                      {[
                        { w: 300, label: "קל" },
                        { w: 400, label: "רגיל" },
                        { w: 500, label: "בינוני" },
                        { w: 700, label: "עבה" },
                        { w: 900, label: "שמנה" },
                      ].map(({ w, label }) => (
                        <button
                          key={w}
                          onClick={() => setLocalFontWeight(w)}
                          className={cn(
                            "flex-1 h-7 rounded text-xs border transition-all",
                            localFontWeight === w
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:border-primary/60"
                          )}
                          style={{ fontWeight: w }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font size */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">גודל גופן</Label>
                      <span className="text-xs font-mono text-muted-foreground">{localFontSize}px</span>
                    </div>
                    <Slider
                      min={12}
                      max={32}
                      step={1}
                      value={[localFontSize]}
                      onValueChange={([v]) => setLocalFontSize(v)}
                      dir="ltr"
                    />
                  </div>

                  {/* Letter spacing */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">מרווח בין אותיות</Label>
                      <span className="text-xs font-mono text-muted-foreground">{localLetterSpacing}px</span>
                    </div>
                    <Slider
                      min={0}
                      max={20}
                      step={0.5}
                      value={[localLetterSpacing]}
                      onValueChange={([v]) => setLocalLetterSpacing(v)}
                      dir="ltr"
                    />
                  </div>

                  {/* Word spacing */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">מרווח בין מילים</Label>
                      <span className="text-xs font-mono text-muted-foreground">{localWordSpacing}px</span>
                    </div>
                    <Slider
                      min={0}
                      max={20}
                      step={1}
                      value={[localWordSpacing]}
                      onValueChange={([v]) => setLocalWordSpacing(v)}
                      dir="ltr"
                    />
                  </div>

                  {/* Line height */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs text-muted-foreground">מרווח בין שורות</Label>
                      <span className="text-xs font-mono text-muted-foreground">{localLineHeight.toFixed(1)}</span>
                    </div>
                    <Slider
                      min={1.0}
                      max={3.0}
                      step={0.1}
                      value={[localLineHeight]}
                      onValueChange={([v]) => setLocalLineHeight(parseFloat(v.toFixed(1)))}
                      dir="ltr"
                    />
                  </div>

                  {/* Text color */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">צבע טקסט</Label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[
                        { color: "",          label: "ברירת מחדל", bg: "hsl(var(--foreground))" },
                        { color: "#000000",   label: "שחור",       bg: "#000000" },
                        { color: "#1e3a5f",   label: "כחול כהה",  bg: "#1e3a5f" },
                        { color: "#2d4a6e",   label: "כחול אפור", bg: "#2d4a6e" },
                        { color: "#333333",   label: "אפור כהה",  bg: "#333333" },
                        { color: "#7c3aed",   label: "סגול",      bg: "#7c3aed" },
                        { color: "#b91c1c",   label: "אדום",      bg: "#b91c1c" },
                        { color: "#15803d",   label: "ירוק",      bg: "#15803d" },
                      ].map(({ color, label, bg }) => (
                        <button
                          key={label}
                          title={label}
                          onClick={() => setLocalTextColor(color)}
                          className={cn(
                            "w-6 h-6 rounded-full border-2 transition-all hover:scale-110",
                            localTextColor === color
                              ? "border-primary shadow-md scale-110"
                              : "border-border"
                          )}
                          style={{ background: bg }}
                        />
                      ))}
                      {/* Free color picker */}
                      <label title="בחר צבע חופשי" className="relative w-6 h-6 rounded-full border-2 border-border overflow-hidden cursor-pointer hover:scale-110 transition-all" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }}>
                        <input
                          type="color"
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          value={localTextColor || "#000000"}
                          onChange={(e) => setLocalTextColor(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Reset */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs self-start"
                    onClick={() => {
                      setLocalFontFamily(fontFamily);
                      setLocalFontSize(fontSize);
                      setLocalLineHeight(lineHeight ?? 1.6);
                      setLocalWordSpacing(0);
                      setLocalLetterSpacing(0);
                      setLocalFontWeight(400);
                      setLocalTextColor("");
                    }}
                  >
                    איפוס לברירת מחדל
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Precise row alignment toggle (only meaningful when rich-edit is enabled) */}
            {enableRichEdit && (
              <Button
                size="sm"
                variant={preciseAlign ? "default" : "outline"}
                className="h-6 text-[10px] px-1.5 gap-0.5"
                onClick={togglePreciseAlign}
                title={preciseAlign
                  ? "יישור שורות מדויק פעיל — שני הצדדים מתיישרים שורה-מול-שורה בכל גודל מסך. לחץ למעבר לעריכה חופשית."
                  : "עריכה חופשית פעילה — שורות לא מובטחות זו מול זו. לחץ לחזרה ליישור מדויק."}
              >
                <Rows3 className="w-2.5 h-2.5" />
                {preciseAlign ? "יישור מדויק" : "עריכה חופשית"}
              </Button>
            )}
            {/* Full edit button */}
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-1.5 gap-0.5"
              onClick={openFullEdit}
              title="פתח עורך טקסט מלא"
            >
              <Edit3 className="w-2.5 h-2.5" />
              עריכה מלאה
            </Button>
          </div>
        </div>
      </div>

      {/* Shared scroll container — two equal flex columns (no individual headers) */}
      <div
        ref={scrollRef}
        className="flex flex-1 min-h-0 overflow-y-auto"
      >
        {/* ── RIGHT column: תמלול מסונכרן (read-only) ── */}
        <div className="flex-1 min-w-0 flex flex-col border-s border-border/40">
          {/* word rows — when rich-edit is on, pad-top dynamically to align with editor's first line */}
          <div
            className="px-4 pb-4"
            style={{
              ...textStyle,
              paddingTop: enableRichEdit ? `${rightTopOffset || 16}px` : 16,
            }}
          >
            {(compareMode ? frozenLines : lines).map((line, li) => {
              const sourceLines = compareMode ? frozenLines : lines;
              const offset = sourceLines.slice(0, li).reduce((a, l) => a + l.length, 0);
              return renderLine(line, offset, li, "right");
            })}
          </div>
        </div>


        {/* ── LEFT column: עריכה מסונכרנת (editable) ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {effectiveRichEdit ? (
            <div ref={leftRichRef} className="flex flex-col gap-2 p-3" dir="rtl">
              {/* Marking toolbar (always visible) + analysis panel (when active) */}
              <TextMarkingOverlay
                text={text}
                onTextChange={onTextChange}
                fontSize={localFontSize}
                fontFamily={localFontFamily}
                lineHeight={localLineHeight}
                toolbarOnly={!isMarkingActive}
                onActiveChange={setIsMarkingActive}
              />
              {/* RichTextEditor — full editing surface */}
              {!isMarkingActive && (
                <div
                  style={{
                    ...textStyle,
                    ...(localTextColor ? { color: localTextColor } : {}),
                    ...richColumnStyle,
                  }}
                >
                  <RichTextEditor
                    text={text}
                    onChange={onTextChange}
                    columnStyle={richColumnStyle}
                    onSaveReplaceOriginal={onSaveReplace}
                    onDuplicateSave={onDuplicateSave ? () => onDuplicateSave('') : undefined}
                    onWordCorrected={onWordCorrected}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Precise-alignment view: identical line breaks as the right column.
               Editing happens through right-click WordContextMenu (and the
               marking toolbar above when enableRichEdit is on). */
            <div className="flex flex-col" ref={leftRichRef}>
              {enableRichEdit && (
                <div className="px-3 pt-2" dir="rtl">
                  <TextMarkingOverlay
                    text={text}
                    onTextChange={onTextChange}
                    fontSize={localFontSize}
                    fontFamily={localFontFamily}
                    lineHeight={localLineHeight}
                    toolbarOnly={!isMarkingActive}
                    onActiveChange={setIsMarkingActive}
                  />
                </div>
              )}
              {!isMarkingActive && (
                <div ref={leftRowsRef} className="p-4" style={textStyle}>
                  {lines.map((line, li) => {
                    const offset = lines.slice(0, li).reduce((a, l) => a + l.length, 0);
                    return renderLine(line, offset, li, "left");
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </>}

      {/* Word-replace popover */}

      {/* ── Save to learning: profile picker ── */}
      <Dialog open={learnPickerOpen} onOpenChange={setLearnPickerOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">
              {learnMode === 'advanced' ? 'שמירה מתקדמת ללמידה' : 'שמירה מהירה ללמידה'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {!learningEnabled && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                כדי להשתמש בלמידת פרופילים יש להפעיל קודם את "מודל הגייה אישי" במסך הראשי.
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">בחירת פרופיל יעד (חובה בכל שמירה)</Label>
              <Select value={learnProfileId} onValueChange={setLearnProfileId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="בחר פרופיל" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {learningProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!learningProfiles.length && (
                <p className="text-xs text-destructive">לא נמצאו פרופילים. צור פרופיל קודם במסך הראשי.</p>
              )}
            </div>
            {learnMode === 'advanced' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">הערה (אופציונלי)</Label>
                <Textarea
                  value={learnNote}
                  onChange={(e) => setLearnNote(e.target.value)}
                  className="min-h-[84px] text-sm"
                  placeholder="למשל: שיעור חנוכה · דגש על שמות תנאים"
                  dir="rtl"
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              יישמרו טקסט מקורי/ערוך, זוגות תיקון, והקשר אודיו (אם זמין) לפרופיל הנבחר.
            </p>
          </div>
          <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <Button
              onClick={continueToLearningConfirm}
              disabled={!learningEnabled || !learningProfiles.length || !learnProfileId || !editedTextForLearning}
            >
              המשך לאישור
            </Button>
            <Button variant="ghost" onClick={() => setLearnPickerOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Save to learning: explicit confirm ── */}
      <Dialog open={learnConfirmOpen} onOpenChange={setLearnConfirmOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-right">אישור שמירה ללמידה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1 text-sm">
            <p>
              פרופיל יעד: <span className="font-semibold">{selectedLearningProfile?.name || 'לא נבחר'}</span>
            </p>
            <p>
              מצב שמירה: <span className="font-semibold">{learnMode === 'advanced' ? 'מתקדם' : 'מהיר'}</span>
            </p>
            <p>
              אורך טקסט: <span className="font-semibold">{editedTextForLearning.split(/\s+/).filter(Boolean).length}</span> מילים
            </p>
            {learnMode === 'advanced' && learnNote.trim() && (
              <p className="text-xs text-muted-foreground">הערה: {learnNote.trim()}</p>
            )}
            <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
              השמירה תעדכן רק את הפרופיל שבחרת, ותוסיף דוגמת למידה מלאה לסנכרון ענן עתידי.
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <Button onClick={submitLearning} disabled={learnSaving || !learnProfileId}>
              {learnSaving ? 'שומר...' : 'מאשר ושומר'}
            </Button>
            <Button variant="ghost" onClick={() => setLearnConfirmOpen(false)} disabled={learnSaving}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Duplicate & save dialog ── */}
      <Dialog open={dupDialogOpen} onOpenChange={setDupDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-right">שכפל ושמור</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm text-muted-foreground mb-1.5 block">שם לקובץ החדש</label>
            <Input
              dir="rtl"
              className="text-right"
              placeholder="לדוגמה: גרסה מתוקנת..."
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dupName.trim()) {
                  onDuplicateSave?.(dupName.trim());
                  setDupDialogOpen(false);
                }
                if (e.key === 'Escape') setDupDialogOpen(false);
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <Button
              onClick={() => { onDuplicateSave?.(dupName.trim()); setDupDialogOpen(false); }}
              disabled={!dupName.trim()}
            >
              <Copy className="w-3.5 h-3.5 me-1.5" />
              שכפל ושמור
            </Button>
            <Button variant="ghost" onClick={() => setDupDialogOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
