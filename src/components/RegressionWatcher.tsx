/**
 * RegressionWatcher — listens to comparison_runs inserts and fires an
 * in-app notification when WER or CER got worse vs the previous run for
 * the same recording. The notification deep-links to /compare?tab=trends
 * with the recording fingerprint and both run ids preselected for compare.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { addNotification } from '@/hooks/useNotifications';
import { getRunsByRecording, type ComparisonRun } from '@/lib/comparisonRuns';

// Significant change threshold: 0.5 percentage points (0.005 in ratio space).
const THRESHOLD = 0.005;

function fmtPP(delta: number) {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)} pp`;
}

const KIND_LABELS: Record<string, string> = {
  audio_enhance: 'שיפור אודיו',
  transcribe_settings: 'הגדרות תמלול',
  asr_ground_truth: 'מול טקסט אמת',
  diarization: 'זיהוי דוברים',
};

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
          if (row.wer == null && row.cer == null) return;

          try {
            const runs = await getRunsByRecording(row.recording_fingerprint);
            // previous run = newest before this one, with at least one comparable metric
            const idx = runs.findIndex(r => r.id === row.id);
            if (idx <= 0) return;
            let prev: ComparisonRun | null = null;
            for (let i = idx - 1; i >= 0; i--) {
              if (runs[i].wer != null || runs[i].cer != null) { prev = runs[i]; break; }
            }
            if (!prev) return;

            const dWer = row.wer != null && prev.wer != null ? row.wer - prev.wer : null;
            const dCer = row.cer != null && prev.cer != null ? row.cer - prev.cer : null;

            const werRegressed = dWer != null && dWer > THRESHOLD;
            const cerRegressed = dCer != null && dCer > THRESHOLD;
            const werImproved  = dWer != null && dWer < -THRESHOLD;
            const cerImproved  = dCer != null && dCer < -THRESHOLD;

            if (!werRegressed && !cerRegressed && !werImproved && !cerImproved) return;

            const label = row.recording_label || row.recording_fingerprint.slice(0, 8);
            const kindLabel = KIND_LABELS[row.kind] ?? row.kind;
            const link = `/compare?tab=trends&fp=${encodeURIComponent(row.recording_fingerprint)}&a=${prev.id}&b=${row.id}`;

            if (werRegressed || cerRegressed) {
              const parts: string[] = [];
              if (dWer != null) parts.push(`WER ${fmtPP(dWer)}`);
              if (dCer != null) parts.push(`CER ${fmtPP(dCer)}`);
              addNotification({
                type: 'warning',
                title: `רגרסיה ב"${label}"`,
                description: `${kindLabel} · ${parts.join(' · ')} מול ההרצה הקודמת`,
                link,
                actionLabel: 'פתח השוואה',
                dedupeKey: `regress_${row.id}`,
              });
            } else {
              const parts: string[] = [];
              if (dWer != null) parts.push(`WER ${fmtPP(dWer)}`);
              if (dCer != null) parts.push(`CER ${fmtPP(dCer)}`);
              addNotification({
                type: 'success',
                title: `שיפור ב"${label}"`,
                description: `${kindLabel} · ${parts.join(' · ')} מול ההרצה הקודמת`,
                link,
                actionLabel: 'פתח השוואה',
                dedupeKey: `improve_${row.id}`,
              });
            }
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
