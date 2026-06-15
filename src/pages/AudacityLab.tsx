import { useMemo, useRef, useState, lazy, Suspense, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  CheckCircle2,
  FileAudio,
  Filter,
  LibraryBig,
  Search,
  Shield,
  Sparkles,
  UploadCloud,
  Waves,
  Loader2,
  SlidersHorizontal
} from "lucide-react";
import AudioEnhanceDialog from "@/components/AudioEnhanceDialog";
import { LazyErrorBoundary } from "@/components/LazyErrorBoundary";

const SyncAudioPlayer = lazy(() => import("@/components/SyncAudioPlayer").then(m => ({ default: m.SyncAudioPlayer })));

type FunctionCategory =
  | "noise"
  | "voice"
  | "eq"
  | "repair"
  | "time"
  | "plugins"
  | "export";

type AudacityFunction = {
  nameHe: string;
  nameEn: string;
  category: FunctionCategory;
  description: string;
  bestFor: string;
  keyParams: string;
};

const AUDACITY_FUNCTIONS: AudacityFunction[] = [
  { nameHe: "הפחתת רעש", nameEn: "Noise Reduction", category: "noise", description: "לומד פרופיל רעש ומפחית אותו מהאות.", bestFor: "רעש קבוע: מזגן, מאוורר", keyParams: "Noise reduction / Sensitivity / Frequency smoothing" },
  { nameHe: "Noise Gate", nameEn: "Noise Gate", category: "noise", description: "מנמיך קטעים חלשים מתחת לסף.", bestFor: "רעש רקע בין משפטים", keyParams: "Gate threshold / Attack / Release" },
  { nameHe: "Loudness Normalization", nameEn: "Loudness Normalization", category: "noise", description: "איזון עוצמה לפי LUFS לתוצאה עקבית.", bestFor: "פודקאסט/הרצאה", keyParams: "LUFS target / True peak" },
  { nameHe: "Normalize", nameEn: "Normalize", category: "noise", description: "מנרמל פיקים ומסיר DC offset.", bestFor: "קבצים בעוצמה לא אחידה", keyParams: "Normalize peak / Remove DC" },
  { nameHe: "Truncate Silence", nameEn: "Truncate Silence", category: "noise", description: "מקצר שקטים ארוכים.", bestFor: "האצת זרימת תמלול", keyParams: "Silence threshold / Duration / Compress ratio" },

  { nameHe: "בידוד/הפחתת שירה", nameEn: "Vocal Reduction and Isolation", category: "voice", description: "הדגשת ערוץ ווקאל או דיכויו לפי מצב.", bestFor: "דיבור עם מוזיקה", keyParams: "Action / Strength / Frequency band" },
  { nameHe: "Auto Duck", nameEn: "Auto Duck", category: "voice", description: "מוריד מוזיקה כשיש דיבור.", bestFor: "ווידאו עם קריינות", keyParams: "Duck amount / Threshold / Fade" },
  { nameHe: "Voice emphasis with EQ", nameEn: "Speech Presence EQ", category: "voice", description: "הדגשת תחום מובנות הדיבור.", bestFor: "קול עמום", keyParams: "2kHz-5kHz boost / Low-cut" },

  { nameHe: "Filter Curve EQ", nameEn: "Filter Curve EQ", category: "eq", description: "עקומת EQ חופשית ומדויקת.", bestFor: "עיצוב טון מקצועי", keyParams: "Curve points / Shelf / Cut" },
  { nameHe: "Graphic EQ", nameEn: "Graphic EQ", category: "eq", description: "שליטה מהירה בבנדים קבועים.", bestFor: "תיקון מהיר", keyParams: "31-band gain" },
  { nameHe: "High-Pass Filter", nameEn: "High-Pass Filter", category: "eq", description: "חותך תדרים נמוכים.", bestFor: "רום וזמזום נמוך", keyParams: "Cutoff / Rolloff" },
  { nameHe: "Low-Pass Filter", nameEn: "Low-Pass Filter", category: "eq", description: "חותך תדרים גבוהים.", bestFor: "ששש/היס", keyParams: "Cutoff / Rolloff" },
  { nameHe: "Notch Filter", nameEn: "Notch Filter", category: "eq", description: "חותך תדר צר מאוד.", bestFor: "50/60Hz וההרמוניות", keyParams: "Center frequency / Q" },
  { nameHe: "Compressor", nameEn: "Compressor", category: "eq", description: "מצמצם טווח דינמי לשמיעה יציבה.", bestFor: "דיבור עם קפיצות עוצמה", keyParams: "Threshold / Ratio / Attack / Release" },
  { nameHe: "Limiter", nameEn: "Limiter", category: "eq", description: "מונע קליפינג בפיקים.", bestFor: "ייצוא בטוח", keyParams: "Ceiling / Lookahead" },

  { nameHe: "Click Removal", nameEn: "Click Removal", category: "repair", description: "מסיר קליקים ופופים קצרים.", bestFor: "מיקרופון/כבל בעייתי", keyParams: "Threshold / Max spike width" },
  { nameHe: "Repair", nameEn: "Repair", category: "repair", description: "תיקון נקודתי לקטע קצר פגום.", bestFor: "גליץ' רגעי", keyParams: "Selection length (very short)" },
  { nameHe: "Clip Fix", nameEn: "Clip Fix", category: "repair", description: "שחזור חלקי של קליפינג.", bestFor: "הקלטה רוויה", keyParams: "Threshold" },
  { nameHe: "Fade In", nameEn: "Fade In", category: "repair", description: "כניסה חלקה.", bestFor: "תחילת קליפ", keyParams: "Curve shape" },
  { nameHe: "Fade Out", nameEn: "Fade Out", category: "repair", description: "יציאה חלקה.", bestFor: "סיום קליפ", keyParams: "Curve shape" },
  { nameHe: "Crossfade Clips", nameEn: "Crossfade Clips", category: "repair", description: "מעבר חלק בין שני קליפים.", bestFor: "עריכה ללא קפיצות", keyParams: "Fade overlap" },

  { nameHe: "Change Tempo", nameEn: "Change Tempo", category: "time", description: "שינוי מהירות בלי לשנות גובה צליל.", bestFor: "קיצור זמן האזנה", keyParams: "Percent change" },
  { nameHe: "Change Pitch", nameEn: "Change Pitch", category: "time", description: "שינוי גובה צליל בלי לשנות קצב.", bestFor: "התאמות קול נקודתיות", keyParams: "Semitones / From-To" },
  { nameHe: "Sliding Stretch", nameEn: "Sliding Stretch", category: "time", description: "שינוי זמן/פיץ' דינמי לאורך הקטע.", bestFor: "אפקטים יצירתיים", keyParams: "Initial/Final tempo/pitch" },
  { nameHe: "Paulstretch", nameEn: "Paulstretch", category: "time", description: "מתיחת זמן קיצונית.", bestFor: "סאונד-דיזיין", keyParams: "Stretch factor" },

  { nameHe: "Nyquist Prompt", nameEn: "Nyquist Prompt", category: "plugins", description: "הרצת סקריפטים של Nyquist.", bestFor: "אוטומציות ואפקטים מותאמים", keyParams: "Nyquist script" },
  { nameHe: "VST3 Support", nameEn: "VST3 Plugins", category: "plugins", description: "טעינת פלאגינים מקצועיים.", bestFor: "שרשרת מיקס מתקדמת", keyParams: "Plugin preset" },
  { nameHe: "LV2 Support", nameEn: "LV2 Plugins", category: "plugins", description: "תמיכה בפלאגינים בקוד פתוח.", bestFor: "תוספים חינמיים", keyParams: "Plugin config" },
  { nameHe: "LADSPA Support", nameEn: "LADSPA Plugins", category: "plugins", description: "תמיכה רחבה בפלאגינים ותיקים.", bestFor: "אפקטים קלים", keyParams: "Plugin config" },
  { nameHe: "Macros", nameEn: "Macros/Batch", category: "plugins", description: "אוטומציה של שרשראות אפקטים.", bestFor: "עיבוד קבצים מרובים", keyParams: "Step order / Batch target" },

  { nameHe: "ייבוא FFmpeg", nameEn: "FFmpeg Import", category: "export", description: "ייבוא פורמטים וידאו/אודיו רבים.", bestFor: "מקורות מגוונים", keyParams: "Codec detection" },
  { nameHe: "ייצוא MP3", nameEn: "Export MP3", category: "export", description: "ייצוא דחוס לשיתוף.", bestFor: "הפצה מהירה", keyParams: "Bitrate / Joint stereo" },
  { nameHe: "ייצוא WAV", nameEn: "Export WAV", category: "export", description: "ייצוא ללא דחיסה.", bestFor: "איכות מקסימלית לתמלול", keyParams: "PCM bit depth" },
  { nameHe: "ייצוא FLAC", nameEn: "Export FLAC", category: "export", description: "ללא איבוד נתונים עם נפח נמוך.", bestFor: "ארכיון איכותי", keyParams: "Compression level" },
  { nameHe: "Metadata Tags", nameEn: "Metadata Editor", category: "export", description: "עריכת תגיות לקובץ הסופי.", bestFor: "ניהול ספריה", keyParams: "Title/Artist/Comments" },
];

