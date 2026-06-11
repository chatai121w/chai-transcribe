import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2, Plus, Copy, Star, StarOff, GripVertical, Download, Upload, Check,
} from "lucide-react";

export type DashboardStylePreset = 'classic' | 'studio' | 'compact';

export type DashboardWidgetKey =
  | 'recent_transcripts'
  | 'folders'
  | 'stats'
  | 'recorder'
  | 'youtube'
  | 'search';

export const WIDGET_META: { key: DashboardWidgetKey; label: string }[] = [
  { key: 'recent_transcripts', label: 'תמלולים אחרונים' },
  { key: 'folders', label: 'תיקיות ופרויקטים' },
  { key: 'stats', label: 'סטטיסטיקה שבועית' },
  { key: 'recorder', label: 'מקליט אודיו' },
  { key: 'youtube', label: 'נגן יוטיוב מהיר' },
  { key: 'search', label: 'חיפוש גלובלי' },
];

export type DashboardLayoutPreset = {
  id: string;
  label: string;
  baseStyle: DashboardStylePreset;
  widgets?: DashboardWidgetKey[];
  columns?: 1 | 2 | 3;
  density?: number; // 0-100
  isDefault?: boolean;
};

const BASE_STYLE_LABEL: Record<DashboardStylePreset, string> = {
  classic: 'קלאסי נקי',
  studio: 'סטודיו מודרני',
  compact: 'קומפקטי',
};

const ALL_WIDGETS: DashboardWidgetKey[] = WIDGET_META.map(w => w.key);

type Template = {
  id: string;
  label: string;
  description: string;
  baseStyle: DashboardStylePreset;
  widgets: DashboardWidgetKey[];
  columns: 1 | 2 | 3;
  density: number;
};

const TEMPLATES: Template[] = [
  { id: 'tpl-minimal', label: 'מינימלי', description: 'רק תמלולים אחרונים, ממשק נקי וצפוף', baseStyle: 'compact', widgets: ['recent_transcripts'], columns: 1, density: 80 },
  { id: 'tpl-analyst', label: 'אנליסט', description: 'סטטיסטיקות, תיקיות וחיפוש - מבט-על', baseStyle: 'studio', widgets: ['stats', 'folders', 'search', 'recent_transcripts'], columns: 2, density: 50 },
  { id: 'tpl-creator', label: 'יוצר תוכן', description: 'מקליט, יוטיוב ותמלולים', baseStyle: 'studio', widgets: ['recorder', 'youtube', 'recent_transcripts'], columns: 2, density: 40 },
  { id: 'tpl-manager', label: 'מנהל', description: 'תיקיות, סטטיסטיקה וחיפוש', baseStyle: 'classic', widgets: ['folders', 'stats', 'search', 'recent_transcripts'], columns: 3, density: 60 },
  { id: 'tpl-teacher', label: 'מורה', description: 'מקליט ותמלולים אחרונים', baseStyle: 'classic', widgets: ['recorder', 'recent_transcripts', 'folders'], columns: 2, density: 50 },
];

type TabKey = 'editor' | 'list' | 'templates' | 'io';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: DashboardLayoutPreset[];
  activeId: string;
  onSave: (presets: DashboardLayoutPreset[], activeId: string) => void;
}

function normalize(p: DashboardLayoutPreset): Required<Omit<DashboardLayoutPreset, 'isDefault'>> & { isDefault?: boolean } {
  return {
    id: p.id,
    label: p.label,
    baseStyle: p.baseStyle,
    widgets: p.widgets && p.widgets.length ? p.widgets : ALL_WIDGETS,
    columns: (p.columns ?? 2) as 1 | 2 | 3,
    density: typeof p.density === 'number' ? p.density : 50,
    isDefault: p.isDefault,
  };
}

