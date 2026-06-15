/**
 * Hebrew Text-to-Speech utility
 * Uses browser SpeechSynthesis API with Hebrew voice preference.
 * Falls back to any available Hebrew voice, or default voice.
 */

let cachedHebrewVoice: SpeechSynthesisVoice | null = null;

function getHebrewVoice(): SpeechSynthesisVoice | null {
  if (cachedHebrewVoice) return cachedHebrewVoice;
  const voices = speechSynthesis.getVoices();
  // Prefer Hebrew voices
  const hebrewVoice = voices.find(v => v.lang.startsWith('he')) ||
    voices.find(v => v.lang === 'he-IL') ||
    voices.find(v => v.name.toLowerCase().includes('hebrew'));
  if (hebrewVoice) {
    cachedHebrewVoice = hebrewVoice;
  }
  return hebrewVoice || null;
}

export function isHebrewTtsAvailable(): boolean {
  return 'speechSynthesis' in window;
}

export function speakHebrew(
  text: string,
  options?: {
    rate?: number;   // 0.1–10, default 1
    pitch?: number;  // 0–2, default 1
    onEnd?: () => void;
    onError?: (err: string) => void;
  }
): SpeechSynthesisUtterance | null {
  if (!isHebrewTtsAvailable() || !text.trim()) return null;

  // Cancel any current speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getHebrewVoice();
  if (voice) {
    utterance.voice = voice;
  }
  utterance.lang = 'he-IL';
  utterance.rate = options?.rate ?? 1;
  utterance.pitch = options?.pitch ?? 1;

  if (options?.onEnd) {
    utterance.onend = options.onEnd;
  }
  if (options?.onError) {
    utterance.onerror = (e) => options.onError?.(e.error);
  }

  speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking(): void {
  if (isHebrewTtsAvailable()) {
    speechSynthesis.cancel();
  }
}

export function pauseSpeaking(): void {
  if (isHebrewTtsAvailable()) {
    speechSynthesis.pause();
  }
}

export function resumeSpeaking(): void {
  if (isHebrewTtsAvailable()) {
    speechSynthesis.resume();
  }
}

export function isSpeaking(): boolean {
  return isHebrewTtsAvailable() && speechSynthesis.speaking;
}
