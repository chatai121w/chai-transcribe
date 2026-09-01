import { describe, expect, it } from 'vitest';
import { decideAsrEscalation } from './asrEscalation';

describe('decideAsrEscalation', () => {
  it('keeps a high-confidence ordinary segment on one engine', () => {
    expect(decideAsrEscalation({ meanConfidence: 0.93, lowConfidenceFraction: 0.04 }).route)
      .toBe('accept-primary');
  });

  it('uses the stronger local model for moderate risk', () => {
    expect(decideAsrEscalation({
      meanConfidence: 0.68, lowConfidenceFraction: 0.35, terminologyRisk: 0.45,
    }).route).toBe('retry-local-full');
  });

  it('requests an external teacher only for concentrated high risk', () => {
    expect(decideAsrEscalation({
      meanConfidence: 0.35,
      lowConfidenceFraction: 0.8,
      terminologyRisk: 0.9,
      priorFailureRate: 0.8,
      localModelDisagreement: 0.7,
    }).route).toBe('request-teacher');
  });
});
