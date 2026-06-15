import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BookMarked, Plus, Trash2, Play, Save, Search, Loader2, Cpu } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { useOllama, isOllamaModel, getOllamaModelName } from "@/hooks/useOllama";

interface PromptLibraryProps {
  text: string;
  onTextChange: (text: string, source: string, customPrompt?: string) => void;
}

interface SavedPrompt {
  id: string;
  label: string;
  prompt: string;
  category: string;
}

const PRESET_CATEGORIES = [
  {
    category: 'אקדמי',
    prompts: [
      { id: 'acad-1', label: 'שכתב כמאמר אקדמי', prompt: 'שכתב את הטקסט הבא בסגנון מאמר אקדמי מחקרי. הוסף מבנה אקדמי, מונחים מקצועיים, וסמן מקומות למקורות.', category: 'אקדמי' },
      { id: 'acad-2', label: 'הוסף ביבליוגרפיה', prompt: 'נתח את הטקסט וציין אילו מקורות ביבליוגרפיים נדרשים. הצע פורמט APA לכל מקור.', category: 'אקדמי' },
      { id: 'acad-3', label: 'צור תקציר מחקרי', prompt: 'צור תקציר (Abstract) מחקרי מהטקסט הבא. 150-250 מילים, כולל: רקע, מטרה, שיטה, ממצאים ומסקנות.', category: 'אקדמי' },
    ]
  },
  {
    category: 'עסקי',
    prompts: [
      { id: 'biz-1', label: 'פרוטוקול ישיבה', prompt: 'הפוך את התמלול הבא לפרוטוקול ישיבה מסודר עם: תאריך, משתתפים, נושאי דיון, החלטות, ומשימות לביצוע.', category: 'עסקי' },
      { id: 'biz-2', label: 'דוח מנהלים', prompt: 'צור דוח מנהלים (Executive Summary) תמציתי מהטקסט. כולל: סיכום מנהלים, נקודות עיקריות, המלצות לפעולה.', category: 'עסקי' },
      { id: 'biz-3', label: 'מייל מקצועי', prompt: 'הפוך את התוכן למייל מקצועי מאורגן עם: שורת נושא, פתיחה, גוף מובנה, וסיום עם קריאה לפעולה.', category: 'עסקי' },
      { id: 'biz-4', label: 'הצעת מחיר', prompt: 'ארגן את התוכן כהצעת מחיר מקצועית עם: סקירה, פירוט שירותים, לוחות זמנים, ותנאים.', category: 'עסקי' },
    ]
  },
  {
    category: 'חדשות ותקשורת',
    prompts: [
      { id: 'news-1', label: 'כתבה חדשותית', prompt: 'שכתב את הטקסט כמאמר חדשותי. פיסקה ראשונה מסכמת (מי, מה, מתי, איפה, למה). שאר הכתבה מפרטת ומעמיקה.', category: 'חדשות ותקשורת' },
      { id: 'news-2', label: 'פוסט לרשתות', prompt: 'צור פוסט אטרקטיבי לרשתות חברתיות מהתוכן. קצר, קליט, עם אמוג\'ים מתאימים והאשטגים.', category: 'חדשות ותקשורת' },
      { id: 'news-3', label: 'הודעה לעיתונות', prompt: 'הפוך את התוכן להודעה לעיתונות מקצועית עם: כותרת, תת-כותרת, גוף, ציטוטים, ופרטי יצירת קשר.', category: 'חדשות ותקשורת' },
    ]
  },
  {
    category: 'חינוך',
    prompts: [
      { id: 'edu-1', label: 'סיכום שיעור', prompt: 'הפוך את התמלול לסיכום שיעור מאורגן עם: נושא ראשי, נקודות מפתח, מושגים חשובים, ושאלות לחזרה.', category: 'חינוך' },
      { id: 'edu-2', label: 'שאלון בחינה', prompt: 'צור 10 שאלות בחינה מהתוכן: 5 שאלות רב-ברירה, 3 שאלות פתוחות, ו-2 שאלות נכון/לא נכון. הוסף תשובות בסוף.', category: 'חינוך' },
      { id: 'edu-3', label: 'מצגת שקפים', prompt: 'חלק את התוכן ל-10 שקפים: כותרת ו-3-5 נקודות לכל שקף. שקף ראשון — כותרת, אחרון — סיכום.', category: 'חינוך' },
      { id: 'edu-4', label: 'מילון מונחים', prompt: 'הפק רשימת מונחים מקצועיים מהטקסט עם הגדרה קצרה לכל מונח. סדר לפי א-ב.', category: 'חינוך' },
    ]
  },
  {
    category: 'רפואי ומשפטי',
    prompts: [
      { id: 'med-1', label: 'סיכום רפואי', prompt: 'ארגן את התמלול כסיכום רפואי מובנה: תלונה עיקרית, רקע רפואי, ממצאים, אבחנה מבדלת, ותוכנית טיפול.', category: 'רפואי ומשפטי' },
      { id: 'legal-1', label: 'פרוטוקול משפטי', prompt: 'ארגן את התמלול כפרוטוקול דיון משפטי: צדדים, טענות, ראיות שהוצגו, והחלטות.', category: 'רפואי ומשפטי' },
      { id: 'legal-2', label: 'סיכום חוזה', prompt: 'הפק סיכום עיקרי תנאים מהטקסט: צדדים, תחולה, התחייבויות, תנאים, ומועדים.', category: 'רפואי ומשפטי' },
    ]
  },
  {
    category: 'יצירתי',
    prompts: [
      { id: 'cre-1', label: 'סיפור קצר', prompt: 'הפוך את התוכן לסיפור קצר מרתק. הוסף תיאורים, דיאלוגים, ובנה עלילה עם התחלה, אמצע וסוף.', category: 'יצירתי' },
      { id: 'cre-2', label: 'שיר', prompt: 'צור שיר מהתוכן הבא. השתמש בדימויים, חרוזים (אופציונלי), ושפה פיוטית. שמור על רוח התוכן.', category: 'יצירתי' },
      { id: 'cre-3', label: 'תסריט', prompt: 'הפוך את התוכן לתסריט (סקריפט) עם: הוראות במה, דיאלוגים, ותיאורי סצנה.', category: 'יצירתי' },
    ]
  },
];

