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

type WordDiffResult = {
  leftChunks: WordDiffChunk[];
  rightChunks: WordDiffChunk[];
  unifiedChunks: WordDiffChunk[];
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

function pushChunk(chunks: WordDiffChunk[], op: WordDiffChunk["op"], text: string) {
  if (!text) return;
  const last = chunks[chunks.length - 1];
  if (last?.op === op) last.text += text;
  else chunks.push({ op, text });
}

function appendGap(
  leftGap: WordToken[],
  rightGap: WordToken[],
  leftChunks: WordDiffChunk[],
  rightChunks: WordDiffChunk[],
  unifiedChunks: WordDiffChunk[],
) {
  const leftText = leftGap.map((token) => token.text).join("");
  const rightText = rightGap.map((token) => token.text).join("");

  if (leftText) {
    pushChunk(leftChunks, -1, leftText);
    pushChunk(unifiedChunks, -1, leftText);
  }
  if (rightText) {
    pushChunk(rightChunks, 1, rightText);
    pushChunk(unifiedChunks, 1, rightText);
  }
}

function countChunkWords(chunks: WordDiffChunk[], op: WordDiffChunk["op"]): number {
  return chunks
    .filter((chunk) => chunk.op === op)
    .reduce((sum, chunk) => sum + tokenizeWords(chunk.text).length, 0);
}

function buildWordDiff(left: string, right: string): WordDiffResult {
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
  const unifiedChunks: WordDiffChunk[] = [];
  let i = 0;
  let j = 0;
  let unchangedWords = 0;

  while (i < leftTokens.length || j < rightTokens.length) {
    if (i < leftTokens.length && j < rightTokens.length && leftTokens[i].norm === rightTokens[j].norm) {
      pushChunk(leftChunks, 0, leftTokens[i].text);
      pushChunk(rightChunks, 0, rightTokens[j].text);
      pushChunk(unifiedChunks, 0, rightTokens[j].text);
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

    appendGap(
      leftTokens.slice(leftStart, i),
      rightTokens.slice(rightStart, j),
      leftChunks,
      rightChunks,
      unifiedChunks,
    );
  }

  return {
    leftChunks,
    rightChunks,
    unifiedChunks,
    addedWords: countChunkWords(rightChunks, 1),
    removedWords: countChunkWords(leftChunks, -1),
    unchangedWords,
    leftWords: leftTokens.length,
    rightWords: rightTokens.length,
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

  // Re-apply preselect when caller pushes a new pair
  useEffect(() => {
    if (preselectedLeftId && versions.some(v => v.id === preselectedLeftId)) {
      setLeftId(preselectedLeftId);
    }
    if (preselectedRightId && versions.some(v => v.id === preselectedRightId)) {
      setRightId(preselectedRightId);
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

  const wordDiff = useMemo(() => {
    return buildWordDiff(leftVersion?.text || "", rightVersion?.text || "");
  }, [leftVersion?.text, rightVersion?.text]);

  const stats = useMemo(() => {
    const maxWords = Math.max(wordDiff.leftWords, wordDiff.rightWords);
    const similarity = maxWords > 0 ? Math.round((wordDiff.unchangedWords / maxWords) * 100) : 100;
    
    const lWords = leftVersion?.text.split(/\s+/).filter(w => w).length || 0;
    const rWords = rightVersion?.text.split(/\s+/).filter(w => w).length || 0;
    const lChars = leftVersion?.text.length || 0;
    const rChars = rightVersion?.text.length || 0;

    return {
      added: wordDiff.rightChunks.filter((chunk) => chunk.op === 1).reduce((sum, chunk) => sum + chunk.text.length, 0),
      removed: wordDiff.leftChunks.filter((chunk) => chunk.op === -1).reduce((sum, chunk) => sum + chunk.text.length, 0),
      unchanged: wordDiff.unifiedChunks.filter((chunk) => chunk.op === 0).reduce((sum, chunk) => sum + chunk.text.length, 0),
      addedWords: wordDiff.addedWords,
      removedWords: wordDiff.removedWords,
      similarity,
      lWords,
      rWords,
      lChars,
      rChars,
    };
  }, [leftVersion, rightVersion, wordDiff]);

  const renderUnified = () => {
    return wordDiff.unifiedChunks.map((chunk, i) => {
      if (chunk.op === -1) return <span key={i} className="rounded bg-rose-500/20 px-0.5 text-rose-900 dark:text-rose-100">{chunk.text}</span>;
      if (chunk.op === 1) return <span key={i} className="rounded bg-emerald-500/20 px-0.5 font-medium text-emerald-900 dark:text-emerald-100">{chunk.text}</span>;
      return <span key={i}>{chunk.text}</span>;
    });
  };

  const renderSideChunks = (chunks: WordDiffChunk[], side: "left" | "right") => {
    return chunks.map((chunk, i) => {
      if (chunk.op === 0) return <Fragment key={i}>{chunk.text}</Fragment>;
      const isRemoved = side === "left" && chunk.op === -1;
      const isAdded = side === "right" && chunk.op === 1;
      if (!isRemoved && !isAdded) return <Fragment key={i}>{chunk.text}</Fragment>;
      return (
        <span
          key={i}
          className={cn(
            "rounded px-0.5 font-medium",
            isRemoved && "bg-rose-500/20 text-rose-900 dark:text-rose-100",
            isAdded && "bg-emerald-500/20 text-emerald-900 dark:text-emerald-100",
          )}
        >
          {chunk.text}
        </span>
      );
    });
  };

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
            <div className="grid grid-cols-2" dir="rtl" style={textStyle}>
              <div className="min-h-[500px] border-l border-muted/20 px-4 py-3 text-right whitespace-pre-wrap break-words">
                {renderSideChunks(wordDiff.leftChunks, "left")}
              </div>
              <div className="min-h-[500px] px-4 py-3 text-right whitespace-pre-wrap break-words">
                {renderSideChunks(wordDiff.rightChunks, "right")}
              </div>
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
              {renderUnified()}
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

