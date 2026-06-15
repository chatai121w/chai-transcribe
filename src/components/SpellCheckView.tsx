import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getAllCorrections, learnFromCorrections, type CorrectionEntry } from "@/utils/correctionLearning";

export interface SpellingError {
  word: string;
  suggestions: string[];
  reason: string;
}

interface SpellCheckViewProps {
  text: string;
  onApplyCorrection: (oldWord: string, newWord: string) => void;
}

interface PopoverState {
  errorIndex: number;
  x: number;
  y: number;
}

export function useSpellCheck() {
  const [errors, setErrors] = useState<SpellingError[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [spellCheckActive, setSpellCheckActive] = useState(false);

  const runCheck = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setIsChecking(true);
    try {
      // Get learned corrections to send as context
      const learned = getAllCorrections()
        .filter(c => c.confidence >= 0.5 && c.category === 'word')
        .slice(0, 30)
        .map(c => ({ original: c.original, corrected: c.corrected }));

      const { data, error } = await supabase.functions.invoke('check-spelling', {
        body: { text, learnedCorrections: learned },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const foundErrors: SpellingError[] = (data?.errors || []).filter(
        (e: SpellingError) => text.includes(e.word) && e.suggestions.length > 0
      );

      setErrors(foundErrors);
      if (foundErrors.length === 0) {
        toast({ title: "✓ לא נמצאו שגיאות כתיב" });
      } else {
        toast({ title: `נמצאו ${foundErrors.length} שגיאות כתיב`, description: "לחץ על מילה מסומנת לתיקון" });
      }
    } catch (e) {
      console.error('Spell check failed:', e);
      toast({ title: "שגיאה בבדיקת איות", variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  }, []);

  const toggleSpellCheck = useCallback((text: string) => {
    if (spellCheckActive) {
      setSpellCheckActive(false);
      setErrors([]);
    } else {
      setSpellCheckActive(true);
      runCheck(text);
    }
  }, [spellCheckActive, runCheck]);

  const removeError = useCallback((word: string) => {
    setErrors(prev => prev.filter(e => e.word !== word));
  }, []);

  return { errors, isChecking, spellCheckActive, toggleSpellCheck, removeError, runCheck, setErrors };
}

export const SpellCheckView = ({ text, onApplyCorrection }: SpellCheckViewProps & { errors: SpellingError[]; onRemoveError: (word: string) => void }) => {
  return null; // Not used directly — see SpellCheckOverlay
};

interface SpellCheckOverlayProps {
  text: string;
  errors: SpellingError[];
  onApplyCorrection: (oldWord: string, newWord: string) => void;
  onRemoveError: (word: string) => void;
}

export const SpellCheckOverlay = ({ text, errors, onApplyCorrection, onRemoveError }: SpellCheckOverlayProps) => {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    if (popover) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover]);

  // Build error word set for quick lookup
  const errorMap = useMemo(() => {
    const map = new Map<string, number>();
    errors.forEach((e, i) => {
      if (!map.has(e.word)) map.set(e.word, i);
    });
    return map;
  }, [errors]);

  // Split text into segments: normal text and error words
  const segments = useMemo(() => {
    if (errors.length === 0) return [{ type: 'text' as const, content: text }];

    const errorWords = errors.map(e => e.word).filter(w => w.length > 0);
    if (errorWords.length === 0) return [{ type: 'text' as const, content: text }];

    // Create regex that matches any error word
    const escaped = errorWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'g');

    const parts: Array<{ type: 'text' | 'error'; content: string; errorIndex?: number }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      const errorIdx = errorMap.get(match[0]);
      parts.push({ type: 'error', content: match[0], errorIndex: errorIdx });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts;
  }, [text, errors, errorMap]);

  const handleErrorClick = (e: React.MouseEvent, errorIndex: number) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setPopover({
      errorIndex,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 4,
    });
  };

  const handleSelectSuggestion = (errorIndex: number, suggestion: string) => {
    const error = errors[errorIndex];
    if (!error) return;

    // Learn this correction
    learnFromCorrections([{
      original: error.word,
      corrected: suggestion,
      frequency: 1,
      engine: 'spellcheck',
      category: 'word',
      confidence: 0.7,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    }]);

    onApplyCorrection(error.word, suggestion);
    onRemoveError(error.word);
    setPopover(null);
  };

  const handleDismiss = (errorIndex: number) => {
    const error = errors[errorIndex];
    if (error) onRemoveError(error.word);
    setPopover(null);
  };

  const currentError = popover !== null ? errors[popover.errorIndex] : null;

  return (
    <div
      ref={containerRef}
      className="min-h-[300px] mb-4 p-3 bg-background border rounded-md text-right overflow-y-auto max-h-[600px] relative"
      dir="rtl"
    >
      <pre className="whitespace-pre-wrap font-mono text-base leading-relaxed">
        {segments.map((seg, i) => {
          if (seg.type === 'error' && seg.errorIndex !== undefined) {
            return (
              <span
                key={i}
                className="relative cursor-pointer border-b-2 border-destructive border-dashed bg-destructive/10 rounded-sm px-0.5 hover:bg-destructive/20 transition-colors"
                onClick={(e) => handleErrorClick(e, seg.errorIndex!)}
                title="לחץ לתיקון"
              >
                {seg.content}
              </span>
            );
          }
          return <span key={i}>{seg.content}</span>;
        })}
      </pre>

      {/* Correction Popover */}
      {popover && currentError && (
        <div
          ref={popoverRef}
          className="absolute z-50 bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[200px] max-w-[300px]"
          style={{
            left: `${popover.x}px`,
            top: `${popover.y}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-xs text-muted-foreground mb-2">{currentError.reason}</p>
          <p className="text-sm font-medium mb-2 text-destructive line-through">{currentError.word}</p>
          <div className="space-y-1">
            {currentError.suggestions.map((suggestion, si) => (
              <button
                key={si}
                onClick={() => handleSelectSuggestion(popover.errorIndex, suggestion)}
                className="w-full text-right px-3 py-1.5 rounded-md text-sm font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <button
            onClick={() => handleDismiss(popover.errorIndex)}
            className="w-full mt-2 text-center text-xs text-muted-foreground hover:text-foreground py-1"
          >
            התעלם
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded border-b-2 border-destructive border-dashed bg-destructive/10" />
          שגיאת כתיב — לחץ לתיקון
        </span>
        <span className="mr-auto">{errors.length} שגיאות</span>
      </div>
    </div>
  );
};
