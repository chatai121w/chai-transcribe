import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Eye, FolderInput, Cloud, HardDrive, Sparkles, GitCompareArrows } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { calcCostUSD, fmtUSD } from "@/lib/aiPricing";
import type { CloudVersion } from "@/hooks/useCloudVersions";
import type { AIUsageRow } from "@/hooks/useAIUsage";

interface Props {
  version: CloudVersion;
  selected: boolean;
  onSelectChange: (id: string, checked: boolean) => void;
  onOpen: (text: string) => void;
  onDelete: (id: string) => void;
  onSaveLocal: (v: CloudVersion) => void;
  onAssignFolder: (id: string) => void;
  onSendToCompare?: (id: string) => void;
}

export function AIVersionCard({ version, selected, onSelectChange, onOpen, onDelete, onSaveLocal, onAssignFolder, onSendToCompare }: Props) {
  const [usage, setUsage] = useState<AIUsageRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!version.ai_usage_event_id) return;
    (async () => {
      const { data } = await (supabase
        .from("ai_usage_events" as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select("*")
        .eq("id", version.ai_usage_event_id)
        .maybeSingle() as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!cancelled && data) setUsage(data as AIUsageRow);
    })();
    return () => { cancelled = true; };
  }, [version.ai_usage_event_id]);

  const cost = usage
    ? (usage.cost_usd_snapshot ?? calcCostUSD(usage.model, usage.prompt_tokens, usage.completion_tokens))
    : 0;

  const time = new Date(version.created_at).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return (
    <Card className="p-3 flex flex-col gap-2" dir="rtl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Checkbox checked={selected} onCheckedChange={(c) => onSelectChange(version.id, Boolean(c))} />
          <Badge variant="secondary" className="text-xs gap-1">
            <Sparkles className="w-3 h-3" />
            {version.engine_label || usage?.model || "AI"}
          </Badge>
          {version.action_label && (
            <Badge variant="outline" className="text-xs">{version.action_label}</Badge>
          )}
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
      </div>

      <Tabs defaultValue="result" className="w-full">
        <TabsList className="h-7">
          <TabsTrigger value="result" className="text-xs h-6">תוצאה</TabsTrigger>
          <TabsTrigger value="prompt" className="text-xs h-6">פרומפט</TabsTrigger>
          <TabsTrigger value="data" className="text-xs h-6">נתונים</TabsTrigger>
        </TabsList>

        <TabsContent value="result" className="mt-2">
          <ScrollArea className="h-32 rounded border bg-muted/20 p-2">
            <p className="text-xs whitespace-pre-wrap break-words">{version.text}</p>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="prompt" className="mt-2">
          <ScrollArea className="h-32 rounded border bg-muted/20 p-2 text-xs space-y-2">
            {usage?.system_prompt && (
              <div>
                <div className="font-semibold text-muted-foreground mb-1">System:</div>
                <p className="whitespace-pre-wrap break-words">{usage.system_prompt}</p>
              </div>
            )}
            {usage?.prompt_preview && (
              <div className="mt-2">
                <div className="font-semibold text-muted-foreground mb-1">User (תקציר):</div>
                <p className="whitespace-pre-wrap break-words">{usage.prompt_preview}</p>
              </div>
            )}
            {!usage && (
              <p className="text-muted-foreground">אין מידע פרומפט מקושר</p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="data" className="mt-2">
          <div className="h-32 rounded border bg-muted/20 p-2 text-xs grid grid-cols-2 gap-1">
            <div>טוקנים כניסה: <b>{usage?.prompt_tokens ?? "—"}</b></div>
            <div>טוקנים יציאה: <b>{usage?.completion_tokens ?? "—"}</b></div>
            <div>סה״כ טוקנים: <b>{usage?.total_tokens ?? "—"}</b></div>
            <div>עלות: <b>{usage ? fmtUSD(cost) : "—"}</b></div>
            <div>משך: <b>{usage?.duration_ms ? `${usage.duration_ms}ms` : "—"}</b></div>
            <div>מודל: <b className="truncate">{usage?.model || version.engine_label || "—"}</b></div>
            {version.folder_id && <div className="col-span-2">📁 משויך לתיקייה</div>}
            {version.audio_file_path && <div className="col-span-2">🎵 קושר לאודיו</div>}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-1 pt-1 border-t">
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onOpen(version.text)}>
          <Eye className="w-3 h-3" /> פתח
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onSaveLocal(version)}>
          <HardDrive className="w-3 h-3" /> לוקלי
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" disabled>
          <Cloud className="w-3 h-3" /> בענן
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onAssignFolder(version.id)}>
          <FolderInput className="w-3 h-3" /> תיקייה
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 text-destructive hover:text-destructive ms-auto"
          onClick={() => onDelete(version.id)}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </Card>
  );
}