const CATEGORY_META: Record<FunctionCategory, { label: string; description: string }> = {
  noise: { label: "ניקוי רעשים", description: "הפחתת רעשי רקע, איזון עוצמה ושקטים" },
  voice: { label: "הפרדת קול", description: "התמקדות בקול דובר מול מוזיקה וסביבה" },
  eq: { label: "EQ ודינמיקה", description: "טיוב תדרים, קומפרסיה ומניעת קליפינג" },
  repair: { label: "תיקון איכות", description: "תיקון קליקים, גליצ'ים ומעברים" },
  time: { label: "זמן וקצב", description: "שינוי טמפו/פיץ' וכלי תזמון" },
  plugins: { label: "תוספים ואוטומציה", description: "Nyquist, VST, LV2, LADSPA ו-Macros" },
  export: { label: "ייצוא ותאימות", description: "פורמטים, מטאדאטה ו-FFmpeg" },
};

const SMART_PRESETS: Record<string, string[]> = {
  "הקלטת דיבור רועשת": [
    "Loudness Normalization",
    "High-Pass Filter",
    "Noise Reduction",
    "Compressor",
    "Limiter",
  ],
  "דיבור עם מוזיקה ברקע": [
    "Vocal Reduction and Isolation",
    "Filter Curve EQ",
    "Auto Duck",
    "Noise Gate",
    "Limiter",
  ],
  "פודקאסט נקי ומאוזן": [
    "High-Pass Filter",
    "Compressor",
    "De-esser (VST)",
    "Loudness Normalization",
    "Export WAV",
  ],
  "תיקון קליקים וזמזום": [
    "Notch Filter",
    "Click Removal",
    "Repair",
    "Clip Fix",
    "Normalize",
  ],
};

