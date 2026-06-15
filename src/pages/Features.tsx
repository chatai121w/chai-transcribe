/**
 * /features — Master toggle screen for all feature flags.
 *
 * Lets the user enable/disable features in one place, with descriptions,
 * risk notes, and an experimental marker. Search + category grouping.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Search,
  Sparkles,
  Layers,
  GitCompareArrows,
  RotateCcw,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  FEATURE_FLAGS,
  type FlagCategory,
  useFeatureFlag,
  writeFlag,
} from "@/lib/featureFlags";
import { toast } from "@/hooks/use-toast";

function FlagRow({ flagKey }: { flagKey: string }) {
  const meta = FEATURE_FLAGS.find(f => f.key === flagKey)!;
  const [enabled, setEnabled] = useFeatureFlag(flagKey);

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{meta.label}</span>
          {meta.experimental && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Sparkles className="h-3 w-3" /> ניסיוני
            </Badge>
          )}
          {enabled && (
            <Badge variant="secondary" className="text-[10px]">פעיל</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {meta.description}
        </p>
        {meta.risk && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{meta.risk}</span>
          </div>
        )}
        <code className="text-[10px] text-muted-foreground mt-1 block opacity-60">
          {meta.key}
        </code>
      </div>
      <Switch checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}

export default function Features() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURE_FLAGS;
    return FEATURE_FLAGS.filter(
      f =>
        f.label.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<FlagCategory, typeof FEATURE_FLAGS>();
    for (const f of filtered) {
      if (!map.has(f.category)) map.set(f.category, []);
      map.get(f.category)!.push(f);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleResetAll = () => {
    if (!confirm("לאפס את כל הטוגלים לברירת המחדל?")) return;
    for (const f of FEATURE_FLAGS) writeFlag(f.key, f.defaultOn);
    toast({ title: "אופס", description: "כל הטוגלים חזרו לברירת המחדל" });
  };

  const handleDisableAllExperimental = () => {
    let count = 0;
    for (const f of FEATURE_FLAGS) {
      if (f.experimental) {
        writeFlag(f.key, false);
        count += 1;
      }
    }
    toast({ title: "כובו פיצ'רים ניסיוניים", description: `${count} פיצ'רים` });
  };

  return (
    <div dir="rtl" className="container max-w-4xl py-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" />
            פיצ'רים וטוגלים
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            מרכז שליטה בכל היכולות. הפעלה/כיבוי כאן משפיע מיידית על כל האפליקציה.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link to="/ab-compare">
              <GitCompareArrows className="h-4 w-4" />
              השוואת A/B
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleDisableAllExperimental}>
            <Sparkles className="h-4 w-4" />
            כבה ניסיוניים
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleResetAll}>
            <RotateCcw className="h-4 w-4" />
            אפס הכל
          </Button>
        </div>
      </header>

      <Card className="p-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="חפש פיצ'ר…"
          dir="rtl"
          className="border-0 shadow-none focus-visible:ring-0 px-0"
        />
        <Badge variant="outline" className="text-xs">{filtered.length} / {FEATURE_FLAGS.length}</Badge>
      </Card>

      {grouped.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          לא נמצאו פיצ'רים תואמים.
        </Card>
      )}

      {grouped.map(([category, flags]) => (
        <Card key={category} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {CATEGORY_LABELS[category]}
            </h2>
            <Badge variant="outline" className="text-[10px]">{flags.length}</Badge>
          </div>
          <Separator />
          <div className="space-y-2">
            {flags.map(f => (
              <FlagRow key={f.key} flagKey={f.key} />
            ))}
          </div>
        </Card>
      ))}

      <Card className="p-4 bg-muted/30 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" /> חשוב לדעת
        </p>
        <ul className="list-disc pr-5 space-y-0.5">
          <li>טוגלים נשמרים במכשיר. סנכרון לענן יבוא בעתיד.</li>
          <li>פיצ'רים ניסיוניים עלולים לפגוע בדיוק או להאט — השווה ב-A/B לפני שתסמוך עליהם.</li>
          <li>אפשר לכבות אייקוני טוגל מהירים מ-UI → אייקוני טוגל מהירים.</li>
        </ul>
      </Card>
    </div>
  );
}
