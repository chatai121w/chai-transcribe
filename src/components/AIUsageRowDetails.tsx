import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { calcCostUSD, fmtUSD, fmtILS, loadUsdToIls } from "@/lib/aiPricing";
import type { AIUsageRow } from "@/hooks/useAIUsage";

export function AIUsageRowDetails({ row }: { row: AIUsageRow }) {
  const [open, setOpen] = useState(false);
  const fx = loadUsdToIls();
  const cost = row.cost_usd_snapshot ?? calcCostUSD(row.model, row.prompt_tokens, row.completion_tokens);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>פירוט קריאה ל-AI</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Field label="מודל" value={row.model} mono />
          <Field label="פיצ'ר" value={row.feature} />
          <Field label="זמן" value={new Date(row.created_at).toLocaleString("he-IL")} />
          <Field label="משך" value={row.duration_ms ? `${row.duration_ms} ms` : "—"} />
          <Field label="קלט (טוקנים)" value={(row.prompt_tokens||0).toLocaleString()} />
          <Field label="פלט (טוקנים)" value={(row.completion_tokens||0).toLocaleString()} />
          <Field label="סה״כ" value={(row.total_tokens||0).toLocaleString()} />
          <Field label="עלות" value={`${fmtUSD(cost)} / ${fmtILS(cost * fx)}`} />
        </div>

        {row.params && Object.keys(row.params).length > 0 && (
          <Section title="פרמטרים">
            <pre className="text-xs bg-muted/30 p-2 rounded overflow-auto max-h-40" dir="ltr">
              {JSON.stringify(row.params, null, 2)}
            </pre>
          </Section>
        )}

        {row.system_prompt && (
          <Section title="הוראת מערכת (System Prompt)">
            <div className="text-xs bg-muted/30 p-2 rounded whitespace-pre-wrap max-h-40 overflow-auto">
              {row.system_prompt}
            </div>
          </Section>
        )}

        {row.prompt_preview && (
          <Section title="קלט (500 תווים ראשונים)">
            <div className="text-xs bg-muted/30 p-2 rounded whitespace-pre-wrap max-h-48 overflow-auto">
              {row.prompt_preview}
            </div>
          </Section>
        )}

        {row.response_preview && (
          <Section title="תשובה (500 תווים ראשונים)">
            <div className="text-xs bg-muted/30 p-2 rounded whitespace-pre-wrap max-h-48 overflow-auto">
              {row.response_preview}
            </div>
          </Section>
        )}

        {!row.prompt_preview && !row.response_preview && !row.system_prompt && (
          <div className="text-xs text-muted-foreground text-center py-4">
            לקריאה זו לא נשמר פירוט פרומפט (ייתכן שהיא בוצעה לפני שדרוג הלוג).
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-border rounded p-2 bg-background">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-semibold ${mono ? "font-mono" : ""}`} dir={mono ? "ltr" : "rtl"}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold mb-1">{title}</div>
      {children}
    </div>
  );
}
