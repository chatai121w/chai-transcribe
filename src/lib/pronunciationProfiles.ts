/**
 * Personal Pronunciation Profiles
 * ───────────────────────────────
 * Multiple named pronunciation memories on top of the existing global
 * `personalPronunciationModel`. Use case:
 *
 *   - Global model: trained from EVERY correction the user ever makes.
 *     Acts as the user's "default" personal layer on top of any engine.
 *   - Named profiles: per-speaker memories (e.g. "הרב כהן", "הרב שמואל").
 *     When a profile is active, its corrections are applied AS AN EXTRA
 *     LAYER on top of the engine + global model. Right-click learning
 *     ("הטמע ללמידת AI") writes to BOTH the global model AND the active
 *     profile, so training a specific Rabbi also improves the general
 *     model — but only the profile-specific corrections are applied
 *     when that Rabbi is selected.
 *
 * Storage layout (localStorage):
 *   pp_profiles_index           → [{ id, name, description, createdAt }]
 *   pp_active_profile           → string | "" (empty = no profile)
 *   pp_profile_<id>_corrections → CorrectionEntry[]
 *   pp_profile_<id>_verified    → VerifiedRecord[]
 *   pp_profile_<id>_approved    → string[]   (normalized words)
 *   pp_profile_<id>_highlights  → Record<string, WordHighlight>
 *   pp_profile_<id>_samples     → ProfileLearningSample[]
 */

import type { CorrectionEntry } from '@/utils/correctionLearning';
import type { WordHighlight, WordHighlightColor } from './personalPronunciationModel';
import { normalizeHebrewWord } from './personalPronunciationModel';

// ─── Keys ──────────────────────────────────────────────────────────
const INDEX_KEY = 'pp_profiles_index';
const ACTIVE_KEY = 'pp_active_profile';
const profileKey = (id: string, kind: 'corrections' | 'verified' | 'approved' | 'highlights' | 'samples') =>
  `pp_profile_${id}_${kind}`;

const MAX_PROFILE_SAMPLES = 200;
const MAX_SAMPLE_PAIRS = 250;
const MAX_CORRECTION_HOTWORDS = 120;

const HOTWORD_STOPWORDS = new Set([
  'אני', 'אתה', 'את', 'אנחנו', 'הוא', 'היא', 'הם', 'הן',
  'של', 'עם', 'על', 'אל', 'אם', 'או', 'גם', 'כי', 'אבל',
  'זה', 'זאת', 'זו', 'איזה', 'איזו', 'יש', 'אין', 'היה', 'היו',
  'מה', 'מי', 'כן', 'לא', 'כל', 'עוד', 'כמו', 'רק', 'כבר', 'אחרי',
]);

// ─── Types ─────────────────────────────────────────────────────────
export interface PronunciationProfile {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Optional per-profile engine settings — fed directly to Whisper. */
  settings?: PronunciationProfileSettings;
}

export interface PronunciationProfileSettings {
  /** Force Loshon Kodesh mode for this profile (overrides global toggle when true). */
  loshonKodesh?: boolean;
  /** Custom Whisper initial_prompt — biases the engine before it starts. */
  initialPrompt?: string;
  /** Extra hotwords (comma-separated) appended on top of verified words. */
  extraHotwords?: string;
}

export interface ProfileVerifiedRecord {
  original: string;
  corrected: string;
  verifiedAt: number;
  count: number;
}

export interface ProfileLearningPair {
  original: string;
  corrected: string;
  count: number;
}

export interface ProfileLearningAudioRef {
  source: 'supabase' | 'blob' | 'url' | 'unknown';
  audioUrl?: string;
  audioFilePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSec?: number;
}

export interface ProfileLearningSample {
  id: string;
  createdAt: number;
  source: string;
  transcriptId?: string;
  engineLabel?: string;
  actionLabel?: string;
  note?: string;
  originalText: string;
  correctedText: string;
  correctionPairs: ProfileLearningPair[];
  audio?: ProfileLearningAudioRef;
}

// ─── JSON helpers ──────────────────────────────────────────────────
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

