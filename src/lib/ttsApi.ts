/**
 * פנייה למנוע ההקראה המקומי שבשרת.
 *
 * שתי פניות נפרדות בכוונה:
 *   phonemizeHebrew   עברית מנוקדת -> צלילים. מהיר, ואינו דורש את המנוע.
 *   speakWithEngine   צלילים -> קובץ קול. דורש את המנוע המותקן.
 *
 * ההפרדה חשובה: אפשר לראות ולתקן את הצלילים לפני שמשלמים על ההקראה,
 * וההמרה עובדת גם כשהמנוע אינו מותקן — כך שהמסך שימושי מהרגע הראשון.
 */

import { getServerUrl } from '@/lib/serverConfig';

export interface TtsVoice {
  id: string;
  /** האם זה קול שאומן על עברית. היחיד שמתאים לעברית. */
  hebrew: boolean;
  /** האם הקול נוצר משכפול. רק קול כזה אפשר למחוק. */
  cloned: boolean;
  note: string;
  source: string;
  refFrames: number | null;
}

export interface TtsAccent {
  id: string;
  label: string;
  /** האזור שההגייה שייכת לו. ליטא, פולין או ישראל. */
  region: string;
  /** מלעיל או מלרע. */
  stress: string;
}

/**
 * רמת לשון.
 *
 * ההבחנה הזאת היא מה שהופך את זה שימושי לשיעור תורה. אותו טקסט
 * נקרא אחרת כשמצטטים פסוק מדויק וכשמדברים בשיעור: בציטוט ההטעמה
 * סופית, ובדיבור היא מלעילית והתנועות אחריה נחלשות.
 */
export interface TtsLevel {
  id: string;
  label: string;
  note: string;
  stress: string;
}

export interface TtsStatus {
  installed: boolean;
  missingFiles: string[];
  modelDir: string;
  accents: TtsAccent[];
  levels: TtsLevel[];
  voices: TtsVoice[];
  /** האם המנקד האוטומטי מותקן. בלעדיו חייבים טקסט מנוקד. */
  nikudAvailable: boolean;
  nikudSizeMb: number;
  /** האם שכפול קול מותקן. */
  cloningAvailable: boolean;
  cloningMissing: string[];
  cloneMinSeconds: number;
  cloneMaxSeconds: number;
  symbolCount: number;
  sampleRate: number;
  defaultSteps: number;
  defaultCfg: number;
  /** על מה הוא ירוץ — כרטיס המסך או המעבד. */
  providers: string[];
  error?: string;
}

export interface PhonemeWord {
  word: string;
  ipa: string;
}

export interface PhonemeResult {
  ipa: string;
  accent: string;
  level: string;
  /** הטקסט אחרי הניקוד, כדי שאפשר יהיה לבדוק אותו. */
  vocalized?: string;
  /** האם הניקוד נוסף אוטומטית. אם כן, כדאי לבדוק אותו. */
  nikudAdded?: boolean;
  perWord: PhonemeWord[];
  warnings: string[];
  /** סימנים שהמנוע יזרוק בשקט. רשימה לא ריקה פירושה הקראה חסרה. */
  unsupported: string[];
  voweledWords: number;
  totalWords: number;
}

export interface SpeakOptions {
  text?: string;
  /** צלילים ישירות, במקום להמיר מעברית. */
  ipa?: string;
  accent?: string;
  /** רמת הלשון. */
  level?: string;
  /** האם לנקד אוטומטית טקסט שאינו מנוקד. */
  autoNikud?: boolean;
  voice?: string;
  /** מספר צעדי הדגימה. יותר צעדים — איכות טובה יותר ואיטי יותר. */
  steps?: number;
  /** עד כמה להיצמד לטקסט. */
  cfg?: number;
  speed?: number;
  /** מספר התחלה קבוע, כדי לקבל את אותה תוצאה בדיוק שוב. */
  seed?: number;
  signal?: AbortSignal;
}

export interface SpeakResult {
  blob: Blob;
  /** אורך הקול שנוצר, בשניות. */
  seconds: number;
  /** כמה זמן ההקראה לקחה בפועל. */
  elapsed: number;
}

/** שגיאה שאפשר להציג למשתמש כמו שהיא. */
export class TtsApiError extends Error {
  /** סימנים שאינם בטבלת המנוע, אם זאת הסיבה. */
  unsupported?: string[];
  /** קבצים חסרים, אם המנוע אינו מותקן. */
  missingFiles?: string[];
  ipa?: string;

  constructor(message: string, extra?: Partial<TtsApiError>) {
    super(message);
    this.name = 'TtsApiError';
    Object.assign(this, extra);
  }
}

const STATUS_TIMEOUT_MS = 4000;

