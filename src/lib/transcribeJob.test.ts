import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_KEY, describeJob, forgetJob, isWorthResuming, jobStreamUrl,
  JOB_MEMORY_MAX_AGE_MS, readJobRecord, readRememberedJob, rememberJob, updateJobProgress,
  type JobSnapshot,
} from './transcribeJob';

/**
 * זיכרון המשימה הפעילה.
 *
 * ההבטחות שאפשר לשבור בשקט, ושכל אחת מהן עולה למשתמש עבודה:
 *
 *   רשומה פגומה      אם היא נשארת, היא תפריע בכל פתיחה של הדף — ואז
 *   אינה נדבקת        המשתמש רואה הצעה לחזור למשימה שאינה קיימת.
 *
 *   מספר של אתמול    השרת שומר משימות שעתיים. הצעה לחזור למשהו שנמחק
 *   אינו מוצע         היא הבטחה שתיכשל.
 *
 *   המקום נשמר       דף שקיבל 40 שורות וחוזר מאפס יראה את הטקסט
 *                     מתחיל מחדש. זה נראה כמו תקלה.
 */

beforeEach(() => {
  localStorage.clear();
});

const snap = (over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id: 'abc', status: 'running', progress: 40, segments: 10, words: 300, ...over,
});

describe('שמירה וקריאה', () => {
  it('מה שנשמר נקרא בחזרה', () => {
    rememberJob({ jobId: 'abc123', fileName: 'שיעור.mp3', startedAt: 1000, received: 7 });
    const back = readRememberedJob(2000);
    expect(back).toEqual({ jobId: 'abc123', fileName: 'שיעור.mp3', startedAt: 1000, received: 7 });
  });

  it('כשאין כלום מוחזר כלום', () => {
    expect(readRememberedJob()).toBeNull();
  });

  it('מחיקה באמת מוחקת', () => {
    rememberJob({ jobId: 'abc', fileName: '', startedAt: Date.now(), received: 0 });
    forgetJob();
    expect(readRememberedJob()).toBeNull();
  });
});

describe('רשומה פגומה אינה נדבקת', () => {
  it('טקסט שאינו תקין נמחק ואינו מפיל', () => {
    localStorage.setItem(ACTIVE_JOB_KEY, '{לא תקין');
    expect(readRememberedJob()).toBeNull();
    // חשוב שהיא גם נעלמה, אחרת תחזור בכל פתיחה
    expect(localStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
  });

  it('רשומה בלי מספר משימה נמחקת', () => {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ fileName: 'א.mp3' }));
    expect(readRememberedJob()).toBeNull();
    expect(localStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
  });

  it('מספר ריק נחשב לחסר', () => {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: '', startedAt: Date.now() }));
    expect(readRememberedJob()).toBeNull();
  });

  it('שדות חסרים מקבלים ברירת מחדל שפויה', () => {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: 'abc', startedAt: 500 }));
    const back = readRememberedJob(600);
    expect(back?.jobId).toBe('abc');
    expect(back?.received).toBe(0);
    expect(back?.fileName).toBe('');
  });

  it('מספר שורות שלילי אינו עובר', () => {
    // בקשה משורה שלילית הייתה חוזרת לאפס ומכפילה את הטקסט.
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: 'abc', startedAt: 500, received: -5 }));
    expect(readRememberedJob(600)?.received).toBe(0);
  });
});

describe('גבול הזמן', () => {
  it('משימה טרייה נשמרת', () => {
    rememberJob({ jobId: 'abc', fileName: '', startedAt: 1000, received: 0 });
    expect(readRememberedJob(1000 + JOB_MEMORY_MAX_AGE_MS - 1)).not.toBeNull();
  });

  it('משימה שעבר זמנה אינה מוצעת ונמחקת', () => {
    rememberJob({ jobId: 'abc', fileName: '', startedAt: 1000, received: 0 });
    expect(readRememberedJob(1000 + JOB_MEMORY_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
  });

  it('רשומה בלי זמן התחלה נחשבת ישנה', () => {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: 'abc' }));
    expect(readRememberedJob(Date.now())).toBeNull();
  });
});

