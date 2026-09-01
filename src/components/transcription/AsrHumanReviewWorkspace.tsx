import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Headphones, Pause, Play, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { classifyAsrEdit } from '@/lib/asrEvidence';
import {
  buildAsrReviewUnits,
  mergeAsrReviewSelection,
  reviewChoiceText,
  type AsrHumanReviewRecord,
  type AsrReviewChoice,
  type AsrReviewErrorType,
} from '@/lib/asrHumanReview';
import type { PipelineRunResult } from '@/lib/transcriptionPipeline';
import { cn } from '@/lib/utils';

interface AsrHumanReviewWorkspaceProps {
  experimentId: string;
  file: File;
  sourceText: string;
  baseline: PipelineRunResult;
  candidate: PipelineRunResult;
  onSaveReview: (review: AsrHumanReviewRecord) => Promise<void>;
  onApproveGold: (review: AsrHumanReviewRecord) => Promise<void>;
  onAddToLexicon: (wrong: string, correct: string) => Promise<void>;
}

const ERROR_TYPES: Array<{ value: AsrReviewErrorType; label: string }> = [
  { value: 'asr-word', label: 'שגיאת זיהוי קולי' },
  { value: 'torah-term', label: 'מונח תורני' },
  { value: 'aramaic', label: 'ארמית' },
  { value: 'name', label: 'שם תנא, אמורא או מפרש' },
  { value: 'punctuation', label: 'פיסוק' },
  { value: 'segmentation', label: 'חלוקה או יישור' },
  { value: 'editorial', label: 'עריכת ניסוח' },
  { value: 'other', label: 'אחר' },
];

const choiceLabel: Record<AsrReviewChoice, string> = {
  source: 'טקסט האמת נכון',
  baseline: 'מנוע A נכון',
  candidate: 'מנוע B נכון',
  custom: 'שניהם שגויים',
};

