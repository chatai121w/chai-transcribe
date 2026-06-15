import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Workflow, Plus, Trash2, Play, Loader2, ArrowDown, GripVertical, ChevronDown, Cpu
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { useOllama, isOllamaModel, getOllamaModelName } from "@/hooks/useOllama";

interface EditPipelineProps {
  text: string;
  onTextChange: (text: string, source: string, customPrompt?: string) => void;
}

interface PipelineStep {
  id: string;
  action: string;
  label: string;
}

const AVAILABLE_STEPS = [
  { value: 'grammar', label: 'תיקון דקדוק ואיות' },
  { value: 'punctuation', label: 'הוספת פיסוק' },
  { value: 'paragraphs', label: 'חלוקה לפסקאות' },
  { value: 'headings', label: 'הוספת כותרות' },
  { value: 'improve', label: 'שיפור ניסוח' },
  { value: 'readable', label: 'זרימה לקריאה' },
  { value: 'bullets', label: 'נקודות מפתח' },
  { value: 'expand', label: 'הרחבה' },
  { value: 'shorten', label: 'קיצור' },
  { value: 'summarize', label: 'סיכום' },
  { value: 'sources', label: 'הוספת מקורות' },
  { value: 'speakers', label: 'זיהוי דוברים' },
];

const PRESET_PIPELINES = [
  {
    label: 'תמלול → מסמך מקצועי',
    steps: [
      { action: 'grammar', label: 'תיקון דקדוק ואיות' },
      { action: 'punctuation', label: 'הוספת פיסוק' },
      { action: 'paragraphs', label: 'חלוקה לפסקאות' },
      { action: 'headings', label: 'הוספת כותרות' },
      { action: 'improve', label: 'שיפור ניסוח' },
    ]
  },
  {
    label: 'תמלול → סיכום תמציתי',
    steps: [
      { action: 'grammar', label: 'תיקון דקדוק ואיות' },
      { action: 'punctuation', label: 'הוספת פיסוק' },
      { action: 'shorten', label: 'קיצור' },
      { action: 'summarize', label: 'סיכום' },
    ]
  },
  {
    label: 'תמלול → נקודות מפתח',
    steps: [
      { action: 'grammar', label: 'תיקון דקדוק ואיות' },
      { action: 'bullets', label: 'נקודות מפתח' },
    ]
  },
  {
    label: 'שיחה → פרוטוקול',
    steps: [
      { action: 'speakers', label: 'זיהוי דוברים' },
      { action: 'grammar', label: 'תיקון דקדוק ואיות' },
      { action: 'punctuation', label: 'הוספת פיסוק' },
      { action: 'paragraphs', label: 'חלוקה לפסקאות' },
    ]
  },
];

