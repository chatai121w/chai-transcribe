import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const engine = (formData.get('engine') as string) || 'assemblyai';
    const apiKey = formData.get('apiKey') as string;
    const language = (formData.get('language') as string) || 'he';

    if (!file) throw new Error('Missing audio file');
    if (!apiKey) throw new Error('Missing API key');

    const startTime = Date.now();

    if (engine === 'assemblyai') {
      // Step 1: Upload file
      const uploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: { 'authorization': apiKey },
        body: file,
      });
      if (!uploadResp.ok) throw new Error(`Upload failed: ${await uploadResp.text()}`);
      const { upload_url } = await uploadResp.json();

      // Step 2: Request transcription with speaker diarization
      const transcriptPayload: Record<string, unknown> = {
        audio_url: upload_url,
        speaker_labels: true,
        // AssemblyAI now requires an explicit speech_models list for some accounts.
        speech_models: ['universal-2'],
      };
      if (language !== 'auto') {
        transcriptPayload.language_code = language;
      }

      let transcriptResp = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'authorization': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(transcriptPayload),
      });

      if (!transcriptResp.ok) {
        const firstErrorText = await transcriptResp.text();

        // Compatibility fallback for accounts that require universal-3-pro.
        if (firstErrorText.includes('speech_models')) {
          transcriptPayload.speech_models = ['universal-3-pro'];
          transcriptResp = await fetch('https://api.assemblyai.com/v2/transcript', {
            method: 'POST',
            headers: {
              'authorization': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify(transcriptPayload),
          });
          if (!transcriptResp.ok) {
            throw new Error(`Transcription request failed: ${await transcriptResp.text()}`);
          }
        } else {
          throw new Error(`Transcription request failed: ${firstErrorText}`);
        }
      }
      const { id } = await transcriptResp.json();

      // Step 3: Poll for completion (max 10 min)
      let transcript: any;
      const maxPoll = 600;
      let pollCount = 0;
      while (pollCount < maxPoll) {
        const pollResp = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { 'authorization': apiKey },
        });
        transcript = await pollResp.json();
        if (transcript.status === 'completed') break;
        if (transcript.status === 'error') throw new Error(`Transcription failed: ${transcript.error}`);
        await new Promise(r => setTimeout(r, 1000));
        pollCount++;
      }
      if (transcript.status !== 'completed') throw new Error('Transcription timed out');

      // Step 4: Parse utterances into diarization format
      const utterances = transcript.utterances || [];
      const speakersSet = new Set<string>();
      const segments = utterances.map((u: any) => {
        const label = `דובר ${u.speaker}`;
        speakersSet.add(label);
        return {
          text: u.text,
          start: u.start / 1000,
          end: u.end / 1000,
          speaker: u.speaker,
          speaker_label: label,
          words: (u.words || []).map((w: any) => ({
            word: w.text,
            start: w.start / 1000,
            end: w.end / 1000,
            probability: w.confidence || 0,
          })),
        };
      });

      const speakers = Array.from(speakersSet);
      const duration = transcript.audio_duration || 0;
      const processingTime = Math.round((Date.now() - startTime) / 1000);

      return new Response(JSON.stringify({
        text: transcript.text,
        segments,
        speakers,
        speaker_count: speakers.length,
        duration,
        processing_time: processingTime,
        diarization_method: 'AssemblyAI Cloud',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (engine === 'deepgram') {
      // Deepgram with diarization
      const audioBytes = await file.arrayBuffer();
      const resp = await fetch(`https://api.deepgram.com/v1/listen?diarize=true&language=${language}&punctuate=true&utterances=true`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': file.type || 'audio/wav',
        },
        body: audioBytes,
      });
      if (!resp.ok) throw new Error(`Deepgram error: ${await resp.text()}`);
      const data = await resp.json();

      const utterances = data.results?.utterances || [];
      const speakersSet = new Set<string>();
      const segments = utterances.map((u: any) => {
        const label = `דובר ${u.speaker}`;
        speakersSet.add(label);
        return {
          text: u.transcript,
          start: u.start,
          end: u.end,
          speaker: String(u.speaker),
          speaker_label: label,
          words: (u.words || []).map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
            probability: w.confidence || 0,
          })),
        };
      });

      const speakers = Array.from(speakersSet);
      const duration = data.metadata?.duration || 0;
      const processingTime = Math.round((Date.now() - startTime) / 1000);

      return new Response(JSON.stringify({
        text: segments.map((s: any) => s.text).join(' '),
        segments,
        speakers,
        speaker_count: speakers.length,
        duration,
        processing_time: processingTime,
        diarization_method: 'Deepgram Cloud',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      throw new Error(`Unsupported engine: ${engine}`);
    }

  } catch (error) {
    console.error('Error in diarize-cloud:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
