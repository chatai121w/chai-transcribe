/**
 * UI for managing custom OpenAI-compatible providers.
 * Shows preset providers (LM Studio, Groq, DeepSeek, etc.) + lets user add custom ones.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plug, Plus, RefreshCw, Trash2, Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import {
  type CustomProvider,
  getProviders,
  saveProviders,
  getProviderKey,
  setProviderKey,
  loadProviderKey,
  discoverProviderModels,
  subscribeProviders,
} from "@/lib/customProviders";

interface CustomProvidersDialogProps {
  trigger?: React.ReactNode;
}

export function CustomProvidersDialog({ trigger }: CustomProvidersDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<CustomProvider[]>(() => getProviders());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, "ok" | "fail" | undefined>>({});

  // Load encrypted keys into memory when dialog opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      const next: Record<string, string> = {};
      for (const p of providers) {
        if (p.requiresKey) {
          await loadProviderKey(p.id);
          next[p.id] = getProviderKey(p.id) || "";
        }
      }
      setKeys(next);
    })();
  }, [open, providers]);

  // Subscribe to external provider changes
  useEffect(() => {
    return subscribeProviders(() => setProviders(getProviders()));
  }, []);

  const updateProvider = useCallback((id: string, patch: Partial<CustomProvider>) => {
    setProviders(prev => {
      const next = prev.map(p => (p.id === id ? { ...p, ...patch } : p));
      saveProviders(next);
      return next;
    });
  }, []);

  const handleSaveKey = useCallback(async (id: string, value: string) => {
    setKeys(k => ({ ...k, [id]: value }));
    await setProviderKey(id, value);
  }, []);

  const handleTest = useCallback(async (provider: CustomProvider) => {
    setTesting(t => ({ ...t, [provider.id]: true }));
    setTestResult(r => ({ ...r, [provider.id]: undefined }));
    try {
      const models = await discoverProviderModels(provider);
      updateProvider(provider.id, { models, enabled: true });
      setTestResult(r => ({ ...r, [provider.id]: "ok" }));
      toast({
        title: `✅ ${provider.name} מחובר`,
        description: `נמצאו ${models.length} מודלים זמינים`,
      });
    } catch (err) {
      setTestResult(r => ({ ...r, [provider.id]: "fail" }));
      toast({
        title: `❌ שגיאת חיבור ל-${provider.name}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(t => ({ ...t, [provider.id]: false }));
    }
  }, [updateProvider, toast]);

  const handleAddCustom = useCallback(() => {
    const id = `user_${Date.now().toString(36)}`;
    const newProvider: CustomProvider = {
      id,
      name: "ספק חדש",
      baseUrl: "http://localhost:8080/v1",
      requiresKey: false,
      enabled: false,
      icon: "🔌",
      builtin: false,
    };
    const next = [...providers, newProvider];
    setProviders(next);
    saveProviders(next);
  }, [providers]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("למחוק את הספק?")) return;
    const next = providers.filter(p => p.id !== id);
    setProviders(next);
    saveProviders(next);
  }, [providers]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plug className="w-4 h-4 ml-1" />
            ספקי AI נוספים
          </Button>
        )}
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5" />
            ספקי AI נוספים — מעבר ל-Ollama ולענן הראשי
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            הוסף שרתים מקומיים (LM Studio, llama.cpp, vLLM) או ספקי ענן ישירים (Groq, DeepSeek, xAI, Mistral, OpenRouter).
            הפעל ספק → הזן מפתח (אם נדרש) → "בדוק חיבור" → המודלים יופיעו אוטומטית בעורך.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 py-2">
            {providers.map(p => {
              const isEnabled = p.enabled;
              const result = testResult[p.id];
              const keyValue = keys[p.id] || "";
              return (
                <div
                  key={p.id}
                  className={`rounded-md border p-3 space-y-2 ${isEnabled ? "bg-primary/5 border-primary/40" : "bg-muted/20"}`}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{p.icon || "🔌"}</span>
                    <div className="flex-1">
                      {p.builtin ? (
                        <div className="font-semibold text-sm">{p.name}</div>
                      ) : (
                        <Input
                          value={p.name}
                          onChange={e => updateProvider(p.id, { name: e.target.value })}
                          className="h-7 text-sm font-semibold"
                        />
                      )}
                      {p.description && <div className="text-[10px] text-muted-foreground">{p.description}</div>}
                    </div>
                    {result === "ok" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {result === "fail" && <XCircle className="w-4 h-4 text-red-600" />}
                    {p.models && p.models.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {p.models.length} מודלים
                      </Badge>
                    )}
                    <Switch checked={isEnabled} onCheckedChange={v => updateProvider(p.id, { enabled: v })} />
                    {!p.builtin && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Base URL (תואם OpenAI)</Label>
                      <Input
                        value={p.baseUrl}
                        onChange={e => updateProvider(p.id, { baseUrl: e.target.value })}
                        className="h-7 text-xs font-mono"
                        placeholder="http://localhost:1234/v1"
                      />
                    </div>
                    {p.requiresKey && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground">מפתח API</Label>
                        <div className="flex gap-1">
                          <Input
                            type={showKeys[p.id] ? "text" : "password"}
                            value={keyValue}
                            onChange={e => handleSaveKey(p.id, e.target.value)}
                            className="h-7 text-xs font-mono"
                            placeholder={p.id === "groq" ? "(משתמש במפתח שכבר הזנת בעמוד הראשי)" : "sk-..."}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setShowKeys(s => ({ ...s, [p.id]: !s[p.id] }))}
                          >
                            {showKeys[p.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action row */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleTest(p)}
                      disabled={testing[p.id]}
                    >
                      {testing[p.id] ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RefreshCw className="w-3 h-3 ml-1" />}
                      בדוק חיבור וגלה מודלים
                    </Button>
                    {p.models && p.models.length > 0 && (
                      <span className="text-[10px] text-muted-foreground truncate flex-1">
                        מודלים: {p.models.slice(0, 4).map(m => m.id).join(", ")}
                        {p.models.length > 4 && ` +${p.models.length - 4}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex justify-between items-center pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handleAddCustom}>
            <Plus className="w-3.5 h-3.5 ml-1" />
            הוסף ספק מותאם
          </Button>
          <p className="text-[10px] text-muted-foreground">
            המפתחות נשמרים מוצפנים מקומית בדפדפן (AES-GCM)
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
