/**
 * זיכרון המשימה הפעילה — כדי שדף שנסגר ידע לאן לחזור.
 *
 * הרקע: התמלול רץ עכשיו בשרת ולא בדף. זה אומר שהוא לא נעלם כשסוגרים
 * את הדף — אבל זה גם אומר שהדף שנפתח מחדש צריך לדעת שיש עבודה ממתינה,
 * ומה המספר שלה. שם ברשימת המשימות של השרת לא מספיק: ייתכנו כמה,
 * וגם צריך לדעת איזו שייכת לדף הזה.
 *
 * לכן המספר נשמר במחשב של המשתמש. זה החלק היחיד שצריך לשרוד סגירה,
 * והוא קטן: מספר, שם הקובץ, וזמן.
 *
 * למה יש גבול זמן: מספר של אתמול הוא רעש. השרת שומר משימות שעתיים,
 * ואין טעם להציע משהו שכבר נמחק משם.
 */

/** המפתח שבו נשמרת המשימה הפעילה בזיכרון הדפדפן. */
export const ACTIVE_JOB_KEY = 'active_transcribe_job';

/** מעבר לזה — המשימה כבר לא שם, ואין טעם להציע אותה. */
export const JOB_MEMORY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface RememberedJob {
  jobId: string;
  fileName: string;
  startedAt: number;
  /** כמה שורות הדף כבר קיבל — משם הוא ימשיך. */
  received: number;
}

export interface JobSnapshot {
  id: string;
  status: 'running' | 'done' | 'error';
  filename?: string;
  progress?: number;
  segments?: number;
  words?: number;
  duration?: number;
  error?: string | null;
  event_count?: number;
}

/**
 * שומר את המשימה.
 *
 * כל הגישות לזיכרון הדפדפן עטופות: בחלון פרטי, או כשהמשתמש חסם
 * אחסון, הקריאה זורקת. אין סיבה שתמלול ייפול בגלל זה — במצב כזה
 * פשוט לא תהיה אפשרות לחזור.
 */
export function rememberJob(job: RememberedJob): void {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  } catch {
    // אין אחסון — ממשיכים בלי אפשרות חזרה
  }
}

/**
 * מעדכן כמה שורות התקבלו, בלי לדרוס את השאר.
 *
 * העדכון קורא את הרשומה בלי בדיקת גיל בכוונה. בדיקת הגיל נועדה
 * למנוע *הצעה* למשימה שהשרת כבר מחק — ובתוך עדכון שוטף היא עשתה
 * דבר אחר לגמרי: מחקה את הרשומה של עבודה שרצה באותו רגע, ובכך
 * הרסה בשקט את היכולת לחזור אליה.
 */
export function updateJobProgress(received: number): void {
  const job = readJobRecord();
  if (!job) return;
  rememberJob({ ...job, received });
}

export function forgetJob(): void {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // אין אחסון
  }
}

/**
 * קורא את הרשומה השמורה בלי בדיקת גיל.
 *
 * רשומה פגומה נמחקת כאן, כי אחרת היא תחזור ותפריע בכל פתיחה של הדף.
 */
export function readJobRecord(): RememberedJob | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ACTIVE_JOB_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    forgetJob();
    return null;
  }

  const job = parsed as Partial<RememberedJob>;
  if (!job || typeof job.jobId !== 'string' || !job.jobId) {
    forgetJob();
    return null;
  }

  return {
    jobId: job.jobId,
    fileName: typeof job.fileName === 'string' ? job.fileName : '',
    startedAt: typeof job.startedAt === 'number' ? job.startedAt : 0,
    received: typeof job.received === 'number' && job.received >= 0 ? job.received : 0,
  };
}

/**
 * קורא את המשימה השמורה כדי להציע אותה למשתמש — או כלום אם אין,
 * אם היא פגומה, או אם עבר זמנה.
 */
export function readRememberedJob(now: number = Date.now()): RememberedJob | null {
  const job = readJobRecord();
  if (!job) return null;
  if (now - job.startedAt > JOB_MEMORY_MAX_AGE_MS) {
    forgetJob();
    return null;
  }
  return job;
}

/**
 * האם כדאי להציע למשתמש לחזור למשימה הזאת.
 *
 * רצה — בוודאי. נגמרה בהצלחה — כן, כי זאת בדיוק המטרה: לסגור את
 * הדף, לחזור, ולמצוא את התמלול מוכן. נפלה בשגיאה — אין מה להציע,
 * רק להודיע.
 */
export function isWorthResuming(snap: JobSnapshot | null): boolean {
  if (!snap) return false;
  return snap.status === 'running' || snap.status === 'done';
}

/** כתובת ההתחברות למשימה, מהמקום שהדף הגיע אליו. */
export function jobStreamUrl(baseUrl: string, jobId: string, fromIndex = 0): string {
  const from = Math.max(0, Math.floor(fromIndex));
  return `${baseUrl}/transcribe-job/${encodeURIComponent(jobId)}/stream?from=${from}`;
}

/** איך לתאר למשתמש משימה שממתינה לו. */
export function describeJob(snap: JobSnapshot, fileName = ''): string {
  const name = snap.filename || fileName;
  const of = name ? ` של ${name}` : '';
  if (snap.status === 'done') {
    const words = snap.words ? ` — ${snap.words} מילים` : '';
    return `התמלול${of} הסתיים${words}`;
  }
  if (snap.status === 'error') {
    return `התמלול${of} נפל: ${snap.error || 'שגיאה לא מזוהה'}`;
  }
  const pct = typeof snap.progress === 'number' ? ` (${snap.progress}%)` : '';
  return `תמלול${of} ממשיך לרוץ בשרת${pct}`;
}
