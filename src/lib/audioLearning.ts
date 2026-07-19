import { encodeWavInWorker } from '@/lib/wavEncoderWorker';

export interface AudioLearningCandidate {
  id: string;
  recordingKey: string;
  original: string;
  corrected: string;
  referenceText: string;
  start: number;
  end: number;
  createdAt: string;
}

export async function cropLearningAudio(source: Blob, start: number, end: number): Promise<Blob> {
  const decodeContext = new OfflineAudioContext(1, 1, 16_000);
  const decoded = await decodeContext.decodeAudioData(await source.arrayBuffer());
  const safeStart = Math.max(0, Math.min(start, decoded.duration));
  const safeEnd = Math.max(safeStart, Math.min(end, decoded.duration));
  const frameCount = Math.max(1, Math.ceil((safeEnd - safeStart) * 16_000));
  const renderContext = new OfflineAudioContext(1, frameCount, 16_000);
  const sourceNode = renderContext.createBufferSource();
  sourceNode.buffer = decoded;
  sourceNode.connect(renderContext.destination);
  sourceNode.start(0, safeStart, safeEnd - safeStart);
  const rendered = await renderContext.startRendering();
  const wav = await encodeWavInWorker(rendered.getChannelData(0), rendered.sampleRate);
  return new Blob([wav], { type: 'audio/wav' });
}

export function readAudioLearningCandidates(storageKey: string): AudioLearningCandidate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAudioLearningCandidates(storageKey: string, items: AudioLearningCandidate[]): void {
  localStorage.setItem(storageKey, JSON.stringify(items.slice(0, 100)));
}
