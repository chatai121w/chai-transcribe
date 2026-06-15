import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { BarChart3, CheckCircle, XCircle, Clock, FileAudio, Cpu, Trash2, Zap, Activity, TrendingUp, Hash } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { useTranscriptionAnalytics, type AnalyticsSummary } from '@/hooks/useTranscriptionAnalytics';
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

const ENGINE_COLORS: Record<string, string> = {
  'Local CUDA': '#10b981',
  'Groq Whisper': '#f59e0b',
  'OpenAI Whisper': '#6366f1',
  'Google Speech-to-Text': '#3b82f6',
  'AssemblyAI': '#ec4899',
  'Deepgram': '#8b5cf6',
  'Local (Browser)': '#14b8a6',
  'Live (Web Speech API)': '#f97316',
};

function getEngineColor(engine: string): string {
  for (const [key, color] of Object.entries(ENGINE_COLORS)) {
    if (engine.includes(key) || engine.startsWith(key.split(' ')[0])) return color;
  }
  return '#94a3b8';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

// --- Summary Cards ---
function SummaryCards({ summary }: { summary: AnalyticsSummary }) {
  const cards = [
    { icon: Activity, label: 'סה״כ תמלולים', value: summary.totalTranscriptions, color: 'text-blue-500' },
    { icon: CheckCircle, label: 'הצלחות', value: `${summary.successCount} (${summary.successRate.toFixed(0)}%)`, color: 'text-green-500' },
    { icon: XCircle, label: 'כישלונות', value: summary.failCount, color: 'text-red-500' },
    { icon: FileAudio, label: 'סה״כ אודיו', value: formatDuration(summary.totalAudioSeconds), color: 'text-purple-500' },
    { icon: Clock, label: 'זמן עיבוד', value: formatDuration(summary.totalProcessingSeconds), color: 'text-amber-500' },
    { icon: Zap, label: 'RTF ממוצע', value: summary.avgRtf > 0 ? summary.avgRtf.toFixed(2) : '—', color: 'text-emerald-500' },
    { icon: Hash, label: 'תווים', value: formatNumber(summary.totalChars), color: 'text-cyan-500' },
    { icon: TrendingUp, label: 'סגמנטים', value: formatNumber(summary.totalSegments), color: 'text-indigo-500' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className="p-3 flex flex-col items-center text-center gap-1">
          <card.icon className={`w-5 h-5 ${card.color}`} />
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span className="text-lg font-bold">{card.value}</span>
        </Card>
      ))}
    </div>
  );
}

