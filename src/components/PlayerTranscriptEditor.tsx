import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { extractCorrections, learnFromCorrections, type CorrectionEntry } from "@/utils/correctionLearning";
import { addProfileCorrection, getActiveProfileId, getProfile } from "@/lib/pronunciationProfiles";
import { getSuspectWordsMap, type SpellSuggestion } from "@/utils/hebrewSpellCheck";
import { Eye, EyeOff, Highlighter, Sparkles, BookPlus, SpellCheck, Check } from "lucide-react";

interface PlayerTranscriptEditorProps {
  originalText: string;
  editedText: string;
  onEditedTextChange: (text: string) => void;
}

interface SpellMenuState {
  x: number;
  y: number;
  word: string;
  wordIndex: number;
  suggestions: SpellSuggestion[];
}

function normalizeWord(word: string): string {
  return word.replace(/[.,;:!?"'׳״()\[\]{}<>\-–—]/g, "").trim();
}

function replaceWordAt(text: string, targetIndex: number, replacement: string): string {
  let idx = 0;
  return text.replace(/\S+/g, (m) => {
    if (idx === targetIndex) {
      idx += 1;
      return replacement;
    }
    idx += 1;
    return m;
  });
}

export const PlayerTranscriptEditor = ({ originalText, editedText, onEditedTextChange }: PlayerTranscriptEditorProps) => {
  const [showHighlights, setShowHighlights] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("player_transcript_show_highlights");
      if (raw === null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });
  const [learnNote, setLearnNote] = useState("");
  const [manualOriginal, setManualOriginal] = useState("");
  const [manualCorrected, setManualCorrected] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [spellMenu, setSpellMenu] = useState<SpellMenuState | null>(null);
  const [customCorrection, setCustomCorrection] = useState("");

  const editedWords = useMemo(() => editedText.split(/\s+/).filter(Boolean), [editedText]);
  const originalWords = useMemo(() => originalText.split(/\s+/).filter(Boolean), [originalText]);
  const suspectWordsMap = useMemo(() => getSuspectWordsMap(editedText), [editedText]);

  const changedWordIndexes = useMemo(() => {
    const changed = new Set<number>();
    const maxLen = Math.max(editedWords.length, originalWords.length);
    for (let i = 0; i < maxLen; i += 1) {
      if ((editedWords[i] || "") !== (originalWords[i] || "")) changed.add(i);
    }
    return changed;
  }, [editedWords, originalWords]);

  useEffect(() => {
    try {
      localStorage.setItem("player_transcript_show_highlights", showHighlights ? "1" : "0");
    } catch {
      // Ignore storage errors.
    }
  }, [showHighlights]);

  useEffect(() => {
    if (!spellMenu) return;
    const close = () => setSpellMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [spellMenu]);

  const applyWordCorrection = (wordIndex: number, correctedWord: string) => {
    const next = replaceWordAt(editedText, wordIndex, correctedWord.trim());
    onEditedTextChange(next);

    const current = editedWords[wordIndex] || "";
    const correctionEntry: CorrectionEntry = {
      original: normalizeWord(current) || current,
      corrected: normalizeWord(correctedWord) || correctedWord,
      frequency: 1,
      engine: "player-spell",
      category: "word",
      confidence: 0.75,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      note: "תיקון ידני מתצוגת נגן (קליק ימני)",
    };
    learnFromCorrections([correctionEntry]);

    setSpellMenu(null);
    toast({ title: "תוקן", description: `${current} → ${correctedWord}` });
  };

  const handleLearnFromEdits = () => {
    const diffs = extractCorrections(originalText, editedText, "player-manual");
    if (!diffs.length) {
      toast({ title: "אין שינויים ללמידה", description: "ערוך טקסט תחילה" });
      return;
    }

    const withNotes = diffs.map((d) => ({
      ...d,
      note: learnNote.trim() || undefined,
    }));
    learnFromCorrections(withNotes);
    const activeId = getActiveProfileId();
    let profileMsg = '';
    if (activeId) {
      for (const c of withNotes) addProfileCorrection(activeId, c);
      profileMsg = ` גם לפרופיל "${getProfile(activeId)?.name || ''}"`;
    }
    toast({ title: "למידה נשמרה", description: `${withNotes.length} תיקונים נלמדו${profileMsg}` });
  };

  const handleAddManualLearning = () => {
    const original = manualOriginal.trim();
    const corrected = manualCorrected.trim();
    if (!original || !corrected) {
      toast({
        title: "חסר מידע",
        description: "יש להזין מונח ומונח מתוקן/מורחב",
        variant: "destructive",
      });
      return;
    }

    const entry: CorrectionEntry = {
      original,
      corrected,
      note: manualNote.trim() || undefined,
      frequency: 1,
      engine: "manual-learning",
      category: "word",
      confidence: 0.85,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    learnFromCorrections([entry]);
    setManualOriginal("");
    setManualCorrected("");
    setManualNote("");
    toast({ title: "נוסף ללמידה", description: "המונח נשמר במאגר הלמידה" });
  };

  return (
    <Card className="p-4" dir="rtl">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">עריכה במצב נגן</h3>
            <Badge variant="outline" className="text-[11px]">{changedWordIndexes.size} שינויים</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={showHighlights ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowHighlights((v) => !v)}
              title="הצג/הסתר סימון שינויים ידניים"
            >
              {showHighlights ? <Highlighter className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              סימון שינויים
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleLearnFromEdits}>
              <Sparkles className="w-3.5 h-3.5" />
              למד מהעריכות
            </Button>
          </div>
        </div>

        <Textarea
          value={editedText}
          onChange={(e) => onEditedTextChange(e.target.value)}
          dir="rtl"
          className="min-h-[140px] text-sm leading-7"
          placeholder="ערוך כאן את הטקסט תוך כדי האזנה"
        />

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <Eye className="w-3.5 h-3.5" />
            תצוגת מילים לעריכה מהירה: קליק ימני על מילה להצעות תיקון
          </div>
          <div className="leading-8 text-sm select-text">
            {editedWords.map((w, i) => {
              const clean = normalizeWord(w);
              const isChanged = changedWordIndexes.has(i);
              const suggestions = clean ? suspectWordsMap.get(clean) || [] : [];
              const hasSpellSuggestions = suggestions.length > 0;
              return (
                <span
                  key={`${w}_${i}`}
                  className={cn(
                    "inline-block rounded px-1 py-0.5 ml-1 cursor-text transition-colors",
                    showHighlights && isChanged && "bg-yellow-200 text-yellow-900",
                    hasSpellSuggestions && "underline decoration-wavy decoration-red-500 decoration-1",
                  )}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCustomCorrection(w);
                    setSpellMenu({
                      x: e.clientX,
                      y: e.clientY,
                      word: w,
                      wordIndex: i,
                      suggestions,
                    });
                  }}
                  title={hasSpellSuggestions ? "קליק ימני להצעות תיקון" : undefined}
                >
                  {w}
                </span>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            value={learnNote}
            onChange={(e) => setLearnNote(e.target.value)}
            placeholder="הסבר כללי לשינויים שנלמדו (אופציונלי)"
            className="text-xs"
            dir="rtl"
          />
          <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
            <SpellCheck className="w-3.5 h-3.5" />
            ההסבר נשמר ללמידה בלבד
          </div>
        </div>

        <div className="rounded-md border p-3 space-y-2 bg-muted/10">
          <div className="text-sm font-medium flex items-center gap-1">
            <BookPlus className="w-4 h-4" />
            הוספת מונח ללמידה (גם אם לא מופיע בתמלול)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input value={manualOriginal} onChange={(e) => setManualOriginal(e.target.value)} placeholder="מונח מקורי" dir="rtl" />
            <Input value={manualCorrected} onChange={(e) => setManualCorrected(e.target.value)} placeholder="מונח מתוקן/מורחב" dir="rtl" />
            <Input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="הסבר (אופציונלי)" dir="rtl" />
          </div>
          <Button size="sm" variant="secondary" className="gap-1" onClick={handleAddManualLearning}>
            <Check className="w-3.5 h-3.5" />
            שמור מונח ללמידה
          </Button>
        </div>
      </div>

      {spellMenu && (
        <div
          className="fixed z-[2000] min-w-[260px] max-w-[320px] rounded-md border bg-popover p-3 shadow-xl"
          style={{ top: Math.min(spellMenu.y + 8, window.innerHeight - 220), left: Math.min(spellMenu.x + 8, window.innerWidth - 340) }}
          dir="rtl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs text-muted-foreground mb-2">תיקון עבור: <span className="font-medium text-foreground">{spellMenu.word}</span></div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {spellMenu.suggestions.length > 0 ? spellMenu.suggestions.map((s, i) => (
              <Button key={`${s.text}_${i}`} variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyWordCorrection(spellMenu.wordIndex, s.text)}>
                {s.text}
              </Button>
            )) : (
              <span className="text-xs text-muted-foreground">אין הצעות אוטומטיות למילה זו</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={customCorrection}
              onChange={(e) => setCustomCorrection(e.target.value)}
              className="h-8 text-sm"
              dir="rtl"
              onKeyDown={(e) => {
                if (e.key === "Enter" && customCorrection.trim()) {
                  applyWordCorrection(spellMenu.wordIndex, customCorrection.trim());
                }
              }}
            />
            <Button size="sm" className="h-8 text-xs" onClick={() => customCorrection.trim() && applyWordCorrection(spellMenu.wordIndex, customCorrection.trim())}>
              החלף
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
