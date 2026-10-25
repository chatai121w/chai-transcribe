import { describe, it, expect } from 'vitest';
import { segmentsToVtt, srtTextToVtt } from './subtitleVtt';

const NL = '\n';

describe('בניית קובץ הכתוביות לדפדפן', () => {
  it('מתחיל בכותרת שהדפדפן דורש', () => {
    // בלי השורה הזאת הדפדפן פוסל את הקובץ כולו ולא מציג כלום.
    expect(segmentsToVtt([{ start: 0, end: 1, text: 'שלום' }]).startsWith('WEBVTT')).toBe(true);
  });

  it('משתמש בנקודה ולא בפסיק בשברי השנייה', () => {
    // זה ההבדל היחיד שנראה לעין מול הפורמט השני, והוא מה שמפיל.
    const out = segmentsToVtt([{ start: 1.5, end: 2.25, text: 'א' }]);
    expect(out).toContain('00:00:01.500 --> 00:00:02.250');
    expect(out).not.toContain(',500');
  });

  it('כותב שעות גם כשהן אפס', () => {
    expect(segmentsToVtt([{ start: 0, end: 1, text: 'א' }])).toContain('00:00:00.000');
  });

  it('מטפל בזמנים ארוכים', () => {
    const out = segmentsToVtt([{ start: 3661.123, end: 3662, text: 'א' }]);
    expect(out).toContain('01:01:01.123');
  });

  it('מאחד שורות בתוך קטע', () => {
    // שורה ריקה בתוך קטע מסיימת אותו מבחינת הדפדפן.
    const out = segmentsToVtt([{ start: 0, end: 1, text: 'שורה' + NL + 'שנייה' }]);
    expect(out).toContain('שורה שנייה');
  });

  it('מסנן קטע שזמן הסיום שלו אינו אחרי ההתחלה', () => {
    // קטע כזה אינו מוצג, ועדיף לא לכתוב אותו מאשר קובץ שנראה תקין.
    const out = segmentsToVtt([
      { start: 0, end: 1, text: 'טוב' },
      { start: 5, end: 5, text: 'אפס אורך' },
      { start: 9, end: 8, text: 'הפוך' },
    ]);
    expect(out).toContain('טוב');
    expect(out).not.toContain('אפס אורך');
    expect(out).not.toContain('הפוך');
  });

  it('מסנן קטע בלי טקסט', () => {
    const out = segmentsToVtt([{ start: 0, end: 1, text: '   ' }]);
    expect(out).not.toContain('-->');
  });

  it('ממספר את הקטעים לפי מה שנשאר', () => {
    const out = segmentsToVtt([
      { start: 0, end: 1, text: 'א' },
      { start: 2, end: 2, text: 'נפסל' },
      { start: 3, end: 4, text: 'ב' },
    ]);
    const numbers = out.split(NL).filter((l) => /^\d+$/.test(l));
    expect(numbers).toEqual(['1', '2']);
  });
});

describe('המרה מהפורמט השני', () => {
  it('מוסיף כותרת ומחליף פסיק בנקודה', () => {
    const srt = '1' + NL + '00:00:01,000 --> 00:00:02,500' + NL + 'שלום';
    const out = srtTextToVtt(srt);
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).toContain('00:00:01.000 --> 00:00:02.500');
  });

  it('אינו מכפיל כותרת לקובץ שכבר תקין', () => {
    const vtt = 'WEBVTT' + NL + NL + '00:00:01.000 --> 00:00:02.000' + NL + 'שלום';
    expect(srtTextToVtt(vtt).split('WEBVTT').length - 1).toBe(1);
  });

  it('מסיר את סימון הקידוד שבתחילת הקובץ', () => {
    const srt = '﻿1' + NL + '00:00:01,000 --> 00:00:02,000' + NL + 'שלום';
    expect(srtTextToVtt(srt).startsWith('WEBVTT')).toBe(true);
  });
});
