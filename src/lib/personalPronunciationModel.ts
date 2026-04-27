/**
 * Personal Pronunciation Model — sits on top of `correctionLearning` and
 * `customVocabulary` and gives the user fine-grained control over per-word
 * pronunciation memory.
 *
 * Concepts added on top of the existing correction system:
 *
 *  - **verified**:  the user explicitly confirmed `original → corrected`.
 *                   verified entries get max confidence and survive pruning.
 *
 *  - **highlight**: per-word color stored separately so it survives word
 *                   replacements / re-transcription. Stored by NORMALIZED
 *                   word (no punctuation/niqqud).
 *
 *  - **approve as-is**: user confirms a flagged word is actually correct.
 *                   Adds the word to a "trusted" set, used by the marking
 *                   layer to suppress future warnings on that exact word.
 *
 *  - **similar words**: best-effort phonetic Hebrew suggestions for the
 *                   "right-click → similar words" submenu.
 *
 *  - **enable toggle**: master switch — when OFF, learned corrections are
 *                   NOT applied to engine output (engine result is raw).
 *                   The user can decide per-transcription whether to use
 *                   the personal model as an "extra engine layer".
 */

import {
  getAllCorrections,
  learnFromCorrections,
  deleteCorrection,
  type CorrectionEntry,
} from '@/utils/correctionLearning';
import {
  getActiveProfileId,
  addProfileCorrection,
  addProfileVerified,
  addProfileApproved,
  setProfileHighlight,
} from './pronunciationProfiles';

// ─── localStorage keys ─────────────────────────────────────────────
const PRONUNCIATION_ENABLED_KEY = 'personal_pronunciation_enabled';
const VERIFIED_CORRECTIONS_KEY = 'personal_pronunciation_verified';
const APPROVED_WORDS_KEY = 'personal_pronunciation_approved';
const WORD_HIGHLIGHTS_KEY = 'personal_pronunciation_highlights';

// ─── Helpers ───────────────────────────────────────────────────────
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