const STORAGE_KEY = 'custom_prompts_library';

export const PromptLibrary = ({ text, onTextChange }: PromptLibraryProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [selectedEngine, setSelectedEngine] = useState('cloud');
  const ollama = useOllama();

  // Engine options: cloud + each Ollama model
  const engineOptions = [
    { value: 'cloud', label: '☁️ ענן (Gemini Flash)' },
    ...ollama.models.map(m => ({
      value: `ollama:${m.name}`,
      label: `🖥️ ${m.name}`,
    })),
  ];

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setSavedPrompts(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const persistPrompts = (prompts: SavedPrompt[]) => {
    setSavedPrompts(prompts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  };

  const handleSavePrompt = () => {
    if (!newLabel.trim() || !newPrompt.trim()) {
      toast({ title: "שגיאה", description: "יש למלא שם ופרומפט", variant: "destructive" });
      return;
    }
    const prompt: SavedPrompt = {
      id: `custom-${Date.now()}`,
      label: newLabel.trim(),
      prompt: newPrompt.trim(),
      category: newCategory.trim() || 'מותאם אישי',
    };
    persistPrompts([...savedPrompts, prompt]);
    setNewLabel("");
    setNewPrompt("");
    setNewCategory("");
    setShowSaveDialog(false);
    toast({ title: "נשמר", description: "הפרומפט נשמר בספרייה" });
  };

  const handleDeletePrompt = (id: string) => {
    persistPrompts(savedPrompts.filter(p => p.id !== id));
    toast({ title: "נמחק", description: "הפרומפט הוסר מהספרייה" });
  };

  const handleRunPrompt = async (prompt: string, label: string) => {
    if (!text.trim()) {
      toast({ title: "שגיאה", description: "אין טקסט לעריכה", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setActivePrompt(label);

    try {
      let resultText: string;

      if (isOllamaModel(selectedEngine)) {
        // Local Ollama execution
        resultText = await ollama.editText({
          text,
          action: 'custom',
          model: getOllamaModelName(selectedEngine),
          customPrompt: prompt,
        });
      } else {
        // Cloud execution via DB proxy → edge function fallback
        resultText = await editTranscriptCloud({
          text, action: 'custom', customPrompt: prompt,
        });
      }

      if (resultText) {
        onTextChange(resultText, 'ai-custom', label);
        toast({ title: "הצלחה", description: `"${label}" בוצע בהצלחה` });
      }
    } catch (error) {
      toast({
        title: "שגיאה",
        description: error instanceof Error ? error.message : "שגיאה בביצוע",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setActivePrompt(null);
    }
  };

  // Group saved prompts by category
  const savedByCategory = savedPrompts.reduce<Record<string, SavedPrompt[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});

  // Filter by search
  const filterPrompts = <T extends { label: string; prompt: string }>(prompts: T[]): T[] => {
    if (!searchQuery.trim()) return prompts;
    const q = searchQuery.toLowerCase();
    return prompts.filter(p => p.label.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q));
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookMarked className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">ספריית פרומפטים</h2>
          <Badge variant="secondary" className="text-xs">
            {PRESET_CATEGORIES.reduce((n, c) => n + c.prompts.length, 0) + savedPrompts.length} פרומפטים
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedEngine} onValueChange={setSelectedEngine}>
            <SelectTrigger className="w-[180px] text-xs" dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="cloud">☁️ ענן (Gemini Flash)</SelectItem>
              {ollama.models.map(m => (
                <SelectItem key={`ollama:${m.name}`} value={`ollama:${m.name}`}>🖥️ {m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="w-4 h-4 ml-1" />
                שמור פרומפט חדש
              </Button>
            </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>שמירת פרומפט חדש</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">שם הפרומפט</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="למשל: תרגום טכני"
                  dir="rtl"
                />
              </div>
              <div>
                <Label className="text-sm">קטגוריה (אופציונלי)</Label>
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="מותאם אישי"
                  dir="rtl"
                />
              </div>
              <div>
                <Label className="text-sm">פרומפט</Label>
                <Textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="הוראות ל-AI..."
                  className="min-h-[100px] text-right"
                  dir="rtl"
                />
              </div>
              <Button onClick={handleSavePrompt} className="w-full">
                <Save className="w-4 h-4 ml-1" />
                שמור
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="חיפוש פרומפט..."
          className="pr-9 text-right"
          dir="rtl"
        />
      </div>

      <ScrollArea className="h-[500px]">
        <Accordion type="multiple" defaultValue={['אקדמי', 'עסקי']} className="space-y-1">
          {/* Saved custom prompts */}
          {Object.keys(savedByCategory).length > 0 && Object.entries(savedByCategory).map(([cat, prompts]) => {
            const filtered = filterPrompts(prompts);
            if (filtered.length === 0) return null;
            return (
              <AccordionItem key={`saved-${cat}`} value={`saved-${cat}`}>
                <AccordionTrigger className="text-sm font-semibold">
                  {cat}
                  <Badge variant="outline" className="mr-2 text-xs">{filtered.length} שלך</Badge>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {filtered.map((p) => (
                      <div key={p.id} className="flex items-start gap-2 p-2 rounded border bg-primary/5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.prompt}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRunPrompt(p.prompt, p.label)}
                            disabled={isProcessing || !text.trim()}
                            title="הפעל"
                          >
                            {activePrompt === p.label ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePrompt(p.id)}
                            title="מחק"
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}

          {/* Preset categories */}
          {PRESET_CATEGORIES.map(({ category, prompts }) => {
            const filtered = filterPrompts(prompts);
            if (filtered.length === 0) return null;
            return (
              <AccordionItem key={category} value={category}>
                <AccordionTrigger className="text-sm font-semibold">
                  {category}
                  <Badge variant="secondary" className="mr-2 text-xs">{filtered.length}</Badge>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {filtered.map((p) => (
                      <div key={p.id} className="flex items-start gap-2 p-2 rounded border hover:bg-accent/10 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.prompt}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRunPrompt(p.prompt, p.label)}
                          disabled={isProcessing || !text.trim()}
                          title="הפעל"
                          className="shrink-0"
                        >
                          {activePrompt === p.label ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </ScrollArea>

      {!text.trim() && (
        <p className="text-xs text-muted-foreground text-center mt-3 border-t pt-3">
          יש להזין טקסט כדי להפעיל פרומפטים
        </p>
      )}
    </Card>
  );
};
