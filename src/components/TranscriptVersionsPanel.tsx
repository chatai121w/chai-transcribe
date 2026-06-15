import { useState, useMemo } from "react";
import { Sparkles, Eye, List, ArrowRightLeft, Cloud, Clock, RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { CollapsibleWidget } from "@/components/ui/CollapsibleWidget";
import { useCloudVersions, type CloudVersion } from "@/hooks/useCloudVersions";
import { TextExportMenu } from "@/components/TextExportMenu";
import { formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";
import DiffMatchPatch from "diff-match-patch";
import { toast } from "@/hooks/use-toast";

interface Props {
  /** Transcript id (cloud). If null/empty, the panel renders an informative empty state. */
  transcriptId: string | null;
  /** Current transcript text — used as fallback for the "original" view if no versions saved. */
  currentText?: string;
  /** Called when the user picks a version to load into the active editor. */
  onApplyVersion?: (text: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  original: 'תמלול מקורי',
  manual: 'עריכה ידנית',
  'ai-improve': 'AI · שיפור ניסוח',
  'ai-grammar': 'AI · דקדוק ואיות',
  'ai-punctuation': 'AI · פיסוק',
  'ai-readable': 'AI · קריאות',
  'ai-paragraphs': 'AI · פסקאות',
  'ai-bullets': 'AI · נקודות מפתח',
  'ai-headings': 'AI · כותרות',
  'ai-expand': 'AI · הרחבה',
  'ai-shorten': 'AI · קיצור',
  'ai-summarize': 'AI · סיכום',
  'ai-translate': 'AI · תרגום',
  'ai-speakers': 'AI · זיהוי דוברים',
  'ai-tone': 'AI · שינוי טון',
  'ai-sources': 'AI · מקורות',
  'ai-custom': 'AI · פרומפט מותאם',
  'ai-fix': 'AI · תיקון ועיבוד',
};

function labelFor(v: CloudVersion): string {
  return v.action_label || SOURCE_LABELS[v.source] || v.source;
}

function isAiVersion(v: CloudVersion): boolean {
  return v.source.startsWith('ai-') || v.source === 'ai';
}

export function TranscriptVersionsPanel({ transcriptId, currentText, onApplyVersion }: Props) {
  const { versions, isLoading } = useCloudVersions(transcriptId);
  const [view, setView] = useState<'single' | 'list' | 'compare'>('list');
  const [selectedId, setSelectedId] = useState<string>('');
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');

  const aiVersions = useMemo(() => versions.filter(isAiVersion), [versions]);
  const original = useMemo(() => versions.find(v => v.source === 'original'), [versions]);

  const effectiveSelected = selectedId
    || aiVersions[aiVersions.length - 1]?.id
    || original?.id
    || '';
  const selectedVersion = versions.find(v => v.id === effectiveSelected);

  const effectiveLeftId = leftId || original?.id || versions[0]?.id || '';
  const effectiveRightId = rightId || aiVersions[aiVersions.length - 1]?.id || versions[versions.length - 1]?.id || '';
  const leftVersion = versions.find(v => v.id === effectiveLeftId);
  const rightVersion = versions.find(v => v.id === effectiveRightId);

  const dmp = useMemo(() => new DiffMatchPatch(), []);
  const diffs = useMemo(() => {
    if (!leftVersion || !rightVersion) return [];
    const d = dmp.diff_main(leftVersion.text, rightVersion.text);
    dmp.diff_cleanupSemantic(d);
    return d;
  }, [leftVersion, rightVersion, dmp]);

  const applyText = (text: string) => {
    if (!onApplyVersion) {
      navigator.clipboard.writeText(text).then(() => {
        toast({ title: 'הועתק ללוח' });
      });
      return;
    }
    onApplyVersion(text);
    toast({ title: 'הגרסה הוטענה לעורך' });
  };

  const totalCount = versions.length;
  const aiCount = aiVersions.length;

  return (
    <CollapsibleWidget
      title="גרסאות AI ועריכה"
      icon={<Sparkles className="w-4 h-4 text-yellow-600" />}
      storageKey="index_ai_versions"
      defaultOpen={aiCount > 0}
      badge={
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-[10px] h-5">{totalCount} סה"כ</Badge>
          {aiCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-yellow-500/40 text-yellow-700 dark:text-yellow-400">
              {aiCount} AI
            </Badge>
          )}
        </div>
      }
      actions={
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList className="h-7">
            <TabsTrigger value="single" className="text-xs h-6 px-2"><Eye className="w-3 h-3 ml-1" />יחיד</TabsTrigger>
            <TabsTrigger value="list" className="text-xs h-6 px-2"><List className="w-3 h-3 ml-1" />רשימה</TabsTrigger>
            <TabsTrigger value="compare" className="text-xs h-6 px-2"><ArrowRightLeft className="w-3 h-3 ml-1" />השוואה</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {!transcriptId && (
        <div className="text-center text-xs text-muted-foreground py-6">
          התמלול עוד לא נשמר בענן — בצע עריכת AI בעמוד עריכת הטקסט כדי לראות גרסאות כאן.
        </div>
      )}

      {transcriptId && isLoading && (
        <div className="text-center text-xs text-muted-foreground py-4">טוען גרסאות...</div>
      )}

      {transcriptId && !isLoading && versions.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-6">
          אין עדיין עריכות AI. פתח את התמלול ב"עריכת טקסט" והפעל פעולת AI כדי שתופיע כאן.
        </div>
      )}

      {/* ── Single view ── */}
      {transcriptId && versions.length > 0 && view === 'single' && (
        <div className="space-y-2" dir="rtl">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={effectiveSelected} onValueChange={setSelectedId}>
              <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    #{v.version_number} · {labelFor(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedVersion && (
              <>
                <TextExportMenu
                  getText={() => selectedVersion.text}
                  filename={labelFor(selectedVersion)}
                  subject={labelFor(selectedVersion)}
                />
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => applyText(selectedVersion.text)}>
                  <RotateCcw className="w-3 h-3 ml-1" />טען
                </Button>
              </>
            )}
          </div>
          {selectedVersion && (
            <Card className="p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                <span>{selectedVersion.text.length} תווים · {selectedVersion.word_count ?? '?'} מילים</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(selectedVersion.created_at), { addSuffix: true, locale: he })}
                </span>
              </div>
              <ScrollArea className="h-[280px]">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-right" dir="rtl">
                  {selectedVersion.text}
                </pre>
              </ScrollArea>
            </Card>
          )}
        </div>
      )}

      {/* ── List view ── */}
      {transcriptId && versions.length > 0 && view === 'list' && (
        <ScrollArea className="h-[360px]" dir="rtl">
          <div className="space-y-2">
            {versions.map((v) => (
              <Card key={v.id} className="p-3 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={v.source === 'original' ? 'default' : 'secondary'} className="text-[10px]">
                      #{v.version_number}
                    </Badge>
                    <span className="text-sm font-semibold">{labelFor(v)}</span>
                    {v.engine_label && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{v.engine_label}</Badge>
                    )}
                    <Cloud className="w-3 h-3 text-blue-500" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <TextExportMenu
                      getText={() => v.text}
                      filename={`${labelFor(v)} - v${v.version_number}`}
                      subject={labelFor(v)}
                    />
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => applyText(v.text)}>
                      <RotateCcw className="w-3 h-3 ml-1" />טען
                    </Button>
                  </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
                  <Clock className="w-3 h-3" />
                  <span>{formatDistanceToNow(new Date(v.created_at), { addSuffix: true, locale: he })}</span>
                  <span>·</span>
                  <span>{v.text.length} תווים</span>
                  {v.word_count != null && <><span>·</span><span>{v.word_count} מילים</span></>}
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2 bg-muted/30 p-2 rounded text-right" dir="rtl">
                  {v.text.substring(0, 200)}{v.text.length > 200 ? '…' : ''}
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ── Compare view ── */}
      {transcriptId && versions.length >= 2 && view === 'compare' && (
        <div className="space-y-3" dir="rtl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs shrink-0">בסיס</Badge>
              <Select value={effectiveLeftId} onValueChange={setLeftId}>
                <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {versions.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">#{v.version_number} · {labelFor(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs shrink-0">חדש</Badge>
              <Select value={effectiveRightId} onValueChange={setRightId}>
                <SelectTrigger className="text-xs h-8" dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {versions.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">#{v.version_number} · {labelFor(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="p-3 bg-muted/10">
            <ScrollArea className="h-[340px]">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-right" dir="rtl">
                {diffs.map(([op, text], i) => {
                  if (op === 1) return <span key={i} className="bg-green-500/25 text-green-900 dark:text-green-200 rounded px-0.5">{text}</span>;
                  if (op === -1) return <span key={i} className="bg-destructive/25 text-destructive line-through decoration-destructive/60 rounded px-0.5">{text}</span>;
                  return <span key={i}>{text}</span>;
                })}
              </pre>
            </ScrollArea>
          </Card>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded bg-green-500/30 border border-green-500/40" />נוסף
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded bg-destructive/30 border border-destructive/40" />נמחק
              </span>
            </div>
            {rightVersion && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => applyText(rightVersion.text)}>
                <RotateCcw className="w-3 h-3 ml-1" />טען גרסה חדשה
              </Button>
            )}
          </div>
        </div>
      )}

      {transcriptId && versions.length < 2 && view === 'compare' && (
        <div className="text-center text-xs text-muted-foreground py-6">
          צריך לפחות 2 גרסאות להשוואה. בצע עריכת AI כדי ליצור גרסה חדשה.
        </div>
      )}

      {/* Fallback when only currentText exists */}
      {!transcriptId && currentText && (
        <Card className="p-3 bg-muted/20 mt-2">
          <div className="text-[11px] text-muted-foreground mb-1">תצוגה מקדימה של התמלול הנוכחי:</div>
          <ScrollArea className="h-[200px]">
            <pre className="whitespace-pre-wrap text-sm text-right" dir="rtl">{currentText}</pre>
          </ScrollArea>
        </Card>
      )}
    </CollapsibleWidget>
  );
}

export default TranscriptVersionsPanel;
