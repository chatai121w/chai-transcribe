import { describe, it, expect } from "vitest";
import {
  wordsToRange,
  detectSentences,
  sentenceAtIndex,
  buildQuietEnvelope,
  speechLevel,
  findQuietPoint,
  snapRangeToQuiet,
  nudgeRange,
  type CutWord,
} from "./transcriptCut";

/** מילים לדוגמה: שני משפטים, עם שתיקה ביניהם. */
const WORDS: CutWord[] = [
  { word: "הכדירה", start: 0.00, end: 0.52 },
  { word: "חז״ל", start: 0.55, end: 0.98 },
  { word: "אסרו,", start: 1.02, end: 1.48 },
  { word: "אפילו", start: 1.52, end: 1.95 },
  { word: "לפגם.", start: 2.00, end: 2.60 },
  { word: "לא", start: 3.40, end: 3.62 },
  { word: "בשר", start: 3.65, end: 4.05 },
  { word: "ולא", start: 4.08, end: 4.40 },
  { word: "חלב.", start: 4.44, end: 4.95 },
];

/**
 * בונה אודיו מלאכותי: דיבור, שקט, דיבור.
 * קצב דגימה נמוך בכוונה — מספיק לבדיקה ומריץ מהר.
 */
function makeAudio(blocks: Array<{ seconds: number; amplitude: number }>, sampleRate = 1000) {
  const total = blocks.reduce((sum, b) => sum + Math.round(b.seconds * sampleRate), 0);
  const samples = new Float32Array(total);
  let cursor = 0;
  for (const block of blocks) {
    const count = Math.round(block.seconds * sampleRate);
    for (let i = 0; i < count; i += 1) {
      // סימן מתחלף, כדי שהעוצמה הממוצעת תהיה בדיוק המשרעת
      samples[cursor + i] = i % 2 === 0 ? block.amplitude : -block.amplitude;
    }
    cursor += count;
  }
  return { samples, sampleRate };
}

describe("סימון מילים הופך לטווח זמן", () => {
  it("מילה אחת נותנת את הזמנים שלה", () => {
    const range = wordsToRange(WORDS, 2, 2);
    expect(range).not.toBeNull();
    expect(range!.startSec).toBeCloseTo(1.02, 5);
    expect(range!.endSec).toBeCloseTo(1.48, 5);
  });

  it("כמה מילים נותנות מההתחלה של הראשונה עד הסוף של האחרונה", () => {
    const range = wordsToRange(WORDS, 0, 4);
    expect(range!.startSec).toBeCloseTo(0, 5);
    expect(range!.endSec).toBeCloseTo(2.6, 5);
  });

  it("סימון לאחור עובד בדיוק כמו סימון קדימה", () => {
    expect(wordsToRange(WORDS, 4, 0)).toEqual(wordsToRange(WORDS, 0, 4));
  });

  it("תוספת שוליים מרחיבה את שני הקצוות", () => {
    const range = wordsToRange(WORDS, 2, 2, { padSec: 0.1 });
    expect(range!.startSec).toBeCloseTo(0.92, 5);
    expect(range!.endSec).toBeCloseTo(1.58, 5);
  });

  it("השוליים לא יוצאים מגבולות הקובץ", () => {
    const range = wordsToRange(WORDS, 0, 8, { padSec: 1, durationSec: 5 });
    expect(range!.startSec).toBe(0);
    expect(range!.endSec).toBe(5);
  });

  it("התווית היא הטקסט שסומן", () => {
    expect(wordsToRange(WORDS, 5, 8)!.label).toBe("לא בשר ולא חלב.");
  });

  it("תווית ארוכה נקטעת", () => {
    const many: CutWord[] = Array.from({ length: 40 }, (_, i) => ({
      word: "מילה", start: i * 0.5, end: i * 0.5 + 0.4,
    }));
    const label = wordsToRange(many, 0, 39)!.label!;
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith("…")).toBe(true);
  });

  it("רשימה ריקה או אינדקס מחוץ לתחום מחזירים כלום", () => {
    expect(wordsToRange([], 0, 0)).toBeNull();
    expect(wordsToRange(WORDS, 50, 60)).toBeNull();
    expect(wordsToRange(WORDS, -5, -2)).toBeNull();
  });

  it("אינדקס חלקי מחוץ לתחום נחתך לגבולות הרשימה", () => {
    const range = wordsToRange(WORDS, 7, 99);
    expect(range!.startSec).toBeCloseTo(4.08, 5);
    expect(range!.endSec).toBeCloseTo(4.95, 5);
  });

  it("קטע קצר מדי לחיתוך מחזיר כלום", () => {
    const tiny: CutWord[] = [{ word: "א", start: 1, end: 1.01 }];
    expect(wordsToRange(tiny, 0, 0)).toBeNull();
  });

  it("זמנים לא תקינים מחזירים כלום", () => {
    const broken: CutWord[] = [{ word: "א", start: NaN, end: 2 }];
    expect(wordsToRange(broken, 0, 0)).toBeNull();
  });
});

