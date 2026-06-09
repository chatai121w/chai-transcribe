import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Sanitize filename - remove Hebrew/special chars that may cause issues
function sanitizeFileName(name: string): string {
  const ext = name.split('.').pop() || 'webm';
  return `audio_${Date.now()}.${ext}`;
}

// Retry wrapper
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 3000): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry non-retryable errors (rate limit, auth)
      if ((lastError as any).noRetry) throw lastError;
      if (i < retries) {
        console.log(`Retry ${i + 1}/${retries} after error: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    let GROQ_API_KEY: string | undefined;
    let fileBlob: Blob | undefined;
    let fileName = 'audio.webm';
    let language = 'he';
    let modelOverride: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const apiKey = form.get('apiKey');
      if (typeof apiKey === 'string') GROQ_API_KEY = apiKey;
      const lang = form.get('language');
      if (typeof lang === 'string' && lang !== 'auto') language = lang;
      const file = form.get('file');
      if (file instanceof Blob) {
        fileBlob = file;
        if ('name' in file) {
          fileName = (file as any).name || fileName;
        }
      }
      if (!fileBlob) throw new Error('file is required in multipart form');
    } else {
      const { audio, fileName: jsonName, apiKey, language: jsonLang } = await req.json();
      if (!audio) throw new Error('No audio data provided');
      GROQ_API_KEY = apiKey || Deno.env.get('GROQ_API_KEY');
      if (jsonLang && jsonLang !== 'auto') language = jsonLang;
      const binaryAudio = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
      fileBlob = new Blob([binaryAudio], { type: 'application/octet-stream' });
      fileName = jsonName || fileName;
    }

    GROQ_API_KEY = GROQ_API_KEY || Deno.env.get('GROQ_API_KEY');
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');

    // Sanitize the filename to avoid encoding issues
    const safeFileName = sanitizeFileName(fileName);
    console.log('Sending to Groq Whisper API...', fileName, '->', safeFileName);

    // Determine mime type from extension
    const ext = safeFileName.split('.').pop()?.toLowerCase() || 'webm';
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'audio/webm',
      m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
      mp4: 'video/mp4', mpeg: 'audio/mpeg', opus: 'audio/opus',
      aac: 'audio/aac', wma: 'audio/x-ms-wma', amr: 'audio/amr',
      aiff: 'audio/aiff', aif: 'audio/aiff', caf: 'audio/x-caf',
      '3gp': 'audio/3gpp', '3gpp': 'audio/3gpp', spx: 'audio/ogg',
      mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
      wmv: 'video/x-ms-wmv', gsm: 'audio/gsm',
    };
    const mimeType = mimeMap[ext] || 'audio/mpeg';
    const typedBlob = new Blob([await fileBlob!.arrayBuffer()], { type: mimeType });

    const models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
    let result: any = null;
    let lastError: Error | undefined;

    for (const model of models) {
      try {
        result = await withRetry(async () => {
          const fd = new FormData();
          fd.append('file', typedBlob, safeFileName);
          fd.append('model', model);
          fd.append('language', language);
          fd.append('response_format', 'verbose_json');
          fd.append('timestamp_granularities[]', 'word');
          fd.append('temperature', '0');
          if (language === 'he') {
            fd.append('prompt', 'תמלול שיחה בעברית. דיבור ברור ומדויק.');
          }

          console.log(`Trying model: ${model}, mime: ${mimeType}, size: ${typedBlob.size}`);

          const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
            body: fd,
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Groq API error (${model}):`, response.status, errorText);
            
            if (response.status === 429) {
              const err = new Error('RATE_LIMIT');
              (err as any).noRetry = true;
              throw err;
            }
            if (response.status === 401 || response.status === 403) {
              const err = new Error('AUTH_ERROR');
              (err as any).noRetry = true;
              throw err;
            }
            if (response.status >= 500) {
              throw new Error(`SERVER_ERROR_${response.status}`);
            }
            throw new Error(`Groq API error: ${response.status}`);
          }

          return await response.json();
        }, 2, 3000);

        console.log(`Groq transcription completed with model: ${model}`);
        break; // Success - exit loop
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if ((lastError as any).noRetry) throw lastError;
        console.log(`Model ${model} failed, trying next...`);
      }
    }

    if (!result) throw lastError!;

    // ── Hallucination filtering ──
    // Whisper often hallucinates repetitive phrases in silence
    const hallucinationPatterns = /^(\s*(תודה רבה|תודה|שלום|להתראות|תודה לכם|תודה על הצפייה|תודה רבה לכם|שבוע טוב|ביי|בוקר טוב)[.,!\s]*)+$/i;
    let cleanText = result.text?.trim() || '';
    if (hallucinationPatterns.test(cleanText)) {
      console.log('Filtered hallucinated text:', cleanText);
      cleanText = '';
    }
    // Remove repeated phrases (e.g. "תודה רבה תודה רבה תודה רבה")
    cleanText = cleanText.replace(/(\S+(?:\s+\S+){0,2})(?:\s+\1){2,}/g, '$1');

    // Extract word-level timestamps
    const wordTimings = (result.words || []).map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    return new Response(JSON.stringify({ text: cleanText, wordTimings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in transcribe-groq:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    
    if (msg === 'RATE_LIMIT') {
      return new Response(JSON.stringify({ error: 'חרגת ממגבלת הבקשות של Groq. נסה שוב מאוחר יותר.', retryAfter: 60 }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
    if (msg === 'AUTH_ERROR') {
      return new Response(JSON.stringify({ error: 'מפתח Groq שגוי או חסר.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (msg.startsWith('SERVER_ERROR_')) {
      return new Response(JSON.stringify({ error: 'שגיאת שרת ב-Groq. הבקשה נכשלה גם אחרי ניסיונות חוזרים. נסה שוב בעוד מספר דקות.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
