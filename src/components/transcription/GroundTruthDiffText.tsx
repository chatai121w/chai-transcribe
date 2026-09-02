import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { buildAdjudicationUnits } from '@/lib/textAdjudication';
import { cn } from '@/lib/utils';

interface GroundTruthDiffTextProps {
  groundTruth: string;
  hypothesis: string;
  label: string;
  testId: string;
}

export function GroundTruthDiffText({ groundTruth, hypothesis, label, testId }: GroundTruthDiffTextProps) {
  const units = useMemo(
    () => buildAdjudicationUnits(groundTruth, hypothesis, { mergeEqual: false }),
    [groundTruth, hypothesis],
  );
  const conflictCount = units.filter((unit) => unit.kind === 'conflict').length;

  return (
    <section className="space-y-2" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{label}</h3>
        <Badge variant={conflictCount ? 'destructive' : 'secondary'}>
          {conflictCount ? `${conflictCount} מוקדי שינוי` : 'זהה לטקסט האמת'}
        </Badge>
      </div>
      <div
        role="textbox"
        aria-readonly="true"
        dir="rtl"
        data-testid={testId}
        className="min-h-72 max-h-[32rem] overflow-y-auto border bg-background p-4 text-right leading-8 whitespace-pre-wrap"
      >
        {units.map((unit) => {
          if (unit.kind === 'equal') return <span key={unit.id}>{unit.rightText}</span>;
          if (!unit.rightText.trim()) {
            return (
              <span
                key={unit.id}
                data-diff="missing"
                title={`חסר לעומת טקסט האמת: ${unit.leftText.trim()}`}
                className="mx-1 inline-block border border-red-300 bg-red-50 px-1 text-red-800"
              >
                חסר: {unit.leftText.trim()}
              </span>
            );
          }
          return (
            <mark
              key={unit.id}
              data-diff="changed"
              title={`טקסט אמת: ${unit.leftText.trim() || 'ללא מילה'}`}
              className={cn('bg-red-100 px-0.5 text-red-900 underline decoration-red-500 decoration-wavy underline-offset-4')}
            >
              {unit.rightText}
            </mark>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">אדום מסמן טקסט ששונה מטקסט האמת. מעבר עם העכבר מציג את הנוסח הנכון.</p>
    </section>
  );
}
