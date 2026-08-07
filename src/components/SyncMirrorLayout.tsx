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
// cn() runs the class string through tailwind-merge, which parses every class to
// resolve conflicts. That is the right default, but it is far too costly to run
// once per word: this view renders over eleven thousand word spans. The branches
// on the word span are mutually exclusive by construction, so there is nothing
// for the merge to resolve and plain clsx gives the same result.
import clsx from "clsx";
import { createRenderReporter, syncLog, syncTime, notePhase, syncTraceEnabled } from "@/lib/syncPerfTrace";

const syncRenderReporter = createRenderReporter('SyncMirrorLayout');
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Edit3, AlignRight, Link, Unlink, Check, X, Type, Save, Copy, Eye, EyeOff, Sparkles, Minus, Rows3, Zap, Cpu, LineChart, ChevronDown, Brain, History, Bookmark, GitCompare, Lock, Unlock, CircleDot, Circle, AlignJustify, Anchor, MoreHorizontal, LocateFixed, Columns2, Square } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { WordTiming } from "./SyncAudioPlayer";
import { useTextMarking } from "@/hooks/useTextMarking";
import { addDictionaryReplacement, addIgnoredWord } from "@/utils/hebrewGrammarDictionary";
import { learnFromCorrections, type CorrectionEntry } from "@/utils/correctionLearning";
import { WordContextMenu } from "@/components/WordContextMenu";
import { alignEditedToWhisper, findActiveWordIndex } from "@/lib/whisperAlignment";
import { getWordHighlightStyle, isWordApproved } from "@/lib/personalPronunciationModel";
import { RichTextEditor } from "@/components/RichTextEditor";
import { TextMarkingOverlay } from "@/components/TextMarkingOverlay";
import { getTrustedWordSuggestion } from '@/lib/trustedWordSuggestion';
import { scrollWithinContainer } from '@/lib/scrollWithinContainer';

