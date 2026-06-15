/**
 * Smart chunking — splits a long audio file into chunks aligned to silence
 * boundaries instead of fixed-byte cuts. Higher transcription accuracy at
 * chunk edges because words don't get cut in the middle.
 *
 * Strategy:
 *   1. Decode file with Web Audio.
 *   2. Find silence regions (RMS below threshold for ≥minSilenceMs).
 *   3. Greedy walk: emit chunks of up to maxChunkSec, cutting at the
 *      nearest silence within the last 20% of the chunk window.
 *   4. Re-encode each chunk as WAV mono 16 kHz.
 *
 * Falls back to byte chunking when:
 *   - decode fails (corrupt file)
 *   - audio too short to chunk (< maxChunkSec)
 */

import { splitFileIntoChunks, type AudioChunk } from "@/utils/audioChunker";

export interface SmartChunkOptions {
  maxChunkSec?: number;
  minSilenceMs?: number;
  silenceRmsThreshold?: number;
  onProgress?: (frac: number) => void;
}

export async function splitFileSmart(
  file: File,
  opts: SmartChunkOptions = {},
): Promise<AudioChunk[]> {
  const {
    maxChunkSec = 60,
    minSilenceMs = 250,
    silenceRmsThreshold = 0.01,
    onProgress,
  } = opts;

  // Decode
  let ac: AudioContext | null = null;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new Ctx({ sampleRate: 16000 });
    const buf = await file.arrayBuffer();
    const audio = await ac.decodeAudioData(buf);

    const sr = audio.sampleRate;
    const ch0 = audio.getChannelData(0);
    const total = ch0.length;
    if (total < sr * maxChunkSec) {
      // Too short — single chunk is fine; just return original via byte chunker.
      return splitFileIntoChunks(file);
    }

    // Compute frame-wise RMS at 20 ms windows
    const frameSize = Math.floor(sr * 0.02);
    const frames = Math.floor(total / frameSize);
    const rms = new Float32Array(frames);
    for (let f = 0; f < frames; f += 1) {
      let s = 0;
      const start = f * frameSize;
      for (let i = 0; i < frameSize; i += 1) s += ch0[start + i] * ch0[start + i];
      rms[f] = Math.sqrt(s / frameSize);
    }

    // Find silence frame indices
    const minSilenceFrames = Math.ceil((minSilenceMs / 1000) * (sr / frameSize));
    const silenceCenters: number[] = []; // sample positions
    let run = 0;
    for (let f = 0; f < frames; f += 1) {
      if (rms[f] < silenceRmsThreshold) {
        run += 1;
      } else {
        if (run >= minSilenceFrames) {
          const center = (f - Math.floor(run / 2)) * frameSize;
          silenceCenters.push(center);
        }
        run = 0;
      }
    }

    // Greedy chunk cuts
    const maxChunkSamples = maxChunkSec * sr;
    const cuts: number[] = [0];
    while (cuts[cuts.length - 1] + maxChunkSamples < total) {
      const winStart = cuts[cuts.length - 1] + Math.floor(maxChunkSamples * 0.8);
      const winEnd = cuts[cuts.length - 1] + maxChunkSamples;
      // Find best silence in [winStart, winEnd], else hard cut at winEnd
      let cut = winEnd;
      for (let i = silenceCenters.length - 1; i >= 0; i -= 1) {
        const s = silenceCenters[i];
        if (s >= winStart && s <= winEnd) { cut = s; break; }
        if (s < winStart) break;
      }
      cuts.push(cut);
    }
    cuts.push(total);

    // Re-encode each segment as WAV
    const out: AudioChunk[] = [];
    const totalChunks = cuts.length - 1;
    for (let i = 0; i < totalChunks; i += 1) {
      const slice = ch0.subarray(cuts[i], cuts[i + 1]);
      const wav = encodeWav(slice, sr);
      out.push({
        index: i,
        total: totalChunks,
        blob: wav,
      });
      onProgress?.((i + 1) / totalChunks);
    }
    return out;
  } catch {
    // Fallback to byte chunker on any decode failure.
    return splitFileIntoChunks(file);
  } finally {
    try { await ac?.close(); } catch { /* ignore */ }
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
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
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
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
