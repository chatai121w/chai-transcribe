/**
 * Hebrew text normalization for ASR evaluation.
 *
 * TS port of tools/asr_eval/hebrew_utils.py. Identical normalization must be
 * applied to BOTH reference and hypothesis sides — otherwise WER drifts
 * without any real change.
 *
 * Defaults:
 *  - strip nikud (U+0591..U+05C7)
 *  - normalize geresh/gershayim to ASCII '/"
 *  - strip punctuation
 *  - fold final letters (ך→כ ם→מ ן→נ ף→פ ץ→צ) so they don't count as different
 *  - collapse whitespace
 */

const NIKUD_RE = /[\u0591-\u05C7]/g;
const PUNCT_RE = /[.,;:!?"'`׳״()\[\]{}<>–—\-…/\\|*=+_~^]/g;

const FINALS: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

export interface NormalizeOptions {
  removeNikud?: boolean;
  foldFinals?: boolean;
  removePunct?: boolean;
  collapseWs?: boolean;
}

export function normalizeHebrew(text: string | null | undefined, opts: NormalizeOptions = {}): string {
  if (!text) return '';
  const {
    removeNikud = true,
    foldFinals = true,
    removePunct = true,
    collapseWs = true,
  } = opts;

  let t = text.normalize('NFC');
  if (removeNikud) t = t.replace(NIKUD_RE, '');
  t = t.replace(/״/g, '"').replace(/׳/g, "'");
  if (removePunct) t = t.replace(PUNCT_RE, ' ');
  if (foldFinals) t = Array.from(t).map((ch) => FINALS[ch] ?? ch).join('');
  if (collapseWs) t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function tokenizeHebrew(text: string, opts?: NormalizeOptions): string[] {
  const n = normalizeHebrew(text, opts);
  return n.length ? n.split(' ') : [];
}
