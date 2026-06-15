import * as Tone from "tone";

export type ScaleName =
  | "chromatic"
  | "major"
  | "minor"
  | "dorian"
  | "mixolydian"
  | "harmonic-minor";

export type RootNote =
  | "C" | "C#" | "D" | "D#" | "E" | "F"
  | "F#" | "G" | "G#" | "A" | "A#" | "B";

export interface Voice {
  semitones: number;
  gain: number;
}

export interface RenderOptions {
  source: AudioBuffer;
  voices: Voice[];
  dryGain: number;
  wetGain: number;
  scale: ScaleName;
  root: RootNote;
  /** If set, only render this many seconds (for preview). */
  maxDuration?: number;
}

const ROOT_INDEX: Record<RootNote, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5,
  "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
};

function snappedSemitones(s: number, scale: ScaleName, root: RootNote): number {
  if (scale === "chromatic") return Math.round(s);
  const intervals = SCALE_INTERVALS[scale];
  const rootOffset = ROOT_INDEX[root];
  const target = Math.round(s);
  const pc = ((target - rootOffset) % 12 + 12) % 12;
  let bestInterval = intervals[0];
  let bestDist = 12;
  for (const interval of intervals) {
    const raw = pc - interval;
    const dist = Math.min(((raw % 12) + 12) % 12, ((interval - pc) % 12 + 12) % 12);
    if (dist < bestDist) {
      bestDist = dist;
      bestInterval = interval;
    }
  }
  const up = ((bestInterval - pc) + 12) % 12;
  const down = ((pc - bestInterval) + 12) % 12;
  const delta = up <= down ? up : -down;
  return target + delta;
}

/** Decode a File or Blob into an AudioBuffer. */
export async function decodeAudioFile(file: File | Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
}

/** Render the harmonized mix. Returns a stereo AudioBuffer. */
export async function renderHarmonies(opts: RenderOptions): Promise<AudioBuffer> {
  const { source, voices, dryGain, wetGain, scale, root, maxDuration } = opts;
  const clipDuration = maxDuration ? Math.min(source.duration, maxDuration) : source.duration;
  const duration = clipDuration + 0.25;
  const sampleRate = source.sampleRate;

  const rendered = await Tone.Offline(async ({ transport }) => {
    const dryPlayer = new Tone.ToneAudioBuffer(source);
    const dry = new Tone.Player(dryPlayer).toDestination();
    dry.volume.value = Tone.gainToDb(Math.max(0.0001, dryGain));

    for (const voice of voices) {
      const semitones = snappedSemitones(voice.semitones, scale, root);
      const player = new Tone.Player(new Tone.ToneAudioBuffer(source));
      const shifter = new Tone.PitchShift({
        pitch: semitones,
        windowSize: 0.05,
        delayTime: 0,
        feedback: 0,
      });
      // Soft low-pass to tame metallic artifacts from phase vocoder
      const lpf = new Tone.Filter({ frequency: 8000, type: "lowpass", rolloff: -12 });
      const gain = new Tone.Gain(voice.gain * wetGain).toDestination();
      player.chain(shifter, lpf, gain);
      player.start(0);
    }

    dry.start(0);
    transport.start(0);
  }, duration, 2, sampleRate);

  return rendered.get() as AudioBuffer;
}

/** Encode an AudioBuffer to a 16-bit PCM WAV Blob. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2 + 44;
  const arrayBuffer = new ArrayBuffer(length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, length - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length - 44, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  voices: Voice[];
}

export const PRESETS: Preset[] = [
  {
    id: "thirds",
    name: "טרצות קלאסיות",
    description: "טרצה מעל ומתחת — פופ נצחי",
    voices: [
      { semitones: 4, gain: 0.4 },
      { semitones: -3, gain: 0.3 },
    ],
  },
  {
    id: "triad",
    name: "אקורד מלא",
    description: "טרצה + קווינטה — סאונד עשיר",
    voices: [
      { semitones: 4, gain: 0.35 },
      { semitones: 7, gain: 0.3 },
      { semitones: 12, gain: 0.25 },
    ],
  },
  {
    id: "octaves",
    name: "אוקטבות",
    description: "אוקטבה מעל ומתחת — גוף ועוצמה",
    voices: [
      { semitones: 12, gain: 0.3 },
      { semitones: -12, gain: 0.25 },
    ],
  },
  {
    id: "gospel",
    name: "מקהלת גוספל",
    description: "ארבעה קולות — חום וגובה",
    voices: [
      { semitones: 4, gain: 0.3 },
      { semitones: 7, gain: 0.25 },
      { semitones: -5, gain: 0.3 },
      { semitones: -8, gain: 0.2 },
    ],
  },
  {
    id: "fifths",
    name: "קווינטות",
    description: "קווינטה מעל ומתחת",
    voices: [
      { semitones: 7, gain: 0.35 },
      { semitones: -5, gain: 0.3 },
    ],
  },
];
