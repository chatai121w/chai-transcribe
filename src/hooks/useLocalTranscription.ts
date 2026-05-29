import { useState, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debugLogger';

// Lazy-load @huggingface/transformers — 879 kB, only when local browser transcription is actually used.
// Module-level cache so it's only imported once.
let _transformersPromise: Promise<typeof import('@huggingface/transformers')> | null = null;
async function getTransformers() {
  if (!_transformersPromise) {
    _transformersPromise = import('@huggingface/transformers').then(mod => {
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      return mod;
    });
  }
  return _transformersPromise;
}

// Check if WebGPU is available
const isWebGPUAvailable = async (): Promise<boolean> => {
  try {
    const nav = navigator as any;
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
};

// Get preferred model from localStorage
const getPreferredModel = () => {
  // First check for explicitly selected model
  const preferred = localStorage.getItem('preferred_local_model');
  if (preferred) return preferred;
  
  // Fallback to first downloaded model
  const downloaded = localStorage.getItem('downloaded_models');
  if (downloaded) {
    try {
      const models = JSON.parse(downloaded);
      if (models.length > 0) return models[0];
    } catch {
      // corrupted localStorage
    }
  }
  return "onnx-community/whisper-tiny";
};

// Module-level cache for loaded pipelines
const pipelineCache = new Map<string, any>();

export interface WordTimingResult {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  wordTimings: WordTimingResult[];
}

export const useLocalTranscription = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentModel, setCurrentModel] = useState<string | null>(null);

  const transcribe = async (file: File): Promise<TranscriptionResult> => {
    setIsLoading(true);
    setProgress(0);

    try {
      const modelId = getPreferredModel();
      setCurrentModel(modelId);
      const useGPU = await isWebGPUAvailable();
      const deviceLabel = useGPU ? 'WebGPU 🚀' : 'WASM';
      
      let transcriber = pipelineCache.get(modelId);
      
      if (!transcriber) {
        toast({
          title: "טוען מודל...",
          description: `${modelId.split('/').pop()} (${deviceLabel}). בפעם הבאה יהיה מהיר יותר!`,
        });

        setProgress(10);

        const { pipeline } = await getTransformers();
        transcriber = await pipeline(
          'automatic-speech-recognition',
          modelId,
          { 
            device: useGPU ? 'webgpu' : 'wasm',
            dtype: useGPU ? 'fp32' : 'q8',
            progress_callback: (p: any) => {
              if (p.status === 'progress' && p.total > 0) {
                const percent = Math.round((p.loaded / p.total) * 100);
                setProgress(Math.min(percent * 0.7, 70));
              }
            }
          }
        );

        // Cache the loaded pipeline for reuse
        pipelineCache.set(modelId, transcriber);
      } else {
        toast({
          title: "מתמלל...",
          description: `מודל ${modelId.split('/').pop()} מוכן (${deviceLabel})`,
        });
      }

      setProgress(75);

      toast({
        title: "מתמלל...",
        description: `מעבד עם ${deviceLabel}`,
      });

      const audioUrl = URL.createObjectURL(file);

      // Try word-level timestamps first; fall back to chunk-level if the model
      // wasn't exported with output_attentions=True (cross-attention required).
      let result: any;
      let usedWordTimestamps = true;
      try {
        result = await transcriber(audioUrl, {
          language: 'hebrew',
          task: 'transcribe',
          return_timestamps: 'word',
        });
      } catch (tsError: any) {
        if (tsError?.message?.includes('cross attentions') || tsError?.message?.includes('output_attentions')) {
          usedWordTimestamps = false;
          result = await transcriber(audioUrl, {
            language: 'hebrew',
            task: 'transcribe',
            return_timestamps: true,
          });
        } else {
          throw tsError;
        }
      } finally {
        URL.revokeObjectURL(audioUrl);
      }
      setProgress(100);

      const text = Array.isArray(result) ? result[0]?.text : result?.text;
      
      if (!text) {
        throw new Error('לא התקבל תמלול מהמודל');
      }

      // Extract timestamps from chunks (word-level or segment-level)
      const wordTimings: WordTimingResult[] = [];
      const chunks = Array.isArray(result) ? result[0]?.chunks : result?.chunks;
      if (chunks && Array.isArray(chunks)) {
        for (const chunk of chunks) {
          if (chunk.text && chunk.timestamp) {
            const [start, end] = chunk.timestamp;
            const words = chunk.text.trim().split(/\s+/);
            if (words.length === 1) {
              wordTimings.push({
                word: words[0],
                start: start ?? 0,
                end: end ?? start ?? 0,
              });
            } else {
              // Multiple words in chunk - distribute time evenly
              const chunkDuration = (end ?? start ?? 0) - (start ?? 0);
              const wordDuration = words.length > 0 ? chunkDuration / words.length : 0;
              words.forEach((w: string, j: number) => {
                if (w.trim()) {
                  wordTimings.push({
                    word: w.trim(),
                    start: (start ?? 0) + j * wordDuration,
                    end: (start ?? 0) + (j + 1) * wordDuration,
                  });
                }
              });
            }
          }
        }
      }

      if (!usedWordTimestamps) {
        debugLog.warn('Local', 'Model does not support word timestamps — using chunk-level timing');
      }

      return { text, wordTimings };
    } catch (error) {
      debugLog.error('Local', 'Error in local transcription', error instanceof Error ? error.message : String(error));
      
      // Clear cached pipeline if error
      const modelId = getPreferredModel();
      pipelineCache.delete(modelId);
      
      if (error instanceof Error && (error.message.includes('WebGPU') || error.message.includes('wasm'))) {
        throw new Error('שגיאה בטעינת המנוע המקומי. נסה דפדפן עדכני יותר או השתמש במנוע אונליין.');
      }
      
      throw new Error(error instanceof Error ? error.message : 'שגיאה בתמלול מקומי');
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  const clearCache = () => {
    pipelineCache.clear();
  };

  return { transcribe, isLoading, progress, currentModel, clearCache };
};
