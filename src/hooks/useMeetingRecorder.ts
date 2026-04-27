/**
 * useMeetingRecorder — production-grade browser meeting recorder.
 *
 * Capabilities:
 *  - Three source modes: mic / system (tab) / both (mixed via WebAudio graph)
 *  - Quality presets (transcription / balanced / high) — controls bitrate, channels
 *  - Echo-safe defaults: AGC/NS/AEC on mic only; OFF on system/tab audio
 *  - Crash-safe chunked persistence to IndexedDB (5s timeslice)
 *  - Auto-fix WebM duration metadata for proper seeking after stop
 *  - Pause/resume with accurate duration counting
 *  - Auto-stop on screen-share revoke
 *
 * References (see project research notes):
 *  - MDN MediaRecorder, MDN getDisplayMedia
 *  - RecordRTC chunked-write pattern
 *  - npm fix-webm-duration
 */

import { useCallback, useEffect, useRef, useState } from "react";
import fixWebmDuration from "fix-webm-duration";
import { debugLog } from "@/lib/debugLogger";
import {
  meetingDbApi,
  type MeetingRecording,
  type MeetingNote,
  type RecordingConfig,
  type SourceMode,
} from "@/lib/meetingRecorderDb";

export type QualityPreset = "transcription" | "balanced" | "high";

export interface QualityPresetSpec {
  preset: QualityPreset;
  label: string;
  description: string;
  audioBitsPerSecond: number;
  sampleRate: number;
  channelCount: 1 | 2;
}

export const QUALITY_PRESETS: QualityPresetSpec[] = [
  {
    preset: "transcription",
    label: "תמלול (קל ומהיר)",
    description: "24 kbps · מונו · 16kHz — מותאם ל-Whisper, חוסך מקום",
    audioBitsPerSecond: 24_000,
    sampleRate: 16_000,
    channelCount: 1,
  },
  {
    preset: "balanced",
    label: "מאוזן (מומלץ)",
    description: "32 kbps · מונו · 48kHz — איכות טובה, גודל סביר",
    audioBitsPerSecond: 32_000,
    sampleRate: 48_000,
    channelCount: 1,
  },
  {
    preset: "high",
    label: "איכות גבוהה",
    description: "64 kbps · סטריאו · 48kHz — לארכיון/הופעות, קובץ גדול",
    audioBitsPerSecond: 64_000,
    sampleRate: 48_000,
    channelCount: 2,
  },
];

const TIMESLICE_MS = 5_000; // research-recommended sweet spot

const pickMimeType = (): string => {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
};

const newId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export interface UseMeetingRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  isStarting: boolean;
  isFinalizing: boolean;
  durationMs: number;
  audioLevel: number; // 0..1
  currentRecordingId: string | null;
  notes: MeetingNote[];
  error: string | null;
}

export interface StartOptions {
  sourceMode: SourceMode;
  preset: QualityPreset;
  title: string;
  folder: string | null;
}

