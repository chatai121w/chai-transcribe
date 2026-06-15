import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, ListFilter } from "lucide-react";
import { useAIUsage, type AIUsageRow } from "@/hooks/useAIUsage";
import { calcCostUSD, fmtUSD, fmtILS, loadUsdToIls } from "@/lib/aiPricing";
import { AIUsageRowDetails } from "./AIUsageRowDetails";


interface Props {
  feature?: string;
  triggerLabel?: string;
}

type Range = "today" | "7d" | "30d";

export function AIUsageDetailsDialog({ feature, triggerLabel = "פרטים מלאים" }: Props) {
  const [open, setOpen] = useState(false);
  const { raw, loading, reload } = useAIUsage(feature);
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  const [range, setRange] = useState<Range>("30d");
  const fx = loadUsdToIls();

  const models = useMemo(() => Array.from(new Set(raw.map(r => r.model).filter(Boolean))).sort(), [raw]);
  const features = useMemo(() => Array.from(new Set(raw.map(r => r.feature).filter(Boolean))).sort(), [raw]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = range === "today"
      ? new Date(new Date().setHours(0,0,0,0)).getTime()
      : range === "7d" ? now - 7*86400000 : now - 30*86400000;
    const q = search.trim().toLowerCase();
    return raw.filter(r => {
      if (new Date(r.created_at).getTime() < cutoff) return false;
      if (modelFilter !== "all" && r.model !== modelFilter) return false;
      if (featureFilter !== "all" && r.feature !== featureFilter) return false;
      if (q && !(`${r.model} ${r.feature}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [raw, search, modelFilter, featureFilter, range]);

  const totals = useMemo(() => {
    let prompt = 0, completion = 0, total = 0, usd = 0;
    for (const r of filtered) {
      prompt += r.prompt_tokens || 0;
      completion += r.completion_tokens || 0;
      total += r.total_tokens || 0;
      usd += calcCostUSD(r.model, r.prompt_tokens, r.completion_tokens);
    }
    return { prompt, completion, total, usd, calls: filtered.length };
  }, [filtered]);

  const exportCsv = () => {
    const header = ["created_at","feature","model","prompt_tokens","completion_tokens","total_tokens","cost_usd"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const usd = calcCostUSD(r.model, r.prompt_tokens, r.completion_tokens);
      lines.push([r.created_at, r.feature, r.model, r.prompt_tokens, r.completion_tokens, r.total_tokens, usd.toFixed(6)].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ai-usage-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reload(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1">
          <ListFilter className="h-3 w-3" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>📊 פירוט קריאות AI</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="חיפוש לפי מודל / פיצ'ר…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
          />
          <Select value={range} onValueChange={(v: Range) => setRange(v)}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">היום</SelectItem>
              <SelectItem value="7d">7 ימים</SelectItem>
              <SelectItem value="30d">30 יום</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="h-8 w-48"><SelectValue placeholder="כל המודלים" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המודלים</SelectItem>
              {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          {!feature && (
            <Select value={featureFilter} onValueChange={setFeatureFilter}>
              <SelectTrigger className="h-8 w-40"><SelectValue placeholder="כל הפיצ'רים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הפיצ'רים</SelectItem>
                {features.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-2 text-xs grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Stat label="קריאות" value={totals.calls.toLocaleString()} />
          <Stat label="קלט" value={totals.prompt.toLocaleString()} />
          <Stat label="פלט" value={totals.completion.toLocaleString()} />
          <Stat label="סה״כ טוקנים" value={totals.total.toLocaleString()} />
          <Stat label="עלות" value={`${fmtUSD(totals.usd)} / ${fmtILS(totals.usd * fx)}`} />
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="text-right">זמן</TableHead>
                <TableHead className="text-right">פיצ'ר</TableHead>
                <TableHead className="text-right">מודל</TableHead>
                <TableHead className="text-right">קלט</TableHead>
                <TableHead className="text-right">פלט</TableHead>
                <TableHead className="text-right">סה״כ</TableHead>
                <TableHead className="text-right">עלות</TableHead>
                <TableHead className="text-right w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">
                  {loading ? "טוען…" : "אין נתונים בטווח/סינון שנבחר"}
                </TableCell></TableRow>
              )}
              {filtered.map((r: AIUsageRow) => {
                const usd = r.cost_usd_snapshot ?? calcCostUSD(r.model, r.prompt_tokens, r.completion_tokens);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap" dir="ltr">
                      {new Date(r.created_at).toLocaleString("he-IL")}
                    </TableCell>
                    <TableCell className="text-xs">{r.feature}</TableCell>
                    <TableCell className="text-xs font-mono" dir="ltr">{r.model}</TableCell>
                    <TableCell className="text-xs">{(r.prompt_tokens||0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{(r.completion_tokens||0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-semibold">{(r.total_tokens||0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{fmtUSD(usd)}</TableCell>
                    <TableCell><AIUsageRowDetails row={r} /></TableCell>
                  </TableRow>
                );
              })}

            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  );
}
