/**
 * Audio quality pre-check.
 *
 * Decodes a small slice of the file with Web Audio API and reports common
 * problems that hurt transcription accuracy:
 *   • Very low RMS  → mic too far / too quiet
 *   • Clipping      → distorted, mic too loud
 *   • Wrong sample rate (<16 kHz) → Whisper expects ≥16 kHz
 *   • Silent file
 *
 * Cheap — analyzes only the first ~10 seconds.
 */

const SAMPLE_SECONDS = 10;

export interface AudioQualityIssue {
  severity: "warn" | "error";
  code:
    | "too_quiet"
    | "clipping"
    | "low_sample_rate"
    | "silent"
    | "decode_failed";
  message: string;
  suggestion?: string;
}

export interface AudioQualityReport {
  ok: boolean;
  issues: AudioQualityIssue[];
  rmsDb: number;
  peak: number;
  clippingRatio: number;
  sampleRate: number;
  durationSec: number;
}

export async function analyzeAudioFile(file: File): Promise<AudioQualityReport> {
  const empty: AudioQualityReport = {
    ok: false,
    issues: [],
    rmsDb: -Infinity,
    peak: 0,
    clippingRatio: 0,
    sampleRate: 0,
    durationSec: 0,
  };

  let ac: AudioContext | null = null;
  try {
    // Read first ~SAMPLE_SECONDS of the file as ArrayBuffer.
    // For audio files, decoding the whole short slice is fine; for long files
    // we still decode all of it (browsers handle this efficiently for short
    // analysis). To keep memory bounded for huge uploads, cap at ~20 MB.
    const maxBytes = 20 * 1024 * 1024;
    const slice = file.size > maxBytes ? file.slice(0, maxBytes) : file;
    const buf = await slice.arrayBuffer();

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new Ctx();
    const audio = await ac.decodeAudioData(buf);

    const sr = audio.sampleRate;
    const dur = audio.duration;
    const samples = Math.min(audio.length, sr * SAMPLE_SECONDS);
    const ch0 = audio.getChannelData(0);

    let sumSq = 0;
    let peak = 0;
    let clipped = 0;
    for (let i = 0; i < samples; i += 1) {
      const v = ch0[i];
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.99) clipped += 1;
    }
    const rms = Math.sqrt(sumSq / samples);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const clippingRatio = clipped / samples;

    const issues: AudioQualityIssue[] = [];

    if (peak < 0.01 || rmsDb < -55) {
      issues.push({
        severity: "error",
        code: "silent",
        message: "הקובץ נראה שקט לחלוטין",
        suggestion: "בדוק שהמיקרופון אכן הקליט. תמלול לא יעבוד.",
      });
    } else if (rmsDb < -38) {
      issues.push({
        severity: "warn",
        code: "too_quiet",
        message: `אודיו חלש (RMS ${rmsDb.toFixed(1)} dB)`,
        suggestion: "קרב את המיקרופון או הגבר רמה לפני התמלול לשיפור דיוק.",
      });
    }

    if (clippingRatio > 0.005) {
      issues.push({
        severity: "warn",
        code: "clipping",
        message: `סימני חיתוך (clipping) ב-${(clippingRatio * 100).toFixed(1)}% מהמדגם`,
        suggestion: "המיקרופון רווי — הורד רמת קלט. דיוק עלול לרדת.",
      });
    }

    if (sr < 16000) {
      issues.push({
        severity: "warn",
        code: "low_sample_rate",
        message: `קצב דגימה נמוך (${sr} Hz)`,
        suggestion: "Whisper נבנה ל-16 kHz ומעלה. עלולים להיות פספוסים.",
      });
    }

    return {
      ok: issues.every(i => i.severity !== "error"),
      issues,
      rmsDb,
      peak,
      clippingRatio,
      sampleRate: sr,
      durationSec: dur,
    };
  } catch (err) {
    return {
      ...empty,
      ok: true, // don't block on decode failure
      issues: [{
        severity: "warn",
        code: "decode_failed",
        message: "לא הצלחנו לנתח איכות אודיו",
        suggestion: err instanceof Error ? err.message : String(err),
      }],
    };
  } finally {
    try { await ac?.close(); } catch { /* ignore */ }
  }
}
