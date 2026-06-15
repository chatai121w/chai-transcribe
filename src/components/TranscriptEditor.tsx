import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Wand2, BookOpen, FileText, Copy, Download, Loader2, Upload, Settings2, CheckCheck, AlignJustify, Quote, Users, Search, ChevronUp, ChevronDown, X, Highlighter, SpellCheck, BarChart3, Headphones } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { ExportButton } from "@/components/ExportButton";
import DiffMatchPatch from "diff-match-patch";
import { useSpellCheck, SpellCheckOverlay } from "@/components/SpellCheckView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Hebrew stop words to filter from frequency chart
const HE_STOP = new Set([
  'של','את','הם','הן','זה','זאת','כי','אם','לא','כן','על','עם','אל','לו','לה','להם',
  'אני','אתה','היא','הוא','אנחנו','אתם','הם','הן','ב','ל','מ','ו','ה','כ','ש',
  'מי','מה','איך','אבל','גם','כבר','עוד','רק','כל','יש','אין','היה','הייתה','יהיה',
  'היו','הייתי','היית','יש','כך','כן','לא','הכל','הרבה','קצת','מאוד','מאד','עכשיו',
  'כאן','שם','אז','כשם','כאשר','כדי','עד','מן','בין','כבר','עדיין','כמו',
]);

