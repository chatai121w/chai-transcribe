import { useState, useEffect, useRef, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Terminal, AlertTriangle, TrendingUp, Activity, Shield, ShieldAlert, ShieldCheck,
  ChevronDown, ChevronUp, Copy, Trash2, X, Eye, EyeOff, RefreshCw, Filter,
  Bug, Server, Zap, Clock, AlertCircle, CheckCircle, XCircle, Info
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, AreaChart, Area } from 'recharts';
import { debugLog, type LogEntry } from '@/lib/debugLogger';
import { useSmartConsole, type ConsoleAlert, type SystemHealth } from '@/hooks/useSmartConsole';
import { spinnerDetector } from '@/lib/spinnerDetector';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const levelColor: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

const levelBg: Record<string, string> = {
  info: 'bg-blue-950/20',
  warn: 'bg-yellow-950/20',
  error: 'bg-red-950/20',
};

const severityColor: Record<string, string> = {
  info: 'text-blue-500 border-blue-500/30',
  warning: 'text-amber-500 border-amber-500/30',
  critical: 'text-red-500 border-red-500/30',
};

const severityBg: Record<string, string> = {
  info: 'bg-blue-500/5',
  warning: 'bg-amber-500/5',
  critical: 'bg-red-500/10',
};

const healthIcons: Record<string, typeof ShieldCheck> = {
  healthy: ShieldCheck,
  degraded: Shield,
  critical: ShieldAlert,
};

const healthColors: Record<string, string> = {
  healthy: 'text-green-500',
  degraded: 'text-amber-500',
  critical: 'text-red-500',
};

