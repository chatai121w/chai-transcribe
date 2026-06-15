import { useState } from "react";
import { BarChart3, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useAIUsage } from "@/hooks/useAIUsage";
import { calcCostUSD, fmtUSD, fmtILS, loadUsdToIls, getPricing } from "@/lib/aiPricing";
import { AIUsageDetailsDialog } from "@/components/AIUsageDetailsDialog";

interface Props {
  feature?: string;
  model?: string;
  label?: string;
  className?: string;
}

/**
 * Tiny chart icon — opens a popover with token/cost stats for a feature.
 * Place next to any AI model selector.
 */
export function AIUsageBadge({ feature, model, label, className }: Props) {
  const [open, setOpen] = useState(false);
  const { today, week, all, loading, reload } = useAIUsage(feature);
  const fx = loadUsdToIls();

  const sumCost = (rows: { rows: { model: string; prompt_tokens: number; completion_tokens: number }[] }) =>
    rows.rows.reduce((acc, r) => acc + calcCostUSD(r.model, r.prompt_tokens, r.completion_tokens), 0);

  const todayUsd = sumCost(today);
  const weekUsd = sumCost(week);
  const allUsd = sumCost(all);

  const currentModelPricing = model ? getPricing(model) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground ${className || ""}`}
          title="ניצול טוקנים ועלות"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {label && <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">
            📊 ניצול AI {feature ? `· ${feature}` : ""}
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reload} title="רענן">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {model && currentModelPricing && (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-xs space-y-0.5">
            <div className="font-mono text-[11px]" dir="ltr">{model}</div>
            <div className="text-muted-foreground">
              קלט: ${currentModelPricing.inputPer1M}/1M · פלט: ${currentModelPricing.outputPer1M}/1M
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <StatCell title="היום" tokens={today.totals.total} usd={todayUsd} fx={fx} calls={today.totals.calls} />
          <StatCell title="7 ימים" tokens={week.totals.total} usd={weekUsd} fx={fx} calls={week.totals.calls} />
          <StatCell title="30 יום" tokens={all.totals.total} usd={allUsd} fx={fx} calls={all.totals.calls} />
        </div>

        {Object.keys(all.byModel).length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">פירוט לפי מודל (30 יום)</div>
            <div className="max-h-40 overflow-auto space-y-1">
              {Object.entries(all.byModel)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([m, s]) => {
                  const usd = calcCostUSD(m, s.prompt, s.completion);
                  return (
                    <div key={m} className="flex items-center justify-between rounded border border-border/50 bg-background px-2 py-1 text-[11px]">
                      <span className="font-mono truncate ml-2" dir="ltr" title={m}>{m}</span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {s.total.toLocaleString()} · {fmtUSD(usd)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground">שער: 1$ = ₪{fx.toFixed(2)}</span>
          <Link to="/settings?tab=ai-pricing" onClick={() => setOpen(false)}>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
              <SettingsIcon className="h-3 w-3" />
              ערוך מחירון
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatCell({ title, tokens, usd, fx, calls }: { title: string; tokens: number; usd: number; fx: number; calls: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{title}</div>
      <div className="font-semibold text-sm">{tokens.toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">{calls} קריאות</div>
      <div className="text-[11px] mt-0.5">{fmtUSD(usd)} <span className="text-muted-foreground">/ {fmtILS(usd * fx)}</span></div>
    </div>
  );
}
