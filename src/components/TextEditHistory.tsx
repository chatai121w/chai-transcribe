import { useMemo, memo } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Clock, Type, Eye, RotateCcw, Cloud, HardDrive, GitCompareArrows } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { he } from "date-fns/locale";
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
  onCompareVersion?: (id: string) => void;
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
  onCompareVersion,
}: TextEditHistoryProps) => {
  const allVersions = useMemo(
    () => mergeVersions(versions, cloudVersions),
    [versions, cloudVersions]
  );

  const getWordCount = (text: string) => text.split(/\s+/).filter(w => w).length;

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

        <Badge variant="outline" className="text-xs gap-1">
          <Eye className="w-3 h-3" /> רשימה
        </Badge>
      </div>

      {cloudLoading && (
        <div className="text-center text-muted-foreground text-sm py-2">טוען גרסאות מהענן...</div>
      )}

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
                        <div className="flex items-center gap-1">
                          {onCompareVersion && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs h-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCompareVersion(version.id);
                              }}
                            >
                              <GitCompareArrows className="w-3 h-3 ml-1" />
                              השווה
                            </Button>
                          )}
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
                        </div>
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

    </Card>
  );
};

export const TextEditHistory = memo(TextEditHistoryInner);
