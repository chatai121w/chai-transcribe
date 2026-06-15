import { useState, useMemo, memo } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Clock, Type, ArrowRightLeft, Eye, RotateCcw, Cloud, HardDrive } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { he } from "date-fns/locale";
import DiffMatchPatch from "diff-match-patch";
import type { CloudVersion } from "@/hooks/useCloudVersions";

export interface TextVersion {
  id: string;
  text: string;
  timestamp: Date;
  source: 'original' | 'manual' | 'ai-improve' | 'ai-sources' | 'ai-readable' | 'ai-custom' | 'ai-fix' |
    'ai-grammar' | 'ai-punctuation' | 'ai-paragraphs' | 'ai-bullets' | 'ai-headings' |
    'ai-expand' | 'ai-shorten' | 'ai-summarize' | 'ai-translate' | 'ai-speakers' | 'ai-tone';
  customPrompt?: string;
}

const sourceLabels: Record<string, string> = {
  original: 'תמלול מקורי',
  manual: 'עריכה ידנית',
  'ai-improve': 'AI - שיפור ניסוח',
  'ai-sources': 'AI - הוספת מקורות',
  'ai-readable': 'AI - זורם לקריאה',
  'ai-custom': 'AI - פרומפט מותאם',
  'ai-fix': 'AI - תיקון ועיבוד',
  'ai-grammar': 'AI - דקדוק ואיות',
  'ai-punctuation': 'AI - פיסוק',
  'ai-paragraphs': 'AI - חלוקה לפסקאות',
  'ai-bullets': 'AI - נקודות מפתח',
  'ai-headings': 'AI - כותרות',
  'ai-expand': 'AI - הרחבה',
  'ai-shorten': 'AI - קיצור',
  'ai-summarize': 'AI - סיכום',
  'ai-translate': 'AI - תרגום',
  'ai-speakers': 'AI - זיהוי דוברים',
  'ai-tone': 'AI - שינוי טון',
};

interface DisplayVersion {
  id: string;
  text: string;
  source: string;
  label: string;
  engineLabel?: string | null;
  timestamp: Date;
  versionNumber: number;
  isCloud: boolean;
}

interface TextEditHistoryProps {
  versions: TextVersion[];
  onSelectVersion: (version: TextVersion) => void;
  selectedVersionId?: string;
  cloudVersions?: CloudVersion[];
  cloudLoading?: boolean;
  onRestoreVersion?: (text: string) => void;
}

function mergeVersions(local: TextVersion[], cloud: CloudVersion[]): DisplayVersion[] {
  const result: DisplayVersion[] = [];
  const cloudTextSet = new Set(cloud.map(c => c.text));

  for (const cv of cloud) {
    result.push({
      id: cv.id,
      text: cv.text,
      source: cv.source,
      label: cv.action_label || sourceLabels[cv.source] || cv.source,
      engineLabel: cv.engine_label,
      timestamp: new Date(cv.created_at),
      versionNumber: cv.version_number,
      isCloud: true,
    });
  }

  for (const lv of local) {
    if (!cloudTextSet.has(lv.text)) {
      result.push({
        id: lv.id,
        text: lv.text,
        source: lv.source,
        label: lv.customPrompt || sourceLabels[lv.source] || lv.source,
        engineLabel: lv.customPrompt || null,
        timestamp: lv.timestamp,
        versionNumber: 0,
        isCloud: false,
      });
    }
  }

  result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return result;
}

