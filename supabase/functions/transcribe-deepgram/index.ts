import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const apiKey = formData.get('apiKey') as string;
    const language = formData.get('language') as string || 'auto';

    if (!file || !apiKey) {
      throw new Error('Missing file or API key');
    }

    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();

    // Map language codes
    const languageMap: Record<string, string> = {
      'he': 'he',
      'yi': 'he', // Use Hebrew for Yiddish as fallback
      'en': 'en',
      'auto': 'multi', // Deepgram's multi-language model
    };

    const deepgramLanguage = languageMap[language] || 'multi';

    // Call Deepgram API
    const response = await fetch(
      `https://api.deepgram.com/v1/listen?language=${deepgramLanguage}&model=nova-2&smart_format=true`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': file.type,
        },
        body: arrayBuffer,
      }
    );

    if (!response.ok) {
      throw new Error(`Deepgram API error: ${await response.text()}`);
    }

    const result = await response.json();
    const alt = result.results?.channels?.[0]?.alternatives?.[0];
    const text = alt?.transcript || '';

    if (!text) {
      throw new Error('No transcription received from Deepgram');
    }

    // Extract word-level timestamps from Deepgram response
    const wordTimings = (alt?.words || []).map((w: any) => ({
      word: w.punctuated_word || w.word,
      start: w.start,
      end: w.end,
    }));

    return new Response(
      JSON.stringify({ text, wordTimings }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcribe-deepgram:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});