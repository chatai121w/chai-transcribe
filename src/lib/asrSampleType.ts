export type AsrSampleType = 'term-reading' | 'natural-speech' | 'scripted-reading' | 'other';

export const ASR_SAMPLE_TYPE_OPTIONS: Array<{
  value: AsrSampleType;
  label: string;
  description: string;
}> = [
  {
    value: 'term-reading',
    label: 'קריאת מושגים',
    description: 'בדיקת הגייה וזיהוי של מונחי היעד; Term Recall מחושב לפי הרשימה של ההקלטה.',
  },
  {
    value: 'natural-speech',
    label: 'דיבור טבעי',
    description: 'שיעור או דיבור חופשי; המדדים המרכזיים הם WER, CER, השמטות והזיות.',
  },
  {
    value: 'scripted-reading',
    label: 'הקראה מטקסט',
    description: 'טקסט ידוע שנקרא בקול; מתאים ל-Gold רק לאחר אימות שהנוסח תואם לאודיו.',
  },
  {
    value: 'other',
    label: 'אחר / טרם סווג',
    description: 'הקלטה שעדיין לא סווגה. אפשר להשוות, אך רצוי לסווג לפני שמירת Gold.',
  },
];

const TAG_PREFIX = 'asr-sample:';

export function asrSampleTypeTag(sampleType: AsrSampleType): string {
  return `${TAG_PREFIX}${sampleType}`;
}

export function asrSampleTypeLabel(sampleType: AsrSampleType): string {
  return ASR_SAMPLE_TYPE_OPTIONS.find((option) => option.value === sampleType)?.label || sampleType;
}

export function inferAsrSampleType(tags: string[] = [], label = ''): AsrSampleType {
  const tagged = tags.find((tag) => tag.startsWith(TAG_PREFIX))?.slice(TAG_PREFIX.length);
  if (ASR_SAMPLE_TYPE_OPTIONS.some((option) => option.value === tagged)) return tagged as AsrSampleType;

  const normalizedLabel = label.toLowerCase();
  if (/torah[-_ ]terms|term[-_ ]reading|קריאת מושגים/.test(normalizedLabel)) return 'term-reading';
  if (/natural[-_ ]speech|דיבור טבעי/.test(normalizedLabel)) return 'natural-speech';
  if (/scripted[-_ ]reading|read[-_ ]text|הקראה מטקסט/.test(normalizedLabel)) return 'scripted-reading';
  return 'other';
}

export function asrSampleSourceKind(sampleType: AsrSampleType): string {
  return `transcription-lab:${sampleType}`;
}
