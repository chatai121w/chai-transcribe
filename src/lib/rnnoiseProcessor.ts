/**
 * RNNoise WASM Neural Noise Suppression
 * Uses @shiguredo/rnnoise-wasm — real RNN-based noise reduction in the browser.
 * RNNoise processes 480-sample frames at 48kHz, expects 16-bit PCM scale.
 */
import { Rnnoise } from '@shiguredo/rnnoise-wasm';

export interface NoiseSuppressionState {
  enabled: boolean;
  strength: number; // 0-1
}

// Singleton RNNoise WASM instance
let _rnnoiseInstance: Rnnoise | null = null;
let _loadPromise: Promise<Rnnoise | null> | null = null;

function getRnnoise(): Promise<Rnnoise | null> {
  if (_rnnoiseInstance) return Promise.resolve(_rnnoiseInstance);
  if (!_loadPromise) {
    _loadPromise = Rnnoise.load()
      .then(r => { _rnnoiseInstance = r; return r; })
      .catch(() => null);
  }
  return _loadPromise;
}

export type NoiseSuppressionChain = {
  enable: () => void;
  disable: () => void;
  setStrength: (v: number) => void;
  isEnabled: () => boolean;
  destroy: () => void;
};

export async function createNoiseSuppressionChain(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
): Promise<NoiseSuppressionChain> {
  const rnnoise = await getRnnoise();

  if (!rnnoise) {
    // WASM failed to load — silent pass-through
    input.connect(output);
    return {
      enable() {}, disable() {}, setStrength() {},
      isEnabled() { return false; },
      destroy() { try { input.disconnect(output); } catch {} },
    };
  }

  const denoiseState = rnnoise.createDenoiseState();
  const FRAME_SIZE = rnnoise.frameSize; // 480

  let enabled = false;
  let strength = 0.7;

  // Ring buffers for frame alignment
  const RING_LEN = FRAME_SIZE * 8;
  const inputRing = new Float32Array(RING_LEN);
  const origRing = new Float32Array(RING_LEN);  // keep originals for dry/wet mix
  const outputRing = new Float32Array(RING_LEN);
  let inW = 0, inR = 0, inN = 0;
  let outW = 0, outR = 0, outN = 0;

  const frame = new Float32Array(FRAME_SIZE);

  // Wet/dry gain nodes
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.value = 1;
  wetGain.gain.value = 0;

  // ScriptProcessor for sample-level RNNoise processing
  const BUFFER_SIZE = 512;
  const scriptNode = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);

  scriptNode.onaudioprocess = (e) => {
    const inp = e.inputBuffer.getChannelData(0);
    const out = e.outputBuffer.getChannelData(0);

    if (!enabled) {
      out.set(inp);
      return;
    }

    // Push samples into input ring
    for (let i = 0; i < inp.length; i++) {
      inputRing[inW] = inp[i];
      origRing[inW] = inp[i];
      inW = (inW + 1) % RING_LEN;
      inN++;
    }

    // Process complete 480-sample frames
    while (inN >= FRAME_SIZE) {
      // Read & scale to 16-bit PCM
      for (let j = 0; j < FRAME_SIZE; j++) {
        frame[j] = inputRing[inR] * 32768.0;
        inR = (inR + 1) % RING_LEN;
      }
      inN -= FRAME_SIZE;

      // RNNoise processes in-place, returns VAD score
      denoiseState.processFrame(frame);

      // Mix clean (wet) with original (dry) per-sample using strength
      let origIdx = (inR - FRAME_SIZE + RING_LEN * 2) % RING_LEN;
      for (let j = 0; j < FRAME_SIZE; j++) {
        const clean = frame[j] / 32768.0;
        const orig = origRing[(origIdx + j) % RING_LEN];
        outputRing[outW] = clean * strength + orig * (1 - strength);
        outW = (outW + 1) % RING_LEN;
        outN++;
      }
    }

    // Read processed samples into output
    for (let i = 0; i < out.length; i++) {
      if (outN > 0) {
        out[i] = outputRing[outR];
        outR = (outR + 1) % RING_LEN;
        outN--;
      } else {
        out[i] = inp[i]; // buffer underrun: pass through
      }
    }
  };

  // Routing: wet path through ScriptProcessor, dry path direct
  input.connect(scriptNode);
  scriptNode.connect(wetGain);
  input.connect(dryGain);
  dryGain.connect(output);
  wetGain.connect(output);

  function resetBuffers() {
    inW = inR = inN = 0;
    outW = outR = outN = 0;
  }

  return {
    enable() {
      enabled = true;
      dryGain.gain.value = 0;
      wetGain.gain.value = 1;
      resetBuffers();
    },
    disable() {
      enabled = false;
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;
    },
    setStrength(v: number) {
      strength = Math.max(0, Math.min(1, v));
    },
    isEnabled() { return enabled; },
    destroy() {
      try { input.disconnect(scriptNode); } catch {}
      try { input.disconnect(dryGain); } catch {}
      try { scriptNode.disconnect(); } catch {}
      try { dryGain.disconnect(); } catch {}
      try { wetGain.disconnect(); } catch {}
      denoiseState.destroy();
    },
  };
}
