import { Fragment, useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRightLeft, Copy, ArrowUp, ArrowDown, Layers } from "lucide-react";
import { TextVersion } from "@/components/TextEditHistory";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AdvancedDiffViewProps {
  versions: TextVersion[];
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  lineHeight?: number;
  onApplyVersion?: (text: string) => void;
  preselectedLeftId?: string;
  preselectedRightId?: string;
  /** Optional: send the selected version into the AI editor as input */
  onSendToAiEditor?: (versionId: string) => void;
}

type VersionFilter = "all" | "ai" | "manual" | "original" | "cloud" | "local";

const sourceLabels: Record<TextVersion['source'], string> = {
  original: 'מקורי',
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
  preselectedLeftId,
  preselectedRightId,
  onSendToAiEditor,
}: AdvancedDiffViewProps) => {
  const defaultLeftId = useMemo(() => versions.find(v => v.source === 'original')?.id || versions[0]?.id || '', [versions]);
  const defaultRightId = useMemo(() => {
    const nonOriginal = [...versions].reverse().find(v => v.source !== 'original');
    return nonOriginal?.id || versions[versions.length - 1]?.id || defaultLeftId;
  }, [versions, defaultLeftId]);
  const [leftId, setLeftId] = useState(preselectedLeftId || defaultLeftId);
  const [rightId, setRightId] = useState(preselectedRightId || defaultRightId);

  // Re-apply preselect when caller pushes a new pair. A distinct right version
  // detaches the right column and loads that version, so the diff shows at once.
  useEffect(() => {
    if (preselectedLeftId && versions.some(v => v.id === preselectedLeftId)) {
      setLeftId(preselectedLeftId);
    }
    const preRight = preselectedRightId
      ? versions.find(v => v.id === preselectedRightId)
      : undefined;
    if (preRight) {
      setRightId(preRight.id);
      setRightText(preRight.text);
      setRightDetached(true);
    }
  }, [preselectedLeftId, preselectedRightId, versions]);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified' | 'stats'>('side-by-side');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>("all");

  const selectableVersions = useMemo(() => {
    const isCloudVersion = (v: TextVersion) => v.id.includes("-") && v.id.length >= 30;
    if (versionFilter === "all") return versions;
    if (versionFilter === "ai") return versions.filter((v) => v.source.startsWith("ai-"));
    if (versionFilter === "manual") return versions.filter((v) => v.source === "manual");
    if (versionFilter === "original") return versions.filter((v) => v.source === "original");
    if (versionFilter === "cloud") return versions.filter((v) => isCloudVersion(v));
    return versions.filter((v) => !isCloudVersion(v));
  }, [versions, versionFilter]);

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

  // The base text that both columns mirror by default ("duplicate" / מכפלה).
  const source = leftVersion?.text ?? "";

  // Editable column buffers. By default BOTH columns show `source` (a copy of
  // the base version). A side "detaches" the moment it is edited or loaded with
  // a different version, and "החזר" re-syncs it back to an exact copy.
  const [leftText, setLeftText] = useState(source);
  const [rightText, setRightText] = useState(source);
  const [leftDetached, setLeftDetached] = useState(false);
  const [rightDetached, setRightDetached] = useState(false);
  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);

  // Keep every non-detached column mirroring the base text.
  useEffect(() => {
    if (!leftDetached) setLeftText(source);
    if (!rightDetached) setRightText(source);
  }, [source, leftDetached, rightDetached]);

  const editLeft = (value: string) => { setLeftDetached(true); setLeftText(value); };
  const editRight = (value: string) => { setRightDetached(true); setRightText(value); };
  const revertLeft = () => { setLeftDetached(false); setLeftText(source); setEditingSide((s) => (s === "left" ? null : s)); };
  const revertRight = () => { setRightDetached(false); setRightText(source); setEditingSide((s) => (s === "right" ? null : s)); };

  const wordDiff = useMemo(() => buildWordDiff(leftText, rightText), [leftText, rightText]);

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
    const base = sourceLabels[v.source];
    return v.customPrompt ? `${base} (${v.customPrompt})` : base;
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
              <TabsTrigger value="side-by-side" className="text-xs px-2 h-7">צד-בצד</TabsTrigger>
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
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0 text-xs">בסיס</Badge>
            <Select value={leftId} onValueChange={setLeftId}>
              <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {selectableVersions.map(v => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">{getLabel(v)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="flex items-center gap-2">
            <Badge variant="default" className="shrink-0 text-xs">חדש</Badge>
            <Select value={rightId} onValueChange={setRightId}>
              <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {selectableVersions.map(v => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">{getLabel(v)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Button size="sm" className="h-7 text-xs" onClick={() => onApplyVersion(rightVersion.text)}>
                החל גרסה חדשה
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Side by side view — word-level highlights only */}
      {viewMode === 'side-by-side' && (
        <Card className="overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b">
            <div className="px-4 py-2 border-l bg-destructive/5 flex items-center justify-between">
              <span className="text-sm font-medium">גרסת בסיס</span>
              <span className="text-xs text-muted-foreground">{stats.lChars} תווים · {stats.lWords} מילים</span>
            </div>
            <div className="px-4 py-2 bg-green-500/5 flex items-center justify-between">
              <span className="text-sm font-medium">גרסה חדשה</span>
              <span className="text-xs text-muted-foreground">{stats.rChars} תווים · {stats.rWords} מילים</span>
            </div>
          </div>
          <ScrollArea className="h-[500px]">
            {/* Each paragraph contributes a left + right cell into the SAME grid
                row, so the browser auto-matches their height → the columns mirror
                each other. Text flows naturally inside a cell (no empty fragments);
                changed words are highlighted inline. An empty cell (a paragraph
                that exists only on one side) is tinted to mark the gap. */}
            <div className="grid grid-cols-2 items-stretch min-h-[500px]" dir="rtl" style={textStyle}>
              {wordDiff.rows.map((row, idx) => (
                <Fragment key={idx}>
                  <div
                    className={cn(
                      "border-l border-muted/20 px-4 py-1 text-right whitespace-pre-wrap break-words",
                      row.left.length === 0 && "bg-muted/20",
                    )}
                  >
                    {renderChunks(row.left)}
                  </div>
                  <div
                    className={cn(
                      "px-4 py-1 text-right whitespace-pre-wrap break-words",
                      row.right.length === 0 && "bg-muted/20",
                    )}
                  >
                    {renderChunks(row.right)}
                  </div>
                </Fragment>
              ))}
            </div>
          </ScrollArea>
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

