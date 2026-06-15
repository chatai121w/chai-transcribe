// ─── Audio Compression & Chunking ────────────────────────────
// Compress audio to 16kHz mono (optimal for Whisper) and split large files

/**
 * Compress/re-encode audio to 16kHz mono WebM/Opus.
 * Whisper models only use 16kHz mono — sending higher quality is wasteful.
 * A 100MB stereo 44.1kHz file → ~3-5MB after compression.
 */
export function compressAudio(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'auto';

    // Hide audio element
    audio.style.position = 'fixed';
    audio.style.left = '-9999px';
    document.body.appendChild(audio);

    const objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;

    const cleanup = () => {
      audio.pause();
      audio.src = '';
      if (audio.parentNode) audio.parentNode.removeChild(audio);
      URL.revokeObjectURL(objectUrl);
    };

    audio.addEventListener('error', () => {
      cleanup();
      reject(new Error('שגיאה בטעינת קובץ האודיו לכיווץ'));
    });

    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration;
      if (!isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new Error('לא ניתן לקרוא את משך האודיו'));
        return;
      }

      try {
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaElementSource(audio);

        // Downmix to mono via channel merger
        const merger = audioCtx.createChannelMerger(1);
        source.connect(merger);

        const dest = audioCtx.createMediaStreamDestination();
        merger.connect(dest);

        // Muted output so user doesn't hear
        const mutedGain = audioCtx.createGain();
        mutedGain.gain.value = 0;
        source.connect(mutedGain);
        mutedGain.connect(audioCtx.destination);

        const chunks: Blob[] = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(dest.stream, {
          mimeType,
          audioBitsPerSecond: 32000, // 32kbps — very small, plenty for speech
        });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          audioCtx.close();
          cleanup();

          const blob = new Blob(chunks, { type: mimeType });
          const baseName = file.name.replace(/\.[^.]+$/, '');
          const compressed = new File(
            [blob],
            `${baseName}-compressed.webm`,
            { type: mimeType },
          );
          onProgress?.(100);
          resolve(compressed);
        };

        recorder.onerror = () => {
          audioCtx.close();
          cleanup();
          reject(new Error('שגיאה בכיווץ האודיו'));
        };

        // Progress reporting
        const progressInterval = setInterval(() => {
          if (audio.currentTime && duration) {
            onProgress?.(Math.min(99, Math.round((audio.currentTime / duration) * 100)));
          }
        }, 300);

        audio.addEventListener('ended', () => {
          clearInterval(progressInterval);
          recorder.stop();
        });

        // Start at 16x speed for fast processing
        recorder.start(100); // collect data every 100ms
        audio.playbackRate = 16;
        audio.volume = 0;
        audio.play().catch(() => {
          clearInterval(progressInterval);
          recorder.stop();
          audioCtx.close();
          cleanup();
          reject(new Error('הדפדפן חסם ניגון אוטומטי — נסה שוב'));
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

/**
 * Split an audio file into time-based chunks using Web Audio API.
 * Each chunk is a separate File that can be transcribed independently.
 */
export async function splitAudioIntoChunks(
  file: File,
  chunkDurationSec: number = 600, // 10 minutes per chunk
  onProgress?: (percent: number) => void,
): Promise<File[]> {
  // Decode the full audio to get duration
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, 16000); // dummy context for decoding
  
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0)); // slice to avoid detach
  } catch {
    // If browser can't decode (e.g. some codecs), return as single chunk
    return [file];
  }

  const totalDuration = audioBuffer.duration;
  const numChunks = Math.ceil(totalDuration / chunkDurationSec);
  
  if (numChunks <= 1) return [file];

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const chunks: File[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startSample = Math.floor(i * chunkDurationSec * sampleRate);
    const endSample = Math.min(Math.floor((i + 1) * chunkDurationSec * sampleRate), audioBuffer.length);
    const chunkLength = endSample - startSample;

    // Create WAV for this chunk
    const wavBuffer = encodeWav(audioBuffer, startSample, chunkLength, channels, sampleRate);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const chunkFile = new File(
      [wavBuffer],
      `${baseName}-chunk${i + 1}.wav`,
      { type: 'audio/wav' },
    );
    chunks.push(chunkFile);
    onProgress?.(Math.round(((i + 1) / numChunks) * 100));
  }

  return chunks;
}

/**
 * Encode a portion of an AudioBuffer as WAV.
 */
function encodeWav(
  buffer: AudioBuffer,
  startSample: number,
  length: number,
  channels: number,
  sampleRate: number,
): ArrayBuffer {
  // Mix to mono
  const monoData = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      monoData[i] += channelData[startSample + i] / channels;
    }
  }

  // Convert to 16-bit PCM
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, monoData[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // Build WAV header
  const wavSize = 44 + pcm.length * 2;
  const wav = new ArrayBuffer(wavSize);
  const view = new DataView(wav);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, wavSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  // PCM data
  const pcmBytes = new Uint8Array(wav, 44);
  pcmBytes.set(new Uint8Array(pcm.buffer));

  return wav;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Cloud API file size limit in bytes (25MB)
 */
export const CLOUD_API_LIMIT = 25 * 1024 * 1024;

/**
 * Should this file be compressed before uploading to cloud APIs?
 */
export function needsCompression(file: File): boolean {
  return file.size > CLOUD_API_LIMIT;
}

/**
 * Format bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