export default function AudacityLab() {
  const [search, setSearch] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("הקלטת דיבור רועשת");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSourceFile(e.target.files[0]);
    }
  };

  useEffect(() => {
    if (sourceFile) {
      const url = URL.createObjectURL(sourceFile);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioUrl(null);
    }
  }, [sourceFile]);

  const filteredBySearch = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return AUDACITY_FUNCTIONS;
    return AUDACITY_FUNCTIONS.filter((item) => {
      return (
        item.nameHe.toLowerCase().includes(needle) ||
        item.nameEn.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.bestFor.toLowerCase().includes(needle)
      );
    });
  }, [search]);

  const smartChain = SMART_PRESETS[selectedPreset] || [];

  const renderFunctionCards = (category: FunctionCategory) => {
    const items = filteredBySearch.filter((f) => f.category === category);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((fn) => (
          <Card key={`${fn.nameEn}-${fn.category}`} className="border border-border/70 hover:border-primary/40 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary" />
                {fn.nameHe}
              </CardTitle>
              <CardDescription className="text-xs">{fn.nameEn}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="font-semibold">מה זה:</span> {fn.description}</p>
              <p><span className="font-semibold">שימוש מומלץ:</span> {fn.bestFor}</p>
              <p><span className="font-semibold">פרמטרים מרכזיים:</span> {fn.keyParams}</p>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground text-center">
              לא נמצאו פונקציות בקטגוריה זו לפי החיפוש.
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-full px-4 py-6 space-y-6" dir="rtl">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-l from-amber-50 via-background to-sky-50 p-5">
        <div className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="absolute -bottom-10 -right-10 h-36 w-36 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1"><Waves className="w-3.5 h-3.5" /> Audacity Open Source</Badge>
            <Badge variant="outline" className="gap-1"><Shield className="w-3.5 h-3.5" /> טאב מבודד</Badge>
            <Badge variant="outline" className="gap-1"><Bot className="w-3.5 h-3.5" /> המלצות חכמות</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">אודסיטי לאב: ניקוי רעשים והפרדת קול</h1>
          <p className="text-sm md:text-base text-muted-foreground max-w-4xl">
            טאב זה נפרד מהמערכת הקיימת שלך ולא משנה את תמלול/שרת/סטודיו קול. הוא נבנה להשוואה ובידוד יכולות,
            עם קטלוג פונקציות Audacity בעברית, כולל הפרדת קול, ניקוי רעשים, EQ, תיקונים, תוספים וייצוא.
          </p>
        </div>
      </div>

      <Tabs defaultValue="studio" className="space-y-6">
        <TabsList className="h-auto p-1.5 rounded-xl bg-muted/60 border flex flex-wrap justify-start gap-1">
          <TabsTrigger value="studio" className="rounded-lg data-[state=active]:shadow-sm gap-2 text-primary data-[state=active]:bg-primary/10">
            <SlidersHorizontal className="w-4 h-4" /> אולפן ידני וניקוי ערוצים (איקולייזר מתקדם)
          </TabsTrigger>
          <TabsTrigger value="ai-studio" className="rounded-lg data-[state=active]:shadow-sm gap-2">
            <Sparkles className="w-4 h-4" /> אולפן אוטומטי מבוסס AI
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="rounded-lg data-[state=active]:shadow-sm gap-2">
            <LibraryBig className="w-4 h-4" /> קטלוג פונקציות ומידע
          </TabsTrigger>
        </TabsList>

        <TabsContent value="studio" className="space-y-6">
          {!audioUrl || !sourceFile ? (
            <Card className="border-primary/20 shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <SlidersHorizontal className="w-6 h-6 text-primary" />
                  אולפן מיקסר מקצועי ואיקולייזר ידני (Web Audio)
                </CardTitle>
                <CardDescription className="text-base text-muted-foreground max-w-3xl">
                  העלה קובץ כדי לפתוח איקולייזר משוכלל (EQ), פילטרים לניקוי תדרים (Lowpass/Highpass), בידוד ערוצים, מדכא הדהוד (De-Hum), ו-Noise Gate הניתנים לשליטה מלאה ומדויקת באופן ידני (Real-time).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileChange} 
                  accept="audio/*,video/*" 
                />
                <div 
                  className="border-2 border-dashed rounded-3xl p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-colors border-border bg-muted/10 hover:border-primary/60 hover:bg-muted/30"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <SlidersHorizontal className="w-12 h-12 text-primary" />
                  </div>
                  <p className="text-xl font-medium mb-2">לחץ כדי להעלות קובץ ולפתוח את לוח הבקרה הידני</p>
                  <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                    ייפתח נגן משוכלל הכולל בתוכו סליידרים ידניים לניקוי, שליטה באיקולייזר, זיהוי קולי וייצוא חלקים ספציפיים.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/5 text-primary border border-primary/20">
                  <FileAudio className="w-5 h-5" />
                  <span className="font-semibold">{sourceFile.name} נטען באולפן המתקדם</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setSourceFile(null); setAudioUrl(null); }}>
                  החלף קובץ
                </Button>
              </div>
              <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm p-1">
                <LazyErrorBoundary label="נגן סטודיו אקולייזר">
                  <Suspense fallback={<div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}>
                    <SyncAudioPlayer
                      audioUrl={audioUrl}
                      wordTimings={[]}
                      currentTime={0}
                      onTimeUpdate={() => {}}
                    />
                  </Suspense>
                </LazyErrorBoundary>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai-studio" className="space-y-6">
          <Card className="border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-primary" />
                תהליך ניקוי אוטומטי מבוסס מודלי AI מתוך שרת 
              </CardTitle>
              <CardDescription className="text-base text-muted-foreground max-w-3xl">
                במקום לכוון הכל ידנית, כאן המערכת משתמשת בתהליך אוטומטי וחכם לניקוי רעשים באופן עמוק ומיישמת איקולייזר (EQ) דינמי דרך השרת (FFmpeg & MetricGAN) בלחיצת כפתור אחת.
              </CardDescription>
            </CardHeader>
            <CardContent>
              { /* Re-using same file input logic just pointing to the dialog */ }
              <div 
                className="border-2 border-dashed rounded-3xl p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-colors border-border bg-muted/10 hover:border-primary/60 hover:bg-muted/30"
                onClick={() => {
                  fileInputRef.current?.click();
                  setEnhanceDialogOpen(true);
                }}
              >
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <UploadCloud className="w-12 h-12 text-primary" />
                </div>
                <p className="text-xl font-medium mb-2">לחץ כאן כדי להעלות קובץ אודיו או וידאו</p>
                <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                  הקובץ יעלה ותיפתח חלונית אוטומטית שבה תוכל לבחור פריסט ערוך (כמו 'הקלטת פודקאסט') והשרת יעשה את השאר.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      <TabsContent value="knowledge" className="space-y-6">
          <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              המלצה חכמה לפי תרחיש
            </CardTitle>
            <CardDescription>
              בחר תרחיש וקבל שרשרת מומלצת של פונקציות מתוך Audacity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {Object.keys(SMART_PRESETS).map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={preset === selectedPreset ? "default" : "outline"}
                  onClick={() => setSelectedPreset(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>

            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-sm font-semibold mb-2">שרשרת מומלצת:</p>
              <div className="flex flex-wrap gap-2">
                {smartChain.map((step, index) => (
                  <Badge key={`${step}-${index}`} className="gap-1" variant="secondary">
                    <CheckCircle2 className="w-3 h-3" />
                    {index + 1}. {step}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <LibraryBig className="w-5 h-5 text-primary" />
              קטלוג פונקציות Audacity (מתורגם לעברית)
            </CardTitle>
            <CardDescription>
              מוצגות כל הקטגוריות המרכזיות לעבודה חכמה: ניקוי רעשים, הפרדת קול, EQ, תיקון איכות, זמן/קצב, תוספים וייצוא.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9"
                placeholder="חיפוש פונקציה בעברית/אנגלית (למשל: Noise, EQ, ווקאל, קליקים...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Tabs defaultValue="noise" className="space-y-4">
              <TabsList className="h-auto p-1.5 rounded-xl bg-muted/60 border flex flex-wrap justify-start gap-1">
                {(Object.keys(CATEGORY_META) as FunctionCategory[]).map((category) => (
                  <TabsTrigger key={category} value={category} className="rounded-lg data-[state=active]:shadow-sm">
                    {CATEGORY_META[category].label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(Object.keys(CATEGORY_META) as FunctionCategory[]).map((category) => (
                <TabsContent key={category} value={category} className="space-y-3">
                  <div className="text-sm text-muted-foreground">{CATEGORY_META[category].description}</div>
                  {renderFunctionCards(category)}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </TabsContent>
      </Tabs>

      {sourceFile && (
        <AudioEnhanceDialog
          open={enhanceDialogOpen}
          onOpenChange={setEnhanceDialogOpen}
          file={sourceFile}
          sourceLabel={sourceFile.name}
        />
      )}
    </div>
  );
}
