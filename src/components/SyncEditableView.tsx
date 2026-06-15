import { useRef, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addDictionaryReplacement, addIgnoredWord } from "@/utils/hebrewGrammarDictionary";
import type { MenuSuggestion } from "@/utils/syncedSpellAssist";
import { useTextMarking } from "@/hooks/useTextMarking";
import { MarkingToolbar } from "@/components/MarkingToolbar";
import { Edit3, Clock, Link, Unlink, Highlighter, Palette } from "lucide-react";
import type { WordTiming } from "./SyncAudioPlayer";
import { WordContextMenu } from "@/components/WordContextMenu";
import { getWordHighlightStyle, isWordApproved } from "@/lib/personalPronunciationModel";

interface SyncEditableViewProps {
  wordTimings: WordTiming[];
  currentTime: number;
  text: string;
  onTextChange: (text: string) => void;
  onWordClick: (time: number) => void;
  onWordReplace?: (wordIndex: number, replacement: string) => void;
  fontSize?: number;
  fontFamily?: string;
  syncEnabled?: boolean;
  searchQuery?: string;
  searchActiveIndex?: number;
  onSearchMatchCount?: (count: number) => void;
}

function normalizeWord(word: string): string {
  return word.replace(/[.,;:!?"'׳״()\[\]{}<>\-–—]/g, "").trim();
}

const HIGHLIGHT_STYLE_KEY = "word_highlight_style_v1";
const WORD_HIGHLIGHT_STYLES: Array<{ id: string; label: string; previewStyle: CSSProperties; activeClass: string; lineMode?: boolean }> = [
  { id: "fill-blue",   label: "כחול",               previewStyle: { background: "#3b82f6", color: "#fff" },                        activeClass: "bg-blue-500 text-white font-bold" },
  { id: "fill-yellow", label: "צהוב",               previewStyle: { background: "#fde047", color: "#000" },                        activeClass: "bg-yellow-300 text-black font-bold" },
  { id: "fill-green",  label: "ירוק",               previewStyle: { background: "#4ade80", color: "#000" },                        activeClass: "bg-green-400 text-black font-bold" },
  { id: "fill-orange", label: "כתום",               previewStyle: { background: "#fb923c", color: "#000" },                        activeClass: "bg-orange-400 text-black font-bold" },
  { id: "fill-purple", label: "סגול",               previewStyle: { background: "#a855f7", color: "#fff" },                        activeClass: "bg-purple-500 text-white font-bold" },
  { id: "fill-red",    label: "אדום",               previewStyle: { background: "#ef4444", color: "#fff" },                        activeClass: "bg-red-500 text-white font-bold" },
  { id: "ul-blue",     label: "קו תחתון כחול",      previewStyle: { borderBottom: "3px solid #3b82f6" },                           activeClass: "border-b-4 border-blue-500 font-bold" },
  { id: "ul-yellow",   label: "קו תחתון צהוב",      previewStyle: { borderBottom: "3px solid #eab308" },                           activeClass: "border-b-4 border-yellow-400 font-bold" },
  { id: "box-blue",    label: "מסגרת כחולה",        previewStyle: { outline: "2px solid #3b82f6", outlineOffset: "1px" },          activeClass: "ring-2 ring-blue-500 font-bold" },
  { id: "box-yellow",  label: "מסגרת צהובה",        previewStyle: { outline: "2px solid #eab308", outlineOffset: "1px" },          activeClass: "ring-2 ring-yellow-400 font-bold" },
  { id: "line-yellow", label: "שורה — צהוב",        previewStyle: { background: "#fef9c3", borderRight: "3px solid #eab308" },     activeClass: "bg-yellow-100 dark:bg-yellow-900/40 border-r-[3px] border-yellow-400", lineMode: true },
  { id: "line-blue",   label: "שורה — כחול",        previewStyle: { background: "#dbeafe", borderRight: "3px solid #3b82f6" },     activeClass: "bg-blue-100 dark:bg-blue-900/40 border-r-[3px] border-blue-400",   lineMode: true },
  { id: "line-green",  label: "שורה — ירוק",        previewStyle: { background: "#dcfce7", borderRight: "3px solid #4ade80" },     activeClass: "bg-green-100 dark:bg-green-900/40 border-r-[3px] border-green-400", lineMode: true },
  { id: "line-orange", label: "שורה — כתום",        previewStyle: { background: "#ffedd5", borderRight: "3px solid #fb923c" },     activeClass: "bg-orange-100 dark:bg-orange-900/40 border-r-[3px] border-orange-400", lineMode: true },
];

export const SyncEditableView = ({
  wordTimings,
  currentTime,
  text,
  onTextChange,
  onWordClick,
  onWordReplace,
  fontSize = 18,
  fontFamily = "Assistant",
  syncEnabled = true,
  searchQuery,
  searchActiveIndex,
  onSearchMatchCount,
}: SyncEditableViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // isEditing=true → fast native textarea; isEditing=false → sync word view
  const [isEditing, setIsEditing] = useState(true);

  const [dictionaryVersion, setDictionaryVersion] = useState(0);
  const [showWordHighlight, setShowWordHighlight] = useState<boolean>(() => {
    try { return localStorage.getItem("sync_editable_word_highlight") !== "0"; } catch { return true; }
  });

  const toggleWordHighlight = () => {
    setShowWordHighlight((v) => {
      const next = !v;
      try { localStorage.setItem("sync_editable_word_highlight", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const [highlightStyleId, setHighlightStyleId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(HIGHLIGHT_STYLE_KEY);
      return WORD_HIGHLIGHT_STYLES.some(s => s.id === saved) ? saved! : "fill-blue";
    } catch { return "fill-blue"; }
  });
  const [showStylePicker, setShowStylePicker] = useState(false);
  const activeStyle = WORD_HIGHLIGHT_STYLES.find(s => s.id === highlightStyleId) ?? WORD_HIGHLIGHT_STYLES[0];
  const activeHighlightClass = activeStyle.activeClass;
  const isLineMode = activeStyle.lineMode ?? false;

  const [wordsPerRow, setWordsPerRow] = useState(10);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setWordsPerRow(Math.max(5, Math.round(w / (fontSize * 3.2))));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fontSize, isEditing]);

  useEffect(() => {
    if (!showStylePicker) return;
    const close = () => setShowStylePicker(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showStylePicker]);

  const currentWordIndex = useMemo(() => {
    if (!syncEnabled || !wordTimings.length) return -1;
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      if (currentTime >= wordTimings[i].start) return i;
    }
    return -1;
  }, [currentTime, wordTimings, syncEnabled]);

  // Search matching
  const searchMatchIndices = useMemo(() => {
    if (!searchQuery?.trim()) return new Set<number>();
    const q = searchQuery.trim().toLowerCase();
    const matches = new Set<number>();
    wordTimings.forEach((wt, i) => {
      if (wt.word.toLowerCase().includes(q)) matches.add(i);
    });
    return matches;
  }, [wordTimings, searchQuery]);

  const searchMatchList = useMemo(() => [...searchMatchIndices].sort((a, b) => a - b), [searchMatchIndices]);
  const activeSearchWordIndex = searchMatchList[searchActiveIndex ?? 0] ?? -1;

  useEffect(() => {
    onSearchMatchCount?.(searchMatchList.length);
  }, [searchMatchList.length, onSearchMatchCount]);

  const words = useMemo(() => wordTimings.map((w) => w.word), [wordTimings]);

  // Unified marking hook (local spell + AI analysis)
  const marking = useTextMarking(words, onWordReplace);

  const sentences = useMemo(() => {
    if (!wordTimings.length) return [];
    const groups: { words: (WordTiming & { globalIndex: number })[] }[] = [];
    for (let i = 0; i < wordTimings.length; i += wordsPerRow) {
      const chunk = wordTimings.slice(i, i + wordsPerRow).map((wt, j) => ({ ...wt, globalIndex: i + j }));
      groups.push({ words: chunk });
    }
    return groups;
  }, [wordTimings, wordsPerRow]);

  useEffect(() => {
    if (activeWordRef.current && containerRef.current) {
      const container = containerRef.current;
      const word = activeWordRef.current;
      const containerRect = container.getBoundingClientRect();
      const wordRect = word.getBoundingClientRect();
      const isVisible = wordRect.top >= containerRect.top && wordRect.bottom <= containerRect.bottom;
      if (!isVisible) {
        word.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentWordIndex, isEditing]);

  const formatTime = (t: number) => {
    if (!isFinite(t)) return "00:00";
    const m = Math.floor(t / 60).toString().padStart(2, "0");
    const s = Math.floor(t % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const applyCorrection = (wordIndex: number, correctedWord: string) => {
    const fixed = correctedWord.trim();
    if (!fixed) return;

    if (fixed === "__IGNORE__") {
      const raw = words[wordIndex] || "";
      const clean = normalizeWord(raw);
      if (clean) {
        addIgnoredWord(clean);
        setDictionaryVersion((v) => v + 1);
      }
      return;
    }

    if (onWordReplace) {
      onWordReplace(wordIndex, fixed);
    } else {
      const plainWords = text.split(/\s+/).filter(Boolean);
      if (wordIndex >= 0 && wordIndex < plainWords.length) {
        plainWords[wordIndex] = fixed;
        onTextChange(plainWords.join(" "));
      }
    }

    if (fixed !== "__DELETE__") {
      const raw = words[wordIndex] || "";
      const clean = normalizeWord(raw);
      if (clean) {
        addDictionaryReplacement(clean, fixed);
        setDictionaryVersion((v) => v + 1);
      }
    }

  };

  if (!wordTimings.length && !text) {
    return (
      <Card className="p-6 text-center" dir="rtl">
        <Edit3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h3 className="text-sm font-semibold mb-1">עריכה מסונכרנת</h3>
        <p className="text-muted-foreground text-xs">נדרש תמלול עם תזמונים</p>
      </Card>
    );
  }

  // Build combined suggestions for context menu: local + AI
  const getSuggestions = (wordIndex: number): MenuSuggestion[] => {
    const local = marking.localIssueMap.get(wordIndex) || [];
    const aiResult = marking.resultMap.get(wordIndex);
    const combined = [...local];
    if (aiResult?.suggestion) {
      combined.push({ text: aiResult.suggestion, label: aiResult.suggestion, source: aiResult.reason || "AI", score: 1 });
    }
    return combined;
  };

  const hasIssue = (wordIndex: number): boolean => {
    return marking.getWordMarkingStyle(wordIndex) !== "";
  };

  return (
    <Card className="p-4 flex flex-col h-full" dir="rtl">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2 min-h-8">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">עריכה מסונכרנת</h3>
          <Badge variant={syncEnabled ? "secondary" : "outline"} className="text-xs gap-1 min-w-[86px] justify-center">
            {syncEnabled ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
            {syncEnabled ? "מסונכרן" : "מושהה"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs min-w-[76px] justify-center">
            <Clock className="w-3 h-3 ml-1" />
            {formatTime(currentTime)}
          </Badge>
          <Badge variant="secondary" className="text-xs min-w-[74px] justify-center">
            {currentWordIndex + 1} / {wordTimings.length}
          </Badge>
          <Button
            variant={showWordHighlight ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={toggleWordHighlight}
            title={showWordHighlight ? "כבה הדגשת מילה פעילה" : "הפעל הדגשת מילה פעילה"}
          >
            <Highlighter className={`w-3.5 h-3.5 ${showWordHighlight ? "" : "opacity-40"}`} />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); setShowStylePicker(v => !v); }}
              title="בחר סגנון הדגשה"
            >
              <Palette className="w-3.5 h-3.5 opacity-70" />
            </Button>
            {showStylePicker && (
              <div
                className="absolute top-8 right-0 z-[100] bg-popover border rounded-lg shadow-xl p-2.5"
                dir="rtl"
                onClick={e => e.stopPropagation()}
              >
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">הדגשת מילה</div>
                <div className="flex flex-wrap gap-1.5 mb-3" style={{ maxWidth: 168 }}>
                  {WORD_HIGHLIGHT_STYLES.filter(s => !s.lineMode).map(style => (
                    <button
                      key={style.id}
                      title={style.label}
                      onClick={() => {
                        setHighlightStyleId(style.id);
                        try { localStorage.setItem(HIGHLIGHT_STYLE_KEY, style.id); } catch {}
                        setShowStylePicker(false);
                      }}
                      className={cn(
                        "w-7 h-7 rounded flex items-center justify-center text-xs font-bold border-2 transition-all hover:scale-110",
                        highlightStyleId === style.id
                          ? "border-foreground shadow-sm"
                          : "border-transparent hover:border-muted-foreground/50"
                      )}
                      style={style.previewStyle}
                    >
                      א
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">הדגשת שורה שלמה</div>
                <div className="flex flex-col gap-1" style={{ width: 168 }}>
                  {WORD_HIGHLIGHT_STYLES.filter(s => s.lineMode).map(style => (
                    <button
                      key={style.id}
                      title={style.label}
                      onClick={() => {
                        setHighlightStyleId(style.id);
                        try { localStorage.setItem(HIGHLIGHT_STYLE_KEY, style.id); } catch {}
                        setShowStylePicker(false);
                      }}
                      className={cn(
                        "w-full h-6 rounded flex items-center px-2 text-[11px] font-medium border-2 transition-all hover:opacity-90",
                        highlightStyleId === style.id
                          ? "border-foreground shadow-sm"
                          : "border-transparent hover:border-muted-foreground/50"
                      )}
                      style={style.previewStyle}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button
            variant={isEditing ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs min-w-[96px]"
            onClick={() => setIsEditing((v) => !v)}
            title={isEditing ? "עבור לתצוגת סינכרון" : "ערוך טקסט חופשי"}
          >
            {isEditing ? "✏️ עריכה" : "🔁 סינכרון"}
          </Button>
        </div>
      </div>

      {/* Unified marking toolbar */}
      <div className="mb-2">
        <MarkingToolbar
          settings={marking.settings}
          setSettings={marking.setSettings}
          isActive={marking.isActive}
          isAnalyzing={marking.isAnalyzing}
          isPaused={marking.isPaused}
          progress={marking.progress}
          stage={marking.stage}
          cacheSource={marking.cacheSource}
          canResume={marking.canResume}
          hasText={words.length > 0}
          localIssueCount={marking.localIssueCount}
          issueStats={marking.issueStats}
          fixableResults={marking.fixableResults}
          selectedFixes={marking.selectedFixes}
          showFixPanel={marking.showFixPanel}
          setShowFixPanel={marking.setShowFixPanel}
          toggleFixSelection={marking.toggleFixSelection}
          toggleSelectAll={marking.toggleSelectAll}
          wordResults={marking.wordResults}
          runAnalysis={marking.runAnalysis}
          handlePause={marking.handlePause}
          handleResume={marking.handleResume}
          handleCancel={marking.handleCancel}
          clearResults={marking.clearResults}
          handleFixAll={marking.handleFixAll}
          handleFixSelected={marking.handleFixSelected}
          handleRemoveAllDuplicates={marking.handleRemoveAllDuplicates}
          selectedDuplicate={marking.selectedDuplicate}
          setSelectedDuplicate={marking.setSelectedDuplicate}
          handleRemoveDuplicate={marking.handleRemoveDuplicate}
        />
      </div>

      {/* ─── EDIT MODE: single fast textarea ─── */}
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          className="flex-1 w-full resize-none rounded-lg bg-muted/20 p-4 outline-none focus:ring-1 focus:ring-primary/50 overflow-y-auto text-foreground"
          style={{ fontSize: `${fontSize}px`, fontFamily, lineHeight: 2, minHeight: 0, direction: "rtl" }}
          dir="rtl"
          spellCheck={false}
          placeholder="הקלד טקסט..."
        />
      ) : (
        /* ─── SYNC VIEW MODE: word-by-word with highlight ─── */
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-4 rounded-lg bg-muted/20 scroll-smooth"
          style={{ fontSize: `${fontSize}px`, fontFamily, lineHeight: 2 }}
        >
          {sentences.map((sentence, si) => {
            const displayWordIndex = showWordHighlight ? currentWordIndex : -1;
            const isActiveSentence = sentence.words.some((w) => w.globalIndex === displayWordIndex);
            return (
              <div
                key={si}
                className={cn(
                  "block mb-1",
                  showWordHighlight && isLineMode && isActiveSentence && cn(activeHighlightClass, "rounded px-1 -mx-1 py-0.5"),
                  showWordHighlight && (isActiveSentence ? "opacity-100" : "opacity-70"),
                )}
              >
                {sentence.words.map((wt) => {
                  const isActive = wt.globalIndex === displayWordIndex;
                  const isPast = wt.globalIndex < displayWordIndex;
                  const prob = wt.probability;
                  const confidenceStyle = prob != null && prob < 0.5
                    ? "border-b-2 border-red-400/70"
                    : prob != null && prob < 0.7
                      ? "border-b-2 border-orange-400/60"
                      : "";
                  const markingClass = marking.getWordMarkingStyle(wt.globalIndex);
                  const wordHasIssue = hasIssue(wt.globalIndex);
                  const wordApproved = isWordApproved(wt.word);
                  const suggestions = wordHasIssue && !wordApproved ? getSuggestions(wt.globalIndex) : [];
                  const suggestionTexts = suggestions.map((s) => s.text);
                  const highlightStyle = getWordHighlightStyle(wt.word);
                  const isSearchMatch = searchMatchIndices.has(wt.globalIndex);
                  const isSearchActive = wt.globalIndex === activeSearchWordIndex;
                  const wordSpan = (
                    <span
                      key={wt.globalIndex}
                      ref={isActive || isSearchActive ? activeWordRef : undefined}
                      style={highlightStyle}
                      className={cn(
                        "px-0.5 py-0.5 rounded cursor-pointer transition-colors duration-150 inline-block",
                        confidenceStyle,
                        wordApproved ? "" : markingClass,
                        isSearchActive
                          ? "bg-yellow-400 text-black font-bold ring-2 ring-yellow-500 shadow-md"
                          : isSearchMatch
                            ? "bg-yellow-200/70 dark:bg-yellow-800/40"
                            : "",
                        isActive && !isSearchActive
                          ? isLineMode ? "font-extrabold underline underline-offset-2 decoration-2" : activeHighlightClass
                          : isPast
                            ? "text-muted-foreground hover:bg-muted"
                            : "hover:bg-muted",
                      )}
                      onClick={() => onWordClick(wt.start)}
                      title={`${formatTime(wt.start)} → ${formatTime(wt.end)}`}
                    >
                      {wt.word}
                    </span>
                  );
                  return (
                    <WordContextMenu
                      key={wt.globalIndex}
                      word={wt.word}
                      suggestions={suggestionTexts}
                      onReplace={(next) => applyCorrection(wt.globalIndex, next)}
                      onApproveAsCorrect={() => setDictionaryVersion((v) => v + 1)}
                    >
                      {wordSpan}
                    </WordContextMenu>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
