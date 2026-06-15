import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Brain, Trash2, Download, Upload, RotateCcw,
  ArrowRight, TrendingUp, BookOpen, Sparkles
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCorrectionLearning } from "@/hooks/useCorrectionLearning";

const CATEGORY_LABELS: Record<string, string> = {
  word: 'מילה',
  phrase: 'ביטוי',
  punctuation: 'פיסוק',
  spacing: 'רווחים',
  grammar: 'דקדוק',
};

const CATEGORY_COLORS: Record<string, string> = {
  word: 'bg-blue-500/20 text-blue-300',
  phrase: 'bg-purple-500/20 text-purple-300',
  punctuation: 'bg-yellow-500/20 text-yellow-300',
  spacing: 'bg-gray-500/20 text-gray-300',
  grammar: 'bg-green-500/20 text-green-300',
};

export const CorrectionLearningPanel = () => {
  const {
    stats, corrections, removeCorrection, clearAll, exportData, importData, refresh,
  } = useCorrectionLearning();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [noteFilter, setNoteFilter] = useState<'all' | 'with-note' | 'without-note'>('all');

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corrections-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "יוצא", description: `${stats.totalCorrections} תיקונים יוצאו בהצלחה` });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const count = importData(reader.result as string);
      if (count >= 0) {
        toast({ title: "יובא", description: `${count} תיקונים חדשים יובאו` });
      } else {
        toast({ title: "שגיאה", description: "קובץ לא תקין", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClear = () => {
    clearAll();
    toast({ title: "נמחק", description: "כל התיקונים הנלמדים נמחקו" });
  };

  const filteredCorrections = corrections.filter((c) => {
    if (noteFilter === 'with-note') return !!c.note?.trim();
    if (noteFilter === 'without-note') return !c.note?.trim();
    return true;
  });

  const displayCorrections = showAll ? filteredCorrections : filteredCorrections.slice(0, 20);

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          למידה מתיקונים
        </CardTitle>
        <CardDescription className="text-white/60">
          המערכת לומדת מהתיקונים שלך ומשפרת תמלולים עתידיים
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{stats.totalCorrections}</div>
            <div className="text-xs text-white/50">תיקונים נלמדו</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.totalApplications}</div>
            <div className="text-xs text-white/50">פעמים שהופעלו</div>
          </div>
        </div>

        {/* Category breakdown */}
        {stats.totalCorrections > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-white/70 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              לפי קטגוריה
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.byCategory).map(([cat, count]) => (
                <Badge key={cat} variant="outline" className={CATEGORY_COLORS[cat] || 'bg-white/10'}>
                  {CATEGORY_LABELS[cat] || cat}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Engine breakdown */}
        {Object.keys(stats.byEngine).length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-white/70 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              לפי מנוע
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.byEngine).map(([eng, count]) => (
                <Badge key={eng} variant="outline" className="bg-white/5 text-white/70">
                  {eng}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Corrections list */}
        {corrections.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-white/70 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                תיקונים ({filteredCorrections.length}/{corrections.length})
              </span>
              {filteredCorrections.length > 20 && (
                <Button variant="ghost" size="sm" className="text-xs h-6"
                  onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'הצג פחות' : `הצג הכל (${filteredCorrections.length})`}
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              <Button
                variant={noteFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => setNoteFilter('all')}
              >
                הכל
              </Button>
              <Button
                variant={noteFilter === 'with-note' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => setNoteFilter('with-note')}
              >
                עם הסבר
              </Button>
              <Button
                variant={noteFilter === 'without-note' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => setNoteFilter('without-note')}
              >
                בלי הסבר
              </Button>
            </div>

            <ScrollArea className="h-[200px]">
              <div className="space-y-1">
                {displayCorrections.map((c, i) => (
                  <div key={`${c.original}-${c.corrected}-${i}`}
                    className="px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 group text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${CATEGORY_COLORS[c.category] || ''}`}>
                        {CATEGORY_LABELS[c.category] || c.category}
                      </Badge>
                      <span className="text-red-300/80 line-through truncate max-w-[120px]" dir="rtl"
                        title={c.original}>
                        {c.original || '(ריק)'}
                      </span>
                      <ArrowRight className="w-3 h-3 text-white/30 shrink-0" />
                      <span className="text-green-300/80 truncate max-w-[120px]" dir="rtl"
                        title={c.corrected}>
                        {c.corrected || '(ריק)'}
                      </span>
                      <span className="text-white/30 text-[10px] mr-auto">
                        ×{c.frequency}
                      </span>
                      <Progress value={c.confidence * 100} className="w-10 h-1" />
                      <Button variant="ghost" size="sm"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-red-400"
                        onClick={() => removeCorrection(c.original, c.corrected)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    {c.note && (
                      <p className="text-[11px] text-white/60 pr-1">הסבר: {c.note}</p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {filteredCorrections.length === 0 && (
          <div className="text-center py-6 text-white/40">
            <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {corrections.length === 0 ? 'עדיין אין תיקונים נלמדים' : 'אין תוצאות לפי הסינון שבחרת'}
            </p>
            <p className="text-xs mt-1">
              {corrections.length === 0 ? 'ערוך תמלולים והמערכת תלמד אוטומטית' : 'נסה לעבור לסינון אחר'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport}
            disabled={corrections.length === 0}
            className="text-xs bg-white/5 border-white/10">
            <Download className="w-3.5 h-3.5 mr-1" />
            ייצוא
          </Button>

          <Button variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs bg-white/5 border-white/10">
            <Upload className="w-3.5 h-3.5 mr-1" />
            ייבוא
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden"
            onChange={handleImport} />

          <Button variant="outline" size="sm" onClick={refresh}
            className="text-xs bg-white/5 border-white/10">
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            רענן
          </Button>

          {corrections.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm"
                  className="text-xs bg-red-500/10 border-red-500/20 text-red-400 mr-auto">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  מחק הכל
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[#1a1a2e] border-white/10">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">מחיקת כל התיקונים</AlertDialogTitle>
                  <AlertDialogDescription className="text-white/60">
                    פעולה זו תמחק את כל {corrections.length} התיקונים הנלמדים. לא ניתן לשחזר.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-white/5 border-white/10 text-white">ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClear}
                    className="bg-red-500 hover:bg-red-600">מחק</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