describe('שמירת המקום', () => {
  it('עדכון המקום אינו דורס את שם הקובץ', () => {
    rememberJob({ jobId: 'abc', fileName: 'שיעור.mp3', startedAt: 1000, received: 0 });
    updateJobProgress(42);
    const back = readRememberedJob(2000);
    expect(back?.received).toBe(42);
    expect(back?.fileName).toBe('שיעור.mp3');
    expect(back?.jobId).toBe('abc');
  });

  it('עדכון כשאין משימה אינו יוצר אחת', () => {
    updateJobProgress(5);
    expect(readRememberedJob()).toBeNull();
  });

  it('עדכון אינו מוחק רשומה ותיקה', () => {
    // זה היה שבור: העדכון קרא דרך בדיקת הגיל, ולכן עבודה שרצה
    // זמן רב נמחקה בשקט בדיוק בזמן שהיא התקדמה.
    rememberJob({ jobId: 'abc', fileName: 'ארוך.mp3', startedAt: 1, received: 10 });
    updateJobProgress(500);
    expect(readJobRecord()?.received).toBe(500);
    expect(readJobRecord()?.jobId).toBe('abc');
  });
});

describe('האם כדאי לחזור', () => {
  it('משימה שרצה — כן', () => {
    expect(isWorthResuming(snap({ status: 'running' }))).toBe(true);
  });

  it('משימה שנגמרה — כן, זאת כל המטרה', () => {
    expect(isWorthResuming(snap({ status: 'done' }))).toBe(true);
  });

  it('משימה שנפלה — אין מה לחזור אליה', () => {
    expect(isWorthResuming(snap({ status: 'error' }))).toBe(false);
  });

  it('אין משימה — אין מה להציע', () => {
    expect(isWorthResuming(null)).toBe(false);
  });
});

describe('כתובת ההתחברות', () => {
  it('נבנית עם המקום המבוקש', () => {
    expect(jobStreamUrl('http://x:3000', 'abc', 12))
      .toBe('http://x:3000/transcribe-job/abc/stream?from=12');
  });

  it('מספר שלילי אינו נכנס לכתובת', () => {
    expect(jobStreamUrl('http://x:3000', 'abc', -4)).toContain('from=0');
  });

  it('שבריר מעוגל כלפי מטה — עדיף לקבל שורה פעמיים מלדלג עליה', () => {
    expect(jobStreamUrl('http://x:3000', 'abc', 7.9)).toContain('from=7');
  });

  it('מספר עם תווים מיוחדים מקודד', () => {
    expect(jobStreamUrl('http://x:3000', 'a b/c', 0)).toContain('a%20b%2Fc');
  });
});

describe('מה שהמשתמש קורא', () => {
  it('משימה שרצה מתוארת עם האחוז', () => {
    const text = describeJob(snap({ status: 'running', progress: 60, filename: 'שיעור.mp3' }));
    expect(text).toContain('שיעור.mp3');
    expect(text).toContain('60%');
  });

  it('משימה שנגמרה מתוארת עם מספר המילים', () => {
    const text = describeJob(snap({ status: 'done', words: 1672, filename: 'שיעור.mp3' }));
    expect(text).toContain('1672');
    expect(text).toContain('הסתיים');
  });

  it('שגיאה מוצגת עם הנוסח שלה', () => {
    const text = describeJob(snap({ status: 'error', error: 'כרטיס המסך מלא' }));
    expect(text).toContain('כרטיס המסך מלא');
  });

  it('שגיאה בלי נוסח אינה מציגה חור', () => {
    const text = describeJob(snap({ status: 'error', error: null }));
    expect(text).not.toContain('null');
    expect(text).toContain('שגיאה');
  });

  it('בלי שם קובץ הטקסט עדיין נקרא', () => {
    const text = describeJob(snap({ status: 'running', filename: '' }));
    expect(text).not.toContain('של ');
    expect(text.length).toBeGreaterThan(5);
  });

  it('אין אנגלית בטקסט שהמשתמש רואה', () => {
    for (const s of [
      snap({ status: 'running' }),
      snap({ status: 'done' }),
      snap({ status: 'error', error: null }),
    ]) {
      // שם הקובץ עלול להיות באנגלית, ולכן בודקים בלי שם.
      expect(describeJob({ ...s, filename: '' })).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});
