import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, Clock, FileText, Languages, Hash, MessageSquare
} from "lucide-react";
import { generateSummary } from "@/utils/autoSummary";

interface AutoSummaryCardProps {
  text: string;
}

const LANG_LABELS: Record<string, string> = {
  hebrew: 'עברית',
  english: 'אנגלית',
  mixed: 'מעורב',
};

export const AutoSummaryCard = ({ text }: AutoSummaryCardProps) => {
  const summary = useMemo(() => generateSummary(text), [text]);

  if (!text || summary.wordCount === 0) return null;

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-white/70">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          סיכום מהיר
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatBox icon={<Hash className="w-3 h-3" />} value={summary.wordCount} label="מילים" color="text-blue-400" />
          <StatBox icon={<MessageSquare className="w-3 h-3" />} value={summary.sentenceCount} label="משפטים" color="text-green-400" />
          <StatBox icon={<FileText className="w-3 h-3" />} value={summary.paragraphCount} label="פסקאות" color="text-purple-400" />
          <StatBox icon={<Clock className="w-3 h-3" />} value={`${summary.estimatedDurationMin}'`} label="דיבור" color="text-orange-400" />
          <StatBox icon={<Clock className="w-3 h-3" />} value={`${summary.readingTimeMin}'`} label="קריאה" color="text-cyan-400" />
          <StatBox icon={<Languages className="w-3 h-3" />} value={LANG_LABELS[summary.language]} label="שפה" color="text-yellow-400" />
        </div>

        {/* Top words */}
        {summary.topWords.length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-1.5">מילים מרכזיות:</div>
            <div className="flex flex-wrap gap-1">
              {summary.topWords.slice(0, 10).map(({ word, count }) => (
                <Badge key={word} variant="outline" className="bg-white/5 text-white/70 text-[10px]">
                  {word} ({count})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Key phrases */}
        {summary.keyPhrases.length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-1.5">ביטויים חוזרים:</div>
            <div className="flex flex-wrap gap-1">
              {summary.keyPhrases.map((phrase) => (
                <Badge key={phrase} variant="outline" className="bg-cyan-500/10 text-cyan-300/80 text-[10px]">
                  {phrase}
                </Badge>
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
