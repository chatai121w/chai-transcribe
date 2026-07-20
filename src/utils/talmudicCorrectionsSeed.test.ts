import { beforeEach, describe, expect, it } from 'vitest';
import { applyLearnedCorrections, getAllCorrections } from './correctionLearning';
import { seedTalmudicCorrections } from './talmudicCorrectionsSeed';

beforeEach(() => localStorage.clear());

describe('Talmudic correction seed', () => {
  it('normalizes new ASR variants of Rav Hai Gaon and Bava Batra', () => {
    seedTalmudicCorrections();

    const result = applyLearnedCorrections(
      'ורישמע בשם רב היגאון כי דאמר בברבטרה',
    );

    expect(result.text).toBe('ורישמע בשם רב האי גאון כי דאמר בבא בתרא');
    expect(result.appliedCount).toBe(2);
  });

  it('does not duplicate the seed during the same version', () => {
    expect(seedTalmudicCorrections()).toBeGreaterThan(0);
    const count = getAllCorrections().length;
    expect(seedTalmudicCorrections()).toBe(0);
    expect(getAllCorrections()).toHaveLength(count);
  });
});