describe("זיהוי משפטים", () => {
  it("מפצל לפי נקודה ולפי שתיקה ארוכה", () => {
    const sentences = detectSentences(WORDS);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe("הכדירה חז״ל אסרו, אפילו לפגם.");
    expect(sentences[1].text).toBe("לא בשר ולא חלב.");
  });

  it("המשפט הראשון מתחיל בהתחלה והאחרון נגמר בסוף", () => {
    const sentences = detectSentences(WORDS);
    expect(sentences[0].startIndex).toBe(0);
    expect(sentences[0].startSec).toBeCloseTo(0, 5);
    expect(sentences.at(-1)!.endIndex).toBe(WORDS.length - 1);
    expect(sentences.at(-1)!.endSec).toBeCloseTo(4.95, 5);
  });

  it("פסיק באמצע אינו מסיים משפט", () => {
    const sentences = detectSentences(WORDS);
    expect(sentences[0].text).toContain("אסרו,");
  });

  it("שתיקה ארוכה מפצלת גם בלי סימן פיסוק", () => {
    const words: CutWord[] = [
      { word: "אחת", start: 0, end: 0.4 },
      { word: "שתיים", start: 0.45, end: 0.9 },
      { word: "שלוש", start: 2.5, end: 2.9 },
    ];
    const sentences = detectSentences(words);
    expect(sentences).toHaveLength(2);
    expect(sentences[1].text).toBe("שלוש");
  });

  it("אפשר לשנות מה נחשב שתיקה ארוכה", () => {
    const words: CutWord[] = [
      { word: "אחת", start: 0, end: 0.4 },
      { word: "שתיים", start: 0.9, end: 1.3 },
    ];
    expect(detectSentences(words, { gapSec: 0.6 })).toHaveLength(1);
    expect(detectSentences(words, { gapSec: 0.4 })).toHaveLength(2);
  });

  it("סימן שאלה וסימן קריאה מסיימים משפט", () => {
    const words: CutWord[] = [
      { word: "למה?", start: 0, end: 0.4 },
      { word: "מצוין!", start: 0.45, end: 0.9 },
      { word: "נמשיך", start: 0.95, end: 1.4 },
    ];
    expect(detectSentences(words)).toHaveLength(3);
  });

  it("נקודה עם גרשיים אחריה מסיימת משפט", () => {
    const words: CutWord[] = [
      { word: 'אמר."', start: 0, end: 0.4 },
      { word: "והמשיך", start: 0.45, end: 0.9 },
    ];
    expect(detectSentences(words)).toHaveLength(2);
  });

  it("רשימה ריקה נותנת רשימה ריקה", () => {
    expect(detectSentences([])).toEqual([]);
  });

  it("מאתר לאיזה משפט מילה שייכת", () => {
    const sentences = detectSentences(WORDS);
    expect(sentenceAtIndex(sentences, 3)!.text).toContain("הכדירה");
    expect(sentenceAtIndex(sentences, 7)!.text).toBe("לא בשר ולא חלב.");
    expect(sentenceAtIndex(sentences, 99)).toBeNull();
  });
});

