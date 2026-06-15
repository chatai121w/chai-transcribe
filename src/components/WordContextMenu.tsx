/**
 * WordContextMenu — right-click menu for a single word in the transcript.
 *
 * Wraps any word span with a shadcn ContextMenu offering:
 *   - Apply suggestions (built-in spell + AI suggestions passed from parent)
 *   - Similar words (phonetic neighbors, generated client-side)
 *   - Save to dictionary  (custom vocabulary)
 *   - Save to AI learning (verifyCorrection — needs a target word; user is
 *     prompted via inline input when used)
 *   - Approve as correct  (suppress future warnings on this word)
 *   - Highlight color picker
 *   - Forget / clear highlight
 *
 * The component is render-prop style: it accepts `children` (the word span)
 * and exposes the menu through `<ContextMenuTrigger asChild>`.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Brain,
  Check,
  CheckCircle2,
  Highlighter,
  Languages,
  Palette,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
  BookPlus,
  Anchor,
} from 'lucide-react';
import { addTerm } from '@/utils/customVocabulary';
import {
  approveWord,
  clearWordHighlight,
  getSimilarWords,
  getWordHighlight,
  isCorrectionVerified,
  isWordApproved,
  setWordHighlight,
  unapproveWord,
  verifyCorrection,
  WORD_HIGHLIGHT_PALETTE,
  type WordHighlightColor,
} from '@/lib/personalPronunciationModel';
import { toast } from '@/hooks/use-toast';

export interface WordContextMenuProps {
  /** The displayed word (with punctuation). */
  word: string;
  /** Optional list of in-app suggestions (from spell-check / AI). */
  suggestions?: string[];
  /**
   * Called when the user picks a replacement (from suggestions, similar words,
   * or the inline custom input).
   */
  onReplace: (newWord: string) => void;
  /** Called when the user clicks "אשר כנכון". */
  onApproveAsCorrect?: () => void;
  /** Whether this word is currently marked as a timing anchor. */
  isAnchor?: boolean;
  /** Called when the user toggles anchor status. */
  onToggleAnchor?: () => void;
  /** The word span to wrap. */
  children: React.ReactNode;
}

