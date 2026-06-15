import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function updateJob(jobId: string, updates: Record<string, unknown>) {
  const admin = createClient(supabaseUrl, serviceKey);
  await admin.from('diarization_jobs').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', jobId);
}

async function processAssemblyAI(jobId: string, apiKey: string, filePath: string, language: string) {
  const admin = createClient(supabaseUrl, serviceKey);
  
  // Check for resume data
  const { data: job } = await admin.from('diarization_jobs').select('resume_data, external_job_id').eq('id', jobId).single();
  let transcriptId = job?.external_job_id;
  
  if (!transcriptId) {
    // Download file from storage
    await updateJob(jobId, { status: 'processing', progress: 5 });
    const { data: fileData, error: dlErr } = await admin.storage.from('audio-files').download(filePath);
    if (dlErr || !fileData) throw new Error(`Failed to download file: ${dlErr?.message}`);
    
    // Upload to AssemblyAI
    await updateJob(jobId, { progress: 15 });
    const uploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey },
      body: fileData,
    });
    if (!uploadResp.ok) throw new Error(`Upload failed: ${await uploadResp.text()}`);
    const { upload_url } = await uploadResp.json();
    
    // Start transcription with diarization
    await updateJob(jobId, { progress: 25 });
    const transcriptPayload: Record<string, unknown> = {
      audio_url: upload_url,
      speaker_labels: true,
      speech_models: ['universal-2'],
    };
    if (language !== 'auto') {
      transcriptPayload.language_code = language;
    }

    let txResp = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(transcriptPayload),
    });

    if (!txResp.ok) {
      const firstErrorText = await txResp.text();
      if (firstErrorText.includes('speech_models')) {
        transcriptPayload.speech_models = ['universal-3-pro'];
        txResp = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: { authorization: apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(transcriptPayload),
        });
      }
      if (!txResp.ok) throw new Error(`Transcription request failed: ${await txResp.text()}`);
    }

    const txData = await txResp.json();
    transcriptId = txData.id;
    
    // Save external ID for resume
    await updateJob(jobId, { external_job_id: transcriptId, progress: 30, resume_data: { step: 'polling' } });
  }
  
  // Poll for completion
  let transcript: Record<string, unknown> | null = null;
  for (let i = 0; i < 600; i++) {
    const pollResp = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    });
    transcript = await pollResp.json();
    if ((transcript as any).status === 'completed') break;
    if ((transcript as any).status === 'error') throw new Error(`Transcription failed: ${(transcript as any).error}`);
    
    // Update progress (30-90 range during polling)
    const progress = Math.min(90, 30 + i);
    if (i % 5 === 0) await updateJob(jobId, { progress });
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!transcript || (transcript as any).status !== 'completed') throw new Error('Transcription timed out');
  
  // Parse results
  const utterances = (transcript as any).utterances || [];
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
        word: w.text, start: w.start / 1000, end: w.end / 1000, probability: w.confidence || 0,
      })),
    };
  });
  
  const speakers = Array.from(speakersSet);
  const duration = (transcript as any).audio_duration || 0;
  
  return {
    text: (transcript as any).text,
    segments,
    speakers,
    speaker_count: speakers.length,
    duration,
    processing_time: 0,
    diarization_method: 'AssemblyAI Cloud (Background)',
  };
}

async function processDeepgram(jobId: string, apiKey: string, filePath: string, language: string) {
  const admin = createClient(supabaseUrl, serviceKey);
  
  await updateJob(jobId, { status: 'processing', progress: 10 });
  const { data: fileData, error: dlErr } = await admin.storage.from('audio-files').download(filePath);
  if (dlErr || !fileData) throw new Error(`Failed to download file: ${dlErr?.message}`);
  
  await updateJob(jobId, { progress: 30 });
  const resp = await fetch(`https://api.deepgram.com/v1/listen?diarize=true&language=${language}&punctuate=true&utterances=true`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/wav' },
    body: fileData,
  });
  if (!resp.ok) throw new Error(`Deepgram error: ${await resp.text()}`);
  
  await updateJob(jobId, { progress: 80 });
  const data = await resp.json();
  
  const utterances = data.results?.utterances || [];
  const speakersSet = new Set<string>();
  const segments = utterances.map((u: any) => {
    const label = `דובר ${u.speaker}`;
    speakersSet.add(label);
    return {
      text: u.transcript,
      start: u.start, end: u.end,
      speaker: String(u.speaker), speaker_label: label,
      words: (u.words || []).map((w: any) => ({
        word: w.word, start: w.start, end: w.end, probability: w.confidence || 0,
      })),
    };
  });
  
  const speakers = Array.from(speakersSet);
  return {
    text: segments.map((s: any) => s.text).join(' '),
    segments, speakers,
    speaker_count: speakers.length,
    duration: data.metadata?.duration || 0,
    processing_time: 0,
    diarization_method: 'Deepgram Cloud (Background)',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { jobId } = await req.json();
    if (!jobId) throw new Error('Missing jobId');

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: job, error } = await admin.from('diarization_jobs').select('*').eq('id', jobId).single();
    if (error || !job) throw new Error(`Job not found: ${error?.message}`);
    
    // Skip if already completed
    if (job.status === 'completed') {
      return new Response(JSON.stringify({ status: 'already_completed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's API key
    const { data: keys } = await admin.from('user_api_keys')
      .select('*')
      .eq('user_identifier', job.user_id)
      .single();
    
    const engine = job.engine;
    let apiKey = '';
    if (engine === 'assemblyai') apiKey = keys?.assemblyai_key || '';
    else if (engine === 'deepgram') apiKey = keys?.deepgram_key || '';
    
    if (!apiKey) throw new Error(`No API key found for ${engine}`);
    if (!job.file_path) throw new Error('No file path');

    await updateJob(jobId, { status: 'processing', progress: 5 });

    let result;
    const startTime = Date.now();
    
    if (engine === 'assemblyai') {
      result = await processAssemblyAI(jobId, apiKey, job.file_path, job.language || 'he');
    } else if (engine === 'deepgram') {
      result = await processDeepgram(jobId, apiKey, job.file_path, job.language || 'he');
    } else {
      throw new Error(`Unsupported engine for background: ${engine}`);
    }

    const processingTime = Math.round((Date.now() - startTime) / 1000);
    result.processing_time = processingTime;

    // Save result and mark completed
    await updateJob(jobId, {
      status: 'completed',
      progress: 100,
      result: result,
    });

    // Also save to diarization_results for history
    await admin.from('diarization_results').insert({
      user_id: job.user_id,
      file_name: job.file_name,
      segments: result.segments,
      speakers: result.speakers,
      speaker_names: {},
      speaker_count: result.speaker_count,
      duration: result.duration,
      processing_time: processingTime,
      diarization_method: result.diarization_method,
      engine: engine,
    });

    return new Response(JSON.stringify({ status: 'completed', result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('diarize-background error:', error);
    // Try to update job status
    try {
      const { jobId } = await new Response(req.clone().body).json().catch(() => ({}));
      if (jobId) {
        await updateJob(jobId, {
          status: 'error',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } catch { /* ignore */ }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