export function DashboardLayoutManager({ open, onOpenChange, presets, activeId, onSave }: Props) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<DashboardLayoutPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string>(activeId);
  const [tab, setTab] = useState<TabKey>('editor');
  const [importText, setImportText] = useState('');

  useEffect(() => {
    if (open) {
      setDrafts(presets.map(p => ({ ...normalize(p) })));
      setSelectedId(activeId);
      setTab('editor');
    }
  }, [open, presets, activeId]);

  const selected = useMemo(
    () => drafts.find(d => d.id === selectedId) ?? drafts[0],
    [drafts, selectedId],
  );

  const patchSelected = (patch: Partial<DashboardLayoutPreset>) => {
    if (!selected) return;
    setDrafts(prev => prev.map(d => d.id === selected.id ? { ...d, ...patch } : d));
  };

  const toggleWidget = (key: DashboardWidgetKey) => {
    if (!selected) return;
    const current = selected.widgets ?? ALL_WIDGETS;
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    patchSelected({ widgets: next });
  };

  const addNew = () => {
    const id = `custom-${Date.now()}`;
    const fresh: DashboardLayoutPreset = {
      id,
      label: `פריסה חדשה ${drafts.length + 1}`,
      baseStyle: 'classic',
      widgets: ALL_WIDGETS,
      columns: 2,
      density: 50,
    };
    setDrafts(prev => [...prev, fresh]);
    setSelectedId(id);
    setTab('editor');
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const id = `custom-${Date.now()}`;
    const copy: DashboardLayoutPreset = { ...selected, id, label: `${selected.label} (עותק)`, isDefault: false };
    setDrafts(prev => [...prev, copy]);
    setSelectedId(id);
    toast({ title: 'שוכפל', description: copy.label });
  };

  const removeSelected = () => {
    if (!selected || drafts.length <= 1) return;
    const idx = drafts.findIndex(d => d.id === selected.id);
    const next = drafts.filter(d => d.id !== selected.id);
    setDrafts(next);
    setSelectedId(next[Math.max(0, idx - 1)].id);
  };

  const setDefault = (id: string) => {
    setDrafts(prev => prev.map(d => ({ ...d, isDefault: d.id === id })));
  };

  const moveDraft = (id: string, dir: -1 | 1) => {
    setDrafts(prev => {
      const idx = prev.findIndex(d => d.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  const applyTemplate = (tpl: Template) => {
    const id = `custom-${Date.now()}`;
    const fresh: DashboardLayoutPreset = {
      id, label: tpl.label, baseStyle: tpl.baseStyle, widgets: tpl.widgets, columns: tpl.columns, density: tpl.density,
    };
    setDrafts(prev => [...prev, fresh]);
    setSelectedId(id);
    setTab('editor');
    toast({ title: 'תבנית נוספה', description: tpl.label });
  };

  const exportJson = () => {
    const data = JSON.stringify({ version: 1, presets: drafts }, null, 2);
    navigator.clipboard?.writeText(data).catch(() => {});
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dashboard-layouts.json'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'יוצא', description: 'הפריסות הועתקו והורדו כקובץ' });
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const list = Array.isArray(parsed) ? parsed : parsed?.presets;
      if (!Array.isArray(list)) throw new Error('invalid');
      const cleaned: DashboardLayoutPreset[] = list
        .filter((x: any) => x && typeof x.id === 'string' && typeof x.label === 'string')
        .map((x: any) => normalize(x));
      if (!cleaned.length) throw new Error('empty');
      setDrafts(prev => {
        const ids = new Set(prev.map(p => p.id));
        const merged = [...prev];
        cleaned.forEach(c => {
          const newId = ids.has(c.id) ? `${c.id}-${Date.now()}` : c.id;
          merged.push({ ...c, id: newId });
          ids.add(newId);
        });
        return merged;
      });
      setImportText('');
      toast({ title: 'יובא', description: `נוספו ${cleaned.length} פריסות` });
      setTab('list');
    } catch {
      toast({ title: 'שגיאה', description: 'JSON לא תקין', variant: 'destructive' });
    }
  };

  const handleSave = () => {
    if (!drafts.length) return;
    const cleaned = drafts.map(d => ({ ...d, label: d.label.trim() || 'פריסה ללא שם' }));
    const defaultPreset = cleaned.find(d => d.isDefault);
    const nextActive = defaultPreset?.id ?? (cleaned.some(d => d.id === activeId) ? activeId : cleaned[0].id);
    onSave(cleaned, nextActive);
    onOpenChange(false);
  };

  if (!selected && drafts.length === 0) {
    return null;
  }

  const sel = selected ?? drafts[0];
  const selWidgets = sel?.widgets ?? ALL_WIDGETS;
  const selCols = sel?.columns ?? 2;
  const selDensity = sel?.density ?? 50;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-6xl p-0 overflow-hidden bg-[#fcfaf7] border-stone-300/60 rounded-3xl"
      >
        {/* Header */}
        <DialogHeader className="px-8 py-6 border-b border-stone-200 bg-white flex flex-row items-center justify-between space-y-0">
          <div className="text-right">
            <DialogTitle className="text-2xl font-bold text-slate-800">ניהול פריסות אישיות</DialogTitle>
            <p className="text-sm text-slate-500 mt-1">התאמת סביבת העבודה לצרכים המקצועיים שלך</p>
          </div>
          <div className="flex gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200">
            {([
              ['editor', 'עורך'],
              ['list', 'רשימה'],
              ['templates', 'תבניות'],
              ['io', 'ייבוא-ייצוא'],
            ] as [TabKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  tab === key
                    ? 'bg-white shadow-sm border border-stone-200 text-slate-900'
                    : 'text-slate-500 hover:bg-white/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="grid grid-cols-12 min-h-[520px] max-h-[70vh]">
          {tab === 'editor' && sel && (
            <>
              <div className="col-span-7 p-8 overflow-y-auto border-l border-stone-200">
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">שם הפריסה</label>
                      <Input
                        value={sel.label}
                        onChange={(e) => patchSelected({ label: e.target.value })}
                        className="px-4 py-3 h-auto rounded-xl border-stone-200 bg-white text-right"
                        dir="rtl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">סגנון בסיס</label>
                      <Select value={sel.baseStyle} onValueChange={(v) => patchSelected({ baseStyle: v as DashboardStylePreset })}>
                        <SelectTrigger className="px-4 py-3 h-auto rounded-xl border-stone-200 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['classic', 'studio', 'compact'] as DashboardStylePreset[]).map(s => (
                            <SelectItem key={s} value={s}>{BASE_STYLE_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">מספר עמודות</label>
                      <div className="flex gap-2">
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            onClick={() => patchSelected({ columns: n as 1 | 2 | 3 })}
                            className={`flex-1 py-2 rounded-lg text-sm transition-all ${
                              selCols === n
                                ? 'border-2 border-yellow-500 bg-yellow-50 text-yellow-700 font-bold'
                                : 'border border-stone-200 bg-white font-medium hover:border-yellow-500'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        דחיסות ממשק <span className="text-yellow-600">{selDensity}%</span>
                      </label>
                      <div className="pt-3">
                        <Slider
                          value={[selDensity]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={([v]) => patchSelected({ density: v })}
                          className="[&_[role=slider]]:bg-yellow-500 [&_[role=slider]]:border-yellow-600"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ווידג'טים פעילים</label>
                    <div className="grid grid-cols-2 gap-3">
                      {WIDGET_META.map(w => {
                        const active = selWidgets.includes(w.key);
                        return (
                          <label
                            key={w.key}
                            className={`flex items-center p-4 rounded-xl cursor-pointer transition-all ${
                              active
                                ? 'border border-yellow-500/40 bg-yellow-50/40'
                                : 'border border-stone-200 bg-white hover:border-stone-300'
                            }`}
                          >
                            <Checkbox
                              checked={active}
                              onCheckedChange={() => toggleWidget(w.key)}
                              className="data-[state=checked]:bg-yellow-600 data-[state=checked]:border-yellow-600"
                            />
                            <span className="mr-3 font-medium text-slate-700">{w.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" onClick={duplicateSelected} className="gap-2">
                      <Copy className="w-4 h-4" /> שכפל פריסה
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDefault(sel.id)}
                      className={`gap-2 ${sel.isDefault ? 'border-yellow-500 text-yellow-700 bg-yellow-50' : ''}`}
                    >
                      {sel.isDefault ? <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" /> : <StarOff className="w-4 h-4" />}
                      {sel.isDefault ? 'ברירת מחדל' : 'הגדר כברירת מחדל'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={removeSelected}
                      disabled={drafts.length <= 1}
                      className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
                    >
                      <Trash2 className="w-4 h-4" /> מחק
                    </Button>
                  </div>
                </div>
              </div>

              <div className="col-span-5 bg-stone-100/50 p-8 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">תצוגה מקדימה חיה</span>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-400/50" />
                    <div className="w-2 h-2 rounded-full bg-yellow-400/50" />
                    <div className="w-2 h-2 rounded-full bg-green-400/50" />
                  </div>
                </div>

                <LivePreview cols={selCols} widgets={selWidgets} density={selDensity} baseStyle={sel.baseStyle} />

                <div className="mt-6 flex flex-col gap-2">
                  <p className="text-xs text-center text-slate-400">בחירה מהירה</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {drafts.map(d => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedId(d.id)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                          d.id === sel.id
                            ? 'bg-yellow-100 border border-yellow-300 text-yellow-700'
                            : 'bg-stone-200 text-slate-600 hover:bg-stone-300'
                        }`}
                      >
                        {d.label}
                        {d.isDefault && <Star className="inline w-3 h-3 mr-1 fill-yellow-500 text-yellow-500" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'list' && (
            <div className="col-span-12 p-8 overflow-hidden">
              <ScrollArea className="h-[460px]">
                <div className="space-y-2 pl-4">
                  {drafts.map((d, idx) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        d.id === selectedId ? 'border-yellow-400 bg-yellow-50/30' : 'border-stone-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-col">
                        <button onClick={() => moveDraft(d.id, -1)} disabled={idx === 0} className="text-stone-400 hover:text-slate-700 disabled:opacity-30">▲</button>
                        <button onClick={() => moveDraft(d.id, 1)} disabled={idx === drafts.length - 1} className="text-stone-400 hover:text-slate-700 disabled:opacity-30">▼</button>
                      </div>
                      <GripVertical className="w-4 h-4 text-stone-300" />
                      <Input
                        value={d.label}
                        onChange={(e) => setDrafts(prev => prev.map(p => p.id === d.id ? { ...p, label: e.target.value } : p))}
                        className="flex-1 text-right" dir="rtl"
                      />
                      <Select value={d.baseStyle} onValueChange={(v) => setDrafts(prev => prev.map(p => p.id === d.id ? { ...p, baseStyle: v as DashboardStylePreset } : p))}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['classic', 'studio', 'compact'] as DashboardStylePreset[]).map(s => (
                            <SelectItem key={s} value={s}>{BASE_STYLE_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedId(d.id); setDefault(d.id); }} title="ברירת מחדל">
                        {d.isDefault
                          ? <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                          : <StarOff className="w-4 h-4 text-stone-400" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedId(d.id); duplicateSelected(); }} title="שכפול">
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedId(d.id); setTab('editor'); }} title="עריכה">
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => { setSelectedId(d.id); removeSelected(); }}
                        disabled={drafts.length <= 1}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="מחיקה"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={addNew} className="w-full gap-2 mt-2">
                    <Plus className="w-4 h-4" /> הוסף פריסה חדשה
                  </Button>
                </div>
              </ScrollArea>
            </div>
          )}

          {tab === 'templates' && (
            <div className="col-span-12 p-8 overflow-y-auto">
              <p className="text-sm text-slate-500 mb-6">בחר תבנית מוכנה - היא תתווסף לרשימת הפריסות שלך כעותק שניתן לערוך.</p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {TEMPLATES.map(t => (
                  <div key={t.id} className="rounded-2xl border border-stone-200 bg-white p-5 flex flex-col gap-3 hover:border-yellow-400 transition-all">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800">{t.label}</h4>
                      <span className="text-[10px] uppercase font-bold text-yellow-600">{BASE_STYLE_LABEL[t.baseStyle]}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed flex-1">{t.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {t.widgets.map(w => (
                        <span key={w} className="text-[10px] bg-stone-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {WIDGET_META.find(m => m.key === w)?.label}
                        </span>
                      ))}
                    </div>
                    <Button onClick={() => applyTemplate(t)} className="w-full gap-2 bg-slate-900 hover:bg-slate-800 text-white">
                      <Plus className="w-4 h-4" /> הוסף לפריסות שלי
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'io' && (
            <div className="col-span-12 p-8 grid grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 flex items-center gap-2"><Download className="w-4 h-4" /> ייצוא</h4>
                <p className="text-xs text-slate-500">הורדה כקובץ JSON + העתקה ללוח. שתף את הפריסות שלך עם משתמשים אחרים.</p>
                <pre className="text-xs bg-stone-100 rounded-xl p-4 overflow-auto max-h-64 text-left" dir="ltr">
{JSON.stringify({ version: 1, presets: drafts }, null, 2)}
                </pre>
                <Button onClick={exportJson} className="w-full gap-2"><Download className="w-4 h-4" /> ייצא וצור קובץ</Button>
              </div>
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 flex items-center gap-2"><Upload className="w-4 h-4" /> ייבוא</h4>
                <p className="text-xs text-slate-500">הדבק JSON של פריסות. הפריסות המיובאות יתווספו לרשימה הקיימת.</p>
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"version":1,"presets":[...]}'
                  className="h-64 font-mono text-xs text-left"
                  dir="ltr"
                />
                <Button onClick={importJson} disabled={!importText.trim()} className="w-full gap-2"><Upload className="w-4 h-4" /> ייבא</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 bg-stone-50 border-t border-stone-200 flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button variant="outline" onClick={addNew} className="gap-2">
              <Plus className="w-4 h-4" /> פריסה חדשה
            </Button>
          </div>
          <Button onClick={handleSave} className="px-10 bg-slate-900 hover:bg-slate-800 text-white font-bold">
            שמירת שינויים
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LivePreview({ cols, widgets, density, baseStyle }: { cols: 1 | 2 | 3; widgets: DashboardWidgetKey[]; density: number; baseStyle: DashboardStylePreset }) {
  const gap = density < 33 ? 'gap-4' : density < 66 ? 'gap-3' : 'gap-2';
  const pad = density < 33 ? 'p-3' : density < 66 ? 'p-2' : 'p-1.5';
  const gridCols = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3';
  const tone =
    baseStyle === 'studio' ? 'from-yellow-50/40 to-white' :
    baseStyle === 'compact' ? 'from-white to-white' :
    'from-stone-50 to-white';

  return (
    <div className={`w-full aspect-[4/3] bg-gradient-to-b ${tone} rounded-2xl border border-stone-300 shadow-lg ${pad} flex flex-col ${gap} overflow-hidden`}>
      <div className="h-8 bg-white rounded-lg border border-stone-100 flex items-center px-3">
        <div className="w-20 h-2 bg-stone-200 rounded-full" />
      </div>
      <div className={`flex-1 grid ${gridCols} ${gap}`}>
        {widgets.length === 0 && (
          <div className="col-span-full flex items-center justify-center text-xs text-stone-400 border-2 border-dashed border-stone-200 rounded-xl">
            אין ווידג'טים פעילים
          </div>
        )}
        {widgets.map((w) => (
          <div key={w} className="bg-white border border-stone-100 rounded-xl p-2 flex flex-col gap-1.5">
            <div className="h-2 w-1/2 bg-yellow-200 rounded-full" />
            <div className="h-1.5 w-full bg-stone-100 rounded-full" />
            <div className="h-1.5 w-4/5 bg-stone-100 rounded-full" />
            <div className="text-[9px] text-stone-400 mt-auto truncate">{WIDGET_META.find(m => m.key === w)?.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
