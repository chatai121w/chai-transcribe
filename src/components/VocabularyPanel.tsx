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
  BookMarked, Plus, Trash2, Download, Upload,
  User, MapPin, Wrench, Building, Hash, X, BookOpenText,
  UsersRound, Languages, LibraryBig, MessageSquareText, Cloud, CloudOff, Search,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCustomVocabulary } from "@/hooks/useCustomVocabulary";
import type { VocabularyEntry } from "@/utils/customVocabulary";

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof User; color: string }> = {
  tractate: { label: 'מסכת', icon: BookOpenText, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  tanna: { label: 'תנא', icon: UsersRound, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  amora: { label: 'אמורא', icon: UsersRound, color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  commentator: { label: 'מפרש', icon: MessageSquareText, color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  aramaic: { label: 'ארמית', icon: Languages, color: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  rabbinic_book: { label: 'ספר תורני', icon: LibraryBig, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  concept: { label: 'מושג', icon: Hash, color: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300' },
  name: { label: 'שם', icon: User, color: 'bg-blue-500/20 text-blue-300' },
  place: { label: 'מקום', icon: MapPin, color: 'bg-green-500/20 text-green-300' },
  technical: { label: 'מקצועי', icon: Wrench, color: 'bg-orange-500/20 text-orange-300' },
  organization: { label: 'ארגון', icon: Building, color: 'bg-purple-500/20 text-purple-300' },
  other: { label: 'אחר', icon: Hash, color: 'bg-gray-500/20 text-gray-300' },
};

export const VocabularyPanel = () => {
  const {
    entries, stats, add, addBulk, remove,
    clearAll, exportData, importData, syncCloud, cloudState, cloudError,
  } = useCustomVocabulary();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newTerm, setNewTerm] = useState('');
  const [newCategory, setNewCategory] = useState<VocabularyEntry['category']>('other');
  const [newVariants, setNewVariants] = useState('');
  const [newPronunciation, setNewPronunciation] = useState('');
  const [newContext, setNewContext] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  const handleAdd = () => {
    const trimmed = newTerm.trim();
    if (!trimmed) return;
    const variants = newVariants.split(',').map(v => v.trim()).filter(Boolean);
    const ok = add(trimmed, newCategory, variants, {
      pronunciation: newPronunciation,
      contextTags: newContext.split(',').map(value => value.trim()).filter(Boolean),
      source: 'user',
      approvalStatus: 'verified',
      confidence: 1,
    });
    if (ok) {
      toast({ title: "נוסף", description: `"${trimmed}" נוסף למילון` });
      setNewTerm('');
      setNewVariants('');
      setNewPronunciation('');
      setNewContext('');
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

  const query = search.trim().toLocaleLowerCase('he');
  const filteredEntries = entries.filter(entry => {
    if (filterCategory !== 'all' && entry.category !== filterCategory) return false;
    if (!query) return true;
    return [entry.term, ...entry.variants, ...entry.contextTags, entry.pronunciation || '']
      .some(value => value.toLocaleLowerCase('he').includes(query));
  });
  const personalEntriesCount = entries.filter(entry => entry.source !== 'built-in').length;

  return (
    <Card dir="rtl" className="text-right">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookMarked className="w-5 h-5" />
          מילון מונחים מרכזי
        </CardTitle>
        <CardDescription>
          מקור אמת אחד למונחים תקניים, Hotwords, הצעות תיקון ודוגמאות אימון
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="border rounded-md p-3 text-center">
            <div className="text-2xl font-bold">{stats.totalTerms}</div>
            <div className="text-xs text-muted-foreground">מונחים ללא כפילויות</div>
          </div>
          <div className="border rounded-md p-3 flex items-center justify-center gap-2">
            {cloudState === 'synced' ? <Cloud className="w-5 h-5 text-emerald-600" /> : <CloudOff className="w-5 h-5 text-muted-foreground" />}
            <div>
              <div className="text-sm font-semibold">{cloudState === 'syncing' ? 'מסנכרן…' : cloudState === 'synced' ? 'מסונכרן לענן' : 'שמירה מקומית'}</div>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => void syncCloud()}>סנכרן עכשיו</button>
            </div>
          </div>
        </div>
        {cloudState === 'error' && <p className="text-xs text-destructive" dir="auto">{cloudError}</p>}

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
        <div className="space-y-2 border rounded-md p-3">
          <div className="flex gap-2">
            <Input
              value={newTerm}
              onChange={e => setNewTerm(e.target.value)}
              placeholder="מונח חדש..."
              className="flex-1"
              dir="rtl"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <Select value={newCategory} onValueChange={v => setNewCategory(v as VocabularyEntry['category'])}>
              <SelectTrigger className="w-32">
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
            className="text-xs"
            dir="rtl"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <Input value={newPronunciation} onChange={e => setNewPronunciation(e.target.value)} placeholder="הגייה או ניקוד (אופציונלי)" dir="rtl" />
            <Input value={newContext} onChange={e => setNewContext(e.target.value)} placeholder="הקשרים: מסכת, נושא, דובר" dir="rtl" />
          </div>
        </div>

        {/* Bulk add toggle */}
        <div>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground"
            onClick={() => setShowBulk(!showBulk)}>
            {showBulk ? 'סגור הוספה מרובה' : '+ הוספה מרובה (שורה לכל מונח)'}
          </Button>
          {showBulk && (
            <div className="space-y-2 mt-2">
              <Textarea
                value={bulkInput}
                onChange={e => setBulkInput(e.target.value)}
                placeholder="הכנס מונחים — שורה לכל מונח"
                className="h-24"
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
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש במונחים, וריאציות והקשרים" className="pr-9" />
            </div>
            <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">סנן:</span>
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
                    className="flex items-center gap-2 px-2 py-2 rounded border hover:bg-muted/50 group text-sm">
                    <Badge variant="outline" className={`text-[10px] ${cfg?.color || ''}`}>
                      {cfg?.label || entry.category}
                    </Badge>
                    <span className="font-medium truncate" dir="rtl">
                      {entry.term}
                    </span>
                    {entry.variants.length > 0 && (
                      <span className="text-muted-foreground text-[10px] truncate max-w-[150px]" dir="rtl"
                        title={entry.variants.join(', ')}>
                        ({entry.variants.join(', ')})
                      </span>
                    )}
                    {entry.usageCount > 0 && (
                      <span className="text-muted-foreground text-[10px] mr-auto">
                        ×{entry.usageCount}
                      </span>
                    )}
                    <Badge variant="secondary" className="text-[10px]">{entry.source === 'built-in' ? 'מובנה' : entry.source === 'approved-correction' ? 'תיקון מאושר' : 'אישי'}</Badge>
                    <Button variant="ghost" size="sm"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-red-400"
                      onClick={() => remove(entry.term)}
                      disabled={entry.source === 'built-in'}
                      title={entry.source === 'built-in' ? 'מונח מובנה מוגן' : 'מחק מונח'}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {entries.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">המילון ריק</p>
            <p className="text-xs mt-1">הוסף שמות ומונחים לשיפור דיוק התמלול</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport}
            disabled={entries.length === 0}
            className="text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            ייצוא
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs">
            <Upload className="w-3.5 h-3.5 mr-1" />
            ייבוא
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden"
            onChange={handleImport} />

          {personalEntriesCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs text-destructive mr-auto">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  מחק מונחים אישיים
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>מחיקת המונחים האישיים</AlertDialogTitle>
                  <AlertDialogDescription>
                    פעולה זו תמחק {personalEntriesCount} מונחים אישיים ותשאיר את המילון התורני המובנה. לא ניתן לשחזר.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { clearAll(); toast({ title: "נמחק" }); }}
                    className="bg-red-500 hover:bg-red-600">מחק</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Hotwords info */}
        {stats.totalTerms > 0 && (
          <div className="bg-blue-500/10 rounded-md p-2 text-xs text-blue-800 dark:text-blue-300" dir="rtl">
            המערכת מדרגת לפי הקשר ושולחת רק רשימה מוגבלת ומנוקה מכפילויות ל־Whisper.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