export const WordContextMenu = ({
  word,
  suggestions = [],
  onReplace,
  onApproveAsCorrect,
  isAnchor = false,
  onToggleAnchor,
  children,
}: WordContextMenuProps) => {
  const [customInput, setCustomInput] = useState('');
  const [verifyInput, setVerifyInput] = useState('');

  const similar = useMemo(() => getSimilarWords(word, 8), [word]);
  const currentHighlight = useMemo(() => getWordHighlight(word), [word]);
  const approved = isWordApproved(word);

  const handleReplace = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === word) return;
    onReplace(trimmed);
  };

  const handleVerify = (corrected: string) => {
    const c = corrected.trim();
    if (!c) return;
    verifyCorrection(word, c);
    onReplace(c);
    toast({
      title: 'נשמר במודל ההגייה האישי',
      description: `${word} → ${c}  •  המנוע ילמד שזו ההגייה הנכונה`,
    });
  };

  const handleAddToDictionary = () => {
    const ok = addTerm(word, 'other');
    toast({
      title: ok ? 'נוסף למילון' : 'כבר קיים במילון',
      description: word,
    });
  };

  const handleApprove = () => {
    if (approved) {
      unapproveWord(word);
      toast({ title: 'הסר אישור', description: word });
    } else {
      approveWord(word);
      toast({ title: 'אושר כנכון', description: `${word} — לא יסומן כשגיאה בעתיד` });
      onApproveAsCorrect?.();
    }
  };

  const handleSetColor = (color: WordHighlightColor) => {
    setWordHighlight(word, color);
    toast({ title: 'הודגש', description: `${word} — ${color}` });
  };

  const handleClearColor = () => {
    clearWordHighlight(word);
    toast({ title: 'הוסרה הדגשה', description: word });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel className="text-xs flex items-center justify-between gap-2">
          <span className="truncate">{word}</span>
          {isCorrectionVerified(word, word) && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {/* ─── Suggestions (from spell + AI) ─── */}
        {suggestions.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs">
              <Wand2 className="w-3.5 h-3.5 text-primary" />
              הצעות תיקון ({suggestions.length})
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {suggestions.map((s, i) => (
                <ContextMenuItem
                  key={`${s}-${i}`}
                  className="text-xs"
                  onSelect={() => handleReplace(s)}
                >
                  {s}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* ─── Similar (phonetic neighbors) ─── */}
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-xs">
            <Languages className="w-3.5 h-3.5 text-blue-500" />
            מילים דומות
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            {similar.length === 0 ? (
              <ContextMenuItem disabled className="text-xs text-muted-foreground">
                אין הצעות
              </ContextMenuItem>
            ) : (
              similar.map((s) => (
                <ContextMenuItem key={s} className="text-xs" onSelect={() => handleReplace(s)}>
                  {s}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* ─── Save to dictionary ─── */}
        <ContextMenuItem className="gap-2 text-xs" onSelect={handleAddToDictionary}>
          <BookPlus className="w-3.5 h-3.5 text-amber-600" />
          הטמע למילון
        </ContextMenuItem>

        {/* ─── Save to AI learning (with corrected text) ─── */}
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-xs">
            <Brain className="w-3.5 h-3.5 text-purple-500" />
            הטמע ללמידת AI
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-64 p-2">
            <p className="text-[10px] text-muted-foreground mb-1.5">
              הקלד את ההגייה/האיות הנכון. המערכת תזכור ש-"{word}" צריך להיכתב כך:
            </p>
            <div className="flex gap-1.5">
              <Input
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                placeholder="ההגייה הנכונה"
                className="h-7 text-xs"
               
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && verifyInput.trim()) {
                    handleVerify(verifyInput);
                    setVerifyInput('');
                  }
                }}
              />
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (verifyInput.trim()) {
                    handleVerify(verifyInput);
                    setVerifyInput('');
                  }
                }}
              >
                שמור
              </Button>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* ─── Approve as correct ─── */}
        <ContextMenuItem className="gap-2 text-xs" onSelect={handleApprove}>
          {approved ? (
            <>
              <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
              בטל אישור
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              אשר כנכון (לא לסמן בעתיד)
            </>
          )}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* ─── Highlight color ─── */}
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-xs">
            <Highlighter className="w-3.5 h-3.5 text-yellow-500" />
            הדגשה / צבע
            {currentHighlight && (
              <span
                className="ml-auto inline-block w-3 h-3 rounded-sm border"
                style={{
                  backgroundColor:
                    WORD_HIGHLIGHT_PALETTE.find((p) => p.color === currentHighlight.color)?.cssBg,
                }}
              />
            )}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <div className="grid grid-cols-4 gap-1 p-1.5">
              {WORD_HIGHLIGHT_PALETTE.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  title={p.label}
                  className="h-7 rounded border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: p.cssBg }}
                  onClick={() => handleSetColor(p.color)}
                />
              ))}
            </div>
            {currentHighlight && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2 text-xs text-muted-foreground"
                  onSelect={handleClearColor}
                >
                  <Palette className="w-3.5 h-3.5" />
                  הסר הדגשה
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* ─── Timing anchor ─── */}
        {onToggleAnchor && (
          <ContextMenuItem
            className={cn(
              'gap-2 text-xs',
              isAnchor
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            )}
            onSelect={onToggleAnchor}
          >
            <Anchor className={cn('w-3.5 h-3.5', isAnchor ? 'text-amber-500' : '')} />
            {isAnchor ? 'הסר עוגן תזמון' : 'סמן כעוגן תזמון'}
            {isAnchor && (
              <span className="ms-auto text-[10px] opacity-60">נעול</span>
            )}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* ─── Inline custom replacement ─── */}
        <div className="p-1.5">
          <p className="text-[10px] text-muted-foreground mb-1">החלף ידנית:</p>
          <div className="flex gap-1.5">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder={word}
              className="h-7 text-xs"
             
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customInput.trim()) {
                  handleReplace(customInput);
                  setCustomInput('');
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                if (customInput.trim()) {
                  handleReplace(customInput);
                  setCustomInput('');
                }
              }}
            >
              <Sparkles className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </ContextMenuContent>
    </ContextMenu>
  );
};
