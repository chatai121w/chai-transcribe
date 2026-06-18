import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import DOMPurify from "dompurify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { 
  Copy, Scissors, FileDown, 
  Bold, Italic, Underline, Strikethrough,
  Highlighter, Undo, Redo, Type, 
  AlignRight, AlignCenter, AlignLeft, AlignJustify, 
  Palette, List, ListOrdered, Eraser,
  Maximize2, Minimize2, SplitSquareVertical, Eye,
  Search, X, ChevronDown, SpellCheck, Save, Trash2
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { FloatingFormatToolbar } from "@/components/FloatingFormatToolbar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { spellCheckText, type SuspectWord, type SpellSuggestion } from "@/utils/hebrewSpellCheck";
import { learnFromCorrections, type CorrectionEntry } from "@/utils/correctionLearning";

interface RichTextEditorProps {
  text: string;
  onChange: (text: string) => void;
  columnStyle?: React.CSSProperties;
  onWordCorrected?: (original: string, corrected: string) => void;
  onSaveReplaceOriginal?: () => Promise<void> | void;
  onDuplicateSave?: () => Promise<void> | void;
}

const sanitize = (html: string): string => DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ['b', 'i', 'u', 's', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'mark', 'font', 'strong', 'em'],
  ALLOWED_ATTR: ['style', 'color', 'size', 'face', 'dir', 'class', 'data-spell-word'],
});

const prepareHtml = (text: string): string => {
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return sanitize(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
};

const stripHtml = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = sanitize(html);
  return div.innerText || '';
};

type ViewMode = 'edit' | 'preview' | 'split';

