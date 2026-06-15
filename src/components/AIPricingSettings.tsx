import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_PRICING,
  loadPricingOverrides,
  savePricingOverrides,
  loadUsdToIls,
  saveUsdToIls,
  ALL_KNOWN_MODELS,
  type ModelPricing,
} from "@/lib/aiPricing";
import { Plus, RotateCcw, Trash2 } from "lucide-react";

/**
 * Settings panel for editing AI model pricing.
 * Embedded inside the main Settings page.
 */
export function AIPricingSettings() {
  const [overrides, setOverrides] = useState<Record<string, ModelPricing>>({});
  const [fx, setFx] = useState<number>(3.7);
  const [newModel, setNewModel] = useState("");

  useEffect(() => {
    setOverrides(loadPricingOverrides());
    setFx(loadUsdToIls());
  }, []);

  const models = useMemo(() => {
    const set = new Set([...ALL_KNOWN_MODELS, ...Object.keys(overrides)]);
    return Array.from(set).sort();
  }, [overrides]);

  function getCurrent(model: string): ModelPricing {
    return overrides[model] || DEFAULT_PRICING[model] || { inputPer1M: 0, outputPer1M: 0 };
  }

  function update(model: string, field: keyof ModelPricing, value: number) {
    setOverrides(prev => ({
      ...prev,
      [model]: { ...getCurrent(model), [field]: value },
    }));
  }

  function reset(model: string) {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  }

  function addModel() {
    const m = newModel.trim();
    if (!m) return;
    if (overrides[m] || DEFAULT_PRICING[m]) {
      toast({ title: "המודל כבר קיים ברשימה" });
      return;
    }
    setOverrides(prev => ({ ...prev, [m]: { inputPer1M: 0, outputPer1M: 0 } }));
    setNewModel("");
  }

  function save() {
    savePricingOverrides(overrides);
    saveUsdToIls(fx);
    toast({ title: "המחירון נשמר", description: "השינויים יופיעו בכל אייקוני ניצול ה-AI" });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 space-y-3">
        <h3 className="text-base font-semibold">שער המרה</h3>
        <div className="flex items-center gap-2 text-sm">
          <span>1 USD =</span>
          <Input
            type="number"
            step="0.01"
            min="0.1"
            value={fx}
            onChange={(e) => setFx(parseFloat(e.target.value) || 3.7)}
            className="w-24 text-right"
          />
          <span>ILS (₪)</span>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">מחירי מודלים (USD לכל 1M טוקנים)</h3>
          <Button onClick={save} size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-white">
            שמור
          </Button>
        </div>

        <div className="space-y-1.5 max-h-[500px] overflow-auto">
          <div className="grid grid-cols-[1fr_100px_100px_50px] gap-2 text-xs font-semibold text-muted-foreground px-2">
            <div>מודל</div>
            <div className="text-center">קלט $/1M</div>
            <div className="text-center">פלט $/1M</div>
            <div></div>
          </div>
          {models.map((m) => {
            const p = getCurrent(m);
            const isOverridden = !!overrides[m];
            return (
              <div key={m} className={`grid grid-cols-[1fr_100px_100px_50px] gap-2 items-center px-2 py-1 rounded ${isOverridden ? "bg-yellow-50" : ""}`}>
                <div className="font-mono text-xs truncate" dir="ltr" title={m}>{m}</div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={p.inputPer1M}
                  onChange={(e) => update(m, "inputPer1M", parseFloat(e.target.value) || 0)}
                  className="h-8 text-center text-xs"
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={p.outputPer1M}
                  onChange={(e) => update(m, "outputPer1M", parseFloat(e.target.value) || 0)}
                  className="h-8 text-center text-xs"
                />
                {isOverridden ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => reset(m)}
                    title={DEFAULT_PRICING[m] ? "חזור לברירת מחדל" : "מחק"}
                  >
                    {DEFAULT_PRICING[m] ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                  </Button>
                ) : <div />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <Input
            placeholder="הוסף מודל (לדוגמה: anthropic/claude-3-opus)"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            className="text-xs"
            dir="ltr"
          />
          <Button onClick={addModel} size="sm" variant="outline">
            <Plus className="h-4 w-4 ml-1" /> הוסף
          </Button>
        </div>
      </Card>
    </div>
  );
}
