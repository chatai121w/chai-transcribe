/**
 * ייבוא קובץ כתוביות והפיכתו לתזמון ברמת המילה.
 *
 * למה צריך המרה: הנגן המסונכרן עובד עם WordTiming — זמן התחלה וסיום לכל
 * מילה בנפרד. קובץ כתוביות נותן קטעים שלמים, לרוב 30 עד 50 שניות כל אחד.
 * כאן הקטע מפוזר על פני המילים שבו.
 *
 * מגבלה שחשוב להכיר ולומר למשתמש: הפיזור הוא לפי אורך המילה בתווים, לא לפי
 * מה שנשמע בפועל. הסנכרון יהיה טוב ברמת המשפט ומשוער ברמת המילה הבודדת.
 * לדיוק אמיתי ברמת המילה צריך יישור אודיו, וזה דבר אחר לגמרי.
 */

export interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ImportedWordTiming {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleImportResult {
  cues: SubtitleCue[];
  words: ImportedWordTiming[];
  durationCovered: number;
  warnings: string[];
}

/** "00:01:12,789" → 72.789 */
function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/**
 * שורות שהן פרסומת של שירות התמלול ולא תוכן. אחד הקבצים שנבדקו פתח ב
 * "תומלל באמצעות ... - https://..." — שורה כזו תזהם גם את הצפייה וגם כל
 * מדידה שתיעשה על הטקסט.
 */
function isPromoLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/https?:\/\//i.test(t) && /תומלל|תמלול|מערכת/.test(t)) return true;
  if (/^תומלל באמצעות/.test(t)) return true;
  return false;
}

/** קורא קובץ כתוביות בתסדיר SRT או WebVTT. */
export function parseSubtitleFile(raw: string): { cues: SubtitleCue[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { cues: [], warnings: ['הקובץ ריק'] };

  const body = text.startsWith('WEBVTT') ? text.replace(/^WEBVTT[^\n]*\n/, '') : text;
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());

  const cues: SubtitleCue[] = [];
  let skippedPromo = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIndex < 0) continue;

    const [fromRaw, toRaw] = lines[timeLineIndex].split('-->');
    const start = parseTimestamp(fromRaw || '');
    // חשוב לקצץ לפני הפיצול: החלק שאחרי החץ מתחיל ברווח, ופיצול על רווחים
    // בלי קיצוץ מחזיר מחרוזת ריקה כאיבר הראשון — וכל הקטעים נפסלים בשקט.
    // בתסדיר WebVTT יכולים להופיע כאן גם מאפייני מיקום אחרי הזמן.
    const end = parseTimestamp((toRaw || '').trim().split(/\s+/)[0] || '');
    if (start === null || end === null) {
      warnings.push(`זמן לא תקין בקטע: ${lines[timeLineIndex].slice(0, 40)}`);
      continue;
    }

    const content = lines.slice(timeLineIndex + 1).join(' ').trim();
    if (!content) continue;
    if (isPromoLine(content)) {
      skippedPromo += 1;
      continue;
    }

    cues.push({ index: cues.length + 1, start, end, text: content });
  }

  if (skippedPromo) {
    warnings.push(`דולגו ${skippedPromo} שורות פרסומת של שירות התמלול`);
  }
  if (!cues.length) warnings.push('לא נמצא אף קטע תקין בקובץ');

  // קטעים חופפים או לא מסודרים מבלבלים את הנגן — מסדרים ומתריעים
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end - 0.05) overlaps += 1;
  }
  if (overlaps) warnings.push(`${overlaps} קטעים חופפים בזמן`);

  return { cues: sorted.map((c, i) => ({ ...c, index: i + 1 })), warnings };
}

/** מפזר כל קטע על פני המילים שבו, לפי אורך המילה בתווים. */
export function cuesToWordTimings(cues: SubtitleCue[]): ImportedWordTiming[] {
  const out: ImportedWordTiming[] = [];

  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const span = Math.max(0, cue.end - cue.start);
    if (span <= 0) {
      for (const word of words) out.push({ word, start: cue.start, end: cue.start });
      continue;
    }

    // משקל לפי אורך — מילה ארוכה נאמרת לאורך זמן רב יותר. קירוב גס אך
    // טוב בהרבה מחלוקה שווה, במיוחד בעברית שבה אורכי המילים משתנים מאוד.
    const weights = words.map((w) => Math.max(1, w.replace(/[^֐-׿A-Za-z0-9]/g, '').length));
    const total = weights.reduce((a, b) => a + b, 0);

    let cursor = cue.start;
    words.forEach((word, i) => {
      const slice = (weights[i] / total) * span;
      const start = cursor;
      const end = i === words.length - 1 ? cue.end : cursor + slice;
      out.push({ word, start, end });
      cursor = end;
    });
  }

  return out;
}

/** קורא קובץ כתוביות ומחזיר הכל מוכן לנגן. */
export function importSubtitles(raw: string): SubtitleImportResult {
  const { cues, warnings } = parseSubtitleFile(raw);
  const words = cuesToWordTimings(cues);
  const durationCovered = cues.length ? cues[cues.length - 1].end - cues[0].start : 0;
  return { cues, words, durationCovered, warnings };
}

/** האם שם הקובץ נראה כמו קובץ כתוביות. */
export function isSubtitleFilename(name: string): boolean {
  return /\.(srt|vtt|webvtt)$/i.test(name.trim());
}
