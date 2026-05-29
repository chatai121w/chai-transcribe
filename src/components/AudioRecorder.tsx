import { useState, useRef, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, Square, Pause, Play, Loader2, Zap, Globe, Chrome, Waves, Server, Cpu } from "lucide-react";
import { Mic as MicIcon } from "lucide-react";

const ENGINE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  groq: { label: 'Groq', icon: <Zap className="w-3 h-3" />, color: 'text-primary' },
  openai: { label: 'OpenAI', icon: <Globe className="w-3 h-3" />, color: 'text-primary' },
  google: { label: 'Google', icon: <Chrome className="w-3 h-3" />, color: 'text-blue-500' },
  assemblyai: { label: 'AssemblyAI', icon: <MicIcon className="w-3 h-3" />, color: 'text-green-500' },
  deepgram: { label: 'Deepgram', icon: <Waves className="w-3 h-3" />, color: 'text-purple-500' },
  'local-server': { label: 'CUDA', icon: <Server className="w-3 h-3" />, color: 'text-purple-500' },
  local: { label: 'ONNX', icon: <Cpu className="w-3 h-3" />, color: 'text-accent' },
};

interface AudioRecorderProps {
  onRecordingComplete: (file: File) => void;
  isTranscribing: boolean;
  engine?: string;
}

export const AudioRecorder = ({ onRecordingComplete, isTranscribing, engine }: AudioRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVisualization();
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const stopVisualization = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const startVisualization = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastUpdate = 0;

    const tick = () => {
      const now = performance.now();
      if (now - lastUpdate >= 100) { // ~10fps instead of 60fps
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        lastUpdate = now;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const startRecording = useCallback(async () => {
    try {
      // Request mono channel + browser-side noise/echo suppression for better transcription.
      // channelCount:1 → mono reduces upload size by 50% (server converts stereo→mono anyway).
      // noiseSuppression + echoCancellation handled by browser hardware/OS before encoding.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 128kbps opus gives much cleaner audio than 32kbps for Hebrew phonemes.
      // The server re-encodes to 16kHz/16-bit PCM anyway, so 128k is the sweet spot.
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        onRecordingComplete(file);
        stream.getTracks().forEach(t => t.stop());
        stopVisualization();
      };

      mediaRecorder.start(1000); // collect data every second
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);

      startVisualization(stream);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setAudioLevel(0);
  }, []);

  const togglePause = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => setDuration(prev => prev + 1), 1000);
      setIsPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPaused(true);
    }
  }, [isPaused]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Generate waveform bars
  const bars = 24;
  const barHeights = Array.from({ length: bars }, (_, i) => {
    if (!isRecording || isPaused) return 4;
    const base = audioLevel * 40;
    const variation = Math.sin(Date.now() / 200 + i * 0.5) * base * 0.5;
    return Math.max(4, base + variation);
  });

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        {engine && ENGINE_META[engine] && (
          <Badge variant="outline" className={`self-end flex items-center gap-1 text-[10px] px-2 py-0.5 ${ENGINE_META[engine].color}`}>
            {ENGINE_META[engine].icon}
            {ENGINE_META[engine].label}
          </Badge>
        )}
        <h3 className="text-lg font-semibold">
          {isTranscribing ? "מתמלל הקלטה..." : isRecording ? "מקליט..." : "הקלט ישירות"}
        </h3>

        {/* Waveform visualization */}
        <div className="flex items-center justify-center gap-[3px] h-12 w-full max-w-xs">
          {barHeights.map((h, i) => (
            <div
              key={i}
              className="rounded-full bg-primary transition-all duration-100"
              style={{
                width: 4,
                height: h,
                opacity: isRecording && !isPaused ? 0.6 + audioLevel * 0.4 : 0.3,
              }}
            />
          ))}
        </div>

        {/* Timer */}
        {isRecording && (
          <div className="text-2xl font-mono font-bold text-primary tabular-nums">
            {formatTime(duration)}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3">
          {!isRecording ? (
            <Button
              size="lg"
              onClick={startRecording}
              disabled={isTranscribing}
              className="rounded-full w-16 h-16"
            >
              {isTranscribing ? (
                <Loader2 className="w-7 h-7 animate-spin" />
              ) : (
                <Mic className="w-7 h-7" />
              )}
            </Button>
          ) : (
            <>
              <Button
                size="icon"
                variant="outline"
                onClick={togglePause}
                className="rounded-full w-12 h-12"
              >
                {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              </Button>
              <Button
                size="icon"
                variant="destructive"
                onClick={stopRecording}
                className="rounded-full w-16 h-16"
              >
                <Square className="w-7 h-7" />
              </Button>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {isRecording
            ? isPaused ? "לחץ להמשך הקלטה" : "לחץ על עצור כדי לתמלל"
            : "לחץ על המיקרופון כדי להתחיל"}
        </p>
      </div>
    </Card>
  );
};
