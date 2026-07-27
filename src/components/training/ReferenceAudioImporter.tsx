import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, FileAudio, Loader2, Play, Scissors, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useLoraTraining } from '@/hooks/useLoraTraining';
import { cropLearningAudio } from '@/lib/audioLearning';
import { getServerUrl } from '@/lib/serverConfig';
import { assessReferenceSegment, buildReferenceSegments, referenceWordErrorRate, type ReferenceSegment } from '@/lib/referenceAudioLearning';
import type { WordTiming } from '@/components/SyncAudioPlayer';

export function ReferenceAudioImporter({ datasetId }: { datasetId: string }) {
  const { addApprovedPair } = useLoraTraining();
  const [audio, setAudio] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [rawTranscript, setRawTranscript] = useState('');
  const [segments, setSegments] = useState<ReferenceSegment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const selected = useMemo(() => segments.filter((segment) => selectedIds.has(segment.id)), [segments, selectedIds]);
  const safeIds = useMemo(() => new Set(segments.filter((segment) => assessReferenceSegment(segment).safe).map((segment) => segment.id)), [segments]);
  const unsafeCount = segments.length - safeIds.size;
  const wer = rawTranscript ? referenceWordErrorRate(reference, rawTranscript) : null;

  const analyze = async () => {
    if (!audio || !reference.trim()) return;
    setAnalyzing(true);
    setRawTranscript('');
    setSegments([]);
    setSelectedIds(new Set());
    try {
      const form = new FormData();
      form.append('file', audio, audio.name);
      form.append('language', 'he');
      form.append('beam_size', '5');
      form.append('normalize', '1');
      const response = await fetch(`${getServerUrl()}/transcribe`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
      const timings = (result.wordTimings || []) as WordTiming[];
      if (!timings.length) throw new Error('המנוע לא החזיר תזמוני מילים');
      const next = buildReferenceSegments(reference, timings);
      setRawTranscript(result.text || '');
      setSegments(next);
      const safe = next.filter((segment) => assessReferenceSegment(segment).safe);
      setSelectedIds(new Set(safe.map((segment) => segment.id)));
      toast({ title: `הוכנו ${next.length} קטעים לבדיקה`, description: `${safe.length} קטעים עברו בדיקת איכות ונבחרו אוטומטית` });
    } catch (error) {
      toast({ title: 'הניתוח נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const play = async (segment: ReferenceSegment) => {
    if (!audio) return;
    try {
      const clip = await cropLearningAudio(audio, segment.start, segment.end);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ id: segment.id, url: URL.createObjectURL(clip) });
    } catch (error) {
      toast({ title: 'לא ניתן להשמיע את הקטע', description: String(error), variant: 'destructive' });
    }
  };

  const approve = async () => {
    if (!audio || !selected.length) return;
    setApproving(true);
    setProgress({ done: 0, total: selected.length });
    const groupId = `${audio.name}:${audio.size}:${audio.lastModified}`;
    let approved = 0;
    const failed = new Set<string>();
    for (const segment of selected) {
      try {
        const clip = await cropLearningAudio(audio, segment.start, segment.end);
        const file = new File([clip], `${audio.name}-${segment.start.toFixed(2)}.wav`, { type: 'audio/wav' });
        await addApprovedPair(file, segment.text, datasetId, {
          groupId,
          source: 'reference-audio-import',
          start: segment.start,
          end: segment.end,
        });
        approved += 1;
      } catch {
        failed.add(segment.id);
      }
      setProgress((current) => ({ ...current, done: current.done + 1 }));
    }
    setSegments((current) => current.filter((segment) => failed.has(segment.id) || !selectedIds.has(segment.id)));
    setSelectedIds(failed);
    setApproving(false);
    toast({
      title: `${approved} קטעים נוספו למאגר`,
      description: failed.size ? `${failed.size} קטעים נכשלו ונשארו לבדיקה` : 'כל הקטעים שנבחרו נשמרו תחת אותה הקלטה',
      variant: failed.size ? 'destructive' : 'default',
    });
  };

  return (
    <section id="reference-learning" className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Scissors className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">למידה מהקלטה וטקסט מקור</h4>
        <Badge variant="outline">Dataset: {datasetId}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">המנוע מתאים את נוסח המקור לאודיו ומכין קטעים קצרים. כל הקטעים מאותו קובץ נשמרים כקבוצת הקלטה אחת.</p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          <Label>קובץ הקלטה</Label>
          <Input type="file" accept="audio/*" onChange={(event) => setAudio(event.target.files?.[0] || null)} />
        </div>
        <div className="space-y-1">
          <Label>טקסט מקור מדויק</Label>
          <Textarea value={reference} onChange={(event) => setReference(event.target.value)} rows={5} placeholder="הדבק כאן את הנוסח המדויק שנקרא בהקלטה" />
        </div>
      </div>
      <Button onClick={() => void analyze()} disabled={!audio || !reference.trim() || analyzing} className="gap-2">
        {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
        נתח, השווה וחתוך
      </Button>

      {wer != null && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={wer > 0.4 ? 'destructive' : 'secondary'}>WER לפני למידה: {(wer * 100).toFixed(1)}%</Badge>
          <Badge variant="secondary">{segments.length} קטעים</Badge>
          {unsafeCount > 0 && <Badge variant="destructive">{unsafeCount} דורשים בדיקה ידנית</Badge>}
        </div>
      )}
      {rawTranscript && (
        <details className="rounded border p-2 text-xs">
          <summary className="cursor-pointer font-medium">תמלול גולמי לפני למידה</summary>
          <p className="mt-2 leading-6 text-muted-foreground">{rawTranscript}</p>
        </details>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 border-y py-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={selectedIds.size > 0 && selectedIds.size === safeIds.size} onCheckedChange={() => setSelectedIds(selectedIds.size === safeIds.size ? new Set() : new Set(safeIds))} />בחר קטעים תקינים</label>
            <Badge variant="outline">נבחרו {selected.length}</Badge>
            <Button size="sm" onClick={() => void approve()} disabled={!selected.length || approving} className="gap-1">
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              אשר והוסף למאגר
            </Button>
            {approving && <span className="text-xs text-muted-foreground">{progress.done}/{progress.total}</span>}
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
            {segments.map((segment, index) => (
              <div key={segment.id} className={`flex items-start gap-2 rounded border p-2 ${assessReferenceSegment(segment).safe ? '' : 'border-destructive/60 bg-destructive/5'}`}>
                <Checkbox checked={selectedIds.has(segment.id)} onCheckedChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(segment.id)) next.delete(segment.id); else next.add(segment.id); return next; })} />
                <Badge variant="secondary">{index + 1}</Badge>
                <Input value={segment.text} onChange={(event) => setSegments((current) => current.map((item) => item.id === segment.id ? { ...item, text: event.target.value } : item))} className="h-8 flex-1" />
                <span className="whitespace-nowrap text-xs text-muted-foreground">{segment.start.toFixed(1)}–{segment.end.toFixed(1)}</span>
                {!assessReferenceSegment(segment).safe && (
                  <Badge variant="destructive" title={`${assessReferenceSegment(segment).wordsPerSecond.toFixed(1)} מילים לשנייה`}>
                    {assessReferenceSegment(segment).reason}
                  </Badge>
                )}
                <Button size="icon" variant="ghost" title="השמע" onClick={() => void play(segment)}><Play className="h-4 w-4" /></Button>
                {preview?.id === segment.id && <audio src={preview.url} controls autoPlay className="h-8 w-40" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
