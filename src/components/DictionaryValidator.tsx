import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BookOpen, Search, CheckCircle2, XCircle, AlertTriangle, 
  Loader2, RefreshCw, FileText, ArrowLeftRight
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { analyzeMorphology, type MorphWord } from "@/utils/dictaApi";
import { supabase } from "@/integrations/supabase/client";

export interface WordValidation {
  word: string;
  index: number;
  // Stage 1: existence
  exists: boolean;
  lemma?: string;
  pos?: string;
  // Stage 2: grammar
  grammarOk: boolean;
  morphInfo?: string;
  // Stage 3: context
  contextOk: boolean;
  suggestion?: string;
  reason?: string;
  issueType: 'none' | 'spelling' | 'grammar' | 'context' | 'unknown_word';
}

interface Props {
  text: string;
  onApplyFix?: (original: string, fixed: string) => void;
}

const ISSUE_CONFIG = {
  none: { label: 'תקין', color: 'bg-green-500/20 text-green-300', icon: CheckCircle2 },
  spelling: { label: 'שגיאת כתיב', color: 'bg-red-500/20 text-red-300', icon: XCircle },
  grammar: { label: 'שגיאת דקדוק', color: 'bg-orange-500/20 text-orange-300', icon: AlertTriangle },
  context: { label: 'הקשר שגוי', color: 'bg-yellow-500/20 text-yellow-300', icon: ArrowLeftRight },
  unknown_word: { label: 'מילה לא ידועה', color: 'bg-purple-500/20 text-purple-300', icon: XCircle },
};

const BATCH_SIZE = 40; // Words per AI context check batch

