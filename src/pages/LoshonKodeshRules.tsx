import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Plus, Trash2, RotateCcw, Save, Download, Upload, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_LOSHON_KODESH_PROMPT,
  DEFAULT_LOSHON_KODESH_HOTWORDS,
  DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  getLoshonKodeshPrompt,
  setLoshonKodeshPrompt,
  getLoshonKodeshHotwordsList,
  setLoshonKodeshHotwordsList,
  getLoshonKodeshReplacements,
  setLoshonKodeshReplacements,
  isLoshonKodeshEnabled,
  setLoshonKodeshEnabled,
  isLoshonKodeshPostProcessEnabled,
  setLoshonKodeshPostProcessEnabled,
  applyLoshonKodeshReplacements,
  type LkReplacement,
} from "@/lib/loshonKodesh";

export default function LoshonKodeshRules() {
  const [enabled, setEnabled] = useState(false);
  const [postProcess, setPostProcess] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [newHotword, setNewHotword] = useState("");
  const [replacements, setReplacements] = useState<LkReplacement[]>([]);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [testInput, setTestInput] = useState("היום למדנו תוירה קוידשה ומוישה רבינו אוימר שאבס.");

  useEffect(() => {
    setEnabled(isLoshonKodeshEnabled());
    setPostProcess(isLoshonKodeshPostProcessEnabled());
    setPrompt(getLoshonKodeshPrompt());
    setHotwords(getLoshonKodeshHotwordsList());
    setReplacements(getLoshonKodeshReplacements());
  }, []);

  const savePrompt = () => {
    setLoshonKodeshPrompt(prompt);
    toast({ title: "נשמר", description: "הפרומפט עודכן" });
  };

  const resetPrompt = () => {
    setPrompt(DEFAULT_LOSHON_KODESH_PROMPT);
    setLoshonKodeshPrompt(DEFAULT_LOSHON_KODESH_PROMPT);
    toast({ title: "אופס לברירת מחדל" });
  };

  const addHotword = () => {
    const v = newHotword.trim();
    if (!v) return;
    if (hotwords.includes(v)) { toast({ title: "כבר קיים" }); return; }
    const next = [...hotwords, v];
    setHotwords(next);
    setLoshonKodeshHotwordsList(next);
    setNewHotword("");
  };

  const removeHotword = (w: string) => {
    const next = hotwords.filter(x => x !== w);
    setHotwords(next);
    setLoshonKodeshHotwordsList(next);
  };

  const resetHotwords = () => {
    setHotwords(DEFAULT_LOSHON_KODESH_HOTWORDS);
    setLoshonKodeshHotwordsList(DEFAULT_LOSHON_KODESH_HOTWORDS);
    toast({ title: "אופס לברירת מחדל" });
  };

  const addReplacement = () => {
    const f = newFrom.trim();
    const t = newTo.trim();
    if (!f || !t) { toast({ title: "מלא את שני השדות" }); return; }
    const next: LkReplacement[] = [...replacements, { from: f, to: t, wholeWord: true }];
    setReplacements(next);
    setLoshonKodeshReplacements(next);
    setNewFrom(""); setNewTo("");
  };

  const updateReplacement = (i: number, patch: Partial<LkReplacement>) => {
    const next = replacements.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    setReplacements(next);
    setLoshonKodeshReplacements(next);
  };

  const removeReplacement = (i: number) => {
    const next = replacements.filter((_, idx) => idx !== i);
    setReplacements(next);
    setLoshonKodeshReplacements(next);
  };

  const resetReplacements = () => {
    setReplacements(DEFAULT_LOSHON_KODESH_REPLACEMENTS);
    setLoshonKodeshReplacements(DEFAULT_LOSHON_KODESH_REPLACEMENTS);
    toast({ title: "אופס לברירת מחדל" });
  };

  const exportAll = () => {
    const data = {
      prompt: getLoshonKodeshPrompt(),
      hotwords: getLoshonKodeshHotwordsList(),
      replacements: getLoshonKodeshReplacements(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loshon-kodesh-rules-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (typeof data.prompt === "string") { setPrompt(data.prompt); setLoshonKodeshPrompt(data.prompt); }
        if (Array.isArray(data.hotwords)) { setHotwords(data.hotwords); setLoshonKodeshHotwordsList(data.hotwords); }
        if (Array.isArray(data.replacements)) { setReplacements(data.replacements); setLoshonKodeshReplacements(data.replacements); }
        toast({ title: "יובא בהצלחה" });
      } catch {
        toast({ title: "שגיאה בייבוא", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const previewOut = applyLoshonKodeshReplacements(testInput);

  return (
    <div dir="rtl" className="container max-w-4xl mx-auto p-4 md:p-6 space-y-4">
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

      {/* Master toggles */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">מצב לשון הקודש פעיל</div>
            <div className="text-xs text-muted-foreground">מזריק את הפרומפט וההוטוורדס לכל תמלול חדש</div>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); setLoshonKodeshEnabled(v); }} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <div className="font-medium">החלף מילים בתמלול אחרי הסיום</div>
            <div className="text-xs text-muted-foreground">פוסט־פרוססינג: תוירה→תורה, קוידש→קודש וכו'</div>
          </div>
          <Switch checked={postProcess} onCheckedChange={(v) => { setPostProcess(v); setLoshonKodeshPostProcessEnabled(v); }} />
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
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[140px] text-sm font-mono"
          dir="rtl"
        />
        <p className="text-xs text-muted-foreground">עד ~224 טוקנים. תאר את ההקשר ותן דוגמאות לכתיב התקני שתרצה לראות.</p>
      </Card>

      {/* Hotwords */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="font-semibold">הוטוורדס ({hotwords.length})</Label>
          <Button variant="ghost" size="sm" onClick={resetHotwords}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={newHotword}
            onChange={(e) => setNewHotword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addHotword(); }}
            placeholder="הוסף מילה או ביטוי"
            dir="rtl"
          />
          <Button onClick={addHotword}><Plus className="w-4 h-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto p-2 bg-muted/30 rounded-md">
          {hotwords.map(w => (
            <Badge key={w} variant="secondary" className="gap-1 pr-1">
              {w}
              <button onClick={() => removeHotword(w)} className="hover:text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
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
            <p className="text-xs text-muted-foreground">חולם, צירה, ת' רפה וכו'. רצים אחרי כל תמלול.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={resetReplacements}><RotateCcw className="w-4 h-4 ml-1" />ברירת מחדל</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,auto] gap-2 items-center">
          <Input value={newFrom} onChange={(e) => setNewFrom(e.target.value)} placeholder="פונטי (תוירה)" dir="rtl" />
          <Input value={newTo} onChange={(e) => setNewTo(e.target.value)} placeholder="תקני (תורה)" dir="rtl" />
          <Button onClick={addReplacement}><Plus className="w-4 h-4 ml-1" />הוסף</Button>
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {replacements.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr,1fr,auto,auto] gap-2 items-center bg-muted/20 rounded p-2">
              <Input value={r.from} onChange={(e) => updateReplacement(i, { from: e.target.value })} dir="rtl" className="h-8" />
              <Input value={r.to} onChange={(e) => updateReplacement(i, { to: e.target.value })} dir="rtl" className="h-8" />
              <label className="flex items-center gap-1 text-xs">
                <Switch
                  checked={r.wholeWord !== false}
                  onCheckedChange={(v) => updateReplacement(i, { wholeWord: v })}
                />
                <span>מילה שלמה</span>
              </label>
              <Button variant="ghost" size="icon" onClick={() => removeReplacement(i)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
          {replacements.length === 0 && <p className="text-xs text-muted-foreground">אין החלפות</p>}
        </div>
      </Card>

      {/* Live preview */}
      <Card className="p-4 space-y-2">
        <Label className="font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />בדיקה חיה
        </Label>
        <Textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} dir="rtl" className="min-h-[80px]" />
        <div className="bg-muted/50 rounded p-3 text-sm" dir="rtl">
          <div className="text-xs text-muted-foreground mb-1">תוצאה אחרי החלפות:</div>
          {previewOut}
        </div>
      </Card>
    </div>
  );
}
