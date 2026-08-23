import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Pilcrow, SpellCheck, Wand2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTranscriptFormatting, type TranscriptFormattingAction } from '@/hooks/useTranscriptFormatting';

export function TranscriptFormattingControls({ text, onTextChange }: { text: string; onTextChange: (text: string) => void }) {
  const formatter = useTranscriptFormatting();
  const [running, setRunning] = useState<TranscriptFormattingAction | null>(null);
  const actions: Array<{ action: TranscriptFormattingAction; label: string; icon: typeof Wand2 }> = [
    { action: 'fix_and_split', label: 'פיסוק + פסקאות', icon: Wand2 },
    { action: 'fix_errors', label: 'תיקון', icon: SpellCheck },
    { action: 'split_paragraphs', label: 'פסקאות', icon: Pilcrow },
  ];

  const apply = async (action: TranscriptFormattingAction) => {
    setRunning(action);
    try {
      onTextChange(await formatter.run(text, action));
      toast({ title: 'העיבוד הושלם', description: 'הטקסט המעודכן מוכן לעריכה ולייצוא' });
    } catch (error) {
      toast({ title: 'העיבוד נכשל', description: error instanceof Error ? error.message : 'שגיאה', variant: 'destructive' });
    } finally { setRunning(null); }
  };

  return (
    <section className="w-full border-y py-3" dir="rtl" aria-label="מנועי פיסוק וחלוקה לפסקאות">
      <div className="mb-2 text-right text-sm font-semibold">פיסוק וחלוקה לפסקאות</div>
      <div className="grid gap-2 lg:grid-cols-3">
        {actions.map(({ action, label, icon: Icon }) => (
          <div key={action} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <Select value={formatter.selected(action)} onValueChange={(value) => formatter.saveSelection(action, value)}>
              <SelectTrigger className="h-9 min-w-0 text-xs" dir="rtl" aria-label={`בחירת מנוע עבור ${label}`}>
                <SelectValue placeholder="בחר מנוע" />
              </SelectTrigger>
              <SelectContent dir="rtl" align="end">
                {formatter.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant={action === 'fix_and_split' ? 'default' : 'outline'} className="h-9 gap-1" disabled={!!running} onClick={() => void apply(action)}>
              {running === action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {label}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
