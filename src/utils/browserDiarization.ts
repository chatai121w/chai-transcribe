/**
 * Client-side speaker diarization using Web Audio API.
 * Enhanced v2: MFCC + Δ + ΔΔ, spectral contrast, ZCR, 
 * agglomerative clustering with BIC, improved VAD, temporal smoothing.
 */

export interface BrowserDiarizationResult {
  segments: Array<{
    text: string;
    start: number;
    end: number;
    speaker: string;
    speaker_label: string;
  }>;
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

export interface DiarizationProgress {
  stage: string;
  percent: number;
}

const SAMPLE_RATE = 16000;

// ── Main diarization function (Web Worker accelerated) ──

export async function diarizeInBrowser(
  file: File,
  onProgress?: (p: DiarizationProgress) => void,
  expectedSpeakers?: number
): Promise<BrowserDiarizationResult> {
  onProgress?.({ stage: "מפענח אודיו...", percent: 5 });

  // Decode audio on main thread (requires AudioContext)
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const duration = audioBuffer.duration;

  // Mix to mono if stereo
  let samples: Float32Array;
  if (audioBuffer.numberOfChannels > 1) {
    samples = new Float32Array(audioBuffer.length);
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < samples.length; i++) samples[i] = (ch0[i] + ch1[i]) / 2;
  } else {
    // getChannelData returns a reference; copy it so we can transfer
    samples = new Float32Array(audioBuffer.getChannelData(0));
  }
  audioCtx.close();

  // Offload all heavy DSP to a Web Worker
  return new Promise<BrowserDiarizationResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./diarizationWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      // Worker not supported — fall back to inline processing
      reject(new Error('Web Worker not supported'));
      return;
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.({ stage: msg.stage, percent: msg.percent });
      } else if (msg.type === 'result') {
        worker.terminate();
        resolve(msg.data as BrowserDiarizationResult);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker error'));
    };

    // Transfer the samples buffer to the worker (zero-copy)
    worker.postMessage(
      { type: 'process', samples, duration, expectedSpeakers },
      [samples.buffer]
    );
  });
}
