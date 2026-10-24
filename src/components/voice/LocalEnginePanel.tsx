import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Cpu, Download, Info, Loader2, Play, RefreshCw, Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import {
  describeProviders, fetchTtsStatus, phonemizeHebrew, speakWithEngine,
  TtsApiError, type PhonemeResult, type TtsStatus,
} from '@/lib/ttsApi';
import { Separator } from '@/components/ui/separator';
import VoiceClonePanel from './VoiceClonePanel';

interface Props {
  /** הטקסט העברי, משותף עם שאר המסך. */
  text: string;
}

function voiceLabel(id: string, hebrew: boolean, cloned: boolean): string {
  if (cloned) return id;
  if (hebrew) return 'קול עברי (נשי, איטי)';
  if (id.includes('female')) return `קול נשי — ${id}`;
  if (id.includes('male')) return `קול גברי — ${id}`;
  return id;
}

/**
 * לוח המנוע המקומי.
 *
 * ההבדל המהותי מהקראת הדפדפן: המנוע הזה מקבל **צלילים** ולא אותיות.
 * לכן אפשר לומר לו בדיוק מה להשמיע, כולל היכן ההטעמה — וההטעמה היא
 * בדיוק ההבדל בין מלעיל ומלרע, שאי אפשר לבטא בכתיב.
 *
 * הצלילים מוצגים למשתמש וניתנים לעריכה בכוונה. כשמילה אחת יוצאת
 * בהגייה שגויה, תיקון שלה בצלילים לוקח שנייה — ואין דרך אחרת לתקן
 * אותה בלי לשנות כלל שמשפיע על כל הטקסט.
 */
