import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioLines, Mic, Sparkles, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useMicrophoneRecording } from '@/hooks/useMicrophoneRecording';

export type RecordingPracticeMode = 'terms' | 'natural';

export interface RecordedPracticeSource {
  file: File;
  groundTruth: string;
  hotwords: string;
  mode: RecordingPracticeMode;
  durationSeconds: number;
}

interface TermRecordingPanelProps {
  onReady: (source: RecordedPracticeSource) => void;
}

function splitTerms(value: string): string[] {
  return [...new Set(value.split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean))];
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function TermRecordingPanel({ onReady }: TermRecordingPanelProps) {
  const [mode, setMode] = useState<RecordingPracticeMode>('terms');
  const [termsInput, setTermsInput] = useState('');
  const [script, setScript] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const terms = useMemo(() => splitTerms(termsInput), [termsInput]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleComplete = useCallback(({ file, durationSeconds }: { file: File; durationSeconds: number }) => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    onReady({
      file,
      groundTruth: script.trim(),
      hotwords: terms.join(', '),
      mode,
      durationSeconds,
    });
    toast({
      title: 'ההקלטה מוכנה לניסוי',
      description: 'קובץ המקור, טקסט האמת והמונחים הוזנו אוטומטית',
    });
  }, [mode, onReady, script, terms]);

  const recorder = useMicrophoneRecording({
    fileNamePrefix: mode === 'terms' ? 'torah-terms' : 'torah-natural-speech',
    onComplete: handleComplete,
    onError: (message) => toast({ title: 'ההקלטה לא התחילה', description: message, variant: 'destructive' }),
  });

  const prepareScript = () => {
    if (!terms.length) {
      toast({ title: 'יש להזין לפחות מושג אחד', variant: 'destructive' });
      return;
    }
    const next = mode === 'terms'
      ? `אני קורא כעת את המושגים הבאים: ${terms.join(', ')}.`
      : `בשיעור זה נעסוק ב${terms.join(', וב')} ונשלב את המושגים בתוך דיבור טבעי.`;
    if (script.trim() && script.trim() !== next && !window.confirm('להחליף את טקסט ההקראה הקיים?')) return;
    setScript(next);
  };

  const canRecord = script.trim().length > 0 && terms.length > 0;

  return (
    <section aria-label="הקלטת בדיקת מושגים" className="border-y bg-muted/20 px-3 py-4 sm:px-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><Mic className="h-5 w-5" />הקלטת בדיקת מושגים</div>
        {recorder.isRecording && <Badge variant="destructive" className="gap-2 tabular-nums"><span className="h-2 w-2 animate-pulse rounded-full bg-current" />{formatElapsed(recorder.elapsedSeconds)}</Badge>}
      </div>

      <div className="mb-4 inline-flex w-full gap-1 border p-1 sm:w-auto" role="group" aria-label="סוג ההקלטה">
        <Button type="button" size="sm" variant={mode === 'terms' ? 'default' : 'ghost'} onClick={() => setMode('terms')} disabled={recorder.isRecording}>קריאת מושגים</Button>
        <Button type="button" size="sm" variant={mode === 'natural' ? 'default' : 'ghost'} onClick={() => setMode('natural')} disabled={recorder.isRecording}>דיבור טבעי</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(20rem,1.2fr)]">
        <div className="space-y-2">
          <Label htmlFor="practice-terms">מושגים לבדיקה</Label>
          <Input id="practice-terms" value={termsInput} onChange={(event) => setTermsInput(event.target.value)} disabled={recorder.isRecording} dir="rtl" placeholder="אביי, רבא, מסכת בבא קמא" />
          <div className="flex min-h-6 flex-wrap gap-1.5">
            {terms.map((term) => <Badge key={term} variant="outline">{term}</Badge>)}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="practice-script">טקסט מדויק להקראה</Label>
            <Button type="button" size="sm" variant="outline" onClick={prepareScript} disabled={recorder.isRecording}><Sparkles className="me-1 h-4 w-4" />הכן טקסט</Button>
          </div>
          <Textarea id="practice-script" value={script} onChange={(event) => setScript(event.target.value)} disabled={recorder.isRecording} rows={4} dir="rtl" placeholder="הטקסט שיוקרא ויישמר כטקסט האמת" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!recorder.isRecording ? (
          <Button type="button" onClick={() => void recorder.start()} disabled={!canRecord} aria-label="התחל הקלטת בדיקת מושגים"><Mic className="me-2 h-4 w-4" />התחל הקלטה</Button>
        ) : (
          <>
            <Button type="button" variant="destructive" onClick={recorder.stop}><Square className="me-2 h-4 w-4" />סיים והעלה לניסוי</Button>
            <Button type="button" variant="outline" onClick={recorder.cancel}><X className="me-2 h-4 w-4" />בטל</Button>
          </>
        )}
        {!recorder.isRecording && !canRecord && <span className="text-xs text-muted-foreground">נדרשים מושגים וטקסט מדויק להקראה</span>}
      </div>

      {previewUrl && (
        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium"><AudioLines className="h-4 w-4" />הקלטה אחרונה</span>
          <audio className="h-10 w-full" controls src={previewUrl} preload="metadata" />
        </div>
      )}
    </section>
  );
}
