import { supabase } from '@/integrations/supabase/client';
import {
  getCloudSyncableTerms,
  mergeVocabularyFromExternal,
  normalizeVocabularyKey,
  type VocabularyApprovalStatus,
  type VocabularyCategory,
  type VocabularyEntry,
  type VocabularySource,
} from '@/utils/customVocabulary';

export interface TorahLexiconSyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

type CloudLexiconRow = {
  canonical_term: string;
  normalized_term: string;
  variants: string[] | null;
  category: string;
  pronunciation: string | null;
  context_tags: string[] | null;
  source: string;
  approval_status: string;
  confidence: number;
  usage_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function fromCloudRow(row: CloudLexiconRow): VocabularyEntry {
  return {
    term: row.canonical_term,
    variants: row.variants || [],
    category: row.category as VocabularyCategory,
    pronunciation: row.pronunciation || undefined,
    contextTags: row.context_tags || [],
    source: row.source as VocabularySource,
    approvalStatus: row.approval_status as VocabularyApprovalStatus,
    confidence: row.confidence,
    usageCount: row.usage_count,
    notes: row.notes || undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function syncTorahLexicon(): Promise<TorahLexiconSyncResult> {
  const result: TorahLexiconSyncResult = { pushed: 0, pulled: 0, errors: [] };
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) {
    result.errors.push('לא מחובר - המילון נשאר מקומי');
    return result;
  }

  const { data: cloudRows, error: pullError } = await (supabase as any)
    .from('torah_lexicon_terms')
    .select('canonical_term, normalized_term, variants, category, pronunciation, context_tags, source, approval_status, confidence, usage_count, notes, created_at, updated_at')
    .eq('user_id', userId);

  if (pullError) {
    result.errors.push(pullError.message);
    return result;
  }

  const remoteEntries = ((cloudRows || []) as CloudLexiconRow[]).map(fromCloudRow);
  result.pulled = mergeVocabularyFromExternal(remoteEntries);

  const localEntries = getCloudSyncableTerms();
  const rows = localEntries.map(entry => ({
    user_id: userId,
    canonical_term: entry.term,
    normalized_term: normalizeVocabularyKey(entry.term),
    variants: entry.variants,
    category: entry.category,
    pronunciation: entry.pronunciation || null,
    context_tags: entry.contextTags,
    source: entry.source === 'built-in' ? 'user' : entry.source,
    approval_status: entry.approvalStatus,
    confidence: entry.confidence,
    usage_count: entry.usageCount,
    notes: entry.notes || null,
    created_at: new Date(entry.createdAt).toISOString(),
    updated_at: new Date(entry.updatedAt).toISOString(),
  }));

  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    const { error } = await (supabase as any)
      .from('torah_lexicon_terms')
      .upsert(chunk, { onConflict: 'user_id,normalized_term' });
    if (error) result.errors.push(error.message);
    else result.pushed += chunk.length;
  }

  return result;
}

export async function deleteTorahLexiconTermFromCloud(term: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return;
  await (supabase as any)
    .from('torah_lexicon_terms')
    .delete()
    .eq('user_id', userId)
    .eq('normalized_term', normalizeVocabularyKey(term));
}

export async function clearTorahLexiconCloud(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return;
  await (supabase as any)
    .from('torah_lexicon_terms')
    .delete()
    .eq('user_id', userId);
}
