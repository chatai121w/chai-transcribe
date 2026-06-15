import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Plus, Trash2, RotateCcw, Save, Download, Upload, Sparkles, Loader2, BookOpen, Settings2, Wand2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_LOSHON_KODESH_PROMPT, DEFAULT_LOSHON_KODESH_HOTWORDS, DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  DEFAULT_DICTIONARIES, DEFAULT_CATEGORY_ENABLED, DEFAULT_LK_AI_PROMPT, DEFAULT_LK_AI_MODEL,
  LK_CATEGORY_LABELS,
  getLoshonKodeshPrompt, setLoshonKodeshPrompt,
  getLoshonKodeshHotwordsList, setLoshonKodeshHotwordsList,
  getLoshonKodeshReplacements, setLoshonKodeshReplacements,
  getCategoryEnabled, setCategoryEnabled,
  getDictionaries, setDictionaries,
  isLoshonKodeshEnabled, setLoshonKodeshEnabled,
  isLoshonKodeshPostProcessEnabled, setLoshonKodeshPostProcessEnabled,
  isLkAiEnabled, setLkAiEnabled, isLkAiAuto, setLkAiAuto,
  getLkAiPrompt, setLkAiPrompt, getLkAiModel, setLkAiModel,
  applyLoshonKodeshReplacements, applyLkAiFix,
  type LkReplacement, type LkDictionary, type LkCategory,
} from "@/lib/loshonKodesh";

const AI_MODELS = [
  { value: 'google/gemini-2.5-flash',      label: 'Gemini 2.5 Flash (מהיר וזול, מומלץ)' },
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (הכי זול)' },
  { value: 'google/gemini-2.5-pro',        label: 'Gemini 2.5 Pro (איכות מקסימלית)' },
  { value: 'google/gemini-3-flash-preview',label: 'Gemini 3 Flash (preview)' },
  { value: 'openai/gpt-5-mini',            label: 'GPT-5 Mini' },
  { value: 'openai/gpt-5',                 label: 'GPT-5 (יקר ואיכותי)' },
];

const CATEGORY_OPTIONS: LkCategory[] = ['holam', 'tsere', 'kamatz', 'tav_rafa', 'names', 'terms', 'general'];

/** Simple inline diff highlight: marks changed words. */
function renderDiff(before: string, after: string) {
  if (before === after) return <span>{after}</span>;
  const bw = before.split(/(\s+)/);
  const aw = after.split(/(\s+)/);
  // Word-level naive diff: equal length? mark per-index; else show full after only.
  if (bw.length === aw.length) {
    return (
      <>
        {aw.map((w, i) =>
          w !== bw[i]
            ? <mark key={i} className="bg-primary/20 text-primary-foreground/90 rounded px-0.5">{w}</mark>
            : <span key={i}>{w}</span>
        )}
      </>
    );
  }
  return <span>{after}</span>;
}

