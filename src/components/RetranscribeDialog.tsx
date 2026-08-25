import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mic2, RotateCcw, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { useLocalServer } from "@/hooks/useLocalServer";
import { useLocalTranscription } from "@/hooks/useLocalTranscription";
import { supabase } from "@/integrations/supabase/client";
import {
  runCloudRetranscription,
  TRANSCRIPTION_ENGINE_OPTIONS,
  type RetranscriptionResult,
  type TranscriptionEngineId,
} from "@/lib/retranscriptionRunner";
import { normalizeSourceLanguage, resolveCudaModel } from "@/lib/transcriptionLanguages";

const CUDA_MODELS = [
  { value: "ivrit-ai/whisper-large-v3-turbo-ct2", label: "Ivrit.ai Turbo V3 - מומלץ" },
  { value: "ivrit-ai/whisper-large-v3-ct2", label: "Ivrit.ai Large V3 - דיוק מרבי" },
  { value: "ivrit-ai/yi-whisper-large-v3-turbo-ct2", label: "Ivrit.ai יידיש Turbo" },
  { value: "large-v3-turbo", label: "Whisper Large V3 Turbo" },
  { value: "large-v3", label: "Whisper Large V3" },
];

const GEMINI_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash-latest", label: "Gemini Flash Latest" },
];

interface RetranscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcriptId: string | null;
  currentEngine?: string | null;
  audioBlob: Blob | null;
  audioFileName?: string;
  audioFilePath?: string | null;
  onComplete: (result: RetranscriptionResult, jobId: string | null) => Promise<void> | void;
}

