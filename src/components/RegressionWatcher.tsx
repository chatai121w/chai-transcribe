/**
 * מתריע כשאיכות התמלול ירדה — מול השיא ההיסטורי, לא מול ההרצה
 * הקודמת.
 *
 * מה שהיה כאן, ולמה זה נשבר
 * --------------------------
 * הרכיב השווה כל הרצה חדשה להרצה שלפניה. זאת המלכודת הנפוצה
 * ביותר במעקב אחרי איכות, והיא מסתירה בדיוק את המקרה שחשוב לתפוס:
 *
 *     היינו ב-60. ירדנו ל-50. עלינו ל-55.
 *
 * ההשוואה לקודמת מראה שיפור של 5 — והודעת הצלחה נשלחת — בעוד
 * שבפועל אנחנו 5 מתחת למה שכבר הושג. הנסיגה האמיתית נשארת על
 * כנה, ומוצגת כהתקדמות.
 *
 * מה שיש עכשיו
 * ------------
 * ההשוואה היא מול הטוב ביותר שהושג אי פעם על אותה הקלטה ובאותו
 * סוג בדיקה. שלושה מצבים ולא שניים:
 *
 *     נסיגה      גרוע מהשיא — גם אם טוב מהקודמת.
 *     שיא חדש    טוב מהשיא. זה הדבר היחיד ששווה הודעת הצלחה.
 *     חזרה       טוב מהקודמת אך עדיין מתחת לשיא. הודעה מיידעת,
 *                לא מברכת — כדי שלא יישמע שהגענו לאן שהיינו.
 *
 * המצב השלישי הוא כל הסיפור. הקוד הקודם הציג אותו כהצלחה.
 *
 * שתי הערות נוספות
 * ----------------
 * המדדים כאן הם שיעורי שגיאה, ולכן נמוך הוא טוב והשיא הוא
 * המינימום.
 *
 * ההשוואה מוגבלת לאותו סוג בדיקה. הרצת שיפור אודיו והרצת זיהוי
 * דוברים על אותה הקלטה אינן מודדות את אותו דבר, והשוואה ביניהן
 * חסרת משמעות.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { addNotification } from '@/hooks/useNotifications';
import { getRunsByRecording, type ComparisonRun } from '@/lib/comparisonRuns';

// שינוי שמתחת לזה הוא רעש מדידה ולא תוצאה. 0.5 נקודות אחוז.
const THRESHOLD = 0.005;

function fmtPP(delta: number) {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)} נקודות`;
}

const KIND_LABELS: Record<string, string> = {
  audio_enhance: 'שיפור אודיו',
  transcribe_settings: 'הגדרות תמלול',
  asr_ground_truth: 'מול טקסט אמת',
  diarization: 'זיהוי דוברים',
};

/** המדד היחיד שלפיו נקבע מי טוב יותר. נמוך = טוב. */
function score(run: ComparisonRun): number | null {
  if (run.wer != null) return run.wer;
  if (run.cer != null) return run.cer;
  return null;
}

export default function RegressionWatcher() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`regression_watch_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comparison_runs',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const row = payload.new as ComparisonRun;
          if (!row?.id || handled.current.has(row.id)) return;
          handled.current.add(row.id);

          const now = score(row);
          if (now == null) return;

          try {
            const all = await getRunsByRecording(row.recording_fingerprint);
            const idx = all.findIndex(r => r.id === row.id);
            if (idx <= 0) return;

            // רק הרצות קודמות מאותו סוג בדיקה. סוג אחר מודד דבר אחר.
            const earlier = all
              .slice(0, idx)
              .filter(r => r.kind === row.kind && score(r) != null);
            if (!earlier.length) return;

            const previous = earlier[earlier.length - 1];
            const best = earlier.reduce((a, b) =>
              (score(b) as number) < (score(a) as number) ? b : a);

            const bestScore = score(best) as number;
            const prevScore = score(previous) as number;
            const vsBest = now - bestScore;   // חיובי = גרוע מהשיא
            const vsPrev = now - prevScore;

            const label = row.recording_label || row.recording_fingerprint.slice(0, 8);
            const kindLabel = KIND_LABELS[row.kind] ?? row.kind;
            const link =
              `/compare?tab=trends&fp=${encodeURIComponent(row.recording_fingerprint)}` +
              `&a=${best.id}&b=${row.id}`;

            // --- גרוע מהשיא. זאת נסיגה, גם אם זה טוב מהקודמת.
            if (vsBest > THRESHOLD) {
              const recovering = vsPrev < -THRESHOLD
                ? ` (טוב מההרצה הקודמת ב-${fmtPP(-vsPrev)}, אך עדיין מתחת לשיא)`
                : '';
              addNotification({
                type: 'warning',
                title: `נסיגה ב"${label}"`,
                description:
                  `${kindLabel} · ${fmtPP(vsBest)} מתחת לשיא שהושג ב-` +
                  `${(best.created_at ?? '').slice(0, 10)}${recovering}`,
                link,
                actionLabel: 'פתח השוואה',
                dedupeKey: `regress_${row.id}`,
              });
              return;
            }

            // --- טוב מהשיא. זה הדבר היחיד שראוי להודעת הצלחה.
            if (vsBest < -THRESHOLD) {
              addNotification({
                type: 'success',
                title: `שיא חדש ב"${label}"`,
                description: `${kindLabel} · ${fmtPP(vsBest)} מתחת לשיא הקודם`,
                link,
                actionLabel: 'פתח השוואה',
                dedupeKey: `record_${row.id}`,
              });
              return;
            }

            // --- בתוך טווח הרעש מול השיא. אין מה להודיע.
          } catch (err) {
            console.warn('[RegressionWatcher] failed', err);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user?.id, navigate]);

  return null;
}