describe("מעטפת העוצמה", () => {
  it("שקט מוחלט נותן אפס", () => {
    const { samples, sampleRate } = makeAudio([{ seconds: 1, amplitude: 0 }]);
    const envelope = buildQuietEnvelope(samples, sampleRate);
    expect(Array.from(envelope.values).every((v) => v === 0)).toBe(true);
  });

  it("עוצמה קבועה נותנת בדיוק את המשרעת", () => {
    const { samples, sampleRate } = makeAudio([{ seconds: 1, amplitude: 0.5 }]);
    const envelope = buildQuietEnvelope(samples, sampleRate);
    expect(envelope.values[10]).toBeCloseTo(0.5, 4);
  });

  it("קצב החלונות תואם את אורך החלון שביקשנו", () => {
    const { samples, sampleRate } = makeAudio([{ seconds: 1, amplitude: 0.5 }]);
    const envelope = buildQuietEnvelope(samples, sampleRate, 0.01);
    expect(envelope.rate).toBeCloseTo(100, 5);
    expect(envelope.values.length).toBeCloseTo(100, 0);
  });

  it("אודיו ריק לא מפיל כלום", () => {
    const envelope = buildQuietEnvelope(new Float32Array(0), 16000);
    expect(envelope.values.length).toBe(0);
    expect(findQuietPoint(envelope, 1, "start")).toBe(1);
  });

  it("העוצמה האופיינית נמדדת לפי הדיבור ולא לפי השקט", () => {
    const { samples, sampleRate } = makeAudio([
      { seconds: 1, amplitude: 0.4 },
      { seconds: 0.3, amplitude: 0 },
      { seconds: 1, amplitude: 0.4 },
    ]);
    const envelope = buildQuietEnvelope(samples, sampleRate);
    expect(speechLevel(envelope)).toBeCloseTo(0.4, 3);
  });
});

describe("הצמדה לרגע השקט", () => {
  // דיבור שנייה, שקט 0.4 שנייה, דיבור שנייה. השקט הוא 1.0 עד 1.4.
  const audio = makeAudio([
    { seconds: 1.0, amplitude: 0.4 },
    { seconds: 0.4, amplitude: 0 },
    { seconds: 1.0, amplitude: 0.4 },
  ]);
  const envelope = buildQuietEnvelope(audio.samples, audio.sampleRate);

  it("זמן שנפל בתוך הדיבור נמשך אל השקט שליד", () => {
    const snapped = findQuietPoint(envelope, 1.12, "start", { windowSec: 0.3 });
    expect(snapped).toBeGreaterThanOrEqual(1.0);
    expect(snapped).toBeLessThanOrEqual(1.4);
  });

  it("החיתוך נשאר צמוד לזמן המקורי ולא נדחף לקצה החלון", () => {
    const snapped = findQuietPoint(envelope, 1.2, "start", { windowSec: 0.3 });
    // השקט נמשך מ-1.0 עד 1.4, והזמן המקורי 1.2 כבר בתוכו
    expect(Math.abs(snapped - 1.2)).toBeLessThan(0.1);
    expect(snapped).toBeGreaterThanOrEqual(1.0);
  });

  it("בקצה ההתחלה זזים מעט אחורה, בקצה הסיום מעט קדימה", () => {
    const start = findQuietPoint(envelope, 1.2, "start", { windowSec: 0.3 });
    const end = findQuietPoint(envelope, 1.2, "end", { windowSec: 0.3 });
    expect(start).toBeLessThan(1.2);
    expect(end).toBeGreaterThan(1.2);
  });

  it("זמן שנפל בתוך הדיבור נמשך אל גבול ההפסקה, לא אל אמצעה", () => {
    // 1.12 הוא בתוך השקט; נבדוק זמן שבאמת בתוך דיבור
    const snapped = findQuietPoint(envelope, 0.85, "end", { windowSec: 0.3 });
    expect(snapped).toBeGreaterThanOrEqual(1.0);
    expect(snapped).toBeLessThan(1.15);
  });

  it("רגע שקט קצרצר בתוך מילה אינו נחשב הפסקה", () => {
    // דיבור עם נתק של 20 אלפיות שנייה — כמו הרגע הסגור שלפני ב' או ת'
    const clicky = makeAudio([
      { seconds: 1.0, amplitude: 0.4 },
      { seconds: 0.02, amplitude: 0 },
      { seconds: 1.0, amplitude: 0.4 },
    ]);
    const env = buildQuietEnvelope(clicky.samples, clicky.sampleRate);
    expect(findQuietPoint(env, 1.05, "start", { windowSec: 0.3 })).toBe(1.05);
  });

  it("הפסקה ארוכה מספיק כן נחשבת", () => {
    const paused = makeAudio([
      { seconds: 1.0, amplitude: 0.4 },
      { seconds: 0.12, amplitude: 0 },
      { seconds: 1.0, amplitude: 0.4 },
    ]);
    const env = buildQuietEnvelope(paused.samples, paused.sampleRate);
    const snapped = findQuietPoint(env, 1.08, "start", { windowSec: 0.3 });
    expect(snapped).toBeGreaterThanOrEqual(1.0);
    expect(snapped).toBeLessThanOrEqual(1.12);
  });

  it("כשאין שקט בטווח, הזמן נשאר כמו שהיה", () => {
    const loud = makeAudio([{ seconds: 3, amplitude: 0.4 }]);
    const loudEnvelope = buildQuietEnvelope(loud.samples, loud.sampleRate);
    expect(findQuietPoint(loudEnvelope, 1.5, "start", { windowSec: 0.3 })).toBe(1.5);
  });

  it("שקט רחוק מהחלון לא מושך את החיתוך", () => {
    const snapped = findQuietPoint(envelope, 0.3, "start", { windowSec: 0.1 });
    expect(snapped).toBeCloseTo(0.3, 1);
  });

  it("חלון אפס מבטל את ההצמדה", () => {
    expect(findQuietPoint(envelope, 1.2, "start", { windowSec: 0 })).toBe(1.2);
  });

  it("שני הקצוות מוזזים יחד", () => {
    const quiet = makeAudio([
      { seconds: 0.3, amplitude: 0 },
      { seconds: 1.0, amplitude: 0.4 },
      { seconds: 0.4, amplitude: 0 },
      { seconds: 1.0, amplitude: 0.4 },
      { seconds: 0.3, amplitude: 0 },
    ]);
    const env = buildQuietEnvelope(quiet.samples, quiet.sampleRate);
    const snapped = snapRangeToQuiet({ startSec: 0.35, endSec: 1.25 }, env, { windowSec: 0.3 });
    expect(snapped.startSec).toBeLessThanOrEqual(0.35);
    expect(snapped.endSec).toBeGreaterThanOrEqual(1.25);
  });

  it("הצמדה לא הופכת את הטווח ולא מוחקת אותו", () => {
    const snapped = snapRangeToQuiet({ startSec: 1.15, endSec: 1.2 }, envelope, { windowSec: 0.3 });
    expect(snapped.endSec).toBeGreaterThan(snapped.startSec);
  });

  it("בלי מעטפת, הטווח חוזר כמו שהוא", () => {
    const empty = { values: new Float32Array(0), rate: 1 };
    const range = { startSec: 1, endSec: 2 };
    expect(snapRangeToQuiet(range, empty)).toEqual(range);
  });

  it("התווית נשמרת אחרי ההצמדה", () => {
    const snapped = snapRangeToQuiet({ startSec: 1.12, endSec: 1.9, label: "משפט" }, envelope);
    expect(snapped.label).toBe("משפט");
  });
});

