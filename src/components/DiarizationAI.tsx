import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, TrendingUp, Hash, Wand2, Copy, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  analyzeSpeakerSentiment,
  detectTopics,
  autoPunctuate,
  aiSummarize,
  aiTopicSegmentation,
  type TopicSegment,
  type SentimentType,
} from "@/utils/diarizationEnhancements";

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

interface DiarizationAIProps {
  result: DiarizationResult;
  speakerNames: Record<string, string>;
  openaiKey?: string;
  onSegmentsUpdate?: (segments: DiarizedSegment[]) => void;
  onSeek?: (time: number) => void;
}

const SPEAKER_BAR_COLORS = [
  "#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#6366f1", "#14b8a6",
];

const SENTIMENT_COLORS: Record<SentimentType, { bg: string; text: string; emoji: string }> = {
  positive: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', emoji: '😊' },
  negative: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', emoji: '😟' },
  neutral: { bg: 'bg-gray-100 dark:bg-gray-800/30', text: 'text-gray-600 dark:text-gray-400', emoji: '😐' },
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DiarizationAI({ result, speakerNames, openaiKey, onSegmentsUpdate, onSeek }: DiarizationAIProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [topics, setTopics] = useState<TopicSegment[] | null>(null);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [expandedTopic, setExpandedTopic] = useState<number | null>(null);
  const [isPunctuating, setIsPunctuating] = useState(false);

  const getName = (sp: string) => speakerNames[sp] || sp;
  const speakerIdx = useMemo(() => {
    const idx: Record<string, number> = {};
    result.speakers.forEach((sp, i) => { idx[sp] = i; });
    return idx;
  }, [result.speakers]);

  // ──── Sentiment Analysis (client-side, instant) ────
  const sentiments = useMemo(
    () => analyzeSpeakerSentiment(result.segments, result.speakers),
    [result.segments, result.speakers]
  );

  // ──── Topic Detection (client-side or AI) ────
  const localTopics = useMemo(
    () => detectTopics(result.segments),
    [result.segments]
  );

  const handleAISummary = useCallback(async () => {
    if (!openaiKey) {
      toast({ title: "נדרש מפתח OpenAI", description: "הגדר מפתח API בהגדרות או בטאב 'מנוע ענן'", variant: "destructive" });
      return;
    }
    setIsSummarizing(true);
    try {
      const text = await aiSummarize(result.segments, result.speakers, speakerNames, openaiKey);
      setSummary(text);
      toast({ title: "סיכום AI הושלם" });
    } catch (err: unknown) {
      toast({ title: "שגיאה בסיכום", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    } finally {
      setIsSummarizing(false);
    }
  }, [openaiKey, result, speakerNames]);

  const handleAITopics = useCallback(async () => {
    if (!openaiKey) {
      toast({ title: "נדרש מפתח OpenAI", variant: "destructive" });
      return;
    }
    setIsLoadingTopics(true);
    try {
      const t = await aiTopicSegmentation(result.segments, speakerNames, openaiKey);
      setTopics(t);
      toast({ title: `${t.length} נושאים זוהו באמצעות AI` });
    } catch (err: unknown) {
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    } finally {
      setIsLoadingTopics(false);
    }
  }, [openaiKey, result, speakerNames]);

  const handleAutoPunctuate = useCallback(() => {
    if (!onSegmentsUpdate) return;
    setIsPunctuating(true);
    setTimeout(() => {
      const updated = result.segments.map(seg => ({
        ...seg,
        text: autoPunctuate(seg.text),
      }));
      onSegmentsUpdate(updated);
      setIsPunctuating(false);
      toast({ title: "פיסוק אוטומטי הוחל", description: `${updated.length} קטעים עודכנו` });
    }, 100);
  }, [result.segments, onSegmentsUpdate]);

  const displayTopics = topics || localTopics;

  return (
    <div className="space-y-5">
      {/* ──── AI Summary ──── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" />
            סיכום AI
          </Label>
          <Button
            size="sm"
            className="text-xs gap-1"
            onClick={handleAISummary}
            disabled={isSummarizing || !openaiKey}
          >
            {isSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {isSummarizing ? "מסכם..." : "צור סיכום"}
          </Button>
        </div>
        {!openaiKey && (
          <p className="text-xs text-muted-foreground">💡 הגדר מפתח OpenAI API כדי להשתמש בסיכום AI</p>
        )}
        {summary && (
          <div className="border rounded-xl p-3 bg-gradient-to-l from-primary/5 to-transparent space-y-2">
            <div className="text-sm leading-relaxed whitespace-pre-wrap" dir="rtl">{summary}</div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
              navigator.clipboard.writeText(summary);
              toast({ title: "סיכום הועתק" });
            }}>
              <Copy className="w-3 h-3 ml-1" />העתק
            </Button>
          </div>
        )}
      </section>

      {/* ──── Sentiment Analysis ──── */}
      <section className="space-y-2">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-primary" />
          ניתוח סנטימנט לפי דובר
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {result.speakers.map((sp, i) => {
            const s = sentiments[sp];
            if (!s) return null;
            const si = SENTIMENT_COLORS[s.type];
            const total = s.details.positive + s.details.negative + s.details.neutral;
            return (
              <div key={sp} className={`p-3 rounded-xl border ${si.bg}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SPEAKER_BAR_COLORS[i % SPEAKER_BAR_COLORS.length] }} />
                  <span className="font-semibold text-sm">{getName(sp)}</span>
                  <span className="text-lg mr-auto">{si.emoji}</span>
                </div>
                <div className="flex gap-1 h-2 rounded-full overflow-hidden mb-1.5">
                  {s.details.positive > 0 && (
                    <div className="bg-green-500 h-full" style={{ width: `${(s.details.positive / total) * 100}%` }} />
                  )}
                  {s.details.neutral > 0 && (
                    <div className="bg-gray-400 h-full" style={{ width: `${(s.details.neutral / total) * 100}%` }} />
                  )}
                  {s.details.negative > 0 && (
                    <div className="bg-red-500 h-full" style={{ width: `${(s.details.negative / total) * 100}%` }} />
                  )}
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>😊 {s.details.positive}</span>
                  <span>😐 {s.details.neutral}</span>
                  <span>😟 {s.details.negative}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ──── Topic Segmentation ──── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Hash className="w-4 h-4 text-primary" />
            זיהוי נושאים
          </Label>
          <div className="flex gap-1">
            {openaiKey && (
              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={handleAITopics} disabled={isLoadingTopics}>
                {isLoadingTopics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                זיהוי AI
              </Button>
            )}
          </div>
        </div>
        {!topics && (
          <p className="text-xs text-muted-foreground">📊 זיהוי נושאים אוטומטי מבוסס ניתוח טקסט</p>
        )}
        <div className="space-y-1.5">
          {displayTopics.map((topic, i) => (
            <div key={i} className="border rounded-lg overflow-hidden">
              <button
                className="w-full text-right p-2.5 flex items-center gap-2 hover:bg-muted/30 transition-colors text-sm"
                onClick={() => setExpandedTopic(expandedTopic === i ? null : i)}
              >
                <Badge variant="secondary" className="text-[10px] py-0 shrink-0">נושא {i + 1}</Badge>
                <button
                  className="text-xs text-muted-foreground shrink-0 hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); onSeek?.(topic.startTime); }}
                >
                  <Clock className="w-3 h-3 inline ml-0.5" />
                  {formatTime(topic.startTime)}–{formatTime(topic.endTime)}
                </button>
                <div className="flex gap-1 flex-1 flex-wrap">
                  {topic.keywords.map((kw, j) => (
                    <Badge key={j} variant="outline" className="text-[9px] py-0">{kw}</Badge>
                  ))}
                </div>
                {topic.summary && <span className="text-xs text-muted-foreground truncate max-w-[150px]">{topic.summary}</span>}
                {expandedTopic === i ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
              </button>
              {expandedTopic === i && (
                <div className="border-t p-2.5 bg-muted/10 space-y-1 max-h-[200px] overflow-y-auto">
                  {topic.summary && <p className="text-xs font-medium mb-1.5">{topic.summary}</p>}
                  {result.segments.slice(topic.startIdx, topic.endIdx + 1).map((seg, j) => (
                    <div key={j} className="flex gap-2 text-xs">
                      <button className="text-muted-foreground shrink-0 hover:text-foreground tabular-nums" onClick={() => onSeek?.(seg.start)}>
                        {formatTime(seg.start)}
                      </button>
                      <span className="font-medium shrink-0" style={{ color: SPEAKER_BAR_COLORS[(speakerIdx[seg.speaker_label] ?? 0) % SPEAKER_BAR_COLORS.length] }}>
                        {getName(seg.speaker_label)}
                      </span>
                      <span className="truncate text-muted-foreground">{seg.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ──── Auto Punctuation ──── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Wand2 className="w-4 h-4 text-primary" />
            פיסוק אוטומטי
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1"
            onClick={handleAutoPunctuate}
            disabled={isPunctuating || !onSegmentsUpdate}
          >
            {isPunctuating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            החל פיסוק
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          הוספת נקודות, פסיקים וסימני שאלה אוטומטית לפי כללי עברית. משפר את קריאות התמלול.
        </p>
      </section>
    </div>
  );
}
