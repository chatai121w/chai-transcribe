/**
 * Audio segment helpers.
 * Decode audio in-browser and export only the requested time window as WAV.
 */

const MIN_SEGMENT_SEC = 0.2;

export async function probeAudioDurationSec(file: File): Promise<number> {
  const audioBuffer = await decodeAudioFile(file);
  return audioBuffer.duration;
}

export async function extractAudioSegment(
  file: File,
  startSec: number,
  endSec: number,
): Promise<File> {
  const audioBuffer = await decodeAudioFile(file);
  const duration = audioBuffer.duration;

  const safeStart = clampNumber(startSec, 0, Math.max(0, duration - MIN_SEGMENT_SEC));
  const safeEnd = clampNumber(endSec, safeStart + MIN_SEGMENT_SEC, duration);

  // No-op: full range selected
  if (safeStart <= 0.0001 && safeEnd >= duration - 0.0001) {
    return file;
  }

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const startSample = Math.floor(safeStart * sampleRate);
  const endSample = Math.floor(safeEnd * sampleRate);
  const sampleLength = Math.max(1, endSample - startSample);

  const wavBuffer = encodeSegmentToWav(audioBuffer, startSample, sampleLength, channels, sampleRate);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const segmentName = `${baseName}-segment-${formatSecForName(safeStart)}-${formatSecForName(safeEnd)}.wav`;

  return new File([wavBuffer], segmentName, { type: "audio/wav" });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatSecForName(sec: number): string {
  return sec.toFixed(1).replace(/\./g, "_");
}

async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, 16000);

  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error("Could not decode media for trimming. Use an audio file or convert video to audio first.");
  }
}

function encodeSegmentToWav(
  buffer: AudioBuffer,
  startSample: number,
  length: number,
  channels: number,
  sampleRate: number,
): ArrayBuffer {
  const monoData = new Float32Array(length);

  for (let ch = 0; ch < channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      monoData[i] += channelData[startSample + i] / channels;
    }
  }

  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, monoData[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const wavSize = 44 + pcm.length * 2;
  const wav = new ArrayBuffer(wavSize);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, wavSize - 8, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);

  new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));
  return wav;
}

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
