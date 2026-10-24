import { describe, it, expect } from 'vitest';
import { normalizeAshkenazi } from './ashkenaziNormalize';

const out = (s: string) => normalizeAshkenazi(s).text;

describe('נרמול הגייה אשכנזית', () => {
  it('מתקן מילים שלמות מהרשימה הסגורה', () => {
    expect(out('שאבעס')).toBe('שבת');
    expect(out('גמורא')).toBe('גמרא');
    expect(out('תוירה')).toBe('תורה');
    expect(out('אמעס')).toBe('אמת');
    expect(out('מוישה')).toBe('משה');
  });

  it('מתקן גם כשיש תחילית עברית', () => {
    expect(out('והתוירה')).toBe('והתורה');
    expect(out('בשאבעס')).toBe('בשבת');
    expect(out('מהגמורא')).toBe('מהגמרא');
  });

  it('מתקן חולם אשכנזי בתוך מילה', () => {
    expect(out('חוידש')).toBe('חודש');
    expect(out('פוילין')).toBe('פולין');
  });

  it('מתקן בתוך משפט שלם ומשאיר את השאר', () => {
    expect(out('ואמר בשאבעס שהתוירה אמעס'))
      .toBe('ואמר בשבת שהתורה אמת');
  });

  // ── החלק החשוב: שהכלי לא ישבור עברית תקנית ──

  it('אינו נוגע במילים עבריות תקניות', () => {
    const clean = [
      'שלום', 'תורה', 'גמרא', 'שבת', 'אמת', 'חודש', 'הפוסקים',
      'מסכת', 'הלכה', 'רבי', 'משנה', 'תוספות', 'ישיבה',
    ];
    for (const w of clean) expect(out(w)).toBe(w);
  });

  it('אינו שובר מילים שמכילות רצף דומה כחלק תקני', () => {
    const protectedWords = [
      'אויר', 'גוי', 'ראוי', 'מצוי', 'גלוי', 'בנוי', 'עשוי',
      'תלוי', 'צפוי', 'רצוי', 'שוויון',
    ];
    for (const w of protectedWords) expect(out(w)).toBe(w);
  });

  it('אינו משנה משפט עברי רגיל לחלוטין', () => {
    const sentence =
      'בתחילת השיעור אנחנו עוסקים בהגדרות וביסודות הלמדניים של הסוגיה';
    expect(out(sentence)).toBe(sentence);
  });

  it('אינו נוגע בספרות, בסימני פיסוק ובמילים לועזיות', () => {
    expect(out('דף 12, עמוד ב')).toBe('דף 12, עמוד ב');
    expect(out('ראה Rashi שם')).toBe('ראה Rashi שם');
  });

  it('מדווח מה שונה ולפי איזה כלל', () => {
    const res = normalizeAshkenazi('בשאבעס למדנו תוירה');
    expect(res.changes).toHaveLength(2);
    expect(res.changes[0].from).toBe('בשאבעס');
    expect(res.changes[0].to).toBe('בשבת');
    expect(res.changes[0].rule).toContain('סגול');
  });

  it('אינו מדווח שינויים כשאין מה לשנות', () => {
    expect(normalizeAshkenazi('שלום עולם').changes).toHaveLength(0);
  });

  it('עמיד בטקסט ריק ובערך חסר', () => {
    expect(out('')).toBe('');
    expect(normalizeAshkenazi(null as unknown as string).text).toBe('');
  });

  it('הפעלה חוזרת אינה משנה את התוצאה', () => {
    const once = out('בשאבעס למדנו תוירה');
    expect(out(once)).toBe(once);
  });
});