function WordFrequencyChart({ transcript }: { transcript: string }) {
  const data = useMemo(() => {
    const words = transcript.split(/[\s\n,\.\-–—:;!?()[\]{}"\'״׳]+/).filter(Boolean);
    const freq = new Map<string, number>();
    for (const w of words) {
      const clean = w.replace(/[^\u05d0-\u05ea\u05b0-\u05c7a-zA-Z]/g, '').trim();
      if (!clean || clean.length < 2 || HE_STOP.has(clean)) continue;
      freq.set(clean, (freq.get(clean) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
  }, [transcript]);

  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">אין מספיק מילים לניתוח</p>;

  const COLORS = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e'];

  return (
    <div dir="rtl">
      <p className="text-xs text-muted-foreground mb-2">20 המילים הנפוצות ביותר (ללא מילות קישור)</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ right: 8, left: 60 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="word" tick={{ fontSize: 12, fontFamily: 'inherit' }} width={58} />
          <Tooltip formatter={(v: number) => [`${v} פעמים`, 'תדירות']} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TranscriptEditorProps {
  transcript: string;
  originalTranscript?: string;
  onTranscriptChange: (text: string) => void;
  wordTimings?: Array<{word: string, start: number, end: number, probability?: number}>;
  onWordClick?: (word: {word: string, start: number, end: number}) => void;
  activeWordIdx?: number;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}

const TranscriptEditorInner = ({ transcript, originalTranscript, onTranscriptChange, wordTimings, onWordClick, activeWordIdx, searchOpen, onSearchOpenChange }: TranscriptEditorProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showConfidence, setShowConfidence] = useState(false);
  const [showDiffHighlight, setShowDiffHighlight] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showPromptDialog, setShowPromptDialog] = useState(false);

  // Spell check
  const spellCheck = useSpellCheck();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [matches, setMatches] = useState<number[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Diff computation
  const dmp = useMemo(() => new DiffMatchPatch(), []);
  const diffElements = useMemo(() => {
    if (!showDiffHighlight || !originalTranscript || originalTranscript === transcript) return null;
    const d = dmp.diff_main(originalTranscript, transcript);
    dmp.diff_cleanupSemantic(d);
    return d;
  }, [showDiffHighlight, originalTranscript, transcript, dmp]);

  // Compute matches when query or transcript changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatches([]);
      setCurrentMatch(0);
      return;
    }
    const indices: number[] = [];
    const lower = transcript.toLowerCase();
    const q = searchQuery.toLowerCase();
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      indices.push(idx);
      idx = lower.indexOf(q, idx + 1);
    }
    setMatches(indices);
    setCurrentMatch(indices.length > 0 ? 0 : -1);
  }, [searchQuery, transcript]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
    }
  }, [searchOpen]);

  // Jump to match in textarea
  const jumpToMatch = useCallback((matchIndex: number) => {
    if (matches.length === 0 || matchIndex < 0) return;
    const idx = matches[matchIndex];
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(idx, idx + searchQuery.length);
      // Scroll the textarea so the match is visible
      const textBefore = transcript.substring(0, idx);
      const lines = textBefore.split('\n');
      const approxLine = lines.length;
      const lineHeight = 24;
      ta.scrollTop = Math.max(0, (approxLine - 3) * lineHeight);
    }
  }, [matches, searchQuery, transcript]);

  useEffect(() => {
    if (currentMatch >= 0 && matches.length > 0) {
      jumpToMatch(currentMatch);
    }
  }, [currentMatch, jumpToMatch, matches]);

  const nextMatch = () => {
    if (matches.length === 0) return;
    setCurrentMatch(prev => (prev + 1) % matches.length);
  };
  const prevMatch = () => {
    if (matches.length === 0) return;
    setCurrentMatch(prev => (prev - 1 + matches.length) % matches.length);
  };
  const closeSearch = () => {
    onSearchOpenChange?.(false);
  };

  const handleEdit = async (action: 'improve' | 'sources' | 'readable' | 'custom' | 'grammar' | 'punctuation' | 'paragraphs' | 'speakers', prompt?: string) => {
    if (!transcript.trim()) {
      toast({
        title: "שגיאה",
        description: "אין טקסט לעריכה",
        variant: "destructive",
      });
      return;
    }

    setIsEditing(true);

    try {
      const resultText = await editTranscriptCloud({
        text: transcript,
        action,
        customPrompt: prompt,
      });

      onTranscriptChange(resultText);
      toast({
        title: "הצלחה",
        description: "הטקסט נערך בהצלחה",
      });
      setShowPromptDialog(false);
      setCustomPrompt("");
    } catch (error) {
      console.error('Error editing transcript:', error);
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בעריכת הטקסט",
        variant: "destructive",
      });
    } finally {
      setIsEditing(false);
    }
  };

  const handleCustomEdit = () => {
    if (!customPrompt.trim()) {
      toast({
        title: "שגיאה",
        description: "נא להזין פרומפט",
        variant: "destructive",
      });
      return;
    }
    handleEdit('custom', customPrompt);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          try {
            const json = JSON.parse(content);
            onTranscriptChange(json.transcript || content);
          } catch {
            onTranscriptChange(content);
          }
          toast({
            title: "הצלחה",
            description: "הקובץ יובא בהצלחה",
          });
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleExportJSON = () => {
    const data = {
      transcript,
      timestamp: new Date().toISOString(),
      version: "1.0"
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: "הורדה החלה",
      description: "הקובץ JSON הורד למחשב שלך",
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    toast({
      title: "הועתק",
      description: "הטקסט הועתק ללוח",
    });
  };

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: "הורדה החלה",
      description: "הקובץ הורד למחשב שלך",
    });
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-right">תמלול</h2>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={searchOpen ? "default" : "outline"}
            size="sm"
            onClick={() => onSearchOpenChange?.(!searchOpen)}
            disabled={!transcript.trim()}
            title="חיפוש בתמלול (Ctrl+F)"
          >
            <Search className="w-4 h-4 ml-2" />
            חפש
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImport}
            disabled={isEditing}
          >
            <Upload className="w-4 h-4 ml-2" />
            יבוא
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!transcript.trim() || isEditing}
          >
            <Copy className="w-4 h-4 ml-2" />
            העתק
          </Button>
          <ExportButton text={transcript} disabled={isEditing} wordTimings={wordTimings} />
          {/* Word frequency chart */}
          {transcript.trim().length > 30 && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" title="תדירות מילים">
                  <BarChart3 className="w-4 h-4 ml-2" />
                  תדירות
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>תדירות מילים</DialogTitle>
                  <DialogDescription>ניתוח המילים הנפוצות ביותר בתמלול</DialogDescription>
                </DialogHeader>
                <WordFrequencyChart transcript={transcript} />
              </DialogContent>
            </Dialog>
          )}
          {wordTimings && wordTimings.some(w => w.probability != null) && (
            <Button
              variant={showConfidence ? "default" : "outline"}
              size="sm"
              onClick={() => setShowConfidence(!showConfidence)}
              title="הצג ציון ביטחון למילים"
            >
              <Settings2 className="w-4 h-4 ml-2" />
              ביטחון
            </Button>
          )}
          {originalTranscript && originalTranscript !== transcript && (
            <Button
              variant={showDiffHighlight ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDiffHighlight(!showDiffHighlight)}
              title="הדגש שינויים מהתמלול המקורי"
            >
              <Highlighter className="w-4 h-4 ml-2" />
              שינויים
            </Button>
          )}
          <Button
            variant={spellCheck.spellCheckActive ? "default" : "outline"}
            size="sm"
            onClick={() => spellCheck.toggleSpellCheck(transcript)}
            disabled={!transcript.trim() || spellCheck.isChecking || isEditing}
            title="בדיקת שגיאות כתיב"
          >
            {spellCheck.isChecking ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <SpellCheck className="w-4 h-4 ml-2" />
            )}
            איות
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-muted/50 rounded-md border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.shiftKey ? prevMatch() : nextMatch();
              }
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="חפש בתמלול..."
            className="h-8 text-sm flex-1"
            dir="rtl"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[60px] text-center">
            {searchQuery ? `${matches.length > 0 ? currentMatch + 1 : 0}/${matches.length}` : ''}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMatch} disabled={matches.length === 0} title="הקודם">
            <ChevronUp className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMatch} disabled={matches.length === 0} title="הבא">
            <ChevronDown className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeSearch} title="סגור">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {spellCheck.spellCheckActive && spellCheck.errors.length > 0 ? (
        <SpellCheckOverlay
          text={transcript}
          errors={spellCheck.errors}
          onApplyCorrection={(oldWord, newWord) => {
            onTranscriptChange(transcript.split(oldWord).join(newWord));
          }}
          onRemoveError={spellCheck.removeError}
        />
      ) : showDiffHighlight && diffElements ? (
        <div className="min-h-[300px] mb-4 p-3 bg-background border rounded-md text-right overflow-y-auto max-h-[600px]" dir="rtl">
          <pre className="whitespace-pre-wrap font-mono text-base leading-relaxed">
            {diffElements.map((diff, i) => {
              const [op, text] = diff;
              if (op === -1) return <span key={i} className="bg-destructive/20 line-through decoration-destructive/60 text-muted-foreground">{text}</span>;
              if (op === 1) return <span key={i} className="bg-green-500/20 font-semibold underline decoration-green-500/60">{text}</span>;
              return <span key={i}>{text}</span>;
            })}
          </pre>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-destructive/20 border border-destructive/30" /> נמחק
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-500/20 border border-green-500/30" /> נוסף/שונה
            </span>
          </div>
        </div>
      ) : showConfidence && wordTimings && wordTimings.some(w => w.probability != null) ? (
        <div className="min-h-[300px] mb-4 p-3 bg-background border rounded-md text-right overflow-y-auto" dir="rtl">
          <div className="flex flex-wrap gap-1 leading-relaxed font-mono text-base">
            {wordTimings.map((w, i) => {
              const p = w.probability ?? 1;
              const bg = p >= 0.9 ? '' : p >= 0.7 ? 'bg-yellow-200 dark:bg-yellow-900/40' : 'bg-red-200 dark:bg-red-900/40';
              const clickable = onWordClick && w.start != null;
              const isActive = activeWordIdx === i;
              return (
                <span
                  key={i}
                  className={`inline-block px-0.5 rounded transition-all ${bg} ${clickable ? 'cursor-pointer hover:ring-1 hover:ring-primary hover:opacity-80 transition-opacity' : ''} ${isActive ? 'ring-2 ring-primary bg-primary/25 dark:bg-primary/30 scale-105 shadow-sm' : ''}`}
                  title={`ביטחון: ${Math.round(p * 100)}%${clickable ? ` | ${w.start.toFixed(1)}s — לחץ לנגן` : ''}`}
                  onClick={() => clickable && onWordClick(w)}
                >
                  {w.word}
                </span>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 dark:bg-red-900/40 inline-block" /> &lt;70%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 dark:bg-yellow-900/40 inline-block" /> 70-90%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border inline-block" /> &gt;90%</span>
          </div>
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder="התמלול יופיע כאן..."
          className="min-h-[300px] mb-4 font-mono text-base text-right"
          dir="rtl"
          disabled={isEditing}
        />
      )}

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3 text-right">עריכת טקסט עם AI</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => handleEdit('grammar')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <CheckCheck className="w-4 h-4 ml-2" />
            )}
            דקדוק ואיות
          </Button>

          <Button
            variant="secondary"
            onClick={() => handleEdit('punctuation')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Quote className="w-4 h-4 ml-2" />
            )}
            פיסוק
          </Button>

          <Button
            variant="secondary"
            onClick={() => handleEdit('paragraphs')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <AlignJustify className="w-4 h-4 ml-2" />
            )}
            חלק לפסקאות
          </Button>

          <Button
            variant="secondary"
            onClick={() => handleEdit('improve')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 ml-2" />
            )}
            שפר ניסוח
          </Button>
          
          <Button
            variant="secondary"
            onClick={() => handleEdit('sources')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 ml-2" />
            )}
            הוסף מקורות
          </Button>
          
          <Button
            variant="secondary"
            onClick={() => handleEdit('readable')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <BookOpen className="w-4 h-4 ml-2" />
            )}
            עשה זורם לקריאה
          </Button>

          <Button
            variant="secondary"
            onClick={() => handleEdit('speakers')}
            disabled={!transcript.trim() || isEditing}
          >
            {isEditing ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Users className="w-4 h-4 ml-2" />
            )}
            זהה דוברים
          </Button>

          <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                disabled={!transcript.trim() || isEditing}
              >
                <Settings2 className="w-4 h-4 ml-2" />
                פרומפט מותאם
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>פרומפט מותאם אישית</DialogTitle>
                <DialogDescription>
                  הזן את ההוראות שלך ל-AI לעריכת הטקסט
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Textarea
                  placeholder="למשל: תרגם לאנגלית, סכם ל-3 משפטים, המר לנקודות..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="min-h-[100px] text-right"
                  dir="rtl"
                />
                <Button 
                  onClick={handleCustomEdit} 
                  className="w-full"
                  disabled={isEditing || !customPrompt.trim()}
                >
                  {isEditing ? (
                    <>
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                      מעבד...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4 ml-2" />
                      הפעל עריכה
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <p className="text-xs text-muted-foreground mt-3 text-right">
          כפתורי ה-AI משתמשים במודל Gemini חינמי לעריכה חכמה של הטקסט
        </p>
      </div>
    </Card>
  );
};

export const TranscriptEditor = memo(TranscriptEditorInner);
