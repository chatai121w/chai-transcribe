import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Settings as SettingsIcon, ArrowRight, LogOut, Eye, EyeOff, Wrench, Cpu, Palette, Key, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";
import DevToolsPanel from "@/components/DevToolsPanel";
import { OllamaManager } from "@/components/OllamaManager";
import { ThemeManager } from "@/components/ThemeManager";
import { getApiKey } from "@/lib/keyCrypto";
import { ApiKeyUsagePanel } from "@/components/ApiKeyUsagePanel";
import { AIPricingSettings } from "@/components/AIPricingSettings";
import { Switch } from "@/components/ui/switch";
import {
  getPersonalGeminiKey,
  isPersonalGeminiEnabled,
  setPersonalGeminiKey,
  setPersonalGeminiEnabled,
  getPersonalGeminiModel,
  setPersonalGeminiModel,
  isPersonalGeminiFallbackEnabled,
  setPersonalGeminiFallbackEnabled,
  PERSONAL_GEMINI_MODELS,
  callPersonalGemini,
  getPersonalGeminiUsage,
  resetPersonalGeminiUsage,
  getLovableGatewayUsage,
  resetLovableGatewayUsage,
  SURFACE_LABELS,
  type PersonalGeminiUsage,
  type UsageSurface,

} from "@/lib/personalGemini";
import { estimateGeminiCostUsd, getGeminiPrice, formatUsd } from "@/lib/geminiPricing";
import { GeminiBadge } from "@/components/GeminiBadge";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";

