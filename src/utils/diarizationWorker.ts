/**
 * Web Worker for browser-based speaker diarization DSP.
 * All heavy computation (FFT, MFCC, clustering) runs off the main thread.
 * Processes frames in batches for optimal throughput.
 */

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
const HOP_SIZE = 160;
const NUM_MEL_FILTERS = 40;
const NUM_MFCC = 20;
const WINDOW_SECONDS = 1.0;
const MIN_SEGMENT_SEC = 0.5;

// Batch size — process this many frames before posting progress
const BATCH_SIZE = 2000;

// ── DSP Helpers ──

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

function melFilterbank(numFilters: number, fftSize: number, sampleRate: number): Float64Array[] {
  const numBins = fftSize / 2 + 1;
  const lowMel = hzToMel(80);
  const highMel = hzToMel(Math.min(sampleRate / 2, 8000));
  const melPoints: number[] = [];
  for (let i = 0; i <= numFilters + 1; i++) {
    melPoints.push(melToHz(lowMel + (i / (numFilters + 1)) * (highMel - lowMel)));
  }
  const binPoints = melPoints.map(hz => Math.floor((fftSize + 1) * hz / sampleRate));
  const filters: Float64Array[] = [];
  for (let m = 1; m <= numFilters; m++) {
    const filter = new Float64Array(numBins);
    for (let k = binPoints[m - 1]; k < binPoints[m]; k++) {
      filter[k] = (k - binPoints[m - 1]) / (binPoints[m] - binPoints[m - 1]);
    }
    for (let k = binPoints[m]; k <= binPoints[m + 1] && k < numBins; k++) {
      filter[k] = (binPoints[m + 1] - k) / (binPoints[m + 1] - binPoints[m]);
    }
    filters.push(filter);
  }
  return filters;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }
}

function powerSpectrum(frame: Float64Array, fftSize: number): Float64Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < frame.length; i++) {
    re[i] = frame[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame.length - 1)));
  }
  fft(re, im);
  const numBins = fftSize / 2 + 1;
  const power = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    power[i] = re[i] * re[i] + im[i] * im[i];
  }
  return power;
}

function extractMFCC(frame: Float64Array, filters: Float64Array[], fftSize: number): Float64Array {
  const power = powerSpectrum(frame, fftSize);
  const melEnergies = new Float64Array(filters.length);
  for (let m = 0; m < filters.length; m++) {
    let sum = 0;
    for (let k = 0; k < power.length; k++) sum += filters[m][k] * power[k];
    melEnergies[m] = Math.log(Math.max(sum, 1e-10));
  }
  const mfcc = new Float64Array(NUM_MFCC);
  for (let i = 0; i < NUM_MFCC; i++) {
    let sum = 0;
    for (let j = 0; j < filters.length; j++) {
      sum += melEnergies[j] * Math.cos((Math.PI * i * (j + 0.5)) / filters.length);
    }
    mfcc[i] = sum;
  }
  return mfcc;
}

function spectralContrast(power: Float64Array, numBands: number): Float64Array {
  const contrast = new Float64Array(numBands);
  const bandSize = Math.floor(power.length / numBands);
  for (let b = 0; b < numBands; b++) {
    const start = b * bandSize;
    const end = Math.min(start + bandSize, power.length);
    let maxVal = -Infinity, minVal = Infinity;
    for (let i = start; i < end; i++) {
      if (power[i] > maxVal) maxVal = power[i];
      if (power[i] < minVal) minVal = power[i];
    }
    contrast[b] = Math.log(Math.max(maxVal, 1e-10)) - Math.log(Math.max(minVal, 1e-10));
  }
  return contrast;
}

function zeroCrossingRate(frame: Float64Array): number {
  let zcr = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) zcr++;
  }
  return zcr / (frame.length - 1);
}