const healthLabels: Record<string, string> = {
  healthy: 'תקין',
  degraded: 'לא יציב',
  critical: 'קריטי',
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('he-IL', { hour12: false } as Intl.DateTimeFormatOptions);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

// --- Health Status Bar ---
function HealthBar({ health }: { health: SystemHealth }) {
  const Icon = healthIcons[health.status] || ShieldCheck;
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/30 flex-wrap">
      <div className={`flex items-center gap-1.5 ${healthColors[health.status]}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <span className="text-sm font-semibold whitespace-nowrap">{healthLabels[health.status]}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1 whitespace-nowrap">
          <Server className="w-3 h-3 shrink-0" />
          שרת: {health.serverUp ? <span className="text-green-500">פעיל</span> : <span className="text-red-500">מנותק</span>}
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <AlertCircle className="w-3 h-3 shrink-0" />
          שגיאות/דק׳: <span className={health.errorRate > 2 ? 'text-red-500 font-bold' : ''}>{health.errorRate.toFixed(1)}</span>
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          התראות: {health.activeAlerts}
        </span>
      </div>
    </div>
  );
}

// --- Live Log Tab ---
function LiveLogTab({ entries }: { entries: LogEntry[] }) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => {
    const s = new Set(entries.map(e => e.source));
    return ['all', ...Array.from(s).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (filter !== 'all' && e.level !== filter) return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      return true;
    });
  }, [entries, filter, sourceFilter]);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCopy = async () => {
    const text = debugLog.toText();
    if (!text) { toast({ title: 'אין לוגים' }); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'הועתק!', description: 'כל הלוגים הועתקו ללוח' });
    } catch { toast({ title: 'שגיאה בהעתקה', variant: 'destructive' }); }
  };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {(['all', 'error', 'warn', 'info'] as const).map(level => (
            <Button
              key={level}
              variant={filter === level ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setFilter(level)}
            >
              {level === 'all' ? 'הכל' : level === 'error' ? '🔴 שגיאות' : level === 'warn' ? '🟡 אזהרות' : '🔵 מידע'}
            </Button>
          ))}
        </div>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="h-7 text-xs px-2 rounded-md border bg-background"
        >
          {sources.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'כל המקורות' : s}</option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
          <Copy className="w-3 h-3 ml-1" />העתק
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { debugLog.clear(); toast({ title: 'לוגים נוקו' }); }}>
          <Trash2 className="w-3 h-3 ml-1" />נקה
        </Button>
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground">
        מציג {filtered.length} מתוך {entries.length} רשומות
      </div>

      {/* Log entries */}
      <div className="rounded-md border overflow-hidden max-h-[55vh]" dir="ltr">
        <ScrollArea className="max-h-[55vh]" ref={scrollRef}>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No logs matching filter</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(entry => (
                <div
                  key={entry.id}
                  className={`px-3 py-1.5 text-xs font-mono cursor-pointer hover:bg-muted/30 ${levelBg[entry.level] ?? ''}`}
                  onClick={() => entry.details && toggleExpand(entry.id)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">{formatTime(entry.timestamp)}</span>
                    <span className={`font-bold uppercase w-12 ${levelColor[entry.level] ?? ''}`}>{entry.level}</span>
                    <span className="text-muted-foreground">[{entry.source}]</span>
                    <span className="flex-1 break-words">{entry.message}</span>
                    {entry.details && (
                      expandedIds.has(entry.id) ? <ChevronUp className="w-3 h-3 mt-0.5 shrink-0" /> : <ChevronDown className="w-3 h-3 mt-0.5 shrink-0" />
                    )}
                  </div>
                  {entry.details && expandedIds.has(entry.id) && (
                    <pre className="mt-1 p-2 bg-muted/50 rounded text-[10px] whitespace-pre-wrap overflow-x-auto max-h-40">
                      {entry.details}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

// --- Alerts Tab ---
function AlertsTab({ alerts, onDismiss, onClearAll }: { alerts: ConsoleAlert[]; onDismiss: (id: string) => void; onClearAll: () => void }) {
  const [showDismissed, setShowDismissed] = useState(false);
  const visible = showDismissed ? alerts : alerts.filter(a => !a.dismissed);

  const alertTypeIcons: Record<string, typeof AlertTriangle> = {
    'recurring-error': RefreshCw,
    'error-spike': Zap,
    'server-down': Server,
    'slow-transcription': Clock,
    'high-failure-rate': XCircle,
    'memory-warning': AlertCircle,
  };

  const alertTypeLabels: Record<string, string> = {
    'recurring-error': 'שגיאה חוזרת',
    'error-spike': 'עלייה בשגיאות',
    'server-down': 'שרת מנותק',
    'slow-transcription': 'תמלול איטי',
    'high-failure-rate': 'שיעור כישלון גבוה',
    'memory-warning': 'אזהרת זיכרון',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {alerts.filter(a => !a.dismissed).length} פעילות
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowDismissed(!showDismissed)}
          >
            {showDismissed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showDismissed ? 'הסתר שנדחו' : 'הצג שנדחו'}
          </Button>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3 h-3 ml-1" />נקה הכל
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>מחיקת כל ההתראות?</AlertDialogTitle>
              <AlertDialogDescription>פעולה זו תמחק את כל ההתראות. לא ניתן לשחזר.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={onClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">אין התראות פעילות — המערכת תקינה</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(alert => {
            const Icon = alertTypeIcons[alert.type] || AlertTriangle;
            return (
              <Card
                key={alert.id}
                className={`p-3 border ${alert.dismissed ? 'opacity-50' : ''} ${severityBg[alert.severity] || ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 ${severityColor[alert.severity]?.split(' ')[0] || 'text-muted-foreground'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-medium break-words">{alert.title}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${severityColor[alert.severity] || ''}`}
                      >
                        {alertTypeLabels[alert.type] || alert.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">{alert.description}</p>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      {formatTime(alert.timestamp)} — לפני {timeAgo(alert.timestamp)}
                    </span>
                  </div>
                  {!alert.dismissed && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => onDismiss(alert.id)}
                      title="דחה"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Trends Tab ---
function TrendsTab({ trends, sourceStats }: {
  trends: Array<{ period: string; errors: number; warnings: number; infos: number }>;
  sourceStats: Array<{ source: string; total: number; errors: number; warns: number; infos: number }>;
}) {
  return (
    <div className="space-y-6">
      {/* Timeline Chart */}
      <div>
        <h3 className="text-sm font-medium mb-3 text-muted-foreground">התפלגות לאורך זמן (60 דקות)</h3>
        <Card className="p-4">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trends} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RechartsTooltip contentStyle={{ direction: 'rtl', fontSize: 11 }} />
              <Area type="monotone" dataKey="errors" name="שגיאות" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} stackId="1" />
              <Area type="monotone" dataKey="warnings" name="אזהרות" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} stackId="1" />
              <Area type="monotone" dataKey="infos" name="מידע" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} stackId="1" />
              <Legend />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Source Breakdown */}
      <div>
        <h3 className="text-sm font-medium mb-3 text-muted-foreground">לוגים לפי מקור</h3>
        {sourceStats.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-4">אין נתונים</p>
        ) : (
          <>
            <Card className="p-4 mb-3">
              <ResponsiveContainer width="100%" height={Math.max(120, sourceStats.length * 35)}>
                <BarChart data={sourceStats} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="source" width={100} tick={{ fontSize: 10 }} />
                  <RechartsTooltip contentStyle={{ direction: 'rtl', fontSize: 11 }} />
                  <Bar dataKey="errors" name="שגיאות" fill="#ef4444" stackId="a" />
                  <Bar dataKey="warns" name="אזהרות" fill="#f59e0b" stackId="a" />
                  <Bar dataKey="infos" name="מידע" fill="#3b82f6" stackId="a" radius={[0, 4, 4, 0]} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">מקור</TableHead>
                    <TableHead className="text-center">סה״כ</TableHead>
                    <TableHead className="text-center">🔴</TableHead>
                    <TableHead className="text-center">🟡</TableHead>
                    <TableHead className="text-center">🔵</TableHead>
                    <TableHead className="text-center">שיעור שגיאות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceStats.map(s => (
                    <TableRow key={s.source} className={s.errors > 5 ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-right font-mono text-xs">{s.source}</TableCell>
                      <TableCell className="text-center">{s.total}</TableCell>
                      <TableCell className="text-center text-red-500">{s.errors || '—'}</TableCell>
                      <TableCell className="text-center text-yellow-500">{s.warns || '—'}</TableCell>
                      <TableCell className="text-center text-blue-500">{s.infos || '—'}</TableCell>
                      <TableCell className="text-center">
                        {s.total > 0 ? (
                          <span className={s.errors / s.total > 0.3 ? 'text-red-500 font-bold' : ''}>
                            {((s.errors / s.total) * 100).toFixed(0)}%
                          </span>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Patterns Tab ---
function PatternsTab({ patterns }: {
  patterns: Array<{ message: string; source: string; count: number; firstSeen: number; lastSeen: number; frequency: number }>;
}) {
  if (patterns.length === 0) {
    return (
      <Card className="p-8 text-center">
        <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">לא זוהו דפוסי שגיאות חוזרות</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">דפוסי שגיאות שחוזרים על עצמם בשעה האחרונה:</p>
      {patterns.map((p, i) => (
        <Card key={i} className={`p-3 ${p.count >= 10 ? 'border-red-500/40 bg-red-500/5' : p.count >= 5 ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
          <div className="flex items-start gap-3">
            <div className={`mt-1 flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
              p.count >= 10 ? 'bg-red-500/20 text-red-500' : p.count >= 5 ? 'bg-amber-500/20 text-amber-500' : 'bg-muted text-muted-foreground'
            }`}>
              {p.count}x
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px]">{p.source}</Badge>
                <span className="text-[10px] text-muted-foreground">{p.frequency.toFixed(1)}/דקה</span>
              </div>
              <p className="text-xs font-mono break-all leading-relaxed">{p.message}</p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                <span>ראשון: {formatTime(p.firstSeen)}</span>
                <span>אחרון: {formatTime(p.lastSeen)}</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// --- Spinner Detector Tab ---
function SpinnerTab() {
  const [enabled, setEnabled] = useState(spinnerDetector.isEnabled());
  const [activeSpinners, setActiveSpinners] = useState(spinnerDetector.getActiveSpinners());

  useEffect(() => {
    const unsub = spinnerDetector.subscribe(setEnabled);
    return unsub;
  }, []);

  // Refresh active spinners every second when enabled
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setActiveSpinners(spinnerDetector.getActiveSpinners()), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">🔍 זיהוי ספינרים והשהויות</h3>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">
              מזהה ספינרים ב-DOM, עוקב אחרי משך הצגה, ומנטר בקשות רשת איטיות
            </p>
          </div>
          <Button
            variant={enabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => spinnerDetector.toggle()}
            className={`gap-1.5 ${enabled ? 'bg-green-600 hover:bg-green-700' : ''}`}
          >
            {enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {enabled ? 'פעיל' : 'כבוי'}
          </Button>
        </div>
      </Card>

      {enabled && (
        <>
          {/* What it monitors */}
          <Card className="p-3 bg-muted/30">
            <p className="text-xs font-medium mb-1.5">מה נבדק:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-blue-500" />
                <span>ספינרים (animate-spin)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-amber-500" />
                <span>משך הצגת ספינר</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-yellow-500" />
                <span>בקשות רשת איטיות ({'>'}3s)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 text-red-500" />
                <span>בקשות שנכשלו</span>
              </div>
            </div>
            <Separator className="my-2" />
            <div className="text-[10px] text-muted-foreground space-y-0.5 break-words">
              <div>⚠ אזהרה אחרי 5 שניות ספינר</div>
              <div>🚨 שגיאה אחרי 15 שניות ספינר</div>
              <div>🐌 בקשת רשת מעל 3 שניות מדווחת</div>
            </div>
          </Card>

          {/* Active Spinners */}
          <div>
            <h3 className="text-sm font-medium mb-2">ספינרים פעילים כרגע:</h3>
            {activeSpinners.length === 0 ? (
              <Card className="p-6 text-center">
                <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">אין ספינרים פעילים — הכל טעון</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {activeSpinners.map((s, i) => (
                  <Card key={i} className={`p-3 ${s.durationSec > 10 ? 'border-red-500/40 bg-red-500/5' : s.durationSec > 5 ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div className={`animate-spin w-4 h-4 rounded-full border-2 border-t-transparent ${
                        s.durationSec > 10 ? 'border-red-500' : s.durationSec > 5 ? 'border-amber-500' : 'border-primary'
                      }`} />
                      <span className="text-xs flex-1">{s.label}</span>
                      <Badge variant={s.durationSec > 10 ? 'destructive' : s.durationSec > 5 ? 'outline' : 'secondary'} className="text-xs">
                        {s.durationSec.toFixed(1)}s
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!enabled && (
        <Card className="p-6 text-center">
          <EyeOff className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">הפעל את זיהוי הספינרים כדי לעקוב אחרי השהויות וטעינות</p>
          <p className="text-xs text-muted-foreground mt-1">הלוגים יופיעו בלשונית "לוג חי" ויישמרו גם אחרי קריסה</p>
        </Card>
      )}
    </div>
  );
}

// --- Main Component ---
export function SmartConsole() {
  const {
    entries, alerts, errorCount, warnCount, activeAlertCount,
    dismissAlert, clearAlerts, getHealth, getPatterns, getTrends, getSourceBreakdown,
  } = useSmartConsole();
  const [open, setOpen] = useState(false);

  const health = useMemo(() => open ? getHealth() : null, [open, getHealth]);
  const patterns = useMemo(() => open ? getPatterns() : [], [open, getPatterns]);
  const trends = useMemo(() => open ? getTrends() : [], [open, getTrends]);
  const sourceStats = useMemo(() => open ? getSourceBreakdown() : [], [open, getSourceBreakdown]);

  // Pulse animation when there are active critical alerts
  const hasCritical = alerts.some(a => !a.dismissed && a.severity === 'critical');

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <button
          className={`fixed bottom-16 left-4 z-50 w-11 h-11 rounded-full bg-background border border-border shadow-lg flex items-center justify-center hover:bg-accent transition-all group ${
            hasCritical ? 'animate-pulse border-red-500/50' : ''
          }`}
          title="קונסול חכם"
        >
          <Terminal className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          {(errorCount > 0 || activeAlertCount > 0) && (
            <Badge
              variant="destructive"
              className="absolute -top-1.5 -right-1.5 h-5 min-w-5 flex items-center justify-center text-[10px] px-1"
            >
              {activeAlertCount > 0 ? activeAlertCount : errorCount}
            </Badge>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="!w-[min(85vw,520px)] !max-w-none p-0 overflow-hidden shadow-2xl" dir="rtl" hideOverlay onInteractOutside={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Terminal className="w-5 h-5 text-primary" />
            קונסול חכם
            <div className="flex items-center gap-1.5 mr-auto">
              {errorCount > 0 && (
                <Badge variant="destructive" className="text-xs">{errorCount} שגיאות</Badge>
              )}
              {warnCount > 0 && (
                <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">{warnCount} אזהרות</Badge>
              )}
              <Badge variant="secondary" className="text-xs">{entries.length} לוגים</Badge>
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">מעקב שגיאות, התראות וביצועים</SheetDescription>
        </SheetHeader>

        {/* Health Bar */}
        {health && <HealthBar health={health} />}

        <ScrollArea className="h-[calc(100vh-140px)]">
          <div className="p-4">
            <Tabs defaultValue="alerts" dir="rtl">
              <TabsList className="w-full justify-start mb-4">
                <TabsTrigger value="alerts" className="gap-1.5 relative">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  התראות
                  {activeAlertCount > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 text-[9px] px-1 mr-1">{activeAlertCount}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="log" className="gap-1.5">
                  <Bug className="w-3.5 h-3.5" />
                  לוג חי
                </TabsTrigger>
                <TabsTrigger value="trends" className="gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  מגמות
                </TabsTrigger>
                <TabsTrigger value="patterns" className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" />
                  דפוסים
                </TabsTrigger>
                <TabsTrigger value="spinners" className="gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  ספינרים
                </TabsTrigger>
              </TabsList>

              <TabsContent value="alerts">
                <AlertsTab alerts={alerts} onDismiss={dismissAlert} onClearAll={clearAlerts} />
              </TabsContent>

              <TabsContent value="log">
                <LiveLogTab entries={entries} />
              </TabsContent>

              <TabsContent value="trends">
                <TrendsTab trends={trends} sourceStats={sourceStats} />
              </TabsContent>

              <TabsContent value="patterns">
                <PatternsTab patterns={patterns} />
              </TabsContent>

              <TabsContent value="spinners">
                <SpinnerTab />
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export default SmartConsole;
