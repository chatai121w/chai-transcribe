import { useMemo, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  DEFINITIVE_RULES,
  applyDefinitiveRulesToText,
  areDefinitiveRulesEnabled,
  setDefinitiveRulesEnabled,
} from '@/utils/hebrewRuleEngine';

export function DefinitiveRulesPanel() {
  const [enabled, setEnabled] = useState(areDefinitiveRulesEnabled);
  const [sample, setSample] = useState('חוקיכ מצוותיכ םילה  טובה .');
  const result = useMemo(() => applyDefinitiveRulesToText(sample), [sample]);

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" />תיקונים חד־משמעיים</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="definitive-rules">הפעל בכל תמלול</Label>
              <Switch id="definitive-rules" checked={enabled} onCheckedChange={(value) => { setEnabled(value); setDefinitiveRulesEnabled(value); }} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {DEFINITIVE_RULES.map(rule => (
            <div key={rule.id} className="border-b last:border-0 pb-3 last:pb-0">
              <div className="font-medium flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{rule.title}<Badge variant="outline">קבוע</Badge></div>
              <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
              <p className="text-xs mt-1">{rule.examples.join(' · ')}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">בדיקת הכללים</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div><Label>לפני</Label><Textarea value={sample} onChange={e => setSample(e.target.value)} className="mt-1 min-h-28" /></div>
          <div><Label>אחרי</Label><div className="mt-1 min-h-28 rounded-md border bg-muted/30 p-3">{result.fixedText}</div></div>
          <p className="text-xs text-muted-foreground md:col-span-2">הופעלו {result.hits.length} תיקונים. כללים אלה דקדוקיים וקבועים, ואינם תלויים בכמות אישורים או בביטחון סטטיסטי.</p>
        </CardContent>
      </Card>
    </div>
  );
}
