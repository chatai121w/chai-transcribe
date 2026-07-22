import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { AIUsageBadge } from "@/components/AIUsageBadge";
import { notifyUsageUpdated } from "@/hooks/useAIUsage";
import { GeminiModelSelect, loadGeminiModel } from "@/components/GeminiModelSelect";
import {
  isPersonalGeminiEnabled,
  callPersonalGemini,
  isPersonalGeminiFallbackEnabled,
  PersonalGeminiExhaustedError,
  recordLovableGatewayUsage,
} from "@/lib/personalGemini";

interface TranscriptSummaryProps {
  transcript: string;
}

const MODEL_STORAGE = "summary_gemini_model";

export const TranscriptSummary = ({ transcript }: TranscriptSummaryProps) => {
  const [summary, setSummary] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState<string>(() => loadGeminiModel(MODEL_STORAGE));

  const generateSummary = async () => {
    if (!transcript.trim()) {
      toast({ title: "שגיאה", description: "אין טקסט לסכם", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      let text: string | null = null;

      // Personal Gemini path (client-side, uses user's key)
      if (isPersonalGeminiEnabled()) {
        try {
          text = await callPersonalGemini({
            systemPrompt:
              'אתה עוזר שמסכם תמלולי אודיו בעברית. צור סיכום תמציתי של 3-5 משפטים, תוך שמירה על נקודות המפתח החשובות ביותר. הסיכום חייב להיות בעברית בלבד.',
            userPrompt: `סכם את הטקסט הבא:\n\n${transcript}`,
            model,
            temperature: 0.7,
          });
        } catch (e) {
          if (e instanceof PersonalGeminiExhaustedError && isPersonalGeminiFallbackEnabled()) {
            toast({ title: "Gemini האישי מוצה", description: "עוברים ל-Lovable AI" });
          } else {
            throw e;
          }
        }
      }

      // Lovable AI fallback / default
      if (!text) {
        const { data, error } = await supabase.functions.invoke('summarize-transcript', {
          body: { text: transcript, model },
        });
        if (error) throw error;
        text = data?.summary ?? null;
      }

      if (text) {
        setSummary(text);
        notifyUsageUpdated();
        toast({ title: "הצלחה", description: "הסיכום נוצר בהצלחה" });
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה ביצירת סיכום",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    toast({ title: "הועתק", description: "הסיכום הועתק ללוח" });
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-right">סיכום AI</h2>
          <AIUsageBadge feature="summary" model={model} />
        </div>
        <div className="flex items-center gap-2">
          <GeminiModelSelect value={model} onChange={setModel} storageKey={MODEL_STORAGE} compact />
          <Button onClick={generateSummary} disabled={!transcript.trim() || isLoading} size="sm">
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                מסכם...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 ml-2" />
                צור סיכום
              </>
            )}
          </Button>
        </div>
      </div>

      {summary && (
        <>
          <Textarea
            value={summary}
            readOnly
            className="min-h-[150px] mb-3 text-right bg-accent/20"
            dir="rtl"
          />
          <Button variant="outline" size="sm" onClick={handleCopy} className="w-full">
            <Copy className="w-4 h-4 ml-2" />
            העתק סיכום
          </Button>
        </>
      )}

      {!summary && !isLoading && (
        <p className="text-sm text-muted-foreground text-right">
          לחץ על "צור סיכום" לקבלת סיכום מקוצר של התמלול
        </p>
      )}
    </Card>
  );
};