export function useMeetingRecorder(options: {
  /** Called when finalisation finishes; receives the assembled file + recording row. */
  onFinalized?: (file: File, rec: MeetingRecording) => void;
}) {
  const { onFinalized } = options;

  const [state, setState] = useState<UseMeetingRecorderState>({
    isRecording: false,
    isPaused: false,
    isStarting: false,
    isFinalizing: false,
    durationMs: 0,
    audioLevel: 0,
    currentRecordingId: null,
    notes: [],
    error: null,
  });

  // ---- Refs (stable across renders) ----
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chunkSeqRef = useRef(0);
  const recordingIdRef = useRef<string | null>(null);
  const sizeBytesRef = useRef(0);
  const startedAtRef = useRef(0);
  const recordedMsRef = useRef(0); // accumulated recording time across pauses
  const segmentStartRef = useRef(0); // wall-clock start of current resumed segment
  const isPausedRef = useRef(false);
  const presetRef = useRef<QualityPresetSpec>(QUALITY_PRESETS[1]);
  const sourceModeRef = useRef<SourceMode>("both");
  const titleRef = useRef("");
  const folderRef = useRef<string | null>(null);
  const mimeTypeRef = useRef("audio/webm");

  // ---- Cleanup ----
  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  // ---- Stream acquisition ----
  const acquireStreams = async (
    mode: SourceMode,
    preset: QualityPresetSpec
  ): Promise<{ recordStream: MediaStream; capturedStreams: MediaStream[] }> => {
    const captured: MediaStream[] = [];

    const getMic = async () => {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: preset.channelCount,
          sampleRate: preset.sampleRate,
        },
      });
      captured.push(s);
      return s;
    };

    const getSystem = async () => {
      // Chrome/Edge require video=true to expose system/tab audio.
      // We immediately stop the video tracks since we only need audio.
      // We also pass several display-capture hints when supported:
      //   displaySurface: "browser"  → favour tab capture (Zoom/Meet in browser)
      //   selfBrowserSurface: "exclude" → don't allow capturing our own app (loop)
      //   surfaceSwitching: "include" → user can switch tab without re-prompt
      //   suppressLocalAudioPlayback: true → avoid speaker feedback when monitoring
      // These constraints are forward-compatible: unknown keys are ignored.
      const constraints = {
        video: { frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        displaySurface: "browser",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        suppressLocalAudioPlayback: true,
        systemAudio: "include",
      } as unknown as DisplayMediaStreamOptions;
      const s = await navigator.mediaDevices.getDisplayMedia(constraints);
      const audioTracks = s.getAudioTracks();
      if (audioTracks.length === 0) {
        s.getTracks().forEach((t) => t.stop());
        throw new Error(
          "לא נבחר אודיו לשיתוף. סמן 'שתף את האודיו של הלשונית' בחלון השיתוף ונסה שוב."
        );
      }
      // Drop video — audio only
      s.getVideoTracks().forEach((t) => t.stop());
      captured.push(s);
      return s;
    };

    if (mode === "mic") {
      const s = await getMic();
      return { recordStream: new MediaStream(s.getAudioTracks()), capturedStreams: captured };
    }
    if (mode === "system") {
      const s = await getSystem();
      return { recordStream: new MediaStream(s.getAudioTracks()), capturedStreams: captured };
    }

    // both → mix mic + system through Web Audio graph
    // (system grabbed FIRST so the user dismisses the picker before mic prompt)
    const sys = await getSystem();
    const mic = await getMic();

    const ctx = new AudioContext({ sampleRate: preset.sampleRate });
    audioCtxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();

    const sysSrc = ctx.createMediaStreamSource(new MediaStream(sys.getAudioTracks()));
    const micSrc = ctx.createMediaStreamSource(new MediaStream(mic.getAudioTracks()));
    const sysGain = ctx.createGain();
    const micGain = ctx.createGain();
    // -3dB each → headroom against clipping when both are loud
    sysGain.gain.value = 0.85;
    micGain.gain.value = 0.85;

    // Dynamics compressor: gently normalises loud/quiet passages
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24; // start compressing at -24 dBFS
    compressor.knee.value = 30;       // soft knee for natural sound
    compressor.ratio.value = 4;       // 4:1 ratio
    compressor.attack.value = 0.003;  // 3 ms attack
    compressor.release.value = 0.25;  // 250 ms release

    sysSrc.connect(sysGain).connect(compressor);
    micSrc.connect(micGain).connect(compressor);
    compressor.connect(dest);

    return { recordStream: dest.stream, capturedStreams: captured };
  };

  // ---- Visualisation ----
  const startVisualization = (stream: MediaStream) => {
    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    src.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let last = 0;
    const tick = () => {
      const now = performance.now();
      if (now - last >= 100) {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setState((s) => ({ ...s, audioLevel: avg / 255 }));
        last = now;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  // ---- Tick duration timer ----
  const startTimer = () => {
    segmentStartRef.current = performance.now();
    timerRef.current = setInterval(() => {
      const segment = performance.now() - segmentStartRef.current;
      const total = recordedMsRef.current + segment;
      setState((s) => ({ ...s, durationMs: total }));
    }, 250);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // =============================================================
  // Public API
  // =============================================================

  const start = useCallback(
    async (opts: StartOptions) => {
      if (state.isRecording || state.isStarting) return;
      const preset = QUALITY_PRESETS.find((p) => p.preset === opts.preset) ?? QUALITY_PRESETS[1];
      presetRef.current = preset;
      sourceModeRef.current = opts.sourceMode;
      titleRef.current = opts.title.trim() || `פגישה ${new Date().toLocaleString("he-IL")}`;
      folderRef.current = opts.folder;

      setState((s) => ({ ...s, isStarting: true, error: null, notes: [], durationMs: 0 }));
      try {
        const { recordStream, capturedStreams } = await acquireStreams(opts.sourceMode, preset);
        streamsRef.current = capturedStreams;

        const mimeType = pickMimeType();
        mimeTypeRef.current = mimeType;
        const recorder = new MediaRecorder(recordStream, {
          mimeType,
          audioBitsPerSecond: preset.audioBitsPerSecond,
        });
        recorderRef.current = recorder;

        const id = newId();
        recordingIdRef.current = id;
        chunkSeqRef.current = 0;
        sizeBytesRef.current = 0;
        recordedMsRef.current = 0;
        startedAtRef.current = Date.now();
        isPausedRef.current = false;

        const config: RecordingConfig = {
          mimeType,
          audioBitsPerSecond: preset.audioBitsPerSecond,
          sampleRate: preset.sampleRate,
          channelCount: preset.channelCount,
          preset: preset.preset,
        };

        const ext = mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("ogg")
          ? "ogg"
          : "webm";
        const fileName = `${titleRef.current.replace(/[\\/:*?"<>|]/g, "_")}-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.${ext}`;

        await meetingDbApi.createRecording({
          id,
          title: titleRef.current,
          folder: folderRef.current,
          notes: [],
          sourceMode: opts.sourceMode,
          config,
          startedAt: startedAtRef.current,
          endedAt: null,
          durationMs: 0,
          sizeBytes: 0,
          status: "recording",
          fileName,
        });

        recorder.ondataavailable = async (e) => {
          if (!e.data || e.data.size === 0) return;
          const seq = chunkSeqRef.current++;
          sizeBytesRef.current += e.data.size;
          try {
            await meetingDbApi.appendChunk(id, seq, e.data);
            await meetingDbApi.updateRecording(id, {
              sizeBytes: sizeBytesRef.current,
            });
          } catch (err) {
            debugLog.error("MeetingRecorder", "Failed to persist chunk", String(err));
          }
        };

        recorder.onerror = (e) => {
          debugLog.error("MeetingRecorder", "MediaRecorder error", String(e));
          setState((s) => ({ ...s, error: "שגיאה במקליט המדיה — ההקלטה נעצרה." }));
          void stop();
        };

        // Auto-stop on share revoked
        capturedStreams.forEach((s) =>
          s.getTracks().forEach((t) => {
            t.onended = () => {
              if (recorderRef.current && recorderRef.current.state !== "inactive") {
                debugLog.info("MeetingRecorder", "Source track ended → finalising");
                void stop();
              }
            };
          })
        );

        recorder.start(TIMESLICE_MS);
        startTimer();
        startVisualization(recordStream);

        setState((s) => ({
          ...s,
          isRecording: true,
          isPaused: false,
          isStarting: false,
          currentRecordingId: id,
          durationMs: 0,
        }));

        debugLog.info(
          "MeetingRecorder",
          `▶️ Started: ${opts.sourceMode} / ${preset.preset} / ${mimeType} @ ${preset.audioBitsPerSecond}bps`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog.error("MeetingRecorder", "Start failed", msg);
        setState((s) => ({ ...s, isStarting: false, error: msg }));
        teardown();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.isRecording, state.isStarting]
  );

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    r.pause();
    isPausedRef.current = true;
    const segment = performance.now() - segmentStartRef.current;
    recordedMsRef.current += segment;
    stopTimer();
    setState((s) => ({ ...s, isPaused: true }));
  }, []);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    isPausedRef.current = false;
    startTimer();
    setState((s) => ({ ...s, isPaused: false }));
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    const r = recorderRef.current;
    const id = recordingIdRef.current;
    if (!r || !id) return;

    setState((s) => ({ ...s, isFinalizing: true }));

    // capture final segment time before stop fires
    if (!isPausedRef.current) {
      const segment = performance.now() - segmentStartRef.current;
      recordedMsRef.current += segment;
    }
    stopTimer();

    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      if (r.state === "inactive") {
        finish();
        return;
      }
      r.addEventListener("stop", finish, { once: true });
      try {
        r.stop();
      } catch {
        finish();
      }
    });

    // Allow any final ondataavailable to flush to IDB
    await new Promise((res) => setTimeout(res, 100));

    try {
      const mimeType = mimeTypeRef.current;
      let blob = await meetingDbApi.assembleFromChunks(id, mimeType);
      if (!blob) {
        throw new Error("לא נמצאו נתוני אודיו (אולי לא ניתנה הרשאת מיקרופון/אודיו?).");
      }

      // Patch WebM duration so seeking works in players (Chrome bug).
      // Signature: fixWebmDuration(blob, durationMs, callback?, options?)
      // With no callback it returns a Promise.
      if (mimeType.startsWith("audio/webm")) {
        try {
          blob = await fixWebmDuration(blob, recordedMsRef.current);
        } catch (err) {
          debugLog.warn(
            "MeetingRecorder",
            "fix-webm-duration failed (recording is still usable)",
            String(err)
          );
        }
      }

      const rec = await meetingDbApi.getRecording(id);
      if (!rec) throw new Error("ההקלטה לא נמצאה במאגר.");

      const updated: MeetingRecording = {
        ...rec,
        status: "completed",
        endedAt: Date.now(),
        durationMs: Math.round(recordedMsRef.current),
        sizeBytes: blob.size,
        assembled: blob,
      };
      await meetingDbApi.updateRecording(id, {
        status: updated.status,
        endedAt: updated.endedAt,
        durationMs: updated.durationMs,
        sizeBytes: updated.sizeBytes,
        assembled: updated.assembled,
      });
      // Free per-chunk rows now that we have the assembled blob
      await meetingDbApi.clearChunks(id);

      const file = new File([blob], rec.fileName, { type: mimeType });

      teardown();
      setState((s) => ({
        ...s,
        isRecording: false,
        isPaused: false,
        isFinalizing: false,
        audioLevel: 0,
        currentRecordingId: null,
      }));

      debugLog.info(
        "MeetingRecorder",
        `⏹ Finalised: ${rec.fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB, ${Math.round(
          recordedMsRef.current / 1000
        )}s)`
      );
      onFinalized?.(file, updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.error("MeetingRecorder", "Finalise failed", msg);
      setState((s) => ({ ...s, isFinalizing: false, error: msg }));
      teardown();
    }
  }, [onFinalized, teardown]);

  // ---- Notes ----
  const addNote = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = recordingIdRef.current;
      const note: MeetingNote = {
        id: newId(),
        timeMs: Math.round(state.durationMs),
        text: trimmed,
        createdAt: Date.now(),
      };
      const next = [...state.notes, note];
      setState((s) => ({ ...s, notes: next }));
      if (id) {
        try {
          await meetingDbApi.updateRecording(id, { notes: next });
        } catch (err) {
          debugLog.warn("MeetingRecorder", "Persist note failed", String(err));
        }
      }
    },
    [state.durationMs, state.notes]
  );

  const removeNote = useCallback(
    async (noteId: string) => {
      const id = recordingIdRef.current;
      const next = state.notes.filter((n) => n.id !== noteId);
      setState((s) => ({ ...s, notes: next }));
      if (id) {
        try {
          await meetingDbApi.updateRecording(id, { notes: next });
        } catch {
          /* ignore */
        }
      }
    },
    [state.notes]
  );

  return {
    state,
    start,
    pause,
    resume,
    stop,
    addNote,
    removeNote,
  };
}