interface SyncMirrorLayoutProps {
  wordTimings: WordTiming[];
  currentTime: number;
  text: string;
  onTextChange: (text: string) => void;
  onWordReplace: (wordIndex: number, replacement: string) => void;
  onWordClick: (time: number) => void;
  correctionStorageKey?: string;
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

type FontMetrics = {
  weight: number;
  size: number;
  family: string;
  wordSpacing: number;
  letterSpacing: number;
};

/**
 * Break a flat list of word-timings into visual lines using canvas measureText,
 * so several columns can render IDENTICAL line breaks. Single source of truth
 * shared by every line-measuring memo below (current text, locked snapshot,
 * frozen compare snapshot) — previously this canvas logic was copy-pasted 3×.
 */
/**
 * Split the transcript into readable blocks, preferring sentence ends.
 *
 * Each block is rendered as its own element so the browser can skip the ones
 * that are off-screen (see `content-visibility` on the row). Without this the
 * whole transcript is a single paint target, and anything that moves over it —
 * a sliding sidebar, a scroll — repaints thousands of words every frame.
 */
function chunkIntoBlocks(timings: WordTiming[], target = 55, hardMax = 90): WordTiming[][] {
  if (!timings.length) return [];
  const blocks: WordTiming[][] = [];
  let current: WordTiming[] = [];
  for (const wt of timings) {
    current.push(wt);
    const endsSentence = /[.!?:]["'״׳)\]]?$/.test(wt.word);
    if ((current.length >= target && endsSentence) || current.length >= hardMax) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function measureLineBreaks(timings: WordTiming[], width: number, font: FontMetrics): WordTiming[][] {
  if (!timings.length) return [];
  const effectiveWidth = width > 0 ? width : 400;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [timings];
  ctx.font = `${font.weight} ${font.size}px ${font.family}`;
  const spaceW = ctx.measureText(" ").width + 1 + font.wordSpacing;
  const result: WordTiming[][] = [];
  let line: WordTiming[] = [];
  let w = 0;
  for (const wt of timings) {
    const ww = ctx.measureText(wt.word).width + spaceW + wt.word.length * font.letterSpacing;
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
}

/**
 * Convert plain text into synthetic word-timings (one slot per word). Used for
 * snapshots/baselines that carry no real audio timings of their own.
 */
function textToTimings(text: string): WordTiming[] {
  return text.trim().split(/\s+/).filter(Boolean).map((word, i) => ({ word, start: i, end: i + 1 }));
}

// ──────────────────────────────────────────────────────────────────────────────
export const SyncMirrorLayout = ({
  wordTimings,
  currentTime,
  text,
  onTextChange,
  onWordReplace,
  onWordClick,
  correctionStorageKey = 'current-transcript',
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
}: SyncMirrorLayoutProps) => {
  // Every render of this component is measured, because the view re-runs its
  // whole word loop whenever the highlight moves and that is the cost that
  // decides whether playback is smooth. Reported as a rolling summary, so the
  // probe itself does not become the load.
  const endRenderMeasure = syncRenderReporter.begin();
  useEffect(() => { endRenderMeasure(); });
  notePhase('SyncMirrorLayout render');

  type ManualCorrectionMarker = {
    wordIndex: number;
    original: string;
    corrected: string;
    correctedAt: number;
  };
  const correctionMarkersKey = `manual_correction_markers_v1:${correctionStorageKey}`;
  const [manualCorrectionMarkers, setManualCorrectionMarkers] = useState<ManualCorrectionMarker[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(correctionMarkersKey) || '[]');
      setManualCorrectionMarkers(Array.isArray(saved) ? saved : []);
    } catch { setManualCorrectionMarkers([]); }
  }, [correctionMarkersKey]);

  // Resolved once per marker change rather than re-derived inside the word loop.
  // It used to run a linear scan with a regex split inside the predicate for
  // every word on every render — thousands of allocations per frame, on a path
  // that runs twenty times a second during playback.
  const manualCorrectionByIndex = useMemo(() => {
    const map = new Map<number, ManualCorrectionMarker & { wordAt: string }>();
    for (const marker of manualCorrectionMarkers) {
      const correctedWords = marker.corrected.split(/\s+/).filter(Boolean);
      correctedWords.forEach((word, offset) => {
        map.set(marker.wordIndex + offset, { ...marker, wordAt: word });
      });
    }
    return map;
  }, [manualCorrectionMarkers]);

  const rememberManualCorrection = useCallback((marker: ManualCorrectionMarker) => {
    setManualCorrectionMarkers((current) => {
      const next = [...current.filter((item) => item.wordIndex !== marker.wordIndex), marker]
        .sort((a, b) => a.wordIndex - b.wordIndex);
      try { localStorage.setItem(correctionMarkersKey, JSON.stringify(next)); } catch { /* quota/unavailable */ }
      return next;
    });
  }, [correctionMarkersKey]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fullEditScrollRef = useRef<HTMLDivElement>(null);
  const leftRichRef = useRef<HTMLDivElement>(null);
  const leftRowsRef = useRef<HTMLDivElement>(null);
  const rightRowsRef = useRef<HTMLDivElement>(null);
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

  const [fullEditMode, setFullEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState(text);
  const [followPlayback, setFollowPlayback] = useState(() => {
    try { return localStorage.getItem('sync_mirror_follow_playback_v2') !== '0'; } catch { return true; }
  });

  const updateFollowPlayback = useCallback((enabled: boolean) => {
    setFollowPlayback(enabled);
    try { localStorage.setItem('sync_mirror_follow_playback_v2', enabled ? '1' : '0'); } catch {}
  }, []);

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

  // ── Pane control: which side is the "active" one (drives icon tint) and lock state ──
  const [activePane, setActivePaneState] = useState<'right' | 'left'>(() => {
    try { return (localStorage.getItem('sync_mirror_active_pane') as 'right' | 'left') || 'left'; } catch { return 'left'; }
  });
  const [lockedPane, setLockedPaneState] = useState<'right' | 'left' | null>(() => {
    try {
      const v = localStorage.getItem('sync_mirror_locked_pane');
      return v === 'right' || v === 'left' ? v : null;
    } catch { return null; }
  });
  const setActivePane = useCallback((p: 'right' | 'left') => {
    setActivePaneState(p);
    try { localStorage.setItem('sync_mirror_active_pane', p); } catch {}
  }, []);
  const toggleLock = useCallback((p: 'right' | 'left') => {
    setLockedPaneState(prev => {
      const next = prev === p ? null : p;
      try {
        if (next) localStorage.setItem('sync_mirror_locked_pane', next);
        else localStorage.removeItem('sync_mirror_locked_pane');
      } catch {}
      toast({ title: next ? `צד ${p === 'right' ? 'ימין' : 'שמאל'} ננעל` : 'הנעילה בוטלה' });
      return next;
    });
  }, []);
  // Guarded onTextChange — blocks edits originating from a locked pane.
  const handleTextChangeFromPane = useCallback((side: 'right' | 'left', next: string) => {
    if (lockedPane === side) {
      toast({ title: 'הצד הזה נעול', description: 'שחרר את הנעילה כדי לערוך' });
      return;
    }
    onTextChange(next);
  }, [lockedPane, onTextChange]);
  const navyClass = 'text-[#0a1d3f] dark:text-blue-300';

  // ── Mirrored-padded alignment mode ─────────────────────────────────────────
  // When ON and a side is locked: edits in the editable side keep both columns
  // line-aligned 1:1 by injecting phantom (empty) rows into whichever side is
  // shorter at that point in the diff. Lines that differ from the locked
  // snapshot get a blue dot in the gutter.
  type AlignmentMode = 'free' | 'mirrored-padded';
  const [alignmentMode, setAlignmentMode] = useState<AlignmentMode>(() => {
    try { return (localStorage.getItem('sync_mirror_alignment_mode') as AlignmentMode) || 'free'; } catch { return 'free'; }
  });
  const toggleAlignmentMode = useCallback(() => {
    setAlignmentMode(prev => {
      const next: AlignmentMode = prev === 'mirrored-padded' ? 'free' : 'mirrored-padded';
      try { localStorage.setItem('sync_mirror_alignment_mode', next); } catch {}
      toast({ title: next === 'mirrored-padded' ? 'יישור 1:1 הופעל' : 'יישור 1:1 כובה' });
      return next;
    });
  }, []);

  // Column width split between the two columns.
  // `manualSplit` = percentage of the RIGHT column (15–85). null = auto.
  // Auto: in mirrored-padded mode with a lock, source side ~40% / editor ~60%;
  // otherwise 50/50. The user can drag a divider to override and the choice
  // is persisted in localStorage.
  const SPLIT_KEY = 'sync_mirror_col_split_v1';
  const [manualSplit, setManualSplit] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(SPLIT_KEY);
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 15 && n <= 85 ? n : null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (manualSplit == null) localStorage.removeItem(SPLIT_KEY);
      else localStorage.setItem(SPLIT_KEY, String(manualSplit));
    } catch {}
  }, [manualSplit]);
  const autoRightPct = useMemo(() => {
    if (alignmentMode !== 'mirrored-padded' || !lockedPane) return 50;
    return lockedPane === 'right' ? 40 : 60;
  }, [alignmentMode, lockedPane]);
  const rightPct = manualSplit ?? autoRightPct;
  const leftPct = 100 - rightPct;

  // Refs to each column's content area so we can measure the NARROW column's
  // real text width and use it as the wrapping basis for `lines`. This way
  // both columns render the same line breaks aligned to the source's width,
  // and the wider (editor) column has trailing whitespace per line for inline
  // word additions without pushing rows down.
  const rightColRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);

