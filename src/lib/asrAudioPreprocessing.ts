import type { EnhancementPreset } from '@/lib/audioEnhancement';

export type AsrAudioPreprocessingMode = 'off' | 'shared' | 'compare';

export const ASR_AUDIO_PREPROCESSING_MODES: Array<{
  value: AsrAudioPreprocessingMode;
  label: string;
  description: string;
}> = [
  {
    value: 'off',
    label: 'ללא עיבוד',
    description: 'A ו-B מקבלים את קובץ המקור ללא שינוי.',
  },
  {
    value: 'shared',
    label: 'עיבוד זהה לשניהם',
    description: 'האודיו מעובד פעם אחת, ואותו קובץ משופר נשלח ל-A ול-B.',
  },
  {
    value: 'compare',
    label: 'מקור מול משופר',
    description: 'A מקבל את המקור ו-B את המשופר; המנוע, המודל וצינור הידע ננעלים לזהים.',
  },
];

export const ASR_AUDIO_PRESET_OPTIONS: Array<{
  value: EnhancementPreset;
  label: string;
  description: string;
}> = [
  { value: 'ai_transcription', label: 'מותאם לתמלול', description: 'ברירת המחדל המומלצת לדיבור ותמלול.' },
  { value: 'clean', label: 'ניקוי עדין', description: 'ניקוי שמרני עם פחות שינוי בקול.' },
  { value: 'ai_denoise', label: 'ניקוי רעש AI', description: 'מיועד לרעש רקע מורגש.' },
  { value: 'ai_hebrew', label: 'דיבור עברי', description: 'עיבוד המותאם לקול ולדיבור בעברית.' },
];

export interface AsrAudioComparisonPlan {
  baselineInput: 'original' | 'processed';
  candidateInput: 'original' | 'processed';
  isolateAudioChange: boolean;
}

export function buildAsrAudioComparisonPlan(mode: AsrAudioPreprocessingMode): AsrAudioComparisonPlan {
  if (mode === 'shared') {
    return { baselineInput: 'processed', candidateInput: 'processed', isolateAudioChange: false };
  }
  if (mode === 'compare') {
    return { baselineInput: 'original', candidateInput: 'processed', isolateAudioChange: true };
  }
  return { baselineInput: 'original', candidateInput: 'original', isolateAudioChange: false };
}
