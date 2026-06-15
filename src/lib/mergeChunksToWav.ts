/**
 * Merge an array of recorded audio Blobs into a single playable WAV Blob.
 *
 * Live recording with Groq mode produces multiple short MediaRecorder
 * sessions, each its own self-contained WebM/Opus file. Concatenating them
 * with `new Blob(chunks)` produces a file where most players only play the
 * first chunk (subsequent fragments lack container headers).
 *
 * This util decodes each chunk via Web Audio, downmixes to mono, concatenates
 * the PCM, and emits one valid WAV. Chunks that fail to decode are skipped.
 */
import { encodeWavInWorker } from "@/lib/wavEncoderWorker";

const TARGET_SR = 16000;

function downmixToMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const len = buf.length;
  const out = new Float32Array(len);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i];
    out[i] = s / channels.length;
  }
  return out;
}

function resampleLinear(data: Float32Array, fromSR: number, toSR: number): Float32Array {
  if (fromSR === toSR) return data;
  const ratio = fromSR / toSR;
  const outLen = Math.floor(data.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, data.length - 1);
    const frac = srcIdx - i0;
    out[i] = data[i0] * (1 - frac) + data[i1] * frac;
  }
  return out;
}

export async function mergeChunksToWav(
  chunks: Blob[],
  opts: { targetSampleRate?: number } = {}
): Promise<Blob | null> {
  if (!chunks || chunks.length === 0) return null;
  const targetSR = opts.targetSampleRate ?? TARGET_SR;
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();

  const pieces: Float32Array[] = [];
  let total = 0;

  // Try decoding each chunk independently. If a chunk fails (incomplete
  // header), try concatenating it with the previous successfully-decoded
  // chunk's source — fallback to skipping.
  for (const blob of chunks) {
    try {
      const ab = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(ab.slice(0));
      let mono = downmixToMono(decoded);
      if (decoded.sampleRate !== targetSR) {
        mono = resampleLinear(mono, decoded.sampleRate, targetSR);
      }
      pieces.push(mono);
      total += mono.length;
    } catch {
      // skip undecodable fragment
    }
  }

  try { await ctx.close(); } catch { /* noop */ }

  if (total === 0) {
    // last-resort: try decoding the concatenated blob
    try {
      const big = new Blob(chunks);
      const ctx2 = new AC();
      const decoded = await ctx2.decodeAudioData(await big.arrayBuffer());
      let mono = downmixToMono(decoded);
      if (decoded.sampleRate !== targetSR) {
        mono = resampleLinear(mono, decoded.sampleRate, targetSR);
      }
      try { await ctx2.close(); } catch { /* noop */ }
      const wav = await encodeWavInWorker(mono, targetSR);
      return new Blob([wav], { type: "audio/wav" });
    } catch {
      return null;
    }
  }

  const merged = new Float32Array(total);
  let offset = 0;
  for (const p of pieces) {
    merged.set(p, offset);
    offset += p.length;
  }

  const wav = await encodeWavInWorker(merged, targetSR);
  return new Blob([wav], { type: "audio/wav" });
}
