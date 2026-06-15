/**
 * De-Hum: Automatic detection and removal of electrical hum (50Hz/60Hz)
 * and their harmonics using cascaded notch filters.
 */

export interface DeHumState {
  enabled: boolean;
  detectedFreq: 50 | 60 | null;
  harmonicsCount: number;
}

export function createDeHum(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
) {
  const FFT_SIZE = 4096;
  const MAX_HARMONICS = 6;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.8;
  input.connect(analyser);

  // Create notch filters for harmonics (up to 6 harmonics)
  const notchFilters: BiquadFilterNode[] = [];
  let prevNode: AudioNode = input;

  for (let i = 0; i < MAX_HARMONICS; i++) {
    const notch = ctx.createBiquadFilter();
    notch.type = 'notch';
    notch.frequency.value = 10; // off by default
    notch.Q.value = 30; // narrow
    notchFilters.push(notch);
    prevNode.connect(notch);
    prevNode = notch;
  }

  const wetGain = ctx.createGain();
  wetGain.gain.value = 0;
  prevNode.connect(wetGain);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;
  input.connect(dryGain);

  wetGain.connect(output);
  dryGain.connect(output);

  let enabled = false;
  let detectedFreq: 50 | 60 | null = null;
  let harmonicsCount = 4;

  function autoDetect(): 50 | 60 | null {
    const freqData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(freqData);

    const binWidth = ctx.sampleRate / FFT_SIZE;

    // Check energy around 50Hz and 60Hz (and their 2nd harmonics)
    const getBinEnergy = (freq: number) => {
      const bin = Math.round(freq / binWidth);
      let sum = 0;
      for (let i = Math.max(0, bin - 2); i <= Math.min(freqData.length - 1, bin + 2); i++) {
        sum += Math.pow(10, freqData[i] / 10); // convert dB to linear
      }
      return sum;
    };

    const energy50 = getBinEnergy(50) + getBinEnergy(100) + getBinEnergy(150);
    const energy60 = getBinEnergy(60) + getBinEnergy(120) + getBinEnergy(180);

    // Need significant energy relative to nearby bins
    const noiseFloor = getBinEnergy(75) + getBinEnergy(85); // between 50 and 100

    if (energy50 > noiseFloor * 3 && energy50 > energy60) return 50;
    if (energy60 > noiseFloor * 3 && energy60 > energy50) return 60;
    return null;
  }

  function applyNotches(baseFreq: number) {
    for (let i = 0; i < MAX_HARMONICS; i++) {
      if (i < harmonicsCount) {
        notchFilters[i].frequency.value = baseFreq * (i + 1);
        notchFilters[i].Q.value = 25 + i * 5; // narrower Q for higher harmonics
      } else {
        notchFilters[i].frequency.value = 10;
        notchFilters[i].Q.value = 0.001;
      }
    }
  }

  function enable() {
    enabled = true;
    dryGain.gain.value = 0;
    wetGain.gain.value = 1;
  }

  function disable() {
    enabled = false;
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;
  }

  return {
    enable,
    disable,
    autoDetect() {
      const freq = autoDetect();
      detectedFreq = freq;
      if (freq) {
        applyNotches(freq);
        if (enabled) {
          dryGain.gain.value = 0;
          wetGain.gain.value = 1;
        }
      }
      return freq;
    },
    setFrequency(freq: 50 | 60) {
      detectedFreq = freq;
      applyNotches(freq);
    },
    setHarmonics(count: number) {
      harmonicsCount = Math.max(1, Math.min(MAX_HARMONICS, count));
      if (detectedFreq) applyNotches(detectedFreq);
    },
    getState(): DeHumState {
      return { enabled, detectedFreq, harmonicsCount };
    },
    destroy() {
      try {
        input.disconnect(analyser);
        input.disconnect(dryGain);
        notchFilters.forEach(f => { try { f.disconnect(); } catch {} });
        wetGain.disconnect();
        dryGain.disconnect();
      } catch {}
    },
  };
}
