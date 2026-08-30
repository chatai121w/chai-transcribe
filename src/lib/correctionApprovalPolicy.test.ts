import { describe, expect, it } from 'vitest';
import { decideCorrectionApproval } from './correctionApprovalPolicy';

describe('decideCorrectionApproval', () => {
  it('never applies a correction below the confidence threshold', () => {
    expect(decideCorrectionApproval({ mode: 'auto', confidence: 79, threshold: 80, occurrences: 9 })).toBe('queue');
  });

  it('requires repeated evidence in hybrid mode', () => {
    expect(decideCorrectionApproval({ mode: 'hybrid', confidence: 95, threshold: 80, occurrences: 1 })).toBe('queue');
    expect(decideCorrectionApproval({ mode: 'hybrid', confidence: 95, threshold: 80, occurrences: 2 })).toBe('apply');
  });

  it('keeps manual mode review-only regardless of score', () => {
    expect(decideCorrectionApproval({ mode: 'manual', confidence: 100, threshold: 80, occurrences: 20 })).toBe('queue');
  });
});