/** Strip punctuation, niqqud, and trim — used as canonical key for words. */
export function normalizeHebrewWord(word: string): string {
  return word
    // niqqud + cantillation marks (U+0591..U+05C7)
    .replace(/[\u0591-\u05C7]/g, '')
    // punctuation
    .replace(/[.,;:!?"'׳״()\[\]{}<>\-–—…«»]/g, '')
    .trim();
}

// ─── Master enable toggle ──────────────────────────────────────────
export function isPersonalPronunciationEnabled(): boolean {
  // Default: ON (preserves existing behavior — learned corrections are applied).
  try {
    const raw = localStorage.getItem(PRONUNCIATION_ENABLED_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setPersonalPronunciationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PRONUNCIATION_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ─── Verified corrections (high-confidence personal model) ─────────
interface VerifiedRecord {
  original: string;
  corrected: string;
  /** When the user explicitly verified this. */
  verifiedAt: number;
  /** How many times the verified pair was reinforced. */
  count: number;
}

function loadVerified(): VerifiedRecord[] {
  return readJSON<VerifiedRecord[]>(VERIFIED_CORRECTIONS_KEY, []);
}
function saveVerified(records: VerifiedRecord[]): void {
  writeJSON(VERIFIED_CORRECTIONS_KEY, records.slice(0, 5000));
}

/**
 * Record that the user has verified a correction. This:
 *   1. Adds (or boosts) the entry in the standard correctionLearning store
 *      with max confidence (1.0) and engine='personal'.
 *   2. Tracks the verification separately so we can show a "verified" badge
 *      and protect it from confidence-based pruning.
 */
export function verifyCorrection(original: string, corrected: string): void {
  const o = original.trim();
  const c = corrected.trim();
  if (!o || !c || o === c) return;

  // 1) Push into the standard learning store at max confidence.
  const now = Date.now();
  const entry: CorrectionEntry = {
    original: o,
    corrected: c,
    frequency: 5,           // strong initial weight
    engine: 'personal',
    category: !o.includes(' ') && !c.includes(' ') ? 'word' : 'phrase',
    confidence: 1,
    lastUsed: now,
    createdAt: now,
  };
  learnFromCorrections([entry]);

  // 1b) ALSO write to the active profile (if any) so per-speaker memories
  //     accumulate alongside the global model.
  const activeId = getActiveProfileId();
  if (activeId) {
    addProfileCorrection(activeId, entry);
    addProfileVerified(activeId, o, c);
  }

  // 2) Track verification separately.
  const records = loadVerified();
  const existing = records.find((r) => r.original === o && r.corrected === c);
  if (existing) {
    existing.count += 1;
    existing.verifiedAt = now;
  } else {
    records.unshift({ original: o, corrected: c, verifiedAt: now, count: 1 });
  }
  saveVerified(records);
}

export function isCorrectionVerified(original: string, corrected: string): boolean {
  return loadVerified().some((r) => r.original === original && r.corrected === corrected);
}

export function getVerifiedCorrections(): VerifiedRecord[] {
  return loadVerified();
}

export function unverifyCorrection(original: string, corrected: string): void {
  // Keep the learned correction itself, but remove the "verified" badge.
  saveVerified(loadVerified().filter((r) => !(r.original === original && r.corrected === corrected)));
}

/**
 * Remove a learned correction entirely from BOTH the standard store and
 * the verified set.
 */
export function forgetCorrection(original: string, corrected: string): void {
  deleteCorrection(original, corrected);
  unverifyCorrection(original, corrected);
}

// ─── Approved words (the AI marked it wrong but it's actually right) ─
function loadApproved(): string[] {
  return readJSON<string[]>(APPROVED_WORDS_KEY, []);
}
function saveApproved(words: string[]): void {
  writeJSON(APPROVED_WORDS_KEY, Array.from(new Set(words)).slice(0, 5000));
}

/**
 * Approve a word that was flagged as suspect — tells the marking layer to
 * stop warning on this exact (normalized) word in the future.
 */
export function approveWord(word: string): void {
  const k = normalizeHebrewWord(word);
  if (!k) return;
  const list = loadApproved();
  if (!list.includes(k)) {
    list.unshift(k);
    saveApproved(list);
  }
  // Mirror to active profile.
  const activeId = getActiveProfileId();
  if (activeId) addProfileApproved(activeId, word);
}

export function isWordApproved(word: string): boolean {
  return loadApproved().includes(normalizeHebrewWord(word));
}

export function unapproveWord(word: string): void {
  const k = normalizeHebrewWord(word);
  saveApproved(loadApproved().filter((w) => w !== k));
}

export function getApprovedWords(): string[] {
  return loadApproved();
}

// ─── Word highlights (per-word color/emphasis) ─────────────────────
export type WordHighlightColor =
  | 'yellow'
  | 'green'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'pink';

export interface WordHighlight {
  /** Normalized word — punctuation stripped. */
  key: string;
  color: WordHighlightColor;
  /** Whether to render bold as well. */
  bold?: boolean;
  updatedAt: number;
}

export const WORD_HIGHLIGHT_PALETTE: { color: WordHighlightColor; label: string; cssBg: string; cssText: string }[] = [
  { color: 'yellow', label: 'צהוב',  cssBg: 'rgba(250, 204,  21, 0.45)', cssText: 'inherit' },
  { color: 'green',  label: 'ירוק',  cssBg: 'rgba( 34, 197,  94, 0.35)', cssText: 'inherit' },
  { color: 'red',    label: 'אדום',  cssBg: 'rgba(239,  68,  68, 0.35)', cssText: 'inherit' },
  { color: 'blue',   label: 'כחול',  cssBg: 'rgba( 59, 130, 246, 0.35)', cssText: 'inherit' },
  { color: 'purple', label: 'סגול',  cssBg: 'rgba(168,  85, 247, 0.35)', cssText: 'inherit' },
  { color: 'orange', label: 'כתום',  cssBg: 'rgba(249, 115,  22, 0.35)', cssText: 'inherit' },
  { color: 'pink',   label: 'ורוד',  cssBg: 'rgba(236,  72, 153, 0.35)', cssText: 'inherit' },
];

function loadHighlights(): Record<string, WordHighlight> {
  return readJSON<Record<string, WordHighlight>>(WORD_HIGHLIGHTS_KEY, {});
}
function saveHighlights(h: Record<string, WordHighlight>): void {
  writeJSON(WORD_HIGHLIGHTS_KEY, h);
}

export function setWordHighlight(word: string, color: WordHighlightColor, bold = false): void {
  const k = normalizeHebrewWord(word);
  if (!k) return;
  const all = loadHighlights();
  all[k] = { key: k, color, bold, updatedAt: Date.now() };
  saveHighlights(all);
  const activeId = getActiveProfileId();
  if (activeId) setProfileHighlight(activeId, word, color, bold);
}

export function clearWordHighlight(word: string): void {
  const k = normalizeHebrewWord(word);
  const all = loadHighlights();
  if (k in all) {
    delete all[k];
    saveHighlights(all);
  }
}

export function getWordHighlight(word: string): WordHighlight | undefined {
  return loadHighlights()[normalizeHebrewWord(word)];
}

export function getAllHighlights(): WordHighlight[] {
  return Object.values(loadHighlights());
}

/**
 * Resolve highlight → inline CSS style object. Returns undefined when the
 * word has no highlight set.
 */
export function getWordHighlightStyle(word: string): React.CSSProperties | undefined {
  const h = getWordHighlight(word);
  if (!h) return undefined;
  const palette = WORD_HIGHLIGHT_PALETTE.find((p) => p.color === h.color);
  if (!palette) return undefined;
  return {
    backgroundColor: palette.cssBg,
    color: palette.cssText,
    fontWeight: h.bold ? 700 : undefined,
    borderRadius: '4px',
    padding: '0 2px',
  };
}

// ─── Similar-words generator (lightweight phonetic suggestions) ────
/**
 * Build a small set of phonetic "neighbors" for a Hebrew word. Used in the
 * right-click "מילים דומות" submenu BEFORE we hit the AI suggestion API.
 *
 * Heuristics:
 *  - Swap easily-confused Hebrew letter pairs that Whisper commonly mis-hears
 *    (אהי / כק / טת / סצ / וב).
 *  - Add/remove final ה.
 *  - Pull historical user corrections from the learning store that share
 *    a prefix or normalized stem.
 */
export function getSimilarWords(word: string, limit = 8): string[] {
  const stripped = normalizeHebrewWord(word);
  if (!stripped) return [];

  const neighbors = new Set<string>();
  const swaps: Array<[RegExp, string]> = [
    [/א/g, 'ה'], [/ה/g, 'א'],
    [/כ/g, 'ק'], [/ק/g, 'כ'],
    [/ט/g, 'ת'], [/ת/g, 'ט'],
    [/ס/g, 'צ'], [/צ/g, 'ס'],
    [/ו/g, 'ב'], [/ב/g, 'ו'],
    [/ש/g, 'ס'], [/ס/g, 'ש'],
    [/י/g, 'א'],
  ];
  for (const [from, to] of swaps) {
    const candidate = stripped.replace(from, to);
    if (candidate !== stripped) neighbors.add(candidate);
  }
  // toggle final ה
  if (stripped.endsWith('ה')) neighbors.add(stripped.slice(0, -1));
  else neighbors.add(stripped + 'ה');

  // Pull from user corrections — anything where original starts with the same 2 chars.
  const prefix = stripped.slice(0, 2);
  for (const c of getAllCorrections()) {
    if (c.corrected && c.corrected !== stripped && (c.original.startsWith(prefix) || c.corrected.startsWith(prefix))) {
      neighbors.add(c.corrected);
    }
  }

  return Array.from(neighbors).filter((w) => w && w !== stripped).slice(0, limit);
}
