export interface AudioQualityMetrics {
  sampleRate: number;
  durationSec: number;
  rmsDbfs: number;
  peakDbfs: number;
  noiseFloorDbfs: number;
  speechLevelDbfs: number;
  estimatedSnrDb: number;
  clippingRatio: number;
  silenceRatio: number;
  dcOffset: number;
  crestFactorDb: number;
  highFrequencyRatio: number;
}

export type AudioQualityVerdict = "improved" | "stable" | "regression" | "inconclusive";

export interface AudioQualityAssessment {
  original: AudioQualityMetrics;
  processed: AudioQualityMetrics;
  verdict: AudioQualityVerdict;
  score: number;
  estimatedSnrDeltaDb: number;
  noiseFloorDeltaDb: number;
  clippingDelta: number;
  durationDriftPct: number;
  speechLevelDeltaDb: number;
  contentSimilarity: number;
  reasons: string[];
  warnings: string[];
}

const EPS = 1e-12;

function db(value: number): number {
  return 20 * Math.log10(Math.max(EPS, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return -120;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function analyzePcm(samples: Float32Array, sampleRate: number): AudioQualityMetrics {
  if (samples.length === 0 || sampleRate <= 0) {
    throw new Error("audio-empty");
  }

  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  let differenceEnergy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number.isFinite(samples[index]) ? samples[index] : 0;
    const absolute = Math.abs(value);
    sum += value;
    sumSquares += value * value;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.999) clipped += 1;
    if (index > 0) {
      const difference = value - samples[index - 1];
      differenceEnergy += difference * difference;
    }
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  const frameLevels: number[] = [];
  let silentFrames = 0;
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize);
    let frameSquares = 0;
    for (let index = offset; index < end; index += 1) frameSquares += samples[index] * samples[index];
    const frameRms = Math.sqrt(frameSquares / Math.max(1, end - offset));
    const level = db(frameRms);
    frameLevels.push(level);
    if (level < -50) silentFrames += 1;
  }
  frameLevels.sort((a, b) => a - b);

  const noiseFloor = quantile(frameLevels, 0.2);
  const speechLevel = quantile(frameLevels, 0.8);
  return {
    sampleRate,
    durationSec: round(samples.length / sampleRate, 4),
    rmsDbfs: round(db(rms), 2),
    peakDbfs: round(db(peak), 2),
    noiseFloorDbfs: round(noiseFloor, 2),
    speechLevelDbfs: round(speechLevel, 2),
    estimatedSnrDb: round(Math.max(0, speechLevel - noiseFloor), 2),
    clippingRatio: round(clipped / samples.length, 6),
    silenceRatio: round(silentFrames / Math.max(1, frameLevels.length), 4),
    dcOffset: round(sum / samples.length, 6),
    crestFactorDb: round(db(peak) - db(rms), 2),
    highFrequencyRatio: round(differenceEnergy / Math.max(EPS, sumSquares * 4), 5),
  };
}

function frameEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  const frames = new Float32Array(Math.ceil(samples.length / frameSize));
  for (let frame = 0; frame < frames.length; frame += 1) {
    const start = frame * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    let squares = 0;
    for (let index = start; index < end; index += 1) squares += samples[index] * samples[index];
    frames[frame] = Math.log10(Math.sqrt(squares / Math.max(1, end - start)) + 1e-7);
  }
  return frames;
}

function correlationAtLag(a: Float32Array, b: Float32Array, lag: number): number {
  const startA = Math.max(0, -lag);
  const startB = Math.max(0, lag);
  const length = Math.min(a.length - startA, b.length - startB);
  if (length < 4) return 0;

  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < length; index += 1) {
    meanA += a[startA + index];
    meanB += b[startB + index];
  }
  meanA /= length;
  meanB /= length;

  let numerator = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index < length; index += 1) {
    const valueA = a[startA + index] - meanA;
    const valueB = b[startB + index] - meanB;
    numerator += valueA * valueB;
    energyA += valueA * valueA;
    energyB += valueB * valueB;
  }
  return numerator / Math.sqrt(Math.max(EPS, energyA * energyB));
}

export function calculateContentSimilarity(
  original: Float32Array,
  processed: Float32Array,
  sampleRate: number,
): number {
  const a = frameEnvelope(original, sampleRate);
  const b = frameEnvelope(processed, sampleRate);
  let best = 0;
  for (let lag = -5; lag <= 5; lag += 1) best = Math.max(best, correlationAtLag(a, b, lag));
  return round(Math.max(0, Math.min(1, best)), 4);
}