export const RichTextEditor = memo(({ text, onChange, columnStyle, onWordCorrected, onSaveReplaceOriginal, onDuplicateSave }: RichTextEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [textColor, setTextColor] = useState("#000000");
  const [fontSize, setFontSize] = useState("16");
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [htmlContent, setHtmlContent] = useState(() => sanitize(prepareHtml(text)));
  const isInternalUpdate = useRef(false);

  // Spell check state
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(false);
  const [suspectWords, setSuspectWords] = useState<SuspectWord[]>([]);
  const [spellPopup, setSpellPopup] = useState<{
    word: string;
    suggestions: SpellSuggestion[];
    rect: DOMRect;
    spanEl: HTMLElement;
  } | null>(null);
  const [customCorrection, setCustomCorrection] = useState("");
  const spellCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightColors = [
    "#ffff00", "#00ff00", "#00ffff", "#ff00ff", "#ffa500", "#ff0000",
  ];

  const textColors = [
    "#000000", "#ffffff", "#ff0000", "#0000ff", "#008000", "#800080", "#ff8c00", "#808080",
  ];

  // Sync external text changes (from parent / AI / version restore)
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const newHtml = sanitize(prepareHtml(text));
    setHtmlContent(newHtml);
    if (editorRef.current && editorRef.current.innerHTML !== newHtml) {
      editorRef.current.innerHTML = newHtml;
    }
  }, [text]);

  const syncRafRef = useRef<number | null>(null);

  const syncContent = useCallback(() => {
    if (syncRafRef.current) cancelAnimationFrame(syncRafRef.current);
    syncRafRef.current = requestAnimationFrame(() => {
      if (editorRef.current) {
        const html = editorRef.current.innerHTML;
        setHtmlContent(html);
        isInternalUpdate.current = true;
        onChange(stripHtml(html));
      }
    });
  }, [onChange]);

  const execCommand = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncContent();
  }, [syncContent]);

  const getHtmlForExport = () => {
    return editorRef.current?.innerHTML || htmlContent;
  };

  const handleCopy = () => {
    const sel = window.getSelection();
    const selectedText = sel?.toString() || '';
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
      toast({ title: "הועתק", description: "הטקסט הנבחר הועתק ללוח" });
    } else {
      navigator.clipboard.writeText(stripHtml(htmlContent));
      toast({ title: "הועתק", description: "כל הטקסט הועתק ללוח" });
    }
  };

  const handleCut = () => {
    const sel = window.getSelection();
    if (sel && sel.toString()) {
      navigator.clipboard.writeText(sel.toString());
      execCommand('delete');
      toast({ title: "נגזר", description: "הטקסט הנבחר נגזר" });
    }
  };

  const handleClearFormatting = () => {
    execCommand('removeFormat');
    toast({ title: "עיצוב נוקה", description: "העיצוב הוסר מהטקסט הנבחר" });
  };

  const handleSearch = () => {
    if (!searchTerm || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel) return;
    
    const textContent = editorRef.current.textContent || '';
    const idx = textContent.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) {
      toast({ title: "לא נמצא", description: `"${searchTerm}" לא נמצא בטקסט` });
      return;
    }

    // Use window.find for highlight
    (window as any).find?.(searchTerm, false, false, true);
  };

  const plainText = useMemo(() => stripHtml(htmlContent), [htmlContent]);

  const stats = useMemo(() => ({
    chars: plainText.length,
    words: plainText.split(/\s+/).filter(w => w).length,
    lines: plainText.split('\n').length,
  }), [plainText]);

  // ── Spell Check Logic ──

  const runSpellCheck = useCallback(() => {
    if (!spellCheckEnabled || !editorRef.current) return;
    const plain = editorRef.current.textContent || '';
    const suspects = spellCheckText(plain);
    setSuspectWords(suspects);
    applySpellCheckMarks(suspects);
  }, [spellCheckEnabled]);

  const applySpellCheckMarks = useCallback((suspects: SuspectWord[]) => {
    const editor = editorRef.current;
    if (!editor) return;

    // Remove existing spell marks
    clearSpellCheckMarks();

    if (suspects.length === 0) return;

    // Build a Set of suspect words for quick lookup
    const suspectMap = new Map<string, SpellSuggestion[]>();
    for (const s of suspects) {
      const clean = s.word.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
      if (clean) suspectMap.set(clean, s.suggestions);
    }

    // Walk text nodes and wrap suspect words
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const nodeText = textNode.textContent || '';
      if (!nodeText.trim()) continue;

      // Skip if parent is already a spell-error span
      if ((textNode.parentElement as HTMLElement)?.classList?.contains('spell-error')) continue;

      const wordRegex = /\S+/g;
      let match: RegExpExecArray | null;
      const fragments: (string | HTMLElement)[] = [];
      let lastIndex = 0;
      let hasMatch = false;

      while ((match = wordRegex.exec(nodeText)) !== null) {
        const raw = match[0];
        const clean = raw.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
        if (suspectMap.has(clean)) {
          hasMatch = true;
          // Add text before this word
          if (match.index > lastIndex) {
            fragments.push(nodeText.slice(lastIndex, match.index));
          }
          // Create spell-error span
          const span = document.createElement('span');
          span.className = 'spell-error';
          span.setAttribute('data-spell-word', clean);
          span.textContent = raw;
          span.style.textDecoration = 'underline wavy red';
          span.style.textDecorationSkipInk = 'none';
          span.style.textUnderlineOffset = '3px';
          span.style.cursor = 'pointer';
          fragments.push(span);
          lastIndex = match.index + raw.length;
        }
      }

      if (hasMatch) {
        // Add remaining text
        if (lastIndex < nodeText.length) {
          fragments.push(nodeText.slice(lastIndex));
        }
        // Replace the text node with fragments
        const parent = textNode.parentNode;
        if (parent) {
          for (const frag of fragments) {
            if (typeof frag === 'string') {
              parent.insertBefore(document.createTextNode(frag), textNode);
            } else {
              parent.insertBefore(frag, textNode);
            }
          }
          parent.removeChild(textNode);
        }
      }
    }
  }, []);

  const clearSpellCheckMarks = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const marks = editor.querySelectorAll('.spell-error');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        const textNode = document.createTextNode(mark.textContent || '');
        parent.replaceChild(textNode, mark);
        parent.normalize(); // merge adjacent text nodes
      }
    });
  }, []);

  // Trigger spell-check when enabled or text changes
  useEffect(() => {
    if (!spellCheckEnabled) {
      clearSpellCheckMarks();
      setSuspectWords([]);
      setSpellPopup(null);
      return;
    }
    if (spellCheckTimerRef.current) clearTimeout(spellCheckTimerRef.current);
    spellCheckTimerRef.current = setTimeout(runSpellCheck, 1500);
    return () => { if (spellCheckTimerRef.current) clearTimeout(spellCheckTimerRef.current); };
  }, [spellCheckEnabled, plainText, runSpellCheck, clearSpellCheckMarks]);

  // Handle click on spell-error spans
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !spellCheckEnabled) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains('spell-error')) {
        e.preventDefault();
        e.stopPropagation();
        const word = target.getAttribute('data-spell-word') || target.textContent || '';
        const rect = target.getBoundingClientRect();
        
        // Find suggestions for this word
        const suspect = suspectWords.find(s => {
          const clean = s.word.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
          return clean === word;
        });

        setCustomCorrection(word);
        setSpellPopup({
          word,
          suggestions: suspect?.suggestions || [],
          rect,
          spanEl: target,
        });
      }
    };

    editor.addEventListener('click', handleClick);
    return () => editor.removeEventListener('click', handleClick);
  }, [spellCheckEnabled, suspectWords]);

  // Close popup when clicking outside
  useEffect(() => {
    if (!spellPopup) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const popup = document.getElementById('spell-popup');
      if (popup && !popup.contains(e.target as Node)) {
        setSpellPopup(null);
      }
    };
    setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [spellPopup]);

  const handleSpellCorrection = useCallback((originalWord: string, correctedWord: string, spanEl: HTMLElement) => {
    // Replace in DOM
    const textNode = document.createTextNode(correctedWord);
    spanEl.parentNode?.replaceChild(textNode, spanEl);
    textNode.parentNode?.normalize();

    // Sync content
    syncContent();

    // Save correction to learning system
    const entry: CorrectionEntry = {
      original: originalWord,
      corrected: correctedWord,
      frequency: 1,
      engine: 'spell-check',
      category: 'word',
      confidence: 0.7,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    learnFromCorrections([entry]);
    onWordCorrected?.(originalWord, correctedWord);

    setSpellPopup(null);
    toast({ title: "תוקן ✅", description: `"${originalWord}" → "${correctedWord}"` });

    // Re-run spell check after correction
    if (spellCheckTimerRef.current) clearTimeout(spellCheckTimerRef.current);
    spellCheckTimerRef.current = setTimeout(runSpellCheck, 500);
  }, [syncContent, onWordCorrected, runSpellCheck]);

  const handleExportTXT = () => {
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edited-transcript-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "ייצוא הצליח", description: "הקובץ הורד בהצלחה" });
  };

  const handleExportDOCX = () => {
    const richHtml = getHtmlForExport();
    const htmlDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>@page{direction:rtl}body{font-family:Arial,sans-serif;direction:rtl;unicode-bidi:embed;line-height:1.8;}</style>
</head><body dir="rtl"><div style="font-family:Arial;">${richHtml}</div></body></html>`;
    const blob = new Blob(['\ufeff' + htmlDoc], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edited-transcript-${Date.now()}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "ייצוא הצליח", description: "קובץ Word הורד" });
  };

  const handleExportPDF = () => {
    const richHtml = getHtmlForExport();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: "שגיאה", description: "יש לאפשר חלונות קופצים ליצוא PDF", variant: "destructive" });
      return;
    }
    printWindow.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>ייצוא PDF</title><style>body{font-family:Arial,sans-serif;direction:rtl;padding:40px;line-height:1.8}@media print{body{padding:20px}}</style></head><body>${richHtml}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExportSRT = () => {
    const words = plainText.split(/\s+/).filter(w => w);
    const segmentSize = 10;
    let srtContent = '';
    for (let i = 0; i < words.length; i += segmentSize) {
      const seg = words.slice(i, i + segmentSize).join(' ');
      const idx = Math.floor(i / segmentSize);
      const startSec = idx * 5;
      const endSec = (idx + 1) * 5;
      const fmt = (s: number) => {
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sc = String(s % 60).padStart(2, '0');
        return `${h}:${m}:${sc},000`;
      };
      srtContent += `${idx + 1}\n${fmt(startSec)} --> ${fmt(endSec)}\n${seg}\n\n`;
    }
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${Date.now()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "ייצוא הצליח", description: "קובץ SRT (כתוביות) הורד" });
  };

  const ToolBtn = ({ icon: Icon, label, onClick, active, disabled }: {
    icon: React.ElementType; label: string; onClick: () => void; active?: boolean; disabled?: boolean;
  }) => (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={onClick}
            disabled={disabled}
            className={cn("h-8 w-8 p-0", active && "bg-accent ring-1 ring-primary/30")}
          >
            <Icon className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const cardClass = cn(
    "p-4 transition-all duration-300",
    isFullscreen && "fixed inset-0 z-50 rounded-none overflow-auto bg-background"
  );

  return (
    <Card className={cardClass} dir="rtl">
      <div className="space-y-3">

        {/* === שורת כלים ראשית === */}
        <div className="flex flex-wrap items-center gap-1 pb-3 border-b">

          {/* Undo / Redo */}
          <ToolBtn icon={Undo} label="ביטול (Ctrl+Z)" onClick={() => execCommand('undo')} />
          <ToolBtn icon={Redo} label="ביצוע מחדש (Ctrl+Y)" onClick={() => execCommand('redo')} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* === כפתור T – עיצוב טקסט === */}
          <Popover open={showFormatBar} onOpenChange={setShowFormatBar}>
            <PopoverTrigger asChild>
              <Button
                variant={showFormatBar ? "secondary" : "outline"}
                size="sm"
                className="gap-1 font-bold text-base px-2"
                title="עיצוב טקסט"
              >
                T
                <ChevronDown className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" dir="rtl" align="start">
              <div className="space-y-3">
                {/* Bold / Italic / Underline / Strikethrough */}
                <div className="flex items-center gap-1">
                  <ToolBtn icon={Bold} label="מודגש" onClick={() => execCommand('bold')} />
                  <ToolBtn icon={Italic} label="נטוי" onClick={() => execCommand('italic')} />
                  <ToolBtn icon={Underline} label="קו תחתון" onClick={() => execCommand('underline')} />
                  <ToolBtn icon={Strikethrough} label="קו חוצה" onClick={() => execCommand('strikeThrough')} />
                  <Separator orientation="vertical" className="h-6 mx-1" />
                  <ToolBtn icon={Eraser} label="נקה עיצוב" onClick={handleClearFormatting} />
                </div>

                {/* גודל פונט */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">גודל:</Label>
                  <select
                    className="h-7 rounded border bg-background px-2 text-xs"
                    value={fontSize}
                    onChange={(e) => {
                      setFontSize(e.target.value);
                      execCommand('fontSize', '7');
                      // Replace font size 7 with actual px
                      if (editorRef.current) {
                        const fonts = editorRef.current.querySelectorAll('font[size="7"]');
                        fonts.forEach(el => {
                          (el as HTMLElement).removeAttribute('size');
                          (el as HTMLElement).style.fontSize = e.target.value + 'px';
                        });
                        syncContent();
                      }
                    }}
                  >
                    {[12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map(s => (
                      <option key={s} value={s}>{s}px</option>
                    ))}
                  </select>
                </div>

                {/* סוג גופן */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">גופן:</Label>
                  <select
                    className="h-7 rounded border bg-background px-2 text-xs min-w-[100px]"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        execCommand('fontName', e.target.value);
                      }
                    }}
                  >
                    <option value="" disabled>בחר גופן</option>
                    {[
                      { value: 'Arial', label: 'Arial' },
                      { value: 'David', label: 'David' },
                      { value: 'Times New Roman', label: 'Times New Roman' },
                      { value: 'Courier New', label: 'Courier New' },
                      { value: 'Georgia', label: 'Georgia' },
                      { value: 'Tahoma', label: 'Tahoma' },
                      { value: 'Verdana', label: 'Verdana' },
                      { value: 'Frank Ruhl Libre', label: 'Frank Ruhl Libre' },
                      { value: 'Miriam', label: 'Miriam' },
                      { value: 'Narkisim', label: 'Narkisim' },
                    ].map(f => (
                      <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                    ))}
                  </select>
                </div>

                {/* צבע טקסט */}
                <div className="space-y-1">
                  <Label className="text-xs">צבע טקסט:</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {textColors.map(c => (
                      <button
                        key={c}
                        onClick={() => { setTextColor(c); execCommand('foreColor', c); }}
                        className={cn(
                          "w-6 h-6 rounded border-2 hover:scale-110 transition-transform",
                          textColor === c ? "border-primary ring-1 ring-primary" : "border-border"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => { setTextColor(e.target.value); execCommand('foreColor', e.target.value); }}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                      title="צבע מותאם"
                    />
                  </div>
                </div>

                {/* הדגשה (highlight) */}
                <div className="space-y-1">
                  <Label className="text-xs">צבע הדגשה:</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {highlightColors.map(c => (
                      <button
                        key={c}
                        onClick={() => execCommand('hiliteColor', c)}
                        className="w-6 h-6 rounded border-2 border-border hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* רשימות */}
                <div className="flex items-center gap-1">
                  <ToolBtn icon={List} label="רשימה" onClick={() => execCommand('insertUnorderedList')} />
                  <ToolBtn icon={ListOrdered} label="רשימה ממוספרת" onClick={() => execCommand('insertOrderedList')} />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* === יישור === */}
          <ToolBtn icon={AlignRight} label="יישור לימין" onClick={() => execCommand('justifyRight')} />
          <ToolBtn icon={AlignCenter} label="מרכוז" onClick={() => execCommand('justifyCenter')} />
          <ToolBtn icon={AlignLeft} label="יישור לשמאל" onClick={() => execCommand('justifyLeft')} />
          <ToolBtn icon={AlignJustify} label="יישור לשני הצדדים" onClick={() => execCommand('justifyFull')} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* העתק / גזור / מחק */}
          <ToolBtn icon={Copy} label="העתק" onClick={handleCopy} />
          <ToolBtn icon={Scissors} label="גזור" onClick={handleCut} />
          <ToolBtn icon={Trash2} label="מחק נבחר" onClick={() => execCommand('delete')} />
          <ToolBtn icon={Eraser} label="נקה הכל" onClick={() => {
            if (editorRef.current) {
              editorRef.current.innerHTML = '';
              syncContent();
              toast({ title: 'הטקסט נוקה' });
            }
          }} />

          {(onSaveReplaceOriginal || onDuplicateSave) && (
            <>
              <Separator orientation="vertical" className="h-6 mx-1" />
              {onSaveReplaceOriginal && (
                <ToolBtn
                  icon={Save}
                  label="שמור והחלף מקור"
                  onClick={() => { void onSaveReplaceOriginal(); }}
                />
              )}
              {onDuplicateSave && (
                <ToolBtn
                  icon={Copy}
                  label="שכפל ושמור"
                  onClick={() => { void onDuplicateSave(); }}
                />
              )}
            </>
          )}

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* תצוגה */}
          <ToolBtn
            icon={Type}
            label="עריכה"
            onClick={() => setViewMode('edit')}
            active={viewMode === 'edit'}
          />
          <ToolBtn
            icon={Eye}
            label="תצוגה מקדימה"
            onClick={() => setViewMode('preview')}
            active={viewMode === 'preview'}
          />
          <ToolBtn
            icon={SplitSquareVertical}
            label="תצוגה מפוצלת"
            onClick={() => setViewMode('split')}
            active={viewMode === 'split'}
          />
          <ToolBtn
            icon={isFullscreen ? Minimize2 : Maximize2}
            label={isFullscreen ? "יציאה ממסך מלא" : "מסך מלא"}
            onClick={() => setIsFullscreen(f => !f)}
          />

          {/* חיפוש */}
          <ToolBtn icon={Search} label="חיפוש" onClick={() => setSearchOpen(o => !o)} active={searchOpen} />

          {/* בדיקת איות */}
          <ToolBtn
            icon={SpellCheck}
            label={spellCheckEnabled ? `בדיקת איות (${suspectWords.length} חשודים)` : "בדיקת איות"}
            onClick={() => setSpellCheckEnabled(v => !v)}
            active={spellCheckEnabled}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* ייצוא */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 text-xs">
                <FileDown className="w-4 h-4" />
                ייצא
                <ChevronDown className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" dir="rtl">
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={handleExportTXT} className="justify-start">TXT</Button>
                <Button variant="ghost" size="sm" onClick={handleExportDOCX} className="justify-start">DOC (Word)</Button>
                <Button variant="ghost" size="sm" onClick={handleExportPDF} className="justify-start">PDF</Button>
                <Button variant="ghost" size="sm" onClick={handleExportSRT} className="justify-start">SRT (כתוביות)</Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* === חיפוש === */}
        {searchOpen && (
          <div className="flex items-center gap-2 pb-2 border-b">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="חפש בטקסט..."
              className="h-8 text-sm max-w-xs"
              dir="rtl"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="ghost" size="sm" onClick={handleSearch} className="h-8">
              <Search className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSearchOpen(false); setSearchTerm(""); }} className="h-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* === אזור עריכה === */}
        <div className={cn(
          "grid gap-4",
          viewMode === 'split' ? "grid-cols-2" : "grid-cols-1"
        )}>
          {/* Editor */}
          {(viewMode === 'edit' || viewMode === 'split') && (
            <div className="space-y-1">
              {viewMode === 'split' && (
                <Label className="text-xs text-muted-foreground">עריכה</Label>
              )}
              <div className="relative">
                <FloatingFormatToolbar
                  containerRef={editorRef}
                  onExecCommand={execCommand}
                  onSyncContent={syncContent}
                />
                <div
                  ref={editorRef}
                  contentEditable
                  dir="rtl"
                  className={cn(
                    "rounded-md border border-input bg-background px-4 py-3 text-right",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    "overflow-auto prose prose-sm max-w-none",
                    isFullscreen ? "min-h-[calc(100vh-200px)]" : "min-h-[500px]"
                  )}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: '1.8',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    ...columnStyle,
                  }}
                  onInput={syncContent}
                  suppressContentEditableWarning
                />
              </div>
            </div>
          )}

          {/* Preview */}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className="space-y-1">
              {viewMode === 'split' && (
                <Label className="text-xs text-muted-foreground">תצוגה מקדימה</Label>
              )}
              <div
                dir="rtl"
                className={cn(
                  "rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-right",
                  "overflow-auto prose prose-sm max-w-none",
                  isFullscreen ? "min-h-[calc(100vh-200px)]" : "min-h-[500px]"
                )}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: '1.8',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  ...columnStyle,
                }}
                dangerouslySetInnerHTML={{ __html: sanitize(htmlContent) }}
              />
            </div>
          )}
        </div>

        {/* === Spell Check Popup === */}
        {spellPopup && (
          <div
            id="spell-popup"
            className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[240px] max-w-[320px]"
            dir="rtl"
            style={{
              top: spellPopup.rect.bottom + 8,
              left: Math.min(spellPopup.rect.left, window.innerWidth - 340),
            }}
          >
            <div className="space-y-2">
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-destructive" style={{ textDecoration: 'line-through' }}>
                  {spellPopup.word}
                </span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSpellPopup(null)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>

              {/* Suggestions */}
              {spellPopup.suggestions.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">הצעות:</Label>
                  <div className="flex flex-wrap gap-1">
                    {spellPopup.suggestions.map((s, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleSpellCorrection(spellPopup.word, s.text, spellPopup.spanEl)}
                      >
                        {s.text}
                        {s.source === 'learned' && <span className="mr-1 text-[10px] opacity-60">🧠</span>}
                        {s.source === 'vocabulary' && <span className="mr-1 text-[10px] opacity-60">📖</span>}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom correction input */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">תיקון ידני:</Label>
                <div className="flex gap-1">
                  <Input
                    value={customCorrection}
                    onChange={(e) => setCustomCorrection(e.target.value)}
                    className="h-7 text-sm flex-1"
                    dir="rtl"
                    placeholder="הקלד תיקון..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customCorrection.trim() && spellPopup) {
                        handleSpellCorrection(spellPopup.word, customCorrection.trim(), spellPopup.spanEl);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!customCorrection.trim() || customCorrection.trim() === spellPopup.word}
                    onClick={() => {
                      if (customCorrection.trim() && spellPopup) {
                        handleSpellCorrection(spellPopup.word, customCorrection.trim(), spellPopup.spanEl);
                      }
                    }}
                  >
                    תקן
                  </Button>
                </div>
              </div>

              {/* Ignore button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-6 text-xs text-muted-foreground"
                onClick={() => {
                  // Remove this specific mark
                  const textNode = document.createTextNode(spellPopup.spanEl.textContent || '');
                  spellPopup.spanEl.parentNode?.replaceChild(textNode, spellPopup.spanEl);
                  textNode.parentNode?.normalize();
                  setSpellPopup(null);
                }}
              >
                התעלם
              </Button>
            </div>
          </div>
        )}

        {/* Spell check status bar */}
        {spellCheckEnabled && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-3 py-1.5 bg-muted/30">
            <SpellCheck className="w-3.5 h-3.5" />
            <span>בדיקת איות פעילה</span>
            {suspectWords.length > 0 ? (
              <span className="text-destructive font-medium">{suspectWords.length} מילים חשודות</span>
            ) : (
              <span className="text-green-600">לא נמצאו שגיאות</span>
            )}
            <span className="opacity-50">•</span>
            <span className="opacity-60">לחץ על מילה אדומה לתיקון</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-right">
          סמן טקסט ולחץ <strong>T</strong> לעיצוב • יישור • תצוגה מפוצלת
        </p>

        {/* === סטטיסטיקות === */}
        <div className="flex gap-4 text-xs text-muted-foreground border-t pt-3">
          <span>תווים: {stats.chars}</span>
          <span>מילים: {stats.words}</span>
          <span>שורות: {stats.lines}</span>
        </div>
      </div>
    </Card>
  );
});