export const DictionaryValidator = ({ text, onApplyFix }: Props) => {
  const [results, setResults] = useState<WordValidation[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [filterType, setFilterType] = useState<string>('issues');

  const words = useMemo(() => {
    if (!text.trim()) return [];
    return text.split(/\s+/).filter(w => w.length > 0);
  }, [text]);

  const runFullCheck = useCallback(async () => {
    if (!text.trim() || words.length === 0) {
      toast({ title: "אין טקסט", description: "הכנס טקסט לבדיקה", variant: "destructive" });
      return;
    }

    setIsChecking(true);
    setResults([]);
    setProgress(0);

    try {
      // ── Stage 1+2: DICTA Morph analysis ──
      setStage('ניתוח מורפולוגי (שלב 1+2)...');
      const morphResult = await analyzeMorphology(text);
      
      const morphMap = new Map<number, MorphWord>();
      if (morphResult.success && morphResult.words.length > 0) {
        morphResult.words.forEach((w, i) => morphMap.set(i, w));
      }

      setProgress(40);

      // Build initial word validations from morph data
      const initialResults: WordValidation[] = words.map((word, index) => {
        const morph = morphMap.get(index);
        const isHebrew = /[\u0590-\u05FF]/.test(word);
        const isNumber = /^\d+$/.test(word);
        const isPunctuation = /^[.,;:!?'"()\-–—]+$/.test(word);
        
        // Non-Hebrew words, numbers, punctuation → skip
        if (!isHebrew || isNumber || isPunctuation) {
          return {
            word, index, exists: true, grammarOk: true, contextOk: true,
            issueType: 'none' as const,
            lemma: word, pos: isPunctuation ? 'punct' : 'foreign',
          };
        }

        const hasLemma = morph && morph.lemma && morph.lemma !== '';
        const hasPos = morph && morph.pos && morph.pos !== '';
        
        return {
          word,
          index,
          exists: hasLemma || false,
          lemma: morph?.lemma || undefined,
          pos: morph?.pos || undefined,
          morphInfo: morph?.morph || undefined,
          grammarOk: true, // Will be refined in stage 3
          contextOk: true, // Will be checked in stage 3
          issueType: (hasLemma ? 'none' : 'unknown_word') as WordValidation['issueType'],
        };
      });

      setProgress(50);

      // ── Stage 3: AI context + grammar validation ──
      setStage('בדיקת הקשר ודקדוק (שלב 3)...');
      
      // Only send Hebrew words for AI analysis (batch them)
      const hebrewWords = initialResults.filter(w => 
        /[\u0590-\u05FF]/.test(w.word) && w.word.length > 1
      );

      if (hebrewWords.length > 0) {
        const batches: typeof hebrewWords[] = [];
        for (let i = 0; i < hebrewWords.length; i += BATCH_SIZE) {
          batches.push(hebrewWords.slice(i, i + BATCH_SIZE));
        }

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          const batch = batches[batchIdx];
          const wordsPayload = batch.map(w => ({
            word: w.word,
            index: w.index,
            prev: w.index > 0 ? words[w.index - 1] : undefined,
            next: w.index < words.length - 1 ? words[w.index + 1] : undefined,
          }));

          try {
            const { data, error } = await supabase.functions.invoke('check-dictionary', {
              body: { words: wordsPayload },
            });

            if (!error && data?.results) {
              for (const aiResult of data.results) {
                const idx = initialResults.findIndex(r => r.index === aiResult.index);
                if (idx !== -1) {
                  initialResults[idx] = {
                    ...initialResults[idx],
                    exists: aiResult.exists,
                    grammarOk: aiResult.grammarOk,
                    contextOk: aiResult.contextOk,
                    suggestion: aiResult.suggestion || undefined,
                    reason: aiResult.reason || undefined,
                    issueType: aiResult.issueType || initialResults[idx].issueType,
                  };
                }
              }
            }
          } catch (err) {
            console.error('AI check batch failed:', err);
          }

          setProgress(50 + Math.round(((batchIdx + 1) / batches.length) * 50));
        }
      }

      setResults(initialResults);
      setProgress(100);
      setStage('');

      const issues = initialResults.filter(r => r.issueType !== 'none');
      toast({
        title: "הבדיקה הושלמה",
        description: issues.length > 0
          ? `נמצאו ${issues.length} בעיות מתוך ${words.length} מילים`
          : `כל ${words.length} המילים תקינות! ✅`,
      });
    } catch (err) {
      console.error('Dictionary check error:', err);
      toast({ title: "שגיאה", description: "הבדיקה נכשלה", variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  }, [text, words]);

  const filteredResults = useMemo(() => {
    if (filterType === 'all') return results;
    if (filterType === 'issues') return results.filter(r => r.issueType !== 'none');
    return results.filter(r => r.issueType === filterType);
  }, [results, filterType]);

  const stats = useMemo(() => {
    const total = results.length;
    const ok = results.filter(r => r.issueType === 'none').length;
    const spelling = results.filter(r => r.issueType === 'spelling').length;
    const grammar = results.filter(r => r.issueType === 'grammar').length;
    const context = results.filter(r => r.issueType === 'context').length;
    const unknown = results.filter(r => r.issueType === 'unknown_word').length;
    return { total, ok, spelling, grammar, context, unknown, issues: total - ok };
  }, [results]);

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-emerald-400" />
          בדיקת מילון עברי
        </CardTitle>
        <CardDescription className="text-white/60">
          בדיקת קיום מילים, דקדוק וצורות, והתאמה להקשר
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Action button */}
        <Button
          onClick={runFullCheck}
          disabled={isChecking || !text.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
        >
          {isChecking ? (
            <>
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              {stage}
            </>
          ) : (
            <>
              <Search className="w-4 h-4 ml-2" />
              בדוק תמלול ({words.length} מילים)
            </>
          )}
        </Button>

        {/* Progress */}
        {isChecking && (
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-white/50 text-center">{progress}%</p>
          </div>
        )}

        {/* Stats */}
        {results.length > 0 && (
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-green-500/10 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-green-400">{stats.ok}</div>
              <div className="text-[10px] text-white/50">תקין</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-red-400">{stats.spelling}</div>
              <div className="text-[10px] text-white/50">כתיב</div>
            </div>
            <div className="bg-orange-500/10 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-orange-400">{stats.grammar}</div>
              <div className="text-[10px] text-white/50">דקדוק</div>
            </div>
            <div className="bg-yellow-500/10 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-yellow-400">{stats.context}</div>
              <div className="text-[10px] text-white/50">הקשר</div>
            </div>
            <div className="bg-purple-500/10 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-purple-400">{stats.unknown}</div>
              <div className="text-[10px] text-white/50">לא ידוע</div>
            </div>
          </div>
        )}

        {/* Filter */}
        {results.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <Button variant={filterType === 'issues' ? 'secondary' : 'ghost'} size="sm"
              className="text-xs h-6" onClick={() => setFilterType('issues')}>
              בעיות ({stats.issues})
            </Button>
            <Button variant={filterType === 'all' ? 'secondary' : 'ghost'} size="sm"
              className="text-xs h-6" onClick={() => setFilterType('all')}>
              הכל ({stats.total})
            </Button>
            {Object.entries(ISSUE_CONFIG).filter(([k]) => k !== 'none').map(([key, cfg]) => (
              <Button key={key} variant={filterType === key ? 'secondary' : 'ghost'}
                size="sm" className="text-xs h-6" onClick={() => setFilterType(key)}>
                {cfg.label}
              </Button>
            ))}
          </div>
        )}

        {/* Results list */}
        {filteredResults.length > 0 && (
          <ScrollArea className="h-[300px]">
            <TooltipProvider>
              <div className="space-y-1">
                {filteredResults.map((result) => {
                  const cfg = ISSUE_CONFIG[result.issueType];
                  const Icon = cfg.icon;
                  return (
                    <div key={result.index}
                      className="flex items-center gap-2 px-3 py-2 rounded bg-white/5 hover:bg-white/10 group text-sm"
                      dir="rtl"
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${
                        result.issueType === 'none' ? 'text-green-400' :
                        result.issueType === 'spelling' ? 'text-red-400' :
                        result.issueType === 'grammar' ? 'text-orange-400' :
                        result.issueType === 'context' ? 'text-yellow-400' : 'text-purple-400'
                      }`} />
                      
                      <span className={`font-medium ${
                        result.issueType === 'none' ? 'text-white/70' : 'text-white'
                      }`}>
                        {result.word}
                      </span>

                      {result.lemma && result.lemma !== result.word && (
                        <span className="text-white/30 text-[10px]">
                          ← {result.lemma}
                        </span>
                      )}

                      {result.pos && (
                        <Badge variant="outline" className="text-[9px] bg-white/5 border-white/10 text-white/40">
                          {result.pos}
                        </Badge>
                      )}

                      <Badge variant="outline" className={`text-[10px] ${cfg.color} mr-auto`}>
                        {cfg.label}
                      </Badge>

                      {result.suggestion && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                              onClick={() => {
                                if (onApplyFix && result.suggestion) {
                                  onApplyFix(result.word, result.suggestion);
                                  toast({
                                    title: "תוקן",
                                    description: `"${result.word}" → "${result.suggestion}"`,
                                  });
                                }
                              }}
                            >
                              {result.suggestion}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs" dir="rtl">
                            {result.reason || 'לחץ להחליף'}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {result.reason && !result.suggestion && (
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="w-3 h-3 text-white/30" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs" dir="rtl">
                            {result.reason}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
          </ScrollArea>
        )}

        {results.length === 0 && !isChecking && (
          <div className="text-center py-6 text-white/40">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">לחץ "בדוק תמלול" לניתוח המילים</p>
            <p className="text-xs mt-1">שלב 1: קיום מילה • שלב 2: דקדוק • שלב 3: הקשר</p>
          </div>
        )}

        {/* Legend */}
        {results.length > 0 && (
          <div className="bg-white/5 rounded-lg p-3 space-y-1" dir="rtl">
            <p className="text-xs font-medium text-white/70 mb-2">מקרא:</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(ISSUE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <div key={key} className="flex items-center gap-1.5 text-[10px] text-white/50">
                    <Icon className="w-3 h-3" />
                    <span>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
