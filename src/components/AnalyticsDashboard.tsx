import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Clock, Zap, CheckCircle, XCircle, FileText, Trash2 } from "lucide-react";
import { useTranscriptionAnalytics, type AnalyticsSummary } from "@/hooks/useTranscriptionAnalytics";
import { getCorrectionStats } from "@/utils/correctionLearning";
import { getVocabularyStats } from "@/utils/customVocabulary";
import { toast } from "@/hooks/use-toast";

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

const ENGINE_COLORS: Record<string, string> = {
  'groq': 'bg-orange-500/20 text-orange-300',
  'openai': 'bg-green-500/20 text-green-300',
  'google': 'bg-blue-500/20 text-blue-300',
  'local': 'bg-purple-500/20 text-purple-300',
  'local-server': 'bg-cyan-500/20 text-cyan-300',
  'assemblyai': 'bg-pink-500/20 text-pink-300',
  'deepgram': 'bg-yellow-500/20 text-yellow-300',
};

function getEngineColor(engine: string): string {
  for (const [key, cls] of Object.entries(ENGINE_COLORS)) {
    if (engine.toLowerCase().includes(key)) return cls;
  }
  return 'bg-white/10 text-white/60';
}

export const AnalyticsDashboard = () => {
  const { getSummary, clearAll, records } = useTranscriptionAnalytics();

  const summary = useMemo(() => getSummary(), [records]);
  const correctionStats = useMemo(() => getCorrectionStats(), []);
  const vocabStats = useMemo(() => getVocabularyStats(), []);

  if (summary.totalTranscriptions === 0 && correctionStats.totalCorrections === 0 && vocabStats.totalTerms === 0) {
    return (
      <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
        <CardContent className="py-8 text-center text-white/40">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <div className="text-sm">אין נתונים עדיין — תמלל קבצים כדי לראות סטטיסטיקות</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            אנליטיקת תמלולים
          </CardTitle>
          {records.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-white/40 hover:text-red-300"
              onClick={() => { clearAll(); toast({ title: "הנתונים נוקו" }); }}>
              <Trash2 className="w-3 h-3 mr-1" /> נקה
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Overview stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatBox icon={<FileText className="w-3 h-3" />} value={summary.totalTranscriptions} label="תמלולים" color="text-blue-400" />
          <StatBox icon={<CheckCircle className="w-3 h-3" />} value={`${Math.round(summary.successRate)}%`} label="הצלחה" color="text-green-400" />
          <StatBox icon={<Clock className="w-3 h-3" />} value={formatDuration(summary.totalAudioSeconds)} label="זמן שמע" color="text-orange-400" />
          <StatBox icon={<Zap className="w-3 h-3" />} value={summary.avgRtf > 0 ? summary.avgRtf.toFixed(2) : '—'} label="RTF ממוצע" color="text-yellow-400" />
          <StatBox icon={<FileText className="w-3 h-3" />} value={summary.totalWords.toLocaleString()} label="מילים" color="text-purple-400" />
          <StatBox icon={<XCircle className="w-3 h-3" />} value={summary.failCount} label="כשלונות" color="text-red-400" />
        </div>

        {/* Engine distribution */}
        {Object.keys(summary.byEngine).length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-2">התפלגות מנועים:</div>
            <div className="space-y-1.5">
              {Object.entries(summary.byEngine)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([eng, data]) => {
                  const pct = summary.totalTranscriptions > 0 ? (data.count / summary.totalTranscriptions) * 100 : 0;
                  return (
                    <div key={eng} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <Badge variant="outline" className={`${getEngineColor(eng)} text-[10px] py-0`}>
                          {eng}
                        </Badge>
                        <span className="text-white/50">
                          {data.count} ({Math.round(pct)}%) — RTF: {data.avgRtf > 0 ? data.avgRtf.toFixed(2) : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500/40 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Correction & Vocabulary stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3 space-y-1">
            <div className="text-xs text-white/50">למידת תיקונים</div>
            <div className="text-xl font-bold text-green-400">{correctionStats.totalCorrections}</div>
            <div className="text-[10px] text-white/40">
              {correctionStats.totalApplications} יישומים
            </div>
            {Object.keys(correctionStats.byCategory).length > 0 && (
              <div className="flex flex-wrap gap-0.5 mt-1">
                {Object.entries(correctionStats.byCategory).map(([cat, count]) => (
                  <Badge key={cat} variant="outline" className="text-[9px] bg-white/5 text-white/50 py-0">
                    {cat}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white/5 rounded-lg p-3 space-y-1">
            <div className="text-xs text-white/50">מילון מותאם</div>
            <div className="text-xl font-bold text-purple-400">{vocabStats.totalTerms}</div>
            <div className="text-[10px] text-white/40">מונחים</div>
            {Object.keys(vocabStats.byCategory).length > 0 && (
              <div className="flex flex-wrap gap-0.5 mt-1">
                {Object.entries(vocabStats.byCategory).map(([cat, count]) => (
                  <Badge key={cat} variant="outline" className="text-[9px] bg-white/5 text-white/50 py-0">
                    {cat}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        {summary.recentRecords.length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-1.5">פעילות אחרונה:</div>
            <div className="space-y-1 max-h-[120px] overflow-y-auto">
              {summary.recentRecords.slice(0, 8).map(r => (
                <div key={r.id} className="flex items-center justify-between text-[11px] bg-white/5 rounded px-2 py-1">
                  <div className="flex items-center gap-1.5">
                    {r.status === 'success'
                      ? <CheckCircle className="w-3 h-3 text-green-400" />
                      : <XCircle className="w-3 h-3 text-red-400" />
                    }
                    <Badge variant="outline" className={`${getEngineColor(r.engine)} text-[9px] py-0`}>
                      {r.engine}
                    </Badge>
                  </div>
                  <div className="text-white/40 flex items-center gap-2">
                    {r.wordCount && <span>{r.wordCount} מילים</span>}
                    {r.processingTime && <span>{(r.processingTime / 1000).toFixed(1)}s</span>}
                    <span>{new Date(r.timestamp).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function StatBox({ icon, value, label, color }: {
  icon: React.ReactNode; value: string | number; label: string; color: string;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-2 text-center">
      <div className={`text-lg font-bold ${color} flex items-center justify-center gap-1`}>
        {icon}
        {value}
      </div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}
