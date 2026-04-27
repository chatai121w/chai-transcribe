/**
 * Profile Suggestion (lightweight, filename-based)
 * ────────────────────────────────────────────────
 * Real speaker recognition needs voice embeddings — out of scope here.
 * Instead, every time a profile is used to transcribe a file we record the
 * file name. Later, when the user loads a new file, we suggest the profile
 * whose recorded names best match the new name (token Jaccard overlap).
 *
 * Storage: one localStorage key per profile, `pp_profile_<id>_filenames`,
 * keeping the last 200 filenames seen for that profile.
 */

import { listProfiles, getActiveProfileId, getProfile } from './pronunciationProfiles';

const FN_LIMIT = 200;

function key(id: string): string {
  return `pp_profile_${id}_filenames`;
}

function load(id: string): string[] {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function save(id: string, list: string[]): void {
  try { localStorage.setItem(key(id), JSON.stringify(list.slice(0, FN_LIMIT))); } catch { /* ignore */ }
}

/** Record that the active profile was used for `filename`. */
export function recordProfileUsage(filename: string): void {
  const id = getActiveProfileId();
  if (!id || !filename) return;
  const clean = filename.split(/[\\/]/).pop() || filename;
  const list = load(id);
  if (list[0] !== clean) {
    save(id, [clean, ...list.filter((x) => x !== clean)]);
  }
  // Also bump usage stats.
  try {
    const statsRaw = localStorage.getItem(`pp_profile_${id}_usage_stats`);
    const stats = statsRaw ? JSON.parse(statsRaw) : { count: 0, lastUsed: 0 };
    stats.count = (stats.count || 0) + 1;
    stats.lastUsed = Date.now();
    localStorage.setItem(`pp_profile_${id}_usage_stats`, JSON.stringify(stats));
  } catch { /* ignore */ }
}

export interface ProfileUsageStats { count: number; lastUsed: number }

export function getProfileUsageStats(profileId: string): ProfileUsageStats {
  try {
    const raw = localStorage.getItem(`pp_profile_${profileId}_usage_stats`);
    if (!raw) return { count: 0, lastUsed: 0 };
    const v = JSON.parse(raw);
    return { count: Number(v.count) || 0, lastUsed: Number(v.lastUsed) || 0 };
  } catch { return { count: 0, lastUsed: 0 }; }
}

/** Tokenize a filename — lowercase, split on common separators. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[\s_\-.,()[\]{}]+/u)
    .filter((t) => t.length >= 2);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export interface ProfileSuggestion {
  profileId: string;
  profileName: string;
  score: number;
  matchedFilename?: string;
}

/**
 * Return profiles ranked by similarity of their recorded filenames to the
 * given filename. Empty array if no learned associations exist.
 */
export function suggestProfilesForFile(filename: string, limit = 3): ProfileSuggestion[] {
  if (!filename) return [];
  const target = new Set(tokenize(filename));
  if (target.size === 0) return [];

  const out: ProfileSuggestion[] = [];
  for (const p of listProfiles()) {
    let bestScore = 0;
    let bestMatch: string | undefined;
    // Also consider profile NAME (e.g. "הרב כהן" → words in filename).
    const nameTokens = new Set(tokenize(p.name));
    const nameScore = jaccard(target, nameTokens);
    if (nameScore > bestScore) {
      bestScore = nameScore;
      bestMatch = p.name;
    }
    for (const fn of load(p.id)) {
      const score = jaccard(target, new Set(tokenize(fn)));
      if (score > bestScore) {
        bestScore = score;
        bestMatch = fn;
      }
    }
    if (bestScore > 0.15) {
      out.push({
        profileId: p.id,
        profileName: p.name,
        score: bestScore,
        matchedFilename: bestMatch,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Convenience: top suggestion or undefined. */
export function topSuggestionForFile(filename: string): ProfileSuggestion | undefined {
  return suggestProfilesForFile(filename, 1)[0];
}

export function getRecordedFilenames(profileId: string): string[] {
  return load(profileId);
}

export function _profileNameForId(id: string): string | undefined {
  return getProfile(id)?.name;
}

// ─── Current audio context (for live suggestion banners) ────────
let _currentFilename = '';

export function setCurrentAudioFilename(name: string): void {
  const clean = (name || '').toString();
  if (clean === _currentFilename) return;
  _currentFilename = clean;
  try {
    window.dispatchEvent(new CustomEvent('pp-audio-file-changed', { detail: { name: clean } }));
  } catch { /* ignore */ }
}

export function getCurrentAudioFilename(): string {
  return _currentFilename;
}
