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

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
  ReplaceAll,
  Trash2,
  Wand2,
  XCircle,
  BookPlus,
  Anchor,
  GripHorizontal,
  Minus,
  Maximize2,
  Minimize2,
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
import { uniqueWordSuggestions } from '@/lib/wordSuggestions';

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
  /** Replaces every exact occurrence in the current editable text. */
  onReplaceAll?: (newWord: string) => void;
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
  onReplaceAll,
  onApproveAsCorrect,
  isAnchor = false,
  onToggleAnchor,
  children,
}: WordContextMenuProps) => {
  const [customInput, setCustomInput] = useState(word);
  const [replaceAllInput, setReplaceAllInput] = useState(word);
  const [verifyInput, setVerifyInput] = useState('');
  // The synced transcript wraps every word in one of these — over eleven
  // thousand of them on a long recording. The menu body is around fifty
  // elements, so building it for words nobody has right-clicked meant
  // constructing roughly half a million React elements on every render, which
  // measured at ~2.2s per render and made playback impossible. Nothing below
  // the trigger is built until the menu is actually opened.
  const [open, setOpen] = useState(false);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // A single instance now serves every word, so the inputs must follow the word
  // the menu was opened on rather than keeping the first one they ever saw.
  useEffect(() => {
    setCustomInput(word);
    setReplaceAllInput(word);
    setVerifyInput('');
  }, [word]);

  useEffect(() => {
    if (!open || !word) return;
    const timeoutId = window.setTimeout(() => {
      quickInputRef.current?.focus();
      quickInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [open, word]);

  const similar = useMemo(() => (open ? getSimilarWords(word, 8) : []), [word, open]);
  const uniqueSuggestions = useMemo(
    () => (open ? uniqueWordSuggestions(suggestions, word) : []),
    [suggestions, word, open],
  );
  const currentHighlight = useMemo(() => (open ? getWordHighlight(word) : undefined), [word, open]);
  const approved = open ? isWordApproved(word) : false;

  const handleReplace = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === word) return;
    onReplace(trimmed);
  };

  const applyQuickEdit = () => {
    const edited = customInput.trim();
    if (!edited || edited === word) return;
    onReplace(edited);
    setOpen(false);
  };

  const applyEverywhere = () => {
    const edited = replaceAllInput.trim();
    if (!onReplaceAll || !edited || edited === word) return;
    onReplaceAll(edited);
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

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || expanded) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const baseLeft = rect.left - panelOffset.x;
    const baseTop = rect.top - panelOffset.y;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panelOffset.x,
      originY: panelOffset.y,
      minX: 8 - baseLeft,
      maxX: window.innerWidth - 8 - baseLeft - rect.width,
      minY: 8 - baseTop,
      maxY: window.innerHeight - 8 - baseTop - rect.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPanelOffset({
      x: Math.min(drag.maxX, Math.max(drag.minX, drag.originX + event.clientX - drag.startX)),
      y: Math.min(drag.maxY, Math.max(drag.minY, drag.originY + event.clientY - drag.startY)),
    });
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <ContextMenu
      modal={false}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {open && word && (
      <ContextMenuContent
        ref={panelRef}
        dir="rtl"
        data-testid="floating-word-correction"
        className="z-[100] p-0 text-right pointer-events-auto"
        style={{
          width: expanded ? 'min(36rem, calc(100vw - 2rem))' : '20rem',
          height: expanded ? 'min(42rem, calc(100vh - 2rem))' : undefined,
          minWidth: minimized ? '16rem' : '18rem',
          minHeight: minimized ? undefined : '11rem',
          maxWidth: 'calc(100vw - 1rem)',
          maxHeight: 'calc(100vh - 1rem)',
          resize: minimized || expanded ? 'none' : 'both',
          overflow: minimized ? 'hidden' : 'auto',
          translate: `${panelOffset.x}px ${panelOffset.y}px`,
        }}
      >
        <div
          className="flex h-8 cursor-move select-none items-center gap-1 border-b bg-muted/50 px-1.5"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          data-testid="word-correction-drag-handle"
        >
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {minimized ? `תיקון: ${word}` : 'תיקון מילה'}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMinimized((value) => !value)}
            aria-label={minimized ? 'שחזר חלון תיקון' : 'מזער חלון תיקון'}
            title={minimized ? 'שחזר' : 'מזער'}
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={minimized}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'החזר לגודל רגיל' : 'הגדל חלון תיקון'}
            title={expanded ? 'גודל רגיל' : 'הגדל'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {!minimized && <div className="p-1">
        <div className="flex items-center gap-1.5 p-1.5" dir="rtl">
          <Input
            ref={quickInputRef}
            value={customInput}
            onChange={(event) => setCustomInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                applyQuickEdit();
              }
            }}
            aria-label="תיקון מהיר"
            className="h-9 flex-1 text-right text-sm"
            dir="rtl"
          />
          {isCorrectionVerified(word, word) && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="מילה מאומתת" />
          )}
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={!customInput.trim() || customInput.trim() === word}
            onMouseDown={(event) => event.preventDefault()}
            onClick={applyQuickEdit}
            aria-label="אשר תיקון"
            title="אשר תיקון"
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
        <ContextMenuSeparator />

        {/* Similar words are the primary correction path. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-xs text-right">
            <Languages className="w-3.5 h-3.5 text-blue-500" />
            מילים דומות
          </ContextMenuSubTrigger>
          <ContextMenuSubContent dir="rtl" className="w-56 text-right">
            {similar.length === 0 ? (
              <ContextMenuItem disabled className="text-xs text-muted-foreground text-right">
                אין הצעות
              </ContextMenuItem>
            ) : (
              similar.map((s) => (
                <ContextMenuItem key={s} className="text-xs text-right" onSelect={() => handleReplace(s)}>
                  {s}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {onReplaceAll && (
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs text-right">
              <ReplaceAll className="h-3.5 w-3.5 text-emerald-600" />
              תקן בכל הטקסט
            </ContextMenuSubTrigger>
            <ContextMenuSubContent dir="rtl" className="w-72 p-2 text-right">
              <p className="mb-1.5 text-[10px] text-muted-foreground">
                כל המופעים המדויקים של "{word}" יוחלפו בטקסט הנוכחי.
              </p>
              <Input
                value={replaceAllInput}
                onChange={(event) => setReplaceAllInput(event.target.value)}
                className="h-8 text-sm text-right"
                dir="rtl"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') event.stopPropagation();
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    applyEverywhere();
                  }
                }}
              />
              <ContextMenuItem
                className="mt-2 justify-center gap-2 bg-primary text-xs text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground"
                disabled={!replaceAllInput.trim() || replaceAllInput.trim() === word}
                onSelect={applyEverywhere}
              >
                <ReplaceAll className="h-3.5 w-3.5" />
                החלף הכל
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem className="gap-2 text-xs text-destructive" onSelect={() => onReplace('__DELETE__')}>
          <Trash2 className="h-3.5 w-3.5" />
          מחק מילה
        </ContextMenuItem>

        {/* ─── Suggestions (from spell + AI) ─── */}
        {uniqueSuggestions.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs">
              <Wand2 className="w-3.5 h-3.5 text-primary" />
              הצעות תיקון ({uniqueSuggestions.length})
            </ContextMenuSubTrigger>
            <ContextMenuSubContent dir="rtl" className="w-56 text-right">
              {uniqueSuggestions.map((s, i) => (
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
          <ContextMenuSubContent dir="rtl" className="w-64 p-2 text-right">
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
                  // Radix Menu uses printable keys for item typeahead. Keep
                  // typing inside the input so focus does not jump to a menu item.
                  if (e.key !== 'Escape') e.stopPropagation();
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && verifyInput.trim()) {
                    e.preventDefault();
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
          <ContextMenuSubContent dir="rtl" className="w-48 text-right">
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

        </div>}
      </ContextMenuContent>
      )}
    </ContextMenu>
  );
};