const CLOUD_MODELS = [
  // Google Gemini
  { value: 'google/gemini-2.5-flash', label: '☁️ Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: '☁️ Gemini 2.5 Pro' },
  { value: 'google/gemini-2.5-flash-lite', label: '☁️ Gemini Flash Lite' },
  { value: 'google/gemini-3-flash-preview', label: '☁️ Gemini 3 Flash' },
  { value: 'google/gemini-3.1-pro-preview', label: '☁️ Gemini 3.1 Pro' },
  // OpenAI
  { value: 'openai/gpt-5', label: '☁️ GPT-5' },
  { value: 'openai/gpt-5-mini', label: '☁️ GPT-5 Mini' },
  { value: 'openai/gpt-5-nano', label: '☁️ GPT-5 Nano' },
  { value: 'openai/gpt-5.2', label: '☁️ GPT-5.2' },
  { value: 'openai/gpt-4o', label: '☁️ GPT-4o' },
  { value: 'openai/gpt-4o-mini', label: '☁️ GPT-4o Mini' },
  // Anthropic
  { value: 'anthropic/claude-3.5-sonnet', label: '☁️ Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-haiku', label: '☁️ Claude 3 Haiku' },
  // Cohere
  { value: 'cohere/command-r', label: '☁️ Command R' },
  { value: 'cohere/aya-expanse-8b', label: '☁️ Aya Expanse 8B' },
  // Meta & Mistral
  { value: 'meta-llama/llama-3.1-70b-instruct', label: '☁️ Llama 3.1 70B' },
  { value: 'mistralai/mistral-large-latest', label: '☁️ Mistral Large' },
  // Qwen
  { value: 'qwen/qwen-2.5-14b-instruct', label: '☁️ Qwen 2.5 14B' },
  { value: 'qwen/qwen-2.5-32b-instruct', label: '☁️ Qwen 2.5 32B' },
];

export const EditPipeline = ({ text, onTextChange }: EditPipelineProps) => {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState<number>(0);
  const [model, setModel] = useState('google/gemini-2.5-flash');
  const [intermediateResults, setIntermediateResults] = useState<string[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const ollama = useOllama();

  const AI_MODELS = [
    ...CLOUD_MODELS,
    ...ollama.models.map(m => ({
      value: `ollama:${m.name}`,
      label: `🖥️ ${m.name}`,
    })),
  ];

  const addStep = (action: string) => {
    const stepDef = AVAILABLE_STEPS.find(s => s.value === action);
    if (!stepDef) return;
    setSteps(prev => [...prev, {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: stepDef.value,
      label: stepDef.label,
    }]);
  };

  const removeStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  const loadPreset = (preset: typeof PRESET_PIPELINES[0]) => {
    setSteps(preset.steps.map((s, i) => ({
      id: `preset-${Date.now()}-${i}`,
      action: s.action,
      label: s.label,
    })));
    setShowPresets(false);
    toast({ title: "נטען", description: `תבנית "${preset.label}" נטענה` });
  };

  const runPipeline = async () => {
    if (!text.trim()) {
      toast({ title: "שגיאה", description: "אין טקסט לעריכה", variant: "destructive" });
      return;
    }
    if (steps.length === 0) {
      toast({ title: "שגיאה", description: "הוסף לפחות שלב אחד לצינור", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    setCompletedSteps(0);
    setIntermediateResults([]);

    let currentText = text;
    const results: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      setCurrentStepIndex(i);

      try {
        let responseText: string;

        if (isOllamaModel(model)) {
          // Local Ollama execution
          responseText = await ollama.editText({
            text: currentText,
            action: steps[i].action,
            model: getOllamaModelName(model),
          });
        } else {
          // Cloud execution via DB proxy → edge function fallback
          responseText = await editTranscriptCloud({
            text: currentText,
            action: steps[i].action,
            model,
          });
        }

        if (responseText) {
          currentText = responseText;
          results.push(currentText);
          setIntermediateResults([...results]);
          setCompletedSteps(i + 1);
        } else {
          throw new Error('No response from AI');
        }
      } catch (error) {
        console.error(`Pipeline step ${i} failed:`, error);
        toast({
          title: "שגיאה בצינור",
          description: `שלב ${i + 1} (${steps[i].label}) נכשל: ${error instanceof Error ? error.message : 'שגיאה'}`,
          variant: "destructive",
        });
        break;
      }
    }

    if (currentText !== text) {
      onTextChange(currentText, 'ai-custom', `צינור: ${steps.map(s => s.label).join(' → ')}`);
      toast({ title: "הצלחה", description: `צינור עיבוד הושלם (${results.length}/${steps.length} שלבים)` });
    }

    setIsRunning(false);
    setCurrentStepIndex(-1);
  };

  const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">צינור עיבוד אוטומטי</h2>
          {ollama.isConnected && (
            <Badge variant="outline" className="text-xs text-green-600 border-green-300">
              <Cpu className="w-3 h-3 ml-1" />
              Ollama
            </Badge>
          )}
        </div>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="w-[200px] text-xs" dir="rtl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {CLOUD_MODELS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
            {ollama.models.length > 0 && (
              <>
                {ollama.models.map(m => (
                  <SelectItem key={`ollama:${m.name}`} value={`ollama:${m.name}`}>🖥️ {m.name}</SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Preset pipelines */}
      <div className="mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPresets(!showPresets)}
          className="mb-2"
        >
          <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${showPresets ? 'rotate-180' : ''}`} />
          תבניות מוכנות
        </Button>

        {showPresets && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 p-3 bg-muted/30 rounded-lg">
            {PRESET_PIPELINES.map((preset, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                className="justify-start text-xs h-auto py-2"
                onClick={() => loadPreset(preset)}
              >
                <div className="text-right">
                  <p className="font-medium">{preset.label}</p>
                  <p className="text-muted-foreground">{preset.steps.length} שלבים</p>
                </div>
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Add step */}
      <div className="flex gap-2 items-center mb-4">
        <Select onValueChange={addStep}>
          <SelectTrigger className="flex-1 text-xs" dir="rtl">
            <SelectValue placeholder="הוסף שלב לצינור..." />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {AVAILABLE_STEPS.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pipeline steps */}
      <ScrollArea className="max-h-[400px]">
        {steps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            הוסף שלבים לצינור העיבוד או בחר תבנית מוכנה
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={step.id}>
                <div className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                  currentStepIndex === idx ? 'bg-primary/10 border-primary' :
                  idx < completedSteps ? 'bg-green-50 dark:bg-green-950/20 border-green-300' :
                  'bg-background'
                }`}>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <GripVertical className="w-3 h-3" />
                    <Badge variant="outline" className="text-xs w-6 h-6 p-0 flex items-center justify-center">
                      {idx + 1}
                    </Badge>
                  </div>

                  <span className="flex-1 text-sm font-medium">{step.label}</span>

                  {currentStepIndex === idx && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {idx < completedSteps && currentStepIndex !== idx && (
                    <Badge variant="secondary" className="text-xs text-green-600">הושלם</Badge>
                  )}

                  {!isRunning && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(step.id)}
                      className="h-7 w-7 p-0"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </div>

                {idx < steps.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowDown className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Progress */}
      {isRunning && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>שלב {currentStepIndex + 1} מתוך {steps.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Run button */}
      <div className="flex gap-2 mt-4 pt-4 border-t">
        <Button
          onClick={runPipeline}
          disabled={isRunning || steps.length === 0 || !text.trim()}
          className="flex-1"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin ml-2" />
              מעבד...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 ml-2" />
              הפעל צינור ({steps.length} שלבים)
            </>
          )}
        </Button>

        {steps.length > 0 && !isRunning && (
          <Button variant="outline" onClick={() => { setSteps([]); setIntermediateResults([]); setCompletedSteps(0); }}>
            <Trash2 className="w-4 h-4 ml-1" />
            נקה
          </Button>
        )}
      </div>

      {/* Intermediate results preview */}
      {intermediateResults.length > 0 && !isRunning && (
        <div className="mt-4 pt-4 border-t space-y-2">
          <Label className="text-sm font-semibold">תוצאה סופית:</Label>
          <Textarea
            value={intermediateResults[intermediateResults.length - 1]}
            readOnly
            className="min-h-[150px] text-right bg-accent/10"
            dir="rtl"
          />
          <p className="text-xs text-muted-foreground">
            הטקסט הראשי כבר עודכן עם התוצאה הסופית
          </p>
        </div>
      )}
    </Card>
  );
};
