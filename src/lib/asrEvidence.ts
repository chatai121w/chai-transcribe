export type AsrEditClassification =
  | 'acoustic-word-correction'
  | 'possible-acoustic-edit'
  | 'editorial-change';

export interface AsrEditEvidenceInput {
  original: string;
  corrected: string;
  start?: number;
  end?: number;
}

export interface AsrEditEvidenceDecision {
  classification: AsrEditClassification;
  hasAcousticEvidence: boolean;
  requiresHumanReview: boolean;
  reason: string;
}

const lexicalTokens = (value: string): string[] =>
  value.trim().split(/\s+/).filter(Boolean);

const lettersAndDigits = (value: string): string =>
  value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Conservative classifier for saved edits. It never promotes an edit to Gold;
 * it only decides whether the edit is suitable for an audio-backed review.
 */
export function classifyAsrEdit(input: AsrEditEvidenceInput): AsrEditEvidenceDecision {
  const original = input.original.trim();
  const corrected = input.corrected.trim();
  const hasTiming = Number.isFinite(input.start) && Number.isFinite(input.end)
    && (input.end as number) > (input.start as number);

  if (!hasTiming) {
    return {
      classification: 'editorial-change',
      hasAcousticEvidence: false,
      requiresHumanReview: true,
      reason: 'No stable audio interval is attached to this edit.',
    };
  }

  const originalTokens = lexicalTokens(original);
  const correctedTokens = lexicalTokens(corrected);
  if (originalTokens.length === 1 && correctedTokens.length === 1) {
    if (lettersAndDigits(original) === lettersAndDigits(corrected)) {
      return {
        classification: 'editorial-change',
        hasAcousticEvidence: false,
        requiresHumanReview: true,
        reason: 'The change is punctuation or presentation only.',
      };
    }
    return {
      classification: 'acoustic-word-correction',
      hasAcousticEvidence: true,
      requiresHumanReview: true,
      reason: 'One lexical token was replaced inside a stable audio interval.',
    };
  }

  if (originalTokens.length <= 3 && correctedTokens.length <= 3) {
    return {
      classification: 'possible-acoustic-edit',
      hasAcousticEvidence: true,
      requiresHumanReview: true,
      reason: 'A short insertion, deletion, or phrase change needs listening review.',
    };
  }

  return {
    classification: 'editorial-change',
    hasAcousticEvidence: false,
    requiresHumanReview: true,
    reason: 'Structural or multi-word edits are not automatic ASR labels.',
  };
}
