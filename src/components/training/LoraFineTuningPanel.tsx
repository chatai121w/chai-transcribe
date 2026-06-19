/**
 * LoraFineTuningPanel — UI for managing Whisper LoRA fine-tuning runs on the
 * user's local GPU server. Designed to be embedded inside the ASR Training page.
 *
 * Flow:
 *   1. Create a dataset (or pick existing)
 *   2. Upload (audio, ground-truth text) pairs
 *   3. Finalize dataset → writes manifest.jsonl
 *   4. Configure hyperparameters + Start training
 *   5. Watch live progress (WER before/after, loss, % done)
 *   6. "Activate" a finished model so faster-whisper uses it
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import {
  Brain, Play, StopCircle, Upload, CheckCircle2, AlertCircle, Power,
  PowerOff, Trash2, FileAudio, Loader2,
} from 'lucide-react';
import { useLoraTraining, type LoraJob } from '@/hooks/useLoraTraining';

const STATUS_COLORS: Record<LoraJob['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  preparing: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  training: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  merging: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  converting: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  done: 'bg-green-500/15 text-green-600 dark:text-green-400',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

export default function LoraFineTuningPanel() {
  const {
    jobs, datasets, activeCt2,
    createDataset, uploadPair, finalizeDataset,
    startJob, cancelJob, setActiveModel,
    refreshJobs,
  } = useLoraTraining();

  // ── Dataset state ─────────────────────────────────────────────
  const [dsName, setDsName] = useState('');
  const [selectedDs, setSelectedDs] = useState<string>('');
  const [pairText, setPairText] = useState('');
  const [pairAudio, setPairAudio] = useState<File | null>(null);
  const [uploadingPair, setUploadingPair] = useState(false);

  // ── Training state ───────────────────────────────────────────
  const [jobName, setJobName] = useState('lora_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const [baseModel, setBaseModel] = useState('ivrit-ai/whisper-large-v3');
  const [epochs, setEpochs] = useState(3);
  const [batchSize, setBatchSize] = useState(8);
  const [lr, setLr] = useState(0.0001);
  const [loraR, setLoraR] = useState(32);
  const [mergeAndConvert, setMergeAndConvert] = useState(true);
  const [starting, setStarting] = useState(false);

  // ── Handlers ─────────────────────────────────────────────────
  const handleCreateDataset = async () => {
    if (!dsName.trim()) return;
    try {
      const id = await createDataset(dsName.trim());
      setSelectedDs(id);
      setDsName('');
      toast({ title: 'נוצר Dataset', description: id });
    } catch (e) {
      toast({ title: 'שגיאה', description: String(e), variant: 'destructive' });
    }
  };

  const handleUploadPair = async () => {
    if (!selectedDs || !pairAudio || !pairText.trim()) {
      toast({ title: 'חסר מידע', description: 'יש לבחור dataset, אודיו וטקסט אמת', variant: 'destructive' });
      return;
    }
    setUploadingPair(true);
    try {
      await uploadPair(selectedDs, pairAudio, pairText.trim());
      setPairAudio(null);
      setPairText('');
      toast({ title: 'נוסף לדאטהסט' });
    } catch (e) {
      toast({ title: 'שגיאה', description: String(e), variant: 'destructive' });
    } finally {
      setUploadingPair(false);
    }
  };

  const handleFinalize = async () => {
    if (!selectedDs) return;
    try {
      const res = await finalizeDataset(selectedDs);
      toast({ title: 'Manifest מוכן', description: `${res.rows} שורות → ${res.manifest}` });
    } catch (e) {
      toast({ title: 'שגיאה', description: String(e), variant: 'destructive' });
    }
  };

  const handleStart = async () => {
    if (!selectedDs) {
      toast({ title: 'בחר Dataset', variant: 'destructive' });
      return;
    }
    setStarting(true);
    try {
      await startJob({
        job_name: jobName,
        dataset_id: selectedDs,
        base_model: baseModel,
        epochs, batch_size: batchSize, lr,
        lora_r: loraR, lora_alpha: loraR * 2,
        merge_and_convert: mergeAndConvert,
      });
    } catch (e) {
      toast({ title: 'שגיאה בהפעלה', description: String(e), variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  };

  const selectedDsInfo = datasets.find(d => d.dataset_id === selectedDs);

  return (
    <div className="space-y-6" dir="rtl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              Fine-Tuning אמיתי (LoRA על Whisper)
            </CardTitle>
            {activeCt2 ? (
              <Badge className="bg-green-500/15 text-green-600 gap-1">
                <CheckCircle2 className="w-3 h-3" /> מודל מאומן פעיל
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <PowerOff className="w-3 h-3" /> מודל בסיס
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            רץ על ה-GPU המקומי. דורש: <code className="text-xs">pip install peft datasets accelerate evaluate jiwer librosa audiomentations</code>
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ─── 1. Dataset ─────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-2">1. הכנת Dataset</h3>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="שם dataset חדש (לדוגמה: gemara_ashkenazi_v1)"
                value={dsName}
                onChange={(e) => setDsName(e.target.value)}
              />
              <Button onClick={handleCreateDataset} disabled={!dsName.trim()}>צור</Button>
            </div>

            {datasets.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {datasets.map(d => (
                  <Button
                    key={d.dataset_id}
                    size="sm"
                    variant={selectedDs === d.dataset_id ? 'default' : 'outline'}
                    onClick={() => setSelectedDs(d.dataset_id)}
                    className="gap-1"
                  >
                    <FileAudio className="w-3 h-3" />
                    {d.dataset_id} <span className="opacity-60">({d.count})</span>
                    {d.has_manifest && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                  </Button>
                ))}
              </div>
            )}

            {selectedDs && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="text-xs text-muted-foreground">
                  פעיל: <code>{selectedDs}</code> · {selectedDsInfo?.count ?? 0} זוגות
                </div>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept="audio/*,video/mp4"
                    onChange={(e) => setPairAudio(e.target.files?.[0] || null)}
                    className="flex-1"
                  />
                </div>
                <Textarea
                  placeholder="טקסט אמת מדויק לקובץ האודיו"
                  value={pairText}
                  onChange={(e) => setPairText(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button onClick={handleUploadPair} disabled={uploadingPair} className="gap-1">
                    {uploadingPair ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    הוסף זוג
                  </Button>
                  <Button variant="secondary" onClick={handleFinalize}>
                    סגור Dataset → צור Manifest
                  </Button>
                </div>
              </div>
            )}
          </section>

          <Separator />

          {/* ─── 2. Hyperparameters ─────────────────── */}
          <section>
            <h3 className="text-sm font-semibold mb-2">2. פרמטרי אימון</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">שם Job</Label>
                <Input value={jobName} onChange={e => setJobName(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Base Model (HuggingFace)</Label>
                <Input value={baseModel} onChange={e => setBaseModel(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Epochs</Label>
                <Input type="number" min={1} max={20} value={epochs} onChange={e => setEpochs(Number(e.target.value) || 3)} />
              </div>
              <div>
                <Label className="text-xs">Batch Size</Label>
                <Input type="number" min={1} max={32} value={batchSize} onChange={e => setBatchSize(Number(e.target.value) || 8)} />
              </div>
              <div>
                <Label className="text-xs">Learning Rate</Label>
                <Input type="number" step="0.00001" value={lr} onChange={e => setLr(Number(e.target.value) || 1e-4)} />
              </div>
              <div>
                <Label className="text-xs">LoRA r (alpha = 2×r)</Label>
                <Input type="number" min={4} max={128} value={loraR} onChange={e => setLoraR(Number(e.target.value) || 32)} />
              </div>
              <div className="flex items-end gap-2 col-span-2">
                <Switch id="merge-conv" checked={mergeAndConvert} onCheckedChange={setMergeAndConvert} />
                <Label htmlFor="merge-conv" className="text-xs cursor-pointer">
                  מזג והמר ל-CT2 (להפעלה אוטומטית עם faster-whisper)
                </Label>
              </div>
            </div>

            <Button
              onClick={handleStart}
              disabled={starting || !selectedDs}
              className="mt-4 gap-2"
              size="lg"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              התחל אימון LoRA
            </Button>
          </section>

          <Separator />

          {/* ─── 3. Live jobs ───────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">3. עבודות אימון</h3>
              <Button size="sm" variant="ghost" onClick={refreshJobs}>רענן</Button>
            </div>
            <ScrollArea className="h-[300px] border rounded-lg p-2">
              {jobs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">אין עדיין עבודות אימון</div>
              ) : (
                <div className="space-y-3">
                  {jobs.map(j => (
                    <div key={j.job_id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-semibold">{j.job_id}</code>
                          <Badge className={STATUS_COLORS[j.status] || ''}>{j.status}</Badge>
                        </div>
                        <div className="flex gap-1">
                          {(j.status === 'training' || j.status === 'preparing' || j.status === 'merging' || j.status === 'converting') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => cancelJob(j.job_id)}>
                                  <StopCircle className="w-4 h-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>בטל</TooltipContent>
                            </Tooltip>
                          )}
                          {j.status === 'done' && j.ct2_model_path && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant={activeCt2 === j.ct2_model_path ? 'default' : 'ghost'}
                                  onClick={() => setActiveModel(activeCt2 === j.ct2_model_path ? null : j.ct2_model_path!)}
                                >
                                  <Power className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {activeCt2 === j.ct2_model_path ? 'בטל הפעלה (חזור למודל בסיס)' : 'הפעל מודל זה'}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>

                      {(j.status === 'training' || j.status === 'preparing') && (
                        <div>
                          <Progress value={j.progress || 0} className="h-2" />
                          <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                            <span>
                              {j.current_step ?? 0} / {j.total_steps ?? '?'} steps · epoch {(j.current_epoch ?? 0).toFixed(2)}
                            </span>
                            <span>{(j.progress || 0).toFixed(1)}%</span>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {j.wer_before != null && (
                          <div>WER לפני: <span className="font-mono">{j.wer_before.toFixed(2)}%</span></div>
                        )}
                        {j.wer_after != null && (
                          <div className={j.wer_before && j.wer_after < j.wer_before ? 'text-green-600' : ''}>
                            WER אחרי: <span className="font-mono">{j.wer_after.toFixed(2)}%</span>
                          </div>
                        )}
                        {j.train_loss != null && <div>train loss: <span className="font-mono">{Number(j.train_loss).toFixed(4)}</span></div>}
                        {j.eval_loss != null && <div>eval loss: <span className="font-mono">{Number(j.eval_loss).toFixed(4)}</span></div>}
                      </div>

                      {j.error && (
                        <div className="text-xs text-destructive flex items-start gap-1">
                          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="font-mono break-all">{j.error}</span>
                        </div>
                      )}

                      {j.log_tail && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">לוג</summary>
                          <pre className="mt-1 bg-muted/40 p-2 rounded text-[10px] overflow-auto max-h-40 whitespace-pre-wrap font-mono">{j.log_tail}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
