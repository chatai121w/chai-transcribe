/// <reference types="vite/client" />

// Minimal Web Speech API type declarations (browser-only)
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: any) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare var SpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition };
declare var webkitSpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition };
