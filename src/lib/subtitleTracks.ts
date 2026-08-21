import type { WordTiming } from "@/components/SyncAudioPlayer";
import { getTranslationLanguage } from "@/lib/translation";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";

export type TimedSubtitleSegment = { start: number; end: number; text: string };
export type SubtitleTrack = { language: string; label: string; segments: TimedSubtitleSegment[] };

function parseSubtitleTranslation(raw: string): Array<{ id: number; text: string }> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed)) throw new Error("מנוע התרגום לא החזיר מערך JSON");
  return parsed.map((item) => {
    const row = item as { id?: unknown; text?: unknown };
    if (!Number.isInteger(row.id) || typeof row.text !== "string" || !row.text.trim()) {
      throw new Error("מבנה תרגום הכתוביות אינו תקין");
    }
    return { id: Number(row.id), text: row.text.trim() };
  });
}

export async function translateSubtitleSegments(
  segments: TimedSubtitleSegment[],
  sourceLanguage: string,
  targetLanguage: string,
  model: string,
  onProgress: (percent: number) => Promise<void> = async () => undefined,
): Promise<TimedSubtitleSegment[]> {
  const target = getTranslationLanguage(targetLanguage);
  const translated = new Array<string>(segments.length);
  const batchSize = 24;
  const batchCount = Math.ceil(segments.length / batchSize);

  for (let offset = 0; offset < segments.length; offset += batchSize) {
    const rows = segments.slice(offset, offset + batchSize).map((segment, index) => ({ id: offset + index, text: segment.text }));
    const raw = await editTranscriptCloud({
      text: JSON.stringify(rows),
      action: "translate",
      customPrompt: [
        "You translate timed subtitle segments.",
        `Source language: ${sourceLanguage || "auto"}.`,
        `Target language: ${target.modelLabel} (${target.code}).`,
        "Return only a valid JSON array with exactly the same id values and one translated text for every item.",
        "Preserve names, religious terminology, punctuation and meaning. Do not merge, split, omit or reorder items.",
        'Required shape: [{"id":0,"text":"translated subtitle"}]',
      ].join("\n"),
      targetLanguage: `${target.modelLabel} (${target.code})`,
      model,
    });
    const result = parseSubtitleTranslation(raw);
    if (result.length !== rows.length) throw new Error(`חסרים מקטעים בתרגום ל${target.label}`);
    for (const row of result) {
      if (row.id < offset || row.id >= offset + rows.length) throw new Error("מזהה מקטע תרגום אינו תואם");
      translated[row.id] = row.text;
    }
    if (rows.some((row) => !translated[row.id])) throw new Error(`סדר המקטעים בתרגום ל${target.label} נפגע`);
    await onProgress(Math.round(((Math.floor(offset / batchSize) + 1) / batchCount) * 100));
  }
  return segments.map((segment, index) => ({ ...segment, text: translated[index] }));
}

export async function buildSubtitleTracks(
  segments: TimedSubtitleSegment[],
  sourceLanguage: string,
  languages: string[],
  model: string,
  onProgress: (percent: number) => Promise<void> = async () => undefined,
): Promise<SubtitleTrack[]> {
  const cleanSegments = segments.filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text.trim());
  if (!cleanSegments.length) throw new Error("לא נמצאו מקטעים מסונכרנים לכתוביות");
  const uniqueLanguages = [...new Set(languages)];
  const tracks: SubtitleTrack[] = [];
  for (let index = 0; index < uniqueLanguages.length; index++) {
    const language = uniqueLanguages[index];
    const languageInfo = getTranslationLanguage(language);
    const sameLanguage = language === sourceLanguage || (language === "he" && ["he", "iw"].includes(sourceLanguage));
    const trackSegments = sameLanguage
      ? cleanSegments
      : await translateSubtitleSegments(cleanSegments, sourceLanguage, language, model, async (batchPercent) => {
          await onProgress(Math.round(((index + batchPercent / 100) / uniqueLanguages.length) * 100));
        });
    tracks.push({ language, label: languageInfo.label, segments: trackSegments });
  }
  return tracks;
}

export function wordTimingsToSubtitleSegments(timings: WordTiming[]): TimedSubtitleSegment[] {
  const valid = timings.filter((word) => word.word.trim() && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
  const segments: TimedSubtitleSegment[] = [];
  for (let offset = 0; offset < valid.length;) {
    const words: WordTiming[] = [];
    const start = valid[offset].start;
    while (offset < valid.length && words.length < 9 && (valid[offset].end - start <= 4.5 || words.length < 3)) {
      words.push(valid[offset]);
      offset += 1;
      if (/[.!?…]$/.test(words[words.length - 1].word) && words.length >= 3) break;
    }
    segments.push({ start, end: words[words.length - 1].end, text: words.map((word) => word.word).join(" ") });
  }
  return segments;
}
