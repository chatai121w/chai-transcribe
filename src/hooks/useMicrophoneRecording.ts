import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

interface RecordingResult {
  file: File;
  durationSeconds: number;
}

interface UseMicrophoneRecordingOptions {
  fileNamePrefix?: string;
  onComplete: (result: RecordingResult) => void;
  onError?: (message: string) => void;
  /**
   * האם למדוד את עוצמת הקול תוך כדי ההקלטה, לצורך הצגת מד.
   * כבוי כברירת מחדל: המדידה מפעילה חישוב מתמשך בכל פריים, ואין טעם
   * לשלם עליו במסכים שאינם מציגים מד.
   */
  monitorLevel?: boolean;
}

export function useMicrophoneRecording({
  fileNamePrefix = 'recording',
  onComplete,
  onError,
  monitorLevel = false,
}: UseMicrophoneRecordingOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const completeRef = useRef(onComplete);
  const errorRef = useRef(onError);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  /** סך הזמן שההקלטה הייתה בהשהיה, כדי שהמשך לא ייספר כזמן מוקלט. */
  const pausedTotalRef = useRef(0);
  const pausedAtRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);
  useEffect(() => { errorRef.current = onError; }, [onError]);

  const stopLevelMonitor = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const startLevelMonitor = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const node = analyserRef.current;
        if (!node) return;
        node.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i];
        setAudioLevel(Math.min(1, sum / buffer.length / 128));
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      // מד העוצמה הוא נוחות בלבד. אם הוא נכשל, ההקלטה עצמה חייבת להמשיך.
      stopLevelMonitor();
    }
  }, [stopLevelMonitor]);

  const releaseStream = useCallback(() => {
    stopLevelMonitor();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopLevelMonitor]);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      errorRef.current?.('הדפדפן אינו תומך בהקלטה מהמיקרופון');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;
      startedAtRef.current = Date.now();
      pausedTotalRef.current = 0;
      pausedAtRef.current = 0;
      setIsPaused(false);
      setElapsedSeconds(0);
      if (monitorLevel) startLevelMonitor(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        recorderRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
        errorRef.current?.('ההקלטה הופסקה עקב שגיאת מיקרופון');
      };
      recorder.onstop = () => {
        // זמן ההשהיה אינו מוקלט, ולכן הוא יורד מהמשך. בלי זה הקלטה
        // שהושהתה לדקה מדווחת דקה יותר ממה שיש בקובץ, וכל חישוב
        // שמסתמך על המשך — למשל התאמת כתוביות — יוצא מוסט.
        const pausedMs = pausedTotalRef.current + (pausedAtRef.current ? Date.now() - pausedAtRef.current : 0);
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current - pausedMs) / 1000));
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        releaseStream();
        recorderRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
        if (discardRef.current) return;
        if (!blob.size) {
          errorRef.current?.('לא התקבל שמע מהמיקרופון');
          return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        completeRef.current({
          file: new File([blob], `${fileNamePrefix}-${timestamp}.${extensionForMimeType(finalMimeType)}`, { type: finalMimeType }),
          durationSeconds,
        });
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (error) {
      releaseStream();
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      errorRef.current?.(denied ? 'יש לאשר גישה למיקרופון כדי להתחיל הקלטה' : 'לא ניתן לפתוח את המיקרופון');
    }
  }, [fileNamePrefix, releaseStream, monitorLevel, startLevelMonitor]);

  const stop = useCallback(() => {
    const state = recorderRef.current?.state;
    // גם הקלטה בהשהיה צריכה להיעצר — אחרת לחיצה על עצירה אחרי השהיה
    // לא עושה כלום, והקובץ לא נוצר.
    if (state === 'recording' || state === 'paused') recorderRef.current?.stop();
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== 'recording') return;
    recorderRef.current.pause();
    pausedAtRef.current = Date.now();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== 'paused') return;
    recorderRef.current.resume();
    if (pausedAtRef.current) {
      pausedTotalRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
    }
    setIsPaused(false);
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    const state = recorderRef.current?.state;
    if (state === 'recording' || state === 'paused') recorderRef.current?.stop();
    else releaseStream();
  }, [releaseStream]);

  useEffect(() => {
    if (!isRecording || isPaused) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [isRecording, isPaused]);

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.onerror = null;
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    }
    releaseStream();
  }, [releaseStream]);

  return { isRecording, isPaused, audioLevel, elapsedSeconds, start, stop, pause, resume, cancel };
}
