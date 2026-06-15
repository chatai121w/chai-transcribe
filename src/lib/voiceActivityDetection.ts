/**
 * Voice Activity Detection (VAD) using Web Audio API
 * Energy + zero-crossing rate based detection
 */

export interface VADState {
  enabled: boolean;
  isSpeech: boolean;
  energyLevel: number; // 0-1
  threshold: number;
}

export function createVAD(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
) {
  const FFT_SIZE = 2048;
  
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.3;
  input.connect(analyser);

  // Auto-mute gain node
  const vadGain = ctx.createGain();
  vadGain.gain.value = 1;
  input.connect(vadGain);
  vadGain.connect(output);

  let enabled = false;
  let autoMute = false;
  let threshold = 0.015; // energy threshold
  let isSpeech = false;
  let energyLevel = 0;
  let holdTime = 300; // ms to keep "speech" after drop
  let lastSpeechTime = 0;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let onStateChange: ((state: VADState) => void) | null = null;

  const timeData = new Float32Array(FFT_SIZE);

  function detect() {
    analyser.getFloatTimeDomainData(timeData);

    // RMS energy
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      sumSquares += timeData[i] * timeData[i];
    }
    energyLevel = Math.sqrt(sumSquares / timeData.length);

    // Zero-crossing rate (speech has moderate ZCR, noise has high ZCR)
    let zeroCrossings = 0;
    for (let i = 1; i < timeData.length; i++) {
      if ((timeData[i] >= 0 && timeData[i - 1] < 0) || (timeData[i] < 0 && timeData[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zcr = zeroCrossings / timeData.length;

    const now = Date.now();
    const wasSpeech = isSpeech;

    // Speech: energy above threshold AND ZCR in speech range (not pure noise)
    if (energyLevel > threshold && zcr < 0.35) {
      isSpeech = true;
      lastSpeechTime = now;
    } else if (now - lastSpeechTime > holdTime) {
      isSpeech = false;
    }

    // Auto-mute non-speech
    if (autoMute) {
      const targetGain = isSpeech ? 1.0 : 0.02; // Don't fully mute, just heavily attenuate
      vadGain.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 0.05);
    }

    if (wasSpeech !== isSpeech && onStateChange) {
      onStateChange(getState());
    }
  }

  function start() {
    if (intervalId) return;
    intervalId = setInterval(detect, 30); // ~33fps detection
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function getState(): VADState {
    return { enabled, isSpeech, energyLevel, threshold };
  }

  return {
    enable() {
      enabled = true;
      start();
    },
    disable() {
      enabled = false;
      stop();
      vadGain.gain.value = 1;
      isSpeech = false;
    },
    setAutoMute(v: boolean) { autoMute = v; if (!v) vadGain.gain.value = 1; },
    setThreshold(v: number) { threshold = Math.max(0.001, Math.min(0.1, v)); },
    setHoldTime(ms: number) { holdTime = ms; },
    getState,
    onStateChange(cb: (state: VADState) => void) { onStateChange = cb; },
    destroy() {
      stop();
      try {
        input.disconnect(analyser);
        input.disconnect(vadGain);
        vadGain.disconnect();
      } catch {}
    },
  };
}
