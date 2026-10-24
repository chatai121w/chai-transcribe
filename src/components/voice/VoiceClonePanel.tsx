import { useCallback, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Info, Loader2, Mic, Square, Trash2, Upload, UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { useMicrophoneRecording } from '@/hooks/useMicrophoneRecording';
import {
  cloneVoice, deleteVoice, TtsApiError,
  type CloneReport, type TtsStatus,
} from '@/lib/ttsApi';

interface Props {
  status: TtsStatus;
  /** נקרא אחרי שכפול או מחיקה, כדי לרענן את רשימת הקולות. */
  onVoicesChanged: () => void;
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * שכפול קול.
 *
 * שתי דרכים להזין הקלטת ייחוס: הקלטה ישירה מהמיקרופון, או קובץ
 * שנגרר או נבחר. שתיהן מגיעות לאותו קוד.
 *
 * מה שהמשתמש חייב להבין, ולכן כתוב כאן בגדול: **נשמרת זהות הקול
 * בלבד, לא ההגייה.** הקול החדש לא ידבר אשכנזית מעצמו. קל מאוד
 * לצפות שההקלטה "תלמד" את המבטא, והיא לא.
 */
export default function VoiceClonePanel({ status, onVoicesChanged }: Props) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  // ריק פירושו שהמערכת תבחר לבד את הקטע הטוב ביותר.
  const [startAt, setStartAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [report, setReport] = useState<CloneReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cloned = status.voices.filter((v) => v.cloned);

  const takeFile = useCallback((f: File) => {
    setReport(null);
    setFile(f);
    setPreviewUrl((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return URL.createObjectURL(f);
    });
    if (!name.trim()) {
      // שם ברירת מחדל משם הקובץ, כדי לחסוך הקלדה.
      setName(f.name.replace(/\.[^.]+$/, '').slice(0, 40));
    }
  }, [name]);

  const recorder = useMicrophoneRecording({
    fileNamePrefix: 'ייחוס',
    monitorLevel: true,
    onComplete: ({ file: f, durationSeconds }) => {
      takeFile(f);
      toast({ title: 'ההקלטה נשמרה', description: `${durationSeconds} שניות.` });
    },
    onError: (message) =>
      toast({ title: 'שגיאת הקלטה', description: message, variant: 'destructive' }),
  });

  const handleClone = useCallback(async (overwrite = false) => {
    if (!file || !name.trim()) return;
    setWorking(true);
    setReport(null);
    try {
      const parsedStart = startAt.trim() ? Number(startAt.trim()) : undefined;
      const r = await cloneVoice({
        file,
        name: name.trim(),
        note: note.trim(),
        overwrite,
        startSeconds: Number.isFinite(parsedStart) ? parsedStart : undefined,
      });
      setReport(r);
      onVoicesChanged();
      toast({
        title: 'הקול נוצר',
        description: `${r.name} — מ-${r.seconds.toFixed(1)} שניות הקלטה.`,
      });
    } catch (e: unknown) {
      const err = e instanceof TtsApiError ? e : null;
      const message = err?.message || 'שכפול הקול נכשל.';
      // שם תפוס הוא המקרה הנפוץ, ולכן מוצע מיד מה לעשות.
      if (!overwrite && message.includes('כבר קיים')) {
        toast({
          title: 'השם תפוס',
          description: `${message} אפשר ללחוץ שוב על "דרוס קול קיים".`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'שכפול הקול נכשל', description: message, variant: 'destructive' });
      }
    } finally {
      setWorking(false);
    }
  }, [file, name, note, startAt, onVoicesChanged]);

  const handleDelete = useCallback(async (voiceName: string) => {
    try {
      await deleteVoice(voiceName);
      onVoicesChanged();
      toast({ title: 'הקול נמחק', description: voiceName });
    } catch (e: unknown) {
      const err = e instanceof TtsApiError ? e : null;
      toast({
        title: 'המחיקה נכשלה',
        description: err?.message || 'לא ניתן למחוק.',
        variant: 'destructive',
      });
    }
  }, [onVoicesChanged]);

  if (!status.cloningAvailable) {
    return (
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            שכפול קול
          </CardTitle>
          <CardDescription>אינו מותקן.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {status.cloningMissing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          שכפול קול
          <Badge variant="default" className="h-5 px-1.5 text-[10px]">מותקן</Badge>
        </CardTitle>
        <CardDescription>
          מהקלטה של {status.cloneMinSeconds} עד {status.cloneMaxSeconds} שניות
          אפשר לחלץ את זהות הקול, ומאותו רגע להקריא כל טקסט באותו קול.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ההבהרה החשובה */}
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong>נשמרת זהות הקול בלבד, לא ההגייה.</strong> גם אם ההקלטה
            בהגייה אשכנזית, הקול החדש לא ידבר אשכנזית מעצמו — ההגייה נקבעת
            בחלק של הצלילים למעלה. הקול החדש רק יישמע כמו הדובר.
          </span>
        </div>

        {/* הקלטה ישירה */}
        <div className="space-y-2">
          <Label>הקלטה מהמיקרופון</Label>
          <div className="flex flex-wrap items-center gap-2">
            {!recorder.isRecording ? (
              <Button variant="outline" onClick={() => void recorder.start()} className="gap-2">
                <Mic className="h-4 w-4" />
                התחל הקלטת ייחוס
              </Button>
            ) : (
              <>
                <Button variant="destructive" onClick={recorder.stop} className="gap-2">
                  <Square className="h-4 w-4" />
                  סיים
                </Button>
                <Button variant="ghost" onClick={recorder.cancel}>בטל</Button>
                <span className="tabular-nums text-sm text-muted-foreground">
                  {formatElapsed(recorder.elapsedSeconds)}
                </span>
              </>
            )}
          </div>
          {recorder.isRecording && (
            <>
              <Progress value={recorder.audioLevel * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {recorder.elapsedSeconds < status.cloneMinSeconds
                  ? `עוד ${status.cloneMinSeconds - recorder.elapsedSeconds} שניות לפחות.`
                  : recorder.elapsedSeconds > status.cloneMaxSeconds
                    ? 'יש מספיק. הקלטה ארוכה יותר אינה משפרת.'
                    : 'אורך טוב. כדאי לדבר רצוף, בלי שקט באמצע.'}
              </p>
            </>
          )}
        </div>

        {/* או קובץ */}
        <div className="space-y-2">
          <Label>או קובץ שמע</Label>
          <div
            role="button"
            tabIndex={0}
            aria-label="אזור גרירה לקובץ שמע"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) takeFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            className={[
              'rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors',
              dragging
                ? 'border-primary bg-primary/10'
                : 'border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/40',
            ].join(' ')}
          >
            <Upload className="mx-auto mb-1.5 h-6 w-6 opacity-60" aria-hidden />
            <div className="text-sm font-medium">גרור לכאן קובץ שמע</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              או לחץ לבחירה · הקלטה ב-44100 דגימות בשנייה נותנת את התוצאה הטובה
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) takeFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {previewUrl && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <div className="truncate text-sm font-medium">{file?.name}</div>
            <audio controls src={previewUrl} className="w-full" />
          </div>
        )}

        {/* השם */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="voice-name">שם הקול</Label>
            <Input
              id="voice-name"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל: הרב מהשיעור"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voice-note">הערה</Label>
            <Input
              id="voice-note"
              dir="rtl"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="מאיפה ההקלטה, כדי לזכור"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="start-at">מאיזו דקה לקחת (לא חובה)</Label>
          <Input
            id="start-at"
            dir="ltr"
            inputMode="numeric"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="ריק = המערכת תבחר לבד"
            className="max-w-[220px]"
          />
          <p className="text-xs text-muted-foreground">
            בשניות. בהקלטת שיעור ארוכה ההתחלה היא בדרך כלל שקט או פתיח,
            ולכן המערכת מחפשת לבד את הקטע עם הדיבור הרצוף ביותר. כאן אפשר
            לכפות קטע אחר.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void handleClone(false)}
            disabled={working || !file || !name.trim()}
            className="gap-2"
          >
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {working ? 'מחלץ את הקול…' : 'צור את הקול'}
          </Button>
          {report === null && file && name.trim() && (
            <Button
              variant="outline"
              onClick={() => void handleClone(true)}
              disabled={working}
            >
              דרוס קול קיים
            </Button>
          )}
        </div>

        {/* הדוח */}
        {report && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Check className="h-4 w-4 text-green-600" aria-hidden />
              הקול {report.name} נוצר
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
              <div>אורך: {report.seconds.toFixed(1)} שניות</div>
              <div>תדר מקורי: {report.sourceRate}</div>
              <div>עוצמה: {report.rms.toFixed(3)}</div>
              <div>שקט: {Math.round(report.silenceFraction * 100)} אחוז</div>
            </div>
            {report.sourceSeconds > report.seconds + 1 && (
              <p className="text-xs text-muted-foreground">
                הקובץ באורך {(report.sourceSeconds / 60).toFixed(1)} דקות, ונלקח
                ממנו הקטע שמתחיל בשנייה {Math.round(report.windowStart)}
                {' '}(דקה {(report.windowStart / 60).toFixed(1)}).
              </p>
            )}
            {report.warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                {report.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              הקול נוסף לרשימת הקולות למעלה. אפשר לבחור אותו ולהקריא.
            </p>
          </div>
        )}

        {/* הקולות המשוכפלים */}
        {cloned.length > 0 && (
          <div className="space-y-2">
            <Label>קולות שיצרת ({cloned.length})</Label>
            <ul className="space-y-1.5">
              {cloned.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{v.id}</span>
                    {v.note && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {v.note}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(v.id)}
                    className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    מחק
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
