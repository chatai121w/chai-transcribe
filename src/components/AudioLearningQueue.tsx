import { useEffect, useMemo, useState } from 'react';
import { Brain, Check, CheckCheck, Loader2, Play, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useLoraTraining } from '@/hooks/useLoraTraining';
import { cropLearningAudio, type AudioLearningCandidate } from '@/lib/audioLearning';
import { toast } from '@/hooks/use-toast';

interface AudioLearningQueueProps {
  audioBlob: Blob | null;
  audioFileName: string;
  candidates: AudioLearningCandidate[];
  onRemove: (id: string) => void;
  onApproved: (id: string) => void;
}

export function AudioLearningQueue({ audioBlob, audioFileName, candidates, onRemove, onApproved }: AudioLearningQueueProps) {
  const { addApprovedPair } = useLoraTraining();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const sorted = useMemo(() => [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [candidates]);
  const selected = useMemo(() => sorted.filter((candidate) => selectedIds.has(candidate.id)), [selectedIds, sorted]);
  const allSelected = sorted.length > 0 && selected.length === sorted.length;

  useEffect(() => {
    const availableIds = new Set(candidates.map((candidate) => candidate.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [candidates]);

  if (!sorted.length) return null;

  const buildClip = async (candidate: AudioLearningCandidate) => {
    if (!audioBlob) throw new Error('קובץ האודיו אינו זמין בעורך');
    return cropLearningAudio(audioBlob, candidate.start, candidate.end);
  };

  const playCandidate = async (candidate: AudioLearningCandidate) => {
    setBusyId(candidate.id);
    try {
      const clip = await buildClip(candidate);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ id: candidate.id, url: URL.createObjectURL(clip) });
    } catch (error) {
      toast({ title: 'לא ניתן להכין תצוגה מקדימה', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const uploadCandidate = async (candidate: AudioLearningCandidate) => {
    const clip = await buildClip(candidate);
    const file = new File([clip], `${audioFileName || 'recording'}-${candidate.id}.wav`, { type: 'audio/wav' });
    return addApprovedPair(file, candidate.referenceText, 'approved-ground-truth', {
        groupId: candidate.recordingKey,
        source: 'text-editor-correction',
        original: candidate.original,
        corrected: candidate.corrected,
        start: candidate.start,
        end: candidate.end,
    });
  };

  const approve = async (candidate: AudioLearningCandidate) => {
    setBusyId(candidate.id);
    try {
      const result = await uploadCandidate(candidate);
      onApproved(candidate.id);
      toast({ title: 'הקטע אושר ללמידה שמיעתית', description: `${result.rows} קטעים מאושרים במאגר` });
    } catch (error) {
      toast({ title: 'האישור ללמידה נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(sorted.map((candidate) => candidate.id)));

  const approveSelected = async () => {
    if (!selected.length || !audioBlob) return;
    setBulkBusy(true);
    let approved = 0;
    const failed = new Set<string>();
    for (const candidate of selected) {
      setBusyId(candidate.id);
      try {
        await uploadCandidate(candidate);
        onApproved(candidate.id);
        approved += 1;
      } catch {
        failed.add(candidate.id);
      }
    }
    setBusyId(null);
    setBulkBusy(false);
    setSelectedIds(failed);
    toast({
      title: `${approved} קטעים אושרו ללמידה`,
      description: failed.size ? `${failed.size} קטעים נכשלו ונשארו מסומנים לניסיון חוזר` : 'כל הקטעים שנבחרו נוספו למאגר',
      variant: failed.size ? 'destructive' : 'default',
    });
  };

  const rejectSelected = () => {
    const count = selected.length;
    selected.forEach((candidate) => onRemove(candidate.id));
    setSelectedIds(new Set());
    toast({ title: `${count} מועמדים נדחו והוסרו מהתור` });
  };

  return (
    <section className="border-y bg-muted/20 px-4 py-3" dir="rtl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">מועמדים ללמידה שמיעתית</h3>
          <Badge variant="secondary">{sorted.length}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">נשמרים רק לאחר האזנה ואישור</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="בחר את כל המועמדים" />
          בחר הכול
        </label>
        <Badge variant="outline">נבחרו {selected.length}</Badge>
        <Button size="sm" onClick={() => void approveSelected()} disabled={!selected.length || !audioBlob || bulkBusy}>
          {bulkBusy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <CheckCheck className="me-1 h-4 w-4" />}
          אשר נבחרים
        </Button>
        <Button size="sm" variant="outline" onClick={rejectSelected} disabled={!selected.length || bulkBusy}>
          <X className="me-1 h-4 w-4" /> דחה נבחרים
        </Button>
      </div>
      <div className="space-y-2">
        {sorted.map((candidate) => (
          <div key={candidate.id} className="border-b pb-2 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={selectedIds.has(candidate.id)}
                onCheckedChange={() => toggleSelected(candidate.id)}
                aria-label={`בחר תיקון ${candidate.original} ל-${candidate.corrected}`}
                disabled={bulkBusy}
              />
              <span className="text-sm"><span className="text-red-700 line-through">{candidate.original}</span> ← <span className="font-semibold text-emerald-700">{candidate.corrected}</span></span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={candidate.referenceText}>{candidate.referenceText}</span>
              <Button size="icon" variant="ghost" title="השמע קטע" onClick={() => void playCandidate(candidate)} disabled={bulkBusy || busyId === candidate.id || !audioBlob}>
                {busyId === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" onClick={() => void approve(candidate)} disabled={bulkBusy || busyId === candidate.id || !audioBlob}>
                <Check className="me-1 h-4 w-4" /> אשר ללמידה
              </Button>
              <Button size="icon" variant="ghost" title="הסר מועמד" onClick={() => onRemove(candidate.id)} disabled={bulkBusy}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {preview?.id === candidate.id && <audio className="mt-2 h-8 w-full" src={preview.url} controls autoPlay />}
          </div>
        ))}
      </div>
    </section>
  );
}