const TextEditHistoryInner = ({
  versions,
  onSelectVersion,
  selectedVersionId,
  cloudVersions = [],
  cloudLoading = false,
  onRestoreVersion,
}: TextEditHistoryProps) => {
  const [viewMode, setViewMode] = useState<'list' | 'compare'>('list');
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');

  const allVersions = useMemo(
    () => mergeVersions(versions, cloudVersions),
    [versions, cloudVersions]
  );

  const effectiveLeftId = leftId || allVersions[0]?.id || '';
  const effectiveRightId = rightId || allVersions[allVersions.length - 1]?.id || '';

  const leftVersion = allVersions.find(v => v.id === effectiveLeftId);
  const rightVersion = allVersions.find(v => v.id === effectiveRightId);

  const dmp = useMemo(() => new DiffMatchPatch(), []);

  const diffs = useMemo(() => {
    if (!leftVersion || !rightVersion) return [];
    const d = dmp.diff_main(leftVersion.text, rightVersion.text);
    dmp.diff_cleanupSemantic(d);
    return d;
  }, [leftVersion, rightVersion, dmp]);

  const stats = useMemo(() => {
    let added = 0, removed = 0, unchanged = 0;
    let addedWords = 0, removedWords = 0;
    for (const [op, text] of diffs) {
      const words = text.split(/\s+/).filter(w => w).length;
      if (op === 1) { added += text.length; addedWords += words; }
      else if (op === -1) { removed += text.length; removedWords += words; }
      else { unchanged += text.length; }
    }
    const total = added + removed + unchanged;
    const similarity = total > 0 ? Math.round((unchanged / total) * 100) : 100;
    return { addedWords, removedWords, similarity };
  }, [diffs]);

  const getWordCount = (text: string) => text.split(/\s+/).filter(w => w).length;

  const renderSideBySide = (side: 'left' | 'right') => {
    return diffs.map((diff, i) => {
      const [op, text] = diff;
      if (side === 'left') {
        if (op === -1) return <span key={i} className="bg-destructive/20 text-destructive-foreground line-through decoration-destructive/60">{text}</span>;
        if (op === 0) return <span key={i}>{text}</span>;
        return null;
      } else {
        if (op === 1) return <span key={i} className="bg-green-500/20 font-medium">{text}</span>;
        if (op === 0) return <span key={i}>{text}</span>;
        return null;
      }
    });
  };

  const getVersionLabel = (v: DisplayVersion) => {
    const base = v.label;
    if (v.engineLabel && v.engineLabel !== v.label) return `${base} (${v.engineLabel})`;
    return base;
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-right">היסטוריית גרסאות</h2>
          <Badge variant="secondary" className="text-xs">{allVersions.length} גרסאות</Badge>
          {cloudVersions.length > 0 && (
            <Badge variant="outline" className="text-xs text-green-600 border-green-300">
              <Cloud className="w-3 h-3 ml-1" />
              {cloudVersions.length} בענן
            </Badge>
          )}
        </div>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-auto">
          <TabsList className="h-8">
            <TabsTrigger value="list" className="text-xs px-3 h-7">
              <Eye className="w-3 h-3 ml-1" />רשימה
            </TabsTrigger>
            <TabsTrigger value="compare" className="text-xs px-3 h-7">
              <ArrowRightLeft className="w-3 h-3 ml-1" />השוואה
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {cloudLoading && (
        <div className="text-center text-muted-foreground text-sm py-2">טוען גרסאות מהענן...</div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <ScrollArea className="h-[600px]">
          <div className="space-y-3">
            {allVersions.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">אין עדיין גרסאות</p>
            ) : (
              allVersions.map((version, index) => (
                <Card
                  key={version.id}
                  className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                    selectedVersionId === version.id ? 'ring-2 ring-primary bg-primary/5' : ''
                  }`}
                  onClick={() => {
                    const legacyVersion = versions.find(v => v.id === version.id);
                    if (legacyVersion) onSelectVersion(legacyVersion);
                    else if (onRestoreVersion) onRestoreVersion(version.text);
                  }}
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={version.source === 'original' ? 'default' : 'secondary'} className="text-xs">
                            #{index + 1}
                          </Badge>
                          <span className="font-semibold text-sm">
                            {getVersionLabel(version)}
                          </span>
                          {version.isCloud ? (
                            <Cloud className="w-3 h-3 text-blue-500" />
                          ) : (
                            <HardDrive className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>
                            {formatDistanceToNow(version.timestamp, { addSuffix: true, locale: he })}
                          </span>
                          <span className="text-muted-foreground/50">·</span>
                          <span>{format(version.timestamp, 'HH:mm dd/MM', { locale: he })}</span>
                        </div>
                      </div>
                      {onRestoreVersion && version.source !== 'original' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreVersion(version.text);
                          }}
                        >
                          <RotateCcw className="w-3 h-3 ml-1" />
                          שחזר
                        </Button>
                      )}
                    </div>

                    <div className="flex gap-4 text-xs text-muted-foreground border-t pt-2">
                      <div className="flex items-center gap-1">
                        <Type className="w-3 h-3" />
                        <span>{version.text.length} תווים</span>
                      </div>
                      <div>
                        <span>{getWordCount(version.text)} מילים</span>
                      </div>
                      {version.engineLabel && (
                        <div>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{version.engineLabel}</Badge>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground line-clamp-2 bg-muted/30 p-2 rounded">
                      {version.text.substring(0, 150)}...
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Compare View - Side by Side */}
      {viewMode === 'compare' && allVersions.length >= 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="shrink-0 text-xs">בסיס</Badge>
              <Select value={effectiveLeftId} onValueChange={setLeftId}>
                <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {allVersions.map((v, i) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      #{i + 1} {getVersionLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="shrink-0 text-xs">חדש</Badge>
              <Select value={effectiveRightId} onValueChange={setRightId}>
                <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {allVersions.map((v, i) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      #{i + 1} {getVersionLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs p-2 bg-muted/30 rounded-lg">
            <span className="text-muted-foreground">דמיון:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${stats.similarity}%`,
                    backgroundColor: stats.similarity > 80 ? 'hsl(var(--primary))' : stats.similarity > 50 ? 'hsl(40 90% 50%)' : 'hsl(var(--destructive))'
                  }}
                />
              </div>
              <span className="font-bold">{stats.similarity}%</span>
            </div>
            <span className="text-green-600 dark:text-green-400">+{stats.addedWords} מילים</span>
            <span className="text-destructive">-{stats.removedWords} מילים</span>
            {onRestoreVersion && rightVersion && (
              <div className="flex-1 flex justify-end">
                <Button size="sm" className="h-7 text-xs" onClick={() => onRestoreVersion(rightVersion.text)}>
                  <RotateCcw className="w-3 h-3 ml-1" />
                  שחזר גרסה זו
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b bg-destructive/5 flex items-center justify-between">
                <span className="text-sm font-medium">{leftVersion ? getVersionLabel(leftVersion) : 'בסיס'}</span>
                <span className="text-xs text-muted-foreground">{leftVersion?.text.length || 0} תווים</span>
              </div>
              <ScrollArea className="h-[500px] p-4">
                <pre className="whitespace-pre-wrap text-right" dir="rtl">
                  {renderSideBySide('left')}
                </pre>
              </ScrollArea>
            </Card>
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b bg-green-500/5 flex items-center justify-between">
                <span className="text-sm font-medium">{rightVersion ? getVersionLabel(rightVersion) : 'חדש'}</span>
                <span className="text-xs text-muted-foreground">{rightVersion?.text.length || 0} תווים</span>
              </div>
              <ScrollArea className="h-[500px] p-4">
                <pre className="whitespace-pre-wrap text-right" dir="rtl">
                  {renderSideBySide('right')}
                </pre>
              </ScrollArea>
            </Card>
          </div>

          <div className="flex gap-4 justify-end text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-destructive/20 border border-destructive/30" /> נמחק
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-500/20 border border-green-500/30" /> נוסף
            </span>
          </div>
        </div>
      )}

      {viewMode === 'compare' && allVersions.length < 2 && (
        <div className="text-center py-12 text-muted-foreground">
          יש צורך בלפחות שתי גרסאות כדי להשוות
        </div>
      )}
    </Card>
  );
};

export const TextEditHistory = memo(TextEditHistoryInner);
