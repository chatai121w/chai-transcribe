import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioLines, Loader2, Mic, Sparkles, Square, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useMicrophoneRecording } from '@/hooks/useMicrophoneRecording';
import { editTranscriptCloud } from '@/utils/editTranscriptApi';
import {
  buildFallbackPracticeScript,
  buildPracticeScriptPrompt,
  cleanGeneratedPracticeScript,
  findMissingPracticeTerms,
  splitPracticeTerms,
  type TermPracticeMode,
} from '@/lib/termPracticeScript';
import type { AsrSampleType } from '@/lib/asrSampleType';

export type RecordingPracticeMode = TermPracticeMode;

export interface RecordedPracticeSource {
  file: File;
  groundTruth: string;
  hotwords: string;
  mode: RecordingPracticeMode;
  sampleType: AsrSampleType;
  durationSeconds: number;
}

interface TermRecordingPanelProps {
  onReady: (source: RecordedPracticeSource) => void;
}

const SCRIPT_GENERATION_TIMEOUT_MS = 20_000;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function TermRecordingPanel({ onReady }: TermRecordingPanelProps) {
  const [mode, setMode] = useState<RecordingPracticeMode>('terms');
  const [termsInput, setTermsInput] = useState('');
  const [script, setScript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const terms = useMemo(() => splitPracticeTerms(termsInput), [termsInput]);

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
      sampleType: mode === 'terms' ? 'term-reading' : 'natural-speech',
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

  const prepareScript = async () => {
    if (!terms.length) {
      toast({ title: 'יש להזין לפחות מושג אחד', variant: 'destructive' });
      return;
    }
    if (mode === 'terms') {
      setScript(buildFallbackPracticeScript(terms, mode));
      toast({
        title: 'נוצר טקסט מיידי לקריאת המושגים',
        description: 'לכל מושג נוצר משפט נפרד; אין צורך להמתין לשירות AI.',
      });
      return;
    }

    setIsGenerating(true);
    const controller = new AbortController();
    let didTimeout = false;
    let rejectTimeout: ((reason: Error) => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
      rejectTimeout?.(new Error('SCRIPT_GENERATION_TIMEOUT'));
    }, SCRIPT_GENERATION_TIMEOUT_MS);
    try {
      const generated = cleanGeneratedPracticeScript(await Promise.race([
        editTranscriptCloud({
          text: terms.map((term) => `- ${term}`).join('\n'),
          action: 'custom',
          model: 'google/gemini-2.5-flash',
          customPrompt: buildPracticeScriptPrompt(mode),
          signal: controller.signal,
          personalGeminiTimeoutMs: 6_000,
        }),
        timeoutPromise,
      ]));
      const missing = findMissingPracticeTerms(generated, terms);
      if (missing.length) {
        setScript(buildFallbackPracticeScript(terms, mode));
        toast({
          title: 'נוצר טקסט חלופי בטוח',
          description: `ה-AI השמיט את המושגים: ${missing.join(', ')}`,
        });
        return;
      }
      setScript(generated);
      toast({ title: 'נוצר טקסט הקשרי נפרד', description: 'כל מושגי היעד נמצאים בטקסט ההקראה' });
    } catch (error) {
      setScript(buildFallbackPracticeScript(terms, mode));
      toast({
        title: didTimeout ? 'הענן לא הגיב בזמן' : 'נוצר טקסט מקומי',
        description: didTimeout
          ? 'לאחר 20 שניות הבקשה בוטלה ונוצר טקסט הקשרי מקומי שאפשר לערוך.'
          : `שירות ה-AI לא היה זמין: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`,
      });
    } finally {
      window.clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  const canRecord = script.trim().length > 0 && terms.length > 0 && !isGenerating;

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
          <Label htmlFor="practice-terms">מושגי יעד למדידה</Label>
          <p className="text-xs text-muted-foreground">מילה או ביטוי בכל פסיק או שורה. הרשימה נשמרת בנפרד לחישוב זיהוי המושגים.</p>
          <Input id="practice-terms" value={termsInput} onChange={(event) => setTermsInput(event.target.value)} disabled={recorder.isRecording || isGenerating} dir="rtl" placeholder="אביי, רבא, מסכת בבא קמא" />
          <div className="flex min-h-6 flex-wrap gap-1.5">
            {terms.map((term) => <Badge key={term} variant="outline">{term}</Badge>)}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="practice-script">טקסט אמת מלא להקלטה</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => void prepareScript()} disabled={recorder.isRecording || isGenerating}>
              {isGenerating ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Sparkles className="me-1 h-4 w-4" />}
              {isGenerating ? 'יוצר הקשר...' : 'צור טקסט הקשרי'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">הנוסח השלם שתקריא נשמר כטקסט האמת להשוואה. אפשר לערוך אותו לפני ההקלטה.</p>
          <Textarea id="practice-script" value={script} onChange={(event) => setScript(event.target.value)} disabled={recorder.isRecording || isGenerating} rows={4} dir="rtl" placeholder="צור טקסט הקשרי או כתוב כאן את הנוסח המדויק שתקריא" />
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
