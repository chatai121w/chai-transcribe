import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Plus, X } from "lucide-react";
import { TextVersion } from "./TextEditHistory";
import DiffMatchPatch from "diff-match-patch";

interface ComparisonFrame {
  id: string;
  leftVersionId: string;
  rightVersionId: string;
}

interface TextComparisonMultiProps {
  versions: TextVersion[];
  fontSize: number;
  fontFamily: string;
  textColor: string;
  lineHeight: number;
}

export const TextComparisonMulti = ({ 
  versions, 
  fontSize, 
  fontFamily, 
  textColor, 
  lineHeight 
}: TextComparisonMultiProps) => {
  const [frames, setFrames] = useState<ComparisonFrame[]>([
    { id: '1', leftVersionId: versions[0]?.id || '', rightVersionId: versions[versions.length - 1]?.id || '' }
  ]);

  const addFrame = () => {
    setFrames([...frames, { 
      id: Date.now().toString(), 
      leftVersionId: versions[0]?.id || '', 
      rightVersionId: versions[versions.length - 1]?.id || '' 
    }]);
  };

  const removeFrame = (frameId: string) => {
    if (frames.length > 1) {
      setFrames(frames.filter(f => f.id !== frameId));
    }
  };

  const updateFrame = (frameId: string, side: 'left' | 'right', versionId: string) => {
    setFrames(frames.map(f => 
      f.id === frameId 
        ? { ...f, [side === 'left' ? 'leftVersionId' : 'rightVersionId']: versionId }
        : f
    ));
  };

  const getDiff = (text1: string, text2: string) => {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(text1, text2);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
  };

  const renderDiff = (diffs: any[], side: 'left' | 'right') => {
    return diffs.map((diff, i) => {
      const [operation, text] = diff;
      
      if (side === 'left') {
        if (operation === -1) {
          return <span key={i} className="bg-red-200 dark:bg-red-900/40 line-through">{text}</span>;
        } else if (operation === 0) {
          return <span key={i}>{text}</span>;
        }
        return null;
      } else {
        if (operation === 1) {
          return <span key={i} className="bg-green-200 dark:bg-green-900/40 font-semibold">{text}</span>;
        } else if (operation === 0) {
          return <span key={i}>{text}</span>;
        }
        return null;
      }
    });
  };

  const getVersionLabel = (version: TextVersion) => {
    const sourceLabels: Record<TextVersion['source'], string> = {
      original: 'מקורי',
      manual: 'עריכה ידנית',
      'ai-improve': 'AI - שיפור ניסוח',
      'ai-sources': 'AI - מקורות',
      'ai-readable': 'AI - זורם',
      'ai-custom': 'AI - מותאם',
      'ai-fix': 'AI - תיקון',
      'ai-grammar': 'AI - דקדוק',
      'ai-punctuation': 'AI - פיסוק',
      'ai-paragraphs': 'AI - פסקאות',
      'ai-bullets': 'AI - תבליטים',
      'ai-headings': 'AI - כותרות',
      'ai-expand': 'AI - הרחבה',
      'ai-shorten': 'AI - קיצור',
      'ai-summarize': 'AI - סיכום',
      'ai-translate': 'AI - תרגום',
      'ai-speakers': 'AI - דוברים',
      'ai-tone': 'AI - טון',
    };
    return sourceLabels[version.source];
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">השוואת גרסאות</h2>
        </div>
        <Button onClick={addFrame} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          הוסף השוואה
        </Button>
      </div>

      {frames.map((frame, frameIndex) => {
        const leftVersion = versions.find(v => v.id === frame.leftVersionId);
        const rightVersion = versions.find(v => v.id === frame.rightVersionId);
        const diffs = leftVersion && rightVersion ? getDiff(leftVersion.text, rightVersion.text) : [];

        return (
          <Card key={frame.id} className="p-6 relative">
            {frames.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-2"
                onClick={() => removeFrame(frame.id)}
              >
                <X className="w-4 h-4" />
              </Button>
            )}

            <div className="space-y-4">
              <div className="text-sm font-semibold text-muted-foreground text-right">
                השוואה #{frameIndex + 1}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left side */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold border-b pb-2 flex-1 text-right">
                      גרסה ראשונה
                    </h3>
                  </div>
                  <Select 
                    value={frame.leftVersionId} 
                    onValueChange={(val) => updateFrame(frame.id, 'left', val)}
                  >
                    <SelectTrigger dir="rtl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {versions.map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          {getVersionLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ScrollArea className="h-[400px] rounded border p-4 bg-accent/20">
                    <pre 
                      className="text-right whitespace-pre-wrap" 
                      dir="rtl"
                      style={{
                        fontFamily,
                        fontSize: `${fontSize}px`,
                        color: textColor,
                        lineHeight,
                      }}
                    >
                      {leftVersion && renderDiff(diffs, 'left')}
                    </pre>
                  </ScrollArea>
                  <div className="text-xs text-muted-foreground text-right">
                    {leftVersion && (
                      <>
                        {leftVersion.text.length} תווים | {leftVersion.text.split(/\s+/).filter(w => w).length} מילים
                      </>
                    )}
                  </div>
                </div>

                {/* Right side */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold border-b pb-2 flex-1 text-right">
                      גרסה שנייה
                    </h3>
                  </div>
                  <Select 
                    value={frame.rightVersionId} 
                    onValueChange={(val) => updateFrame(frame.id, 'right', val)}
                  >
                    <SelectTrigger dir="rtl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {versions.map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          {getVersionLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ScrollArea className="h-[400px] rounded border p-4 bg-primary/5">
                    <pre 
                      className="text-right whitespace-pre-wrap" 
                      dir="rtl"
                      style={{
                        fontFamily,
                        fontSize: `${fontSize}px`,
                        color: textColor,
                        lineHeight,
                      }}
                    >
                      {rightVersion && renderDiff(diffs, 'right')}
                    </pre>
                  </ScrollArea>
                  <div className="text-xs text-muted-foreground text-right">
                    {rightVersion && (
                      <>
                        {rightVersion.text.length} תווים | {rightVersion.text.split(/\s+/).filter(w => w).length} מילים
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground text-right">
                <div className="flex items-center gap-2 justify-end">
                  <span className="bg-red-200 dark:bg-red-900/40 px-2 py-0.5 rounded">נמחק</span>
                  <span>טקסט שנמחק מהגרסה הראשונה</span>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <span className="bg-green-200 dark:bg-green-900/40 px-2 py-0.5 rounded font-semibold">נוסף</span>
                  <span>טקסט שנוסף בגרסה השנייה</span>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
