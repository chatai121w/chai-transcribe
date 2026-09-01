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
}

export function useMicrophoneRecording({
  fileNamePrefix = 'recording',
  onComplete,
  onError,
}: UseMicrophoneRecordingOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const completeRef = useRef(onComplete);
  const errorRef = useRef(onError);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);
  useEffect(() => { errorRef.current = onError; }, [onError]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

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
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        recorderRef.current = null;
        setIsRecording(false);
        errorRef.current?.('ההקלטה הופסקה עקב שגיאת מיקרופון');
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        releaseStream();
        recorderRef.current = null;
        setIsRecording(false);
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
  }, [fileNamePrefix, releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else releaseStream();
  }, [releaseStream]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.onerror = null;
      if (recorderRef.current.state === 'recording') recorderRef.current.stop();
    }
    releaseStream();
  }, [releaseStream]);

  return { isRecording, elapsedSeconds, start, stop, cancel };
}
