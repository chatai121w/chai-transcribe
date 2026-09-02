import type { CorrectionEntry } from '@/utils/correctionLearning';

export type CorrectionScope = 'global' | 'profile';

export interface ScopedCorrectionEntry extends CorrectionEntry {
  scope: CorrectionScope;
  profileId?: string;
  schemaVersion: 2;
}

export const CORRECTIONS_V2_KEY = 'transcription_corrections_v2';
export const CORRECTIONS_LEGACY_KEY = 'transcription_corrections';
export const CORRECTIONS_MIGRATION_KEY = 'transcription_corrections_v2_migrated';
export const CORRECTIONS_CHANGED_EVENT = 'transcription-corrections-changed';

const PROFILE_INDEX_KEY = 'pp_profiles_index';
const MAX_CORRECTIONS = 5000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function scopedKey(entry: Pick<ScopedCorrectionEntry, 'scope' | 'profileId' | 'original' | 'corrected'>): string {
  return [entry.scope, entry.profileId || '', entry.original, entry.corrected].join('\u0001');
}

function normalizeEntry(
  entry: CorrectionEntry,
  scope: CorrectionScope,
  profileId?: string,
): ScopedCorrectionEntry {
  return {
    ...entry,
    scope,
    profileId: scope === 'profile' ? profileId : undefined,
    schemaVersion: 2,
  };
}

function dedupe(entries: ScopedCorrectionEntry[]): ScopedCorrectionEntry[] {
  const merged = new Map<string, ScopedCorrectionEntry>();
  for (const entry of entries) {
    if (!entry.original && !entry.corrected) continue;
    if (entry.scope === 'profile' && !entry.profileId) continue;
    const key = scopedKey(entry);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...entry, schemaVersion: 2 });
      continue;
    }
    merged.set(key, {
      ...existing,
      ...entry,
      id: existing.id ?? entry.id,
      frequency: Math.max(existing.frequency || 0, entry.frequency || 0) || 1,
      confidence: Math.max(existing.confidence || 0, entry.confidence || 0),
      createdAt: Math.min(existing.createdAt || Date.now(), entry.createdAt || Date.now()),
      lastUsed: Math.max(existing.lastUsed || 0, entry.lastUsed || 0),
      note: entry.note || existing.note,
      schemaVersion: 2,
    });
  }
  return [...merged.values()]
    .sort((a, b) => (b.confidence * b.frequency) - (a.confidence * a.frequency))
    .slice(0, MAX_CORRECTIONS);
}

function writeAll(entries: ScopedCorrectionEntry[]): void {
  localStorage.setItem(CORRECTIONS_V2_KEY, JSON.stringify(dedupe(entries)));
  try { window.dispatchEvent(new CustomEvent(CORRECTIONS_CHANGED_EVENT)); } catch { /* non-browser/test */ }
}

/**
 * One-time non-destructive migration. Legacy keys remain untouched as a rollback
 * backup; every active read and write uses only the v2 repository afterwards.
 */
export function migrateLegacyCorrections(): ScopedCorrectionEntry[] {
  const existingV2 = readJson<ScopedCorrectionEntry[]>(CORRECTIONS_V2_KEY, []);
  if (localStorage.getItem(CORRECTIONS_V2_KEY) !== null) return dedupe(existingV2);

  const migrated: ScopedCorrectionEntry[] = readJson<CorrectionEntry[]>(CORRECTIONS_LEGACY_KEY, [])
    .map((entry) => normalizeEntry(entry, 'global'));
  const profiles = readJson<Array<{ id?: string }>>(PROFILE_INDEX_KEY, []);
  for (const profile of profiles) {
    if (!profile.id) continue;
    const profileEntries = readJson<CorrectionEntry[]>(`pp_profile_${profile.id}_corrections`, []);
    migrated.push(...profileEntries.map((entry) => normalizeEntry(entry, 'profile', profile.id)));
  }
  writeAll(migrated);
  localStorage.setItem(CORRECTIONS_MIGRATION_KEY, JSON.stringify({
    migratedAt: new Date().toISOString(),
    globalCount: migrated.filter((entry) => entry.scope === 'global').length,
    profileCount: migrated.filter((entry) => entry.scope === 'profile').length,
    legacyKeysPreserved: true,
  }));
  return dedupe(migrated);
}

export function getAllScopedCorrections(): ScopedCorrectionEntry[] {
  return migrateLegacyCorrections();
}

export function getScopedCorrections(scope: CorrectionScope, profileId?: string): CorrectionEntry[] {
  return getAllScopedCorrections()
    .filter((entry) => entry.scope === scope && (scope === 'global' || entry.profileId === profileId))
    .map(({ scope: _scope, profileId: _profileId, schemaVersion: _schemaVersion, ...entry }) => entry);
}

export function replaceScopedCorrections(
  scope: CorrectionScope,
  entries: CorrectionEntry[],
  profileId?: string,
): void {
  if (scope === 'profile' && !profileId) throw new Error('profileId is required for profile corrections');
  const retained = getAllScopedCorrections().filter(
    (entry) => !(entry.scope === scope && (scope === 'global' || entry.profileId === profileId)),
  );
  writeAll([...retained, ...entries.map((entry) => normalizeEntry(entry, scope, profileId))]);
}

export function removeScopedCorrections(scope: CorrectionScope, profileId?: string): void {
  replaceScopedCorrections(scope, [], profileId);
}

export function exportScopedCorrections(): string {
  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    corrections: getAllScopedCorrections(),
  }, null, 2);
}
