import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Languages, ListChecks, Newspaper, BookOpen, PenLine, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";

interface EditingTemplatesProps {
  text: string;
  onApply: (newText: string, templateName: string) => void;
}

interface Template {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
  category: 'cleanup' | 'format' | 'transform';
}

const templates: Template[] = [
  {
    id: 'clean_text',
    label: 'נקה טקסט',
    description: 'הסר רעשים, מילות מילוי, חזרות ושגיאות',
    icon: <Sparkles className="w-4 h-4" />,
    prompt: 'נקה את הטקסט הבא: הסר מילות מילוי מיותרות (אמ, אה, כאילו, בעצם), הסר חזרות מיותרות, תקן שגיאות כתיב ודקדוק, וודא שהטקסט זורם בצורה טבעית. אל תשנה את המשמעות. החזר רק את הטקסט המנוקה.',
    category: 'cleanup',
  },
  {
    id: 'add_nikud',
    label: 'הוסף ניקוד',
    description: 'הוסף ניקוד מלא לטקסט בעברית',
    icon: <PenLine className="w-4 h-4" />,
    prompt: 'הוסף ניקוד מלא לטקסט העברי הבא. ודא שהניקוד מדויק דקדוקית. החזר רק את הטקסט עם ניקוד.',
    category: 'transform',
  },
  {
    id: 'format_article',
    label: 'פורמט לכתבה',
    description: 'עצב כמאמר עם כותרות, פסקאות ומבנה',
    icon: <Newspaper className="w-4 h-4" />,
    prompt: 'הפוך את הטקסט הבא למאמר/כתבה מעוצבת: הוסף כותרת ראשית מתאימה, חלק לפסקאות עם כותרות משנה, ודא מבנה לוגי עם פתיחה, גוף וסיכום. שמור על התוכן המקורי אך שפר את המבנה והזרימה. החזר רק את הטקסט המעוצב.',
    category: 'format',
  },
  {
    id: 'bullet_points',
    label: 'נקודות מפתח',
    description: 'הפוך לרשימת נקודות מסודרת',
    icon: <ListChecks className="w-4 h-4" />,
    prompt: 'הפוך את הטקסט הבא לרשימת נקודות מפתח (bullet points) מסודרת. חלץ את הנקודות העיקריות, ארגן אותן בסדר לוגי, והשתמש בתת-נקודות כשצריך. החזר רק את הרשימה.',
    category: 'format',
  },
  {
    id: 'formal',
    label: 'שפה רשמית',
    description: 'המר לשפה רשמית ומקצועית',
    icon: <BookOpen className="w-4 h-4" />,
    prompt: 'המר את הטקסט הבא לשפה רשמית ומקצועית. השתמש במשלב לשון גבוה, הימנע מסלנג ומביטויים יומיומיים, ושמור על בהירות ודיוק. החזר רק את הטקסט המומר.',
    category: 'transform',
  },
  {
    id: 'translate_en',
    label: 'תרגם לאנגלית',
    description: 'תרגום מקצועי לאנגלית',
    icon: <Languages className="w-4 h-4" />,
    prompt: 'Translate the following Hebrew text to English. Maintain the original meaning, tone, and structure. Provide a professional and accurate translation. Return only the translated text.',
    category: 'transform',
  },
  {
    id: 'meeting_summary',
    label: 'סיכום פגישה',
    description: 'הפוך לסיכום פגישה מסודר',
    icon: <FileText className="w-4 h-4" />,
    prompt: 'הפוך את הטקסט הבא (תמלול פגישה/שיחה) לסיכום פגישה מקצועי. כלול: נושאים שנדונו, החלטות שהתקבלו, משימות (action items) עם אחראים אם ניתן לזהות, ונקודות פתוחות. החזר רק את הסיכום המעוצב.',
    category: 'format',
  },
];

const categoryLabels: Record<string, string> = {
  cleanup: 'ניקוי',
  format: 'עיצוב',
  transform: 'המרה',
};

export const EditingTemplates = ({ text, onApply }: EditingTemplatesProps) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleApplyTemplate = async (template: Template) => {
    if (!text.trim()) {
      toast({ title: "אין טקסט לעיבוד", variant: "destructive" });
      return;
    }
    setLoadingId(template.id);
    try {
      const resultText = await editTranscriptCloud({
        text, action: 'custom', customPrompt: template.prompt
      });
      onApply(resultText, template.label);
      toast({ title: `${template.label} הושלם ✅` });
    } catch (err) {
      toast({
        title: "שגיאה",
        description: err instanceof Error ? err.message : 'שגיאה בעיבוד',
        variant: "destructive",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const grouped = templates.reduce((acc, t) => {
    (acc[t.category] = acc[t.category] || []).push(t);
    return acc;
  }, {} as Record<string, Template[]>);

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-semibold">תבניות עריכה</h2>
      </div>

      <div className="space-y-5">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="space-y-2">
            <Badge variant="secondary" className="text-xs">{categoryLabels[category]}</Badge>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(template => (
                <button
                  key={template.id}
                  onClick={() => handleApplyTemplate(template)}
                  disabled={!!loadingId || !text.trim()}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-right disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="mt-0.5 text-primary shrink-0">
                    {loadingId === template.id ? <Loader2 className="w-4 h-4 animate-spin" /> : template.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{template.label}</p>
                    <p className="text-xs text-muted-foreground">{template.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