export default function LoshonKodeshRules() {
  // Master toggles
  const [enabled, setEnabled] = useState(false);
  const [postProcess, setPostProcess] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAuto, setAiAuto] = useState(false);

  // Layer 1 — rules
  const [prompt, setPrompt] = useState("");
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [newHotword, setNewHotword] = useState("");
  const [replacements, setReplacements] = useState<LkReplacement[]>([]);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newCategory, setNewCategory] = useState<LkCategory>('general');
  const [categories, setCategories] = useState<Record<LkCategory, boolean>>({ ...DEFAULT_CATEGORY_ENABLED });

  // Dictionaries
  const [dicts, setDicts] = useState<LkDictionary[]>([]);
  const [activeDictId, setActiveDictId] = useState<string>("");
  const [newDictHot, setNewDictHot] = useState("");

  // AI
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_LK_AI_MODEL);

  // Test lab
  const [testInput, setTestInput] = useState("היום למדנו תוירה קוידשה ומוישע רבינו אוימר שאבעס.");
  const [testAiOut, setTestAiOut] = useState<string>("");
  const [testAiLoading, setTestAiLoading] = useState(false);

  useEffect(() => {
    setEnabled(isLoshonKodeshEnabled());
    setPostProcess(isLoshonKodeshPostProcessEnabled());
    setAiEnabled(isLkAiEnabled());
    setAiAuto(isLkAiAuto());
    setPrompt(getLoshonKodeshPrompt());
    setHotwords(getLoshonKodeshHotwordsList());
    setReplacements(getLoshonKodeshReplacements());
    setCategories(getCategoryEnabled());
    const d = getDictionaries();
    setDicts(d);
    setActiveDictId(d[0]?.id || "");
    setAiPrompt(getLkAiPrompt());
    setAiModel(getLkAiModel());
  }, []);

  // ── Prompt ─────────────────────────
  const savePrompt = () => { setLoshonKodeshPrompt(prompt); toast({ title: "נשמר" }); };
  const resetPrompt = () => { setPrompt(DEFAULT_LOSHON_KODESH_PROMPT); setLoshonKodeshPrompt(DEFAULT_LOSHON_KODESH_PROMPT); toast({ title: "אופס" }); };

  // ── Hotwords ───────────────────────
  const addHotword = () => {
    const v = newHotword.trim();
    if (!v || hotwords.includes(v)) return;
    const next = [...hotwords, v];
    setHotwords(next); setLoshonKodeshHotwordsList(next); setNewHotword("");
  };
  const removeHotword = (w: string) => {
    const next = hotwords.filter(x => x !== w);
    setHotwords(next); setLoshonKodeshHotwordsList(next);
  };
  const resetHotwords = () => {
    setHotwords(DEFAULT_LOSHON_KODESH_HOTWORDS); setLoshonKodeshHotwordsList(DEFAULT_LOSHON_KODESH_HOTWORDS);
  };

  // ── Replacements ───────────────────
  const addReplacement = () => {
    const f = newFrom.trim(), t = newTo.trim();
    if (!f || !t) { toast({ title: "מלא את שני השדות" }); return; }
    const next: LkReplacement[] = [...replacements, { from: f, to: t, wholeWord: true, category: newCategory }];
    setReplacements(next); setLoshonKodeshReplacements(next);
    setNewFrom(""); setNewTo("");
  };
  const updateReplacement = (i: number, patch: Partial<LkReplacement>) => {
    const next = replacements.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    setReplacements(next); setLoshonKodeshReplacements(next);
  };
  const removeReplacement = (i: number) => {
    const next = replacements.filter((_, idx) => idx !== i);
    setReplacements(next); setLoshonKodeshReplacements(next);
  };
  const resetReplacements = () => {
    setReplacements(DEFAULT_LOSHON_KODESH_REPLACEMENTS); setLoshonKodeshReplacements(DEFAULT_LOSHON_KODESH_REPLACEMENTS);
  };

  // ── Categories ─────────────────────
  const toggleCategory = (cat: LkCategory, v: boolean) => {
    const next = { ...categories, [cat]: v };
    setCategories(next); setCategoryEnabled(next);
  };

  // ── Dictionaries ───────────────────
  const persistDicts = (next: LkDictionary[]) => { setDicts(next); setDictionaries(next); };
  const activeDict = dicts.find(d => d.id === activeDictId);

  const toggleDict = (id: string, v: boolean) => persistDicts(dicts.map(d => d.id === id ? { ...d, enabled: v } : d));
  const addDict = () => {
    const id = `custom-${Date.now()}`;
    const next: LkDictionary = { id, name: 'מילון חדש', enabled: true, hotwords: [], replacements: [] };
    persistDicts([...dicts, next]); setActiveDictId(id);
  };
  const renameDict = (id: string, name: string) => persistDicts(dicts.map(d => d.id === id ? { ...d, name } : d));
  const deleteDict = (id: string) => {
    const next = dicts.filter(d => d.id !== id);
    persistDicts(next);
    if (activeDictId === id) setActiveDictId(next[0]?.id || "");
  };
  const addDictHotword = () => {
    const v = newDictHot.trim();
    if (!v || !activeDict || activeDict.hotwords.includes(v)) return;
    persistDicts(dicts.map(d => d.id === activeDict.id ? { ...d, hotwords: [...d.hotwords, v] } : d));
    setNewDictHot("");
  };
  const removeDictHotword = (w: string) => {
    if (!activeDict) return;
    persistDicts(dicts.map(d => d.id === activeDict.id ? { ...d, hotwords: d.hotwords.filter(x => x !== w) } : d));
  };
  const resetDicts = () => persistDicts(DEFAULT_DICTIONARIES);

  // ── AI ─────────────────────────────
  const saveAiPrompt = () => { setLkAiPrompt(aiPrompt); toast({ title: "פרומפט AI נשמר" }); };
  const resetAiPrompt = () => { setAiPrompt(DEFAULT_LK_AI_PROMPT); setLkAiPrompt(DEFAULT_LK_AI_PROMPT); };
  const onAiModelChange = (m: string) => { setAiModel(m); setLkAiModel(m); };

  // ── Import/Export ──────────────────
  const exportAll = () => {
    const data = {
      prompt: getLoshonKodeshPrompt(),
      hotwords: getLoshonKodeshHotwordsList(),
      replacements: getLoshonKodeshReplacements(),
      categories: getCategoryEnabled(),
      dictionaries: getDictionaries(),
      ai: { prompt: getLkAiPrompt(), model: getLkAiModel(), enabled: isLkAiEnabled(), auto: isLkAiAuto() },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `loshon-kodesh-rules-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result));
        if (typeof d.prompt === "string") { setPrompt(d.prompt); setLoshonKodeshPrompt(d.prompt); }
        if (Array.isArray(d.hotwords)) { setHotwords(d.hotwords); setLoshonKodeshHotwordsList(d.hotwords); }
        if (Array.isArray(d.replacements)) { setReplacements(d.replacements); setLoshonKodeshReplacements(d.replacements); }
        if (d.categories && typeof d.categories === 'object') { setCategories({ ...DEFAULT_CATEGORY_ENABLED, ...d.categories }); setCategoryEnabled({ ...DEFAULT_CATEGORY_ENABLED, ...d.categories }); }
        if (Array.isArray(d.dictionaries)) { persistDicts(d.dictionaries); }
        if (d.ai) {
          if (typeof d.ai.prompt === 'string') { setAiPrompt(d.ai.prompt); setLkAiPrompt(d.ai.prompt); }
          if (typeof d.ai.model === 'string') { setAiModel(d.ai.model); setLkAiModel(d.ai.model); }
          if (typeof d.ai.enabled === 'boolean') { setAiEnabled(d.ai.enabled); setLkAiEnabled(d.ai.enabled); }
          if (typeof d.ai.auto === 'boolean') { setAiAuto(d.ai.auto); setLkAiAuto(d.ai.auto); }
        }
        toast({ title: "יובא בהצלחה" });
      } catch {
        toast({ title: "שגיאה בייבוא", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Test lab ───────────────────────
  const layer1Out = useMemo(() => applyLoshonKodeshReplacements(testInput), [testInput, replacements, dicts, categories, postProcess]);
  const runAiTest = async () => {
    setTestAiLoading(true); setTestAiOut("");
    try {
      const out = await applyLkAiFix(layer1Out);
      setTestAiOut(out);
    } catch (e) {
      toast({ title: "שגיאת AI", description: e instanceof Error ? e.message : 'לא ידוע', variant: "destructive" });
    } finally { setTestAiLoading(false); }
  };

  return (
    <div dir="rtl" className="container max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">כללי לשון הקודש</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportAll}><Download className="w-4 h-4 ml-1" />ייצוא</Button>
          <Label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="w-4 h-4 ml-1" />ייבוא</span>
            </Button>
            <input type="file" accept="application/json" className="hidden" onChange={importAll} />
          </Label>
        </div>
      </div>

      {/* Master toggles — always visible */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">מצב לשון הקודש פעיל</div>
            <div className="text-xs text-muted-foreground">מזריק פרומפט והוטוורדס לכל תמלול חדש</div>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); setLoshonKodeshEnabled(v); }} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <div className="font-medium">החלפות אחרי התמלול (שכבה 1)</div>
            <div className="text-xs text-muted-foreground">תוירה→תורה, קוידש→קודש וכו'</div>
          </div>
          <Switch checked={postProcess} onCheckedChange={(v) => { setPostProcess(v); setLoshonKodeshPostProcessEnabled(v); }} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <div className="font-medium flex items-center gap-1"><Wand2 className="w-4 h-4 text-primary" />תיקון AI (שכבה 2)</div>
            <div className="text-xs text-muted-foreground">כפתור "תקן עם AI" בעורך הטקסט</div>
          </div>
          <Switch checked={aiEnabled} onCheckedChange={(v) => { setAiEnabled(v); setLkAiEnabled(v); }} />
        </div>
        {aiEnabled && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div>
              <div className="font-medium">הפעלת AI אוטומטית בסוף תמלול</div>
              <div className="text-xs text-muted-foreground">ירוץ ברקע אחרי שכבה 1 (עולה קרדיטים)</div>
            </div>
            <Switch checked={aiAuto} onCheckedChange={(v) => { setAiAuto(v); setLkAiAuto(v); }} />
          </div>
        )}
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="rules" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="rules"><Settings2 className="w-4 h-4 ml-1" />כללים</TabsTrigger>
          <TabsTrigger value="dicts"><BookOpen className="w-4 h-4 ml-1" />מילונים</TabsTrigger>
          <TabsTrigger value="ai"><Wand2 className="w-4 h-4 ml-1" />AI</TabsTrigger>
          <TabsTrigger value="test"><Sparkles className="w-4 h-4 ml-1" />בדיקה</TabsTrigger>
        </TabsList>

        {/* ── RULES TAB ─────────────────────────── */}
        <TabsContent value="rules" className="space-y-4">
          {/* Categories */}
          <Card className="p-4 space-y-3">
            <Label className="font-semibold">קטגוריות פעילות</Label>
            <p className="text-xs text-muted-foreground">כבה קטגוריה כדי לדלג על כל ההחלפות שלה</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {CATEGORY_OPTIONS.map(c => (
                <div key={c} className="flex items-center justify-between gap-2 bg-muted/30 rounded p-2">
                  <span className="text-sm">{LK_CATEGORY_LABELS[c]}</span>
                  <Switch checked={categories[c] !== false} onCheckedChange={(v) => toggleCategory(c, v)} />
                </div>
              ))}
            </div>
          </Card>

          {/* Prompt */}
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">פרומפט ראשוני ל-Whisper</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={resetPrompt}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
                <Button size="sm" onClick={savePrompt}><Save className="w-4 h-4 ml-1" />שמור</Button>
              </div>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[140px] text-sm font-mono" dir="rtl" />
            <p className="text-xs text-muted-foreground">עד ~224 טוקנים. תאר את ההקשר ותן דוגמאות לכתיב התקני שתרצה לראות.</p>
          </Card>

          {/* Hotwords */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">הוטוורדס בסיסיים ({hotwords.length})</Label>
              <Button variant="ghost" size="sm" onClick={resetHotwords}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
            </div>
            <div className="flex gap-2">
              <Input value={newHotword} onChange={(e) => setNewHotword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addHotword(); }} placeholder="הוסף מילה" dir="rtl" />
              <Button onClick={addHotword}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto p-2 bg-muted/30 rounded-md">
              {hotwords.map(w => (
                <Badge key={w} variant="secondary" className="gap-1 pr-1">
                  {w}
                  <button onClick={() => removeHotword(w)} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                </Badge>
              ))}
              {hotwords.length === 0 && <span className="text-xs text-muted-foreground">אין הוטוורדס</span>}
            </div>
          </Card>

          {/* Replacements */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold">החלפות פונטיות → תקני</Label>
                <p className="text-xs text-muted-foreground">רצות אוטומטית אחרי כל תמלול</p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetReplacements}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,160px,auto] gap-2 items-center">
              <Input value={newFrom} onChange={(e) => setNewFrom(e.target.value)} placeholder="פונטי (תוירה)" dir="rtl" />
              <Input value={newTo} onChange={(e) => setNewTo(e.target.value)} placeholder="תקני (תורה)" dir="rtl" />
              <Select value={newCategory} onValueChange={(v) => setNewCategory(v as LkCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{LK_CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={addReplacement}><Plus className="w-4 h-4" /></Button>
            </div>

            <div className="space-y-1 max-h-96 overflow-y-auto">
              {replacements.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr,1fr,140px,auto,auto] gap-2 items-center bg-muted/20 rounded p-2">
                  <Input value={r.from} onChange={(e) => updateReplacement(i, { from: e.target.value })} dir="rtl" className="h-8" />
                  <Input value={r.to} onChange={(e) => updateReplacement(i, { to: e.target.value })} dir="rtl" className="h-8" />
                  <Select value={r.category || 'general'} onValueChange={(v) => updateReplacement(i, { category: v as LkCategory })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{LK_CATEGORY_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 text-xs">
                    <Switch checked={r.wholeWord !== false} onCheckedChange={(v) => updateReplacement(i, { wholeWord: v })} />
                    <span>שלמה</span>
                  </label>
                  <Button variant="ghost" size="icon" onClick={() => removeReplacement(i)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {replacements.length === 0 && <p className="text-xs text-muted-foreground">אין החלפות</p>}
            </div>
          </Card>
        </TabsContent>

        {/* ── DICTIONARIES TAB ──────────────────── */}
        <TabsContent value="dicts" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="font-semibold">מילונים נושאיים</Label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={addDict}><Plus className="w-4 h-4 ml-1" />מילון חדש</Button>
                <Button size="sm" variant="ghost" onClick={resetDicts}><RotateCcw className="w-4 h-4 ml-1" />שחזר</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {dicts.map(d => (
                <div key={d.id} className={`flex items-center gap-2 rounded-md border px-2 py-1 cursor-pointer transition ${activeDictId === d.id ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => setActiveDictId(d.id)}>
                  <Switch checked={d.enabled} onCheckedChange={(v) => toggleDict(d.id, v)} onClick={(e) => e.stopPropagation()} />
                  <span className="text-sm">{d.name}</span>
                  <Badge variant="secondary" className="text-xs">{d.hotwords.length}</Badge>
                </div>
              ))}
            </div>
          </Card>

          {activeDict && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-1">
                  <Input value={activeDict.name} onChange={(e) => renameDict(activeDict.id, e.target.value)} className="max-w-xs" dir="rtl" />
                  <Switch checked={activeDict.enabled} onCheckedChange={(v) => toggleDict(activeDict.id, v)} />
                  <span className="text-xs text-muted-foreground">{activeDict.enabled ? 'פעיל' : 'כבוי'}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteDict(activeDict.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>

              <div className="flex gap-2">
                <Input value={newDictHot} onChange={(e) => setNewDictHot(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addDictHotword(); }} placeholder="הוסף מילה/ביטוי למילון" dir="rtl" />
                <Button onClick={addDictHotword}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-80 overflow-y-auto p-2 bg-muted/30 rounded-md">
                {activeDict.hotwords.map(w => (
                  <Badge key={w} variant="secondary" className="gap-1 pr-1">
                    {w}
                    <button onClick={() => removeDictHotword(w)} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </Badge>
                ))}
                {activeDict.hotwords.length === 0 && <span className="text-xs text-muted-foreground">ריק</span>}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ── AI TAB ────────────────────────────── */}
        <TabsContent value="ai" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-primary" />
              <Label className="font-semibold">שכבת AI — תיקון חכם</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              שכבת AI רצה אחרי שכבת הכללים. היא מבינה הקשר תורני, מתקנת פסוקים, ומטפלת במה שהכללים פספסו.
              ניתן להפעיל ידנית (כפתור בעורך) או אוטומטית (טוגל למעלה). משתמש ב-Lovable AI Gateway.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-[200px,1fr] gap-2 items-center">
              <Label>מודל AI</Label>
              <Select value={aiModel} onValueChange={onAiModelChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">פרומפט מערכת ל-AI</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={resetAiPrompt}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
                <Button size="sm" onClick={saveAiPrompt}><Save className="w-4 h-4 ml-1" />שמור</Button>
              </div>
            </div>
            <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="min-h-[260px] text-sm font-mono" dir="rtl" />
            <p className="text-xs text-muted-foreground">
              המערכת תוסיף לפרומפט הזה את אוצר המילים מהמילונים הפעילים אוטומטית.
            </p>
          </Card>
        </TabsContent>

        {/* ── TEST TAB ──────────────────────────── */}
        <TabsContent value="test" className="space-y-4">
          <Card className="p-4 space-y-3">
            <Label className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />בדיקה חיה
            </Label>
            <Textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} dir="rtl" className="min-h-[80px]" placeholder="הקלד טקסט פונטי לבדיקה..." />

            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">שכבה 1 — אחרי כללים והחלפות:</div>
              <div className="bg-muted/50 rounded p-3 text-sm leading-relaxed" dir="rtl">
                {renderDiff(testInput, layer1Out)}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t">
              <Button onClick={runAiTest} disabled={testAiLoading || !layer1Out.trim()}>
                {testAiLoading ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Wand2 className="w-4 h-4 ml-1" />}
                הרץ שכבה 2 (AI)
              </Button>
              <span className="text-xs text-muted-foreground">מומלץ Flash — מהיר וכמעט חינם</span>
            </div>

            {testAiOut && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">שכבה 2 — אחרי AI:</div>
                <div className="bg-primary/5 border border-primary/20 rounded p-3 text-sm leading-relaxed" dir="rtl">
                  {renderDiff(layer1Out, testAiOut)}
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
