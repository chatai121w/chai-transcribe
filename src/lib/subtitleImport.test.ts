import { describe, it, expect } from 'vitest';
import {
  parseSubtitleFile,
  cuesToWordTimings,
  importSubtitles,
  isSubtitleFilename,
} from './subtitleImport';

const SAMPLE = `1
00:00:05,844 --> 00:00:20,173
בעזרת השם יתברך, נלמד היום דף ג', הסוגיה של עקירת גופו.

2
00:00:21,895 --> 00:01:11,087
השאלה של רב, כשמישהו עומד ברשות הרבים והטעינו חברו אוכלין ומשקין.
`;

const WITH_PROMO = `1
00:00:00,000 --> 00:00:04,000
תומלל באמצעות אלף בוט - מערכת מתקדמת לתמלול שיעורי תורה - https://alef-bot.top

2
00:00:05,000 --> 00:00:09,000
בעזרת השם יתברך, נלמד היום דף ג'.
`;

describe('ייבוא קובץ כתוביות', () => {
  it('קורא קטעים וזמנים נכון', () => {
    const { cues } = parseSubtitleFile(SAMPLE);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(5.844, 3);
    expect(cues[0].end).toBeCloseTo(20.173, 3);
    expect(cues[0].text).toContain('בעזרת השם יתברך');
  });

  it('מדלג על שורת הפרסומת של שירות התמלול ומדווח', () => {
    const { cues, warnings } = parseSubtitleFile(WITH_PROMO);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toContain('בעזרת השם');
    expect(warnings.join(' ')).toContain('פרסומת');
  });

  it('קורא גם תסדיר WebVTT', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
שלום עולם
`;
    const { cues } = parseSubtitleFile(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBeCloseTo(1, 2);
    expect(cues[0].text).toBe('שלום עולם');
  });

  it('מפזר כל קטע על פני המילים שבו', () => {
    const { cues } = parseSubtitleFile(SAMPLE);
    const words = cuesToWordTimings(cues);
    expect(words.length).toBeGreaterThan(10);
    expect(words[0].word).toBe('בעזרת');
    expect(words[0].start).toBeCloseTo(5.844, 2);
  });

  it('המילים רצופות בזמן ולא חופפות', () => {
    const words = cuesToWordTimings(parseSubtitleFile(SAMPLE).cues);
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start - 0.001);
      expect(words[i].end).toBeGreaterThanOrEqual(words[i].start);
    }
  });

  it('המילה האחרונה בקטע מסתיימת בדיוק בסוף הקטע', () => {
    const { cues } = parseSubtitleFile(SAMPLE);
    const words = cuesToWordTimings([cues[0]]);
    expect(words[words.length - 1].end).toBeCloseTo(cues[0].end, 3);
  });

  it('מתריע על קטעים חופפים', () => {
    const overlapping = `1
00:00:00,000 --> 00:00:10,000
ראשון

2
00:00:05,000 --> 00:00:15,000
שני
`;
    expect(parseSubtitleFile(overlapping).warnings.join(' ')).toContain('חופפים');
  });

  it('עמיד בקובץ ריק ובקובץ פגום', () => {
    expect(parseSubtitleFile('').cues).toHaveLength(0);
    expect(parseSubtitleFile('שטויות בלי זמנים').cues).toHaveLength(0);
    expect(parseSubtitleFile('').warnings.length).toBeGreaterThan(0);
  });

  it('עמיד בקטע שזמן ההתחלה והסיום שלו זהה', () => {
    const zero = `1
00:00:03,000 --> 00:00:03,000
מילה
`;
    const words = cuesToWordTimings(parseSubtitleFile(zero).cues);
    expect(words).toHaveLength(1);
    expect(words[0].start).toBeCloseTo(3, 2);
  });

  it('מחזיר את משך הכיסוי', () => {
    const res = importSubtitles(SAMPLE);
    expect(res.durationCovered).toBeCloseTo(71.087 - 5.844, 1);
  });

  it('מזהה שמות קבצים של כתוביות', () => {
    expect(isSubtitleFilename('שיעור.srt')).toBe(true);
    expect(isSubtitleFilename('שיעור.VTT')).toBe(true);
    expect(isSubtitleFilename('שיעור.mp3')).toBe(false);
    expect(isSubtitleFilename('שיעור.docx')).toBe(false);
  });
});
