/**
 * ProfileConfidenceChart
 * ──────────────────────
 * Visualizes the learning curve of a pronunciation profile:
 *   - Bar per day showing how many corrections were added
 *   - Line of average confidence (0..100%) of corrections active that day
 */

import { useMemo } from 'react';
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { getProfileCorrections } from '@/lib/pronunciationProfiles';

interface DayBucket {
  day: string;        // YYYY-MM-DD
  added: number;
  totalConfidence: number;
  count: number;
  avgConfidence: number;
}

function formatDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ProfileConfidenceChart = ({ profileId }: { profileId: string }) => {
  const data = useMemo(() => {
    const corrections = getProfileCorrections(profileId);
    if (corrections.length === 0) return [];

    const map = new Map<string, DayBucket>();
    // Walk full history: every correction was "added" on its createdAt day.
    for (const c of corrections) {
      const day = formatDay(c.createdAt || Date.now());
      const b = map.get(day) || { day, added: 0, totalConfidence: 0, count: 0, avgConfidence: 0 };
      b.added += 1;
      b.totalConfidence += c.confidence ?? 0.5;
      b.count += 1;
      map.set(day, b);
    }
    const sorted = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
    for (const b of sorted) {
      b.avgConfidence = b.count > 0 ? Math.round((b.totalConfidence / b.count) * 100) : 0;
    }
    // Cap to last 60 days for readability.
    return sorted.slice(-60);
  }, [profileId]);

  if (data.length === 0) {
    return (
      <div className="text-center text-xs text-muted-foreground py-12 border border-dashed border-border/60 rounded-lg">
        עדיין אין מספיק נתונים להצגת גרף. למד תיקונים ראשונים והגרף יתמלא.
      </div>
    );
  }

  return (
    <div className="w-full h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(v) => v.slice(5)}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            label={{ value: 'תיקונים', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            label={{ value: '%', angle: 90, position: 'insideRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Bar yAxisId="left" dataKey="added" name="תיקונים שנוספו" fill="hsl(var(--primary))" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgConfidence"
            name="ביטחון ממוצע %"
            stroke="hsl(142, 76%, 36%)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