function extractRichFeatures(frame: Float64Array, filters: Float64Array[], fftSize: number): Float64Array {
  const mfcc = extractMFCC(frame, filters, fftSize);
  const power = powerSpectrum(frame, fftSize);
  const contrast = spectralContrast(power, 6);
  const zcr = zeroCrossingRate(frame);
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  energy = Math.log(Math.max(energy / frame.length, 1e-10));
  const combined = new Float64Array(mfcc.length + contrast.length + 2);
  combined.set(mfcc, 0);
  combined.set(contrast, mfcc.length);
  combined[mfcc.length + contrast.length] = zcr;
  combined[mfcc.length + contrast.length + 1] = energy;
  return combined;
}

function computeDeltas(features: Float64Array[], width = 2): Float64Array[] {
  const deltas: Float64Array[] = [];
  const dim = features[0].length;
  for (let t = 0; t < features.length; t++) {
    const delta = new Float64Array(dim);
    let denom = 0;
    for (let n = 1; n <= width; n++) {
      denom += 2 * n * n;
      const tP = Math.min(t + n, features.length - 1);
      const tM = Math.max(t - n, 0);
      for (let d = 0; d < dim; d++) delta[d] += n * (features[tP][d] - features[tM][d]);
    }
    if (denom > 0) for (let d = 0; d < dim; d++) delta[d] /= denom;
    deltas.push(delta);
  }
  return deltas;
}

function augmentWithDeltaAndAccel(features: Float64Array[]): Float64Array[] {
  const deltas = computeDeltas(features);
  const deltaDeltas = computeDeltas(deltas);
  return features.map((f, i) => {
    const combined = new Float64Array(f.length + deltas[i].length + deltaDeltas[i].length);
    combined.set(f, 0);
    combined.set(deltas[i], f.length);
    combined.set(deltaDeltas[i], f.length + deltas[i].length);
    return combined;
  });
}

function frameEnergy(frame: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function euclideanDistance(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function normalizeFeatures(vectors: Float64Array[]): Float64Array[] {
  if (vectors.length === 0) return vectors;
  const dim = vectors[0].length;
  const mean = new Float64Array(dim);
  const std = new Float64Array(dim);
  for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d];
  for (let d = 0; d < dim; d++) mean[d] /= vectors.length;
  for (const v of vectors) for (let d = 0; d < dim; d++) {
    const diff = v[d] - mean[d];
    std[d] += diff * diff;
  }
  for (let d = 0; d < dim; d++) std[d] = Math.sqrt(std[d] / vectors.length) || 1;
  return vectors.map(v => {
    const normed = new Float64Array(dim);
    for (let d = 0; d < dim; d++) normed[d] = (v[d] - mean[d]) / std[d];
    return normed;
  });
}

function kMeansPlusPlusInit(vectors: Float64Array[], k: number): Float64Array[] {
  const centroids: Float64Array[] = [];
  centroids.push(new Float64Array(vectors[Math.floor(Math.random() * vectors.length)]));
  for (let c = 1; c < k; c++) {
    const distances = vectors.map(v => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = euclideanDistance(v, cent);
        if (d < minD) minD = d;
      }
      return minD * minD;
    });
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    let picked = false;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { centroids.push(new Float64Array(vectors[i])); picked = true; break; }
    }
    if (!picked) centroids.push(new Float64Array(vectors[Math.floor(Math.random() * vectors.length)]));
  }
  return centroids;
}

