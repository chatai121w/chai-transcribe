/**
 * AI Alignment Review — ניתוח AI אחרי-תמלול
 *
 * שולח לטקסט הקנוני + ההיפותזה + מועמדי תיקון, ומבקש מ-Gemini להחזיר
 * רשימת alignments עם הסבר וביטחון, כדי לעזור להבין את החיבור הנכון.
 */

import { supabase } from '@/integrations/supabase/client';

export interface AiAlignment {
  hyp: string;
  ref: string;
  reason: string;
  ruleType: 'phonetic' | 'context' | 'homophone' | 'morphology' | 'spelling' | 'other';
  confidence: number; // 0-1
}

export interface AlignmentResponse {
  alignments: AiAlignment[];
  summary?: string;
}

const CACHE = new Map<string, AlignmentResponse>();

async function fingerprint(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runAiAlignmentReview(args: {
  refText: string;
  hypText: string;
  candidates: Array<{ wrong: string; correct: string }>;
}): Promise<AlignmentResponse> {
  const cacheKey = await fingerprint(`${args.refText}|${args.hypText}`);
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase.functions.invoke('ai-alignment-review', {
    body: {
      refText: args.refText.slice(0, 8000),
      hypText: args.hypText.slice(0, 8000),
      candidates: args.candidates.slice(0, 80),
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  const parsed: AlignmentResponse = {
    alignments: Array.isArray(data?.alignments) ? data.alignments : [],
    summary: typeof data?.summary === 'string' ? data.summary : undefined,
  };
  CACHE.set(cacheKey, parsed);
  return parsed;
}
