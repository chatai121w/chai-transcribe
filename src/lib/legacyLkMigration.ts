import { getServerUrl } from '@/lib/serverConfig';
import { logPipelineEvent } from '@/lib/pipelineAudit';
import {
  getAllTerms,
  mergeVocabularyFromExternal,
  normalizeVocabularyKey,
  type VocabularyEntry,
} from '@/utils/customVocabulary';

interface LegacyLkDictionaryRow {
  spoken_form?: string;
  correct_form?: string;
  note?: string | null;
  count_applied?: number;
  created_at?: string;
}

export interface LegacyLkImportResult {
  found: number;
  imported: number;
  skipped: number;
}

export async function importLegacyLkDictionary(experimentId: string): Promise<LegacyLkImportResult> {
  const response = await fetch(`${getServerUrl()}/lk/dictionary`);
  if (!response.ok) throw new Error(`לא ניתן לקרוא את מילון לשון הקודש הישן (${response.status})`);
  const rows = await response.json() as LegacyLkDictionaryRow[];
  const existingKeys = new Set(getAllTerms().map((entry) => normalizeVocabularyKey(entry.term)));
  const now = Date.now();
  const entries: VocabularyEntry[] = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const term = String(row.correct_form || '').trim();
    const variant = String(row.spoken_form || '').trim();
    if (!term || !variant || normalizeVocabularyKey(term) === normalizeVocabularyKey(variant)) continue;
    entries.push({
      term,
      variants: [variant],
      category: 'other',
      usageCount: Math.max(0, Number(row.count_applied) || 0),
      createdAt: row.created_at ? new Date(row.created_at).getTime() || now : now,
      updatedAt: now,
      contextTags: ['לשון הקודש', 'ייבוא ישן'],
      source: 'import',
      approvalStatus: 'candidate',
      confidence: 0.6,
      notes: [row.note, 'יובא ממילון LK הישן - נדרש אישור לפני תיקון אוטומטי'].filter(Boolean).join(' · '),
    });
  }

  const imported = mergeVocabularyFromExternal(entries);
  const result = {
    found: Array.isArray(rows) ? rows.length : 0,
    imported,
    skipped: entries.filter((entry) => existingKeys.has(normalizeVocabularyKey(entry.term))).length,
  };
  await logPipelineEvent({
    experimentId,
    stage: 'lexicon',
    level: 'success',
    eventType: 'legacy-lk-imported',
    message: 'מילון לשון הקודש הישן יובא כמועמדים למילון המרכזי',
    details: result,
  });
  return result;
}

