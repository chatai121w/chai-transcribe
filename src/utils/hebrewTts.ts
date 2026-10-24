/**
 * הקראת עברית בקול.
 *
 * הבסיס הוא מנוע ההקראה המובנה במערכת ההפעלה, שזמין מיד בלי שום הורדה.
 * מנועים מקומיים חזקים יותר (עם שכפול קול) מתחברים דרך השרת ולא דרך כאן.
 *
 * שתי נקודות שלא מובנות מאליהן ושעלו מבדיקה בפועל:
 *
 *  1. רשימת הקולות מגיעה באיחור. בקריאה הראשונה היא כמעט תמיד ריקה,
 *     והיא מתמלאת רק אחרי אירוע נפרד. קוד שקורא אותה פעם אחת ושומר
 *     את התוצאה יסיק "אין קול עברי" גם במחשב שיש בו קול עברי.
 *
 *  2. אירוע גבול-המילה הוא מה שמאפשר להדגיש את המילה הנקראת. הוא
 *     מדווח מקום בתווים, לא מספר מילה, ולכן צריך לתרגם אותו.
 */

export interface HebrewVoice {
  /** המזהה שהדפדפן מכיר. */
  name: string;
  /** שם להצגה למשתמש. */
  label: string;
  lang: string;
  /** האם הקול עברי, או קול כללי שמשמש כגיבוי. */
  isHebrew: boolean;
  /** האם הוא פועל במחשב ולא דרך האינטרנט. */
  isLocal: boolean;
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isHebrewTtsAvailable(): boolean {
  return supported();
}

function describeVoice(v: SpeechSynthesisVoice): HebrewVoice {
  const isHebrew = v.lang?.toLowerCase().startsWith('he') || /hebrew|ivrit/i.test(v.name);
  return {
    name: v.name,
    label: isHebrew ? `${v.name} · עברית` : `${v.name} · ${v.lang}`,
    lang: v.lang,
    isHebrew,
    isLocal: v.localService,
  };
}

/**
 * מחזיר את כל הקולות הזמינים, כשהעבריים ראשונים.
 *
 * קורא ישירות ולא מהזיכרון, כי הרשימה משתנה אחרי טעינת העמוד.
 */
export function listVoices(): HebrewVoice[] {
  if (!supported()) return [];
  const all = speechSynthesis.getVoices().map(describeVoice);
  return [
    ...all.filter((v) => v.isHebrew),
    ...all.filter((v) => !v.isHebrew),
  ];
}

export function listHebrewVoices(): HebrewVoice[] {
  return listVoices().filter((v) => v.isHebrew);
}

/**
 * ממתין עד שרשימת הקולות מתמלאת, או עד שהזמן נגמר.
 *
 * בלי זה, מסך שנטען בודק קולות ומוצא רשימה ריקה, ומציג "אין קול עברי"
 * בלי לנסות שוב.
 */
export function waitForVoices(timeoutMs = 3000): Promise<HebrewVoice[]> {
  if (!supported()) return Promise.resolve([]);
  const immediate = listVoices();
  if (immediate.length) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearInterval(poll);
      window.clearTimeout(timer);
      speechSynthesis.onvoiceschanged = null;
      resolve(listVoices());
    };
    speechSynthesis.onvoiceschanged = finish;
    // גם בדיקה חוזרת, כי יש דפדפנים שאינם שולחים את האירוע בכלל.
    const poll = window.setInterval(() => {
      if (speechSynthesis.getVoices().length) finish();
    }, 150);
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

function resolveVoice(preferredName?: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith('he')) ||
    voices.find((v) => /hebrew|ivrit/i.test(v.name)) ||
    null
  );
}

export interface SpeakOptions {
  /** שם הקול המבוקש. בלעדיו נבחר קול עברי אוטומטית. */
  voiceName?: string;
  /** מהירות, 0.1 עד 10. ברירת מחדל 1. */
  rate?: number;
  /** גובה הקול, 0 עד 2. ברירת מחדל 1. */
  pitch?: number;
  /** עוצמה, 0 עד 1. ברירת מחדל 1. */
  volume?: number;
  /** נקרא עם מקום התו שההקראה הגיעה אליו — לצורך הדגשת המילה. */
  onBoundary?: (charIndex: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** תרגום קודי השגיאה של הדפדפן להסבר בעברית. */
function explainError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'הדפדפן חסם את ההקראה. צריך ללחוץ על משהו בדף לפני ההקראה הראשונה.';
    case 'audio-busy':
      return 'כרטיס הקול תפוס. אפשר לנסות שוב בעוד רגע.';
    case 'synthesis-unavailable':
    case 'synthesis-failed':
      return 'מנוע ההקראה של המערכת לא הצליח לפעול.';
    case 'language-unavailable':
      return 'אין במערכת קול שמתאים לעברית.';
    case 'voice-unavailable':
      return 'הקול שנבחר אינו זמין עוד. כדאי לבחור קול אחר.';
    case 'interrupted':
    case 'canceled':
      return '';
    default:
      return `ההקראה נעצרה (${code}).`;
  }
}

export function speakHebrew(text: string, options: SpeakOptions = {}): SpeechSynthesisUtterance | null {
  if (!supported() || !text.trim()) return null;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = resolveVoice(options.voiceName);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'he-IL';
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  utterance.volume = options.volume ?? 1;

  if (options.onStart) utterance.onstart = () => options.onStart?.();
  if (options.onEnd) utterance.onend = () => options.onEnd?.();
  if (options.onBoundary) {
    utterance.onboundary = (e) => options.onBoundary?.(e.charIndex);
  }
  utterance.onerror = (e) => {
    const message = explainError(e.error);
    // עצירה מכוונת מגיעה גם היא כשגיאה. אין מה להציג למשתמש.
    if (message) options.onError?.(message);
    else options.onEnd?.();
  };

  speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking(): void {
  if (supported()) speechSynthesis.cancel();
}

export function pauseSpeaking(): void {
  if (supported()) speechSynthesis.pause();
}

export function resumeSpeaking(): void {
  if (supported()) speechSynthesis.resume();
}

export function isSpeaking(): boolean {
  return supported() && speechSynthesis.speaking;
}

export function isPaused(): boolean {
  return supported() && speechSynthesis.paused;
}

export interface SpokenWord {
  word: string;
  /** מקום התו שבו המילה מתחילה בטקסט המלא. */
  charIndex: number;
}

/**
 * מפרק טקסט למילים עם מקום התחלה, כדי להתאים אירוע גבול-מילה למילה.
 *
 * אירוע הגבול מדווח מקום בתווים. בלי המפתח הזה אין דרך לדעת איזו מילה
 * נקראת כרגע.
 */
export function splitSpokenWords(text: string): SpokenWord[] {
  const words: SpokenWord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ word: m[0], charIndex: m.index });
  }
  return words;
}

/** איזו מילה מתאימה למקום התו שהדפדפן דיווח. */
export function wordIndexForChar(words: SpokenWord[], charIndex: number): number {
  if (!words.length) return -1;
  let found = -1;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].charIndex <= charIndex) found = i;
    else break;
  }
  return found;
}
