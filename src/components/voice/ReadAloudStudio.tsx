import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Download, Info, Mic, Pause, Play, Square, Trash2, Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useMicrophoneRecording } from '@/hooks/useMicrophoneRecording';
import { prepareAshkenaziSpeech } from '@/lib/ashkenaziSpeech';
import { enginesByRank, REJECTED_ENGINES, type TtsEngine } from '@/lib/ttsEngines';
import {
  isHebrewTtsAvailable, isPaused as ttsIsPaused, pauseSpeaking, resumeSpeaking,
  speakHebrew, splitSpokenWords, stopSpeaking, waitForVoices,
  wordIndexForChar, type HebrewVoice,
} from '@/utils/hebrewTts';
import LocalEnginePanel from './LocalEnginePanel';

const SAMPLE_TEXT =
  'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ. ' +
  'וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל פְּנֵי תְהוֹם.';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function EngineRow({ engine, selected }: { engine: TtsEngine; selected: boolean }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <span className={selected ? 'font-medium' : ''}>{engine.name}</span>
      {engine.hebrew === 'מאומת' ? (
        <Badge variant="default" className="h-5 px-1.5 text-[10px]">עברית מאומתת</Badge>
      ) : (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">עברית מוצהרת</Badge>
      )}
      {engine.sizeGb === 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">זמין מיד</Badge>
      ) : (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {engine.sizeGb ? `${engine.sizeGb} ג׳יגה להורדה` : 'הורדה'}
        </Badge>
      )}
    </div>
  );
}

/**
 * אולפן הקראה והקלטה.
 *
 * שני הצדדים חולקים את אותו טקסט בכוונה: זה בדיוק מה שהופך אותם
 * לחומר אימון. טקסט שהמערכת מקריאה, או שהמשתמש מקריא בעצמו, הוא
 * זוג של שמע ותמלול שהתמלול שלו נכון בהגדרה — כי אנחנו כתבנו אותו.
 */
export default function ReadAloudStudio() {
  const engines = useMemo(() => enginesByRank(), []);
  const [engineId, setEngineId] = useState('browser');
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];

  const [text, setText] = useState(SAMPLE_TEXT);
  const [ashkenazi, setAshkenazi] = useState(true);
  const [voices, setVoices] = useState<HebrewVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [rate, setRate] = useState(0.9);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);

  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activeWord, setActiveWord] = useState(-1);
  const [boundarySupported, setBoundarySupported] = useState<boolean | null>(null);

  const [recordedUrl, setRecordedUrl] = useState('');
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);

  const supported = isHebrewTtsAvailable();

  // רשימת הקולות מגיעה באיחור. בדיקה חד-פעמית בטעינה תמצא רשימה ריקה
  // ותציג "אין קול עברי" גם במחשב שיש בו קול עברי.
  useEffect(() => {
    let alive = true;
    void waitForVoices().then((list) => {
      if (!alive) return;
      setVoices(list);
      setVoicesLoaded(true);
      const hebrew = list.find((v) => v.isHebrew);
      if (hebrew) setVoiceName(hebrew.name);
      else if (list.length) setVoiceName(list[0].name);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { stopSpeaking(); }, []);
  useEffect(() => () => { if (recordedUrl) URL.revokeObjectURL(recordedUrl); }, [recordedUrl]);

  const prepared = useMemo(
    () => (ashkenazi ? prepareAshkenaziSpeech(text) : { text, changedWords: 0, totalWords: 0, warning: '' }),
    [ashkenazi, text],
  );
  const spokenText = prepared.text;
  const words = useMemo(() => splitSpokenWords(spokenText), [spokenText]);

  const handleSpeak = useCallback(() => {
    if (!supported) return;
    setActiveWord(-1);
    setBoundarySupported(null);
    const utterance = speakHebrew(spokenText, {
      voiceName: voiceName || undefined,
      rate, pitch, volume,
      onStart: () => { setSpeaking(true); setPaused(false); },
      onBoundary: (charIndex) => {
        setBoundarySupported(true);
        setActiveWord(wordIndexForChar(words, charIndex));
      },
      onEnd: () => { setSpeaking(false); setPaused(false); setActiveWord(-1); },
      onError: (message) => {
        setSpeaking(false); setPaused(false); setActiveWord(-1);
        toast({ title: 'ההקראה נכשלה', description: message, variant: 'destructive' });
      },
    });
    if (!utterance) {
      toast({ title: 'אין מה להקריא', description: 'צריך להזין טקסט.', variant: 'destructive' });
      return;
    }
    // יש מנועים שאינם שולחים אירוע גבול-מילה. אחרי שנייה בלי אף אירוע
    // ברור שאין הדגשה, ועדיף לומר זאת מלהשאיר את המשתמש עם טקסט קפוא.
    window.setTimeout(() => {
      setBoundarySupported((current) => (current === null ? false : current));
    }, 1200);
  }, [supported, spokenText, voiceName, rate, pitch, volume, words]);

  const handlePauseResume = useCallback(() => {
    if (ttsIsPaused()) { resumeSpeaking(); setPaused(false); }
    else { pauseSpeaking(); setPaused(true); }
  }, []);

  const handleStop = useCallback(() => {
    stopSpeaking();
    setSpeaking(false); setPaused(false); setActiveWord(-1);
  }, []);

  const recorder = useMicrophoneRecording({
    fileNamePrefix: 'הקראה',
    monitorLevel: true,
    onComplete: ({ file, durationSeconds }) => {
      setRecordedUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
      setRecordedFile(file);
      setRecordedSeconds(durationSeconds);
      toast({ title: 'ההקלטה נשמרה', description: `${durationSeconds} שניות.` });
    },
    onError: (message) => toast({ title: 'שגיאת הקלטה', description: message, variant: 'destructive' }),
  });

  const downloadPair = useCallback(() => {
    if (!recordedFile) return;
    const audioLink = document.createElement('a');
    audioLink.href = URL.createObjectURL(recordedFile);
    audioLink.download = recordedFile.name;
    audioLink.click();
    URL.revokeObjectURL(audioLink.href);

    // הטקסט נשמר בנפרד, כי זה התמלול הנאמן של ההקלטה. הזוג הזה הוא
    // מה שאפשר להזין לאימון.
    const blob = new Blob([spokenText], { type: 'text/plain;charset=utf-8' });
    const textLink = document.createElement('a');
    textLink.href = URL.createObjectURL(blob);
    textLink.download = recordedFile.name.replace(/\.[^.]+$/, '') + '.txt';
    textLink.click();
    URL.revokeObjectURL(textLink.href);
  }, [recordedFile, spokenText]);

  const localEngineChosen = engine && engine.id !== 'browser';

  return (
    <div className="space-y-5">
      {/* בחירת המנוע */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Volume2 className="w-4 h-4" />
            מנוע ההקראה
          </CardTitle>
          <CardDescription>
            מנוע אחד זמין מיד, והשאר דורשים הורדה. כתוב ליד כל אחד אם התמיכה
            שלו בעברית נבדקה בפועל או רק מוצהרת.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={engineId} onValueChange={setEngineId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engines.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <EngineRow engine={e} selected={e.id === engineId} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {engine && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-2">
              <p>{engine.notes}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                <div><span className="font-medium">שכפול קול:</span> {engine.cloning ?? 'אין'}</div>
                <div><span className="font-medium">קליטת צלילים ישירה:</span> {engine.acceptsPhonemes ? 'כן' : 'לא'}</div>
                <div><span className="font-medium">רישיון:</span> {engine.licence}</div>
              </div>
            </div>
          )}

          {localEngineChosen && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>
                המנוע הזה עדיין לא הורד למחשב, ולכן כפתורי ההקראה למטה עובדים
                דרך מנוע הדפדפן. ההורדה וההפעלה המקומית הן השלב הבא, ואין טעם
                לעשות אותן לפני שמחליטים שהאיכות מצדיקה את הנפח.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* הטקסט וההגייה */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">הטקסט להקראה</CardTitle>
          <CardDescription>
            ההקראה בהגייה אשכנזית עובדת בדרך עקיפה: הטקסט המנוקד נכתב מחדש
            בכתיב שמשקף את ההגייה, והקול קורא בדיוק את מה שכתוב.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            dir="rtl"
            className="text-lg leading-relaxed"
            placeholder="הדביקו כאן טקסט מנוקד"
          />

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="ashkenazi-switch" className="text-sm font-medium">
                הגייה אשכנזית-ליטאית
              </Label>
              <p className="text-xs text-muted-foreground">
                קמץ נשמע O, תי״ו רפה נשמעת ס, חולם נשמע OY, צירה נשמע EY,
                וההברה האחרונה נוטה לסגול.
              </p>
            </div>
            <Switch id="ashkenazi-switch" checked={ashkenazi} onCheckedChange={setAshkenazi} />
          </div>

          {ashkenazi && prepared.warning && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>{prepared.warning}</span>
            </div>
          )}

          {ashkenazi && !prepared.warning && prepared.changedWords > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-green-600" aria-hidden />
              <span>
                {prepared.changedWords} מתוך {prepared.totalWords} מילים נכתבו
                מחדש להגייה אשכנזית.
              </span>
            </div>
          )}

          {/* תצוגת מה שייקרא, עם הדגשת המילה הנוכחית */}
          <div
            dir="rtl"
            className="rounded-lg bg-muted/40 p-4 text-xl leading-loose min-h-[4rem]"
            aria-live="off"
          >
            {words.length === 0 && <span className="text-muted-foreground text-base">אין טקסט.</span>}
            {words.map((w, i) => (
              <span
                key={`${w.charIndex}-${i}`}
                // aria-current מודיע למקריאי מסך איזו מילה נקראת כרגע,
                // ובמקביל הוא הסימן היחיד שאפשר לבדוק עליו — צבעי ההדגשה
                // משותפים לתוויות ולכפתורים בעמוד.
                aria-current={i === activeWord ? 'true' : undefined}
                className={[
                  'transition-colors rounded px-0.5',
                  i === activeWord ? 'bg-primary text-primary-foreground' : '',
                ].join(' ')}
              >
                {w.word}{' '}
              </span>
            ))}
          </div>

          {speaking && boundarySupported === false && (
            <p className="text-xs text-muted-foreground">
              מנוע ההקראה הזה אינו מדווח על התקדמות בין מילים, ולכן אין הדגשה
              תוך כדי הקריאה. הקריאה עצמה תקינה.
            </p>
          )}
        </CardContent>
      </Card>

      {/* המנוע המקומי — צלילים אמיתיים */}
      <LocalEnginePanel text={text} />

      {/* שליטה בקול */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">הקראת הדפדפן — הקול והקצב</CardTitle>
          <CardDescription>
            דרך שנייה, חלשה יותר: הדפדפן מקבל אותיות ולא צלילים, ולכן
            ההגייה האשכנזית נעשית כאן בעקיפין — על ידי כתיבת הטקסט מחדש.
            אין בה שליטה בהטעמה.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!supported && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>הדפדפן הזה אינו תומך בהקראה.</span>
            </div>
          )}

          {supported && voicesLoaded && !voices.some((v) => v.isHebrew) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>
                לא נמצא קול עברי מותקן במערכת. ההקראה תעבוד עם קול בשפה אחרת,
                והתוצאה תישמע שגויה. אפשר להתקין קול עברי בהגדרות השפה של
                המערכת, או לבחור מנוע מקומי בהמשך.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>הקול</Label>
            <Select value={voiceName} onValueChange={setVoiceName} disabled={!voices.length}>
              <SelectTrigger>
                <SelectValue placeholder={voicesLoaded ? 'אין קולות' : 'טוען קולות…'} />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.name} value={v.name}>
                    <span className="flex items-center gap-2">
                      {v.label}
                      {v.isLocal && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">במחשב</Badge>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {voices.filter((v) => v.isHebrew).length} קולות עבריים מתוך {voices.length} שנמצאו.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="flex justify-between">
                <span>מהירות</span>
                <span className="text-muted-foreground tabular-nums">{rate.toFixed(2)}</span>
              </Label>
              <Slider value={[rate]} min={0.5} max={1.6} step={0.05}
                onValueChange={([v]) => setRate(v)} />
              <p className="text-xs text-muted-foreground">
                קריאה של שיעור נשמעת טבעית סביב 0.85 עד 0.95.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">
                <span>גובה הקול</span>
                <span className="text-muted-foreground tabular-nums">{pitch.toFixed(2)}</span>
              </Label>
              <Slider value={[pitch]} min={0.5} max={1.5} step={0.05}
                onValueChange={([v]) => setPitch(v)} />
            </div>
            <div className="space-y-2">
              <Label className="flex justify-between">
                <span>עוצמה</span>
                <span className="text-muted-foreground tabular-nums">{Math.round(volume * 100)}%</span>
              </Label>
              <Slider value={[volume]} min={0} max={1} step={0.05}
                onValueChange={([v]) => setVolume(v)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSpeak} disabled={!supported || !spokenText.trim()} className="gap-2">
              <Play className="w-4 h-4" />
              {speaking ? 'הקרא מהתחלה' : 'הקרא'}
            </Button>
            <Button variant="outline" onClick={handlePauseResume} disabled={!speaking} className="gap-2">
              <Pause className="w-4 h-4" />
              {paused ? 'המשך' : 'השהה'}
            </Button>
            <Button variant="outline" onClick={handleStop} disabled={!speaking} className="gap-2">
              <Square className="w-4 h-4" />
              עצור
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* הקלטה של המשתמש */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="w-4 h-4" />
            הקלטה של עצמך קורא את הטקסט
          </CardTitle>
          <CardDescription>
            כאן נוצר חומר האימון. כשאתה מקריא טקסט שכבר כתוב, התמלול שלו נכון
            במאה אחוז — כי הוא הטקסט שקראת. זה ההפך מתמלול, שבו צריך לנחש.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {!recorder.isRecording ? (
              <Button onClick={() => void recorder.start()} className="gap-2">
                <Mic className="w-4 h-4" />
                התחל הקלטה
              </Button>
            ) : (
              <>
                <Button variant="destructive" onClick={recorder.stop} className="gap-2">
                  <Square className="w-4 h-4" />
                  סיים ושמור
                </Button>
                <Button variant="outline" onClick={recorder.isPaused ? recorder.resume : recorder.pause} className="gap-2">
                  <Pause className="w-4 h-4" />
                  {recorder.isPaused ? 'המשך' : 'השהה'}
                </Button>
                <Button variant="ghost" onClick={recorder.cancel} className="gap-2">
                  <Trash2 className="w-4 h-4" />
                  בטל
                </Button>
                <span className="tabular-nums text-sm text-muted-foreground">
                  {formatElapsed(recorder.elapsedSeconds)}
                  {recorder.isPaused && ' · בהשהיה'}
                </span>
              </>
            )}
          </div>

          {recorder.isRecording && (
            <div className="space-y-1">
              <Progress value={recorder.audioLevel * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {recorder.audioLevel < 0.03
                  ? 'אין קול מהמיקרופון. כדאי לבדוק שהוא נבחר ושאינו משותק.'
                  : 'המיקרופון קולט.'}
              </p>
            </div>
          )}

          {recordedUrl && !recorder.isRecording && (
            <div className="space-y-3 rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Check className="h-4 w-4 text-green-600" aria-hidden />
                הקלטה של {recordedSeconds} שניות
              </div>
              <audio controls src={recordedUrl} className="w-full" />
              <Button variant="outline" size="sm" onClick={downloadPair} className="gap-2">
                <Download className="w-4 h-4" />
                הורד את ההקלטה ואת הטקסט
              </Button>
              <p className="text-xs text-muted-foreground">
                יורדים שני קבצים: השמע, והטקסט שהוקרא. שניהם יחד הם זוג אימון אחד.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* מה נבדק ונפסל */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">מנועים שנבדקו ונפסלו</CardTitle>
          <CardDescription>
            רשום כאן כדי שלא ייבדקו שוב ולא יורדו לחינם.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {REJECTED_ENGINES.map((r) => (
              <li key={r.name} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">— {r.why}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
