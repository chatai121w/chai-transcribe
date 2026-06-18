import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRightLeft } from "lucide-react";

interface TextComparisonProps {
  originalText: string;
  editedText: string;
}

export const TextComparison = ({ originalText, editedText }: TextComparisonProps) => {
  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <ArrowRightLeft className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-semibold text-right">השוואת טקסטים</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* טקסט מקורי */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-right border-b pb-2">
            טקסט מקורי
          </h3>
          <ScrollArea className="h-[400px] rounded border p-4 bg-accent/20">
            <pre 
              className="text-right whitespace-pre-wrap" 
              dir="rtl"
              style={{
                fontFamily: 'inherit',
                fontSize: 'inherit',
                color: 'inherit',
                lineHeight: 'inherit',
              }}
            >
              {originalText || "אין טקסט מקורי"}
            </pre>
          </ScrollArea>
        </div>

        {/* טקסט ערוך */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-right border-b pb-2">
            טקסט ערוך
          </h3>
          <ScrollArea className="h-[400px] rounded border p-4 bg-primary/5">
            <pre 
              className="text-right whitespace-pre-wrap" 
              dir="rtl"
              style={{
                fontFamily: 'inherit',
                fontSize: 'inherit',
                color: 'inherit',
                lineHeight: 'inherit',
              }}
            >
              {editedText || "אין טקסט ערוך"}
            </pre>
          </ScrollArea>
        </div>
      </div>

      {/* סטטיסטיקות השוואה */}
      <div className="grid grid-cols-2 gap-4 mt-4 border-t pt-4">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">מקורי</p>
          <p className="text-sm font-medium">
            {originalText.length} תווים | {originalText.split(/\s+/).filter(w => w).length} מילים
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">ערוך</p>
          <p className="text-sm font-medium">
            {editedText.length} תווים | {editedText.split(/\s+/).filter(w => w).length} מילים
          </p>
        </div>
      </div>
    </Card>
  );
};
