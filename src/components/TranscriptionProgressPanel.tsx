import { Button } from "@/components/ui/button";
import { Zap, Globe, Chrome, Mic, Waves, Sparkles, Server, Cpu, Pause, FileAudio, Clock } from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface TranscriptionProgressPanelProps {
  engine?: string;
  progress?: number;
  statusText?: string;
  serverPhase?: string;
  serverAudioDur?: number;
  serverAudioProcessed?: number;
  transcribeElapsed?: number;
  elapsedSeconds?: number;
  fileName?: string;
  fileSize?: number;
  onCancel?: () => void;
}

export function TranscriptionProgressPanel({
  engine,
  progress,
  statusText,
  serverPhase,
  serverAudioDur = 0,
  serverAudioProcessed = 0,
  transcribeElapsed = 0,
  elapsedSeconds = 0,
  fileName,
  fileSize,
  onCancel,
}: TranscriptionProgressPanelProps) {
  const hasProgress = progress !== undefined && progress > 0;

  return (
    <div className="w-full rounded-lg border border-primary/40 bg-primary/5 shadow-sm p-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-2.5 text-right">
          {/* File info row */}
          {fileName && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
              <FileAudio className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-medium">{fileName}</span>
              {fileSize !== undefined && <span className="text-[10px]">({formatBytes(fileSize)})</span>}
            </div>
          )}

          {/* Top row: status + engine badge */}
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
              engine === 'groq' ? 'text-primary border-primary/30' :
              engine === 'google' ? 'text-blue-500 border-blue-500/30' :
              engine === 'assemblyai' ? 'text-green-500 border-green-500/30' :
              engine === 'deepgram' ? 'text-purple-500 border-purple-500/30' :
              engine === 'gemini' ? 'text-yellow-600 border-yellow-500/40' :
              engine === 'local-server' ? 'text-purple-500 border-purple-500/30' :
              engine === 'local' ? 'text-accent border-accent/30' :
              'text-primary border-primary/30'
            }`}>
              {engine === 'groq' && <Zap className="w-3 h-3" />}
              {engine === 'openai' && <Globe className="w-3 h-3" />}
              {engine === 'google' && <Chrome className="w-3 h-3" />}
              {engine === 'assemblyai' && <Mic className="w-3 h-3" />}
              {engine === 'deepgram' && <Waves className="w-3 h-3" />}
              {engine === 'gemini' && <Sparkles className="w-3 h-3" />}
              {engine === 'local-server' && <Server className="w-3 h-3" />}
              {engine === 'local' && <Cpu className="w-3 h-3" />}
              {engine === 'groq' ? 'Groq' : engine === 'openai' ? 'OpenAI' : engine === 'google' ? 'Google' : engine === 'assemblyai' ? 'AssemblyAI' : engine === 'deepgram' ? 'Deepgram' : engine === 'gemini' ? 'Gemini' : engine === 'local-server' ? 'CUDA' : 'ONNX'}
            </span>
            <span className="font-medium text-sm">
              {hasProgress
                ? `מתמלל... ${progress}%`
                : engine === 'local-server' && serverPhase === 'loading-model'
                  ? '⏳ טוען מודל...'
                  : (statusText || 'מתמלל...')}
            </span>
          </div>

          {/* Big percentage display — all engines with real progress */}
          {hasProgress && (
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold tabular-nums text-primary leading-none">{progress}</span>
                <span className="text-base font-medium text-muted-foreground">%</span>
              </div>
              {engine === 'local-server' && serverAudioDur > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  🎵 {Math.floor(serverAudioProcessed / 60)}:{String(Math.floor(serverAudioProcessed % 60)).padStart(2, '0')}
                  {' / '}
                  {Math.floor(serverAudioDur / 60)}:{String(Math.floor(serverAudioDur % 60)).padStart(2, '0')}
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="relative h-4 rounded-full bg-muted overflow-hidden">
            {hasProgress ? (
              <div
                className="absolute top-0 right-0 h-full rounded-full bg-primary transition-[width] duration-300 ease-out overflow-hidden"
                style={{ width: `${Math.max(progress, 2)}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-primary/40 rounded-full animate-pulse" />
            )}
          </div>
          {engine === 'local-server' && serverPhase === 'loading-model' && (
            <p className="text-xs text-muted-foreground text-center -mt-0.5">⏳ טוען מודל AI — התמלול יתחיל בקרוב</p>
          )}

          {/* Bottom row: timer + ETA */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              {engine === 'local-server' && hasProgress && progress >= 5 && progress < 100 && transcribeElapsed > 3 && (() => {
                const etaSec = Math.round((transcribeElapsed / progress) * (100 - progress));
                const etaMin = Math.floor(etaSec / 60);
                const etaSecRem = etaSec % 60;
                return <span>נותרו ~{etaMin > 0 ? `${etaMin}:${String(etaSecRem).padStart(2, '0')}` : `${etaSecRem}s`}</span>;
              })()}
              {engine === 'local-server' && serverAudioProcessed > 0 && transcribeElapsed > 2 && (() => {
                const rtf = transcribeElapsed / serverAudioProcessed;
                const speedX = serverAudioProcessed / Math.max(1, transcribeElapsed);
                return (
                  <span className="tabular-nums" title={`RTF=${rtf.toFixed(2)} (1 שנייה אודיו = ${rtf.toFixed(2)} שניות עיבוד)`}>
                    ⚡ {speedX.toFixed(1)}x
                  </span>
                );
              })()}
            </span>
            <span className="font-mono tabular-nums flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
        {onCancel && (
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={onCancel}
            title="השהה תמלול"
          >
            <Pause className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
