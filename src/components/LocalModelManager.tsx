import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle, Trash2, HardDrive, Star, Zap, Globe2, Cpu, Server, Wifi, WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { pipeline, env } from '@huggingface/transformers';
import { useLocalServer } from "@/hooks/useLocalServer";

env.allowLocalModels = false;
env.useBrowserCache = true;

const isWebGPUAvailable = async (): Promise<boolean> => {
  try {
    const nav = navigator as any;
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
};

interface ModelInfo {
  id: string;
  name: string;
  size: string;
  description: string;
  downloaded: boolean;
  category: 'tiny' | 'small' | 'medium' | 'large' | 'hebrew';
  hebrewOptimized?: boolean;
  speed: 'fast' | 'medium' | 'slow';
  accuracy: 'basic' | 'good' | 'great' | 'excellent';
  runtime: 'browser' | 'server';
}

// Browser ONNX models (run in browser via @huggingface/transformers)
const BROWSER_MODELS: ModelInfo[] = [
  {
    id: "onnx-community/whisper-tiny",
    name: "Whisper Tiny",
    size: "~75MB",
    description: "מהיר מאוד, מתאים למכשירים חלשים. דיוק בסיסי.",
    downloaded: false,
    category: 'tiny',
    speed: 'fast',
    accuracy: 'basic',
    runtime: 'browser',
  },
  {
    id: "onnx-community/whisper-base",
    name: "Whisper Base",
    size: "~140MB",
    description: "איזון טוב בין מהירות לדיוק. מתאים לרוב השימושים.",
    downloaded: false,
    category: 'small',
    speed: 'fast',
    accuracy: 'good',
    runtime: 'browser',
  },
  {
    id: "onnx-community/whisper-small",
    name: "Whisper Small",
    size: "~460MB",
    description: "דיוק גבוה יותר, טוב לעברית. דורש יותר זיכרון.",
    downloaded: false,
    category: 'small',
    speed: 'medium',
    accuracy: 'good',
    runtime: 'browser',
  },
  {
    id: "onnx-community/whisper-medium",
    name: "Whisper Medium",
    size: "~740MB",
    description: "דיוק גבוה. מצוין לעברית ולשפות שמיות.",
    downloaded: false,
    category: 'medium',
    speed: 'medium',
    accuracy: 'great',
    runtime: 'browser',
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    name: "Whisper Large V3 Turbo ⚡",
    size: "~800MB",
    description: "הדגם הכי חזק! מהיר פי 4 מ-Large V3, דיוק מעולה בעברית.",
    downloaded: false,
    category: 'large',
    speed: 'medium',
    accuracy: 'excellent',
    runtime: 'browser',
  },
  {
    id: "onnx-community/whisper-large-v3",
    name: "Whisper Large V3",
    size: "~1.5GB",
    description: "הדגם הגדול ביותר של OpenAI. דיוק מקסימלי, דורש זיכרון רב.",
    downloaded: false,
    category: 'large',
    speed: 'slow',
    accuracy: 'excellent',
    runtime: 'browser',
  },
];

// Server/CUDA models (run on local Python server with GPU)
const SERVER_MODELS: ModelInfo[] = [
  {
    id: "ivrit-ai/whisper-large-v3-turbo-ct2",
    name: "Ivrit.ai Turbo V3 CT2 🇮🇱⚡",
    size: "~800MB",
    description: "מודל ivrit-ai turbo מוכן CT2 — הכי מהיר לטעינה! מדויק במיוחד לעברית.",
    downloaded: false,
    category: 'hebrew',
    hebrewOptimized: true,
    speed: 'fast',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "ivrit-ai/whisper-large-v3-turbo",
    name: "Ivrit.ai Turbo V3 🇮🇱",
    size: "~3.2GB",
    description: "Fine-tune ישראלי של Turbo V3! דורש המרה אוטומטית. מדויק במיוחד לעברית.",
    downloaded: false,
    category: 'hebrew',
    hebrewOptimized: true,
    speed: 'fast',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "ivrit-ai/faster-whisper-v2-d4",
    name: "Ivrit.ai Whisper V2 🇮🇱",
    size: "~1.5GB",
    description: "מודל ישראלי! אומן על מאות שעות שמע בעברית. רץ על GPU עם CUDA.",
    downloaded: false,
    category: 'hebrew',
    hebrewOptimized: true,
    speed: 'medium',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "ivrit-ai/yi-whisper-large-v3-turbo-ct2",
    name: "Ivrit.ai יידיש Turbo CT2 🕍⚡",
    size: "~800MB",
    description: "מודל יידיש של ivrit-ai מוכן CT2 — מהיר. מתאים גם לדיבור בלשון-הקודש (עברית-ארמית-יידיש מעורב).",
    downloaded: false,
    category: 'hebrew',
    hebrewOptimized: true,
    speed: 'fast',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "ivrit-ai/yi-whisper-large-v3-ct2",
    name: "Ivrit.ai יידיש מלא CT2 🕍",
    size: "~3GB",
    description: "גרסת היידיש המלאה (לא turbo) — דיוק גבוה יותר לדיבור יידיש/לשון-הקודש. דורש יותר זיכרון.",
    downloaded: false,
    category: 'hebrew',
    hebrewOptimized: true,
    speed: 'medium',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "large-v3-turbo",
    name: "Whisper Large V3 Turbo (CUDA) ⚡",
    size: "~800MB",
    description: "OpenAI Large V3 Turbo עם האצת GPU — מהיר פי 10 מהדפדפן.",
    downloaded: false,
    category: 'large',
    speed: 'fast',
    accuracy: 'excellent',
    runtime: 'server',
  },
  {
    id: "large-v3",
    name: "Whisper Large V3 (CUDA)",
    size: "~1.5GB",
    description: "הדגם הגדול ביותר של OpenAI עם האצת GPU.",
    downloaded: false,
    category: 'large',
    speed: 'medium',
    accuracy: 'excellent',
    runtime: 'server',
  },
];

const ALL_MODELS: ModelInfo[] = [...SERVER_MODELS, ...BROWSER_MODELS];

export const LocalModelManager = () => {
  const [models, setModels] = useState<ModelInfo[]>(ALL_MODELS);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'hebrew' | 'downloaded' | 'server'>('all');

  const { isConnected: serverConnected, serverStatus, loadModel: serverLoadModel, downloadModel: serverDownloadModel } = useLocalServer();

  useEffect(() => {
    checkDownloadedModels();
    calculateCacheSize();
  }, []);

  // Update server models' downloaded status based on server connection
  useEffect(() => {
    if (serverConnected && serverStatus) {
      setModels(prev => prev.map(model => {
        if (model.runtime === 'server') {
          const isDownloaded = (serverStatus.downloaded_models || []).includes(model.id);
          const isCached = serverStatus.cached_models.includes(model.id);
          return { ...model, downloaded: isDownloaded || isCached };
        }
        return model;
      }));
    }
  }, [serverConnected, serverStatus]);

  const checkDownloadedModels = () => {
    const downloaded = localStorage.getItem('downloaded_models');
    if (downloaded) {
      const downloadedIds = JSON.parse(downloaded);
      setModels(prev => prev.map(model => {
        if (model.runtime === 'browser') {
          return { ...model, downloaded: downloadedIds.includes(model.id) };
        }
        return model;
      }));
    }
    const preferred = localStorage.getItem('preferred_local_model');
    if (preferred) setSelectedModel(preferred);
  };

  const calculateCacheSize = async () => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usageInMB = (estimate.usage || 0) / (1024 * 1024);
      setCacheSize(Math.round(usageInMB));
    }
  };

  const selectModel = (modelId: string) => {
    const model = ALL_MODELS.find(m => m.id === modelId);
    setSelectedModel(modelId);
    localStorage.setItem('preferred_local_model', modelId);
    // Also store the runtime type so the engine knows how to dispatch
    if (model) {
      localStorage.setItem('preferred_local_model_runtime', model.runtime);
    }
    toast({
      title: "מודל נבחר",
      description: `${model?.name || modelId} מוגדר כמודל ברירת מחדל`,
    });
  };

  const handleDownloadServer = async (modelId: string) => {
    if (!serverConnected) {
      toast({
        title: "שרת לא מחובר",
        description: "הפעל את השרת המקומי: python server/transcribe_server.py",
        variant: "destructive",
      });
      return;
    }

    setDownloadingModel(modelId);
    setDownloadProgress(0);
    setDownloadStatus('מוריד מודל לדיסק...');

    try {
      toast({
        title: "מוריד מודל...",
        description: "המודל מורד לדיסק. זה עלול לקחת כמה דקות בפעם הראשונה.",
      });

      setDownloadProgress(30);
      await serverDownloadModel(modelId);
      setDownloadProgress(100);

      selectModel(modelId);
      setModels(prev => prev.map(model =>
        model.id === modelId ? { ...model, downloaded: true } : model
      ));

      toast({
        title: "המודל הורד בהצלחה! ✅",
        description: "המודל מוכן לשימוש. יטען ל-GPU בעת התמלול.",
      });
    } catch (error) {
      console.error('Error loading server model:', error);
      toast({
        title: "שגיאה בטעינת מודל",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
    } finally {
      setDownloadingModel(null);
      setDownloadProgress(0);
      setDownloadStatus('');
    }
  };

  const handleDownloadBrowser = async (modelId: string) => {
    setDownloadingModel(modelId);
    setDownloadProgress(0);
    setDownloadStatus('מתחיל הורדה...');

    try {
      toast({
        title: "מוריד מודל...",
        description: "המודל מורד ומוכן לשימוש מיידי. אנא המתן.",
      });

      setDownloadStatus('מוריד ומטמיע מודל...');

      const useGPU = await isWebGPUAvailable();
      const transcriber = await pipeline(
        'automatic-speech-recognition',
        modelId,
        {
          device: useGPU ? 'webgpu' : 'wasm',
          dtype: useGPU ? 'fp32' : 'q8',
          progress_callback: (progress: any) => {
            if (progress.status === 'progress' && progress.total > 0) {
              const percent = Math.round((progress.loaded / progress.total) * 100);
              setDownloadProgress(percent);
              const loadedMB = (progress.loaded / (1024 * 1024)).toFixed(1);
              const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
              setDownloadStatus(`${loadedMB}MB / ${totalMB}MB`);
            } else if (progress.status === 'initiate') {
              setDownloadStatus(`מוריד: ${progress.file || ''}`);
            } else if (progress.status === 'done') {
              setDownloadStatus('טוען מודל...');
            }
          }
        }
      );

      if (transcriber && typeof (transcriber as any).dispose === 'function') {
        await (transcriber as any).dispose();
      }

      const downloaded = localStorage.getItem('downloaded_models');
      const downloadedIds = downloaded ? JSON.parse(downloaded) : [];
      if (!downloadedIds.includes(modelId)) {
        downloadedIds.push(modelId);
        localStorage.setItem('downloaded_models', JSON.stringify(downloadedIds));
      }

      selectModel(modelId);

      setModels(prev => prev.map(model =>
        model.id === modelId ? { ...model, downloaded: true } : model
      ));

      toast({
        title: "המודל הורד בהצלחה! ✅",
        description: "המודל מוכן לשימוש מיידי ללא אינטרנט",
      });

      await calculateCacheSize();
    } catch (error) {
      console.error('Error downloading model:', error);
      toast({
        title: "שגיאה בהורדת מודל",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
    } finally {
      setDownloadingModel(null);
      setDownloadProgress(0);
      setDownloadStatus('');
    }
  };

  const handleDownload = async (modelId: string) => {
    const model = ALL_MODELS.find(m => m.id === modelId);
    if (model?.runtime === 'server') {
      await handleDownloadServer(modelId);
    } else {
      await handleDownloadBrowser(modelId);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      // Remove from downloaded list
      const downloaded = localStorage.getItem('downloaded_models');
      if (downloaded) {
        const downloadedIds = JSON.parse(downloaded).filter((id: string) => id !== modelId);
        localStorage.setItem('downloaded_models', JSON.stringify(downloadedIds));
      }

      setModels(prev => prev.map(model =>
        model.id === modelId ? { ...model, downloaded: false } : model
      ));

      // Clear browser cache for this model (if possible)
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          if (name.includes(modelId)) {
            await caches.delete(name);
          }
        }
      }

      toast({
        title: "המודל נמחק",
        description: "המודל הוסר מהמטמון המקומי",
      });

      await calculateCacheSize();
    } catch (error) {
      console.error('Error deleting model:', error);
      toast({
        title: "שגיאה במחיקת מודל",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
    }
  };

  const clearAllCache = async () => {
    try {
      localStorage.removeItem('downloaded_models');
      setModels(prev => prev.map(model => ({ ...model, downloaded: false })));

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      toast({
        title: "המטמון נוקה",
        description: "כל המודלים הוסרו",
      });

      await calculateCacheSize();
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast({
        title: "שגיאה בניקוי מטמון",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
    }
  };

  const filteredModels = models.filter(m => {
    if (filter === 'hebrew') return m.hebrewOptimized;
    if (filter === 'downloaded') return m.downloaded;
    if (filter === 'server') return m.runtime === 'server';
    return true;
  });

  const speedLabel = (s: string) => s === 'fast' ? '⚡ מהיר' : s === 'medium' ? '🔄 בינוני' : '🐢 איטי';
  const accuracyLabel = (a: string) => a === 'basic' ? 'בסיסי' : a === 'good' ? 'טוב' : a === 'great' ? 'מצוין' : 'מעולה';
  const runtimeLabel = (r: string) => r === 'server' ? '🖥️ GPU/CUDA' : '🌐 דפדפן';

  return (
    <Card className="p-6" dir="rtl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">ניהול מודלים מקומיים</h3>
            <p className="text-sm text-muted-foreground">
              הורד מודלי Whisper לתמלול מקומי — דפדפן או שרת CUDA
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <HardDrive className="w-4 h-4" />
              <span>{cacheSize} MB בשימוש</span>
            </div>
            <div className={`flex items-center gap-1 ${serverConnected ? 'text-green-600' : 'text-red-500'}`}>
              {serverConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              <span>{serverConnected ? 'שרת CUDA פעיל' : 'שרת לא פעיל'}</span>
            </div>
          </div>
        </div>

        {/* Server status banner */}
        {serverConnected && serverStatus && (
          <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-700 dark:text-green-400">
                שרת מקומי: {serverStatus.gpu || serverStatus.device}
              </span>
              {serverStatus.current_model && (
                <Badge variant="secondary" className="text-xs">
                  מודל פעיל: {serverStatus.current_model}
                </Badge>
              )}
            </div>
          </div>
        )}

        {!serverConnected && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠️ <strong>שרת CUDA לא פעיל.</strong> מודלי ivrit-ai דורשים שרת מקומי.
              הפעל: <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">python server/transcribe_server.py</code>
            </p>
          </div>
        )}

        {/* Filter buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
            <Globe2 className="w-3 h-3 ml-1" />
            הכל ({models.length})
          </Button>
          <Button size="sm" variant={filter === 'server' ? 'default' : 'outline'} onClick={() => setFilter('server')}>
            <Server className="w-3 h-3 ml-1" />
            GPU/CUDA ({models.filter(m => m.runtime === 'server').length})
          </Button>
          <Button size="sm" variant={filter === 'hebrew' ? 'default' : 'outline'} onClick={() => setFilter('hebrew')}>
            🇮🇱 עברית ({models.filter(m => m.hebrewOptimized).length})
          </Button>
          <Button size="sm" variant={filter === 'downloaded' ? 'default' : 'outline'} onClick={() => setFilter('downloaded')}>
            <CheckCircle className="w-3 h-3 ml-1" />
            מותקנים ({models.filter(m => m.downloaded).length})
          </Button>
        </div>

        <div className="space-y-3">
          {filteredModels.map((model) => (
            <Card 
              key={model.id} 
              className={`p-4 transition-all ${
                selectedModel === model.id ? 'ring-2 ring-primary border-primary' : ''
              } ${model.hebrewOptimized ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold">{model.name}</h4>
                    {model.downloaded && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    {selectedModel === model.id && (
                      <Badge variant="default" className="text-xs">פעיל</Badge>
                    )}
                    {model.hebrewOptimized && (
                      <Badge variant="secondary" className="text-xs">🇮🇱 עברית</Badge>
                    )}
                    <Badge variant="outline" className={`text-xs ${model.runtime === 'server' ? 'border-purple-300 text-purple-600' : 'border-blue-300 text-blue-600'}`}>
                      {runtimeLabel(model.runtime)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {model.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{model.size}</span>
                    <span>•</span>
                    <span>{speedLabel(model.speed)}</span>
                    <span>•</span>
                    <span>דיוק: {accuracyLabel(model.accuracy)}</span>
                  </div>
                  {downloadingModel === model.id && (
                    <div className="mt-2">
                      <Progress value={downloadProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-1">{downloadStatus}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {!model.downloaded ? (
                    <Button
                      size="sm"
                      onClick={() => handleDownload(model.id)}
                      disabled={downloadingModel !== null || (model.runtime === 'server' && !serverConnected)}
                      className={model.hebrewOptimized ? 'bg-blue-600 hover:bg-blue-700' : ''}
                    >
                      {model.runtime === 'server' ? <Server className="w-4 h-4 ml-1" /> : <Download className="w-4 h-4 ml-1" />}
                      {downloadingModel === model.id ? 'טוען...' : model.runtime === 'server' ? 'טען בשרת' : 'הורד והתחבר'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant={selectedModel === model.id ? 'default' : 'outline'}
                        onClick={() => selectModel(model.id)}
                      >
                        <Star className="w-4 h-4 ml-1" />
                        {selectedModel === model.id ? 'פעיל ✓' : 'בחר'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(model.id)}
                        disabled={downloadingModel !== null}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3 ml-1" />
                        מחק
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllCache}
            className="w-full"
          >
            <Trash2 className="w-4 h-4 ml-1" />
            נקה את כל המטמון המקומי
          </Button>
        </div>

        <div className="p-3 bg-muted rounded-lg space-y-2">
          <p className="text-xs text-muted-foreground">
            💡 <strong>טיפ:</strong> מודלי דפדפן נשמרים במטמון הדפדפן. מודלי CUDA רצים על השרת המקומי עם GPU.
          </p>
          <p className="text-xs text-muted-foreground">
            🇮🇱 <strong>מומלץ לעברית:</strong> מודלי Ivrit.ai אומנו במיוחד על עברית ודורשים שרת CUDA.
          </p>
          <p className="text-xs text-muted-foreground">
            🖥️ <strong>שרת CUDA:</strong> הפעל <code className="bg-background px-1 rounded">python server/transcribe_server.py</code> לתמלול מהיר עם GPU.
          </p>
        </div>
      </div>
    </Card>
  );
};
