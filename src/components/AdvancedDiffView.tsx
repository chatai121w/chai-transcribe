import { Fragment, useState, useMemo, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRightLeft, ChevronDown, Copy, ArrowUp, ArrowDown, Layers, Star, Trash2, RotateCcw, ListChecks, X, Check, Pencil, Save, Undo2, ChevronRight, ChevronLeft, AlignJustify, Rows3, Minimize2, Maximize2 } from "lucide-react";
import { TextVersion } from "@/components/TextEditHistory";
import type { CloudTranscript } from "@/hooks/useCloudTranscripts";
import { ComparisonSourceDialog } from "@/components/ComparisonSourceDialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buildAdjudicationUnits, composeAdjudicatedText, composeCorrectedSideText, type AdjudicationResolution, type GlobalReplacementRule } from "@/lib/textAdjudication";

interface AdvancedDiffViewProps {
  versions: TextVersion[];
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  lineHeight?: number;
  onApplyVersion?: (text: string, versionId?: string) => void;
  onSaveVerifiedVersion?: (text: string) => void;
  /** Save a corrected source as a new version and make it the active editor text. */
  onSaveImmediateVersion?: (text: string, label: string) => void;
  preselectedLeftId?: string;
  preselectedRightId?: string;
  /** Optional: send the selected version into the AI editor as input */
  onSendToAiEditor?: (versionId: string) => void;
  preferenceStorageKey?: string;
  transcripts?: CloudTranscript[];
  onSelectLibraryTranscript?: (side: "base" | "new", transcript: CloudTranscript) => void;
}

type VersionFilter = "all" | "ai" | "manual" | "original" | "cloud" | "local";

const sourceLabels: Record<TextVersion['source'], string> = {
  original: 'תמלול ראשון',
  manual: 'עריכה ידנית',
  'ai-improve': 'AI - שיפור',
  'ai-sources': 'AI - מקורות',
  'ai-readable': 'AI - זורם',
  'ai-custom': 'AI - מותאם',
  'ai-fix': 'AI - תיקון',
  'ai-grammar': 'AI - דקדוק',
  'ai-punctuation': 'AI - פיסוק',
  'ai-paragraphs': 'AI - פסקאות',
  'ai-bullets': 'AI - תבליטים',
  'ai-headings': 'AI - כותרות',
  'ai-expand': 'AI - הרחבה',
  'ai-shorten': 'AI - קיצור',
  'ai-summarize': 'AI - סיכום',
  'ai-translate': 'AI - תרגום',
  'ai-speakers': 'AI - דוברים',
  'ai-tone': 'AI - טון',
};

type WordToken = {
  text: string;
  norm: string;
};

type WordDiffChunk = {
  op: -1 | 0 | 1;
  text: string;
};

/**
 * One aligned row of the side-by-side view. `left` and `right` always occupy
 * the SAME grid row, so the two columns mirror each other line-by-line:
 *  - kind "equal":  identical text on both sides.
 *  - kind "change": removed text on the left, added text on the right; if one
 *    side is empty the cell renders blank but still fills the row's height.
 */
type DiffRow = {
  kind: "equal" | "change";
  left: WordDiffChunk[];
  right: WordDiffChunk[];
};

type WordDiffResult = {
  rows: DiffRow[];
  addedWords: number;
  removedWords: number;
  unchangedWords: number;
  leftWords: number;
  rightWords: number;
};

