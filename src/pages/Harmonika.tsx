import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Loader2, Music2, Headphones, Server, Monitor, Zap, Crown,
  ChevronDown, ChevronUp, Info, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { HarmonyDropzone } from "@/components/harmony/HarmonyDropzone";
import { HarmonyVoiceControls } from "@/components/harmony/HarmonyVoiceControls";
import { HarmonyPlayer } from "@/components/harmony/HarmonyPlayer";
import { HarmonyInlinePlayer } from "@/components/harmony/HarmonyInlinePlayer";
import {
  PRESETS,
  audioBufferToWav,
  decodeAudioFile,
  renderHarmonies,
  type RootNote,
  type ScaleName,
  type Voice,
} from "@/lib/harmony-engine";
import {
  fetchHarmonyCapabilities,
  renderHarmonyServer,
  type HarmonyQuality,
  type HarmonyCapabilities,
} from "@/lib/harmony-api";

const ROOTS: RootNote[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES: { id: ScaleName; label: string }[] = [
  { id: "chromatic", label: "כרומטי (ללא הצמדה)" },
  { id: "major", label: "מז'ור" },
  { id: "minor", label: "מינור" },
  { id: "dorian", label: "דוריאני" },
  { id: "mixolydian", label: "מיקסולידי" },
  { id: "harmonic-minor", label: "מינור הרמוני" },
];

const QUALITY_META: Record<Exclude<HarmonyQuality, "browser">, { icon: typeof Server; label: string; sublabel: string; desc: string; stars: number }> = {
  basic: { icon: Zap, label: "בסיסי", sublabel: "STFT", desc: "מהיר · שמירת פורמנטים", stars: 1 },
  pro: { icon: Server, label: "פרו", sublabel: "WORLD", desc: "צליל טבעי · vocoder מקצועי", stars: 2 },
  studio: { icon: Crown, label: "סטודיו", sublabel: "Demucs + WORLD", desc: "הפרדת שירה · איכות מקסימלית", stars: 3 },
};

const PROCESSING_MESSAGES = [
  "מפריד שירה מליווי...",
  "מנתח תדרי קול...",
  "יוצר הרמוניות...",
  "ממזג את הקולות...",
];

const Harmonika = () => {
  const [file, setFile] = useState<File | null>(null);
  const [voices, setVoices] = useState<Voice[]>(PRESETS[0].voices);
  const [activePreset, setActivePreset] = useState<string>("thirds");
  const [scale, setScale] = useState<ScaleName>("major");
  const [root, setRoot] = useState<RootNote>("C");
  const [dryGain, setDryGain] = useState(85);
  const [wetGain, setWetGain] = useState(45);

  const [rendering, setRendering] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // Quality tier
  const [quality, setQuality] = useState<HarmonyQuality>("browser");
  const [capabilities, setCapabilities] = useState<HarmonyCapabilities | null>(null);
  const [serverChecked, setServerChecked] = useState(false);

  // UX: advanced section toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // UX: animated progress message
  const [progressMsg, setProgressMsg] = useState("");
  const [progressElapsed, setProgressElapsed] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval>>();

  // Check server capabilities on mount
  useEffect(() => {
    fetchHarmonyCapabilities().then((caps) => {
      setCapabilities(caps);
      setServerChecked(true);
      if (caps?.tiers?.studio?.available) setQuality("studio");
      else if (caps?.tiers?.pro?.available) setQuality("pro");
      else if (caps?.tiers?.basic?.available) setQuality("basic");
    });
  }, []);

  // Animated progress messages during processing
  const isProcessing = rendering || previewing;
  useEffect(() => {
    if (!isProcessing) {
      setProgressMsg("");
      setProgressElapsed(0);
      if (progressRef.current) clearInterval(progressRef.current);
      return;
    }
    let idx = 0;
    let sec = 0;
    setProgressMsg(PROCESSING_MESSAGES[0]);
    setProgressElapsed(0);
    progressRef.current = setInterval(() => {
      sec++;
      setProgressElapsed(sec);
      if (sec % 5 === 0) {
        idx = Math.min(idx + 1, PROCESSING_MESSAGES.length - 1);
        setProgressMsg(PROCESSING_MESSAGES[idx]);
      }
    }, 1000);
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [isProcessing]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResultBlob(null);
    setPreviewBlob(null);
    setError(null);
  }, []);

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActivePreset(id);
    setVoices(preset.voices.map((v) => ({ ...v })));
  };

  const handlePreview = async () => {
    if (!file) return;
    setPreviewing(true);
    setError(null);
    try {
      if (quality !== "browser") {
        const blob = await renderHarmonyServer({
          file, voices, scale, root,
          dryGain: dryGain / 100, wetGain: wetGain / 100,
          quality, maxDuration: 10,
        });
        setPreviewBlob(blob);
      } else {
        const buffer = await decodeAudioFile(file);
        const rendered = await renderHarmonies({
          source: buffer, voices,
          dryGain: dryGain / 100, wetGain: wetGain / 100,
          scale, root, maxDuration: 10,
        });
        setPreviewBlob(audioBufferToWav(rendered));
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "לא ניתן ליצור תצוגה מקדימה.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleRender = async () => {
    if (!file) return;
    setRendering(true);
    setError(null);
    try {
      if (quality !== "browser") {
        const blob = await renderHarmonyServer({
          file, voices, scale, root,
          dryGain: dryGain / 100, wetGain: wetGain / 100,
          quality,
        });
        setResultBlob(blob);
      } else {
        const buffer = await decodeAudioFile(file);
        const rendered = await renderHarmonies({
          source: buffer, voices,
          dryGain: dryGain / 100, wetGain: wetGain / 100,
          scale, root,
        });
        setResultBlob(audioBufferToWav(rendered));
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "לא ניתן לעבד. נסה קליפ קצר יותר.");
    } finally {
      setRendering(false);
    }
  };

  const handleDownload = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name.replace(/\.[^.]+$/, "") ?? "harmony"}_harmonized.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalVoices = useMemo(() => voices.length + 1, [voices]);
  const resultName = file ? `${file.name.replace(/\.[^.]+$/, "")} · מהורמן` : "מיקס מהורמן";
  const qualityLabel = quality === "browser" ? "דפדפן" : QUALITY_META[quality].label;

  return (
    <div dir="rtl" className="min-h-screen px-4 py-8 pb-32 md:px-8">
      <div className="mx-auto max-w-4xl">

        {/* ── Header ── */}
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            <span className="bg-gradient-to-l from-primary to-primary/60 bg-clip-text text-transparent">הרמוניקיה</span>
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            העלה שיר · בחר סגנון · קבל מקהלה
          </p>
        </header>

        {/* ── Step 1: Upload ── */}
        <section className="mb-8">
          <HarmonyDropzone onFile={handleFile} fileName={file?.name} />
          {file && (
            <div className="mt-4">
              <HarmonyInlinePlayer file={file} label="שמע את המקור" />
            </div>
          )}
        </section>

        {/* ── Everything below only appears after file is loaded ── */}
        {file && (
          <>
            {/* ── Step 2: Pick a style (presets as quick cards) ── */}
            <section className="mb-8">
              <SectionTitle>בחר סגנון הרמוניה</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={`group relative rounded-xl border px-3 py-3 text-center transition-all ${
                      activePreset === p.id
                        ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">{p.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{p.description}</div>
                    {/* Voice count dots */}
                    <div className="mt-2 flex items-center justify-center gap-1">
                      {p.voices.map((_, i) => (
                        <div key={i} className={`h-1 w-1 rounded-full ${
                          activePreset === p.id ? "bg-primary" : "bg-muted-foreground/40"
                        }`} />
                      ))}
                    </div>
                    {activePreset === p.id && (
                      <CheckCircle2 className="absolute -top-1.5 -right-1.5 h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* ── Quality tier (simplified as pill row) ── */}
            <section className="mb-6">
              <SectionTitle>איכות עיבוד</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                {/* Browser option always available */}
                <QualityPill
                  active={quality === "browser"}
                  onClick={() => setQuality("browser")}
                  icon={<Monitor className="h-4 w-4" />}
                  label="דפדפן"
                  hint="מהיר · ללא שרת"
                  available
                />
                {/* Server tiers */}
                {(["basic", "pro", "studio"] as const).map((tier) => {
                  const meta = QUALITY_META[tier];
                  const Icon = meta.icon;
                  const avail = capabilities?.tiers?.[tier]?.available ?? false;
                  return (
                    <QualityPill
                      key={tier}
                      active={quality === tier}
                      onClick={() => setQuality(tier)}
                      icon={<Icon className="h-4 w-4" />}
                      label={meta.label}
                      hint={meta.desc}
                      available={avail}
                      serverChecked={serverChecked}
                      stars={meta.stars}
                    />
                  );
                })}
              </div>
              {/* One-line explanation of current selection */}
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                {quality === "browser" && "עיבוד בסיסי בדפדפן. לתוצאות טבעיות יותר — בחר מנוע שרת."}
                {quality === "basic" && "עיבוד בשרת עם שמירת צליל הפורמנטים. תוצאות טובות יותר."}
                {quality === "pro" && "Vocoder מקצועי (WORLD). שומר על טבעיות הקול."}
                {quality === "studio" && "הפרדת שירה (Demucs) + WORLD. איכות מקסימלית, לוקח קצת זמן."}
              </p>
            </section>

            {/* ═══════ ACTION ZONE — always visible right after the two main choices ═══════ */}

            {/* ── Processing overlay ── */}
            {isProcessing && (
              <div className="mb-6 flex flex-col items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-8">
                <div className="relative">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary tabular-nums">{progressElapsed}s</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    {previewing ? "יוצר תצוגה מקדימה..." : "מעבד הרמוניות..."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground animate-pulse">{progressMsg}</p>
                </div>
                {/* Progress bar approximation */}
                <div className="w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-all duration-1000 ease-out"
                    style={{ width: `${Math.min(95, progressElapsed * (previewing ? 6 : 2))}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  מנוע: {qualityLabel} · {totalVoices} קולות
                </p>
              </div>
            )}

            {/* ── Action buttons ── */}
            {!isProcessing && (
              <div className="mb-6 flex flex-col items-center gap-3">
                <div className="flex items-center gap-3">
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={handlePreview}
                    disabled={!file}
                    className="rounded-full px-6"
                  >
                    <Headphones className="h-4 w-4" />
                    תצוגה מקדימה (10 שניות)
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleRender}
                    disabled={!file}
                    className="rounded-full px-8"
                  >
                    <Sparkles className="h-4 w-4" />
                    צור הרמוניות
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  <Music2 className="ml-1 inline h-3 w-3" />
                  {totalVoices} קולות · מנוע {qualityLabel}
                </p>
              </div>
            )}

            {/* ── Error ── */}
            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="mr-auto rounded p-0.5 text-destructive/60 transition-colors hover:text-destructive"
                  aria-label="סגור שגיאה"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>
            )}

            {/* ── Preview Player (inline — appears right below action) ── */}
            {previewBlob && (
              <div className="mb-6">
                <HarmonyPlayer
                  blob={previewBlob}
                  fileName={`${file?.name.replace(/\.[^.]+$/, "") ?? "preview"} · תצוגה מקדימה`}
                  onClose={() => setPreviewBlob(null)}
                  inline
                />
              </div>
            )}

            {/* ═══════ FINE-TUNING — collapsible, for advanced users ═══════ */}

            {/* ── Advanced (collapsible: mix, scale, voices) ── */}
            <section className="mb-8">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                כוונון עדין — מיקס, סולם, טוניקה, עריכת קולות
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-6 rounded-xl border border-border bg-card/50 p-4">
                  {/* Mix sliders */}
                  <div>
                    <span className="mb-3 block text-xs font-medium text-muted-foreground">מיקס — יחס מקור / הרמוניות</span>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-2 flex justify-between text-xs">
                          <span className="text-muted-foreground">עוצמת המקור</span>
                          <span className="font-medium tabular-nums">{dryGain}%</span>
                        </div>
                        <Slider min={0} max={100} step={1} value={[dryGain]} onValueChange={([v]) => setDryGain(v)} />
                      </div>
                      <div>
                        <div className="mb-2 flex justify-between text-xs">
                          <span className="text-muted-foreground">עוצמת ההרמוניות</span>
                          <span className="font-medium tabular-nums">{wetGain}%</span>
                        </div>
                        <Slider min={0} max={100} step={1} value={[wetGain]} onValueChange={([v]) => setWetGain(v)} />
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border" />

                  {/* Scale & Root */}
                  <div>
                    <span className="mb-3 block text-xs font-medium text-muted-foreground">סולם וטוניקה</span>
                    <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-muted-foreground">טוניקה (שורש)</span>
                        <select
                          value={root}
                          onChange={(e) => setRoot(e.target.value as RootNote)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        >
                          {ROOTS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-muted-foreground">סולם</span>
                        <select
                          value={scale}
                          onChange={(e) => setScale(e.target.value as ScaleName)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        >
                          {SCALES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border" />

                  {/* Voice editor */}
                  <div>
                    <span className="mb-2 block text-xs font-medium text-muted-foreground">עריכת קולות ידנית</span>
                    <HarmonyVoiceControls voices={voices} onChange={setVoices} />
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {file && (
          <footer className="mt-8 text-center text-xs text-muted-foreground">
            {quality === "browser" && "Tone.js · Phase-vocoder pitch shifting · ללא שרתים"}
            {quality === "basic" && "STFT Pitch Shift · Formant preservation · שרת מקומי"}
            {quality === "pro" && "WORLD Vocoder · Natural F0 shifting · שרת CUDA"}
            {quality === "studio" && "Demucs + WORLD · Vocal separation + vocoder · שרת CUDA"}
          </footer>
        )}
      </div>

      <HarmonyPlayer
        blob={resultBlob}
        fileName={resultName}
        onClose={() => setResultBlob(null)}
        onDownload={handleDownload}
      />
    </div>
  );
};

/* ── Section title ── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold text-foreground">{children}</h2>
  );
}

/* ── Quality pill ── */
function QualityPill({
  active,
  onClick,
  icon,
  label,
  hint,
  available,
  serverChecked,
  stars,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  available: boolean;
  serverChecked?: boolean;
  stars?: number;
}) {
  const disabled = !available && serverChecked !== undefined && serverChecked;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
        active
          ? "border-primary bg-primary/10 text-primary shadow-sm"
          : disabled
          ? "cursor-not-allowed border-border/40 text-muted-foreground/40"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
      {stars != null && (
        <span className="text-[10px]">{"★".repeat(stars)}</span>
      )}
      {disabled && <span className="text-[10px] text-destructive/70">(לא זמין)</span>}
    </button>
  );
}

export default Harmonika;
