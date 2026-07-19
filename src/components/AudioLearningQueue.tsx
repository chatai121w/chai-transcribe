import { useEffect, useMemo, useState } from 'react';
import { Brain, Check, Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const sorted = useMemo(() => [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [candidates]);
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

  const approve = async (candidate: AudioLearningCandidate) => {
    setBusyId(candidate.id);
    try {
      const clip = await buildClip(candidate);
      const file = new File([clip], `${audioFileName || 'recording'}-${candidate.id}.wav`, { type: 'audio/wav' });
      const result = await addApprovedPair(file, candidate.referenceText, 'approved-ground-truth', {
        groupId: candidate.recordingKey,
        source: 'text-editor-correction',
        original: candidate.original,
        corrected: candidate.corrected,
        start: candidate.start,
        end: candidate.end,
      });
      onApproved(candidate.id);
      toast({ title: 'הקטע אושר ללמידה שמיעתית', description: `${result.rows} קטעים מאושרים במאגר` });
    } catch (error) {
      toast({ title: 'האישור ללמידה נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
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
      <div className="space-y-2">
        {sorted.map((candidate) => (
          <div key={candidate.id} className="border-b pb-2 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm"><span className="text-red-700 line-through">{candidate.original}</span> ← <span className="font-semibold text-emerald-700">{candidate.corrected}</span></span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={candidate.referenceText}>{candidate.referenceText}</span>
              <Button size="icon" variant="ghost" title="השמע קטע" onClick={() => void playCandidate(candidate)} disabled={busyId === candidate.id || !audioBlob}>
                {busyId === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" onClick={() => void approve(candidate)} disabled={busyId === candidate.id || !audioBlob}>
                <Check className="me-1 h-4 w-4" /> אשר ללמידה
              </Button>
              <Button size="icon" variant="ghost" title="הסר מועמד" onClick={() => onRemove(candidate.id)}>
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
