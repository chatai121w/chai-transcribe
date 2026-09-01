/**
 * Talmudic Corrections Seed
 *
 * One-time seed of common ASR mistakes specific to Talmudic / Ashkenazi
 * Hebrew transcription (גמרה→גמרא, מתניתן→מתניתין, וכו').
 *
 * Source: tools/asr_eval/corrections.json
 *
 * The seed runs at most once per browser (flag in localStorage). It feeds
 * the existing correctionLearning store with high-confidence word-level
 * entries that are safe to apply blindly (ambiguous words like רבה/רבא
 * are intentionally excluded — those require context, not post-correction).
 */

import { learnFromCorrections, type CorrectionEntry } from "./correctionLearning";
import correctionSeed from "../../tools/asr_eval/corrections.json";

// Bump the flag whenever new safe variants are added so existing users receive
// them without clearing or replacing their personal correction history.
const SEED_FLAG_KEY = "talmudic_corrections_seeded_v4";
const WORD_REPLACEMENTS = correctionSeed.word_replacements as Record<string, string>;

export function seedTalmudicCorrections(force = false): number {
  try {
    if (!force && localStorage.getItem(SEED_FLAG_KEY) === "1") return 0;

    const now = Date.now();
    const entries: CorrectionEntry[] = Object.entries(WORD_REPLACEMENTS).map(
      ([original, corrected]) => ({
        original,
        corrected,
        note: "seed: talmudic/ashkenazi ASR",
        frequency: 3,
        engine: "seed:talmudic",
        category: original.includes(" ") ? "phrase" : "word",
        confidence: 0.9,
        lastUsed: now,
        createdAt: now,
      }),
    );

    learnFromCorrections(entries);
    localStorage.setItem(SEED_FLAG_KEY, "1");
    return entries.length;
  } catch (err) {
    console.warn("[talmudicCorrectionsSeed] failed:", err);
    return 0;
  }
}
