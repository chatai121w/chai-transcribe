/**
 * TrendsTab — the new heart of /compare.
 *
 * For each recording (identified by `recording_fingerprint`):
 *  - Line chart of WER / CER / term-recall over time
 *  - Sortable table of every run with timestamp, engine, hotwords count, scores
 *  - Compare-two-runs diff: see config drift and metric delta
 *  - Regression badge if latest is worse than first
 *
 * This is the answer to: "אם אני מוסיף מילים, האם באותה הקלטה יש שיפור בפעם
 * השנייה?". Every run is timestamped and grouped by recording, so trends are
 * obvious at a glance.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  TrendingDown, TrendingUp, Minus, Loader2, ChevronRight, ChevronDown,
  AlertTriangle, Trash2, GitCompare, BarChart3, Clock, FileAudio,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { useComparisonRuns } from '@/hooks/useComparisonRuns';
import {
  deleteRun, diffConfigs,
  type ComparisonRun, type RecordingGroup,
} from '@/lib/comparisonRuns';
import { toast } from '@/hooks/use-toast';

const KIND_LABELS: Record<string, string> = {
  audio_enhance: 'שיפור אודיו',
  transcribe_settings: 'הגדרות תמלול',
  asr_ground_truth: 'מול טקסט אמת',
  diarization: 'זיהוי דוברים',
};

function pct(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  try {
    return format(new Date(iso), 'dd/MM/yy HH:mm', { locale: he });
  } catch { return iso.slice(0, 16); }
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function TrendIcon({ trend }: { trend: RecordingGroup['trend'] }) {
  if (trend === 'improving') return <TrendingDown className="w-4 h-4 text-emerald-600" />;
  if (trend === 'regressing') return <TrendingUp className="w-4 h-4 text-red-500" />;
  if (trend === 'flat') return <Minus className="w-4 h-4 text-muted-foreground" />;
  return null;
}

export default function TrendsTab() {
  const { groups, loading, refresh } = useComparisonRuns();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [compareIds, setCompareIds] = useState<[string?, string?]>([undefined, undefined]);

  const filteredGroups = useMemo(() => {
    if (kindFilter === 'all') return groups;
    return groups
      .map(g => ({ ...g, runs: g.runs.filter(r => r.kind === kindFilter) }))
      .filter(g => g.runs.length > 0);
  }, [groups, kindFilter]);

  const compareA = useMemo(
    () => groups.flatMap(g => g.runs).find(r => r.id === compareIds[0]),
    [groups, compareIds],
  );
  const compareB = useMemo(
    () => groups.flatMap(g => g.runs).find(r => r.id === compareIds[1]),
    [groups, compareIds],
  );

  const totalRuns = useMemo(() => groups.reduce((sum, g) => sum + g.runs.length, 0), [groups]);
  const improvingCount = groups.filter(g => g.trend === 'improving').length;
  const regressingCount = groups.filter(g => g.trend === 'regressing').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        טוען היסטוריית הרצות…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground space-y-2">
          <BarChart3 className="w-10 h-10 mx-auto opacity-30" />
          <div>אין עדיין הרצות השוואה.</div>
          <div className="text-xs">
            כל הרצה ממערכות ההשוואה (שיפור אודיו / הגדרות תמלול / מול טקסט אמת / זיהוי דוברים) תופיע כאן אוטומטית, מקובצת לפי הקלטה.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<FileAudio className="w-4 h-4" />} label="הקלטות" value={String(groups.length)} />
        <StatCard icon={<BarChart3 className="w-4 h-4" />} label="סה״כ הרצות" value={String(totalRuns)} />
        <StatCard icon={<TrendingDown className="w-4 h-4 text-emerald-600" />} label="משתפר" value={String(improvingCount)} accent="text-emerald-600" />
        <StatCard icon={<TrendingUp className="w-4 h-4 text-red-500" />} label="ברגרסיה" value={String(regressingCount)} accent="text-red-500" />
      </div>

      {/* Filter + compare bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">סוג השוואה:</span>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכול</SelectItem>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>רענן</Button>
      </div>

      {/* Compare-two panel */}
      {(compareA || compareB) && (
        <Card className="border-yellow-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-yellow-600" />
              השוואת שתי הרצות
              <Button
                variant="ghost" size="sm" className="ms-auto"
                onClick={() => setCompareIds([undefined, undefined])}
              >נקה</Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompareTwoRuns a={compareA} b={compareB} />
          </CardContent>
        </Card>
      )}

      {/* Per-recording cards */}
      <div className="space-y-3">
        {filteredGroups.map(group => (
          <RecordingCard
            key={group.recording_fingerprint}
            group={group}
            expanded={expanded === group.recording_fingerprint}
            onToggle={() => setExpanded(prev =>
              prev === group.recording_fingerprint ? null : group.recording_fingerprint
            )}
            compareIds={compareIds}
            onCompareToggle={(runId) => {
              setCompareIds(prev => {
                if (prev[0] === runId) return [prev[1], undefined];
                if (prev[1] === runId) return [prev[0], undefined];
                if (!prev[0]) return [runId, prev[1]];
                if (!prev[1]) return [prev[0], runId];
                return [prev[1], runId]; // rotate
              });
            }}
            onDeleteRun={async (runId) => {
              if (!confirm('למחוק את ההרצה הזו לצמיתות?')) return;
              const ok = await deleteRun(runId);
              if (ok) {
                toast({ title: 'נמחק' });
                refresh();
              } else {
                toast({ title: 'מחיקה נכשלה', variant: 'destructive' });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: string; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}{label}
        </div>
        <div className={`text-2xl font-bold ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function RecordingCard({
  group, expanded, onToggle, compareIds, onCompareToggle, onDeleteRun,
}: {
  group: RecordingGroup;
  expanded: boolean;
  onToggle: () => void;
  compareIds: [string?, string?];
  onCompareToggle: (id: string) => void;
  onDeleteRun: (id: string) => void;
}) {
  const chartData = useMemo(() =>
    group.runs
      .filter(r => r.wer != null || r.cer != null || r.term_recall != null)
      .map((r, i) => ({
        idx: i + 1,
        date: fmtDate(r.created_at),
        WER: r.wer != null ? +(r.wer * 100).toFixed(2) : null,
        CER: r.cer != null ? +(r.cer * 100).toFixed(2) : null,
        'זיהוי מונחים': r.term_recall != null ? +(r.term_recall * 100).toFixed(2) : null,
      })),
    [group.runs],
  );

  const hasMetrics = chartData.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            {expanded ? <ChevronDown className="w-4 h-4 mt-1 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-1 shrink-0" />}
            <div className="min-w-0">
              <div className="font-semibold truncate flex items-center gap-2">
                <FileAudio className="w-4 h-4 shrink-0" />
                {group.recording_label}
                <TrendIcon trend={group.trend} />
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5 flex-wrap">
                <span><Clock className="w-3 h-3 inline ms-1" />{fmtDate(group.first_at)} → {fmtDate(group.last_at)}</span>
                <span>{group.runs.length} הרצות</span>
                {group.audio_duration_ms != null && <span>{fmtDuration(group.audio_duration_ms)}</span>}
                <span className="font-mono opacity-60">#{group.recording_fingerprint.slice(0, 8)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {group.bestWer != null && (
              <Badge variant="outline" className="text-xs">
                הכי טוב WER: <span className="font-mono ms-1">{pct(group.bestWer)}</span>
              </Badge>
            )}
            {group.delta != null && (
              <Badge
                variant={group.trend === 'regressing' ? 'destructive' : 'outline'}
                className="text-xs"
              >
                {group.trend === 'regressing' && <AlertTriangle className="w-3 h-3 me-1" />}
                Δ {group.delta >= 0 ? '+' : ''}{(group.delta * 100).toFixed(1)} pp
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {hasMetrics && (
            <div className="h-[200px] w-full" dir="ltr">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="WER" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="CER" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="זיהוי מונחים" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <ScrollArea className="max-h-[320px]">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-right p-1.5">תאריך</th>
                  <th className="text-right p-1.5">סוג</th>
                  <th className="text-right p-1.5">מנוע / מודל</th>
                  <th className="text-right p-1.5">Hotwords</th>
                  <th className="text-right p-1.5">תיקונים</th>
                  <th className="text-right p-1.5">WER</th>
                  <th className="text-right p-1.5">CER</th>
                  <th className="text-right p-1.5">מונחים</th>
                  <th className="text-right p-1.5">זמן</th>
                  <th className="text-right p-1.5">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {[...group.runs].reverse().map(r => {
                  const isSelected = compareIds.includes(r.id);
                  return (
                    <tr key={r.id} className={`border-b hover:bg-muted/50 ${isSelected ? 'bg-yellow-500/10' : ''}`}>
                      <td className="p-1.5 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="p-1.5"><Badge variant="outline" className="text-[10px]">{KIND_LABELS[r.kind] ?? r.kind}</Badge></td>
                      <td className="p-1.5">
                        <div className="truncate max-w-[140px]">{r.engine ?? '—'}</div>
                        {r.model && <div className="text-[10px] opacity-60 truncate max-w-[140px]">{r.model}</div>}
                      </td>
                      <td className="p-1.5 text-center">{r.hotwords_count ?? 0}</td>
                      <td className="p-1.5 text-center">{r.corrections_count ?? 0}</td>
                      <td className="p-1.5 font-mono">{pct(r.wer)}</td>
                      <td className="p-1.5 font-mono">{pct(r.cer)}</td>
                      <td className="p-1.5 font-mono">{pct(r.term_recall)}</td>
                      <td className="p-1.5">{r.elapsed_ms ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="p-1.5 whitespace-nowrap">
                        <Button
                          size="sm" variant={isSelected ? 'default' : 'ghost'}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => onCompareToggle(r.id)}
                        >השווה</Button>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2"
                          onClick={() => onDeleteRun(r.id)}
                        ><Trash2 className="w-3 h-3" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

function CompareTwoRuns({ a, b }: { a?: ComparisonRun; b?: ComparisonRun }) {
  if (!a || !b) {
    return (
      <div className="text-sm text-muted-foreground">
        בחרו <strong>שתי הרצות</strong> מהטבלאות למטה (לחיצה על "השווה") כדי לראות מה השתנה ביניהן.
        {(a || b) && <div className="mt-1 text-xs">נבחרה: <span className="font-mono">{(a || b)!.id.slice(0, 8)}</span></div>}
      </div>
    );
  }

  const configChanges = diffConfigs(a.config_snapshot, b.config_snapshot);
  const metricDelta = (ma: number | null, mb: number | null) =>
    ma != null && mb != null ? mb - ma : null;
  const fmtDelta = (d: number | null) => {
    if (d == null) return '—';
    const sign = d >= 0 ? '+' : '';
    const cls = d < 0 ? 'text-emerald-600' : d > 0 ? 'text-red-500' : 'text-muted-foreground';
    return <span className={`font-mono ${cls}`}>{sign}{(d * 100).toFixed(2)} pp</span>;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-muted/40 rounded p-2 space-y-1">
          <div className="text-xs text-muted-foreground">הרצה א׳ — {fmtDate(a.created_at)}</div>
          <div>WER: <span className="font-mono">{pct(a.wer)}</span></div>
          <div>CER: <span className="font-mono">{pct(a.cer)}</span></div>
          <div>מונחים: <span className="font-mono">{pct(a.term_recall)}</span></div>
          <div className="text-xs text-muted-foreground">{a.engine} {a.model && `· ${a.model}`}</div>
          <div className="text-xs">Hotwords: {a.hotwords_count} · תיקונים: {a.corrections_count}</div>
        </div>
        <div className="bg-muted/40 rounded p-2 space-y-1">
          <div className="text-xs text-muted-foreground">הרצה ב׳ — {fmtDate(b.created_at)}</div>
          <div>WER: <span className="font-mono">{pct(b.wer)}</span></div>
          <div>CER: <span className="font-mono">{pct(b.cer)}</span></div>
          <div>מונחים: <span className="font-mono">{pct(b.term_recall)}</span></div>
          <div className="text-xs text-muted-foreground">{b.engine} {b.model && `· ${b.model}`}</div>
          <div className="text-xs">Hotwords: {b.hotwords_count} · תיקונים: {b.corrections_count}</div>
        </div>
      </div>

      <div className="bg-muted/20 rounded p-2 text-sm space-y-1">
        <div className="font-semibold mb-1">Δ מדדים (ב׳ פחות א׳ — שלילי = שיפור):</div>
        <div className="grid grid-cols-3 gap-2">
          <div>WER: {fmtDelta(metricDelta(a.wer, b.wer))}</div>
          <div>CER: {fmtDelta(metricDelta(a.cer, b.cer))}</div>
          <div>מונחים: {fmtDelta(metricDelta(a.term_recall, b.term_recall))}</div>
        </div>
      </div>

      {configChanges.length > 0 && (
        <div className="bg-muted/20 rounded p-2 text-sm">
          <div className="font-semibold mb-1">מה השתנה בהגדרות:</div>
          <ul className="space-y-0.5 text-xs font-mono">
            {configChanges.map(c => (
              <li key={c.key}>
                <span className="text-muted-foreground">{c.key}:</span>{' '}
                <span className="text-red-500">{JSON.stringify(c.from) ?? '∅'}</span>
                {' → '}
                <span className="text-emerald-600">{JSON.stringify(c.to) ?? '∅'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.recording_fingerprint !== b.recording_fingerprint && (
        <div className="text-xs text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          שימו לב: שתי ההרצות הן מהקלטות שונות — השוואת המדדים פחות משמעותית.
        </div>
      )}
    </div>
  );
}
