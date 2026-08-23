import { useCallback, useMemo } from 'react';
import { useCloudPreferences } from '@/hooks/useCloudPreferences';
import { useOllama } from '@/hooks/useOllama';
import { editTranscriptCloud } from '@/utils/editTranscriptApi';
import {
  chooseTranscriptFormattingModel,
  preservesTranscriptWords,
  requiresExactWordPreservation,
} from '@/lib/transcriptFormatting';

export type TranscriptFormattingAction = 'fix_errors' | 'split_paragraphs' | 'fix_and_split';

export function useTranscriptFormatting() {
  const ollama = useOllama();
  const { preferences, patchTabSettings } = useCloudPreferences();
  const selections = useMemo<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(preferences.tab_settings_json || '{}');
      return parsed.aiTaskModels && typeof parsed.aiTaskModels === 'object' ? parsed.aiTaskModels : {};
    } catch { return {}; }
  }, [preferences.tab_settings_json]);

  const selected = useCallback((action: TranscriptFormattingAction) => selections[action] || 'auto', [selections]);
  const saveSelection = useCallback((action: TranscriptFormattingAction, model: string) => {
    patchTabSettings({ aiTaskModels: { ...selections, [action]: model } });
  }, [patchTabSettings, selections]);

  const run = useCallback(async (text: string, action: TranscriptFormattingAction): Promise<string> => {
    const selectedModel = selected(action);
    const useCloud = selectedModel.startsWith('cloud:') || (!ollama.isConnected && selectedModel === 'auto');
    let result: string;
    if (!useCloud && ollama.isConnected && ollama.models.length) {
      const model = selectedModel.startsWith('ollama:')
        ? selectedModel.slice('ollama:'.length)
        : chooseTranscriptFormattingModel(ollama.models);
      if (!model || !ollama.models.some((item) => item.name === model)) {
        throw new Error(`המנוע שנבחר אינו מותקן: ${model || selectedModel}`);
      }
      result = await ollama.editText({ text, action, model });
    } else {
      const model = selectedModel === 'auto' || selectedModel === 'cloud:auto'
        ? undefined
        : selectedModel.replace(/^cloud:/, '');
      result = await editTranscriptCloud({ text, action, model });
    }
    if (requiresExactWordPreservation(action) && !preservesTranscriptWords(text, result)) {
      throw new Error('התוצאה נפסלה כי המנוע שינה או השמיט מילים');
    }
    return result;
  }, [ollama, selected]);

  const options = useMemo(() => [
    { value: 'auto', label: 'מומלץ אוטומטית' },
    { value: 'cloud:auto', label: 'ענן אוטומטי' },
    { value: 'cloud:gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'cloud:gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ...ollama.models
      .filter((model) => !/embedding|translate/i.test(model.name))
      .map((model) => ({ value: `ollama:${model.name}`, label: model.name })),
  ], [ollama.models]);

  return { ...ollama, options, run, saveSelection, selected };
}