// --- Engine Comparison Table ---
function EngineComparisonTable({ summary }: { summary: AnalyticsSummary }) {
  const engines = Object.entries(summary.byEngine).sort((a, b) => b[1].count - a[1].count);

  if (engines.length === 0) {
    return <p className="text-center text-muted-foreground py-6">אין נתונים עדיין</p>;
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">מנוע</TableHead>
            <TableHead className="text-center">תמלולים</TableHead>
            <TableHead className="text-center">הצלחה</TableHead>
            <TableHead className="text-center">כישלון</TableHead>
            <TableHead className="text-center">אודיו</TableHead>
            <TableHead className="text-center">עיבוד</TableHead>
            <TableHead className="text-center">RTF</TableHead>
            <TableHead className="text-center">תווים</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {engines.map(([engine, data]) => (
            <TableRow key={engine}>
              <TableCell className="text-right font-medium">
                <div className="flex items-center gap-2 justify-end">
                  <span className="truncate max-w-[160px]">{engine}</span>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getEngineColor(engine) }} />
                </div>
              </TableCell>
              <TableCell className="text-center">{data.count}</TableCell>
              <TableCell className="text-center text-green-500">{data.successCount}</TableCell>
              <TableCell className="text-center text-red-500">{data.failCount}</TableCell>
              <TableCell className="text-center">{formatDuration(data.totalAudio)}</TableCell>
              <TableCell className="text-center">{formatDuration(data.totalProcessing)}</TableCell>
              <TableCell className="text-center font-mono">{data.avgRtf > 0 ? data.avgRtf.toFixed(2) : '—'}</TableCell>
              <TableCell className="text-center">{formatNumber(data.totalChars)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Engine Bar Chart ---
function EngineBarChart({ summary }: { summary: AnalyticsSummary }) {
  const data = Object.entries(summary.byEngine)
    .filter(([, d]) => d.count > 0)
    .map(([engine, d]) => ({
      name: engine.length > 18 ? engine.slice(0, 16) + '...' : engine,
      fullName: engine,
      תמלולים: d.count,
      הצלחות: d.successCount,
      כישלונות: d.failCount,
      fill: getEngineColor(engine),
    }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis type="number" />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
        <RechartsTooltip
          contentStyle={{ direction: 'rtl', fontSize: 12 }}
          formatter={(value: number, name: string) => [value, name]}
        />
        <Bar dataKey="הצלחות" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="כישלונות" fill="#ef4444" stackId="a" radius={[0, 4, 4, 0]} />
        <Legend />
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- RTF Comparison Pie ---
function RtfPieChart({ summary }: { summary: AnalyticsSummary }) {
  const data = Object.entries(summary.byEngine)
    .filter(([, d]) => d.totalProcessing > 0)
    .map(([engine, d]) => ({
      name: engine,
      value: Math.round(d.totalProcessing),
      fill: getEngineColor(engine),
    }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name.slice(0, 12)} ${(percent * 100).toFixed(0)}%`}
          outerRadius={80}
          dataKey="value"
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <RechartsTooltip
          contentStyle={{ direction: 'rtl', fontSize: 12 }}
          formatter={(value: number) => [`${formatDuration(value)}`, 'זמן עיבוד']}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// --- Recent History Table ---
function RecentHistory({ records }: { records: AnalyticsSummary['recentRecords'] }) {
  if (records.length === 0) {
    return <p className="text-center text-muted-foreground py-6">אין תמלולים עדיין — בצע תמלול ראשון!</p>;
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right w-[50px]">#</TableHead>
            <TableHead className="text-right">מנוע</TableHead>
            <TableHead className="text-center">סטטוס</TableHead>
            <TableHead className="text-center">אודיו</TableHead>
            <TableHead className="text-center">עיבוד</TableHead>
            <TableHead className="text-center">RTF</TableHead>
            <TableHead className="text-center">תווים</TableHead>
            <TableHead className="text-right">זמן</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r, i) => (
            <TableRow key={r.id} className={r.status === 'failed' ? 'bg-destructive/5' : ''}>
              <TableCell className="text-right text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate max-w-[140px] inline-block">{r.engine}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="text-xs space-y-1" dir="rtl">
                      <p><strong>מנוע:</strong> {r.engine}</p>
                      {r.fileName && <p><strong>קובץ:</strong> {r.fileName}</p>}
                      {r.model && <p><strong>מודל:</strong> {r.model}</p>}
                      {r.computeType && <p><strong>סוג חישוב:</strong> {r.computeType}</p>}
                      {r.beamSize != null && <p><strong>beam:</strong> {r.beamSize}</p>}
                      {r.segmentCount != null && <p><strong>סגמנטים:</strong> {r.segmentCount}</p>}
                      {r.wordCount != null && <p><strong>מילים:</strong> {r.wordCount}</p>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="text-center">
                {r.status === 'success' ? (
                  <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs">✓</Badge>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-red-500 border-red-500/30 text-xs cursor-help">✗</Badge>
                    </TooltipTrigger>
                    {r.errorMessage && (
                      <TooltipContent><span className="text-xs">{r.errorMessage}</span></TooltipContent>
                    )}
                  </Tooltip>
                )}
              </TableCell>
              <TableCell className="text-center font-mono text-xs">
                {r.audioDuration ? formatDuration(r.audioDuration) : '—'}
              </TableCell>
              <TableCell className="text-center font-mono text-xs">
                {r.processingTime ? formatDuration(r.processingTime) : '—'}
              </TableCell>
              <TableCell className="text-center font-mono text-xs">
                {r.rtf ? r.rtf.toFixed(2) : '—'}
              </TableCell>
              <TableCell className="text-center text-xs">
                {r.charCount ? formatNumber(r.charCount) : '—'}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {timeAgo(r.timestamp)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Main Component ---
export function TranscriptionAnalytics() {
  const { getSummary, clearAll } = useTranscriptionAnalytics();
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => open ? getSummary() : null, [open, getSummary]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[70] w-10 h-10 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg flex items-center justify-center hover:bg-accent transition-colors group"
          title="ניתוח תמלולים"
        >
          <BarChart3 className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-full sm:w-[600px] md:w-[720px] lg:w-[800px] p-0 overflow-hidden" dir="rtl">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              ניתוח ביצועי תמלולים
            </SheetTitle>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4 ml-1" />
                  נקה הכל
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>מחיקת כל הנתונים?</AlertDialogTitle>
                  <AlertDialogDescription>
                    פעולה זו תמחק את כל היסטוריית הניתוח. לא ניתן לשחזר.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-row-reverse gap-2">
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={clearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    מחק
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)]">
          {summary && (
            <div className="p-6 space-y-6">
              {/* Summary Cards */}
              <SummaryCards summary={summary} />

              {/* Tabs: Charts / Engine Table / History */}
              <Tabs defaultValue="engines" dir="rtl">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="engines" className="gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    השוואת מנועים
                  </TabsTrigger>
                  <TabsTrigger value="charts" className="gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    גרפים
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    היסטוריה
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="engines" className="mt-4">
                  <EngineComparisonTable summary={summary} />
                </TabsContent>

                <TabsContent value="charts" className="mt-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-medium mb-3 text-muted-foreground">תמלולים לפי מנוע</h3>
                    <Card className="p-4">
                      <EngineBarChart summary={summary} />
                    </Card>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium mb-3 text-muted-foreground">חלוקת זמן עיבוד</h3>
                    <Card className="p-4">
                      <RtfPieChart summary={summary} />
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  <RecentHistory records={summary.recentRecords} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export default TranscriptionAnalytics;