const HEBREW_NIKUD_RE = /[\u0591-\u05C7]/g;
const HEBREW_QUOTE_RE = /[\u05F3\u05F4'"״׳`´]/g;
const OUTER_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function normalizeDiffToken(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .replace(HEBREW_NIKUD_RE, "")
    .replace(HEBREW_QUOTE_RE, "")
    .replace(OUTER_PUNCT_RE, "")
    .toLocaleLowerCase("he");
}

function tokenizeWords(text: string): WordToken[] {
  const matches = text.match(/\S+\s*/g) || [];
  return matches
    .map((part) => ({ text: part, norm: normalizeDiffToken(part) }))
    .filter((token) => token.norm.length > 0);
}

type WordChunkResult = {
  left: WordDiffChunk[];
  right: WordDiffChunk[];
  addedWords: number;
  removedWords: number;
  unchangedWords: number;
};

/** Merge a fragment into a chunk list, joining it with the previous same-op chunk. */
function pushChunk(chunks: WordDiffChunk[], op: WordDiffChunk["op"], text: string) {
  if (!text) return;
  const last = chunks[chunks.length - 1];
  if (last?.op === op) last.text += text;
  else chunks.push({ op, text });
}

/**
 * Inline word-level diff between two strings, via LCS alignment.
 * The result flows as continuous text — changed words are highlighted in place,
 * so the text is NEVER broken into separate blocks (no empty half-lines).
 */
function wordDiffChunks(left: string, right: string): WordChunkResult {
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const dp = Array.from({ length: leftTokens.length + 1 }, () => new Uint16Array(rightTokens.length + 1));

  for (let i = leftTokens.length - 1; i >= 0; i--) {
    for (let j = rightTokens.length - 1; j >= 0; j--) {
      dp[i][j] = leftTokens[i].norm === rightTokens[j].norm
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const leftChunks: WordDiffChunk[] = [];
  const rightChunks: WordDiffChunk[] = [];
  let i = 0;
  let j = 0;
  let unchangedWords = 0;
  let addedWords = 0;
  let removedWords = 0;

  while (i < leftTokens.length || j < rightTokens.length) {
    if (i < leftTokens.length && j < rightTokens.length && leftTokens[i].norm === rightTokens[j].norm) {
      pushChunk(leftChunks, 0, leftTokens[i].text);
      pushChunk(rightChunks, 0, rightTokens[j].text);
      unchangedWords++;
      i++;
      j++;
      continue;
    }

    const leftStart = i;
    const rightStart = j;
    while (i < leftTokens.length || j < rightTokens.length) {
      if (i < leftTokens.length && j < rightTokens.length && leftTokens[i].norm === rightTokens[j].norm) break;
      if (j >= rightTokens.length || (i < leftTokens.length && dp[i + 1][j] >= dp[i][j + 1])) i++;
      else j++;
    }

    const removed = leftTokens.slice(leftStart, i);
    const added = rightTokens.slice(rightStart, j);
    pushChunk(leftChunks, -1, removed.map((t) => t.text).join(""));
    pushChunk(rightChunks, 1, added.map((t) => t.text).join(""));
    removedWords += removed.length;
    addedWords += added.length;
  }

  return { left: leftChunks, right: rightChunks, addedWords, removedWords, unchangedWords };
}

/** Split text into paragraphs at newlines, keeping the newline on each piece. */
function splitParagraphs(text: string): string[] {
  if (!text) return [];
  return text.split(/\n/).map((p, idx, arr) => (idx < arr.length - 1 ? p + "\n" : p));
}

/** Normalized signature of a paragraph — used to align paragraphs between versions. */
function normalizeParagraph(text: string): string {
  return tokenizeWords(text).map((t) => t.norm).join(" ");
}

/**
 * Paragraph-level diff. Paragraphs are aligned first (LCS), and each aligned
 * pair is then word-diffed INLINE. Rows therefore break only at real paragraph
 * boundaries — text inside a paragraph always flows naturally, with no empty
 * fragments mid-line.
 */
function buildWordDiff(left: string, right: string): WordDiffResult {
  const leftParas = splitParagraphs(left);
  const rightParas = splitParagraphs(right);
  const leftNorm = leftParas.map(normalizeParagraph);
  const rightNorm = rightParas.map(normalizeParagraph);

  const dp = Array.from({ length: leftParas.length + 1 }, () => new Uint16Array(rightParas.length + 1));
  for (let i = leftParas.length - 1; i >= 0; i--) {
    for (let j = rightParas.length - 1; j >= 0; j--) {
      dp[i][j] = leftNorm[i] === rightNorm[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let addedWords = 0;
  let removedWords = 0;
  let unchangedWords = 0;

  const addRow = (kind: DiffRow["kind"], leftText: string, rightText: string) => {
    const wd = wordDiffChunks(leftText, rightText);
    rows.push({ kind, left: leftText ? wd.left : [], right: rightText ? wd.right : [] });
    addedWords += wd.addedWords;
    removedWords += wd.removedWords;
    unchangedWords += wd.unchangedWords;
  };

  while (i < leftParas.length || j < rightParas.length) {
    // Matching paragraph → one aligned row (still inline-diffed for tiny edits).
    if (i < leftParas.length && j < rightParas.length && leftNorm[i] === rightNorm[j]) {
      addRow("equal", leftParas[i], rightParas[j]);
      i++;
      j++;
      continue;
    }

    // Run of changed paragraphs → one aligned row, removed left / added right.
    const leftStart = i;
    const rightStart = j;
    while (i < leftParas.length || j < rightParas.length) {
      if (i < leftParas.length && j < rightParas.length && leftNorm[i] === rightNorm[j]) break;
      if (j >= rightParas.length || (i < leftParas.length && dp[i + 1][j] >= dp[i][j + 1])) i++;
      else j++;
    }
    addRow("change", leftParas.slice(leftStart, i).join(""), rightParas.slice(rightStart, j).join(""));
  }

  return {
    rows,
    addedWords,
    removedWords,
    unchangedWords,
    leftWords: tokenizeWords(left).length,
    rightWords: tokenizeWords(right).length,
  };
}

export const AdvancedDiffView = ({
  versions,
  fontSize = 16,
  fontFamily = 'Assistant',
  textColor = 'hsl(var(--foreground))',
  lineHeight = 1.6,
  onApplyVersion,
  onSaveVerifiedVersion,
  onSaveImmediateVersion,
  preselectedLeftId,
  preselectedRightId,
  onSendToAiEditor,
  preferenceStorageKey = "advanced-diff",
  transcripts = [],
  onSelectLibraryTranscript,
}: AdvancedDiffViewProps) => {
  const favoritesKey = `compare_favorites_v1:${preferenceStorageKey}`;
  const hiddenKey = `compare_hidden_v1:${preferenceStorageKey}`;
  const readPreferenceSet = (key: string) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set<string>();
    }
  };
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => readPreferenceSet(favoritesKey));
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => readPreferenceSet(hiddenKey));
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);
  const [sourceDialogSide, setSourceDialogSide] = useState<"base" | "new" | null>(null);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set());
  const defaultLeftId = useMemo(() => versions.find(v => v.source === 'original')?.id || versions[0]?.id || '', [versions]);
  const defaultRightId = useMemo(() => {
    const nonOriginal = [...versions].reverse().find(v => v.source !== 'original');
    return nonOriginal?.id || versions[versions.length - 1]?.id || defaultLeftId;
  }, [versions, defaultLeftId]);
  const [leftId, setLeftId] = useState(preselectedLeftId || defaultLeftId);
  const [rightId, setRightId] = useState(preselectedRightId || defaultRightId);
  const appliedPreselectionRef = useRef("");

  // Re-apply preselect when caller pushes a new pair. A distinct right version
  // detaches the right column and loads that version, so the diff shows at once.
  useEffect(() => {
    const preselectionKey = `${preselectedLeftId || ""}:${preselectedRightId || ""}`;
    const requestedIds = [preselectedLeftId, preselectedRightId].filter(Boolean) as string[];
    if (!requestedIds.length || requestedIds.some((id) => !versions.some((version) => version.id === id))) return;
    if (appliedPreselectionRef.current === preselectionKey) return;

    if (preselectedLeftId && versions.some(v => v.id === preselectedLeftId)) {
      setLeftId(preselectedLeftId);
      const preLeft = versions.find(v => v.id === preselectedLeftId);
      if (preLeft) {
        setLeftText(preLeft.text);
        setLeftDetached(false);
      }
    }
    const preRight = preselectedRightId
      ? versions.find(v => v.id === preselectedRightId)
      : undefined;
    if (preRight) {
      setRightId(preRight.id);
      setRightText(preRight.text);
      setRightDetached(true);
    }
    appliedPreselectionRef.current = preselectionKey;
  }, [preselectedLeftId, preselectedRightId, versions]);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'adjudicate' | 'unified' | 'stats'>('side-by-side');
  const [comparisonLayout, setComparisonLayout] = useState<'continuous' | 'aligned'>(() => {
    try {
      return localStorage.getItem("comparison_adjudication_layout") === "aligned" ? "aligned" : "continuous";
    } catch {
      return "continuous";
    }
  });
  const [versionFilter, setVersionFilter] = useState<VersionFilter>("all");

  useEffect(() => {
    try {
      localStorage.setItem("comparison_adjudication_layout", comparisonLayout);
    } catch {
      // The layout still works when storage is unavailable.
    }
  }, [comparisonLayout]);

  const selectableVersions = useMemo(() => {
    const isCloudVersion = (v: TextVersion) => v.id.includes("-") && v.id.length >= 30;
    const visible = versions.filter((version) => !hiddenIds.has(version.id));
    let filtered = visible;
    if (versionFilter === "ai") filtered = visible.filter((v) => v.source.startsWith("ai-"));
    else if (versionFilter === "manual") filtered = visible.filter((v) => v.source === "manual");
    else if (versionFilter === "original") filtered = visible.filter((v) => v.source === "original");
    else if (versionFilter === "cloud") filtered = visible.filter((v) => isCloudVersion(v));
    else if (versionFilter === "local") filtered = visible.filter((v) => !isCloudVersion(v));
    return [...filtered].sort((a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)));
  }, [versions, versionFilter, hiddenIds, favoriteIds]);

  const updatePreferenceSet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    storageKey: string,
    id: string,
    enabled: boolean,
  ) => {
    setter((previous) => {
      const next = new Set(previous);
      if (enabled) next.add(id);
      else next.delete(id);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* unavailable */ }
      return next;
    });
  };

  useEffect(() => {
    if (!versions.length) {
      setLeftId('');
      setRightId('');
      return;
    }

    if (!leftId || !versions.some((v) => v.id === leftId)) {
      setLeftId(defaultLeftId);
    }
    if (!rightId || !versions.some((v) => v.id === rightId)) {
      setRightId(defaultRightId);
    }
  }, [versions, leftId, rightId, defaultLeftId, defaultRightId]);

  useEffect(() => {
    if (!selectableVersions.length) return;
    if (!selectableVersions.some((v) => v.id === leftId)) {
      setLeftId(selectableVersions[0].id);
    }
    if (!selectableVersions.some((v) => v.id === rightId)) {
      setRightId(selectableVersions[selectableVersions.length - 1].id);
    }
  }, [selectableVersions, leftId, rightId]);

  const leftVersion = versions.find(v => v.id === leftId);
  const rightVersion = versions.find(v => v.id === rightId);

  // Each side owns its selected version. Editing changes only the local buffer;
  // selecting another version always reloads that version's stored text.
  const [leftText, setLeftText] = useState(leftVersion?.text ?? "");
  const [rightText, setRightText] = useState(rightVersion?.text ?? "");
  const [leftDetached, setLeftDetached] = useState(false);
  const [rightDetached, setRightDetached] = useState(false);
  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    if (!leftDetached) setLeftText(leftVersion?.text ?? "");
  }, [leftVersion?.id, leftVersion?.text, leftDetached]);

  useEffect(() => {
    if (!rightDetached) setRightText(rightVersion?.text ?? "");
  }, [rightVersion?.id, rightVersion?.text, rightDetached]);

  const editLeft = (value: string) => { setLeftDetached(true); setLeftText(value); };
  const editRight = (value: string) => { setRightDetached(true); setRightText(value); };
  const revertLeft = () => { setLeftDetached(false); setLeftText(leftVersion?.text ?? ""); setEditingSide((s) => (s === "left" ? null : s)); };
  const revertRight = () => { setRightDetached(false); setRightText(rightVersion?.text ?? ""); setEditingSide((s) => (s === "right" ? null : s)); };

  const selectLeftVersion = (nextId: string) => {
    const next = versions.find((version) => version.id === nextId);
    if (!next) return;
    if (nextId === rightId && leftVersion) {
      setRightId(leftVersion.id);
      setRightText(leftVersion.text);
      setRightDetached(false);
    }
    setLeftId(nextId);
    setLeftText(next.text);
    setLeftDetached(false);
  };

  const selectRightVersion = (nextId: string) => {
    const next = versions.find((version) => version.id === nextId);
    if (!next) return;
    if (nextId === leftId && rightVersion) {
      setLeftId(rightVersion.id);
      setLeftText(rightVersion.text);
      setLeftDetached(false);
    }
    setRightId(nextId);
    setRightText(next.text);
    setRightDetached(false);
  };

  const wordDiff = useMemo(() => buildWordDiff(leftText, rightText), [leftText, rightText]);
  const adjudicationUnits = useMemo(() => buildAdjudicationUnits(leftText, rightText), [leftText, rightText]);
  const conflictUnits = useMemo(() => adjudicationUnits.filter((unit) => unit.kind === "conflict"), [adjudicationUnits]);
  const [resolutions, setResolutions] = useState<Record<string, AdjudicationResolution>>({});
  const [verifiedText, setVerifiedText] = useState("");
  const [activeConflictIndex, setActiveConflictIndex] = useState(0);
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({});
  const [replacementRules, setReplacementRules] = useState<GlobalReplacementRule[]>([]);
  const [applyEverywhere, setApplyEverywhere] = useState(false);
  const [replacementSource, setReplacementSource] = useState<"left" | "right">("left");
  const [quickDecision, setQuickDecision] = useState<{ unitId: string; side: "left" | "right" } | null>(null);
  const [quickDecisionMinimized, setQuickDecisionMinimized] = useState(false);
  const [quickCustomText, setQuickCustomText] = useState("");
  const [quickApplyEverywhere, setQuickApplyEverywhere] = useState(false);
  const [quickReplacementSource, setQuickReplacementSource] = useState<"left" | "right">("left");
  const resolutionHistoryRef = useRef<Array<{ resolutions: Record<string, AdjudicationResolution>; rules: GlobalReplacementRule[] }>>([]);

  useEffect(() => {
    setResolutions({});
    setCustomDrafts({});
    setReplacementRules([]);
    setApplyEverywhere(false);
    setQuickDecision(null);
    setQuickCustomText("");
    setQuickApplyEverywhere(false);
    setActiveConflictIndex(0);
    resolutionHistoryRef.current = [];
    setVerifiedText(composeAdjudicatedText(adjudicationUnits, {}));
  }, [leftId, rightId, leftText, rightText, adjudicationUnits]);

  const applyResolution = (unitId: string, resolution: AdjudicationResolution, replacementRule?: GlobalReplacementRule) => {
    resolutionHistoryRef.current.push({ resolutions, rules: replacementRules });
    const next = { ...resolutions, [unitId]: resolution };
    const nextRules = replacementRule
      ? [...replacementRules.filter((rule) => rule.source !== replacementRule.source), replacementRule]
      : replacementRules;
    setResolutions(next);
    setReplacementRules(nextRules);
    setVerifiedText(composeAdjudicatedText(adjudicationUnits, next, nextRules));
    const nextUnresolved = conflictUnits.findIndex((unit, index) => index > activeConflictIndex && !next[unit.id]);
    if (nextUnresolved >= 0) setActiveConflictIndex(nextUnresolved);
  };

  const undoResolution = () => {
    const previous = resolutionHistoryRef.current.pop();
    if (!previous) return;
    setResolutions(previous.resolutions);
    setReplacementRules(previous.rules);
    setVerifiedText(composeAdjudicatedText(adjudicationUnits, previous.resolutions, previous.rules));
  };

  const openCustomDecision = (index: number) => {
    setActiveConflictIndex(index);
    setApplyEverywhere(false);
    setReplacementSource(conflictUnits[index]?.leftText.trim() ? "left" : "right");
  };

  const confirmCustomResolution = (unitId: string) => {
    const unit = conflictUnits.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    const draft = customDrafts[unit.id] ?? unit.rightText.trimEnd();
    const trailingSpace = unit.rightText.match(/\s+$/)?.[0] || unit.leftText.match(/\s+$/)?.[0] || "";
    const rule = applyEverywhere
      ? { source: replacementSource === "left" ? unit.leftText : unit.rightText, replacement: draft }
      : undefined;
    applyResolution(unit.id, { choice: "custom", customText: `${draft}${trailingSpace}` }, rule);
  };

  const quickDecisionUnit = quickDecision
    ? conflictUnits.find((unit) => unit.id === quickDecision.unitId)
    : undefined;

  const openQuickDecision = (unitId: string, side: "left" | "right") => {
    const unit = conflictUnits.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    setQuickDecision({ unitId, side });
    setQuickDecisionMinimized(false);
    setQuickCustomText((side === "left" ? unit.leftText : unit.rightText).trim());
    setQuickApplyEverywhere(false);
    setQuickReplacementSource(side === "left" ? "right" : "left");
  };

  const closeQuickDecision = () => {
    setQuickDecision(null);
    setQuickDecisionMinimized(false);
    setQuickApplyEverywhere(false);
  };

  const confirmQuickSource = (applyToAll: boolean) => {
    if (!quickDecision || !quickDecisionUnit) return;
    const chosenText = quickDecision.side === "left" ? quickDecisionUnit.leftText : quickDecisionUnit.rightText;
    const wrongText = quickDecision.side === "left" ? quickDecisionUnit.rightText : quickDecisionUnit.leftText;
    applyResolution(
      quickDecisionUnit.id,
      { choice: quickDecision.side },
      applyToAll ? { source: wrongText, replacement: chosenText } : undefined,
    );
    closeQuickDecision();
  };

  const saveQuickSourceImmediately = (applyToAll: boolean) => {
    if (!quickDecision || !quickDecisionUnit || !onSaveImmediateVersion) return;
    const chosenText = quickDecision.side === "left" ? quickDecisionUnit.leftText : quickDecisionUnit.rightText;
    const wrongText = quickDecision.side === "left" ? quickDecisionUnit.rightText : quickDecisionUnit.leftText;
    const targetSide = quickDecision.side === "left" ? "right" : "left";
    const correctedText = composeCorrectedSideText(
      adjudicationUnits,
      targetSide,
      quickDecisionUnit.id,
      chosenText,
      applyToAll ? wrongText : undefined,
    );

    if (targetSide === "left") {
      setLeftDetached(true);
      setLeftText(correctedText);
    } else {
      setRightDetached(true);
      setRightText(correctedText);
    }
    onSaveImmediateVersion(correctedText, applyToAll ? "תיקון מיידי בכל המופעים" : "תיקון מיידי בהשוואה");
    toast({
      title: "התיקון נשמר והוחל מיד",
      description: targetSide === "left" ? "גרסת הבסיס תוקנה ונשמרה כגרסה חדשה" : "הגרסה החדשה תוקנה ונשמרה כגרסה חדשה",
    });
    closeQuickDecision();
  };

  const confirmQuickCustom = () => {
    if (!quickDecisionUnit || !quickCustomText.trim()) return;
    const trailingSpace = quickDecisionUnit.rightText.match(/\s+$/)?.[0]
      || quickDecisionUnit.leftText.match(/\s+$/)?.[0]
      || "";
    const wrongText = quickReplacementSource === "left" ? quickDecisionUnit.leftText : quickDecisionUnit.rightText;
    applyResolution(
      quickDecisionUnit.id,
      { choice: "custom", customText: `${quickCustomText.trim()}${trailingSpace}` },
      quickApplyEverywhere ? { source: wrongText, replacement: quickCustomText.trim() } : undefined,
    );
    closeQuickDecision();
  };

  const saveQuickCustomImmediately = () => {
    if (!quickDecisionUnit || !quickCustomText.trim() || !onSaveImmediateVersion) return;
    const replacement = quickCustomText.trim();
    const trailingSpace = quickDecisionUnit.rightText.match(/\s+$/)?.[0]
      || quickDecisionUnit.leftText.match(/\s+$/)?.[0]
      || "";
    const replacementWithSpacing = `${replacement}${trailingSpace}`;
    const correctedLeft = composeCorrectedSideText(
      adjudicationUnits,
      "left",
      quickDecisionUnit.id,
      replacementWithSpacing,
      quickApplyEverywhere ? quickDecisionUnit.leftText : undefined,
    );
    const correctedRight = composeCorrectedSideText(
      adjudicationUnits,
      "right",
      quickDecisionUnit.id,
      replacementWithSpacing,
      quickApplyEverywhere ? quickDecisionUnit.rightText : undefined,
    );
    setLeftDetached(true);
    setRightDetached(true);
    setLeftText(correctedLeft);
    setRightText(correctedRight);
    // The newer/right-hand text is the active corrected result. Both columns
    // update immediately, while the original historical versions remain intact.
    onSaveImmediateVersion(correctedRight, quickApplyEverywhere ? "תיקון מיידי בשתי הגרסאות ובכל המופעים" : "תיקון מיידי בשתי הגרסאות");
    toast({ title: "שתי הגרסאות תוקנו מיד", description: "הנוסח המתוקן נשמר כגרסה חדשה והמקורות נשמרו בהיסטוריה" });
    closeQuickDecision();
  };

  const resolvedCount = conflictUnits.filter((unit) => Boolean(resolutions[unit.id])).length;
  const unresolvedCount = conflictUnits.length - resolvedCount;

  // Per-column inline streams (flattened from the aligned rows). When the two
  // buffers are identical (mirror state) these contain no highlights at all.
  const leftFlow = useMemo(() => wordDiff.rows.flatMap((r) => r.left), [wordDiff]);
  const rightFlow = useMemo(() => wordDiff.rows.flatMap((r) => r.right), [wordDiff]);

  const stats = useMemo(() => {
    const maxWords = Math.max(wordDiff.leftWords, wordDiff.rightWords);
    const similarity = maxWords > 0 ? Math.round((wordDiff.unchangedWords / maxWords) * 100) : 100;
    
    const lWords = leftText.split(/\s+/).filter(w => w).length || 0;
    const rWords = rightText.split(/\s+/).filter(w => w).length || 0;
    const lChars = leftText.length;
    const rChars = rightText.length;

    // Character counts, summed over the aligned rows (single source of truth).
    // Removed lives only on the left, added only on the right; unchanged text is
    // identical on both sides, so count it once (from the left).
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const row of wordDiff.rows) {
      for (const chunk of row.left) {
        if (chunk.op === -1) removed += chunk.text.length;
        else if (chunk.op === 0) unchanged += chunk.text.length;
      }
      for (const chunk of row.right) {
        if (chunk.op === 1) added += chunk.text.length;
      }
    }

    return {
      added,
      removed,
      unchanged,
      addedWords: wordDiff.addedWords,
      removedWords: wordDiff.removedWords,
      similarity,
      lWords,
      rWords,
      lChars,
      rChars,
    };
  }, [leftText, rightText, wordDiff]);

  // Single renderer for both views: colours each chunk by its op.
  const renderChunks = (chunks: WordDiffChunk[]) => {
    return chunks.map((chunk, i) => {
      if (chunk.op === 0) return <Fragment key={i}>{chunk.text}</Fragment>;
      return (
        <span
          key={i}
          className={cn(
            "rounded px-0.5 font-medium",
            chunk.op === -1 && "bg-rose-500/20 text-rose-900 dark:text-rose-100",
            chunk.op === 1 && "bg-emerald-500/20 text-emerald-900 dark:text-emerald-100",
          )}
        >
          {chunk.text}
        </span>
      );
    });
  };

  // Unified stream: flatten the aligned rows in order (removed then added).
  const unifiedChunks = useMemo<WordDiffChunk[]>(
    () => wordDiff.rows.flatMap((row) => (row.kind === "equal" ? row.left : [...row.left, ...row.right])),
    [wordDiff],
  );

  const copyDiff = () => {
    if (!rightVersion) return;
    navigator.clipboard.writeText(rightVersion.text);
    toast({ title: "הועתק ללוח" });
  };

  const textStyle = { fontFamily, fontSize: `${fontSize}px`, color: textColor, lineHeight };

  const getLabel = (v: TextVersion) => {
    const action = v.actionLabel?.trim() || sourceLabels[v.source];
    const engine = v.engineLabel?.trim();
    const detail = engine
      || (v.source === 'original' ? 'המנוע לא נשמר' : v.customPrompt?.trim());
    const runs = (v.runCount || 0) > 1 ? ` · ${v.runCount} הרצות זהות` : '';
    const label = `${detail ? `${detail} · ` : ''}${action}${runs}`;
    return favoriteIds.has(v.id) ? `★ ${label}` : label;
  };

  const renderVersionActions = (versionId: string) => (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        onClick={() => updatePreferenceSet(setFavoriteIds, favoritesKey, versionId, !favoriteIds.has(versionId))}
        title={favoriteIds.has(versionId) ? "הסר ממועדפים" : "סמן כמועדף"}
      >
        <Star className={cn("h-4 w-4", favoriteIds.has(versionId) && "fill-amber-400 text-amber-600")} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => {
          updatePreferenceSet(setHiddenIds, hiddenKey, versionId, true);
          toast({ title: "הגרסה הוסרה מההשוואה", description: "התמלול המקורי נשאר שמור בהיסטוריה" });
        }}
        title="הסר מרשימת ההשוואה"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );

  const toggleRemovalSelection = (versionId: string, checked: boolean) => {
    setSelectedForRemoval((previous) => {
      const next = new Set(previous);
      if (checked) next.add(versionId);
      else next.delete(versionId);
      return next;
    });
  };

  const hideSelectedVersions = () => {
    if (!selectedForRemoval.size) return;
    if (selectableVersions.length - selectedForRemoval.size < 2) {
      toast({
        title: "יש להשאיר לפחות שתי גרסאות",
        description: "כך ניתן להמשיך לבצע השוואה בין שני תמלולים.",
        variant: "destructive",
      });
      return;
    }
    setHiddenIds((previous) => {
      const next = new Set(previous);
      selectedForRemoval.forEach((id) => next.add(id));
      try { localStorage.setItem(hiddenKey, JSON.stringify(Array.from(next))); } catch { /* unavailable */ }
      return next;
    });
    toast({
      title: `${selectedForRemoval.size} גרסאות הוסרו מההשוואה`,
      description: "התמלולים המקוריים נשארו שמורים וניתן לשחזר אותם.",
    });
    setSelectedForRemoval(new Set());
    setMultiSelectOpen(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            <span className="font-semibold">השוואה מתקדמת</span>
          </div>
          
          <div className="flex-1" />
          
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-auto" dir="rtl">
            <TabsList className="h-8">
              <TabsTrigger value="side-by-side" className="text-xs px-2 h-7">השוואה והכרעה</TabsTrigger>
              <TabsTrigger value="adjudicate" className="text-xs px-2 h-7">הכרעה</TabsTrigger>
              <TabsTrigger value="unified" className="text-xs px-2 h-7">מאוחד</TabsTrigger>
              <TabsTrigger value="stats" className="text-xs px-2 h-7">סטטיסטיקות</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="flex items-center gap-2 md:col-span-2">
            <Badge variant="secondary" className="shrink-0 text-xs">סינון</Badge>
            <Select value={versionFilter} onValueChange={(v) => setVersionFilter(v as VersionFilter)}>
              <SelectTrigger className="text-xs h-8 max-w-[220px]" dir="rtl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all" className="text-xs">הכול</SelectItem>
                <SelectItem value="ai" className="text-xs">רק AI</SelectItem>
                <SelectItem value="manual" className="text-xs">רק ידני</SelectItem>
                <SelectItem value="original" className="text-xs">רק מקור</SelectItem>
                <SelectItem value="cloud" className="text-xs">רק ענן</SelectItem>
                <SelectItem value="local" className="text-xs">רק מקומי</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">{selectableVersions.length} גרסאות זמינות לבחירה</span>
            <Button
              type="button"
              variant={multiSelectOpen ? "secondary" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setMultiSelectOpen((open) => !open);
                setSelectedForRemoval(new Set());
              }}
            >
              {multiSelectOpen ? <X className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
              {multiSelectOpen ? "סגור בחירה" : "בחירה מרובה"}
            </Button>
            {hiddenIds.size > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => {
                  setHiddenIds(new Set());
                  try { localStorage.removeItem(hiddenKey); } catch { /* unavailable */ }
                  toast({ title: "הגרסאות שהוסרו הוחזרו להשוואה" });
                }}
                title="החזר את כל הגרסאות שהוסרו מרשימת ההשוואה"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                שחזר מוסתרים ({hiddenIds.size})
              </Button>
            )}
          </div>
          {multiSelectOpen && (
            <div className="md:col-span-2 rounded-md border bg-muted/20 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  נבחרו {selectedForRemoval.size} מתוך {selectableVersions.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const removable = selectableVersions.slice(0, Math.max(0, selectableVersions.length - 2));
                      setSelectedForRemoval(new Set(removable.map((version) => version.id)));
                    }}
                  >
                    בחר הכול האפשרי
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={!selectedForRemoval.size}
                    onClick={hideSelectedVersions}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    הסר נבחרים
                  </Button>
                </div>
              </div>
              <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto md:grid-cols-2">
                {selectableVersions.map((version) => (
                  <label
                    key={version.id}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <Checkbox
                      checked={selectedForRemoval.has(version.id)}
                      onCheckedChange={(checked) => toggleRemovalSelection(version.id, checked === true)}
                    />
                    <span className="truncate" title={getLabel(version)}>{getLabel(version)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-2 rounded-md border border-rose-200/70 bg-rose-500/[0.03] p-3 dark:border-rose-900/60">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="shrink-0 text-xs">בסיס</Badge>
              <span className="text-[11px] text-muted-foreground">המקור שמולו משווים</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-0 flex-1 justify-between gap-3 px-3 text-right text-xs"
              onClick={() => setSourceDialogSide("base")}
              data-testid="choose-comparison-base"
            >
              <span className="min-w-0 flex-1 truncate">{leftVersion ? getLabel(leftVersion) : "בחר מקור להשוואה"}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
            {leftId && renderVersionActions(leftId)}
            {onSendToAiEditor && leftId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[11px] px-2 shrink-0 text-yellow-700 hover:text-yellow-800 hover:bg-yellow-500/10"
                onClick={() => onSendToAiEditor(leftId)}
                title="שלח גרסה זו לעריכת AI"
              >
                שלח ל-AI
              </Button>
            )}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 rounded-md border border-emerald-200/70 bg-emerald-500/[0.03] p-3 dark:border-emerald-900/60">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="default" className="shrink-0 text-xs">חדש</Badge>
              <span className="text-[11px] text-muted-foreground">הגרסה שנבדקת מול הבסיס</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-0 flex-1 justify-between gap-3 px-3 text-right text-xs"
              onClick={() => setSourceDialogSide("new")}
              data-testid="choose-comparison-new"
            >
              <span className="min-w-0 flex-1 truncate">{rightVersion ? getLabel(rightVersion) : "בחר מקור להשוואה"}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
            {rightId && renderVersionActions(rightId)}
            {onSendToAiEditor && rightId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[11px] px-2 shrink-0 text-yellow-700 hover:text-yellow-800 hover:bg-yellow-500/10"
                onClick={() => onSendToAiEditor(rightId)}
                title="שלח גרסה זו לעריכת AI"
              >
                שלח ל-AI
              </Button>
            )}
            </div>
          </div>
        </div>

        {/* Quick stats bar */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t text-xs">
          <span className="text-muted-foreground">דמיון:</span>
          <div className="flex items-center gap-1.5">
            <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
              <div 
                className="h-full rounded-full transition-all"
                style={{ 
                  width: `${stats.similarity}%`,
                  backgroundColor: stats.similarity > 80 ? 'hsl(var(--primary))' : stats.similarity > 50 ? 'hsl(40 90% 50%)' : 'hsl(var(--destructive))'
                }}
              />
            </div>
            <span className="font-bold">{stats.similarity}%</span>
          </div>
          <span className="text-green-600 dark:text-green-400">+{stats.addedWords} מילים</span>
          <span className="text-destructive">-{stats.removedWords} מילים</span>
          {onApplyVersion && rightVersion && (
            <div className="flex-1 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copyDiff}>
                <Copy className="w-3 h-3 ml-1" />העתק
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => onApplyVersion(rightVersion.text, rightVersion.id)}>
                החל גרסה חדשה
              </Button>
            </div>
          )}
        </div>
      </Card>

      <ComparisonSourceDialog
        open={sourceDialogSide !== null}
        side={sourceDialogSide || "base"}
        versions={selectableVersions}
        transcripts={transcripts}
        selectedVersionId={sourceDialogSide === "new" ? rightId : leftId}
        getVersionLabel={getLabel}
        onOpenChange={(open) => { if (!open) setSourceDialogSide(null); }}
        onSelectVersion={(versionId) => {
          if (sourceDialogSide === "new") selectRightVersion(versionId);
          else selectLeftVersion(versionId);
        }}
        onSelectTranscript={(transcript) => {
          onSelectLibraryTranscript?.(sourceDialogSide || "base", transcript);
        }}
      />

      {viewMode === 'side-by-side' && (
        <Card className="overflow-hidden" data-testid="comparison-adjudication-view">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">השוואה והכרעה</h3>
              <p className="text-xs text-muted-foreground">לחץ פעמיים על הנוסח הנכון. החלפת התצוגה אינה משנה או מאפסת את ההכרעות.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex h-8 items-center rounded-md border bg-background p-0.5" role="group" aria-label="פריסת ההשוואה">
                <Button
                  type="button"
                  size="icon"
                  variant={comparisonLayout === "continuous" ? "default" : "ghost"}
                  className="h-7 w-7"
                  onClick={() => setComparisonLayout("continuous")}
                  title="תצוגה רציפה"
                  aria-label="תצוגה רציפה"
                >
                  <AlignJustify className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={comparisonLayout === "aligned" ? "default" : "ghost"}
                  className="h-7 w-7"
                  onClick={() => setComparisonLayout("aligned")}
                  title="תצוגה לפי הבדלים"
                  aria-label="תצוגה לפי הבדלים"
                >
                  <Rows3 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Badge variant="secondary">הוכרעו {resolvedCount}</Badge>
              <Badge variant={unresolvedCount ? "outline" : "default"}>נותרו {unresolvedCount}</Badge>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={undoResolution} disabled={!resolutionHistoryRef.current.length}>
                <Undo2 className="h-3.5 w-3.5" /> ביטול
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 border-b bg-muted/10 text-sm font-medium">
            <div className="border-l px-4 py-2 text-right">גרסת בסיס</div>
            <div className="px-4 py-2 text-right">גרסה חדשה</div>
          </div>
          {comparisonLayout === "continuous" ? (
            <ScrollArea className="h-[500px]">
              <div className="grid min-h-[500px] grid-cols-2" dir="rtl" style={textStyle}>
                {(["left", "right"] as const).map((side) => (
                  <div key={side} className={cn("px-4 py-4 text-right whitespace-pre-wrap break-words", side === "left" && "border-l")}>
                    {adjudicationUnits.map((unit) => {
                      const text = side === "left" ? unit.leftText : unit.rightText;
                      if (unit.kind === "equal") return <Fragment key={unit.id}>{text}</Fragment>;
                      const selected = resolutions[unit.id];
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          className={cn(
                            "inline rounded px-1 py-0.5 text-right font-medium whitespace-pre-wrap break-words transition-colors",
                            side === "left"
                              ? "bg-rose-500/20 text-rose-900 hover:bg-rose-500/30 dark:text-rose-100"
                              : "bg-emerald-500/20 text-emerald-900 hover:bg-emerald-500/30 dark:text-emerald-100",
                            selected?.choice === side && "ring-2 ring-primary bg-primary/10",
                          )}
                          onClick={(event) => { if (event.detail === 0) openQuickDecision(unit.id, side); }}
                          onDoubleClick={() => openQuickDecision(unit.id, side)}
                          title={side === "left" ? "לחץ פעמיים לאפשרויות אישור מגרסת הבסיס" : "לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"}
                        >
                          {text || "[מחיקה]"}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="grid min-h-[500px] grid-cols-2 items-stretch" dir="rtl" style={textStyle}>
                {adjudicationUnits.map((unit) => {
                  if (unit.kind === "equal") {
                    return (
                      <Fragment key={unit.id}>
                        <div className="border-l border-muted/20 px-4 py-1 text-right whitespace-pre-wrap break-words">{unit.leftText}</div>
                        <div className="px-4 py-1 text-right whitespace-pre-wrap break-words">{unit.rightText}</div>
                      </Fragment>
                    );
                  }
                  const conflictIndex = conflictUnits.findIndex((conflict) => conflict.id === unit.id);
                  const selected = resolutions[unit.id];
                  return (
                    <Fragment key={unit.id}>
                      <div className="relative border-l border-muted/20 px-2 py-1">
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded bg-rose-500/15 px-2 py-1 text-right whitespace-pre-wrap break-words transition-colors hover:bg-rose-500/25",
                            selected?.choice === "left" && "ring-2 ring-primary bg-primary/10",
                          )}
                          onClick={(event) => { if (event.detail === 0) openQuickDecision(unit.id, "left"); }}
                          onDoubleClick={() => openQuickDecision(unit.id, "left")}
                          title="לחץ פעמיים לאפשרויות אישור מגרסת הבסיס"
                        >
                          {unit.leftText || "[מחיקה]"}
                        </button>
                      </div>
                      <div className="flex items-start gap-1 px-2 py-1">
                        <button
                          type="button"
                          className={cn(
                            "min-w-0 flex-1 rounded bg-emerald-500/15 px-2 py-1 text-right whitespace-pre-wrap break-words transition-colors hover:bg-emerald-500/25",
                            selected?.choice === "right" && "ring-2 ring-primary bg-primary/10",
                          )}
                          onClick={(event) => { if (event.detail === 0) openQuickDecision(unit.id, "right"); }}
                          onDoubleClick={() => openQuickDecision(unit.id, "right")}
                          title="לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"
                        >
                          {unit.rightText || "[מחיקה]"}
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant={selected?.choice === "custom" ? "default" : "outline"}
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            openCustomDecision(conflictIndex);
                            setViewMode("adjudicate");
                          }}
                          title="שני הנוסחים שגויים - הזן תיקון אחר"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </ScrollArea>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">הנוסח המאומת מתעדכן מכל הכרעה, כולל תיקונים לכל המופעים.</span>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              disabled={!verifiedText.trim() || !onSaveVerifiedVersion}
              onClick={() => onSaveVerifiedVersion?.(verifiedText)}
            >
              <Save className="h-3.5 w-3.5" /> שמור נוסח מאומת
            </Button>
          </div>
        </Card>
      )}

      {quickDecision && quickDecisionMinimized && (
        <section
          dir="rtl"
          data-testid="quick-adjudication-minimized"
          className="fixed bottom-4 right-4 z-[70] w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-background p-3 text-right shadow-2xl"
          aria-label="הכרעת נוסח ממוזערת"
        >
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">אישור הנוסח הנכון</p>
              <p className="truncate text-xs text-muted-foreground">החלון ממוזער; ההשוואה נשארה פתוחה לעריכה</p>
            </div>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => setQuickDecisionMinimized(false)} title="הרחב חלון הכרעה" aria-label="הרחב חלון הכרעה">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      <Dialog modal={false} open={Boolean(quickDecision) && !quickDecisionMinimized} onOpenChange={(open) => { if (!open && !quickDecisionMinimized) closeQuickDecision(); }}>
        <DialogContent hideOverlay dir="rtl" className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl" data-testid="quick-adjudication-dialog">
          <DialogHeader className="text-right">
            <div className="flex items-start justify-between gap-3 pe-8">
              <div className="min-w-0">
                <DialogTitle>אישור הנוסח הנכון</DialogTitle>
                <DialogDescription className="mt-1">
                  בחר אם לאשר רק את ההבדל הזה, לתקן את כל המופעים הזהים, או להזין נוסח אחר.
                </DialogDescription>
              </div>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setQuickDecisionMinimized(true)} title="מזער חלון הכרעה" aria-label="מזער חלון הכרעה" data-testid="minimize-quick-adjudication">
                <Minimize2 className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          {quickDecisionUnit && quickDecision && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setQuickDecision((current) => current ? { ...current, side: "left" } : current)}
                  aria-pressed={quickDecision.side === "left"}
                  data-testid="quick-source-left"
                  className={cn("rounded-md border p-3 text-right transition-colors hover:bg-muted/50", quickDecision.side === "left" && "border-primary bg-primary/5 ring-1 ring-primary")}
                >
                  <span className="mb-1 block text-[11px] text-muted-foreground">גרסת בסיס</span>
                  <span className="whitespace-pre-wrap font-medium">{quickDecisionUnit.leftText || "[מחיקה]"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQuickDecision((current) => current ? { ...current, side: "right" } : current)}
                  aria-pressed={quickDecision.side === "right"}
                  data-testid="quick-source-right"
                  className={cn("rounded-md border p-3 text-right transition-colors hover:bg-muted/50", quickDecision.side === "right" && "border-primary bg-primary/5 ring-1 ring-primary")}
                >
                  <span className="mb-1 block text-[11px] text-muted-foreground">גרסה חדשה</span>
                  <span className="whitespace-pre-wrap font-medium">{quickDecisionUnit.rightText || "[מחיקה]"}</span>
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" onClick={() => confirmQuickSource(false)} data-testid="confirm-quick-once">
                  <Check className="ml-2 h-4 w-4" /> אשר רק כאן
                </Button>
                <Button type="button" variant="outline" onClick={() => confirmQuickSource(true)} data-testid="confirm-quick-all">
                  <ListChecks className="ml-2 h-4 w-4" /> אשר ותקן את כל המופעים
                </Button>
              </div>

              {onSaveImmediateVersion && (
                <div className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 sm:grid-cols-2">
                  <Button type="button" variant="secondary" onClick={() => saveQuickSourceImmediately(false)} data-testid="save-quick-once">
                    <Save className="ml-2 h-4 w-4" /> שמור ותקן כאן מיד
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => saveQuickSourceImmediately(true)} data-testid="save-quick-all">
                    <ListChecks className="ml-2 h-4 w-4" /> שמור ותקן הכול מיד
                  </Button>
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">הצד השגוי יתעדכן מיד. המקור הישן יישאר שמור בהיסטוריה.</p>
                </div>
              )}

              <div className="rounded-md border bg-muted/20 p-3">
                <label className="mb-2 block text-xs font-semibold" htmlFor="quick-custom-correction">שני הצדדים שגויים? הזן תיקון אחר</label>
                <div className="flex gap-2">
                  <Input
                    id="quick-custom-correction"
                    value={quickCustomText}
                    onChange={(event) => setQuickCustomText(event.target.value)}
                    dir="rtl"
                    className="text-right"
                    data-testid="quick-custom-input"
                  />
                  <Button type="button" variant="secondary" onClick={confirmQuickCustom} disabled={!quickCustomText.trim()}>
                    אשר תיקון
                  </Button>
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={quickApplyEverywhere} onCheckedChange={(checked) => setQuickApplyEverywhere(checked === true)} />
                  החל את התיקון על כל המופעים הזהים
                </label>
                {quickApplyEverywhere && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">הנוסח השגוי נמצא ב:</span>
                    <Button type="button" size="sm" className="h-7" variant={quickReplacementSource === "left" ? "default" : "outline"} onClick={() => setQuickReplacementSource("left")}>
                      בסיס: {quickDecisionUnit.leftText.trim() || "ריק"}
                    </Button>
                    <Button type="button" size="sm" className="h-7" variant={quickReplacementSource === "right" ? "default" : "outline"} onClick={() => setQuickReplacementSource("right")}>
                      חדש: {quickDecisionUnit.rightText.trim() || "ריק"}
                    </Button>
                  </div>
                )}
                {onSaveImmediateVersion && (
                  <Button type="button" className="mt-3 w-full" onClick={saveQuickCustomImmediately} disabled={!quickCustomText.trim()} data-testid="save-custom-immediately">
                    <Save className="ml-2 h-4 w-4" /> שמור ותקן מיד בשתי הגרסאות
                  </Button>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="sm:justify-start">
            <Button type="button" variant="ghost" onClick={closeQuickDecision}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewMode === 'adjudicate' && (
        <Card className="overflow-hidden" data-testid="adjudication-workspace">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">בניית נוסח מאומת</h3>
              <p className="text-xs text-muted-foreground">כל הכרעה משנה רק את הנוסח המאומת. גרסאות המקור נשארות ללא שינוי.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">הוכרעו {resolvedCount}</Badge>
              <Badge variant={unresolvedCount ? "outline" : "default"}>נותרו {unresolvedCount}</Badge>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={undoResolution} disabled={!resolutionHistoryRef.current.length}>
                <Undo2 className="h-3.5 w-3.5" /> ביטול הכרעה
              </Button>
            </div>
          </div>

          {conflictUnits.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">שתי הגרסאות זהות ואין הבדלים להכרעה.</div>
          ) : (
            <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.4fr)]">
              <div className="border-b p-4 lg:border-b-0 lg:border-l">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">הבדל {activeConflictIndex + 1} מתוך {conflictUnits.length}</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setActiveConflictIndex((index) => Math.max(0, index - 1))} disabled={activeConflictIndex === 0} title="הבדל קודם">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setActiveConflictIndex((index) => Math.min(conflictUnits.length - 1, index + 1))} disabled={activeConflictIndex >= conflictUnits.length - 1} title="הבדל הבא">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {conflictUnits[activeConflictIndex] && (() => {
                  const unit = conflictUnits[activeConflictIndex];
                  const selected = resolutions[unit.id];
                  return (
                    <div className="space-y-3" data-testid={`adjudication-unit-${activeConflictIndex}`}>
                      <button
                        type="button"
                        className={cn("w-full rounded-md border border-rose-200 bg-rose-500/[0.04] p-3 text-right transition-colors hover:bg-rose-500/10", selected?.choice === "left" && "ring-2 ring-primary")}
                        onClick={() => applyResolution(unit.id, { choice: "left" })}
                      >
                        <span className="mb-1 block text-[11px] text-muted-foreground">בחר מגרסת הבסיס</span>
                        <span className="whitespace-pre-wrap font-medium">{unit.leftText || "[מחיקה]"}</span>
                      </button>
                      <button
                        type="button"
                        className={cn("w-full rounded-md border border-emerald-200 bg-emerald-500/[0.04] p-3 text-right transition-colors hover:bg-emerald-500/10", selected?.choice === "right" && "ring-2 ring-primary")}
                        onClick={() => applyResolution(unit.id, { choice: "right" })}
                      >
                        <span className="mb-1 block text-[11px] text-muted-foreground">בחר מהגרסה החדשה</span>
                        <span className="whitespace-pre-wrap font-medium">{unit.rightText || "[מחיקה]"}</span>
                      </button>
                      <div className={cn("rounded-md border p-3", selected?.choice === "custom" && "ring-2 ring-primary")}>
                        <label className="mb-2 flex items-center gap-1.5 text-xs font-medium" htmlFor={`custom-${unit.id}`}>
                          <Pencil className="h-3.5 w-3.5" /> שני הנוסחים שגויים
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id={`custom-${unit.id}`}
                            value={customDrafts[unit.id] ?? unit.rightText.trimEnd()}
                            onChange={(event) => setCustomDrafts((drafts) => ({ ...drafts, [unit.id]: event.target.value }))}
                            className="text-right"
                            dir="rtl"
                            data-testid="adjudication-custom-input"
                          />
                          <Button type="button" size="sm" className="h-10 shrink-0 gap-1.5" onClick={() => confirmCustomResolution(unit.id)}>
                            <Check className="h-4 w-4" /> אשר
                          </Button>
                        </div>
                        <div className="mt-3 rounded-md bg-muted/30 p-2.5">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                            <Checkbox checked={applyEverywhere} onCheckedChange={(checked) => setApplyEverywhere(checked === true)} />
                            תקן את כל המופעים הזהים בטקסט
                          </label>
                          {applyEverywhere && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-muted-foreground">המילה השגויה נמצאת ב:</span>
                              <Button
                                type="button"
                                size="sm"
                                variant={replacementSource === "left" ? "default" : "outline"}
                                className="h-7"
                                onClick={() => setReplacementSource("left")}
                                disabled={!unit.leftText.trim()}
                              >
                                בסיס: {unit.leftText.trim() || "ריק"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={replacementSource === "right" ? "default" : "outline"}
                                className="h-7"
                                onClick={() => setReplacementSource("right")}
                                disabled={!unit.rightText.trim()}
                              >
                                חדש: {unit.rightText.trim() || "ריק"}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-4 max-h-48 space-y-1 overflow-y-auto border-t pt-3">
                  {conflictUnits.map((unit, index) => (
                    <button
                      key={unit.id}
                      type="button"
                      className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-right text-xs hover:bg-muted", index === activeConflictIndex && "bg-muted")}
                      onClick={() => setActiveConflictIndex(index)}
                    >
                      <span className="truncate">{unit.leftText.trim() || "מחיקה"} / {unit.rightText.trim() || "מחיקה"}</span>
                      {resolutions[unit.id] ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex min-w-0 flex-col p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold">נוסח מאומת</h4>
                    <p className="text-xs text-muted-foreground">אפשר לערוך גם ישירות לפני השמירה.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!verifiedText.trim() || !onSaveVerifiedVersion}
                    onClick={() => {
                      onSaveVerifiedVersion?.(verifiedText);
                      toast({ title: "הנוסח המאומת נשמר כגרסה חדשה", description: "גרסאות הבסיס והגרסה החדשה לא שונו" });
                    }}
                    data-testid="save-verified-version"
                  >
                    <Save className="h-3.5 w-3.5" /> שמור כגרסה חדשה
                  </Button>
                </div>
                <Textarea
                  value={verifiedText}
                  onChange={(event) => setVerifiedText(event.target.value)}
                  className="min-h-[430px] flex-1 resize-y text-right leading-relaxed"
                  style={textStyle}
                  dir="rtl"
                  data-testid="verified-text"
                />
                {unresolvedCount > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">הנוסח מציג זמנית את הגרסה החדשה ב-{unresolvedCount} הבדלים שטרם הוכרעו.</p>
                )}
                {replacementRules.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs" data-testid="global-replacement-rules">
                    {replacementRules.map((rule) => (
                      <Badge key={rule.source} variant="secondary">
                        החלף בכל הטקסט: {rule.source.trim()} ב-{rule.replacement.trim()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Unified view */}
      {viewMode === 'unified' && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">תצוגה מאוחדת</span>
          </div>
          <ScrollArea className="h-[600px] p-4">
            <pre className="whitespace-pre-wrap text-right" dir="rtl" style={textStyle}>
              {renderChunks(unifiedChunks)}
            </pre>
          </ScrollArea>
          <div className="px-4 py-2 border-t text-xs text-muted-foreground flex gap-4 justify-end">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-destructive/20 border border-destructive/30" /> נמחק
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-500/20 border border-green-500/30" /> נוסף
            </span>
          </div>
        </Card>
      )}

      {/* Stats view */}
      {viewMode === 'stats' && (
        <Card className="p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            ניתוח שינויים מפורט
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-muted/30 text-center space-y-1">
              <p className="text-3xl font-bold text-primary">{stats.similarity}%</p>
              <p className="text-xs text-muted-foreground">אחוז דמיון</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 text-center space-y-1">
              <p className="text-3xl font-bold text-green-600 dark:text-green-400 flex items-center justify-center gap-1">
                <ArrowUp className="w-5 h-5" />{stats.addedWords}
              </p>
              <p className="text-xs text-muted-foreground">מילים שנוספו</p>
            </div>
            <div className="p-4 rounded-lg bg-destructive/10 text-center space-y-1">
              <p className="text-3xl font-bold text-destructive flex items-center justify-center gap-1">
                <ArrowDown className="w-5 h-5" />{stats.removedWords}
              </p>
              <p className="text-xs text-muted-foreground">מילים שנמחקו</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30 text-center space-y-1">
              <p className="text-3xl font-bold">{Math.abs(stats.rWords - stats.lWords)}</p>
              <p className="text-xs text-muted-foreground">הפרש מילים נטו</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <h4 className="text-sm font-medium">פירוט לפי גרסה</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg border space-y-1">
                <p className="text-sm font-medium">{leftVersion ? getLabel(leftVersion) : ''}</p>
                <p className="text-xs text-muted-foreground">{stats.lChars} תווים · {stats.lWords} מילים</p>
              </div>
              <div className="p-3 rounded-lg border space-y-1">
                <p className="text-sm font-medium">{rightVersion ? getLabel(rightVersion) : ''}</p>
                <p className="text-xs text-muted-foreground">{stats.rChars} תווים · {stats.rWords} מילים</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

