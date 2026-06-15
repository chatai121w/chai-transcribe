// ─── Video Utilities ─────────────────────────────────────────
// Detect video files and extract audio from them using Web APIs

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'avi', 'mov', 'mkv', 'wmv', 'flv', '3gp', '3gpp',
  'mpg', 'mpeg', 'm4v', 'ogv', 'ts', 'mts',
]);

const VIDEO_MIME_PREFIXES = ['video/'];

/**
 * Check if a file is a video file by extension or MIME type.
 */
export function isVideoFile(file: File): boolean {
  // Check MIME type
  if (file.type && VIDEO_MIME_PREFIXES.some(p => file.type.startsWith(p))) {
    return true;
  }
  // Check extension
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Get the audio-compatible extension for a video file.
 * MP4 → m4a, WebM → webm (audio-only), others → wav
 */
function getAudioExtForVideo(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'mp4' || ext === 'm4v') return 'wav';
  if (ext === 'webm') return 'webm';
  return 'wav';
}

/**
 * Extract audio from a video file using the browser's built-in APIs.
 *
 * Strategy: Load video into an HTMLVideoElement, connect to Web Audio API
 * via MediaElementSource → MediaStreamDestination, and record via MediaRecorder.
 * The video is played at max speed (16x) to extract audio quickly.
 *
 * Returns a new File containing only the audio track.
 */
export function extractAudioFromVideo(
  videoFile: File,
  onProgress?: (percent: number) => void,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = false; // Need unmuted for audio capture
    video.preload = 'auto';
    video.playsInline = true;

    // Prevent the video from being visible
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    document.body.appendChild(video);

    const cleanup = () => {
      video.pause();
      video.src = '';
      video.load();
      if (video.parentNode) video.parentNode.removeChild(video);
      URL.revokeObjectURL(video.src);
    };

    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error('שגיאה בטעינת קובץ הווידאו'));
    });

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new Error('לא ניתן לקרוא את משך הווידאו'));
        return;
      }

      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        // Also connect to destination so playback happens (required for capture)
        source.connect(audioCtx.destination);

        // Mute the actual output so user doesn't hear it
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        // Disconnect from destination and reconnect through muted gain
        source.disconnect(audioCtx.destination);
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const chunks: Blob[] = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(dest.stream, { mimeType });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          audioCtx.close();
          cleanup();

          const audioBlob = new Blob(chunks, { type: mimeType });
          const audioExt = getAudioExtForVideo(videoFile.name);
          const baseName = videoFile.name.replace(/\.[^.]+$/, '');
          const audioFile = new File(
            [audioBlob],
            `${baseName}-audio.${audioExt}`,
            { type: mimeType },
          );
          resolve(audioFile);
        };

        recorder.onerror = () => {
          audioCtx.close();
          cleanup();
          reject(new Error('שגיאה בהקלטת האודיו מהווידאו'));
        };

        // Report progress
        const progressInterval = setInterval(() => {
          if (video.currentTime && duration) {
            const pct = Math.min(99, Math.round((video.currentTime / duration) * 100));
            onProgress?.(pct);
          }
        }, 200);

        video.addEventListener('ended', () => {
          clearInterval(progressInterval);
          onProgress?.(100);
          recorder.stop();
        });

        // Start recording and play at max speed
        recorder.start();
        video.playbackRate = 16; // Max speed supported by browsers
        video.volume = 0; // Mute actual playback
        video.play().catch(() => {
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
 * Maximum file size by type (compression handles cloud API limits)
 */
export const MAX_VIDEO_SIZE_MB = 500;
export const MAX_AUDIO_SIZE_MB = 500;

/**
 * Engines that can handle video files natively (no extraction needed)
 */
export const VIDEO_NATIVE_ENGINES = new Set([
  'local-server', // faster_whisper + FFmpeg
  'groq',         // API accepts video
  'openai',       // API accepts video
  'deepgram',     // API accepts video
  'assemblyai',   // API accepts video
]);

/**
 * Engines that REQUIRE audio-only files (video not supported)
 */
export const VIDEO_NEEDS_EXTRACTION = new Set([
  'google', // Google Speech-to-Text only accepts audio formats
  'local',  // Browser ONNX model — audio only
]);
