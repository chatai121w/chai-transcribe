/**
 * Spectral Noise Gate — learns noise profile from a silent segment
 * and subtracts it from the signal using multi-band attenuation.
 */

export interface SpectralGateState {
  isLearning: boolean;
  hasProfile: boolean;
  enabled: boolean;
  reduction: number; // dB of reduction (0 to -30)
}

export function createSpectralGate(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
) {
  const FFT_SIZE = 2048;
  const NUM_BANDS = 16;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.5;
  input.connect(analyser);

  // Create band filters for surgical noise removal
  const bandFreqs = Array.from({ length: NUM_BANDS }, (_, i) => 
    Math.round(60 * Math.pow(2, i * (Math.log2(16000 / 60) / (NUM_BANDS - 1))))
  );

  const bandFilters: BiquadFilterNode[] = [];
  let prevNode: AudioNode = input;
  for (let i = 0; i < NUM_BANDS; i++) {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = bandFreqs[i];
    f.Q.value = 2.0;
    f.gain.value = 0;
    bandFilters.push(f);
    prevNode.connect(f);
    prevNode = f;
  }

  const gateGain = ctx.createGain();
  gateGain.gain.value = 1;
  prevNode.connect(gateGain);

  // Bypass path
  const bypassGain = ctx.createGain();
  bypassGain.gain.value = 1;
  input.connect(bypassGain);

  bypassGain.connect(output);
  gateGain.connect(output);

  let noiseProfile: Float32Array | null = null;
  let isLearning = false;
  let enabled = false;
  let reduction = -12; // dB

  let learnFrames: Float32Array[] = [];
  let learnInterval: ReturnType<typeof setInterval> | null = null;

  function startLearning(durationMs: number = 1500): Promise<void> {
    return new Promise((resolve) => {
      isLearning = true;
      learnFrames = [];
      const freqData = new Float32Array(analyser.frequencyBinCount);

      learnInterval = setInterval(() => {
        analyser.getFloatFrequencyData(freqData);
        learnFrames.push(new Float32Array(freqData));
      }, 50);

      setTimeout(() => {
        if (learnInterval) clearInterval(learnInterval);
        isLearning = false;

        if (learnFrames.length > 0) {
          // Average all captured frames as noise profile
          const bins = learnFrames[0].length;
          noiseProfile = new Float32Array(bins);
          for (let i = 0; i < bins; i++) {
            let sum = 0;
            for (const frame of learnFrames) sum += frame[i];
            noiseProfile[i] = sum / learnFrames.length;
          }
          if (enabled) applyProfile();
        }
        resolve();
      }, durationMs);
    });
  }

  function applyProfile() {
    if (!noiseProfile) return;

    for (let i = 0; i < NUM_BANDS; i++) {
      const freq = bandFreqs[i];
      const binIndex = Math.round(freq / (ctx.sampleRate / FFT_SIZE));
      const noiseLevel = noiseProfile[Math.min(binIndex, noiseProfile.length - 1)] || -80;

      // Attenuate bands where noise is prominent
      // Scale: if noise is > -50dB in this band, apply reduction
      const noiseStrength = Math.max(0, (noiseLevel + 60) / 40); // 0-1 scale
      const attenuation = noiseStrength * reduction;
      bandFilters[i].gain.value = Math.max(-24, attenuation);
    }
  }

  function enable() {
    enabled = true;
    bypassGain.gain.value = 0;
    gateGain.gain.value = 1;
    if (noiseProfile) applyProfile();
  }

  function disable() {
    enabled = false;
    bypassGain.gain.value = 1;
    gateGain.gain.value = 0;
    bandFilters.forEach(f => { f.gain.value = 0; });
  }

  // Start disabled
  gateGain.gain.value = 0;

  return {
    startLearning,
    enable,
    disable,
    setReduction(dB: number) {
      reduction = Math.max(-30, Math.min(0, dB));
      if (enabled && noiseProfile) applyProfile();
    },
    getState(): SpectralGateState {
      return {
        isLearning,
        hasProfile: noiseProfile !== null,
        enabled,
        reduction,
      };
    },
    destroy() {
      if (learnInterval) clearInterval(learnInterval);
      try {
        input.disconnect(analyser);
        input.disconnect(bypassGain);
        bandFilters.forEach(f => { try { f.disconnect(); } catch {} });
        gateGain.disconnect();
        bypassGain.disconnect();
      } catch {}
    },
  };
}
