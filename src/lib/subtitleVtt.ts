/**
 * המרת קטעי תמלול לפורמט הכתוביות של הדפדפן.
 *
 * למה זה קיים: לתגית הכתוביות של הדפדפן אפשר להזין **פורמט אחד
 * בלבד** — WebVTT. קובץ srt נראה כמעט זהה (ההבדל היחיד הנראה לעין
 * הוא פסיק במקום נקודה בשברי השנייה), ולכן קל מאוד לטעות ולהזין
 * אותו. הדפדפן לא יתלונן, לא יזרוק שגיאה, ופשוט לא יציג כלום.
 *
 * זה בדיוק מה שקרה כאן: רכיב הצפייה הזין קובץ srt לתגית, והציג
 * למשתמש כפתור כתוביות שלא עשה כלום.
 *
 * שלושה הבדלים שחייבים לטפל בהם:
 *
 *  1. כותרת `WEBVTT` בתחילת הקובץ. בלעדיה הדפדפן פוסל את הכל.
 *  2. נקודה ולא פסיק בשברי השנייה.
 *  3. השעות חובה בכל חותמת זמן.
 */

export interface VttSegment {
  start: number;
  end: number;
  text: string;
}

function stamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

/**
 * בונה את תוכן קובץ הכתוביות.
 *
 * קטע שזמן הסיום שלו אינו אחרי זמן ההתחלה אינו מוצג בדפדפן כלל,
 * ולכן הוא מסונן כאן במקום לצאת קובץ שנראה תקין ואינו עובד.
 */
export function segmentsToVtt(segments: VttSegment[]): string {
  const clean = segments.filter(
    (s) => Number.isFinite(s.start) && Number.isFinite(s.end)
      && s.end > s.start && (s.text || "").trim());

  const blocks = clean.map((s, index) => {
    // שורה חדשה בתוך הטקסט מסיימת את הקטע מבחינת הדפדפן, ולכן
    // הטקסט מאוחד לשורה אחת.
    const text = s.text.replace(/\r?\n+/g, " ").trim();
    return `${index + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${text}`;
  });

  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/**
 * מחזיר כתובת זמנית לקובץ הכתוביות, לשימוש בתגית של הדפדפן.
 *
 * הכתובת תופסת זיכרון עד שמשחררים אותה, ולכן מי שקורא חייב לשחרר
 * כשהרכיב יורד מהמסך.
 */
export function createVttUrl(segments: VttSegment[]): string | null {
  const content = segmentsToVtt(segments);
  // קובץ בלי אף קטע מכיל רק את הכותרת. אין טעם להציג כפתור
  // כתוביות שפותח רשימה ריקה.
  if (!content.includes("-->")) return null;
  return URL.createObjectURL(new Blob([content], { type: "text/vtt" }));
}

/** ממיר תוכן של קובץ srt לפורמט שהדפדפן מבין. */
export function srtTextToVtt(raw: string): string {
  const body = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2")
    .trim();
  return body.startsWith("WEBVTT") ? `${body}\n` : `WEBVTT\n\n${body}\n`;
}