const Settings = () => {
  const { isAuthenticated, logout, isLoading, isAdmin, user } = useAuth();
  const [showDevTools, setShowDevTools] = useState(false);
  const navigate = useNavigate();
  const { invalidateCache: invalidateApiKeysCache } = useCloudApiKeys();
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [openaiKeysPoolText, setOpenaiKeysPoolText] = useState("");
  const [googleKeysPoolText, setGoogleKeysPoolText] = useState("");
  const [groqKeysPoolText, setGroqKeysPoolText] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [assemblyaiKey, setAssemblyaiKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [assemblyaiKeysPoolText, setAssemblyaiKeysPoolText] = useState("");
  const [deepgramKeysPoolText, setDeepgramKeysPoolText] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [showAssemblyAI, setShowAssemblyAI] = useState(false);
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [huggingfaceKey, setHuggingfaceKey] = useState("");
  const [showHuggingface, setShowHuggingface] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [showGemini, setShowGemini] = useState(false);
  const [usePersonalGemini, setUsePersonalGeminiState] = useState(false);
  const [geminiModel, setGeminiModelState] = useState("gemini-2.5-flash");
  const [geminiFallback, setGeminiFallbackState] = useState(true);
  const [geminiTestStatus, setGeminiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle');
  const [geminiTestMsg, setGeminiTestMsg] = useState<string>("");
  const [geminiUsage, setGeminiUsage] = useState<PersonalGeminiUsage>(() => getPersonalGeminiUsage());
  const [lovableUsage, setLovableUsage] = useState<PersonalGeminiUsage>(() => getLovableGatewayUsage());

  const [userIdentifier, setUserIdentifier] = useState("");
  const [activeTab, setActiveTab] = useState<string>("api-keys");
  const location = useLocation();

  // Open Themes tab + scroll into view when navigated with hash #themes-section
  useEffect(() => {
    if (location.hash === '#themes-section') {
      setActiveTab('themes');
      setTimeout(() => {
        document.getElementById('themes-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
    // Support ?tab=ai-pricing deep link
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'ai-pricing') setActiveTab('ai-pricing');
  }, [location.hash, location.key, location.search]);

  // Live-refresh usage counters (personal + Lovable Gateway)
  useEffect(() => {
    const handler = () => {
      setGeminiUsage(getPersonalGeminiUsage());
      setLovableUsage(getLovableGatewayUsage());
    };
    window.addEventListener("personal-gemini-usage", handler);
    window.addEventListener("lovable-gemini-usage", handler);
    const iv = window.setInterval(handler, 5000);
    return () => {
      window.removeEventListener("personal-gemini-usage", handler);
      window.removeEventListener("lovable-gemini-usage", handler);
      window.clearInterval(iv);
    };
  }, []);


  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    // Use authenticated user ID as identifier
    const identifier = user?.id || "";
    if (!identifier) return;
    setUserIdentifier(identifier);

    // Load personal Gemini prefs (localStorage first, cloud overrides in loadKeysFromCloud)
    setGeminiKey(getPersonalGeminiKey());
    setUsePersonalGeminiState(isPersonalGeminiEnabled());
    setGeminiModelState(getPersonalGeminiModel());
    setGeminiFallbackState(isPersonalGeminiFallbackEnabled());

    // Load from cloud
    loadKeysFromCloud(identifier);
  }, [isAuthenticated, isLoading, navigate, user]);

  const loadKeysFromCloud = async (identifier: string) => {
    try {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_identifier', identifier)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error("Error loading keys from cloud:", error);
      }

      const loadPoolOrFallback = (poolStorageKey: string, fallback?: string, setter?: (v: string) => void) => {
        const rawPool = localStorage.getItem(poolStorageKey);
        if (rawPool) {
          try {
            const parsed = JSON.parse(rawPool) as string[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setter?.(parsed.join("\n"));
              return;
            }
          } catch {
            // ignore malformed pool
          }
        }
        if (fallback) setter?.(fallback);
      };

      if (data) {
        if (data.openai_key) setOpenaiKey(data.openai_key);
        if (data.google_key) setGoogleKey(data.google_key);
        if (data.groq_key) setGroqKey(data.groq_key);
        if (data.claude_key) setClaudeKey(data.claude_key);
        if (data.assemblyai_key) setAssemblyaiKey(data.assemblyai_key);
        if (data.deepgram_key) setDeepgramKey(data.deepgram_key);
        if (data.huggingface_key) setHuggingfaceKey(data.huggingface_key);
        const cloudGemini = (data as unknown as { gemini_key?: string | null }).gemini_key;
        if (cloudGemini) {
          setGeminiKey(cloudGemini);
          setPersonalGeminiKey(cloudGemini);
        }

        // Multi-key pools: load from cloud first, fall back to localStorage
        const loadPool = (cloudPool: any, poolStorageKey: string, fallback?: string, setter?: (v: string) => void) => {
          if (Array.isArray(cloudPool) && cloudPool.length > 0) {
            setter?.(cloudPool.join("\n"));
            return;
          }
          const rawPool = localStorage.getItem(poolStorageKey);
          if (rawPool) {
            try {
              const parsed = JSON.parse(rawPool) as string[];
              if (Array.isArray(parsed) && parsed.length > 0) {
                setter?.(parsed.join("\n"));
                return;
              }
            } catch { /* ignore */ }
          }
          if (fallback) setter?.(fallback);
        };
        loadPool(data.openai_keys_pool, "openai_api_keys_pool", data.openai_key ?? undefined, setOpenaiKeysPoolText);
        loadPool(data.google_keys_pool, "google_api_keys_pool", data.google_key ?? undefined, setGoogleKeysPoolText);
        loadPool(data.groq_keys_pool, "groq_api_keys_pool", data.groq_key ?? undefined, setGroqKeysPoolText);
        loadPool(data.assemblyai_keys_pool, "assemblyai_api_keys_pool", data.assemblyai_key ?? undefined, setAssemblyaiKeysPoolText);
        loadPool(data.deepgram_keys_pool, "deepgram_api_keys_pool", data.deepgram_key ?? undefined, setDeepgramKeysPoolText);
      } else {
        // Fallback to localStorage
        const savedOpenAI = getApiKey("openai_api_key");
        const savedGoogle = getApiKey("google_api_key");
        const savedGroq = getApiKey("groq_api_key");
        const savedClaude = getApiKey("claude_api_key");
        const savedAssemblyAI = getApiKey("assemblyai_api_key");
        const savedDeepgram = getApiKey("deepgram_api_key");
        const savedHuggingface = getApiKey("huggingface_api_key");
        
        if (savedOpenAI) setOpenaiKey(savedOpenAI);
        if (savedGoogle) setGoogleKey(savedGoogle);
        if (savedGroq) setGroqKey(savedGroq);
        if (savedClaude) setClaudeKey(savedClaude);
        if (savedAssemblyAI) setAssemblyaiKey(savedAssemblyAI);
        if (savedDeepgram) setDeepgramKey(savedDeepgram);
        if (savedHuggingface) setHuggingfaceKey(savedHuggingface);

        loadPoolOrFallback("openai_api_keys_pool", savedOpenAI, setOpenaiKeysPoolText);
        loadPoolOrFallback("google_api_keys_pool", savedGoogle, setGoogleKeysPoolText);
        loadPoolOrFallback("groq_api_keys_pool", savedGroq, setGroqKeysPoolText);
        loadPoolOrFallback("assemblyai_api_keys_pool", savedAssemblyAI, setAssemblyaiKeysPoolText);
        loadPoolOrFallback("deepgram_api_keys_pool", savedDeepgram, setDeepgramKeysPoolText);
      }
    } catch (error) {
      console.error("Error loading keys:", error);
      toast.error("שגיאה בטעינת המפתחות");
    }
  };

  const handleSave = async () => {
    try {
      const toPool = (txt: string) => Array.from(new Set(txt.split(/\r?\n/).map((k) => k.trim()).filter(Boolean)));
      const openaiPool = toPool(openaiKeysPoolText);
      const googlePool = toPool(googleKeysPoolText);
      const groqPool = Array.from(
        new Set(
          groqKeysPoolText
            .split(/\r?\n/)
            .map((k) => k.trim())
            .filter(Boolean)
        )
      );
      const assemblyPool = toPool(assemblyaiKeysPoolText);
      const deepgramPool = toPool(deepgramKeysPoolText);

      const primaryOpenAI = openaiPool[0] || openaiKey.trim() || "";
      const primaryGoogle = googlePool[0] || googleKey.trim() || "";
      const primaryGroq = groqPool[0] || groqKey.trim() || "";
      const primaryAssembly = assemblyPool[0] || assemblyaiKey.trim() || "";
      const primaryDeepgram = deepgramPool[0] || deepgramKey.trim() || "";

      // Build payload with ONLY non-empty fields so we never wipe existing cloud values.
      const payload: Record<string, unknown> = { user_identifier: userIdentifier };
      const setIf = (key: string, val: string | null | undefined) => {
        if (val && String(val).trim()) payload[key] = String(val).trim();
      };
      const setPoolIf = (key: string, pool: string[]) => {
        if (pool.length > 0) payload[key] = pool;
      };
      setIf('openai_key', primaryOpenAI);
      setIf('google_key', primaryGoogle);
      setIf('groq_key', primaryGroq);
      setIf('claude_key', claudeKey);
      setIf('assemblyai_key', primaryAssembly);
      setIf('deepgram_key', primaryDeepgram);
      setIf('huggingface_key', huggingfaceKey);
      setIf('gemini_key', geminiKey);
      setPoolIf('openai_keys_pool', openaiPool);
      setPoolIf('google_keys_pool', googlePool);
      setPoolIf('groq_keys_pool', groqPool);
      setPoolIf('assemblyai_keys_pool', assemblyPool);
      setPoolIf('deepgram_keys_pool', deepgramPool);

      console.log('[Settings] Saving keys to cloud:', {
        user_identifier: userIdentifier,
        fields: Object.keys(payload).filter(k => k !== 'user_identifier'),
      });

      // Save to cloud (tied to user ID) — partial upsert (only non-empty fields)
      const { error, data: saved } = await supabase
        .from('user_api_keys')
        .upsert(payload as never, { onConflict: 'user_identifier' })
        .select()
        .maybeSingle();

      if (error) {
        console.error("[Settings] Cloud save error:", error);
        toast.error(`שגיאת שמירה בענן: ${error.message} (code: ${error.code})`, { duration: 8000 });
        return;
      }
      console.log('[Settings] Cloud save success. Row updated_at:', (saved as any)?.updated_at);

      // Also save locally for quick access
      if (primaryOpenAI) {
        localStorage.setItem("openai_api_key", primaryOpenAI);
        localStorage.setItem("openai_api_keys_pool", JSON.stringify(openaiPool));
      }
      if (primaryGoogle) {
        localStorage.setItem("google_api_key", primaryGoogle);
        localStorage.setItem("google_api_keys_pool", JSON.stringify(googlePool));
      }
      if (primaryGroq) {
        localStorage.setItem("groq_api_key", primaryGroq);
        localStorage.setItem("groq_api_keys_pool", JSON.stringify(groqPool));
      }
      if (claudeKey) localStorage.setItem("claude_api_key", claudeKey);
      if (huggingfaceKey.trim()) localStorage.setItem("huggingface_api_key", huggingfaceKey.trim());
      if (primaryAssembly) {
        localStorage.setItem("assemblyai_api_key", primaryAssembly);
        localStorage.setItem("assemblyai_api_keys_pool", JSON.stringify(assemblyPool));
      }
      if (primaryDeepgram) {
        localStorage.setItem("deepgram_api_key", primaryDeepgram);
        localStorage.setItem("deepgram_api_keys_pool", JSON.stringify(deepgramPool));
      }

      // Personal Gemini
      setPersonalGeminiKey(geminiKey.trim());
      setPersonalGeminiEnabled(usePersonalGemini && !!geminiKey.trim());
      setPersonalGeminiModel(geminiModel);
      setPersonalGeminiFallbackEnabled(geminiFallback);

      if (primaryOpenAI) setOpenaiKey(primaryOpenAI);
      if (primaryGoogle) setGoogleKey(primaryGoogle);
      if (primaryGroq) {
        setGroqKey(primaryGroq);
      }
      if (primaryAssembly) setAssemblyaiKey(primaryAssembly);
      if (primaryDeepgram) setDeepgramKey(primaryDeepgram);

      invalidateApiKeysCache();
      toast.success("המפתחות נשמרו בהצלחה בענן! ☁️");
    } catch (error) {
      console.error("Error saving keys:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`שגיאה בשמירת המפתחות: ${msg}`, { duration: 8000 });
    }
  };

  // Dedicated save for Gemini key only — bypasses whole-form save so nothing else is touched.
  const handleSaveGeminiOnly = async () => {
    const key = geminiKey.trim();
    if (!userIdentifier) { toast.error("לא מחובר — התחבר מחדש"); return; }
    if (!key) { toast.error("שדה Gemini ריק"); return; }
    try {
      console.log('[Settings] Saving Gemini key only for', userIdentifier);
      const { error, data } = await supabase
        .from('user_api_keys')
        .upsert(
          { user_identifier: userIdentifier, gemini_key: key } as never,
          { onConflict: 'user_identifier' }
        )
        .select('user_identifier, gemini_key, updated_at')
        .maybeSingle();
      if (error) {
        console.error('[Settings] Gemini save error:', error);
        toast.error(`שמירה בענן נכשלה: ${error.message}`, { duration: 8000 });
        return;
      }
      const savedLen = ((data as any)?.gemini_key || '').length;
      console.log('[Settings] Gemini saved. Length in DB:', savedLen);
      // Mirror locally + enable
      setPersonalGeminiKey(key);
      if (!isPersonalGeminiEnabled() && localStorage.getItem('use_personal_gemini') !== '0') {
        setPersonalGeminiEnabled(true);
        setUsePersonalGeminiState(true);
      }
      localStorage.removeItem('personal_gemini_exhausted_until');
      toast.success(`מפתח Gemini נשמר בענן ✓ (${savedLen} תווים)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Settings] Gemini save exception:', e);
      toast.error(`שגיאה: ${msg}`, { duration: 8000 });
    }
  };


  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleBack = () => {
    navigate("/");
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4" dir="rtl">
      <div className="max-w-2xl mx-auto py-8">
        <div className="flex items-center justify-between mb-6">
          <Button variant="outline" onClick={handleBack}>
            <ArrowRight className="ml-2 h-4 w-4" />
            חזרה
          </Button>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                variant={showDevTools ? "default" : "outline"}
                onClick={() => setShowDevTools(!showDevTools)}
                className="gap-2"
              >
                <Wrench className="h-4 w-4" />
                כלי פיתוח
              </Button>
            )}
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="ml-2 h-4 w-4" />
              התנתק
            </Button>
          </div>
        </div>

        {showDevTools && isAdmin && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wrench className="w-6 h-6 text-accent" />
                <CardTitle className="text-2xl">כלי פיתוח</CardTitle>
              </div>
              <CardDescription>
                הרצת מיגרציות, דיבאג ולוגים מתקדמים
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DevToolsPanel />
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="api-keys" className="gap-2">
              <Key className="h-4 w-4" />
              מפתחות API
            </TabsTrigger>
            <TabsTrigger value="ai-pricing" className="gap-2">
              <Cpu className="h-4 w-4" />
              מחירי AI
            </TabsTrigger>
            <TabsTrigger value="themes" className="gap-2">
              <Palette className="h-4 w-4" />
              ערכות נושא
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai-pricing">
            <AIPricingSettings />
          </TabsContent>

          <TabsContent value="themes">
            <Card id="themes-section">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Palette className="w-6 h-6 text-primary" />
                  <CardTitle className="text-2xl">ערכות נושא</CardTitle>
                </div>
                <CardDescription>
                  בחר ערכת נושא מובנית או צור ערכה אישית
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ThemeManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api-keys">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SettingsIcon className="w-6 h-6 text-primary" />
              <CardTitle className="text-2xl">הגדרות API</CardTitle>
            </div>
            <CardDescription>
              הכנס את מפתחות ה-API שלך לשירותי התמלול
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* ── Personal Gemini (global toggle) ─────────────────── */}
            <div className="rounded-lg border-2 border-yellow-500/40 bg-yellow-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-600" />
                  <div>
                    <h3 className="font-semibold text-base">מפתח Gemini פרטי (גלובלי)</h3>
                    <p className="text-xs text-muted-foreground">
                      כשמופעל — כל קריאות ה-AI (עריכת טקסט, AI Polish, ניתוח תיקונים) יעברו דרך המפתח שלך במקום דרך Lovable.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={usePersonalGemini}
                  onCheckedChange={(v) => {
                    setUsePersonalGeminiState(v);
                    setPersonalGeminiEnabled(v && !!geminiKey.trim());
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gemini">Gemini API Key (Google AI Studio)</Label>
                <div className="relative">
                  <Input
                    id="gemini"
                    type={showGemini ? "text" : "password"}
                    placeholder="AIza... או AQ.Ab8..."
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    dir="ltr"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowGemini(!showGemini)}
                  >
                    {showGemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleSaveGeminiOnly}
                  disabled={!geminiKey.trim()}
                  className="w-full"
                >
                  💾 שמור מפתח Gemini בענן (ישיר)
                </div>
                <p className="text-xs text-muted-foreground">
                  צור מפתח חינמי ב-{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline text-yellow-700">
                    aistudio.google.com/apikey
                  </a>
                  . התמיכה כוללת מפתחות בפורמט הישן (<code>AIza…</code>) וגם החדש (<code>AQ.Ab8…</code>).
                </p>
              </div>

              {/* Model selector */}
              <div className="space-y-2">
                <Label>מודל Gemini לשימוש</Label>
                <Select value={geminiModel} onValueChange={setGeminiModelState}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONAL_GEMINI_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <GeminiBadge personal size={11} />
                          <span className="font-medium">{m.label}</span>
                          {m.note && <span className="text-muted-foreground text-xs mr-2">— {m.note}</span>}
                        </span>
                      </SelectItem>
                    ))}

                  </SelectContent>
                </Select>
              </div>

              {/* Fallback toggle */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background p-3">
                <div>
                  <div className="text-sm font-medium">Fallback אוטומטי ל-Lovable</div>
                  <p className="text-xs text-muted-foreground">
                    כשהמפתח שלך מוצה קרדיטים או מוחזר 429/403 — נעבור אוטומטית לקרדיטים של Lovable ונחכה שעה לפני ניסיון חוזר.
                  </p>
                </div>
                <Switch checked={geminiFallback} onCheckedChange={(v) => {
                  setGeminiFallbackState(v);
                  setPersonalGeminiFallbackEnabled(v);
                }} />
              </div>

              {/* Test connection */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={geminiTestStatus === 'testing' || !geminiKey.trim()}
                  onClick={async () => {
                    const key = geminiKey.trim();
                    if (!key) { toast.error("הזן מפתח קודם"); return; }
                    setGeminiTestStatus('testing');
                    setGeminiTestMsg("");
                    // Save key first so callPersonalGemini can read it
                    setPersonalGeminiKey(key);
                    setPersonalGeminiModel(geminiModel);
                    try {
                      const out = await callPersonalGemini({
                        userPrompt: "החזר בדיוק את המילה: OK",
                        model: geminiModel,
                        temperature: 0,
                      });
                      setGeminiTestStatus('ok');
                      setGeminiTestMsg(`✓ המפתח עובד. תגובה: "${out.slice(0, 60)}"`);
                      toast.success("המפתח תקין ומחובר ל-Google ✓");
                    } catch (e) {
                      setGeminiTestStatus('err');
                      const msg = e instanceof Error ? e.message : String(e);
                      setGeminiTestMsg(`✗ ${msg}`);
                      toast.error(`בדיקה נכשלה: ${msg.slice(0, 120)}`);
                    }
                  }}
                >
                  {geminiTestStatus === 'testing' ? "בודק..." : "בדוק חיבור"}
                </Button>
                {geminiTestStatus === 'ok' && (
                  <span className="text-xs text-green-600 font-medium">{geminiTestMsg}</span>
                )}
                {geminiTestStatus === 'err' && (
                  <span className="text-xs text-red-600 font-medium">{geminiTestMsg}</span>
                )}
              </div>

              {/* ── Usage counters ────────────────────────────────── */}
              <div className="rounded-md border border-yellow-500/30 bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GeminiBadge personal size={14} />
                    <span className="text-sm font-semibold">מסלול 1 · מפתח Gemini אישי (חיוב Google, USD)</span>
                  </div>
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-7 text-xs"
                    onClick={() => { resetPersonalGeminiUsage(); setGeminiUsage(getPersonalGeminiUsage()); toast.success("איפוס מוני שימוש"); }}
                  >
                    אפס מונים
                  </Button>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded bg-yellow-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">קריאות</div>
                    <div className="text-sm font-bold tabular-nums">{geminiUsage.calls.toLocaleString("he-IL")}</div>
                  </div>
                  <div className="rounded bg-yellow-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">Prompt</div>
                    <div className="text-sm font-bold tabular-nums">{geminiUsage.promptTokens.toLocaleString("he-IL")}</div>
                  </div>
                  <div className="rounded bg-yellow-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">סה״כ tokens</div>
                    <div className="text-sm font-bold tabular-nums text-yellow-700">{geminiUsage.totalTokens.toLocaleString("he-IL")}</div>
                  </div>
                  <div className="rounded bg-yellow-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">עלות מוערכת</div>
                    <div className="text-sm font-bold tabular-nums text-yellow-700">
                      {formatUsd(
                        Object.entries(geminiUsage.byModel).reduce(
                          (sum, [m, s]) => sum + estimateGeminiCostUsd(m, s.promptTokens, s.completionTokens),
                          0,
                        ),
                      )}
                    </div>
                  </div>
                </div>
                {Object.keys(geminiUsage.byModel).length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] text-muted-foreground">פירוט לפי מודל (מחיר לפי Google, טיר בתשלום):</div>
                    {Object.entries(geminiUsage.byModel)
                      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                      .map(([m, s]) => {
                        const price = getGeminiPrice(m);
                        const cost = estimateGeminiCostUsd(m, s.promptTokens, s.completionTokens);
                        return (
                          <div key={m} className="flex items-center justify-between gap-2 text-xs bg-background/60 rounded px-2 py-1">
                            <span className="font-mono truncate" dir="ltr" title={`${price.label} · in $${price.input}/1M · out $${price.output}/1M`}>
                              {m}
                            </span>
                            <span className="tabular-nums text-muted-foreground shrink-0">
                              {s.calls} · {s.totalTokens.toLocaleString("he-IL")} tok · <span className="text-yellow-700 font-semibold">{formatUsd(cost)}</span>
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
                {Object.keys(geminiUsage.bySurface || {}).length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] text-muted-foreground">פירוט לפי עמוד:</div>
                    {(Object.entries(geminiUsage.bySurface || {}) as Array<[UsageSurface, { calls: number; promptTokens: number; completionTokens: number; totalTokens: number }]>)
                      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                      .map(([surface, s]) => {
                        const models = (geminiUsage.bySurfaceModel?.[surface] || {}) as Record<string, { promptTokens: number; completionTokens: number }>;
                        const cost = Object.entries(models).reduce(
                          (sum, [m, mb]) => sum + estimateGeminiCostUsd(m, mb.promptTokens, mb.completionTokens),
                          0,
                        );
                        return (
                          <div key={surface} className="flex items-center justify-between gap-2 text-xs bg-yellow-500/5 rounded px-2 py-1">
                            <span className="font-medium">{SURFACE_LABELS[surface]}</span>
                            <span className="tabular-nums text-muted-foreground shrink-0">
                              {s.calls} · {s.totalTokens.toLocaleString("he-IL")} tok · <span className="text-yellow-700 font-semibold">{formatUsd(cost)}</span>
                            </span>
                          </div>
                        );
                      })}

                  </div>
                )}

                <div className="text-[10px] text-muted-foreground">
                  {geminiUsage.lastUsedAt
                    ? `שימוש אחרון: ${new Date(geminiUsage.lastUsedAt).toLocaleString("he-IL")} · מחירים מ-ai.google.dev/gemini-api/docs/pricing`
                    : "אין עדיין שימוש נספר. הספירה מתחילה כשמפעילים את המפתח האישי."}
                </div>
              </div>

              {/* ── Route 2: Lovable AI Gateway (credits) ──────────── */}
              <div className="rounded-md border border-sky-500/30 bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GeminiBadge size={14} />
                    <span className="text-sm font-semibold">מסלול 2 · Lovable AI Gateway (חיוב בקרדיטים)</span>
                  </div>
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-7 text-xs"
                    onClick={() => { resetLovableGatewayUsage(); setLovableUsage(getLovableGatewayUsage()); toast.success("איפוס מוני שימוש"); }}
                  >
                    אפס מונים
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-sky-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">קריאות</div>
                    <div className="text-sm font-bold tabular-nums">{lovableUsage.calls.toLocaleString("he-IL")}</div>
                  </div>
                  <div className="rounded bg-sky-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">Prompt</div>
                    <div className="text-sm font-bold tabular-nums">{lovableUsage.promptTokens.toLocaleString("he-IL")}</div>
                  </div>
                  <div className="rounded bg-sky-500/5 p-2">
                    <div className="text-[11px] text-muted-foreground">סה״כ tokens</div>
                    <div className="text-sm font-bold tabular-nums text-sky-700">{lovableUsage.totalTokens.toLocaleString("he-IL")}</div>
                  </div>
                </div>
                {Object.keys(lovableUsage.byModel).length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] text-muted-foreground">פירוט לפי מודל (עלות בקרדיטים של Lovable — ראו Settings → Plans & credits):</div>
                    {Object.entries(lovableUsage.byModel)
                      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                      .map(([m, s]) => (
                        <div key={m} className="flex items-center justify-between gap-2 text-xs bg-background/60 rounded px-2 py-1">
                          <span className="font-mono truncate" dir="ltr">{m}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {s.calls} · {s.totalTokens.toLocaleString("he-IL")} tok
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                {Object.keys(lovableUsage.bySurface || {}).length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] text-muted-foreground">פירוט לפי עמוד:</div>
                    {(Object.entries(lovableUsage.bySurface || {}) as Array<[UsageSurface, { calls: number; promptTokens: number; completionTokens: number; totalTokens: number }]>)
                      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
                      .map(([surface, s]) => (
                        <div key={surface} className="flex items-center justify-between gap-2 text-xs bg-sky-500/5 rounded px-2 py-1">
                          <span className="font-medium">{SURFACE_LABELS[surface]}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {s.calls} · {s.totalTokens.toLocaleString("he-IL")} tok
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground">
                  {lovableUsage.lastUsedAt
                    ? `שימוש אחרון: ${new Date(lovableUsage.lastUsedAt).toLocaleString("he-IL")} · נצרך מקרדיטים של Lovable`
                    : "עוד לא נספרה קריאה דרך Lovable AI. הספירה מתחילה כשהמפתח האישי כבוי או ב-fallback."}
                </div>
              </div>





              <p className="text-[11px] text-muted-foreground">
                המתג משפיע על <strong>כל שכבת ה-AI לעריכה וניתוח</strong> (עריכת טקסט, AI Polish, ניתוח תיקוני ASR, סיכומים, בדיקת איות).
                מנועי <strong>תמלול ודיאריזציה</strong> Gemini דורשים אינטגרציה נפרדת של מודל אודיו — יתווסף בהמשך כמנוע חדש בעמוד הראשי.
              </p>
            </div>



            <div className="space-y-2">
              <Label htmlFor="openai">OpenAI API Key</Label>
              <div className="relative">
                <Input
                  id="openai"
                  type={showOpenai ? "text" : "password"}
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowOpenai(!showOpenai)}
                >
                  {showOpenai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור Whisper של OpenAI
              </p>

              <Label htmlFor="openai-pool" className="mt-2 block">OpenAI API Keys Pool (שורה לכל מפתח)</Label>
              <textarea
                id="openai-pool"
                rows={3}
                placeholder="sk-key-1&#10;sk-key-2"
                value={openaiKeysPoolText}
                onChange={(e) => setOpenaiKeysPoolText(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groq">Groq API Key (מומלץ - מהיר מאוד!)</Label>
              <div className="relative">
                <Input
                  id="groq"
                  type={showGroq ? "text" : "password"}
                  placeholder="gsk_..."
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowGroq(!showGroq)}
                >
                  {showGroq ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור Groq Whisper - מהיר במיוחד ואיכותי
              </p>

              <Label htmlFor="groq-pool" className="mt-2 block">Groq API Keys Pool (שורה לכל מפתח)</Label>
              <textarea
                id="groq-pool"
                rows={4}
                placeholder="gsk_key_1&#10;gsk_key_2&#10;gsk_key_3"
                value={groqKeysPoolText}
                onChange={(e) => setGroqKeysPoolText(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground text-right">
                כשהמפתח הראשון נכשל/מגיע למגבלה, המערכת תעבור אוטומטית למפתח הבא ותציג הודעה.
              </p>

              <ApiKeyUsagePanel provider="groq" keysText={groqKeysPoolText} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="google">Google Cloud API Key</Label>
              <div className="relative">
                <Input
                  id="google"
                  type={showGoogle ? "text" : "password"}
                  placeholder="AIza..."
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowGoogle(!showGoogle)}
                >
                  {showGoogle ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור Google Speech-to-Text
              </p>

              <Label htmlFor="google-pool" className="mt-2 block">Google API Keys Pool (שורה לכל מפתח)</Label>
              <textarea
                id="google-pool"
                rows={3}
                placeholder="AIzaKey1&#10;AIzaKey2"
                value={googleKeysPoolText}
                onChange={(e) => setGoogleKeysPoolText(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assemblyai">AssemblyAI API Key</Label>
              <div className="relative">
                <Input
                  id="assemblyai"
                  type={showAssemblyAI ? "text" : "password"}
                  placeholder="..."
                  value={assemblyaiKey}
                  onChange={(e) => setAssemblyaiKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowAssemblyAI(!showAssemblyAI)}
                >
                  {showAssemblyAI ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור AssemblyAI - תמלול מהיר ואיכותי
              </p>

              <Label htmlFor="assembly-pool" className="mt-2 block">AssemblyAI API Keys Pool (שורה לכל מפתח)</Label>
              <textarea
                id="assembly-pool"
                rows={3}
                placeholder="asm_key_1&#10;asm_key_2"
                value={assemblyaiKeysPoolText}
                onChange={(e) => setAssemblyaiKeysPoolText(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deepgram">Deepgram API Key</Label>
              <div className="relative">
                <Input
                  id="deepgram"
                  type={showDeepgram ? "text" : "password"}
                  placeholder="..."
                  value={deepgramKey}
                  onChange={(e) => setDeepgramKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowDeepgram(!showDeepgram)}
                >
                  {showDeepgram ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור Deepgram - מהיר במיוחד
              </p>

              <Label htmlFor="deepgram-pool" className="mt-2 block">Deepgram API Keys Pool (שורה לכל מפתח)</Label>
              <textarea
                id="deepgram-pool"
                rows={3}
                placeholder="dg_key_1&#10;dg_key_2"
                value={deepgramKeysPoolText}
                onChange={(e) => setDeepgramKeysPoolText(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="huggingface">HuggingFace Token</Label>
              <div className="relative flex gap-1">
                <Input
                  id="huggingface"
                  type={showHuggingface ? "text" : "password"}
                  placeholder="hf_..."
                  value={huggingfaceKey}
                  onChange={(e) => setHuggingfaceKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowHuggingface(!showHuggingface)}
                  title="הצג/הסתר"
                >
                  {showHuggingface ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => {
                    setHuggingfaceKey("");
                    setShowHuggingface(true);
                  }}
                  title="ערוך"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => {
                    setHuggingfaceKey("");
                    toast.success("הטוקן נמחק — לחץ שמור לעדכון בענן");
                  }}
                  title="מחק"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                טוקן עבור HuggingFace — נדרש לזיהוי דוברים עם מודל pyannote (נשמר בענן)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="claude">Anthropic Claude API Key</Label>
              <div className="relative">
                <Input
                  id="claude"
                  type={showClaude ? "text" : "password"}
                  placeholder="sk-ant-..."
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                  dir="ltr"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowClaude(!showClaude)}
                >
                  {showClaude ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                מפתח API עבור Claude (בקרוב!)
              </p>
            </div>

            <Button onClick={handleSave} className="w-full" size="lg">
              שמור הגדרות
            </Button>
          </CardContent>
        </Card>

        {/* Ollama Local AI */}
        <OllamaManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