// ─── Profile registry ──────────────────────────────────────────────
export function listProfiles(): PronunciationProfile[] {
  return readJSON<PronunciationProfile[]>(INDEX_KEY, []);
}

function saveProfiles(list: PronunciationProfile[]): void {
  writeJSON(INDEX_KEY, list);
}

function genId(): string {
  return `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createProfile(name: string, description?: string): PronunciationProfile {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Profile name required');
  const list = listProfiles();
  if (list.some((p) => p.name === trimmed)) {
    throw new Error('פרופיל בשם הזה כבר קיים');
  }
  const now = Date.now();
  const profile: PronunciationProfile = {
    id: genId(),
    name: trimmed,
    description: description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(profile);
  saveProfiles(list);
  return profile;
}

export function renameProfile(id: string, newName: string, newDescription?: string): void {
  const list = listProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  const trimmed = newName.trim();
  if (trimmed) p.name = trimmed;
  if (newDescription !== undefined) p.description = newDescription.trim() || undefined;
  p.updatedAt = Date.now();
  saveProfiles(list);
}

export function updateProfileSettings(id: string, settings: PronunciationProfileSettings): void {
  const list = listProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  p.settings = { ...(p.settings || {}), ...settings };
  p.updatedAt = Date.now();
  saveProfiles(list);
}

export function deleteProfile(id: string): void {
  saveProfiles(listProfiles().filter((p) => p.id !== id));
  for (const k of ['corrections', 'verified', 'approved', 'highlights', 'samples'] as const) {
    try {
      localStorage.removeItem(profileKey(id, k));
    } catch { /* ignore */ }
  }
  if (getActiveProfileId() === id) setActiveProfileId('');
}

export function getProfile(id: string): PronunciationProfile | undefined {
  return listProfiles().find((p) => p.id === id);
}

// ─── Active profile pointer ────────────────────────────────────────
export function getActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || '';
  } catch {
    return '';
  }
}

export function setActiveProfileId(id: string): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    // Notify same-tab listeners (storage event only fires across tabs).
    window.dispatchEvent(new CustomEvent('pp-active-profile-changed', { detail: { id } }));
  } catch { /* ignore */ }
}

export function getActiveProfile(): PronunciationProfile | undefined {
  const id = getActiveProfileId();
  return id ? getProfile(id) : undefined;
}

// ─── Per-profile correction store ──────────────────────────────────
export function getProfileCorrections(id: string): CorrectionEntry[] {
  return readJSON<CorrectionEntry[]>(profileKey(id, 'corrections'), []);
}

function saveProfileCorrections(id: string, list: CorrectionEntry[]): void {
  writeJSON(profileKey(id, 'corrections'), list.slice(0, 5000));
}

/**
 * Add or boost a correction inside a profile. Identical contract to
 * `learnFromCorrections` from correctionLearning, but scoped per-profile.
 */
export function addProfileCorrection(id: string, entry: CorrectionEntry): void {
  const list = getProfileCorrections(id);
  const existing = list.find(
    (e) => e.original === entry.original && e.corrected === entry.corrected
  );
  if (existing) {
    existing.frequency = (existing.frequency || 1) + (entry.frequency || 1);
    existing.confidence = Math.min(1, (existing.confidence || 0.5) + 0.1);
    existing.lastUsed = entry.lastUsed || Date.now();
  } else {
    list.unshift({
      ...entry,
      lastUsed: entry.lastUsed || Date.now(),
      createdAt: entry.createdAt || Date.now(),
    });
  }
  saveProfileCorrections(id, list);
  touchProfile(id);
}

export function removeProfileCorrection(id: string, original: string, corrected: string): void {
  saveProfileCorrections(
    id,
    getProfileCorrections(id).filter(
      (e) => !(e.original === original && e.corrected === corrected)
    )
  );
  touchProfile(id);
}

function touchProfile(id: string): void {
  const list = listProfiles();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.updatedAt = Date.now();
    saveProfiles(list);
  }
}

// ─── Per-profile verified set ──────────────────────────────────────
export function getProfileVerified(id: string): ProfileVerifiedRecord[] {
  return readJSON<ProfileVerifiedRecord[]>(profileKey(id, 'verified'), []);
}

export function addProfileVerified(id: string, original: string, corrected: string): void {
  const o = original.trim();
  const c = corrected.trim();
  if (!o || !c) return;
  const list = getProfileVerified(id);
  const found = list.find((r) => r.original === o && r.corrected === c);
  if (found) {
    found.count += 1;
    found.verifiedAt = Date.now();
  } else {
    list.unshift({ original: o, corrected: c, count: 1, verifiedAt: Date.now() });
  }
  writeJSON(profileKey(id, 'verified'), list.slice(0, 5000));
}

// ─── Per-profile approved-words set ────────────────────────────────
export function getProfileApproved(id: string): string[] {
  return readJSON<string[]>(profileKey(id, 'approved'), []);
}

export function addProfileApproved(id: string, word: string): void {
  const k = normalizeHebrewWord(word);
  if (!k) return;
  const list = getProfileApproved(id);
  if (!list.includes(k)) {
    list.unshift(k);
    writeJSON(profileKey(id, 'approved'), list.slice(0, 5000));
  }
}

// ─── Per-profile highlights ────────────────────────────────────────
export function getProfileHighlights(id: string): Record<string, WordHighlight> {
  return readJSON<Record<string, WordHighlight>>(profileKey(id, 'highlights'), {});
}

export function setProfileHighlight(
  id: string,
  word: string,
  color: WordHighlightColor,
  bold = false
): void {
  const k = normalizeHebrewWord(word);
  if (!k) return;
  const all = getProfileHighlights(id);
  all[k] = { key: k, color, bold, updatedAt: Date.now() };
  writeJSON(profileKey(id, 'highlights'), all);
}

// ─── Per-profile full learning samples ─────────────────────────────
export function getProfileLearningSamples(id: string): ProfileLearningSample[] {
  return readJSON<ProfileLearningSample[]>(profileKey(id, 'samples'), []);
}

function buildLearningSampleFingerprint(sample: {
  transcriptId?: string;
  source?: string;
  originalText: string;
  correctedText: string;
  correctionPairs: ProfileLearningPair[];
  audio?: ProfileLearningAudioRef;
}): string {
  const pairsPart = sample.correctionPairs
    .map((p) => `${p.original.trim()}=>${p.corrected.trim()}:${Math.max(1, p.count || 1)}`)
    .join('|');
  const audioPath = sample.audio?.audioFilePath || '';
  const audioUrl = sample.audio?.audioUrl || '';
  const audioFile = sample.audio?.fileName || '';
  return [
    sample.transcriptId || '',
    sample.source || '',
    sample.originalText.trim(),
    sample.correctedText.trim(),
    pairsPart,
    audioPath,
    audioUrl,
    audioFile,
  ].join('||');
}

function saveProfileLearningSamples(id: string, list: ProfileLearningSample[]): void {
  writeJSON(profileKey(id, 'samples'), list.slice(0, MAX_PROFILE_SAMPLES));
  touchProfile(id);
}

export function addProfileLearningSample(
  id: string,
  sample: Omit<ProfileLearningSample, 'id' | 'createdAt'> & Partial<Pick<ProfileLearningSample, 'id' | 'createdAt'>>
): ProfileLearningSample {
  const normalizedPairs = (sample.correctionPairs || [])
    .filter((p) => p.original?.trim() && p.corrected?.trim() && p.original !== p.corrected)
    .slice(0, MAX_SAMPLE_PAIRS)
    .map((p) => ({
      original: p.original.trim(),
      corrected: p.corrected.trim(),
      count: Math.max(1, p.count || 1),
    }));

  const record: ProfileLearningSample = {
    id: sample.id || `pls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: sample.createdAt || Date.now(),
    source: sample.source || 'unknown',
    transcriptId: sample.transcriptId,
    engineLabel: sample.engineLabel,
    actionLabel: sample.actionLabel,
    note: sample.note,
    originalText: sample.originalText.trim(),
    correctedText: sample.correctedText.trim(),
    correctionPairs: normalizedPairs,
    audio: sample.audio,
  };

  const existingList = getProfileLearningSamples(id);
  const seenFingerprints = new Set<string>();
  const list = existingList.filter((existing) => {
    const fp = buildLearningSampleFingerprint(existing);
    if (seenFingerprints.has(fp)) return false;
    seenFingerprints.add(fp);
    return true;
  });
  const nextFingerprint = buildLearningSampleFingerprint(record);
  const duplicateIndex = list.findIndex((existing) => {
    if (sample.id && existing.id === sample.id) return true;
    return buildLearningSampleFingerprint(existing) === nextFingerprint;
  });

  if (duplicateIndex >= 0) {
    const existing = list[duplicateIndex];
    const merged: ProfileLearningSample = {
      ...existing,
      ...record,
      id: existing.id,
      createdAt: existing.createdAt,
      note: record.note || existing.note,
    };
    list.splice(duplicateIndex, 1);
    list.unshift(merged);
    saveProfileLearningSamples(id, list);
    return merged;
  }

  list.unshift(record);
  saveProfileLearningSamples(id, list);
  return record;
}

