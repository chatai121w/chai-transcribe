import { describe, expect, it } from 'vitest';
import sharedDefaults from '../../shared/hebrew_transcription_defaults.json';
import {
  DEFAULT_LOSHON_KODESH_HOTWORDS,
  DEFAULT_LOSHON_KODESH_PROMPT,
} from './loshonKodesh';

describe('shared Hebrew transcription defaults', () => {
  it('uses the shared prompt and hotword list without a client-side copy', () => {
    expect(DEFAULT_LOSHON_KODESH_PROMPT).toBe(sharedDefaults.loshonKodeshPrompt);
    expect(DEFAULT_LOSHON_KODESH_HOTWORDS).toEqual(sharedDefaults.loshonKodeshHotwords);
  });

  it('contains no duplicate canonical terms', () => {
    expect(new Set(sharedDefaults.loshonKodeshHotwords).size)
      .toBe(sharedDefaults.loshonKodeshHotwords.length);
    expect(new Set(sharedDefaults.hebrewDefaultHotwords).size)
      .toBe(sharedDefaults.hebrewDefaultHotwords.length);
  });
});
