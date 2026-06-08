import { useState, useEffect, useCallback, memo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Globe, Cpu, Zap, Chrome, Mic, Waves, Server, Power, PowerOff, Loader2, CheckCircle2, XCircle, Copy, Rabbit, Turtle, Settings, ChevronDown, Flame, Download, Sparkles, Link2, KeyRound } from "lucide-react";
import { useLocalServer } from "@/hooks/useLocalServer";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import { getApiKey } from "@/lib/keyCrypto";
import { ApiKeyUsagePanel } from "@/components/ApiKeyUsagePanel";

type Engine = 'openai' | 'groq' | 'google' | 'local' | 'local-server' | 'assemblyai' | 'deepgram';
type SourceLanguage = 'auto' | 'he' | 'yi' | 'en';

interface TranscriptionEngineProps {
  selected: Engine;
  onChange: (engine: Engine) => void;
  sourceLanguage: SourceLanguage;
  onSourceLanguageChange: (lang: SourceLanguage) => void;
  groqKeysText?: string;
}

const getLocalModelLabel = (): string => {
  const preferred = localStorage.getItem('preferred_local_model');
  if (preferred) return preferred.split('/').pop() || 'Local';
  return 'whisper-tiny';
};

const START_CMD_LOCAL = '.\\scripts\\start-whisper-server.ps1';
const START_CMD_LOVABLE = '.\\scripts\\start-lovable.ps1';

// True remote = not localhost AND server URL is explicitly set to a non-localhost address
const isNonLocalHost = !['localhost', '127.0.0.1'].includes(window.location.hostname);
const hasCustomServerUrl = () => {
  const url = localStorage.getItem('whisper_server_url') || '';
  if (url === '' || url.startsWith('/')) return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1');
};

