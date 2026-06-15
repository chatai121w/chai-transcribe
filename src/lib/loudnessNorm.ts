/**
 * LUFS Loudness Measurement and Normalization
 * Implements ITU-R BS.1770 simplified for real-time browser use
 */

export interface LUFSState {
  momentary: number; // LUFS (400ms window)
  shortTerm: number; // LUFS (3s window)
  integrated: number; // LUFS (full program)
  targetLUFS: number;
  isNormalized: boolean;
}

export function createLoudnessNorm(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
) {
  const BLOCK_SIZE = 2048;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = BLOCK_SIZE;
  input.connect(analyser);

  // K-weighting filters (simplified BS.1770)
  // Stage 1: High shelf at 1681Hz, +4dB
  const kWeightShelf = ctx.createBiquadFilter();
  kWeightShelf.type = 'highshelf';
  kWeightShelf.frequency.value = 1681;
  kWeightShelf.gain.value = 4;

  // Stage 2: Highpass at 38Hz
  const kWeightHP = ctx.createBiquadFilter();
  kWeightHP.type = 'highpass';
  kWeightHP.frequency.value = 38;
  kWeightHP.Q.value = 0.5;

  // Normalization gain
  const normGain = ctx.createGain();
  normGain.gain.value = 1;

  input.connect(kWeightShelf);
  kWeightShelf.connect(kWeightHP);
  kWeightHP.connect(normGain);
  normGain.connect(output);

  let targetLUFS = -16; // podcast standard
  let isNormalized = false;

  // LUFS measurement buffers
  const momentaryBuffer: number[] = []; // 400ms blocks
  const shortTermBuffer: number[] = []; // 3s blocks
  const integratedBuffer: number[] = []; // all blocks

  const MOMENTARY_BLOCKS = Math.ceil(0.4 / (BLOCK_SIZE / ctx.sampleRate));
  const SHORT_TERM_BLOCKS = Math.ceil(3.0 / (BLOCK_SIZE / ctx.sampleRate));

  let momentaryLUFS = -Infinity;
  let shortTermLUFS = -Infinity;
  let integratedLUFS = -Infinity;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let onUpdate: ((state: LUFSState) => void) | null = null;

  const timeData = new Float32Array(BLOCK_SIZE);

  function measureBlock() {
    analyser.getFloatTimeDomainData(timeData);

    // Mean square (after K-weighting is applied in the filter chain)
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      sum += timeData[i] * timeData[i];
    }
    const meanSquare = sum / timeData.length;

    momentaryBuffer.push(meanSquare);
    shortTermBuffer.push(meanSquare);
    integratedBuffer.push(meanSquare);

    // Keep windows
    while (momentaryBuffer.length > MOMENTARY_BLOCKS) momentaryBuffer.shift();
    while (shortTermBuffer.length > SHORT_TERM_BLOCKS) shortTermBuffer.shift();

    // Calculate LUFS = -0.691 + 10 * log10(mean_square)
    const calcLUFS = (blocks: number[]) => {
      if (blocks.length === 0) return -Infinity;
      const avg = blocks.reduce((s, v) => s + v, 0) / blocks.length;
      if (avg <= 0) return -Infinity;
      return -0.691 + 10 * Math.log10(avg);
    };

    momentaryLUFS = calcLUFS(momentaryBuffer);
    shortTermLUFS = calcLUFS(shortTermBuffer);
    integratedLUFS = calcLUFS(integratedBuffer);

    // Auto-normalize if enabled
    if (isNormalized && isFinite(shortTermLUFS) && shortTermLUFS > -60) {
      const diff = targetLUFS - shortTermLUFS;
      const gainDb = Math.max(-12, Math.min(12, diff));
      const gainLinear = Math.pow(10, gainDb / 20);
      normGain.gain.linearRampToValueAtTime(gainLinear, ctx.currentTime + 0.1);
    }

    if (onUpdate) {
      onUpdate(getState());
    }
  }

  function start() {
    if (intervalId) return;
    momentaryBuffer.length = 0;
    shortTermBuffer.length = 0;
    integratedBuffer.length = 0;
    intervalId = setInterval(measureBlock, (BLOCK_SIZE / ctx.sampleRate) * 1000);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function getState(): LUFSState {
    return {
      momentary: momentaryLUFS,
      shortTerm: shortTermLUFS,
      integrated: integratedLUFS,
      targetLUFS,
      isNormalized,
    };
  }

  return {
    start,
    stop,
    enableNormalization() {
      isNormalized = true;
    },
    disableNormalization() {
      isNormalized = false;
      normGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.1);
    },
    setTarget(lufs: number) {
      targetLUFS = Math.max(-24, Math.min(-8, lufs));
    },
    resetIntegrated() {
      integratedBuffer.length = 0;
      integratedLUFS = -Infinity;
    },
    getState,
    onUpdate(cb: (state: LUFSState) => void) { onUpdate = cb; },
    destroy() {
      stop();
      try {
        input.disconnect(analyser);
        input.disconnect(kWeightShelf);
        kWeightShelf.disconnect();
        kWeightHP.disconnect();
        normGain.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    },
  };
}
