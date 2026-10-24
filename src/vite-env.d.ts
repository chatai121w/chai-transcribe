/// <reference types="vite/client" />

/**
 * הגדרות הסוגים של זיהוי הדיבור בדפדפן.
 *
 * אין להן מקור רשמי בספריות של הדפדפן, ולכן הן נכתבות כאן ביד.
 *
 * שתי נקודות שלא מובנות מאליהן:
 *
 *  1. שגיאות בקובץ הזה מושתקות בהגדרות הפרויקט. לכן קובץ ההגדרות
 *     עצמו יכול להפנות לסוג שאינו קיים בלי שאף אחד יתלונן — בעוד
 *     שבקוד הרגיל אותה הפניה נכשלת. זה בדיוק מה שקרה כאן: הסוג
 *     SpeechRecognitionEvent הוזכר למטה אבל לא הוגדר.
 *
 *  2. רשימת התוצאות אינה מערך. היא אובייקט שאפשר לפנות אליו לפי
 *     מספר, ולכן נדרש index signature ולא Array.
 */

interface SpeechRecognitionAlternative {
  /** הטקסט שזוהה. */
  readonly transcript: string;
  /** מידת הוודאות, בין 0 ל-1. */
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  /** האם הקטע הזה סופי, או שהוא עוד עשוי להשתנות. */
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  readonly [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  readonly [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  /** מאיזה קטע ההודעה הזאת מתחילה. הקטעים שלפניו כבר טופלו. */
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  /** סוג התקלה. למשל "not-allowed" כשהמשתמש חסם את המיקרופון. */
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare var SpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition };
declare var webkitSpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition };
