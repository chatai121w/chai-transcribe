/**
 * usePreRollBuffer — keeps a rolling N-second window of microphone audio.
 *
 * When the ff_pre_roll_buffer flag is on, call start() to pre-warm the mic.
 * The hook continuously captures audio into a circular WAV buffer. When the
 * user clicks "Record" in the consuming component, call drainAsBlob() to
 * prepend the pre-roll to the actual recording.
 *
 * Memory: ~32 KB/s × secondsToKeep at 16 kHz mono 16-bit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readFlag } from "@/lib/featureFlags";

interface State {
  armed: boolean;
  level: number; // 0..1 instantaneous RMS, for UI meter
}

export function usePreRollBuffer(secondsToKeep = 2) {
  const [state, setState] = useState<State>({ armed: false, level: 0 });
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const writtenSamplesRef = useRef<number>(0);
  const sampleRateRef = useRef<number>(16000);

  const stop = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* ignore */ }
    procRef.current = null;
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    bufferRef.current = [];
    writtenSamplesRef.current = 0;
    setState({ armed: false, level: 0 });
  }, []);

  const start = useCallback(async () => {
    if (!readFlag("ff_pre_roll_buffer")) return false;
    if (state.armed) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: readFlag("ff_agc_auto"),
        },
      });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ sampleRate: 16000 });
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;

      const maxSamples = secondsToKeep * sampleRateRef.current;
      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        bufferRef.current.push(copy);
        writtenSamplesRef.current += copy.length;

        // Drop oldest until under the cap
        while (writtenSamplesRef.current > maxSamples && bufferRef.current.length > 1) {
          const dropped = bufferRef.current.shift()!;
          writtenSamplesRef.current -= dropped.length;
        }

        // Update level meter (lightweight RMS)
        let s = 0;
        for (let i = 0; i < copy.length; i += 1) s += copy[i] * copy[i];
        const rms = Math.sqrt(s / copy.length);
        setState(prev => ({ ...prev, level: rms }));
      };
      src.connect(proc);
      proc.connect(ctx.destination);

      setState({ armed: true, level: 0 });
      return true;
    } catch {
      stop();
      return false;
    }
  }, [secondsToKeep, state.armed, stop]);

  /** Returns the pre-roll buffer as a WAV Blob and clears it. */
  const drainAsBlob = useCallback((): Blob | null => {
    if (!bufferRef.current.length) return null;
    const sampleRate = sampleRateRef.current;
    const total = writtenSamplesRef.current;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of bufferRef.current) {
      merged.set(c, offset);
      offset += c.length;
    }
    bufferRef.current = [];
    writtenSamplesRef.current = 0;
    return encodeWav(merged, sampleRate);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { ...state, start, stop, drainAsBlob };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, str: string) => { for (let i = 0; i < str.length; i += 1) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i += 1, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