// ─── Apply profile corrections to engine output ────────────────────
export interface ApplyProfileResult {
  text: string;
  appliedCount: number;
}

/**
 * Apply the active profile's corrections to a piece of engine output.
 * Mirrors the algorithm of `applyLearnedCorrections` but only uses the
 * profile's local corrections — and ignores entries below the threshold.
 */
export function applyProfileCorrections(
  text: string,
  options: { profileId?: string; confidenceThreshold?: number; maxCorrections?: number } = {}
): ApplyProfileResult {
  const profileId = options.profileId ?? getActiveProfileId();
  if (!profileId) return { text, appliedCount: 0 };
  const threshold = options.confidenceThreshold ?? 0.6;
  const max = options.maxCorrections ?? 50;

  const corrections = getProfileCorrections(profileId)
    .filter((c) => (c.confidence ?? 0) >= threshold)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, max);

  let result = text;
  let applied = 0;
  for (const c of corrections) {
    if (!c.original || !c.corrected || c.original === c.corrected) continue;
    // Word-boundary replacement that respects Hebrew letters.
    const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\u0590-\\u05FFa-zA-Z0-9])${escaped}(?=$|[^\\u0590-\\u05FFa-zA-Z0-9])`, 'g');
    const next = result.replace(re, (_m, lead) => `${lead}${c.corrected}`);
    if (next !== result) {
      applied += 1;
      result = next;
    }
  }
  return { text: result, appliedCount: applied };
}

function normalizeHotwordToken(word: string): string {
  const normalized = normalizeHebrewWord(word).replace(/[\u200f\u200e]/g, '').trim();
  if (!normalized) return '';
  if (normalized.length < 2) return '';
  if (HOTWORD_STOPWORDS.has(normalized)) return '';
  return normalized;
}

function collectCorrectionHotwords(profileId: string): string[] {
  const weighted = new Map<string, number>();
  for (const c of getProfileCorrections(profileId)) {
    if (!c.corrected) continue;
    const score = Math.max(1, c.frequency || 1) * Math.max(0.3, c.confidence || 0.5);
    for (const raw of c.corrected.split(/\s+/)) {
      const token = normalizeHotwordToken(raw);
      if (!token) continue;
      weighted.set(token, (weighted.get(token) || 0) + score);
    }
  }
  return Array.from(weighted.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CORRECTION_HOTWORDS)
    .map(([token]) => token);
}

// ─── Engine integration: hotwords + initial prompt ─────────────────
/**
 * Build the comma-separated hotwords string the active profile contributes.
 * Whisper biases towards these words when decoding — this is how the engine
 * itself "learns" the speaker's vocabulary, beyond post-processing.
 *
 * Sources combined:
 *   - All `corrected` words from verified pairs (they're known-correct words for this speaker)
 *   - All highlighted words (the user marked them as important)
 *   - The profile's `extraHotwords` setting
 */
export function buildProfileHotwords(profileId?: string): string {
  const id = profileId ?? getActiveProfileId();
  if (!id) return '';
  const set = new Set<string>();

  for (const v of getProfileVerified(id)) {
    if (v.corrected) {
      // Take individual words too, in case the verified entry is a phrase.
      for (const w of v.corrected.split(/\s+/)) {
        const t = w.trim();
        if (t) set.add(t);
      }
    }
  }
  for (const k of Object.keys(getProfileHighlights(id))) {
    if (k) set.add(k);
  }
  const extras = getProfile(id)?.settings?.extraHotwords;
  if (extras) {
    for (const w of extras.split(/[,\n]/)) {
      const t = w.trim();
      if (t) set.add(t);
    }
  }
  for (const token of collectCorrectionHotwords(id)) {
    set.add(token);
  }
  return Array.from(set).join(', ');
}

/** Returns the profile's custom initial prompt, or empty string. */
export function getProfileInitialPrompt(profileId?: string): string {
  const id = profileId ?? getActiveProfileId();
  if (!id) return '';
  return getProfile(id)?.settings?.initialPrompt?.trim() || '';
}

/** Whether the active profile forces Loshon Kodesh mode. */
export function isProfileLoshonKodesh(profileId?: string): boolean {
  const id = profileId ?? getActiveProfileId();
  if (!id) return false;
  return Boolean(getProfile(id)?.settings?.loshonKodesh);
}

// ─── Bulk training: paste raw + corrected → diff → seed profile ────
/**
 * Tokenize Hebrew text into rough "words" preserving punctuation as separate items.
 */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t && !/^\s+$/.test(t));
}

/**
 * Naive word-level diff: walks both token arrays in parallel and groups
 * consecutive substitutions into single (rawPhrase → correctedPhrase) pairs.
 * Returns a map keyed by raw phrase with the corrected text + count.
 */
export interface BulkTrainingPair {
  original: string;
  corrected: string;
  count: number;
}

export function diffForTraining(rawText: string, correctedText: string): BulkTrainingPair[] {
  const a = tokenize(rawText);
  const b = tokenize(correctedText);
  const pairs = new Map<string, BulkTrainingPair>();

  // LCS-based alignment (size-bounded for safety).
  const MAX = 4000;
  if (a.length > MAX || b.length > MAX) {
    return [];
  }
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack to extract operations.
  type Op = { kind: 'eq' | 'sub'; a?: string; b?: string };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'eq', a: a[i - 1], b: b[j - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ kind: 'sub', a: a[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'sub', b: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ kind: 'sub', a: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ kind: 'sub', b: b[j - 1] }); j--; }
  ops.reverse();

  // Group consecutive sub ops into phrase pairs.
  let bufA: string[] = [];
  let bufB: string[] = [];
  const flush = () => {
    const o = bufA.join(' ').trim();
    const c = bufB.join(' ').trim();
    if (o && c && o !== c && o.length < 80 && c.length < 80) {
      const key = o;
      const existing = pairs.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        pairs.set(key, { original: o, corrected: c, count: 1 });
      }
    }
    bufA = [];
    bufB = [];
  };
  for (const op of ops) {
    if (op.kind === 'eq') {
      flush();
    } else {
      if (op.a) bufA.push(op.a);
      if (op.b) bufB.push(op.b);
    }
  }
  flush();

  return Array.from(pairs.values()).sort((x, y) => y.count - x.count);
}

/**
 * Apply a list of (raw → corrected) pairs to a profile as learned corrections.
 * Returns the number of pairs accepted.
 */
export function bulkTrainProfile(profileId: string, pairs: BulkTrainingPair[]): number {
  let accepted = 0;
  for (const p of pairs) {
    if (!p.original || !p.corrected || p.original === p.corrected) continue;
    addProfileCorrection(profileId, {
      original: p.original,
      corrected: p.corrected,
      frequency: Math.max(1, p.count),
      engine: 'bulk',
      category: p.original.includes(' ') || p.corrected.includes(' ') ? 'phrase' : 'word',
      confidence: Math.min(1, 0.6 + p.count * 0.1),
      lastUsed: Date.now(),
      createdAt: Date.now(),
    });
    accepted += 1;
  }
  return accepted;
}

// ─── Export / Import a profile (JSON) ──────────────────────────────
export interface ProfileExport {
  version: 1 | 2;
  profile: PronunciationProfile;
  corrections: CorrectionEntry[];
  verified: ProfileVerifiedRecord[];
  approved: string[];
  highlights: Record<string, WordHighlight>;
  samples?: ProfileLearningSample[];
}

export function exportProfile(id: string): string | null {
  const profile = getProfile(id);
  if (!profile) return null;
  const payload: ProfileExport = {
    version: 2,
    profile,
    corrections: getProfileCorrections(id),
    verified: getProfileVerified(id),
    approved: getProfileApproved(id),
    highlights: getProfileHighlights(id),
    samples: getProfileLearningSamples(id),
  };
  return JSON.stringify(payload, null, 2);
}

export function importProfile(json: string): PronunciationProfile {
  const data = JSON.parse(json) as ProfileExport;
  if (!data.profile?.name) throw new Error('JSON אינו תקף — חסר שם פרופיל');
  // New id every import to avoid collisions.
  const profile = createProfile(
    data.profile.name + ' (יובא)',
    data.profile.description
  );
  if (Array.isArray(data.corrections)) saveProfileCorrections(profile.id, data.corrections);
  if (Array.isArray(data.verified)) writeJSON(profileKey(profile.id, 'verified'), data.verified);
  if (Array.isArray(data.approved)) writeJSON(profileKey(profile.id, 'approved'), data.approved);
  if (data.highlights && typeof data.highlights === 'object') {
    writeJSON(profileKey(profile.id, 'highlights'), data.highlights);
  }
  if (Array.isArray(data.samples)) {
    writeJSON(profileKey(profile.id, 'samples'), data.samples.slice(0, MAX_PROFILE_SAMPLES));
  }
  return profile;
}

// ─── Bulk export / aggregate stats ────────────────────────────────────
export interface ProfileBundleExport {
  version: 1;
  exportedAt: number;
  profiles: ProfileExport[];
}

export function exportAllProfiles(): string {
  const all: ProfileExport[] = [];
  for (const p of listProfiles()) {
    const json = exportProfile(p.id);
    if (json) all.push(JSON.parse(json) as ProfileExport);
  }
  const bundle: ProfileBundleExport = {
    version: 1,
    exportedAt: Date.now(),
    profiles: all,
  };
  return JSON.stringify(bundle, null, 2);
}

export function importBundle(json: string): { imported: number; errors: string[] } {
  const errors: string[] = [];
  let imported = 0;
  let data: any;
  try { data = JSON.parse(json); } catch (e: any) {
    return { imported: 0, errors: [`JSON שגוי: ${e?.message || e}`] };
  }
  // Accept either bundle or single export.
  const items: ProfileExport[] = Array.isArray(data?.profiles)
    ? data.profiles
    : (data?.profile ? [data as ProfileExport] : []);
  if (items.length === 0) {
    return { imported: 0, errors: ['לא נמצאו פרופילים בקובץ'] };
  }
  for (const item of items) {
    try {
      importProfile(JSON.stringify(item));
      imported += 1;
    } catch (e: any) {
      errors.push(`${item?.profile?.name || '?'}: ${e?.message || e}`);
    }
  }
  return { imported, errors };
}

export interface ProfileSummaryStats {
  profileId: string;
  profileName: string;
  corrections: number;
  verified: number;
  approved: number;
  highlights: number;
  samples: number;
  avgConfidence: number;
}

export function getAllProfileStats(): ProfileSummaryStats[] {
  return listProfiles().map((p) => {
    const corrections = getProfileCorrections(p.id);
    const verified = getProfileVerified(p.id);
    const approved = getProfileApproved(p.id);
    const highlights = getProfileHighlights(p.id);
    const samples = getProfileLearningSamples(p.id);
    const avg = corrections.length > 0
      ? corrections.reduce((s, c) => s + (c.confidence ?? 0.5), 0) / corrections.length
      : 0;
    return {
      profileId: p.id,
      profileName: p.name,
      corrections: corrections.length,
      verified: verified.length,
      approved: approved.length,
      highlights: Object.keys(highlights).length,
      samples: samples.length,
      avgConfidence: avg,
    };
  });
}