function kMeans(
  vectors: Float64Array[], k: number, maxIter = 80, restarts = 8
): { labels: number[]; centroids: Float64Array[]; inertia: number } {
  const dim = vectors[0].length;
  const n = vectors.length;
  let bestLabels: number[] = [];
  let bestCentroids: Float64Array[] = [];
  let bestInertia = Infinity;

  for (let restart = 0; restart < restarts; restart++) {
    const centroids = kMeansPlusPlusInit(vectors, k);
    const labels = new Int32Array(n);
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let bestD = Infinity, bestC = 0;
        for (let c = 0; c < k; c++) {
          const d = euclideanDistance(vectors[i], centroids[c]);
          if (d < bestD) { bestD = d; bestC = c; }
        }
        if (labels[i] !== bestC) { labels[i] = bestC; changed = true; }
      }
      if (!changed) break;
      for (let c = 0; c < k; c++) {
        const newC = new Float64Array(dim);
        let count = 0;
        for (let i = 0; i < n; i++) {
          if (labels[i] === c) { for (let d = 0; d < dim; d++) newC[d] += vectors[i][d]; count++; }
        }
        if (count > 0) { for (let d = 0; d < dim; d++) newC[d] /= count; centroids[c] = newC; }
      }
    }
    let inertia = 0;
    for (let i = 0; i < n; i++) {
      const d = euclideanDistance(vectors[i], centroids[labels[i]]);
      inertia += d * d;
    }
    if (inertia < bestInertia) {
      bestInertia = inertia;
      bestLabels = Array.from(labels);
      bestCentroids = centroids.map(c => new Float64Array(c));
    }
  }
  return { labels: bestLabels, centroids: bestCentroids, inertia: bestInertia };
}

function silhouetteScore(vectors: Float64Array[], labels: number[], k: number): number {
  const n = vectors.length;
  if (n < 2 || k < 2) return 0;
  const maxSample = Math.min(n, 500);
  const step = Math.max(1, Math.floor(n / maxSample));
  let totalScore = 0;
  let count = 0;

  for (let i = 0; i < n; i += step) {
    const myLabel = labels[i];
    let intra = 0, intraCount = 0;
    const interSum: number[] = new Array(k).fill(0);
    const interCount: number[] = new Array(k).fill(0);

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = euclideanDistance(vectors[i], vectors[j]);
      if (labels[j] === myLabel) { intra += d; intraCount++; }
      else { interSum[labels[j]] += d; interCount[labels[j]]++; }
    }

    const a = intraCount > 0 ? intra / intraCount : 0;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === myLabel || interCount[c] === 0) continue;
      const avg = interSum[c] / interCount[c];
      if (avg < b) b = avg;
    }
    if (b === Infinity) b = 0;
    const s = Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
    totalScore += s;
    count++;
  }
  return count > 0 ? totalScore / count : 0;
}

function estimateSpeakerCount(vectors: Float64Array[]): number {
  if (vectors.length < 4) return 2;
  const maxK = Math.min(8, Math.floor(vectors.length / 2));
  let bestK = 2;
  let bestScore = -Infinity;

  for (let k = 2; k <= maxK; k++) {
    const { labels, inertia } = kMeans(vectors, k, 40, 4);
    const sil = silhouetteScore(vectors, labels, k);
    const penalty = 0.02 * (k - 2);
    const score = sil - penalty;
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
    }
  }
  return bestK;
}

function detectVoiceActivity(energies: number[]): boolean[] {
  const sorted = [...energies].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)];
  const p80 = sorted[Math.floor(sorted.length * 0.8)];
  const threshold = p20 + (p80 - p20) * 0.15;

  const active = energies.map(e => e > threshold);
  const hangover = 3;
  const result = [...active];
  for (let i = 0; i < result.length; i++) {
    if (!result[i]) {
      for (let h = 1; h <= hangover && i - h >= 0; h++) {
        if (active[i - h]) { result[i] = true; break; }
      }
    }
  }
  return result;
}

