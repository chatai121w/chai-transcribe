import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    let OPENAI_API_KEY: string | undefined;
    let fileBlob: Blob | undefined;
    let fileName = 'audio.mp3';

    if (contentType.includes('multipart/form-data')) {
      // Multipart from browser (preferred - supports real upload progress client-side)
      const form = await req.formData();
      const apiKey = form.get('apiKey');
      if (typeof apiKey === 'string') OPENAI_API_KEY = apiKey;
      const file = form.get('file');
      if (file instanceof Blob) {
        fileBlob = file;
        if ('name' in file) {
          // @ts-ignore - Deno's Blob may not have name
          fileName = (file as any).name || fileName;
        }
      }
      if (!fileBlob) throw new Error('file is required in multipart form');
    } else {
      // Backward compatible JSON with base64
      const { audio, fileName: jsonName, apiKey } = await req.json();
      if (!audio) throw new Error('No audio data provided');
      OPENAI_API_KEY = apiKey || Deno.env.get('OPENAI_API_KEY');
      const binaryAudio = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
      fileBlob = new Blob([binaryAudio], { type: 'application/octet-stream' });
      fileName = jsonName || fileName;
    }

    OPENAI_API_KEY = OPENAI_API_KEY || Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

    console.log('Sending to OpenAI Whisper API...', fileName);

    const fd = new FormData();
    fd.append('file', fileBlob!, fileName);
    fd.append('model', 'whisper-1');
    fd.append('language', 'he');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'חרגת ממגבלת הבקשות של OpenAI. נסה שוב מאוחר יותר.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 401 || response.status === 403) {
        return new Response(JSON.stringify({ error: 'מפתח OpenAI שגוי או חסר.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: `OpenAI API error: ${response.status}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    console.log('Transcription completed successfully');

    const wordTimings = (result.words || []).map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    return new Response(JSON.stringify({ text: result.text, wordTimings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in transcribe-openai:', error);
    // WORKER_LIMIT or memory errors
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isWorker = msg.includes('Memory') || msg.includes('compute');
    return new Response(JSON.stringify({ error: msg }), {
      status: isWorker ? 546 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