export const TranscriptionEngine = memo(({ selected, onChange, sourceLanguage, onSourceLanguageChange, groqKeysText = "" }: TranscriptionEngineProps) => {
  const isMobile = useIsMobile();
  const { isConnected, serverStatus, checkConnection, startPolling, stopPolling, shutdownServer, warmupServer, preloadModelStream, cancelPreload, modelReady, modelLoading, getBaseUrl } = useLocalServer();
  const { preferences: cloudPrefs, updatePreferences, isLoaded: cloudLoaded } = useCloudPreferences();
  const cloudSynced = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [fastMode, setFastMode] = useState(() => localStorage.getItem('cuda_fast_mode') === '1');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [computeType, setComputeType] = useState(() => localStorage.getItem('cuda_compute_type') || 'int8_float16');
  const [beamSize, setBeamSize] = useState(() => parseInt(localStorage.getItem('cuda_beam_size') || '0'));
  const [noConditionPrev, setNoConditionPrev] = useState(() => localStorage.getItem('cuda_no_condition_prev') === '1');
  const [vadAggressive, setVadAggressive] = useState(() => localStorage.getItem('cuda_vad_aggressive') === '1');
  const [preset, setPreset] = useState<'fast' | 'balanced' | 'accurate'>(() => (localStorage.getItem('cuda_preset') as 'fast' | 'balanced' | 'accurate') || 'balanced');

  // Sync local state from cloud preferences (handles login from new machine)
  useEffect(() => {
    if (!cloudLoaded || cloudSynced.current) return;
    cloudSynced.current = true;
    setPreset(cloudPrefs.cuda_preset as 'fast' | 'balanced' | 'accurate');
    setFastMode(cloudPrefs.cuda_fast_mode);
    setComputeType(cloudPrefs.cuda_compute_type);
    setBeamSize(cloudPrefs.cuda_beam_size);
    setNoConditionPrev(cloudPrefs.cuda_no_condition_prev);
    setVadAggressive(cloudPrefs.cuda_vad_aggressive);
    setHotwords(cloudPrefs.cuda_hotwords);
    setParagraphThreshold(cloudPrefs.cuda_paragraph_threshold);
    setPreloadMode(cloudPrefs.cuda_preload_mode as 'preload' | 'direct');
    setCloudSaveMode(cloudPrefs.cuda_cloud_save as 'immediate' | 'text-only' | 'skip');
  }, [cloudLoaded, cloudPrefs]);

  const applyPreset = useCallback((p: 'fast' | 'balanced' | 'accurate') => {
    setPreset(p);
    const presets = {
      fast:     { fastMode: true,  beamSize: 1, computeType: 'int8_float16', noConditionPrev: true,  vadAggressive: true  },
      balanced: { fastMode: true,  beamSize: 1, computeType: 'int8_float16', noConditionPrev: true,  vadAggressive: false },
      accurate: { fastMode: false, beamSize: 5, computeType: 'float16',      noConditionPrev: false, vadAggressive: false },
    };
    const cfg = presets[p];
    setFastMode(cfg.fastMode);
    setBeamSize(cfg.beamSize);
    setComputeType(cfg.computeType);
    setNoConditionPrev(cfg.noConditionPrev);
    setVadAggressive(cfg.vadAggressive);
    updatePreferences({
      cuda_preset: p,
      cuda_fast_mode: cfg.fastMode,
      cuda_beam_size: cfg.beamSize,
      cuda_compute_type: cfg.computeType,
      cuda_no_condition_prev: cfg.noConditionPrev,
      cuda_vad_aggressive: cfg.vadAggressive,
    });
    const labels = { fast: '⚡ מהיר — מהירות מקסימלית', balanced: '⚖️ מאוזן — ברירת מחדל', accurate: '🎯 מדויק — דיוק מקסימלי' };
    toast({ title: `ערכת תמלול: ${labels[p]}` });
  }, [updatePreferences]);
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [preloadMode, setPreloadMode] = useState<'preload' | 'direct'>(() => (localStorage.getItem('cuda_preload_mode') as 'preload' | 'direct') || 'preload');
  const [preloadMsg, setPreloadMsg] = useState('');
  const [cloudSaveMode, setCloudSaveMode] = useState<'immediate' | 'text-only' | 'skip'>(() => (localStorage.getItem('cuda_cloud_save') as 'immediate' | 'text-only' | 'skip') || 'immediate');
  const [hotwords, setHotwords] = useState(() => localStorage.getItem('cuda_hotwords') || '');
  const [paragraphThreshold, setParagraphThreshold] = useState(() => parseFloat(localStorage.getItem('cuda_paragraph_threshold') || '0'));
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('whisper_server_url') || '');
  const [apiKey, setApiKey] = useState(() => getApiKey('whisper_api_key'));
  const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem('ollama_base_url') || '');
  const [groqUsageOpen, setGroqUsageOpen] = useState(false);
  const [groqMaxUsagePct, setGroqMaxUsagePct] = useState(0);

  const groqUsageColorClass = groqMaxUsagePct > 80
    ? "text-red-600"
    : groqMaxUsagePct > 50
      ? "text-amber-500"
      : "text-blue-900";

  // "True remote" = non-localhost site + custom remote URL configured
  // If on Lovable but targeting localhost:3000, that's local-via-web, NOT remote
  const isRemoteAccess = isNonLocalHost && hasCustomServerUrl();

  // When user selects CUDA server — single check first, poll only if server responds
  useEffect(() => {
    if (selected === 'local-server') {
      checkConnection().then(ok => {
        if (ok) {
          setIsStarting(false);
          startPolling(10000);
        }
      });
      return () => stopPolling();
    } else {
      stopPolling();
      setIsStarting(false);
    }
  }, [selected, checkConnection, startPolling, stopPolling]);

  // Clear isStarting when connection succeeds
  useEffect(() => {
    if (isConnected && isStarting) {
      setIsStarting(false);
    }
  }, [isConnected, isStarting]);

  // Auto-preload model when connected + preload mode
  useEffect(() => {
    if (selected === 'local-server' && isConnected && preloadMode === 'preload' && !modelReady && !modelLoading) {
      preloadModelStream(undefined, undefined, (msg) => setPreloadMsg(msg)).then((r) => {
        if (r.ready) {
          toast({ title: '✅ המודל מוכן!', description: r.elapsed ? `נטען ב-${r.elapsed}s` : 'המודל טעון ומוכן לתמלול' });
        }
        setPreloadMsg('');
      }).catch(() => setPreloadMsg(''));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, isConnected, preloadMode]);

  const handleStartServer = useCallback(async () => {
    setIsStarting(true);
    try {
      const res = await fetch('/__api/start-server', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: "🚀 השרת מופעל!",
          description: data.message === 'already running' ? 'השרת כבר רץ, ממתין לחיבור...' : 'השרת עולה, ממתין לחיבור...',
        });
        startPolling(3000, 120000);
      } else {
        throw new Error(data.error || 'Failed to start');
      }
    } catch (err: any) {
      // Fallback: try launcher service on 8764
      try {
        const launcherRes = await fetch('http://localhost:8764/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'whisper' }), signal: AbortSignal.timeout(15000) });
        const launcherData = await launcherRes.json();
        if (launcherData.ok) {
          toast({
            title: "🚀 השרת מופעל!",
            description: launcherData.results?.whisper?.message === 'already running' ? 'השרת כבר רץ, ממתין לחיבור...' : 'שרת CUDA + Ollama עולים...',
          });
          startPolling(3000, 120000);
          setTimeout(() => setIsStarting(false), 120000);
          return;
        }
      } catch {
        // launcher not available either
      }
      toast({
        title: "שגיאה בהפעלת השרת",
        description: "לא ניתן להפעיל. הפעל ידנית בטרמינל.",
        variant: "destructive",
      });
      setIsStarting(false);
    }
  }, [startPolling]);

  return (
    <Card className="p-5 shadow-sm border-border/60" dir="rtl">
      <h2 className="text-base font-semibold mb-3 text-right text-foreground">בחר מנוע תמלול</h2>
      
      <div className="mb-3">
        <h3 className="text-xs font-medium mb-2 text-right text-muted-foreground tracking-wide">☁️ מנועים אונליין</h3>
        <RadioGroup value={selected} onValueChange={(value) => onChange(value as Engine)}>
          <div className="grid grid-cols-5 gap-2">
            {([
              { id: 'groq' as Engine, icon: Zap, label: 'Groq', sub: 'whisper-large-v3-turbo' },
              { id: 'openai' as Engine, icon: Globe, label: 'OpenAI', sub: 'whisper-1' },
              { id: 'google' as Engine, icon: Chrome, label: 'Google', sub: 'Speech-to-Text' },
              { id: 'assemblyai' as Engine, icon: Mic, label: 'AssemblyAI', sub: 'Universal' },
              { id: 'deepgram' as Engine, icon: Waves, label: 'Deepgram', sub: 'nova-2' },
            ] as const).map(({ id, icon: Icon, label, sub }) => (
              <Label
                key={id}
                htmlFor={id}
                className={`relative flex flex-col items-center justify-center p-2.5 border rounded-xl cursor-pointer transition-all duration-150 hover:border-primary/60 hover:shadow-sm ${
                  selected === id ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20' : 'border-border/50 bg-card'
                }`}
              >
                <RadioGroupItem value={id} id={id} className="sr-only" />
                {id === 'groq' && (
                  isMobile ? (
                    <Drawer open={groqUsageOpen} onOpenChange={setGroqUsageOpen}>
                      <DrawerTrigger asChild>
                        <button
                          type="button"
                          aria-label="מידע ניצול מפתחות Groq"
                          title="ניצול מפתחות Groq"
                          className="absolute top-1.5 left-1.5 z-10 rounded-md p-1 hover:bg-primary/10"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <Settings className={`h-3.5 w-3.5 ${groqUsageColorClass}`} />
                        </button>
                      </DrawerTrigger>
                      <DrawerContent dir="rtl" className="max-h-[80vh]">
                        <DrawerHeader className="pb-2">
                          <DrawerTitle className="flex items-center justify-center gap-2 text-sm">
                            <KeyRound className={`h-4 w-4 ${groqUsageColorClass}`} />
                            ניצול מפתחות Groq (24 שעות)
                          </DrawerTitle>
                        </DrawerHeader>
                        <div className="px-4 pb-4 overflow-y-auto">
                          <ApiKeyUsagePanel
                            provider="groq"
                            keysText={groqKeysText}
                            onUsageLevelChange={setGroqMaxUsagePct}
                          />
                        </div>
                      </DrawerContent>
                    </Drawer>
                  ) : (
                    <Popover open={groqUsageOpen} onOpenChange={setGroqUsageOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="מידע ניצול מפתחות Groq"
                          title="ניצול מפתחות Groq"
                          className="absolute top-1.5 left-1.5 z-10 rounded-md p-1 hover:bg-primary/10"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <Settings className={`h-3.5 w-3.5 ${groqUsageColorClass}`} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(92vw,30rem)] max-h-[70vh] overflow-y-auto" side="bottom" align="end" sideOffset={8} dir="rtl">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                          <KeyRound className={`h-4 w-4 ${groqUsageColorClass}`} />
                          ניצול מפתחות Groq (24 שעות)
                        </div>
                        <ApiKeyUsagePanel
                          provider="groq"
                          keysText={groqKeysText}
                          onUsageLevelChange={setGroqMaxUsagePct}
                        />
                      </PopoverContent>
                    </Popover>
                  )
                )}
                <Icon className="w-5 h-5 mb-1.5 text-primary/80" />
                <span className="font-medium text-xs leading-tight">{label}</span>
                <span className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{sub}</span>
              </Label>
            ))}
          </div>
        </RadioGroup>
      </div>

      <div>
        <h3 className="text-xs font-medium mb-2 text-right text-muted-foreground tracking-wide">🖥️ מנועים מקומיים</h3>
        <RadioGroup value={selected} onValueChange={(value) => onChange(value as Engine)}>
          <div className="grid grid-cols-2 gap-2">
            <Label 
              htmlFor="local-server" 
              className={`flex flex-col items-center justify-center p-2.5 border rounded-xl cursor-pointer transition-all duration-150 hover:border-primary/60 hover:shadow-sm relative ${
                selected === 'local-server' ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20' : 'border-border/50 bg-card'
              }`}
            >
              <RadioGroupItem value="local-server" id="local-server" className="sr-only" />
              <div className="absolute top-1.5 left-1.5">
                {isConnected ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : isStarting ? (
                  <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-400/70" />
                )}
              </div>
              <Server className="w-5 h-5 mb-1.5 text-primary/80" />
              <span className="font-medium text-xs">שרת CUDA 🖥️</span>
              <span className="text-[9px] text-muted-foreground mt-0.5">GPU + ivrit-ai + faster-whisper</span>
              <Badge variant="secondary" className="mt-1 text-[9px] px-1.5 py-0 h-4">
                מומלץ לעברית 🇮🇱
              </Badge>
            </Label>

            <Label 
              htmlFor="local" 
              className={`flex flex-col items-center justify-center p-2.5 border rounded-xl cursor-pointer transition-all duration-150 hover:border-primary/60 hover:shadow-sm ${
                selected === 'local' ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20' : 'border-border/50 bg-card'
              }`}
            >
              <RadioGroupItem value="local" id="local" className="sr-only" />
              <Cpu className="w-5 h-5 mb-1.5 text-primary/80" />
              <span className="font-medium text-xs">דפדפן (ONNX)</span>
              <span className="text-[9px] text-muted-foreground mt-0.5">IndexedDB / WebGPU</span>
              <Badge variant="secondary" className="mt-1 text-[9px] px-1.5 py-0 h-4">
                מודל: {getLocalModelLabel()}
              </Badge>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Server status panel - shown when CUDA engine selected */}
      {selected === 'local-server' && (
        <div className="mt-3 rounded-lg border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">מחובר</span>
                  {serverStatus?.device && (
                    <Badge variant="outline" className="text-[10px]">
                      {serverStatus.device === 'cuda' ? `GPU ${serverStatus.gpu || ''}` : serverStatus.device}
                    </Badge>
                  )}
                  {serverStatus?.current_model && (
                    <Badge variant="outline" className="text-[10px]">
                      {serverStatus.current_model.split('/').pop()}
                    </Badge>
                  )}
                  {/* Model status badge */}
                  {modelReady ? (
                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300">
                      <Sparkles className="w-3 h-3 ml-1" />
                      מודל מוכן
                    </Badge>
                  ) : modelLoading ? (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300">
                      <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                      טוען מודל...
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      מודל לא טעון
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="text-xs text-red-500 font-medium">
                    {isStarting ? 'מחכה לשרת...' : isRemoteAccess ? 'נדרשת כתובת מרחוק' : 'לא מחובר — הפעל שרת CUDA'}
                  </span>
                </>
              )}
            </div>
            {!isConnected ? (
              isRemoteAccess ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-7"
                  onClick={(e) => {
                    e.preventDefault();
                    setAdvancedOpen(true);
                  }}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  הגדר כתובת שרת
                </Button>
              ) : isNonLocalHost ? (
                /* On hosted Lovable site — try launcher (8764) first, then direct check */
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1.5 text-xs h-7"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (window.location.protocol === 'https:') {
                      toast({
                        title: '🔒 הדפדפן חוסם גישה ל-localhost',
                        description: 'באתר מאובטח (HTTPS) יש להגדיר כתובת שרת מרוחקת או להריץ את האפליקציה מקומית.',
                        variant: 'destructive',
                      });
                      setAdvancedOpen(true);
                      return;
                    }
                    setIsStarting(true);
                    // 1. Try the launcher service (port 8764) — has PNA + CORS headers
                    try {
                      const launcherRes = await fetch('http://localhost:8764/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target: 'whisper' }),
                        signal: AbortSignal.timeout(15000),
                      });
                      const launcherData = await launcherRes.json();
                      if (launcherData.ok) {
                        toast({
                          title: '🚀 השרת מופעל!',
                          description: launcherData.results?.whisper?.message === 'already running'
                            ? 'השרת כבר רץ, ממתין לחיבור...'
                            : 'שרת CUDA עולה, ממתין לחיבור...',
                        });
                        startPolling(3000, 120000);
                        setTimeout(() => setIsStarting(false), 120000);
                        return;
                      }
                    } catch {
                      // Launcher not reachable — try direct connection check
                    }
                    // 2. Fallback: just check if server is already running
                    const ok = await checkConnection();
                    if (ok) {
                      toast({ title: '🟢 מחובר!', description: 'שרת CUDA זוהה ב־localhost:3000' });
                      startPolling(10000);
                    } else {
                      toast({
                        title: '🔴 שרת לא נגיש',
                        description: 'הפעל את שרת ה-CUDA מה-tray או בטרמינל, ואז לחץ שוב.',
                        variant: 'destructive',
                      });
                    }
                    setIsStarting(false);
                  }}
                >
                  {isStarting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                  {isStarting ? 'מפעיל...' : 'הפעל שרת'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1.5 text-xs h-7"
                  onClick={(e) => {
                    e.preventDefault();
                    handleStartServer();
                  }}
                >
                  {isStarting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                  {isStarting ? 'ממתין לחיבור...' : 'הפעל שרת'}
                </Button>
              )
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-7 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={async (e) => {
                  e.preventDefault();
                  if (isNonLocalHost && window.location.protocol === 'https:') {
                    await shutdownServer();
                    setIsStarting(false);
                    stopPolling();
                    toast({ title: 'החיבור נוקה', description: 'כיבוי שרת מקומי מתוך דפדפן מאובטח חסום על ידי הדפדפן.' });
                    return;
                  }
                  // Try launcher stop (works from Lovable via PNA)
                  try {
                    await fetch('http://localhost:8764/stop', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ target: 'whisper' }),
                      signal: AbortSignal.timeout(15000),
                    });
                  } catch {
                    // Tray not available — fall through to direct shutdown
                  }
                  await shutdownServer();
                  setIsStarting(false);
                  stopPolling();
                  toast({ title: "השרת נכבה", description: "שרת ה-CUDA כובה" });
                }}
              >
                <PowerOff className="w-3.5 h-3.5" />
                כבה שרת
              </Button>
            )}
          </div>
          {!isConnected && !isRemoteAccess && !isNonLocalHost && (
            <div className="text-[11px] text-muted-foreground space-y-1 border-t pt-2">
              <p>הפעל בטרמינל:</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 bg-background px-2 py-1 rounded text-[11px] font-mono border select-all">
                  {START_CMD_LOCAL}
                </code>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(START_CMD_LOCAL); toast({ title: 'הועתק', description: 'הפקודה הועתקה ללוח' }); }}>
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
          {!isConnected && !isRemoteAccess && isNonLocalHost && (
            <div className="text-[11px] text-muted-foreground space-y-1.5 border-t pt-2">
              <p className="font-medium">🖥️ עובד מול השרת המקומי (localhost:3000)</p>
              <p className="text-muted-foreground">
                לחץ "הפעל שרת" — האפליקציה תנסה להפעיל את השרת דרך ה-tray (פורט 8764).
                אם ה-tray לא פועל, הפעל ידנית:
              </p>
              <div className="flex items-center gap-1">
                <code className="flex-1 bg-background px-2 py-1 rounded text-[11px] font-mono border select-all">
                  .\scripts\start-whisper-server.ps1
                </code>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText('.\\scripts\\start-whisper-server.ps1'); toast({ title: 'הועתק', description: 'הפקודה הועתקה ללוח' }); }}>
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
          {!isConnected && isRemoteAccess && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 space-y-1.5 border-t pt-2">
              <p className="font-medium">📡 גישה מרחוק — נדרשת כתובת שרת</p>
              <p className="text-muted-foreground">פתח הגדרות מתקדמות למטה והזן את כתובת שרת ה-Whisper שקיבלת מ-start-remote.ps1</p>
            </div>
          )}
        </div>
      )}

      {/* Model preload mode + manual preload */}
      {selected === 'local-server' && isConnected && (
        <div className="border-t pt-3 mt-3 space-y-2">
          <Label className="text-xs font-medium text-right block">מצב טעינת מודל</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={preloadMode === 'preload' ? 'default' : 'outline'}
              size="sm"
              className={`gap-1.5 text-xs h-8 ${preloadMode === 'preload' ? 'bg-blue-500 hover:bg-blue-600 text-white' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setPreloadMode('preload');
                updatePreferences({ cuda_preload_mode: 'preload' });
                toast({ title: '📦 מצב טעינה מראש', description: 'המודל ייטען אוטומטית ברגע שהשרת מחובר' });
              }}
            >
              <Download className="w-3.5 h-3.5" />
              טען מראש
            </Button>
            <Button
              variant={preloadMode === 'direct' ? 'default' : 'outline'}
              size="sm"
              className={`gap-1.5 text-xs h-8 ${preloadMode === 'direct' ? 'bg-blue-500 hover:bg-blue-600 text-white' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setPreloadMode('direct');
                updatePreferences({ cuda_preload_mode: 'direct' });
                toast({ title: '⚡ תמלול ישיר', description: 'המודל ייטען רק כשתתחיל לתמלל (חיסכון VRAM)' });
              }}
            >
              <Zap className="w-3.5 h-3.5" />
              תמלל ישיר
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-right">
            {preloadMode === 'preload' ? 'המודל נטען ברקע מיד כשהשרת מוכן — תמלול ראשון מהיר' : 'חוסך VRAM — המודל נטען רק כשמתחילים לתמלל'}
          </p>

          {/* Manual preload / progress */}
          {!modelReady && !modelLoading && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs h-8"
              onClick={async (e) => {
                e.preventDefault();
                setPreloadMsg('מתחיל טעינה...');
                try {
                  const r = await preloadModelStream(undefined, undefined, (msg) => setPreloadMsg(msg));
                  if (r.ready) {
                    toast({ title: '✅ המודל מוכן!', description: r.elapsed ? `נטען ב-${r.elapsed}s` : 'מוכן לתמלול' });
                  }
                } catch {
                  toast({ title: '❌ טעינה נכשלה', variant: 'destructive' });
                }
                setPreloadMsg('');
              }}
            >
              <Download className="w-3.5 h-3.5" />
              טען מודל עכשיו
            </Button>
          )}
          {modelLoading && preloadMsg && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span className="truncate">{preloadMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* Fast mode toggle — only for CUDA engine */}
      {selected === 'local-server' && (
        <div className="border-t pt-3 mt-3">
          <Label className="text-xs font-medium text-right block mb-2">ערכת תמלול</Label>
          <div className="flex gap-1.5" dir="rtl">
            <Button
              variant={preset === 'fast' ? 'default' : 'outline'}
              size="sm"
              className={`gap-1 text-xs h-8 flex-1 ${preset === 'fast' ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
              onClick={(e) => { e.preventDefault(); applyPreset('fast'); }}
            >
              <Rabbit className="w-3.5 h-3.5" />
              ⚡ מהיר
            </Button>
            <Button
              variant={preset === 'balanced' ? 'default' : 'outline'}
              size="sm"
              className={`gap-1 text-xs h-8 flex-1 ${preset === 'balanced' ? 'bg-blue-500 hover:bg-blue-600 text-white' : ''}`}
              onClick={(e) => { e.preventDefault(); applyPreset('balanced'); }}
            >
              <Zap className="w-3.5 h-3.5" />
              מאוזן
            </Button>
            <Button
              variant={preset === 'accurate' ? 'default' : 'outline'}
              size="sm"
              className={`gap-1 text-xs h-8 flex-1 ${preset === 'accurate' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
              onClick={(e) => { e.preventDefault(); applyPreset('accurate'); }}
            >
              <Turtle className="w-3.5 h-3.5" />
              🎯 מדויק
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-right mt-1">
            {preset === 'fast' && 'עיבוד מקבילי, beam=1, דילוג שקט אגרסיבי — מהיר פי 3-5'}
            {preset === 'balanced' && 'איזון טוב בין מהירות לדיוק — ברירת מחדל מומלצת'}
            {preset === 'accurate' && 'עיבוד סדרתי, beam=5, הקשר מלא — דיוק מקסימלי'}
          </p>
        </div>
      )}

      {/* Advanced CUDA settings — only for CUDA engine */}
      {selected === 'local-server' && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full mt-2 gap-1.5 text-xs h-7 text-muted-foreground">
              <Settings className="w-3.5 h-3.5" />
              הגדרות מתקדמות
              <ChevronDown className={`w-3 h-3 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3 rounded-lg border p-3 bg-muted/20 text-sm">

              {/* Compute Type */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-right block">סוג חישוב (Compute Type)</Label>
                <Select value={computeType} onValueChange={(v) => { setComputeType(v); updatePreferences({ cuda_compute_type: v }); }}>
                  <SelectTrigger className="h-8 text-xs" dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="int8_float16">int8_float16 — ברירת מחדל (מהיר + איכות טובה)</SelectItem>
                    <SelectItem value="float16">float16 — איכות מקסימלית (VRAM גבוה)</SelectItem>
                    <SelectItem value="int8">int8 — מהיר ביותר (פחות דיוק)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground text-right">⚠️ שינוי סוג חישוב דורש טעינה מחדש של המודל</p>
              </div>

              {/* Beam Size */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-right block">Beam Size</Label>
                <Select value={String(beamSize)} onValueChange={(v) => { setBeamSize(Number(v)); updatePreferences({ cuda_beam_size: Number(v) }); }}>
                  <SelectTrigger className="h-8 text-xs" dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="0">ברירת מחדל (לפי ערכה)</SelectItem>
                    <SelectItem value="1">1 — מהיר ביותר</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="5">5 — איכות מקסימלית</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground text-right">beam גבוה = דיוק גבוה אבל איטי יותר</p>
              </div>

              {/* Condition on previous text */}
              <div className="flex items-center justify-between gap-2">
                <div className="text-right">
                  <Label className="text-xs font-medium block">ביטול תנאי טקסט קודם</Label>
                  <p className="text-[10px] text-muted-foreground">מונע לולאות הזיה — מומלץ להפעיל</p>
                </div>
                <Switch
                  checked={noConditionPrev}
                  onCheckedChange={(v) => { setNoConditionPrev(v); updatePreferences({ cuda_no_condition_prev: v }); }}
                />
              </div>

              {/* VAD Aggressive */}
              <div className="flex items-center justify-between gap-2">
                <div className="text-right">
                  <Label className="text-xs font-medium block">VAD אגרסיבי</Label>
                  <p className="text-[10px] text-muted-foreground">מדלג מהר על שקט — מאיץ קבצים ארוכים</p>
                </div>
                <Switch
                  checked={vadAggressive}
                  onCheckedChange={(v) => { setVadAggressive(v); updatePreferences({ cuda_vad_aggressive: v }); }}
                />
              </div>

              {/* Hotwords */}
              <div className="space-y-1 border-t pt-2">
                <Label className="text-xs font-medium text-right block">מילון מותאם אישית (Hotwords)</Label>
                <textarea
                  className="w-full h-16 text-xs rounded-md border bg-background px-3 py-2 text-right resize-none"
                  dir="rtl"
                  placeholder="הכנס מילים מופרדות בפסיקים: שלום, ירושלים, כנסת..."
                  value={hotwords}
                  onChange={(e) => { setHotwords(e.target.value); updatePreferences({ cuda_hotwords: e.target.value }); }}
                />
                <p className="text-[10px] text-muted-foreground text-right">מילים שחוזרות בהקלטה — משפר דיוק זיהוי שמות, מונחים מקצועיים</p>
              </div>

              {/* Auto Paragraph Detection */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-right block">זיהוי פסקאות אוטומטי</Label>
                <Select value={String(paragraphThreshold)} onValueChange={(v) => { setParagraphThreshold(Number(v)); updatePreferences({ cuda_paragraph_threshold: Number(v) }); }}>
                  <SelectTrigger className="h-8 text-xs" dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="0">כבוי</SelectItem>
                    <SelectItem value="1">1 שניות שקט</SelectItem>
                    <SelectItem value="1.5">1.5 שניות שקט</SelectItem>
                    <SelectItem value="2">2 שניות שקט</SelectItem>
                    <SelectItem value="3">3 שניות שקט</SelectItem>
                    <SelectItem value="5">5 שניות שקט</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground text-right">מוסיף מעבר פסקה כשיש שקט ארוך — מתאים להרצאות</p>
              </div>

              {/* GPU Warmup */}
              {isConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs h-8"
                  disabled={isWarmingUp}
                  onClick={async (e) => {
                    e.preventDefault();
                    setIsWarmingUp(true);
                    const t = await warmupServer();
                    setIsWarmingUp(false);
                    toast({ title: t != null ? `🔥 GPU חומם ב-${t}s` : '❌ חימום נכשל', description: t != null ? 'התמלול הראשון יהיה מהיר יותר' : 'ודא שהשרת פועל' });
                  }}
                >
                  {isWarmingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
                  {isWarmingUp ? 'מחמם GPU...' : 'חמם GPU (Warmup)'}
                </Button>
              )}

              {/* Remote Server URLs */}
              <div className="space-y-2 border-t pt-2">
                <div className="flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-blue-500" />
                  <Label className="text-xs font-medium text-right block">גישה מרחוק — כתובות שרתים</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground text-right block">כתובת שרת Whisper (CUDA)</Label>
                  <input
                    type="url"
                    className="w-full h-8 text-xs rounded-md border bg-background px-3 text-left dir-ltr font-mono"
                    dir="ltr"
                    placeholder="http://localhost:3000"
                    value={serverUrl}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setServerUrl(v);
                      if (v) localStorage.setItem('whisper_server_url', v);
                      else localStorage.removeItem('whisper_server_url');
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground text-right block">מפתח API לשרת (אופציונלי)</Label>
                  <input
                    type="password"
                    className="w-full h-8 text-xs rounded-md border bg-background px-3 text-left dir-ltr font-mono"
                    dir="ltr"
                    placeholder="ריק = ללא הגנה"
                    value={apiKey}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setApiKey(v);
                      if (v) localStorage.setItem('whisper_api_key', v);
                      else localStorage.removeItem('whisper_api_key');
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground text-right block">כתובת שרת Ollama (AI עריכה)</Label>
                  <input
                    type="url"
                    className="w-full h-8 text-xs rounded-md border bg-background px-3 text-left dir-ltr font-mono"
                    dir="ltr"
                    placeholder="http://localhost:11434"
                    value={ollamaUrl}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setOllamaUrl(v);
                      if (v) localStorage.setItem('ollama_base_url', v);
                      else localStorage.removeItem('ollama_base_url');
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-right">
                  לגישה מרחוק: הפעל <code className="font-mono bg-muted px-1 rounded">scripts\start-remote.ps1</code> במחשב — יקבל כתובות אינטרנט. השאר ריק לשימוש מקומי.
                </p>
              </div>

              {/* Cloud Save Mode */}
              <div className="space-y-1 border-t pt-2">
                <Label className="text-xs font-medium text-right block">שמירה בענן</Label>
                <Select value={cloudSaveMode} onValueChange={(v: 'immediate' | 'text-only' | 'skip') => { setCloudSaveMode(v); updatePreferences({ cuda_cloud_save: v }); }}>
                  <SelectTrigger className="h-8 text-xs" dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="immediate">מלא — טקסט + אודיו לענן</SelectItem>
                    <SelectItem value="text-only">טקסט בלבד — בלי להעלות אודיו</SelectItem>
                    <SelectItem value="skip">מקומי בלבד — ללא ענן כלל</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground text-right">
                  {cloudSaveMode === 'immediate' ? 'התמלול + קובץ האודיו יישמרו בענן' :
                   cloudSaveMode === 'text-only' ? 'רק הטקסט יעלה לענן — מהיר יותר, חוסך נפח' :
                   'הכל נשאר מקומי — תמלול אופליין מלא'}
                </p>
              </div>

            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="border-t pt-4 mt-4">
        <Label className="text-sm font-semibold mb-2 block text-right">שפת מקור (קלט)</Label>
        <Select value={sourceLanguage} onValueChange={onSourceLanguageChange}>
          <SelectTrigger className="w-full text-right" dir="rtl">
            <SelectValue placeholder="בחר שפת מקור" />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="auto">זיהוי אוטומטי</SelectItem>
            <SelectItem value="he">עברית 🇮🇱</SelectItem>
            <SelectItem value="yi">יידיש 🕍</SelectItem>
            <SelectItem value="en">אנגלית 🇺🇸</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-2 text-right">
          התמלול יהיה תמיד בעברית, ללא קשר לשפת המקור
        </p>
      </div>
    </Card>
  );
});