export default function LocalEnginePanel({ text }: Props) {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const [accent, setAccent] = useState('ashkenazi');
  // ברירת המחדל היא רמת השיעור, כי זה מה שרוב הטקסטים כאן הם.
  const [level, setLevel] = useState('lesson');
  const [autoNikud, setAutoNikud] = useState(true);
  const [voice, setVoice] = useState('');
  const [steps, setSteps] = useState(16);
  const [cfg, setCfg] = useState(3);
  const [speed, setSpeed] = useState(1);
  const [fixedSeed, setFixedSeed] = useState(true);

  const [phonemes, setPhonemes] = useState<PhonemeResult | null>(null);
  const [editedIpa, setEditedIpa] = useState('');
  const [ipaEdited, setIpaEdited] = useState(false);
  const [converting, setConverting] = useState(false);

  const [speaking, setSpeaking] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [lastTiming, setLastTiming] = useState<{ seconds: number; elapsed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    const s = await fetchTtsStatus();
    setStatus(s);
    setChecking(false);
    if (s?.voices.length) {
      // הקול העברי הוא היחיד שמתאים לעברית, ולכן הוא ברירת המחדל.
      const hebrew = s.voices.find((v) => v.hebrew);
      setVoice((cur) => cur || hebrew?.id || s.voices[0].id);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ממירים לצלילים אחרי שהמשתמש מפסיק להקליד. בלי ההשהיה נשלחת פנייה
  // לשרת על כל אות.
  useEffect(() => {
    if (!status?.installed || !text.trim()) {
      setPhonemes(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setConverting(true);
      phonemizeHebrew(text, { accent, level, autoNikud })
        .then((r) => {
          if (!alive) return;
          setPhonemes(r);
          // עריכה ידנית של הצלילים נשמרת. אם היא הייתה נדרסת בכל
          // המרה מחדש, אי אפשר היה לתקן מילה אחת.
          if (!ipaEdited) setEditedIpa(r.ipa);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setPhonemes(null);
          const msg = e instanceof TtsApiError ? e.message : 'המרת הצלילים נכשלה.';
          toast({ title: 'המרה נכשלה', description: msg, variant: 'destructive' });
        })
        .finally(() => { if (alive) setConverting(false); });
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [text, accent, level, autoNikud, status?.installed, ipaEdited]);

  const ipaForSpeech = ipaEdited ? editedIpa : (phonemes?.ipa ?? '');

  const handleSpeak = useCallback(async () => {
    if (!ipaForSpeech.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSpeaking(true);
    setLastTiming(null);
    try {
      const result = await speakWithEngine({
        ipa: ipaForSpeech,
        voice: voice || undefined,
        accent, level, autoNikud,
        steps, cfg, speed,
        // מספר התחלה קבוע נותן את אותה תוצאה בדיוק שוב. זה הכרחי
        // כשמשווים הגדרות: בלעדיו כל הרצה שונה ואין מה להשוות.
        seed: fixedSeed ? 1234 : undefined,
        signal: ctrl.signal,
      });
      setAudioUrl((cur) => {
        if (cur) URL.revokeObjectURL(cur);
        return URL.createObjectURL(result.blob);
      });
      setLastTiming({ seconds: result.seconds, elapsed: result.elapsed });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const err = e instanceof TtsApiError ? e : null;
      toast({
        title: 'ההקראה נכשלה',
        description: err?.message || 'לא ניתן להקריא.',
        variant: 'destructive',
      });
      if (err?.unsupported?.length) {
        toast({
          title: 'סימנים שהמנוע אינו מכיר',
          description: err.unsupported.join(' '),
          variant: 'destructive',
        });
      }
    } finally {
      setSpeaking(false);
    }
  }, [ipaForSpeech, voice, accent, level, autoNikud, steps, cfg, speed, fixedSeed]);

  const hebrewVoice = useMemo(
    () => status?.voices.find((v) => v.hebrew) ?? null,
    [status],
  );

  // ---------------------------------------------------------------- תצוגה

  if (checking) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          בודק אם המנוע המקומי מותקן…
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="border-muted">
        <CardContent className="flex items-start gap-2 p-5 text-sm">
          <Info className="h-4 w-4 shrink-0 mt-0.5 opacity-60" aria-hidden />
          <div className="space-y-2">
            <p>שרת התמלול אינו פועל, ולכן המנוע המקומי אינו זמין כרגע.</p>
            <p className="text-muted-foreground text-xs">
              הקראת הדפדפן למטה עובדת בלי השרת.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              בדוק שוב
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status.installed) {
    return (
      <Card className="border-amber-500/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            המנוע המקומי מוריד כרגע
          </CardTitle>
          <CardDescription>
            הקבצים שעוד חסרים: {status.missingFiles.length}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {status.missingFiles.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            בדוק שוב
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Volume2 className="h-4 w-4 text-primary" />
          המנוע המקומי — הקראה בצלילים
          <Badge variant="default" className="h-5 px-1.5 text-[10px]">מותקן</Badge>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] gap-1">
            <Cpu className="h-3 w-3" />
            {describeProviders(status.providers)}
          </Badge>
        </CardTitle>
        <CardDescription>
          המנוע הזה מקבל צלילים ולא אותיות, ולכן אפשר לומר לו בדיוק מה
          להשמיע — כולל איפה ההטעמה. זה מה שמאפשר מלעיל ומלרע, שאי אפשר
          לבטא בכתיב. טבלת הצלילים שלו מכילה {status.symbolCount} סימנים.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>ההגייה</Label>
            <Select value={accent} onValueChange={(v) => { setAccent(v); setIpaEdited(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {status.accents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label} · {a.stress}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              בליטאית צירה וחולם נשמעים אותו דבר: "תורה" היא teyre.
              בפולנית החולם שונה: toyre. זה ההבדל הבולט ביניהן.
            </p>
          </div>

          <div className="space-y-2">
            <Label>רמת הלשון</Label>
            <Select value={level} onValueChange={(v) => { setLevel(v); setIpaEdited(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {status.levels?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label} · {l.stress}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {status.levels?.find((l) => l.id === level)?.note}
            </p>
          </div>

          <div className="space-y-2">
            <Label>הקול</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger><SelectValue placeholder="בחר קול" /></SelectTrigger>
              <SelectContent>
                {status.voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="flex items-center gap-2">
                      {voiceLabel(v.id, v.hebrew, v.cloned)}
                      {v.hebrew && (
                        <Badge variant="default" className="h-5 px-1.5 text-[10px]">עברית</Badge>
                      )}
                      {v.cloned && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">שוכפל</Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hebrewVoice && voice !== hebrewVoice.id
              && !status.voices.find((v) => v.id === voice)?.cloned && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                הקולות האחרים אומנו על אנגלית. לעברית התוצאה תהיה פחות טובה.
              </p>
            )}
          </div>
        </div>

        {/* הניקוד האוטומטי */}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="nikud-switch" className="text-sm font-medium">
              ניקוד אוטומטי
              {status.nikudAvailable ? (
                <Badge variant="secondary" className="mr-2 h-5 px-1.5 text-[10px]">
                  מותקן · {status.nikudSizeMb} מגה
                </Badge>
              ) : (
                <Badge variant="outline" className="mr-2 h-5 px-1.5 text-[10px]">אינו מותקן</Badge>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              ההמרה לצלילים חייבת ניקוד — בלעדיו אין מאיפה לדעת את התנועות.
              כשדלוק, טקסט שאינו מנוקד מנוקד אוטומטית. הניקוד נכון ברוב
              המקרים אבל לא בכולם.
            </p>
          </div>
          <Switch
            id="nikud-switch"
            checked={autoNikud && status.nikudAvailable}
            disabled={!status.nikudAvailable}
            onCheckedChange={(v) => { setAutoNikud(v); setIpaEdited(false); }}
          />
        </div>

        {phonemes?.nikudAdded && phonemes.vocalized && (
          <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium text-muted-foreground">
              הטקסט אחרי הניקוד האוטומטי — כדאי לעבור עליו
            </div>
            <p dir="rtl" className="text-lg leading-loose">{phonemes.vocalized}</p>
          </div>
        )}

        <Separator />

        {/* הצלילים */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="ipa-box" className="flex items-center gap-2">
              הצלילים שיישמעו
              {converting && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </Label>
            {ipaEdited && (
              <Button
                variant="ghost" size="sm"
                onClick={() => { setIpaEdited(false); setEditedIpa(phonemes?.ipa ?? ''); }}
              >
                חזור להמרה האוטומטית
              </Button>
            )}
          </div>
          <Textarea
            id="ipa-box"
            dir="ltr"
            rows={3}
            value={ipaEdited ? editedIpa : (phonemes?.ipa ?? '')}
            onChange={(e) => { setIpaEdited(true); setEditedIpa(e.target.value); }}
            className="font-mono text-base"
            placeholder="הצלילים יופיעו כאן אחרי שתזין טקסט מנוקד למעלה"
          />
          <p className="text-xs text-muted-foreground">
            אפשר לערוך כאן ישירות. כשמילה אחת יוצאת בהגייה שגויה, זאת הדרך
            המהירה לתקן אותה בלי לשנות כלל שמשפיע על כל הטקסט.
          </p>
        </div>

        {phonemes?.warnings.map((w, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{w}</span>
          </div>
        ))}

        {phonemes && phonemes.unsupported.length === 0 && phonemes.totalWords > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-600" aria-hidden />
            <span>
              {phonemes.totalWords} מילים הומרו, וכל הצלילים נמצאים בטבלת המנוע.
            </span>
          </div>
        )}

        {/* פירוט לפי מילה */}
        {phonemes && phonemes.perWord.length > 0 && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              פירוט לפי מילה ({phonemes.perWord.length})
            </summary>
            <div className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {phonemes.perWord.map((w, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 border-b py-0.5">
                  <span dir="rtl">{w.word}</span>
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">{w.ipa}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* הגדרות האיכות */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>איכות</span>
              <span className="text-muted-foreground tabular-nums">{steps} צעדים</span>
            </Label>
            <Slider value={[steps]} min={4} max={48} step={2}
              onValueChange={([v]) => setSteps(v)} />
            <p className="text-xs text-muted-foreground">
              יותר צעדים — איכות טובה יותר, והקראה איטית יותר. 16 הוא איזון טוב.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>היצמדות לטקסט</span>
              <span className="text-muted-foreground tabular-nums">{cfg.toFixed(1)}</span>
            </Label>
            <Slider value={[cfg]} min={1} max={6} step={0.5}
              onValueChange={([v]) => setCfg(v)} />
            <p className="text-xs text-muted-foreground">
              גבוה מדי נשמע מאולץ, נמוך מדי מטשטש מילים.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>מהירות</span>
              <span className="text-muted-foreground tabular-nums">{speed.toFixed(2)}</span>
            </Label>
            <Slider value={[speed]} min={0.6} max={1.5} step={0.05}
              onValueChange={([v]) => setSpeed(v)} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="seed-switch" className="text-sm font-medium">תוצאה חוזרת</Label>
            <p className="text-xs text-muted-foreground">
              כשדלוק, אותן הגדרות נותנות בדיוק את אותו קול שוב. הכרחי כדי
              להשוות הגדרות: בלי זה כל הרצה שונה ואין מה להשוות.
            </p>
          </div>
          <Switch id="seed-switch" checked={fixedSeed} onCheckedChange={setFixedSeed} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void handleSpeak()}
            disabled={speaking || !ipaForSpeech.trim()}
            className="gap-2"
          >
            {speaking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {speaking ? 'מקריא…' : 'הקרא במנוע המקומי'}
          </Button>
          {lastTiming && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {lastTiming.seconds.toFixed(1)} שניות קול, נוצרו ב-{lastTiming.elapsed.toFixed(1)} שניות
            </span>
          )}
        </div>

        {audioUrl && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <audio controls src={audioUrl} className="w-full" />
            <a
              href={audioUrl}
              download="הקראה.wav"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              הורד את הקול
            </a>
          </div>
        )}

        <Separator />

        <VoiceClonePanel status={status} onVoicesChanged={() => void refresh()} />
      </CardContent>
    </Card>
  );
}
