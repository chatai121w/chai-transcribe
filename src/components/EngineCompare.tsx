import { useState, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Zap, Trophy, ArrowLeftRight, Clock, Languages } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";

interface EngineCompareProps {
  text: string;
}

const COMPARE_ENGINES = [
  { value: 'groq', label: 'Groq (Whisper Large V3 Turbo)', type: 'transcription' as const },
  { value: 'openai', label: 'OpenAI (Whisper-1)', type: 'transcription' as const },
  { value: 'assemblyai', label: 'AssemblyAI (Universal)', type: 'transcription' as const },
  { value: 'deepgram', label: 'Deepgram (Nova-2)', type: 'transcription' as const },
  { value: 'local-server', label: 'CUDA Server (Whisper GPU)', type: 'transcription' as const },
];

const COMPARE_MODELS = [
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'cohere/aya-expanse-32b', label: 'Aya Expanse 32B' },
  { value: 'cohere/command-r-plus', label: 'Command R+' },
  { value: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
  { value: 'mistralai/mistral-nemo', label: 'Mistral Nemo 12B' },
  { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
];

interface CompareResult {
  model: string;
  label: string;
  text: string;
  latencyMs: number;
  hebrewRatio: number;
  wordCount: number;
}

function calculateHebrewRatio(text: string): number {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const total = (text.match(/[\u0590-\u05FFa-zA-Z]/g) || []).length;
  return total > 0 ? hebrew / total : 0;
}

export const EngineCompare = memo(({ text }: EngineCompareProps) => {
  const [model1, setModel1] = useState(COMPARE_MODELS[0].value);
  const [model2, setModel2] = useState(COMPARE_MODELS[4].value);
  const [isComparing, setIsComparing] = useState(false);
  const [results, setResults] = useState<[CompareResult | null, CompareResult | null]>([null, null]);

  const runComparison = async () => {
    if (!text || text.trim().length < 10) {
      toast({ title: "טקסט קצר מדי", description: "יש צורך בלפחות 10 תווים להשוואה", variant: "destructive" });
      return;
    }

    setIsComparing(true);
    setResults([null, null]);

    const label1 = COMPARE_MODELS.find(m => m.value === model1)?.label || model1;
    const label2 = COMPARE_MODELS.find(m => m.value === model2)?.label || model2;

    try {
      // Run both models in parallel
      const [res1, res2] = await Promise.allSettled([
        runModel(model1, label1, text),
        runModel(model2, label2, text),
      ]);

      setResults([
        res1.status === 'fulfilled' ? res1.value : null,
        res2.status === 'fulfilled' ? res2.value : null,
      ]);

      if (res1.status === 'rejected' && res2.status === 'rejected') {
        toast({ title: "שגיאה", description: "שני המודלים נכשלו", variant: "destructive" });
      }
    } finally {
      setIsComparing(false);
    }
  };

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-yellow-400" />
          השוואת מודלים A/B
        </CardTitle>
        <CardDescription className="text-white/60">
          השווה את אותו טקסט בשני מודלים שונים — מהירות, איכות עברית, תוצאה
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Model selectors */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-white/50">מודל A</div>
            <Select value={model1} onValueChange={setModel1}>
              <SelectTrigger className="bg-white/10 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPARE_MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-white/50">מודל B</div>
            <Select value={model2} onValueChange={setModel2}>
              <SelectTrigger className="bg-white/10 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPARE_MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={runComparison} disabled={isComparing || model1 === model2 || !text}
          className="w-full bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30">
          {isComparing ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> משווה...</>
          ) : (
            <><Zap className="w-4 h-4 mr-2" /> הרץ השוואה</>
          )}
        </Button>

        {model1 === model2 && (
          <div className="text-xs text-yellow-400/70 text-center">בחר שני מודלים שונים</div>
        )}

        {/* Results */}
        {(results[0] || results[1]) && (
          <div className="grid grid-cols-2 gap-3">
            {results.map((r, i) => (
              <ResultCard key={i} result={r} index={i}
                isWinner={getWinner(results) === i} />
            ))}
          </div>
        )}

        {/* Comparison summary */}
        {results[0] && results[1] && (
          <ComparisonSummary a={results[0]} b={results[1]} />
        )}

        {!text && (
          <div className="text-center py-4 text-white/40 text-sm">
            תמלל קובץ קודם כדי להשוות מודלים
          </div>
        )}
      </CardContent>
    </Card>
  );
});

EngineCompare.displayName = 'EngineCompare';

async function runModel(model: string, label: string, text: string): Promise<CompareResult> {
  const start = performance.now();
  const result = await editTranscriptCloud({ text, action: 'improve', model });
  const latencyMs = Math.round(performance.now() - start);

  return {
    model,
    label,
    text: result,
    latencyMs,
    hebrewRatio: calculateHebrewRatio(result),
    wordCount: result.split(/\s+/).length,
  };
}

function getWinner(results: [CompareResult | null, CompareResult | null]): number | null {
  if (!results[0] || !results[1]) return results[0] ? 0 : results[1] ? 1 : null;
  // Score: faster = better, higher Hebrew ratio = better
  const score0 = results[0].hebrewRatio * 100 - results[0].latencyMs / 1000;
  const score1 = results[1].hebrewRatio * 100 - results[1].latencyMs / 1000;
  return score0 >= score1 ? 0 : 1;
}

function ResultCard({ result, index, isWinner }: {
  result: CompareResult | null; index: number; isWinner: boolean;
}) {
  if (!result) {
    return (
      <div className="bg-red-500/10 rounded-lg p-3 text-center text-red-300/80 text-sm">
        מודל {index === 0 ? 'A' : 'B'} נכשל
      </div>
    );
  }

  return (
    <div className={`rounded-lg p-3 space-y-2 ${isWinner ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-white/5'}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-white/50">{index === 0 ? 'A' : 'B'}</span>
        <span className="text-xs text-white/80 truncate">{result.label}</span>
        {isWinner && <Trophy className="w-3 h-3 text-yellow-400 shrink-0" />}
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center gap-1 text-white/50">
          <Clock className="w-3 h-3" />
          <span>{(result.latencyMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="flex items-center gap-1 text-white/50">
          <Languages className="w-3 h-3" />
          <span>עברית: {Math.round(result.hebrewRatio * 100)}%</span>
        </div>
        <div className="text-white/50">{result.wordCount} מילים</div>
      </div>
      <div className="text-xs text-white/70 max-h-[100px] overflow-y-auto" dir="rtl">
        {result.text.slice(0, 300)}{result.text.length > 300 ? '...' : ''}
      </div>
    </div>
  );
}

function ComparisonSummary({ a, b }: { a: CompareResult; b: CompareResult }) {
  const faster = a.latencyMs <= b.latencyMs ? a : b;
  const moreHebrew = a.hebrewRatio >= b.hebrewRatio ? a : b;
  const speedDiff = Math.abs(a.latencyMs - b.latencyMs);

  return (
    <div className="bg-white/5 rounded-lg p-3 space-y-1 text-xs text-white/60" dir="rtl">
      <div>⚡ <span className="text-white/80">{faster.label}</span> מהיר יותר ב-{(speedDiff / 1000).toFixed(1)}s</div>
      {a.hebrewRatio !== b.hebrewRatio && (
        <div>🔤 <span className="text-white/80">{moreHebrew.label}</span> שומר יותר עברית ({Math.round(moreHebrew.hebrewRatio * 100)}%)</div>
      )}
      <div>📊 הבדל מילים: {Math.abs(a.wordCount - b.wordCount)}</div>
    </div>
  );
}
