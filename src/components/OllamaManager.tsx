import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Server, Wifi, WifiOff, Download, Trash2, RefreshCw,
  HardDrive, Loader2, CheckCircle2, XCircle, Cpu, ExternalLink
} from "lucide-react";
import { useOllama, getOllamaUrl, setOllamaUrl, formatModelSize } from "@/hooks/useOllama";
import { toast } from "@/hooks/use-toast";

const RECOMMENDED_MODELS = [
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B', description: 'מודל כללי מצוין — Meta', vram: '~5 GB' },
  { name: 'mistral:7b', label: 'Mistral 7B', description: 'מהיר ואיכותי לטקסט', vram: '~4.5 GB' },
  { name: 'gemma2:9b', label: 'Gemma 2 9B', description: 'מודל חזק של Google', vram: '~5.5 GB' },
  { name: 'qwen2.5:7b', label: 'Qwen 2.5 7B', description: 'תמיכה טובה בעברית — Alibaba', vram: '~4.5 GB' },
  { name: 'phi3:medium', label: 'Phi-3 Medium 14B', description: 'מודל חכם של Microsoft', vram: '~8 GB' },
  { name: 'llama3.1:70b', label: 'Llama 3.1 70B', description: 'הכי חזק — דורש VRAM גבוה', vram: '~40 GB' },
  // Hebrew-optimized models
  { name: 'aya:8b', label: 'Aya 8B', description: 'תמיכה מעולה בעברית — Cohere', vram: '~5 GB' },
  { name: 'aya:35b', label: 'Aya 35B', description: 'הכי טוב לעברית — Cohere', vram: '~20 GB' },
  { name: 'qwen2.5:14b', label: 'Qwen 2.5 14B', description: 'רב-שפתי חזק — Alibaba', vram: '~9 GB' },
  { name: 'mistral-nemo:12b', label: 'Mistral Nemo 12B', description: 'מתקדם בשפות שמיות', vram: '~7 GB' },
  { name: 'command-r:35b', label: 'Command R 35B', description: 'RAG + עברית — Cohere', vram: '~20 GB' },
  { name: 'gemma2:27b', label: 'Gemma 2 27B', description: 'מודל חזק של Google', vram: '~16 GB' },
  { name: 'qwen2.5:32b', label: 'Qwen 2.5 32B', description: 'רב-שפתי מתקדם — Alibaba', vram: '~19 GB' },
  { name: 'deepseek-v2:16b', label: 'DeepSeek V2 Lite 16B', description: 'MoE יעיל — DeepSeek', vram: '~10 GB' },
  { name: 'hf.co/mradermacher/Zion_Alpha_Instruction_Tuned-GGUF:Q6_K', label: 'Zion Alpha Q6 Hebrew', description: 'מודל עברי מיוחד - Zion Alpha', vram: '~6 GB' },
];

const inferModelHoverText = (modelName: string): string => {
  const lower = modelName.toLowerCase();
  let specialty = 'שימוש כללי ועריכת טקסט';
  let hebrewTraining = 'לא ידוע';

  if (lower.includes('zion_alpha')) {
    specialty = 'עברית, הוראות, ניסוח ודיוק מקומי';
    hebrewTraining = 'כן, מותאם ומאומן לעברית';
  } else if (lower.includes('aya')) {
    specialty = 'תרגום, רב-לשוניות ושפה טבעית';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי, אבל חזק בעברית';
  } else if (lower.includes('qwen')) {
    specialty = 'כתיבה, שכתוב, סיכום והוראות מורכבות';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי, אבל תומך היטב בעברית';
  } else if (lower.includes('mistral')) {
    specialty = 'מהירות, עריכה ותשובות קצרות';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('gemma')) {
    specialty = 'טקסט כללי, עזרה וניתוח';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('llama')) {
    specialty = 'שימוש כללי וצ׳אט';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('command-r')) {
    specialty = 'RAG, עבודה עם מקורות ומסמכים';
    hebrewTraining = 'לא ייעודי לעברית';
  } else if (lower.includes('deepseek')) {
    specialty = 'חשיבה, קוד ומשימות מורכבות';
    hebrewTraining = 'לא ייעודי לעברית';
  }

  return `התמחות: ${specialty}\nעברית: ${hebrewTraining}`;
};