export function AsrHumanReviewWorkspace({
  experimentId,
  file,
  sourceText,
  baseline,
  candidate,
  onSaveReview,
  onApproveGold,
  onAddToLexicon,
}: AsrHumanReviewWorkspaceProps) {
  const units = useMemo(() => buildAsrReviewUnits(
    sourceText,
    baseline.text,
    candidate.text,
    baseline.wordTimings,
    candidate.wordTimings,
  ), [baseline.text, baseline.wordTimings, candidate.text, candidate.wordTimings, sourceText]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [choice, setChoice] = useState<AsrReviewChoice>('source');
  const [customText, setCustomText] = useState('');
  const [errorType, setErrorType] = useState<AsrReviewErrorType>('asr-word');
  const [notes, setNotes] = useState('');
  const [savedReview, setSavedReview] = useState<AsrHumanReviewRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const [audioUrl, setAudioUrl] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selection = useMemo(
    () => mergeAsrReviewSelection(units, selectedIds),
    [selectedIds, units],
  );
  const correctedText = reviewChoiceText(choice, selection, customText);
  const hasTiming = Number.isFinite(selection.start) && Number.isFinite(selection.end)
    && (selection.end as number) > (selection.start as number);

  useEffect(() => {
    setSavedReview(null);
    setCustomText('');
    setChoice('source');
  }, [selectedIds]);

  const selectUnit = (index: number, extend: boolean) => {
    const unit = units[index];
    if (!unit) return;
    if ((extend || selectedIds.length === 1) && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      setSelectedIds(units.slice(start, end + 1).map((item) => item.id));
      return;
    }
    setAnchorIndex(index);
    setSelectedIds([unit.id]);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setAnchorIndex(null);
    setSavedReview(null);
  };

  const playSelection = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (hasTiming) {
      audio.currentTime = Math.max(0, (selection.start as number) - 0.2);
      stopAtRef.current = (selection.end as number) + 0.25;
    } else {
      stopAtRef.current = null;
    }
    await audio.play();
    setPlaying(true);
  };

  const saveReview = async () => {
    if (!selectedIds.length || !correctedText.trim()) return;
    setSaving(true);
    const evidence = classifyAsrEdit({
      original: selection.candidateText,
      corrected: correctedText,
      start: selection.start,
      end: selection.end,
    });
    const review: AsrHumanReviewRecord = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      experimentId,
      unitIds: selection.unitIds,
      choice,
      correctedText: correctedText.trim(),
      sourceText: selection.sourceText,
      baselineText: selection.baselineText,
      candidateText: selection.candidateText,
      errorType,
      notes: notes.trim(),
      start: selection.start,
      end: selection.end,
      timingSource: selection.timingSource,
      baselineEngine: `${baseline.engineLabel}${baseline.model ? ` · ${baseline.model}` : ''}`,
      candidateEngine: `${candidate.engineLabel}${candidate.model ? ` · ${candidate.model}` : ''}`,
      approvedForGold: false,
      createdAt: new Date().toISOString(),
    };
    try {
      await onSaveReview({ ...review, notes: [review.notes, evidence.reason].filter(Boolean).join(' | ') });
      setSavedReview(review);
      toast({ title: 'הבדיקה האנושית נשמרה', description: hasTiming ? 'ההחלטה כוללת קישור מדויק לאודיו.' : 'ההחלטה נשמרה ללא תזמון ולכן עדיין אינה Gold.' });
    } finally {
      setSaving(false);
    }
  };

  const approveGold = async () => {
    if (!savedReview || !hasTiming) return;
    setSaving(true);
    try {
      await onApproveGold(savedReview);
      setSavedReview({ ...savedReview, approvedForGold: true });
      toast({ title: 'הקטע אושר ל-Gold', description: 'נשמרו האודיו המתוזמן, הטקסט המאומת ופרטי המנועים.' });
    } finally {
      setSaving(false);
    }
  };

  const addSelectedCorrection = async () => {
    const wrong = selection.candidateText.trim();
    if (!wrong || !correctedText.trim() || wrong === correctedText.trim()) return;
    await onAddToLexicon(wrong, correctedText.trim());
  };

  return (
    <section className="space-y-4" aria-label="סביבת בדיקה אנושית">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          if (stopAtRef.current !== null && event.currentTarget.currentTime >= stopAtRef.current) {
            event.currentTarget.pause();
            stopAtRef.current = null;
          }
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-y bg-muted/20 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">מקור מאומת</Badge>
          <Badge variant="outline">A: {baseline.engineLabel}</Badge>
          <Badge variant="outline">B: {candidate.engineLabel}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={selectedIds.length ? 'default' : 'secondary'}>{selectedIds.length} יחידות נבחרו</Badge>
          <Button type="button" size="sm" variant="ghost" onClick={clearSelection} disabled={!selectedIds.length}>
            <RotateCcw className="me-1 h-4 w-4" />נקה
          </Button>
        </div>
      </div>

      <div className="max-h-[34rem] overflow-y-auto border-y" data-testid="asr-review-unit-list">
        <div className="sticky top-0 z-10 grid grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-2 border-b bg-background px-2 py-2 text-xs font-semibold">
          <span>#</span><span>טקסט אמת</span><span>מנוע A</span><span>מנוע B</span>
        </div>
        {units.map((unit, index) => {
          const selected = selectedIds.includes(unit.id);
          return (
            <button
              key={unit.id}
              type="button"
              onClick={(event) => selectUnit(index, event.shiftKey)}
              className={cn(
                'grid w-full grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-2 border-b px-2 py-2 text-right text-sm transition-colors last:border-b-0 hover:bg-muted/40',
                selected && 'bg-primary/10 ring-1 ring-inset ring-primary',
                unit.kind === 'conflict' && !selected && 'bg-amber-500/[0.04]',
              )}
              aria-pressed={selected}
              data-testid={`asr-review-unit-${index}`}
            >
              <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{unit.sourceText.trim() || '∅'}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{unit.baselineText.trim() || '∅'}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{unit.candidateText.trim() || '∅'}</span>
            </button>
          );
        })}
      </div>

      {selectedIds.length > 0 && (
        <div className="space-y-4 border-y px-3 py-4" data-testid="asr-review-decision-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Headphones className="h-4 w-4" />
              {hasTiming
                ? <span className="tabular-nums">{selection.start!.toFixed(2)}–{selection.end!.toFixed(2)} שניות</span>
                : <span className="text-amber-700">אין תזמון מילים מהמנוע; אפשר לבדוק טקסט אך לא לאשר קטע ל-Gold.</span>}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void playSelection()}>
              {playing ? <Pause className="me-1 h-4 w-4" /> : <Play className="me-1 h-4 w-4" />}
              {playing ? 'עצור' : hasTiming ? 'נגן קטע' : 'נגן הקלטה'}
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {(['source', 'baseline', 'candidate'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setChoice(value)}
                className={cn('border p-3 text-right', choice === value && 'border-primary bg-primary/5 ring-1 ring-primary')}
              >
                <span className="mb-1 block text-xs text-muted-foreground">{choiceLabel[value]}</span>
                <span className="whitespace-pre-wrap font-medium">{{ source: selection.sourceText, baseline: selection.baselineText, candidate: selection.candidateText }[value] || 'מחיקה'}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="review-custom-text">תיקון ידני</Label>
              <Input
                id="review-custom-text"
                value={customText}
                onFocus={() => setChoice('custom')}
                onChange={(event) => { setCustomText(event.target.value); setChoice('custom'); }}
                dir="rtl"
                className="text-right"
                placeholder="הזן נוסח נכון כאשר כל המקורות שגויים"
              />
            </div>
            <div className="space-y-2">
              <Label>סוג השגיאה</Label>
              <Select value={errorType} onValueChange={(value) => setErrorType(value as AsrReviewErrorType)}>
                <SelectTrigger aria-label="סוג השגיאה"><SelectValue /></SelectTrigger>
                <SelectContent>{ERROR_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-notes">הערת בודק</Label>
            <Textarea id="review-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} dir="rtl" className="text-right" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void saveReview()} disabled={saving || !correctedText.trim()}>
              <Save className="me-1 h-4 w-4" />שמור Human Review
            </Button>
            <Button type="button" variant="outline" onClick={() => void addSelectedCorrection()} disabled={!correctedText.trim() || selection.candidateText.trim() === correctedText.trim()}>
              <BookOpen className="me-1 h-4 w-4" />הוסף כמועמד למילון
            </Button>
            <Button type="button" variant="secondary" onClick={() => void approveGold()} disabled={saving || !savedReview || !hasTiming || savedReview.approvedForGold}>
              {savedReview?.approvedForGold ? <Check className="me-1 h-4 w-4" /> : <ShieldCheck className="me-1 h-4 w-4" />}
              {savedReview?.approvedForGold ? 'אושר ל-Gold' : 'אשר קטע ל-Gold'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