function formatTimeRange(start: number, end: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

// ── Worker message handler ──

function postProgress(stage: string, percent: number) {
  self.postMessage({ type: 'progress', stage, percent });
}

function processAudio(samples: Float32Array, duration: number, expectedSpeakers?: number) {
  const startTime = performance.now();

  // Pre-emphasis
  postProgress("מחיל סינון מקדים...", 8);
  const emphasized = new Float32Array(samples.length);
  emphasized[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    emphasized[i] = samples[i] - 0.97 * samples[i - 1];
  }

  postProgress("מחלץ מאפיינים מתקדמים...", 12);

  const fftSize = 1024;
  const filters = melFilterbank(NUM_MEL_FILTERS, fftSize, SAMPLE_RATE);
  const totalFrames = Math.floor((emphasized.length - FRAME_SIZE) / HOP_SIZE);
  const frameFeatures: Float64Array[] = [];
  const frameEnergies: number[] = [];

  // Batch processing — process BATCH_SIZE frames then post progress
  for (let i = 0; i < totalFrames; i++) {
    const start = i * HOP_SIZE;
    const frame = new Float64Array(FRAME_SIZE);
    for (let j = 0; j < FRAME_SIZE; j++) frame[j] = emphasized[start + j] || 0;
    frameFeatures.push(extractRichFeatures(frame, filters, fftSize));
    frameEnergies.push(frameEnergy(frame));
    if (i % BATCH_SIZE === 0) {
      postProgress("מחלץ מאפיינים מתקדמים...", 12 + (i / totalFrames) * 28);
    }
  }

  postProgress("מחשב מאפייני דלתא ותאוצה...", 42);
  const augmented = augmentWithDeltaAndAccel(frameFeatures);
  const augDim = augmented[0]?.length || 84;

  postProgress("מנתח חלונות זמן...", 50);

  const framesPerWindow = Math.floor((WINDOW_SECONDS * SAMPLE_RATE) / HOP_SIZE);
  const windowVectors: Float64Array[] = [];
  const windowTimes: { start: number; end: number }[] = [];
  const windowEnergies: number[] = [];

  const windowStep = Math.floor(framesPerWindow / 2);
  for (let w = 0; w < totalFrames - framesPerWindow; w += windowStep) {
    const end = Math.min(w + framesPerWindow, totalFrames);
    const count = end - w;
    if (count === 0) continue;

    const avg = new Float64Array(augDim);
    const variance = new Float64Array(augDim);
    let avgEnergy = 0;

    for (let i = w; i < end; i++) {
      for (let d = 0; d < augDim; d++) avg[d] += augmented[i][d];
      avgEnergy += frameEnergies[i];
    }
    for (let d = 0; d < augDim; d++) avg[d] /= count;
    avgEnergy /= count;

    for (let i = w; i < end; i++) {
      for (let d = 0; d < augDim; d++) {
        const diff = augmented[i][d] - avg[d];
        variance[d] += diff * diff;
      }
    }
    for (let d = 0; d < augDim; d++) variance[d] = Math.sqrt(variance[d] / count);

    const combined = new Float64Array(augDim * 2);
    combined.set(avg, 0);
    combined.set(variance, augDim);

    windowVectors.push(combined);
    windowEnergies.push(avgEnergy);
    windowTimes.push({
      start: (w * HOP_SIZE) / SAMPLE_RATE,
      end: (end * HOP_SIZE) / SAMPLE_RATE,
    });
  }

  postProgress("מזהה קטעי דיבור...", 58);
  const voiceActive = detectVoiceActivity(windowEnergies);
  const activeIndices = voiceActive.map((a, i) => a ? i : -1).filter(i => i >= 0);
  const activeVectors = activeIndices.map(i => windowVectors[i]);

  if (activeVectors.length < 3) {
    return {
      segments: [{ text: "(שתיקה או דובר יחיד)", start: 0, end: duration, speaker: "Speaker 1", speaker_label: "דובר 1" }],
      speakers: ["דובר 1"],
      speaker_count: 1,
      duration,
      processing_time: Math.round((performance.now() - startTime) / 100) / 10,
      diarization_method: "Browser MFCC+Δ+ΔΔ v2",
    };
  }

  postProgress("מנרמל מאפיינים...", 63);
  const normalizedVectors = normalizeFeatures(activeVectors);

  postProgress("מזהה מספר דוברים...", 68);
  const numSpeakers = expectedSpeakers || estimateSpeakerCount(normalizedVectors);

  postProgress(`מקבץ ל-${numSpeakers} דוברים...`, 75);
  const { labels } = kMeans(normalizedVectors, numSpeakers, 80, 10);

  const allLabels = new Array(windowVectors.length).fill(-1);
  activeIndices.forEach((wi, i) => { allLabels[wi] = labels[i]; });
  let lastLabel = labels[0] ?? 0;
  for (let i = 0; i < allLabels.length; i++) {
    if (allLabels[i] >= 0) lastLabel = allLabels[i];
    else allLabels[i] = lastLabel;
  }

  postProgress("מחליק מעברים...", 88);

  const smoothedLabels = [...allLabels];
  const smoothW = 2;
  for (let i = smoothW; i < smoothedLabels.length - smoothW; i++) {
    const counts: Record<number, number> = {};
    for (let j = i - smoothW; j <= i + smoothW; j++) {
      const l = smoothedLabels[j];
      counts[l] = (counts[l] || 0) + 1;
    }
    let maxCount = 0, maxLabel = smoothedLabels[i];
    for (const [label, count] of Object.entries(counts)) {
      if (count > maxCount) { maxCount = count; maxLabel = Number(label); }
    }
    smoothedLabels[i] = maxLabel;
  }

  const minWindows = 3;
  let runStart = 0;
  for (let i = 1; i <= smoothedLabels.length; i++) {
    if (i === smoothedLabels.length || smoothedLabels[i] !== smoothedLabels[runStart]) {
      const runLen = i - runStart;
      if (runLen < minWindows && runStart > 0) {
        const replaceLabel = smoothedLabels[runStart - 1];
        for (let j = runStart; j < i; j++) smoothedLabels[j] = replaceLabel;
      }
      runStart = i;
    }
  }

  const rawSegments: Array<{ start: number; end: number; speakerIdx: number }> = [];
  let currentSpeaker = smoothedLabels[0];
  let segStart = windowTimes[0]?.start ?? 0;

  for (let i = 1; i < smoothedLabels.length; i++) {
    if (smoothedLabels[i] !== currentSpeaker) {
      rawSegments.push({ start: segStart, end: windowTimes[i - 1].end, speakerIdx: currentSpeaker });
      currentSpeaker = smoothedLabels[i];
      segStart = windowTimes[i].start;
    }
  }
  rawSegments.push({
    start: segStart,
    end: windowTimes[windowTimes.length - 1]?.end ?? duration,
    speakerIdx: currentSpeaker,
  });

  const merged: typeof rawSegments = [];
  for (const seg of rawSegments) {
    if (merged.length > 0 && (seg.end - seg.start) < MIN_SEGMENT_SEC) {
      merged[merged.length - 1].end = seg.end;
    } else if (merged.length > 0 && merged[merged.length - 1].speakerIdx === seg.speakerIdx) {
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  const speakerSet = new Set(merged.map(s => s.speakerIdx));
  const speakerList = Array.from(speakerSet).sort();
  const speakerMap: Record<number, string> = {};
  speakerList.forEach((idx, i) => { speakerMap[idx] = `דובר ${i + 1}`; });

  const segments = merged.map(s => ({
    text: `[${speakerMap[s.speakerIdx]}] ${formatTimeRange(s.start, s.end)}`,
    start: s.start,
    end: s.end,
    speaker: `Speaker ${speakerList.indexOf(s.speakerIdx) + 1}`,
    speaker_label: speakerMap[s.speakerIdx],
  }));

  const speakers = speakerList.map(idx => speakerMap[idx]);

  postProgress("הושלם!", 100);

  return {
    segments,
    speakers,
    speaker_count: speakers.length,
    duration,
    processing_time: Math.round((performance.now() - startTime) / 100) / 10,
    diarization_method: "Browser MFCC+Δ+ΔΔ v2 (Web Audio API)",
  };
}

// ── Listen for messages from main thread ──
self.onmessage = (e: MessageEvent) => {
  const { type, samples, duration, expectedSpeakers } = e.data;
  if (type === 'process') {
    try {
      const result = processAudio(samples, duration, expectedSpeakers);
      self.postMessage({ type: 'result', data: result });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
