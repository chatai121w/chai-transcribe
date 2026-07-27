import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyDefinitiveRulesToText,
  areDefinitiveRulesEnabled,
  setDefinitiveRulesEnabled,
} from './hebrewRuleEngine';

beforeEach(() => localStorage.clear());

describe('definitive Hebrew rules', () => {
  it('uses final letters at the end of Hebrew words', () => {
    expect(applyDefinitiveRulesToText('חוקיכ מצוותיכ').fixedText).toBe('חוקיך מצוותיך');
  });

  it('normalizes a misplaced final letter', () => {
    expect(applyDefinitiveRulesToText('םילה טובה').fixedText).toBe('מילה טובה');
  });

  it('normalizes spacing without applying uncertain spelling rules', () => {
    expect(applyDefinitiveRulesToText('שלום  עולם .').fixedText).toBe('שלום עולם.');
  });

  it('is enabled by default and can be disabled', () => {
    expect(areDefinitiveRulesEnabled()).toBe(true);
    setDefinitiveRulesEnabled(false);
    expect(areDefinitiveRulesEnabled()).toBe(false);
  });
});