/** מה מותקן ומה זמין. מחזיר null כשהשרת אינו מגיב בכלל. */
export async function fetchTtsStatus(): Promise<TtsStatus | null> {
  try {
    const res = await fetch(`${getServerUrl()}/tts/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as TtsStatus;
  } catch {
    // שרת כבוי אינו שגיאה שצריך להציג. המסך פשוט יעבוד בלי המנוע.
    return null;
  }
}

async function readError(res: Response): Promise<TtsApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // תשובה שאינה בפורמט הצפוי. נשאר עם הודעה כללית.
  }
  const message =
    typeof body.error === 'string' && body.error
      ? body.error
      : `השרת החזיר שגיאה ${res.status}.`;
  return new TtsApiError(message, {
    unsupported: Array.isArray(body.unsupported) ? (body.unsupported as string[]) : undefined,
    missingFiles: Array.isArray(body.missingFiles) ? (body.missingFiles as string[]) : undefined,
    ipa: typeof body.ipa === 'string' ? body.ipa : undefined,
  });
}

export interface PhonemizeOptions {
  accent?: string;
  level?: string;
  stress?: boolean;
  /** האם לנקד אוטומטית. כבוי פירושו שטקסט לא מנוקד יוצא בלי תנועות. */
  autoNikud?: boolean;
}

/** עברית -> צלילים, עם ניקוד אוטומטי אם צריך. */
export async function phonemizeHebrew(
  text: string,
  options: PhonemizeOptions = {},
): Promise<PhonemeResult> {
  const res = await fetch(`${getServerUrl()}/tts/phonemize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      accent: options.accent ?? 'ashkenazi',
      level: options.level ?? 'prayer',
      stress: options.stress ?? true,
      autoNikud: options.autoNikud ?? true,
    }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as PhonemeResult;
}

export interface NikudResult {
  text: string;
  coverageBefore: number;
  coverageAfter: number;
  words: number;
  elapsed: number;
  warnings: string[];
}

/**
 * ניקוד בלבד, בלי המרה לצלילים.
 *
 * נפרד בכוונה: ניקוד שגוי מייצר הגייה שגויה, ואי אפשר לזהות את זה
 * מהצלילים לבד. כאן אפשר לראות את הניקוד ולתקן אותו.
 */
export async function addNikud(text: string): Promise<NikudResult> {
  const res = await fetch(`${getServerUrl()}/tts/nikud`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as NikudResult;
}

/** מקריא, ומחזיר את קובץ הקול. */
export async function speakWithEngine(opts: SpeakOptions): Promise<SpeakResult> {
  const { signal, ...body } = opts;
  const res = await fetch(`${getServerUrl()}/tts/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res);

  const blob = await res.blob();
  // הכותרות האלה נחוצות כדי להציג למשתמש כמה זמן ההקראה לקחה. הן
  // נחשפות במפורש בשרת, אחרת הדפדפן מסתיר אותן.
  const seconds = Number(res.headers.get('X-Tts-Seconds') || '0');
  const elapsed = Number(res.headers.get('X-Tts-Elapsed') || '0');
  return { blob, seconds, elapsed };
}

/**
 * תיאור בעברית של מה שהמנוע ירוץ עליו.
 *
 * המשתמש אינו צריך לדעת את השמות הפנימיים, אבל כן צריך לדעת אם
 * ההקראה תהיה מהירה או איטית.
 */
export function describeProviders(providers: string[]): string {
  if (!providers.length) return 'לא ידוע';
  const first = providers[0] || '';
  if (first.startsWith('CUDA')) return 'כרטיס המסך — מהיר';
  if (first.startsWith('Dml')) return 'כרטיס המסך — מהיר';
  if (first.startsWith('CPU')) return 'המעבד בלבד — איטי';
  return first;
}

export interface CloneReport {
  name: string;
  seconds: number;
  sourceRate: number;
  frames: number;
  rms: number;
  peak: number;
  silenceFraction: number;
  highFreqEnergy: number;
  /** אורך הקובץ המקורי, לפני שנבחר ממנו קטע. */
  sourceSeconds: number;
  /** באיזו שנייה בקובץ המקורי הקטע שנבחר מתחיל. */
  windowStart: number;
  warnings: string[];
  path: string;
}

/**
 * יוצר קול חדש מהקלטה.
 *
 * מה שנשמר הוא **זהות הקול בלבד, לא ההגייה**. הקול החדש לא ידבר
 * אשכנזית מעצמו — ההגייה נקבעת על ידי הצלילים שנשלחים, וזה חלק
 * אחר של המערכת. זאת נקודה שקל לטעות בה ולצפות שההקלטה "תלמד"
 * את המבטא.
 */
export async function cloneVoice(opts: {
  file: File;
  name: string;
  note?: string;
  overwrite?: boolean;
  /**
   * מאיזו שנייה בקובץ לקחת.
   *
   * בלי זה המערכת בוחרת לבד את הקטע הרצוף ביותר של דיבור. זה נחוץ
   * בהקלטת שיעור ארוכה, שבה ההתחלה היא בדרך כלל שקט או פתיח.
   */
  startSeconds?: number;
  signal?: AbortSignal;
}): Promise<CloneReport> {
  const body = new FormData();
  body.append('audio', opts.file);
  body.append('name', opts.name);
  if (opts.note) body.append('note', opts.note);
  if (opts.overwrite) body.append('overwrite', 'true');
  if (opts.startSeconds !== undefined && opts.startSeconds > 0) {
    body.append('startSeconds', String(opts.startSeconds));
  }

  const res = await fetch(`${getServerUrl()}/tts/clone`, {
    method: 'POST',
    body,
    signal: opts.signal,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CloneReport;
}

/** מוחק קול משוכפל. קול שבא עם המנוע אינו נמחק. */
export async function deleteVoice(name: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/tts/voices/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await readError(res);
}