export function assessAudioQuality(
  originalSamples: Float32Array,
  processedSamples: Float32Array,
  sampleRate: number,
): AudioQualityAssessment {
  const original = analyzePcm(originalSamples, sampleRate);
  const processed = analyzePcm(processedSamples, sampleRate);
  const estimatedSnrDeltaDb = round(processed.estimatedSnrDb - original.estimatedSnrDb, 2);
  const noiseFloorDeltaDb = round(processed.noiseFloorDbfs - original.noiseFloorDbfs, 2);
  const clippingDelta = round(processed.clippingRatio - original.clippingRatio, 6);
  const durationDriftPct = round(
    Math.abs(processed.durationSec - original.durationSec) / Math.max(EPS, original.durationSec) * 100,
    3,
  );
  const speechLevelDeltaDb = round(processed.speechLevelDbfs - original.speechLevelDbfs, 2);
  const contentSimilarity = calculateContentSimilarity(originalSamples, processedSamples, sampleRate);

  const reasons: string[] = [];
  const warnings: string[] = [];
  if (estimatedSnrDeltaDb >= 1) reasons.push(`יחס הדיבור לרעש השתפר בכ-${estimatedSnrDeltaDb.toFixed(1)}dB`);
  if (noiseFloorDeltaDb <= -1) reasons.push(`רצפת הרעש ירדה בכ-${Math.abs(noiseFloorDeltaDb).toFixed(1)}dB`);
  if (clippingDelta < -0.0001) reasons.push("כמות הקליפינג ירדה");

  const hardRegression: string[] = [];
  if (durationDriftPct > 1) hardRegression.push(`משך האודיו השתנה ב-${durationDriftPct.toFixed(2)}%`);
  if (processed.clippingRatio > Math.max(0.001, original.clippingRatio + 0.0005)) hardRegression.push("נוצר קליפינג חדש");
  if (speechLevelDeltaDb < -8) hardRegression.push("עוצמת אזורי הדיבור ירדה ביותר מ-8dB");
  if (contentSimilarity < 0.55) hardRegression.push("מעטפת התוכן השתנתה באופן חריג");
  if (estimatedSnrDeltaDb < -2) hardRegression.push("יחס הדיבור לרעש הורע");
  if (noiseFloorDeltaDb > 3) hardRegression.push("רצפת הרעש עלתה");

  warnings.push("SNR ורצפת רעש הם אומדנים ללא הקלטת אמת נקייה; PESQ/STOI/SI-SDR דורשים reference תואם.");
  if (Math.abs(speechLevelDeltaDb) > 6) warnings.push("שינוי עוצמה גדול עלול להטות את מדדי הרעש.");
  if (contentSimilarity < 0.75) warnings.push("דמיון התוכן נמוך; מומלץ להאזין לדיבור לפני אישור.");

  let score = 50;
  score += Math.max(-25, Math.min(25, estimatedSnrDeltaDb * 2));
  score += Math.max(-20, Math.min(20, -noiseFloorDeltaDb * 1.4));
  score -= Math.max(0, (0.85 - contentSimilarity) * 55);
  score -= Math.min(20, durationDriftPct * 10);
  if (clippingDelta > 0) score -= Math.min(20, clippingDelta * 5000);
  if (speechLevelDeltaDb < -4) score -= Math.min(15, Math.abs(speechLevelDeltaDb + 4) * 2);
  score = Math.round(Math.max(0, Math.min(100, score)));

  let verdict: AudioQualityVerdict;
  if (hardRegression.length > 0) {
    verdict = "regression";
    reasons.push(...hardRegression);
  } else if (estimatedSnrDeltaDb >= 1 || noiseFloorDeltaDb <= -1 || clippingDelta < -0.0001) {
    verdict = "improved";
  } else if (contentSimilarity >= 0.75 && durationDriftPct <= 0.25) {
    verdict = "stable";
    reasons.push("לא נמצא שינוי מדיד משמעותי ולא זוהתה רגרסיה");
  } else {
    verdict = "inconclusive";
    reasons.push("אין מספיק ראיות מספריות לקבוע שיפור");
  }

  return {
    original,
    processed,
    verdict,
    score,
    estimatedSnrDeltaDb,
    noiseFloorDeltaDb,
    clippingDelta,
    durationDriftPct,
    speechLevelDeltaDb,
    contentSimilarity,
    reasons,
    warnings,
  };
}

async function decodeMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) samples[index] += data[index] / decoded.numberOfChannels;
    }
    return { samples, sampleRate: decoded.sampleRate };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * inputRate / outputRate;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export async function compareAudioBlobs(original: Blob, processed: Blob): Promise<AudioQualityAssessment> {
  const [decodedOriginal, decodedProcessed] = await Promise.all([decodeMono(original), decodeMono(processed)]);
  const sampleRate = Math.min(decodedOriginal.sampleRate, decodedProcessed.sampleRate);
  const originalSamples = resampleLinear(decodedOriginal.samples, decodedOriginal.sampleRate, sampleRate);
  const processedSamples = resampleLinear(decodedProcessed.samples, decodedProcessed.sampleRate, sampleRate);
  return assessAudioQuality(originalSamples, processedSamples, sampleRate);
}