  // Snapshot of the locked side's text taken at the moment of locking.
  const [lockedSnapshotText, setLockedSnapshotText] = useState<string>('');
  // Re-snapshot whenever the lock turns on
  const prevLockedRef = useRef<'right' | 'left' | null>(null);
  useEffect(() => {
    if (lockedPane && prevLockedRef.current !== lockedPane) {
      setLockedSnapshotText(text);
    } else if (!lockedPane) {
      setLockedSnapshotText('');
    }
    prevLockedRef.current = lockedPane;
    // intentionally do NOT depend on `text` — we only snapshot on lock change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedPane]);

  // Measure the real editable surface. The read-only side receives only the
  // required spacer, instead of rendering a duplicate toolbar full of no-op buttons.
  useEffect(() => {
    if (!enableRichEdit || fullEditMode) { setRightTopOffset(0); return; }
    const wrapper = leftRichRef.current;
    const rightRows = rightRowsRef.current;
    if (!wrapper || !rightRows) return;
    let raf = 0;
    const measure = () => {
      const editable = wrapper.querySelector('[contenteditable="true"]') as HTMLElement | null;
      const firstPreciseLine = leftRowsRef.current?.querySelector<HTMLElement>('[data-line="0"]') ?? null;
      const target = effectiveRichEdit ? editable : firstPreciseLine;
      const anchor = target ?? wrapper;
      const diff = Math.max(16, Math.round(anchor.getBoundingClientRect().top - rightRows.getBoundingClientRect().top));
      setRightTopOffset(diff);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(wrapper);
    window.addEventListener('resize', schedule);
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(raf); };
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
    if (!wordTimings.length) return textToTimings(text);

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
  const hasAudioTimings = wordTimings.length > 0;

  // A ResizeObserver used to watch both columns and feed their width into the
  // line-break measurement. With the browser doing the wrapping there is no
  // width to feed, and the observer was actively harmful: it fires on every
  // frame of a sidebar animation, and each notification rebuilt every line.


  // ── Canvas-measured line breaks ─────────────────────────────────────────────

  // Line breaking is off: the words are handed over as a single run and the
  // browser wraps them. Measuring breaks on a canvas meant walking every word
  // whenever the column width changed, and a column width changes for reasons
  // that have nothing to do with the text — opening the sidebar, resizing the
  // window, returning to the page — each one rebuilding the entire view.
  const lines = useMemo(
    () => chunkIntoBlocks(displayTimings),
    [displayTimings],
  );

  // ── Snapshot lines (the locked side's frozen view) ──────────────────────────
  const snapshotLines = useMemo<WordTiming[][]>(() => {
    if (!lockedSnapshotText.trim()) return [];
    return [textToTimings(lockedSnapshotText)];
  }, [lockedSnapshotText]);

  // ── Padded alignment via line-level LCS ────────────────────────────────────
  // Returns two arrays of identical length where each slot is either a real
  // line (WordTiming[]) or null (= phantom/empty row). `edited` marks rows
  // that differ from the snapshot — those get the blue dot in the gutter.
  type PaddedRow = { line: WordTiming[] | null; edited: boolean };
  const paddedAlignment = useMemo((): { current: PaddedRow[]; snapshot: PaddedRow[] } | null => {
    if (alignmentMode !== 'mirrored-padded' || !lockedPane || !snapshotLines.length || !lines.length) {
      return null;
    }
    const keyOf = (l: WordTiming[]) => l.map(w => w.word).join(' ').trim();
    const A = snapshotLines.map(keyOf); // snapshot
    const B = lines.map(keyOf);          // current
    const n = A.length, m = B.length;

    // The diff below is O(n·m) in both time and memory. On a long transcript
    // that is a matrix of hundreds of thousands of cells, built the moment this
    // mode is switched on. When nothing has been edited yet — the usual case
    // right after locking — the two sides are identical and the whole thing is
    // avoidable.
    if (n === m && A.every((row, i) => row === B[i])) {
      syncLog('⇉ padded alignment: identical, diff skipped', { lines: n });
      return {
        current: lines.map((line) => ({ line, edited: false })),
        snapshot: snapshotLines.map((line) => ({ line, edited: false })),
      };
    }
    syncLog('⇉ padded alignment: running LCS', { snapshotLines: n, currentLines: m, cells: n * m });

    // LCS DP
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = A[i - 1] === B[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const ops: Array<{ t: 'eq' | 'del' | 'ins'; a?: number; b?: number }> = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (A[i - 1] === B[j - 1]) { ops.push({ t: 'eq', a: i - 1, b: j - 1 }); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ t: 'del', a: i - 1 }); i--; }
      else { ops.push({ t: 'ins', b: j - 1 }); j--; }
    }
    while (i > 0) { ops.push({ t: 'del', a: i - 1 }); i--; }
    while (j > 0) { ops.push({ t: 'ins', b: j - 1 }); j--; }
    ops.reverse();
    const snapOut: PaddedRow[] = [];
    const curOut: PaddedRow[] = [];
    for (const op of ops) {
      if (op.t === 'eq') {
        snapOut.push({ line: snapshotLines[op.a!], edited: false });
        curOut.push({ line: lines[op.b!], edited: false });
      } else if (op.t === 'del') {
        // line exists only in snapshot → phantom in current
        snapOut.push({ line: snapshotLines[op.a!], edited: true });
        curOut.push({ line: null, edited: true });
      } else {
        // line exists only in current (new/edited) → phantom in snapshot
        snapOut.push({ line: null, edited: true });
        curOut.push({ line: lines[op.b!], edited: true });
      }
    }
    return { current: curOut, snapshot: snapOut };
  }, [alignmentMode, lockedPane, snapshotLines, lines]);

  // ── Active word index (timing sync) ────────────────────────────────────────
  const activeIdx = useMemo(() => {
    if (!syncEnabled || !hasAudioTimings || !displayTimings.length) return -1;
    return findActiveWordIndex(displayTimings, currentTime, 0.04, true);
  }, [displayTimings, currentTime, syncEnabled, hasAudioTimings]);

  // ── Active line index ───────────────────────────────────────────────────────

  // ── Auto-scroll to active line ──────────────────────────────────────────────
  useEffect(() => {
    if (activeIdx < 0 || !syncEnabled || !followPlayback) return;

    if (fullEditMode) {
      const container = fullEditScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-word-index="${activeIdx}"]`);
      if (container && target) scrollWithinContainer(container, target, "nearest");
      return;
    }

    // Follow the word, not the row: without measured line breaks the text is
    // one flowing run, so a row is the whole transcript and scrolling to it
    // would just jump to the top.
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-word-index="${activeIdx}"]`);
    if (container && target) scrollWithinContainer(container, target, "nearest");
  }, [activeIdx, syncEnabled, followPlayback, fullEditMode]);

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
  // Membership is tested once per word per render; an array scan there is
  // quadratic in the number of matches.
  const searchMatchSet = useMemo(() => new Set(searchMatchList), [searchMatchList]);

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
          const original = normalizeWord(displayTimings[globalIdx]?.word ?? "");
          rememberManualCorrection({
            wordIndex: globalIdx,
            original: displayTimings[globalIdx]?.word ?? original,
            corrected: fixed,
            correctedAt: Date.now(),
          });
          onWordReplace(globalIdx, fixed);
          if (original) {
            addDictionaryReplacement(original, fixed);
            const now = Date.now();
            const learnedEntries: CorrectionEntry[] = [{
              original,
              corrected: fixed,
              frequency: 1,
              engine: "context-menu",
              category: fixed.includes(" ") ? "phrase" : "word",
              confidence: 0.75,
              lastUsed: now,
              createdAt: now,
              note: "תיקון ידני בלחיצה ימנית",
            }];

            const contextStart = Math.max(0, globalIdx - 2);
            const contextEnd = Math.min(displayTimings.length, globalIdx + 3);
            const contextWords = displayTimings.slice(contextStart, contextEnd).map((item) => item.word);
            if (contextWords.length >= 3) {
              const localIndex = globalIdx - contextStart;
              const correctedContext = [...contextWords];
              correctedContext[localIndex] = fixed;
              learnedEntries.push({
                original: contextWords.join(" "),
                corrected: correctedContext.join(" "),
                frequency: 1,
                engine: "context-menu-context",
                category: "phrase",
                confidence: 0.7,
                lastUsed: now,
                createdAt: now,
                note: "תיקון ידני עם שתי מילים של הקשר מכל צד",
              });
            }
            learnFromCorrections(learnedEntries);
          }
        }
      }
    },
    [displayTimings, onWordReplace, rememberManualCorrection],
  );

  // ── Shared word context menu ──────────────────────────────────────────────
  // Resolved from whichever word was right-clicked, so a single menu instance
  // serves the whole transcript instead of one per word.
  const [menuTarget, setMenuTarget] = useState<{
    globalIdx: number;
    word: string;
    side: 'left' | 'right';
    start: number;
    end: number;
  } | null>(null);

  const handleWordContextMenu = useCallback((event: React.MouseEvent) => {
    const el = (event.target as HTMLElement | null)?.closest?.('[data-word-index]') as HTMLElement | null;
    if (!el) {
      setMenuTarget(null);
      return;
    }
    const globalIdx = Number(el.dataset.wordIndex);
    if (!Number.isFinite(globalIdx)) {
      setMenuTarget(null);
      return;
    }
    setMenuTarget({
      globalIdx,
      word: el.dataset.word ?? '',
      side: (el.dataset.wordSide as 'left' | 'right') ?? 'left',
      start: Number(el.dataset.wordStart) || 0,
      end: Number(el.dataset.wordEnd) || 0,
    });
  }, []);

  // Suggestions for the targeted word, using the same inputs the row render uses.
  const menuSuggestions = useMemo(() => {
    if (!menuTarget || menuTarget.side !== 'left') return [];
    const { globalIdx, word } = menuTarget;
    if (marking.getWordMarkingStyle(globalIdx) === '' || isWordApproved(word)) return [];
    const local = marking.localIssueMap.get(globalIdx) ?? [];
    const result = marking.resultMap.get(globalIdx)?.suggestion;
    return [...local.map((s) => s.text), ...(result ? [result] : [])];
  }, [menuTarget, marking]);

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
  const frozenLines = useMemo<WordTiming[][]>(() => {
    if (!compareMode || !frozenTimings.length) return [];
    return [frozenTimings];
  }, [compareMode, frozenTimings]);

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
    setFrozenTimings(textToTimings(baselineText));
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
  // Shared horizontal alignment — controlled here so BOTH columns (left RichTextEditor
  // and right renderLine column) get the same alignment. When set to 'justify', each
  // visual line stretches to fill the column width on both sides, so matching lines
  // line up at the same vertical height.
  const [sharedTextAlign, setSharedTextAlign] = useState<'right' | 'left' | 'center' | 'justify'>(() => {
    if (typeof window === 'undefined') return 'right';
    return (localStorage.getItem('sync.mirror.textAlign') as 'right' | 'left' | 'center' | 'justify') || 'right';
  });
  useEffect(() => {
    try { localStorage.setItem('sync.mirror.textAlign', sharedTextAlign); } catch {}
  }, [sharedTextAlign]);

  const textStyle: React.CSSProperties = {
    fontFamily: localFontFamily,
    fontSize: `${localFontSize}px`,
    lineHeight: localLineHeight,
    wordSpacing: `${localWordSpacing}px`,
    letterSpacing: `${localLetterSpacing}px`,
    fontWeight: localFontWeight,
    textAlign: sharedTextAlign,
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

  // ── Single vs. two-column view ─────────────────────────────────────────────
  // The mirror renders every word twice. When the second column is not being
  // used for comparison, dropping it halves the document — which is both the
  // render cost and the browser layout cost.
  const [singleColumn, setSingleColumn] = useState(() => {
    try { return localStorage.getItem('sync_mirror_single_column_v1') === '1'; } catch { return false; }
  });
  const toggleSingleColumn = useCallback(() => {
    setSingleColumn((prev) => {
      const next = !prev;
      try { localStorage.setItem('sync_mirror_single_column_v1', next ? '1' : '0'); } catch { /* unavailable */ }
      return next;
    });
  }, []);

  // ── Progressive first paint ────────────────────────────────────────────────
  // Building every word at once blocks for seconds on a long transcript, and it
  // happens again on every remount — leaving the page and coming back. The
  // words are laid down in batches across frames instead: the opening is
  // readable almost immediately and the rest fills in behind it. Once complete
  // this stops entirely and costs nothing.
  const FIRST_BATCH = 800;
  const BATCH_STEP = 2000;
  const totalWords = displayTimings.length;
  const [renderBudget, setRenderBudget] = useState(FIRST_BATCH);

  // A new transcript starts the fill over.
  useEffect(() => { setRenderBudget(FIRST_BATCH); }, [totalWords]);

  useEffect(() => {
    if (renderBudget >= totalWords) return;
    // Yield to the browser between batches so input and painting stay live.
    const id = window.setTimeout(
      () => setRenderBudget((b) => Math.min(totalWords, b + BATCH_STEP)),
      16,
    );
    return () => window.clearTimeout(id);
  }, [renderBudget, totalWords]);

  // Never let the playing word fall outside what has been built.
  useEffect(() => {
    if (activeIdx < 0 || renderBudget >= totalWords) return;
    if (activeIdx + 200 > renderBudget) {
      setRenderBudget(Math.min(totalWords, activeIdx + 200 + BATCH_STEP));
    }
  }, [activeIdx, renderBudget, totalWords]);

  const isFilling = renderBudget < totalWords;

  // ── Active-word decoration, applied straight to the DOM ────────────────────
  // Marking the playing word through React meant every word change re-rendered
  // the whole transcript — thirteen thousand spans rebuilt to move one
  // highlight, which is what made playback unusable once marking was switched
  // on. The two spans that actually change are touched directly instead.
  const decoratedRef = useRef<HTMLElement[]>([]);
  useEffect(() => {
    const container = scrollRef.current;

    // Clear whatever was decorated last time.
    for (const el of decoratedRef.current) {
      el.removeAttribute('data-active-word');
      el.style.cssText = el.dataset.baseStyle ?? '';
      el.classList.remove('font-bold', 'font-semibold');
    }
    decoratedRef.current = [];

    if (!container || activeIdx < 0) return;
    if (!rightWordHighlightOn && !leftWordHighlightOn) return;

    const style = getActiveWordStyle(wordHighlightMode);
    const targets = Array.from(
      container.querySelectorAll<HTMLElement>(`[data-word-index="${activeIdx}"]`),
    ).filter((el) => {
      const side = el.dataset.wordSide;
      return side === 'right' ? rightWordHighlightOn : leftWordHighlightOn;
    });

    for (const el of targets) {
      // Remember the span's own styling once, so restoring it is exact.
      if (el.dataset.baseStyle === undefined) el.dataset.baseStyle = el.style.cssText;
      el.setAttribute('data-active-word', 'true');
      Object.assign(el.style, style);
      if (wordHighlightMode === 'word' || wordHighlightMode === 'glow') el.classList.add('font-bold');
      else if (wordHighlightMode === 'underline') el.classList.add('font-semibold');
      decoratedRef.current.push(el);
    }
  });

  // ── Render a single line row for one column ─────────────────────────────────
  const renderLine = (
    line: WordTiming[],
    lineOffset: number,
    lineIdx: number,
    side: "left" | "right",
  ) => {
    // A "row" is now the entire transcript, so row-level highlighting would
    // paint everything. Only the active word itself is marked.
    const isActiveLine = false;
    const wordHighlightOn = side === "right" ? rightWordHighlightOn : leftWordHighlightOn;
    const showLineMode = false;
    const showSubtleLine = false;
    return (
      <div
        key={lineIdx}
        data-line={lineIdx}
        dir="rtl"
        // Off-screen blocks are skipped for style, layout and paint. This is
        // what keeps anything moving over the transcript — a sliding sidebar,
        // a scroll — from repainting thousands of words every frame.
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 140px' } as React.CSSProperties}
        className={cn(
          "min-h-[1.4em] py-[1px] rounded-sm transition-colors",
          showSubtleLine && side === "right" && "bg-primary/8",
          showSubtleLine && side === "left" && "bg-blue-50 dark:bg-blue-950/30",
        )}
      >
        {line.map((wt, wi) => {
          const globalIdx = lineOffset + wi;
          const isSearchActive = globalIdx === activeSearchGlobalIdx;
          const isSearchMatch = !isSearchActive && searchMatchSet.has(globalIdx);
          const hasIssue =
            side === "left" && marking.getWordMarkingStyle(globalIdx) !== "";

          const wordApproved = side === "left" && isWordApproved(wt.word);
          const highlightStyle = side === "left" ? getWordHighlightStyle(wt.word) : undefined;
          const wordHasIssue = hasIssue && !wordApproved;
          const { localIssueMap, resultMap } = marking;
          const localSuggestions = side === "left" && wordHasIssue
            ? (localIssueMap.get(globalIdx) ?? [])
            : [];
          const trustedSuggestion = getTrustedWordSuggestion(localSuggestions);
          const suggestions = side === "left" && wordHasIssue
            ? [
                ...localSuggestions.map((s) => s.text),
                ...(resultMap.get(globalIdx)?.suggestion ? [resultMap.get(globalIdx)!.suggestion!] : []),
              ]
            : [];

          const wordHighlightOn = side === "right" ? rightWordHighlightOn : leftWordHighlightOn;
          const isAnchor = userAnchors.has(globalIdx);
          // The word must still match what the marker recorded, same as before.
          const markerAtIdx = manualCorrectionByIndex.get(globalIdx);
          const manualCorrection = markerAtIdx?.wordAt === wt.word ? markerAtIdx : undefined;
          const correctionOriginal = manualCorrection?.original || wt.correctionOriginal;
          const correctionResult = manualCorrection?.corrected || wt.word;
          const wasManuallyCorrected = Boolean(correctionOriginal && correctionOriginal !== correctionResult);

          const wordSpan = (
            <span
              key={globalIdx}
              // Identity for the shared context menu. Carrying it on the element
              // means the menu can be resolved from the click, so the words
              // themselves stay plain spans.
              data-word-index={globalIdx}
              data-word={wt.word}
              data-word-side={side}
              data-word-start={wt.start}
              data-word-end={wt.end}
              style={highlightStyle}
              className={clsx(
                // transition-colors, not transition-all: the browser has to watch
                // every animatable property on every element that carries it, and
                // there are two of these per word — over eleven thousand here.
                // Only colour actually animates.
                "inline cursor-pointer select-text transition-colors px-[1px]",
                // The active-word decoration is applied to the DOM directly (see
                // the effect below), so nothing here depends on which word is
                // currently playing — that is what keeps a highlight move from
                // rebuilding all thirteen thousand spans.
                "rounded-sm",
                side === "left" && "hover:bg-muted/70",
                // anchor indicator
                isAnchor && "ring-1 ring-amber-400 ring-offset-[1px]",
                isSearchActive && "bg-yellow-400 dark:bg-yellow-600 rounded-sm",
                isSearchMatch && "bg-yellow-200 dark:bg-yellow-800 rounded-sm",
                wordHasIssue && "underline decoration-red-500 decoration-wavy underline-offset-2",
                wasManuallyCorrected && "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/70 dark:bg-emerald-950/60 dark:text-emerald-100",
                trustedSuggestion && !wasManuallyCorrected && "bg-red-100 text-red-900 ring-1 ring-red-400/80 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-100",
              )}
              onClick={(event) => {
                if (trustedSuggestion && !wasManuallyCorrected) {
                  event.preventDefault();
                  event.stopPropagation();
                  applyWordReplace(globalIdx, trustedSuggestion.text);
                  toast({
                    title: 'התיקון אושר ונשמר',
                    description: trustedSuggestion.text === '__DELETE__'
                      ? `${wt.word} ← מחיקה`
                      : `${wt.word} ← ${trustedSuggestion.text}`,
                  });
                  return;
                }
                if (hasAudioTimings) onWordClick(wt.start);
              }}
              title={wasManuallyCorrected
                ? `תוקן ידנית: ${correctionOriginal} ← ${correctionResult}`
                : trustedSuggestion
                  ? `לחץ לתיקון: ${wt.word} ← ${trustedSuggestion.text === '__DELETE__' ? 'מחיקה' : trustedSuggestion.text} | ${trustedSuggestion.reason}`
                : !hasAudioTimings
                  ? 'אין תזמון אודיו מאומת למילה זו'
                : isAnchor
                  ? `⚓ עוגן (${wt.start.toFixed(2)}s) — קליק לקפיצה`
                  : `קליק לקפיצה (${wt.start.toFixed(1)}s)`}
            >
              {isAnchor && <span className="text-amber-500 text-[8px] me-[1px] select-none">⚓</span>}
              {wt.word}
            </span>
          );

          // One shared context menu serves every word (see menuTarget below).
          // Wrapping each word in its own Radix menu meant eleven thousand menu
          // roots on a long transcript, which alone cost seconds per render.
          return (
            <React.Fragment key={globalIdx}>
              {wordSpan}
              {' '}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // The rendered word rows, built once per meaningful change. Deliberately not
  // a function of the playing position: the active word is decorated on the DOM
  // afterwards, so the clock can tick without rebuilding any of this.
  const wordRows = useMemo(() => {
    const src = compareMode ? frozenLines : lines;
    let offset = 0;
    let budget = renderBudget;
    return src.map((line, li) => {
      // Only the words within the current budget are built. The rest arrive in
      // the following frames, so opening a long transcript fills in instead of
      // blocking on one enormous render.
      const slice = budget >= line.length ? line : line.slice(0, Math.max(0, budget));
      budget -= line.length;
      const node = renderLine(slice, offset, li, "left");
      offset += line.length;
      return node;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderBudget,
    compareMode, frozenLines, lines,
    rightWordHighlightOn, leftWordHighlightOn,
    // The marking hook hands back a fresh object every render, so depending on
    // it would invalidate this on every tick. The three pieces the rows read
    // are individually memoized and stable.
    marking.getWordMarkingStyle, marking.localIssueMap, marking.resultMap,
    searchMatchSet, activeSearchGlobalIdx,
    userAnchors, manualCorrectionByIndex, hasAudioTimings,
    applyWordReplace, onWordClick, dictionaryVersion,
    // textStyle is deliberately absent: it is rebuilt on every render and would
    // invalidate this memo continuously. The rows do not read it — the column
    // that contains them carries the typography.
    hlColors, hlOpacity,
  ]);

  // Render a padded row (real line or phantom) with an edit-marker dot in the gutter.
  const renderPaddedRow = (
    row: { line: WordTiming[] | null; edited: boolean },
    rowIdx: number,
    side: 'left' | 'right',
    sourceLines: WordTiming[][],
    realLineIdx: number, // index in sourceLines that this row corresponds to, or -1 for phantom
  ) => {
    const isPhantom = row.line === null;
    const offset = realLineIdx >= 0
      ? sourceLines.slice(0, realLineIdx).reduce((a, l) => a + l.length, 0)
      : 0;
    const dot = row.edited ? (
      <span
        aria-hidden
        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#0a1d3f] dark:bg-blue-300"
        style={side === 'left' ? { left: -10 } : { right: -10 }}
        title="שורה שנערכה"
      />
    ) : null;
    if (isPhantom) {
      return (
        <div key={`p-${rowIdx}`} className="relative" style={{ minHeight: '1.4em' }}>
          {dot}
          <div className="min-h-[1.4em] py-[1px]" />
        </div>
      );
    }
    return (
      <div key={`r-${rowIdx}`} className="relative">
        {dot}
        {renderLine(row.line!, offset, realLineIdx, side)}
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
    <div
      ref={containerRef}
      className="flex flex-col h-full relative overflow-hidden"
      data-sync-active-index={activeIdx}
      data-sync-following={followPlayback ? 'true' : 'false'}
    >
      {/* Full-text edit — two-panel side-by-side (replaces old overlay) */}
      {fullEditMode && (
        <div className="flex flex-col flex-1 min-h-0" dir="rtl">
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/10 shrink-0 gap-3">
            <span className="text-sm font-semibold">עריכת טקסט מלאה</span>
            <span className="text-[11px] text-muted-foreground">מתעדכן אוטומטית אחרי 10 שניות או בסיום מילה</span>
            <div className="flex gap-2 ms-auto shrink-0">
              <Button
                size="sm"
                variant={followPlayback ? "secondary" : "outline"}
                onClick={() => updateFollowPlayback(!followPlayback)}
                title={followPlayback ? "הפסק לעקוב אחרי המילה המתנגנת" : "עקוב אחרי המילה המתנגנת"}
              >
                <LocateFixed className="w-3.5 h-3.5 me-1" />
                {followPlayback ? 'מעקב פעיל' : 'מעקב כבוי'}
              </Button>
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
                ref={fullEditScrollRef}
                className="flex-1 overflow-y-auto break-words select-none text-muted-foreground/80"
                dir="rtl"
                style={{ ...textStyle, padding: '8px 12px', boxSizing: 'border-box' }}
              >
                {displayTimings.map((wt, i) => (
                  <React.Fragment key={i}>
                    <span
                      data-word-index={i}
                      data-active-word={i === activeIdx ? 'true' : undefined}
                      style={i === activeIdx ? getActiveWordStyle(wordHighlightMode) : undefined}
                      className={cn(
                        "rounded-sm px-[1px] transition-colors duration-150",
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
      <div className={cn("grid grid-cols-2 items-stretch border-b bg-muted/10 sticky top-0 z-10 shrink-0 [&_svg]:text-[#0a1d3f] dark:[&_svg]:text-blue-300")} dir="rtl">
        {/* Visual mid-divider between right-half and left-half intent */}
        <div className="min-w-0 flex items-center gap-1.5 px-3 py-2 border-s border-border/40">
          <AlignRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className={cn("text-xs font-semibold", compareMode ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {compareMode ? "גרסה קפואה להשוואה" : "תמלול מסונכרן"}
          </span>
          <button
            type="button"
            onClick={toggleSingleColumn}
            className="shrink-0 h-5 px-1.5 rounded border border-border/60 text-[10px] text-muted-foreground hover:bg-muted flex items-center gap-1"
            title={singleColumn
              ? 'עמודה אחת — לחץ למעבר לשתי עמודות'
              : 'שתי עמודות — לחץ למעבר לעמודה אחת (חצי מהאלמנטים, מהיר יותר)'}
          >
            {singleColumn ? <Square className="w-3 h-3" /> : <Columns2 className="w-3 h-3" />}
            {singleColumn ? 'עמודה' : 'שתיים'}
          </button>
          {isFilling && (
            <span
              className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
              title="הטקסט נטען בהדרגה כדי שהמסך יישאר מגיב"
            >
              טוען {Math.round((renderBudget / Math.max(1, totalWords)) * 100)}%
            </span>
          )}
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
            <button
              type="button"
              onClick={() => updateFollowPlayback(!followPlayback)}
              className={cn(
                "h-5 px-1.5 rounded border text-[10px] inline-flex items-center gap-1 transition-colors",
                followPlayback
                  ? "border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/40"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              title={followPlayback ? "מעקב פעיל בתוך אזור התמלול" : "הפעל מעקב אחרי המילה המתנגנת"}
            >
              <LocateFixed className="w-3 h-3" />
              {followPlayback ? 'עוקב' : 'לא עוקב'}
            </button>
          </div>
        </div>

        {/* Left column label + controls */}
        <div className="min-w-0 flex flex-wrap items-center gap-1.5 px-3 py-2">
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
          <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title="פעולות נוספות">
                  <MoreHorizontal className="h-3 w-3" />
                  פעולות
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 text-xs">
                <DropdownMenuItem onClick={restoreToBaseline} disabled={!isModifiedFromBaseline}>
                  <History className="me-2 h-3.5 w-3.5" /> החזר לגרסת בסיס
                </DropdownMenuItem>
                <DropdownMenuItem onClick={compareMode ? toggleCompareMode : compareToBaseline} disabled={!hasBaseline}>
                  <GitCompare className="me-2 h-3.5 w-3.5" /> {compareMode ? 'סיים השוואה' : 'השווה לגרסת בסיס'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={setNewBaseline}>
                  <Bookmark className="me-2 h-3.5 w-3.5" /> קבע כגרסת בסיס
                </DropdownMenuItem>
                {onDuplicateSave && (
                  <DropdownMenuItem onClick={() => { setDupName(""); setDupDialogOpen(true); }}>
                    <Copy className="me-2 h-3.5 w-3.5" /> שכפל ושמור
                  </DropdownMenuItem>
                )}
                {onSaveLearning && (
                  <>
                    <DropdownMenuItem onClick={() => openLearningPicker('quick')} disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}>
                      <Brain className="me-2 h-3.5 w-3.5" /> שמור ללמידה
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openLearningPicker('advanced')} disabled={!learningEnabled || !learningProfiles.length || !editedTextForLearning}>
                      <Brain className="me-2 h-3.5 w-3.5" /> למידה עם הערה
                    </DropdownMenuItem>
                  </>
                )}
                {enableRichEdit && (
                  <DropdownMenuItem onClick={togglePreciseAlign}>
                    <Rows3 className="me-2 h-3.5 w-3.5" /> {preciseAlign ? 'עבור לעריכה חופשית' : 'הפעל יישור מדויק'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={toggleAlignmentMode}>
                  <AlignJustify className="me-2 h-3.5 w-3.5" /> {alignmentMode === 'mirrored-padded' ? 'כבה יישור 1:1' : 'הפעל יישור 1:1'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* Shared marking toolbar — lifted ABOVE both columns so each side starts at the same height */}
      {enableRichEdit && (
        <div className="px-3 pt-2 pb-1 border-b border-border/30 bg-background/40" dir="rtl">
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

      {/* Shared scroll container — two equal flex columns (no individual headers) */}
      <WordContextMenu
        word={menuTarget?.word ?? ''}
        suggestions={menuSuggestions}
        onReplace={(next) => {
          if (!menuTarget) return;
          applyWordReplace(menuTarget.globalIdx, next);
          setDictionaryVersion((v) => v + 1);
        }}
        onApproveAsCorrect={() => setDictionaryVersion((v) => v + 1)}
        isAnchor={menuTarget ? userAnchors.has(menuTarget.globalIdx) : false}
        onToggleAnchor={hasAudioTimings && menuTarget
          ? () => toggleUserAnchor(menuTarget.globalIdx, { start: menuTarget.start, end: menuTarget.end })
          : undefined}
      >
      <div
        ref={scrollRef}
        onContextMenuCapture={handleWordContextMenu}
        className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto"
      >
        {/* ── RIGHT column — full mirror, fully editable (unless locked) ── */}
        {!singleColumn && (
        <div
          ref={rightColRef}
          style={{ '--pane-basis': `${rightPct}%` } as React.CSSProperties}
          className={cn(
            "min-w-0 w-full lg:w-auto lg:[flex:0_0_var(--pane-basis)] flex flex-col border-s border-border/40 relative transition-opacity",
            lockedPane === 'right' && "opacity-90 bg-muted/30",
          )}
        >

          {/* Per-column control strip: active selector + lock */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 bg-background/60" dir="rtl">
            <button
              type="button"
              onClick={() => setActivePane('right')}
              className={cn("h-6 px-1.5 rounded text-[10px] flex items-center gap-1 transition-colors",
                activePane === 'right' ? `${navyClass} bg-blue-50 dark:bg-blue-950/40 font-semibold` : "text-muted-foreground hover:bg-muted")}
              title="הפוך את הצד הימני לפעיל (משפיע על צבע האייקונים בסרגל)"
            >
              {activePane === 'right' ? <CircleDot className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
              ימין פעיל
            </button>
            <button
              type="button"
              onClick={() => toggleLock('right')}
              className={cn("h-6 px-1.5 rounded text-[10px] flex items-center gap-1 transition-colors",
                lockedPane === 'right' ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 font-semibold" : "text-muted-foreground hover:bg-muted")}
              title={lockedPane === 'right' ? "שחרר נעילה — הצד הימני יחזור להיות עריך" : "נעל את הצד הימני — לא יקבל שינויים"}
            >
              {lockedPane === 'right' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {lockedPane === 'right' ? 'נעול' : 'פתוח'}
            </button>
          </div>
          {/* word rows — when rich-edit is on, pad-top dynamically to align with editor's first line */}
          <div
            ref={rightRowsRef}
            className="px-4 pb-4"
            style={{
              ...textStyle,
              paddingTop: effectiveRichEdit && !paddedAlignment ? rightTopOffset : 16,
            }}
          >
            {paddedAlignment && !compareMode ? (() => {
              const rows = lockedPane === 'right' ? paddedAlignment.snapshot : paddedAlignment.current;
              const src = lockedPane === 'right' ? snapshotLines : lines;
              let srcIdx = -1;
              return rows.map((row, ri) => {
                if (row.line) srcIdx++;
                return renderPaddedRow(row, ri, 'left', src, row.line ? srcIdx : -1);
              });
            })() : wordRows}
          </div>
        </div>

)}

        {/* ── Draggable column divider — drag to resize, double-click to reset to auto ── */}
        {!singleColumn && (
        <div
          role="separator"
          aria-orientation="vertical"
          title="גרור לשינוי רוחב העמודות · קליק כפול לאיפוס לאוטומטי"
          onPointerDown={(e) => {
            e.preventDefault();
            const container = scrollRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            const onMove = (ev: PointerEvent) => {
              const rightWidth = rect.right - ev.clientX;
              let pct = (rightWidth / rect.width) * 100;
              pct = Math.max(15, Math.min(85, pct));
              setManualSplit(pct);
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              document.body.style.userSelect = '';
              document.body.style.cursor = '';
            };
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
          onDoubleClick={() => setManualSplit(null)}
          className="group/divider relative hidden lg:block shrink-0 w-1.5 cursor-col-resize bg-border/40 hover:bg-primary/50 transition-colors"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-8 w-1 rounded-full bg-foreground/20 group-hover/divider:bg-primary/80 transition-colors" />
        </div>

)}

        {/* ── LEFT column: עריכה מסונכרנת (editable) ── */}
        <div
          ref={leftColRef}
          style={{ '--pane-basis': singleColumn ? '100%' : `${leftPct}%` } as React.CSSProperties}
          className={cn(
            "min-w-0 w-full lg:w-auto lg:[flex:0_0_var(--pane-basis)] flex flex-col relative transition-opacity",
            lockedPane === 'left' && "opacity-90 bg-muted/30",
          )}
        >

          {/* Per-column control strip: active selector + lock */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 bg-background/60" dir="rtl">
            <button
              type="button"
              onClick={() => setActivePane('left')}
              className={cn("h-6 px-1.5 rounded text-[10px] flex items-center gap-1 transition-colors",
                activePane === 'left' ? `${navyClass} bg-blue-50 dark:bg-blue-950/40 font-semibold` : "text-muted-foreground hover:bg-muted")}
              title="הפוך את הצד השמאלי לפעיל (משפיע על צבע האייקונים בסרגל)"
            >
              {activePane === 'left' ? <CircleDot className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
              שמאל פעיל
            </button>
            <button
              type="button"
              onClick={() => toggleLock('left')}
              className={cn("h-6 px-1.5 rounded text-[10px] flex items-center gap-1 transition-colors",
                lockedPane === 'left' ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 font-semibold" : "text-muted-foreground hover:bg-muted")}
              title={lockedPane === 'left' ? "שחרר נעילה — הצד השמאלי יחזור להיות עריך" : "נעל את הצד השמאלי — לא יקבל שינויים"}
            >
              {lockedPane === 'left' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {lockedPane === 'left' ? 'נעול' : 'פתוח'}
            </button>
          </div>
          <div style={{ pointerEvents: lockedPane === 'left' ? 'none' : undefined }} className="flex-1 min-h-0 flex flex-col">
          {effectiveRichEdit && !paddedAlignment ? (
            <div ref={leftRichRef} className="flex flex-col gap-2 p-3" dir="rtl">
              {/* Marking toolbar has been lifted above both columns (see top of layout). */}
              {/* RichTextEditor — full editing surface */}
              {!isMarkingActive && (
                <div
                  style={{ ...textStyle, ...(localTextColor ? { color: localTextColor } : {}) }}
                >
                  <RichTextEditor
                    text={text}
                    onChange={(v) => handleTextChangeFromPane('left', v)}
                    onSaveReplaceOriginal={onSaveReplace}
                    onDuplicateSave={onDuplicateSave ? () => onDuplicateSave('') : undefined}
                    onWordCorrected={onWordCorrected}
                    textAlign={sharedTextAlign}
                    onTextAlignChange={setSharedTextAlign}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Precise-alignment view: identical line breaks as the right column.
               Editing happens through right-click WordContextMenu (and the
               marking toolbar above when enableRichEdit is on). */
            <div className="flex flex-col" ref={leftRichRef}>
              {/* Marking toolbar lifted above both columns. */}

              {!isMarkingActive && (
                <div ref={leftRowsRef} className="p-4" style={textStyle}>
                  {paddedAlignment && !compareMode ? (() => {
                    const rows = lockedPane === 'left' ? paddedAlignment.snapshot : paddedAlignment.current;
                    const src = lockedPane === 'left' ? snapshotLines : lines;
                    let srcIdx = -1;
                    return rows.map((row, ri) => {
                      if (row.line) srcIdx++;
                      return renderPaddedRow(row, ri, 'left', src, row.line ? srcIdx : -1);
                    });
                  })() : wordRows}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
      </WordContextMenu>
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