describe("כוונון ידני של הקצוות", () => {
  const range = { startSec: 2, endSec: 5 };

  it("מזיז את ההתחלה אחורה וקדימה", () => {
    expect(nudgeRange(range, "start", -0.05, 10).startSec).toBeCloseTo(1.95, 5);
    expect(nudgeRange(range, "start", 0.05, 10).startSec).toBeCloseTo(2.05, 5);
  });

  it("מזיז את הסיום אחורה וקדימה", () => {
    expect(nudgeRange(range, "end", 0.05, 10).endSec).toBeCloseTo(5.05, 5);
    expect(nudgeRange(range, "end", -0.05, 10).endSec).toBeCloseTo(4.95, 5);
  });

  it("ההתחלה לא יורדת מתחת לאפס", () => {
    expect(nudgeRange({ startSec: 0.02, endSec: 5 }, "start", -1, 10).startSec).toBe(0);
  });

  it("הסיום לא עובר את אורך הקובץ", () => {
    expect(nudgeRange({ startSec: 2, endSec: 9.98 }, "end", 1, 10).endSec).toBe(10);
  });

  it("הקצוות לא עוברים אחד את השני", () => {
    expect(nudgeRange(range, "start", 99, 10).startSec).toBeLessThan(range.endSec);
    expect(nudgeRange(range, "end", -99, 10).endSec).toBeGreaterThan(range.startSec);
  });

  it("הקצה האחר לא זז", () => {
    expect(nudgeRange(range, "start", -0.05, 10).endSec).toBe(5);
    expect(nudgeRange(range, "end", 0.05, 10).startSec).toBe(2);
  });
});