export const OllamaManager = () => {
  const {
    isConnected, isChecking, models,
    isPulling, pullProgress, pullJobs,
    connectionError,
    checkConnection, pullModel, cancelPull, resumePull, deleteModel,
  } = useOllama();

  const [urlInput, setUrlInput] = useState(getOllamaUrl());
  const [selectedModel, setSelectedModel] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [localVersion, setLocalVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [isCheckingVersion, setIsCheckingVersion] = useState(false);
  const [detectedGpuLabel, setDetectedGpuLabel] = useState<string | null>(null);

  const installedNames = useMemo(() => new Set(models.map(m => m.name)), [models]);
  const parseVramGb = (vramText: string): number => {
    const n = Number.parseFloat(vramText.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 999;
  };
  const isEightGbClassGpu = useMemo(
    () => /RTX\s*(3050|4050|4060|5050)/i.test(detectedGpuLabel || ''),
    [detectedGpuLabel]
  );
  const gpuRecommendedModels = useMemo(() => {
    if (!isEightGbClassGpu) return RECOMMENDED_MODELS;
    return RECOMMENDED_MODELS.filter(m => parseVramGb(m.vram) <= 10);
  }, [isEightGbClassGpu]);
  const missingRecommended = useMemo(
    () => gpuRecommendedModels.filter(m => !installedNames.has(m.name)),
    [gpuRecommendedModels, installedNames]
  );

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return;

      const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (!ext) return;

      const rawRenderer = (gl as WebGLRenderingContext).getParameter(
        (ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL
      ) as string;

      const rtxMatch = rawRenderer.match(/RTX\s*\d{3,4}/i);
      if (rtxMatch) {
        setDetectedGpuLabel(rtxMatch[0].toUpperCase().replace(/\s+/, ' '));
        return;
      }

      if (/NVIDIA/i.test(rawRenderer)) {
        setDetectedGpuLabel('NVIDIA');
      }
    } catch {
      // Keep fallback label
    }
  }, []);

  const handleUrlSave = () => {
    const trimmed = urlInput.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    setOllamaUrl(trimmed);
    toast({ title: "נשמר", description: `כתובת Ollama עודכנה ל-${trimmed}` });
    checkConnection();
  };

  const handlePull = async (modelName: string) => {
    if (!modelName) return;
    try {
      await pullModel(modelName);
      toast({ title: "הצלחה", description: `${modelName} ירד ונשמר מקומית` });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        toast({ title: "בוטל", description: "ההורדה נעצרה — אפשר להמשיך מאותה נקודה" });
      } else {
        toast({ title: "שגיאה", description: err instanceof Error ? err.message : "שגיאה בהורדה", variant: "destructive" });
      }
    }
  };

  const handlePullMissingParallel = async () => {
    if (missingRecommended.length === 0) {
      toast({ title: "הכל מותקן", description: "אין מנועים חסרים" });
      return;
    }
    await Promise.allSettled(missingRecommended.map(m => pullModel(m.name)));
    toast({ title: "הופעלו הורדות רקע", description: `${missingRecommended.length} מנועים רצים במקביל` });
  };

  const parseVersion = (v: string): number[] => {
    return v.replace(/^v/i, '').split('.').map(x => Number.parseInt(x, 10) || 0);
  };

  const isVersionNewer = (latest: string, current: string): boolean => {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av > bv) return true;
      if (av < bv) return false;
    }
    return false;
  };

  const handleCheckVersions = async () => {
    setIsCheckingVersion(true);
    try {
      const baseUrl = getOllamaUrl();
      const localRes = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(5000) });
      if (!localRes.ok) throw new Error('לא ניתן לקרוא גרסה מקומית');
      const localData = await localRes.json();
      const current = (localData?.version || '').toString();
      setLocalVersion(current || null);

      const latestRes = await fetch('https://api.github.com/repos/ollama/ollama/releases/latest', { signal: AbortSignal.timeout(8000) });
      if (!latestRes.ok) throw new Error('לא ניתן לקרוא גרסה אחרונה מ-GitHub');
      const latestData = await latestRes.json();
      const latest = (latestData?.tag_name || '').toString().replace(/^v/i, '');
      setLatestVersion(latest || null);

      if (current && latest && isVersionNewer(latest, current)) {
        toast({ title: 'קיימת גרסה חדשה', description: `מקומית: ${current} | חדשה: ${latest}` });
      } else {
        toast({ title: 'המערכת מעודכנת', description: current ? `גרסה ${current}` : 'לא זוהתה גרסה' });
      }
    } catch (err) {
      toast({
        title: 'בדיקת גרסאות נכשלה',
        description: err instanceof Error ? err.message : 'שגיאה לא ידועה',
        variant: 'destructive',
      });
    } finally {
      setIsCheckingVersion(false);
    }
  };

  const handleUpdateInstalledModels = async () => {
    if (models.length === 0) {
      toast({ title: 'אין מודלים לעדכון', description: 'התקן קודם מודל אחד לפחות' });
      return;
    }
    await Promise.allSettled(models.map(m => pullModel(m.name)));
    toast({ title: 'עדכון מודלים הופעל', description: `${models.length} מודלים נבדקים/מתעדכנים ברקע` });
  };

  const handleDelete = async (modelName: string) => {
    try {
      await deleteModel(modelName);
      toast({ title: "נמחק", description: `${modelName} הוסר` });
    } catch (err) {
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "שגיאה במחיקה", variant: "destructive" });
    }
  };

  const pullPercent = pullProgress?.total && pullProgress?.completed
    ? Math.round((pullProgress.completed / pullProgress.total) * 100)
    : 0;

  return (
    <Card dir="rtl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" />
            <div>
              <CardTitle className="text-xl">Ollama — מודלים מקומיים</CardTitle>
              <CardDescription>
                הרצת מודלי AI על המחשב שלך עם כרטיס NVIDIA
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isChecking ? (
              <Badge variant="secondary"><Loader2 className="w-3 h-3 animate-spin ml-1" />בודק...</Badge>
            ) : isConnected ? (
              <Badge variant="default" className="bg-green-600"><Wifi className="w-3 h-3 ml-1" />מחובר</Badge>
            ) : (
              <Badge variant="destructive"><WifiOff className="w-3 h-3 ml-1" />לא מחובר</Badge>
            )}
            <Button variant="ghost" size="icon" onClick={checkConnection} disabled={isChecking}>
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Connection URL */}
        <div className="space-y-2">
          <Label>כתובת שרת Ollama</Label>
          <div className="flex gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:11434"
              dir="ltr"
              className="flex-1"
            />
            <Button onClick={handleUrlSave} variant="outline">שמור</Button>
          </div>
          {!isConnected && !isChecking && (
            <div className="space-y-1">
              <p className="text-xs text-destructive">
                ודא ש-Ollama רץ: <code className="text-xs bg-muted px-1 rounded" dir="ltr">ollama serve</code>
                {" "}ושהגדרת <code className="text-xs bg-muted px-1 rounded" dir="ltr">OLLAMA_ORIGINS=*</code>
              </p>
              {connectionError && (
                <p className="text-xs text-destructive/90">{connectionError}</p>
              )}
            </div>
          )}
        </div>

        {/* Version checker and one-click update */}
        <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-semibold">בדיקת גרסאות Ollama</Label>
            <Button size="sm" variant="outline" onClick={handleCheckVersions} disabled={isCheckingVersion || !isConnected}>
              {isCheckingVersion ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RefreshCw className="w-3 h-3 ml-1" />}
              בדוק גרסה חדשה
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>גרסה מקומית: <span dir="ltr">{localVersion || 'לא נבדק'}</span></div>
            <div>גרסה אחרונה: <span dir="ltr">{latestVersion || 'לא נבדק'}</span></div>
          </div>
          {localVersion && latestVersion && isVersionNewer(latestVersion, localVersion) && (
            <Button size="sm" className="w-full" onClick={() => window.open('https://ollama.com/download/windows', '_blank', 'noopener,noreferrer')}>
              <Download className="w-4 h-4 ml-1" />
              הורד עדכון Ollama
              <ExternalLink className="w-3 h-3 mr-1" />
            </Button>
          )}
          <Button size="sm" variant="secondary" className="w-full" onClick={handleUpdateInstalledModels} disabled={!isConnected || models.length === 0}>
            <Cpu className="w-4 h-4 ml-1" />
            בדוק/עדכן את כל המודלים המותקנים
          </Button>
        </div>

        {/* Installed Models */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            <Label>מודלים מותקנים ({models.length})</Label>
          </div>

          {models.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">
              {isConnected ? "אין מודלים מותקנים — הורד מודל מהרשימה למטה" : "חבר ל-Ollama כדי לראות מודלים"}
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-2">
              <div className="space-y-2 pb-1">
                {models.map((m) => (
                  <div key={m.name} className="flex items-center justify-between p-3 border rounded-lg bg-background">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <div>
                        <p className="text-sm font-medium" dir="ltr">{m.name}</p>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          <span>{formatModelSize(m.size)}</span>
                          {m.details?.parameter_size && <span>{m.details.parameter_size}</span>}
                          {m.details?.quantization_level && <span>{m.details.quantization_level}</span>}
                        </div>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>מחיקת מודל</AlertDialogTitle>
                          <AlertDialogDescription>
                            למחוק את <strong dir="ltr">{m.name}</strong>? יצטרך להוריד אותו מחדש.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>ביטול</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(m.name)} className="bg-destructive text-destructive-foreground">
                            מחק
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Download Models */}
        {isConnected && (
          <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
            <Label className="text-sm font-semibold">הורד מודל</Label>

            {/* Recommended */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {detectedGpuLabel ? `מומלצים ל-${detectedGpuLabel}` : 'מומלצים לפי הכרטיס שלך'}
              </Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="text-xs" dir="ltr">
                  <SelectValue placeholder="בחר מודל מומלץ..." />
                </SelectTrigger>
                <SelectContent dir="ltr">
                  {gpuRecommendedModels.map(rm => (
                    <SelectItem key={rm.name} value={rm.name} title={inferModelHoverText(rm.name)}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rm.label}</span>
                        <span className="text-muted-foreground">— {rm.description} ({rm.vram})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => handlePull(selectedModel)}
                disabled={!selectedModel}
                size="sm"
                className="w-full"
              >
                <Download className="w-4 h-4 ml-1" />
                הורד מודל ברקע
              </Button>
              <Button
                onClick={handlePullMissingParallel}
                disabled={missingRecommended.length === 0}
                size="sm"
                variant="outline"
                className="w-full"
              >
                <Cpu className="w-4 h-4 ml-1" />
                הורד את כל החסרים במקביל
              </Button>
            </div>

            {/* Custom model name */}
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="text-xs text-muted-foreground">או הזן שם מודל ידנית</Label>
              <div className="flex gap-2">
                <Input
                  value={customModelName}
                  onChange={(e) => setCustomModelName(e.target.value)}
                  placeholder="e.g. codellama:7b"
                  dir="ltr"
                  className="flex-1 text-xs"
                />
                <Button
                  onClick={() => handlePull(customModelName.trim())}
                  disabled={!customModelName.trim()}
                  size="sm"
                  variant="outline"
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Pull progress */}
            {isPulling && pullProgress && (
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{pullProgress.status}</span>
                  {pullPercent > 0 && <span className="font-medium">{pullPercent}%</span>}
                </div>
                {pullPercent > 0 && <Progress value={pullPercent} />}
                <Button variant="ghost" size="sm" onClick={() => cancelPull()} className="text-xs text-destructive">
                  <XCircle className="w-3 h-3 ml-1" />
                  בטל את כל ההורדות
                </Button>
              </div>
            )}

            {gpuRecommendedModels.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">ניהול הורדה פר מנוע (רקע, מקבילי, עם המשך)</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {gpuRecommendedModels.map((m) => {
                    const job = pullJobs[m.name];
                    const isInstalled = installedNames.has(m.name);
                    const isActive = job?.status === 'starting' || job?.status === 'pulling' || job?.status === 'retrying';
                    const canResume = job?.status === 'error' || job?.status === 'cancelled';
                    const percent = job?.percent || 0;
                    const speedMBs = (job?.speedBps || 0) / (1024 * 1024);
                    const etaSec = job?.etaSeconds || 0;
                    const dlMB = (job?.downloadedBytes || 0) / (1024 * 1024);
                    const totalMB = (job?.totalBytes || 0) / (1024 * 1024);

                    return (
                      <div key={m.name} className="rounded-md border p-2 bg-background space-y-1.5" title={inferModelHoverText(m.name)}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs" dir="ltr">{m.name}</div>
                          {isInstalled ? (
                            <Badge variant="default" className="bg-green-600 text-[10px]">מותקן</Badge>
                          ) : job?.status === 'completed' ? (
                            <Badge variant="default" className="bg-green-600 text-[10px]">הושלם</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              {job?.status || 'idle'}
                            </Badge>
                          )}
                        </div>

                        {!isInstalled && (
                          <>
                            {isActive && percent > 0 && (
                              <div className="space-y-1">
                                <div className="relative w-full h-3 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${percent}%` }}
                                  >
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                                  </div>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground" dir="ltr">
                                  <span className="font-mono font-bold">{percent}%</span>
                                  <span>{dlMB.toFixed(0)} / {totalMB.toFixed(0)} MB</span>
                                  {speedMBs > 0.1 && <span>{speedMBs.toFixed(1)} MB/s</span>}
                                  {etaSec > 0 && etaSec < 86400 && (
                                    <span>
                                      {etaSec >= 3600
                                        ? `${Math.floor(etaSec / 3600)}h ${Math.floor((etaSec % 3600) / 60)}m`
                                        : etaSec >= 60
                                          ? `${Math.floor(etaSec / 60)}m ${Math.floor(etaSec % 60)}s`
                                          : `${Math.floor(etaSec)}s`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {!isActive && percent > 0 && percent < 100 && (
                              <Progress value={percent} />
                            )}
                            {job?.status === 'retrying' && (
                              <div className="text-[10px] text-amber-600">ניסיון חוזר #{(job.retries || 0) + 1}...</div>
                            )}
                            {job?.error && (
                              <div className="text-[10px] text-destructive">{job.error}</div>
                            )}
                            <div className="flex gap-1">
                              {!isActive && job?.status !== 'completed' && (
                                <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => handlePull(m.name)}>
                                  <Download className="w-3 h-3 ml-1" />
                                  {canResume ? 'המשך' : 'הורד'}
                                </Button>
                              )}
                              {isActive && (
                                <Button size="sm" variant="ghost" className="text-[10px] h-7 text-destructive" onClick={() => cancelPull(m.name)}>
                                  <XCircle className="w-3 h-3 ml-1" />
                                  עצור
                                </Button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/20 rounded-lg">
          <p className="font-semibold">התקנה מהירה:</p>
          <ol className="list-decimal pr-4 space-y-0.5" dir="rtl">
            <li>הורד Ollama מ-<code dir="ltr" className="bg-muted px-1 rounded">ollama.com</code></li>
            <li>הפעל: <code dir="ltr" className="bg-muted px-1 rounded">ollama serve</code></li>
            <li>
              הגדר CORS (חלונות): <code dir="ltr" className="bg-muted px-1 rounded">set OLLAMA_ORIGINS=*</code> לפני ההפעלה
            </li>
            <li>הורד מודל מהרשימה למעלה — והתחל לערוך!</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
};
