import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BookMarked, Plus, Trash2, Download, Upload, RotateCcw,
  User, MapPin, Wrench, Building, Hash, X
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCustomVocabulary } from "@/hooks/useCustomVocabulary";
import type { VocabularyEntry } from "@/utils/customVocabulary";

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof User; color: string }> = {
  name: { label: 'שם', icon: User, color: 'bg-blue-500/20 text-blue-300' },
  place: { label: 'מקום', icon: MapPin, color: 'bg-green-500/20 text-green-300' },
  technical: { label: 'מקצועי', icon: Wrench, color: 'bg-orange-500/20 text-orange-300' },
  organization: { label: 'ארגון', icon: Building, color: 'bg-purple-500/20 text-purple-300' },
  other: { label: 'אחר', icon: Hash, color: 'bg-gray-500/20 text-gray-300' },
};

export const VocabularyPanel = () => {
  const {
    entries, stats, add, addBulk, remove, update,
    clearAll, exportData, importData,
  } = useCustomVocabulary();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newTerm, setNewTerm] = useState('');
  const [newCategory, setNewCategory] = useState<VocabularyEntry['category']>('other');
  const [newVariants, setNewVariants] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const handleAdd = () => {
    const trimmed = newTerm.trim();
    if (!trimmed) return;
    const variants = newVariants.split(',').map(v => v.trim()).filter(Boolean);
    const ok = add(trimmed, newCategory, variants);
    if (ok) {
      toast({ title: "נוסף", description: `"${trimmed}" נוסף למילון` });
      setNewTerm('');
      setNewVariants('');
    } else {
      toast({ title: "כבר קיים", description: `"${trimmed}" כבר במילון`, variant: "destructive" });
    }
  };

  const handleBulkAdd = () => {
    const terms = bulkInput.split('\n').map(t => t.trim()).filter(Boolean);
    if (terms.length === 0) return;
    const count = addBulk(terms, newCategory);
    toast({ title: "נוספו", description: `${count} מונחים חדשים נוספו` });
    setBulkInput('');
    setShowBulk(false);
  };

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vocabulary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "יוצא", description: `${entries.length} מונחים יוצאו` });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const count = importData(reader.result as string);
      if (count >= 0) {
        toast({ title: "יובא", description: `${count} מונחים חדשים יובאו` });
      } else {
        toast({ title: "שגיאה", description: "קובץ לא תקין", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredEntries = filterCategory === 'all'
    ? entries
    : entries.filter(e => e.category === filterCategory);

  return (
    <Card className="bg-[#1a1a2e]/90 border-white/10 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookMarked className="w-5 h-5 text-blue-400" />
          מילון מונחים אישי
        </CardTitle>
        <CardDescription className="text-white/60">
          הוסף שמות, מונחים ומילים שהמערכת תזהה טוב יותר בתמלול
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.totalTerms}</div>
            <div className="text-xs text-white/50">מונחים במילון</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {Object.keys(stats.byCategory).length}
            </div>
            <div className="text-xs text-white/50">קטגוריות</div>
          </div>
        </div>

        {/* Category badges */}
        {stats.totalTerms > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.byCategory).map(([cat, count]) => {
              const cfg = CATEGORY_CONFIG[cat];
              return (
                <Badge key={cat} variant="outline" className={cfg?.color || 'bg-white/10'}>
                  {cfg?.label || cat}: {count}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Add term form */}
        <div className="space-y-2 bg-white/5 rounded-lg p-3">
          <div className="flex gap-2">
            <Input
              value={newTerm}
              onChange={e => setNewTerm(e.target.value)}
              placeholder="מונח חדש..."
              className="bg-white/10 border-white/10 text-white flex-1"
              dir="rtl"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <Select value={newCategory} onValueChange={v => setNewCategory(v as VocabularyEntry['category'])}>
              <SelectTrigger className="w-28 bg-white/10 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAdd} disabled={!newTerm.trim()}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <Input
            value={newVariants}
            onChange={e => setNewVariants(e.target.value)}
            placeholder="גרסאות שגויות (מופרדות בפסיק): למשל דויד, דיויד"
            className="bg-white/10 border-white/10 text-white text-xs"
            dir="rtl"
          />
        </div>

        {/* Bulk add toggle */}
        <div>
          <Button variant="ghost" size="sm" className="text-xs text-white/50"
            onClick={() => setShowBulk(!showBulk)}>
            {showBulk ? 'סגור הוספה מרובה' : '+ הוספה מרובה (שורה לכל מונח)'}
          </Button>
          {showBulk && (
            <div className="space-y-2 mt-2">
              <Textarea
                value={bulkInput}
                onChange={e => setBulkInput(e.target.value)}
                placeholder="הכנס מונחים — שורה לכל מונח"
                className="bg-white/10 border-white/10 text-white h-24"
                dir="rtl"
              />
              <Button size="sm" onClick={handleBulkAdd} disabled={!bulkInput.trim()}>
                הוסף הכל
              </Button>
            </div>
          )}
        </div>

        {/* Filter */}
        {entries.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">סנן:</span>
            <div className="flex gap-1 flex-wrap">
              <Button variant={filterCategory === 'all' ? 'secondary' : 'ghost'} size="sm"
                className="text-xs h-6" onClick={() => setFilterCategory('all')}>הכל</Button>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <Button key={key} variant={filterCategory === key ? 'secondary' : 'ghost'}
                  size="sm" className="text-xs h-6" onClick={() => setFilterCategory(key)}>
                  {cfg.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Terms list */}
        {filteredEntries.length > 0 && (
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {filteredEntries.map((entry) => {
                const cfg = CATEGORY_CONFIG[entry.category];
                return (
                  <div key={entry.term}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 group text-sm">
                    <Badge variant="outline" className={`text-[10px] ${cfg?.color || ''}`}>
                      {cfg?.label || entry.category}
                    </Badge>
                    <span className="font-medium text-white/90 truncate" dir="rtl">
                      {entry.term}
                    </span>
                    {entry.variants.length > 0 && (
                      <span className="text-white/30 text-[10px] truncate max-w-[100px]" dir="rtl"
                        title={entry.variants.join(', ')}>
                        ({entry.variants.join(', ')})
                      </span>
                    )}
                    {entry.usageCount > 0 && (
                      <span className="text-white/30 text-[10px] mr-auto">
                        ×{entry.usageCount}
                      </span>
                    )}
                    <Button variant="ghost" size="sm"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-red-400"
                      onClick={() => remove(entry.term)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {entries.length === 0 && (
          <div className="text-center py-6 text-white/40">
            <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">המילון ריק</p>
            <p className="text-xs mt-1">הוסף שמות ומונחים לשיפור דיוק התמלול</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport}
            disabled={entries.length === 0}
            className="text-xs bg-white/5 border-white/10">
            <Download className="w-3.5 h-3.5 mr-1" />
            ייצוא
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs bg-white/5 border-white/10">
            <Upload className="w-3.5 h-3.5 mr-1" />
            ייבוא
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden"
            onChange={handleImport} />

          {entries.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm"
                  className="text-xs bg-red-500/10 border-red-500/20 text-red-400 mr-auto">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  מחק הכל
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[#1a1a2e] border-white/10">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">מחיקת כל המילון</AlertDialogTitle>
                  <AlertDialogDescription className="text-white/60">
                    פעולה זו תמחק את כל {entries.length} המונחים. לא ניתן לשחזר.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-white/5 border-white/10 text-white">ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { clearAll(); toast({ title: "נמחק" }); }}
                    className="bg-red-500 hover:bg-red-600">מחק</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Hotwords info */}
        {stats.totalTerms > 0 && (
          <div className="bg-blue-500/10 rounded-lg p-2 text-xs text-blue-300/80" dir="rtl">
            💡 {stats.totalTerms} מונחים ישולחו אוטומטית כ-hotwords ל-Whisper לשיפור הדיוק
          </div>
        )}
      </CardContent>
    </Card>
  );
};