export function RetranscribeDialog({
  open,
  onOpenChange,
  transcriptId,
  currentEngine,
  audioBlob,
  audioFileName,
  audioFilePath,
  onComplete,
}: RetranscribeDialogProps) {
  const { user } = useAuth();
  const { preferences, updatePreference, patchTabSettings } = useCloudPreferences();
  const localBrowser = useLocalTranscription();
  const localServer = useLocalServer();
  const initialEngine = (preferences.engine || "local-server") as TranscriptionEngineId;
  const [engine, setEngine] = useState<TranscriptionEngineId>(initialEngine);
  const [cudaModel, setCudaModel] = useState(() => resolveCudaModel(normalizeSourceLanguage(preferences.source_language), localStorage.getItem("preferred_local_model")));
  const [geminiModel, setGeminiModel] = useState(() => (localStorage.getItem("gemini_transcription_model") || "gemini-2.5-flash").replace(/^google\//, ""));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastCloudProgressRef = useRef(-10);
  const sourceLanguage = normalizeSourceLanguage(preferences.source_language);
  const selectedOption = useMemo(() => TRANSCRIPTION_ENGINE_OPTIONS.find((option) => option.id === engine), [engine]);

  useEffect(() => {
    if (!open || running) return;
    setEngine((preferences.engine || "local-server") as TranscriptionEngineId);
    setProgress(0);
    setStatus("");
    setError(null);
    setCompleted(false);
    setReplacementFile(null);
  }, [open, preferences.engine, running]);

  const persistJobProgress = async (jobId: string | null, value: number, partial?: string) => {
    if (!jobId || value < lastCloudProgressRef.current + 5) return;
    lastCloudProgressRef.current = value;
    await supabase.from("transcription_jobs").update({ progress: value, ...(partial ? { partial_result: partial } : {}) }).eq("id", jobId);
  };

  const start = async () => {
    const sourceBlob = replacementFile || audioBlob;
    if (!sourceBlob || !transcriptId || running) return;
    setRunning(true);
    setCompleted(false);
    setError(null);
    setProgress(0);
    setStatus("מכין את קובץ המקור");
    lastCloudProgressRef.current = -10;
    abortRef.current = new AbortController();
    updatePreference("engine", engine);
    const fileName = replacementFile?.name || audioFileName?.trim() || `recording-${transcriptId.slice(0, 8)}.webm`;
    const file = replacementFile || new File([sourceBlob], fileName, { type: sourceBlob.type || "audio/webm" });
    let jobId: string | null = null;

    try {
      if (user) {
        const { data } = await supabase.from("transcription_jobs").insert({
          user_id: user.id,
          status: "processing",
          engine,
          file_name: file.name,
          file_path: audioFilePath || null,
          language: sourceLanguage,
          progress: 0,
          partial_result: null,
          result_text: null,
        }).select("id").single();
        jobId = data?.id || null;
      }

      let result: RetranscriptionResult;
      if (engine === "local-server") {
        setStatus("בודק את שרת CUDA המקומי");
        if (!(await localServer.checkConnection())) throw new Error("שרת CUDA המקומי אינו מחובר");
        localStorage.setItem("preferred_local_model", cudaModel);
        localStorage.setItem("preferred_local_model_runtime", "server");
        patchTabSettings({ preferredLocalTranscriptionModel: cudaModel });
        const serverResult = await localServer.transcribeStream(file, cudaModel, sourceLanguage, (partial) => {
          setProgress(partial.progress);
          setStatus(`CUDA: ${partial.progress}%`);
          void persistJobProgress(jobId, partial.progress, partial.text);
        }, undefined, {
          preset: preferences.cuda_preset,
          fastMode: preferences.cuda_fast_mode,
          computeType: preferences.cuda_compute_type,
          beamSize: preferences.cuda_beam_size,
          noConditionOnPrevious: preferences.cuda_no_condition_prev,
          vadAggressive: preferences.cuda_vad_aggressive,
          paragraphThreshold: preferences.cuda_paragraph_threshold,
          hotwords: preferences.cuda_hotwords,
          loshonKodesh: preferences.loshon_kodesh_enabled,
        });
        result = {
          text: serverResult.text,
          wordTimings: serverResult.wordTimings,
          engine,
          engineLabel: `Local CUDA (${serverResult.model || cudaModel})`,
          detectedLanguage: serverResult.language,
          model: serverResult.model || cudaModel,
        };
      } else if (engine === "local") {
        setStatus("מתמלל במנוע המקומי של הדפדפן");
        const localResult = await localBrowser.transcribe(file);
        result = {
          text: localResult.text,
          wordTimings: localResult.wordTimings,
          engine,
          engineLabel: `Local Browser (${localBrowser.currentModel || "Whisper"})`,
          model: localBrowser.currentModel || undefined,
        };
      } else {
        if (engine === "gemini") {
          localStorage.setItem("gemini_transcription_model", geminiModel);
          patchTabSettings({ geminiTranscriptionModel: geminiModel });
        }
        result = await runCloudRetranscription({
          engine,
          file,
          language: sourceLanguage,
          model: engine === "gemini" ? geminiModel : undefined,
          signal: abortRef.current.signal,
          onProgress: (value, nextStatus) => {
            setProgress(value);
            setStatus(nextStatus || `מתמלל: ${value}%`);
            void persistJobProgress(jobId, value);
          },
          onPartial: (partial, value) => void persistJobProgress(jobId, value, partial),
        });
      }

      setProgress(100);
      setStatus("שומר גרסה חדשה ומכין השוואה");
      if (jobId) {
        await supabase.from("transcription_jobs").update({ status: "completed", progress: 100, result_text: result.text, partial_result: null }).eq("id", jobId);
      }
      await onComplete(result, jobId);
      setCompleted(true);
      setStatus("התמלול הנוסף נשמר כגרסה חדשה");
    } catch (caught) {
      const cancelled = caught instanceof DOMException && caught.name === "AbortError" || (caught instanceof Error && caught.message === "CANCELLED");
      const message = cancelled ? "התמלול בוטל" : caught instanceof Error ? caught.message : "התמלול נכשל";
      setError(message);
      setStatus("");
      if (jobId) await supabase.from("transcription_jobs").update({ status: "failed", error_message: message }).eq("id", jobId);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (engine === "local-server") localServer.cancelStream();
    setStatus("מבטל תמלול...");
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent hideOverlay dir="rtl" className="!flex max-h-[calc(100vh-2rem)] !w-[min(44rem,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden p-0 text-right shadow-2xl" data-testid="retranscribe-dialog">
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-right">
          <DialogTitle className="flex items-center gap-2 text-right"><RotateCcw className="h-5 w-5" /> תמלול נוסף מאותה הקלטה</DialogTitle>
          <p className="text-xs text-muted-foreground">התוצאה הקיימת לא תידרס. התמלול החדש יישמר כגרסה וייפתח להשוואה.</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">הקלטה: </span><strong>{audioFileName || "הקלטה שמורה"}</strong></div>
            <div><span className="text-muted-foreground">מנוע נוכחי: </span><strong>{currentEngine || "לא ידוע"}</strong></div>
          </div>

          {!audioBlob && !replacementFile && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>קובץ המקור אינו זמין במחשב או בענן. בחר מחדש את אותה ההקלטה כדי להמשיך.</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label htmlFor="retranscription-source-file">קובץ מקור חלופי</Label>
            <input
              id="retranscription-source-file"
              data-testid="retranscription-source-file"
              type="file"
              accept="audio/*,video/*"
              disabled={running}
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:ms-0 file:me-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-primary"
              onChange={(event) => setReplacementFile(event.target.files?.[0] || null)}
            />
            <p className="text-xs text-muted-foreground">אופציונלי. הבחירה משמשת רק אם ההקלטה השמורה אינה זמינה או אם רוצים להחליף אותה.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="retranscription-engine">מנוע לתמלול הנוסף</Label>
            <Select value={engine} onValueChange={(value) => setEngine(value as TranscriptionEngineId)} disabled={running}>
              <SelectTrigger id="retranscription-engine" aria-label="מנוע לתמלול נוסף" className="text-right"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {TRANSCRIPTION_ENGINE_OPTIONS.map((option) => <SelectItem key={option.id} value={option.id}><span className="font-medium">{option.label}</span><span className="me-2 text-xs text-muted-foreground">{option.detail}</span></SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{selectedOption?.detail}</p>
          </div>

          {engine === "local-server" && <div className="space-y-2"><Label htmlFor="retranscription-cuda-model">מודל CUDA</Label><Select value={cudaModel} onValueChange={setCudaModel} disabled={running}><SelectTrigger id="retranscription-cuda-model" aria-label="מודל CUDA לתמלול נוסף"><SelectValue /></SelectTrigger><SelectContent dir="rtl">{CUDA_MODELS.map((model) => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent></Select></div>}
          {engine === "gemini" && <div className="space-y-2"><Label htmlFor="retranscription-gemini-model">מודל Gemini</Label><Select value={geminiModel} onValueChange={setGeminiModel} disabled={running}><SelectTrigger id="retranscription-gemini-model" aria-label="מודל Gemini לתמלול נוסף"><SelectValue /></SelectTrigger><SelectContent dir="rtl">{GEMINI_MODELS.map((model) => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent></Select></div>}

          {(running || completed) && <div className="space-y-2 rounded-md border p-3" aria-live="polite"><div className="flex items-center justify-between gap-3 text-sm"><span>{status}</span><strong dir="ltr">{Math.round(progress)}%</strong></div><Progress value={progress} />{completed && <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> נשמרה גרסה חדשה וההשוואה מוכנה</div>}</div>}
          {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-3">
          <Button type="button" variant="outline" disabled={running} onClick={() => onOpenChange(false)}>{completed ? "סגור" : "ביטול"}</Button>
          {running ? <Button type="button" variant="destructive" onClick={cancel}><Square className="h-4 w-4" /> עצור</Button> : <Button type="button" disabled={(!audioBlob && !replacementFile) || !transcriptId || completed} onClick={() => void start()} data-testid="start-retranscription">{completed ? <CheckCircle2 className="h-4 w-4" /> : <Mic2 className="h-4 w-4" />}{completed ? "הושלם" : "התחל תמלול נוסף"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
