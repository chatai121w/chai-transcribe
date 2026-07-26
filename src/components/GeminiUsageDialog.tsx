import { useEffect, useMemo, useState } from "react";
import { BarChart3, KeyRound, Cloud, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  getLovableGatewayUsage,
  getPersonalGeminiUsage,
  type PersonalGeminiUsage,
} from "@/lib/personalGemini";
import { estimateGeminiCostUsd, formatUsd, getGeminiPrice } from "@/lib/geminiPricing";
import { GEMINI_MODELS } from "@/components/GeminiModelSelect";

const numberFormat = new Intl.NumberFormat("he-IL");

export function GeminiUsageDialog() {
  const [personal, setPersonal] = useState<PersonalGeminiUsage>(() => getPersonalGeminiUsage());
  const [lovable, setLovable] = useState<PersonalGeminiUsage>(() => getLovableGatewayUsage());

  const refresh = () => {
    setPersonal(getPersonalGeminiUsage());
    setLovable(getLovableGatewayUsage());
  };

  useEffect(() => {
    window.addEventListener("personal-gemini-usage", refresh);
    window.addEventListener("lovable-gemini-usage", refresh);
    return () => {
      window.removeEventListener("personal-gemini-usage", refresh);
      window.removeEventListener("lovable-gemini-usage", refresh);
    };
  }, []);

  return (
    <Dialog onOpenChange={(open) => open && refresh()}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="ניצול טוקנים של Gemini"
          title="ניצול טוקנים של Gemini"
          className="absolute left-1.5 top-1.5 z-10 rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
          onClick={(event) => event.stopPropagation()}
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pl-8">
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              ניצול Gemini לפי מסלול ומודל
            </DialogTitle>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={refresh} title="רענן נתונים">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <UsageRoute
            title="API אישי של Google"
            description="שימוש במפתח Gemini הפרטי שלך"
            icon={<KeyRound className="h-4 w-4 text-emerald-600" />}
            usage={personal}
            showEstimatedCost
            tone="personal"
          />
          <UsageRoute
            title="Lovable AI"
            description="שימוש דרך הקרדיטים של Lovable"
            icon={<Cloud className="h-4 w-4 text-sky-600" />}
            usage={lovable}
            tone="lovable"
          />
        </div>

        <section className="rounded-md border p-3">
          <h3 className="mb-2 text-sm font-semibold">מחירון Google API למודלים הזמינים</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-right font-medium">מודל</th>
                  <th className="px-2 py-1.5 text-center font-medium">קלט טקסט / 1M</th>
                  <th className="px-2 py-1.5 text-center font-medium">קלט אודיו / 1M</th>
                  <th className="px-2 py-1.5 text-center font-medium">פלט / 1M</th>
                </tr>
              </thead>
              <tbody>
                {GEMINI_MODELS.map(({ value, label }) => {
                  const price = getGeminiPrice(value);
                  return (
                    <tr key={value} className="border-b last:border-0">
                      <td className="px-2 py-2">{label.replace(/\s*\(.+\)$/, "")}</td>
                      <td className="px-2 py-2 text-center tabular-nums">${price.input}</td>
                      <td className="px-2 py-2 text-center font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        ${price.audioInput ?? price.input}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">${price.output}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            תעריפי Paid Tier רגילים בדולר. ב־Free Tier העלות עשויה להיות $0, בכפוף למכסה ולפרויקט Google שלך.
          </p>
        </section>

        <p className="text-[11px] text-muted-foreground">
          הנתונים נמדדים בנפרד לכל מסלול. טוקנים שלא הוחזרו על ידי ספק התמלול יוצגו כ־0, אך הקריאה עדיין תיספר.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function UsageRoute({
  title,
  description,
  icon,
  usage,
  showEstimatedCost = false,
  tone,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  usage: PersonalGeminiUsage;
  showEstimatedCost?: boolean;
  tone: "personal" | "lovable";
}) {
  const models = Object.entries(usage.byModel).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const estimatedCost = useMemo(
    () => Object.entries(usage.bySurfaceModel).reduce((surfaceSum, [surface, byModel]) => (
      surfaceSum + Object.entries(byModel || {}).reduce((modelSum, [model, bucket]) => (
        modelSum + estimateGeminiCostUsd(
          model,
          bucket.promptTokens,
          bucket.completionTokens,
          surface === "transcription" ? "audio" : "text",
        )
      ), 0)
    ), 0),
    [usage.bySurfaceModel],
  );

  return (
    <section className={tone === "personal"
      ? "rounded-md border border-emerald-300 bg-emerald-500/5 p-3 dark:border-emerald-800"
      : "rounded-md border border-sky-300 bg-sky-500/5 p-3 dark:border-sky-800"
    }>
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="קריאות" value={usage.calls} />
        <Stat label="טוקני קלט" value={usage.promptTokens} />
        <Stat label="טוקני פלט" value={usage.completionTokens} />
      </div>
      <div className="mt-2 flex items-center justify-between rounded border bg-background px-2.5 py-2">
        <span className="text-xs text-muted-foreground">סה״כ טוקנים</span>
        <strong className={tone === "personal"
          ? "text-base tabular-nums text-emerald-700 dark:text-emerald-400"
          : "text-base tabular-nums text-sky-700 dark:text-sky-400"
        }>
          {numberFormat.format(usage.totalTokens)}
        </strong>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="text-xs font-medium">פירוט לפי מודל</div>
        {models.length === 0 ? (
          <p className="rounded border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">עדיין אין שימוש מתועד במסלול זה</p>
        ) : (
          models.map(([model, bucket]) => {
            const price = getGeminiPrice(model);
            return (
              <div key={model} className="rounded border bg-background px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px]" dir="ltr" title={model}>{model}</span>
                  <span className="whitespace-nowrap text-xs font-semibold tabular-nums">{numberFormat.format(bucket.totalTokens)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>{numberFormat.format(bucket.calls)} קריאות</span>
                  <span>קלט {numberFormat.format(bucket.promptTokens)}</span>
                  <span>פלט {numberFormat.format(bucket.completionTokens)}</span>
                  {showEstimatedCost && (
                    <span className="w-full text-emerald-700 dark:text-emerald-400">
                      מחיר ל־1M: טקסט ${price.input} · אודיו ${price.audioInput ?? price.input} · פלט ${price.output}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
        {showEstimatedCost
          ? `עלות Google משוערת לפי סוג הקלט: ${formatUsd(estimatedCost)}`
          : "החיוב נצרך מקרדיטי Lovable"}
        {usage.lastUsedAt && ` · שימוש אחרון: ${new Date(usage.lastUsedAt).toLocaleString("he-IL")}`}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-background px-2 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{numberFormat.format(value)}</div>
    </div>
  );
}
