/**
 * PronunciationProfileSelector
 * ────────────────────────────
 * Compact UI for picking which pronunciation profile is currently active,
 * plus a manage dialog for create / rename / delete / export / import.
 *
 * Profiles act as an EXTRA correction layer applied on top of the global
 * personal-pronunciation model — typically used per speaker (e.g. one
 * profile per Rabbi).
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Pencil,
  Trash2,
  UserCog,
  Download,
  Upload,
  CheckCircle2,
  Users,
  GraduationCap,
  Settings as SettingsIcon,
  ListChecks,
  Search,
  Cloud,
  CloudUpload,
  CloudDownload,
  RefreshCw,
  FolderOpen,
  BarChart3,
  Sparkles,
  X as XIcon,
} from 'lucide-react';
import {
  createProfile,
  deleteProfile,
  exportProfile,
  getActiveProfileId,
  importProfile,
  listProfiles,
  renameProfile,
  setActiveProfileId,
  type PronunciationProfile,
  getProfileCorrections,
  getProfileVerified,
  updateProfileSettings,
  diffForTraining,
  bulkTrainProfile,
  removeProfileCorrection,
  exportAllProfiles,
  importBundle,
  getAllProfileStats,
  type BulkTrainingPair,
} from '@/lib/pronunciationProfiles';
import {
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  syncNow,
  pushToCloud,
  pullFromCloud,
  deleteFromCloud,
  getLastSyncTime,
} from '@/lib/pronunciationProfilesCloud';
import { topSuggestionForFile, getCurrentAudioFilename, getProfileUsageStats, type ProfileSuggestion } from '@/lib/profileSuggestion';
import { ProfileConfidenceChart } from '@/components/ProfileConfidenceChart';
import type { CorrectionEntry } from '@/utils/correctionLearning';
import { toast } from '@/hooks/use-toast';

const ACTIVE_EVENT = 'pp-active-profile-changed';

export const PronunciationProfileSelector = () => {
  const [profiles, setProfiles] = useState<PronunciationProfile[]>(() => listProfiles());
  const [activeId, setActiveId] = useState<string>(() => getActiveProfileId());
  const [manageOpen, setManageOpen] = useState(false);

  // Create-form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Rename-form state
  const [renameId, setRenameId] = useState<string>('');
  const [renameValue, setRenameValue] = useState('');
  const [renameDesc, setRenameDesc] = useState('');

  // Settings dialog state
  const [settingsId, setSettingsId] = useState<string>('');
  const [settingsLk, setSettingsLk] = useState(false);
  const [settingsPrompt, setSettingsPrompt] = useState('');
  const [settingsExtraHotwords, setSettingsExtraHotwords] = useState('');

  // Bulk training dialog state
  const [trainId, setTrainId] = useState<string>('');
  const [trainRaw, setTrainRaw] = useState('');
  const [trainCorrected, setTrainCorrected] = useState('');
  const [trainPreview, setTrainPreview] = useState<BulkTrainingPair[]>([]);

  // Corrections-viewer dialog state
  const [viewId, setViewId] = useState<string>('');
  const [viewItems, setViewItems] = useState<CorrectionEntry[]>([]);
  const [viewFilter, setViewFilter] = useState('');

  // Chart dialog state
  const [chartId, setChartId] = useState<string>('');

  // Cloud sync state
  const [autoSync, setAutoSync] = useState<boolean>(() => isAutoSyncEnabled());
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number>(() => getLastSyncTime());

  // Auto-suggestion banner state
  const [suggestion, setSuggestion] = useState<ProfileSuggestion | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // Manage-dialog filter
  const [manageFilter, setManageFilter] = useState('');

  const refresh = () => setProfiles(listProfiles());

  useEffect(() => {
    const onActive = () => setActiveId(getActiveProfileId());
    const onStorage = () => {
      refresh();
      setActiveId(getActiveProfileId());
    };
    const onAudioChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string };
      const name = detail?.name || getCurrentAudioFilename();
      if (!name) { setSuggestion(null); return; }
      const s = topSuggestionForFile(name);
      // Only suggest if it's a different profile than the active one,
      // and the user hasn't dismissed this exact (file, profile) pair.
      if (!s || s.profileId === getActiveProfileId() || dismissedSuggestions.has(`${name}::${s.profileId}`)) {
        setSuggestion(null);
        return;
      }
      setSuggestion(s);
    };
    // Run once on mount in case a file is already loaded.
    onAudioChange(new CustomEvent('pp-audio-file-changed', { detail: { name: getCurrentAudioFilename() } }));
    window.addEventListener(ACTIVE_EVENT, onActive as EventListener);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pp-audio-file-changed', onAudioChange as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_EVENT, onActive as EventListener);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pp-audio-file-changed', onAudioChange as EventListener);
    };
  }, [dismissedSuggestions]);

  // Keyboard shortcut: Ctrl+Shift+P → cycle to next profile
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== 'p') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const list = listProfiles();
      if (list.length === 0) return;
      e.preventDefault();
      const cur = getActiveProfileId();
      const idx = list.findIndex((p) => p.id === cur);
      // Cycle: none → first → second → ... → last → none
      const nextIdx = idx === -1 ? 0 : idx + 1;
      if (nextIdx >= list.length) {
        setActiveProfileId('');
        setActiveId('');
        toast({ title: 'בוטל פרופיל', description: 'משתמש רק במודל הכללי' });
      } else {
        const np = list[nextIdx];
        setActiveProfileId(np.id);
        setActiveId(np.id);
        toast({ title: 'הופעל פרופיל', description: `${np.name} (Ctrl+Shift+P)` });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelect = (value: string) => {
    const next = value === '__none__' ? '' : value;
    setActiveProfileId(next);
    setActiveId(next);
    if (next) {
      const p = profiles.find((x) => x.id === next);
      toast({ title: 'הופעל פרופיל', description: p?.name });
    } else {
      toast({ title: 'בוטל פרופיל פעיל', description: 'משתמש רק במודל הכללי' });
    }
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    try {
      const p = createProfile(newName, newDesc);
      setNewName('');
      setNewDesc('');
      refresh();
      setActiveProfileId(p.id);
      setActiveId(p.id);
      toast({ title: 'נוצר פרופיל', description: p.name });
    } catch (e: any) {
      toast({ title: 'שגיאה', description: e?.message || 'יצירת פרופיל נכשלה', variant: 'destructive' });
    }
  };

  const handleStartRename = (p: PronunciationProfile) => {
    setRenameId(p.id);
    setRenameValue(p.name);
    setRenameDesc(p.description || '');
  };

  const handleApplyRename = () => {
    if (!renameId) return;
    renameProfile(renameId, renameValue, renameDesc);
    setRenameId('');
    refresh();
    toast({ title: 'עודכן' });
  };

  const handleDelete = (p: PronunciationProfile) => {
    if (!confirm(`למחוק את הפרופיל "${p.name}" וכל מה שלמד? פעולה בלתי הפיכה.`)) return;
    deleteProfile(p.id);
    refresh();
    setActiveId(getActiveProfileId());
    if (autoSync) deleteFromCloud(p.id).catch(() => {});
    toast({ title: 'נמחק', description: p.name });
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const r = await syncNow();
      setLastSync(getLastSyncTime());
      refresh();
      const errMsg = r.errors.length ? ` (שגיאות: ${r.errors.length})` : '';
      toast({
        title: 'סונכרון הושלם',
        description: `↑ ${r.pushed} · ↓ ${r.pulled}${errMsg}`,
      });
    } catch (e: any) {
      toast({ title: 'שגיאת סנכרון', description: String(e?.message || e), variant: 'destructive' });
    } finally { setSyncing(false); }
  };

  const handlePushOnly = async () => {
    setSyncing(true);
    try {
      const r = await pushToCloud();
      toast({ title: 'העלה לענן', description: `${r.pushed} פרופילים${r.errors.length ? ` (${r.errors.length} שגיאות)` : ''}` });
    } finally { setSyncing(false); }
  };

  const handlePullOnly = async () => {
    setSyncing(true);
    try {
      const r = await pullFromCloud();
      setLastSync(getLastSyncTime());
      refresh();
      toast({ title: 'משיכה מהענן', description: `${r.pulled} פרופילים${r.errors.length ? ` (${r.errors.length} שגיאות)` : ''}` });
    } finally { setSyncing(false); }
  };

  const handleBulkFileImport = async () => {
    if (!trainId) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt,.json';
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      // Match pairs: any two files whose names share a prefix when one contains
      // "raw" / "גולמי" / "original" and the other has "corrected" / "fix" / "מתוקן".
      const rawTokens = ['raw', 'original', 'גולמי', 'before'];
      const fixTokens = ['corrected', 'fixed', 'fix', 'מתוקן', 'after'];
      const isRaw = (n: string) => rawTokens.some((t) => n.toLowerCase().includes(t));
      const isFix = (n: string) => fixTokens.some((t) => n.toLowerCase().includes(t));
      const raws = files.filter((f) => isRaw(f.name));
      const fixes = files.filter((f) => isFix(f.name));

      let totalPairs: BulkTrainingPair[] = [];
      if (raws.length && fixes.length) {
        for (const r of raws) {
          // Find best-matching fix file by stripping raw/fix tokens from name.
          const stem = r.name.toLowerCase().replace(/(raw|original|גולמי|before)/g, '').replace(/\.[a-z]+$/, '').trim();
          const f = fixes.find((x) => x.name.toLowerCase().replace(/(corrected|fixed|fix|מתוקן|after)/g, '').replace(/\.[a-z]+$/, '').trim() === stem)
            || fixes[Math.min(raws.indexOf(r), fixes.length - 1)];
          if (!f) continue;
          const [rawText, fixText] = await Promise.all([r.text(), f.text()]);
          totalPairs = totalPairs.concat(diffForTraining(rawText, fixText));
        }
      } else if (files.length === 1 && files[0].name.endsWith('.json')) {
        // JSON: array of {original, corrected} or {raw, corrected}
        try {
          const arr = JSON.parse(await files[0].text());
          if (Array.isArray(arr)) {
            for (const it of arr) {
              const o = (it.original || it.raw || '').toString();
              const c = (it.corrected || it.fixed || '').toString();
              if (o && c && o !== c) totalPairs.push({ original: o, corrected: c, count: 1 });
            }
          }
        } catch (e: any) {
          toast({ title: 'שגיאת JSON', description: e?.message || String(e), variant: 'destructive' });
          return;
        }
      } else {
        toast({
          title: 'עלה זוגות קבצים',
          description: 'זוג קבצים עם שמות raw/גולמי וגם corrected/מתוקן, או JSON יחיד עם {original,corrected}',
          variant: 'destructive',
        });
        return;
      }

      // Aggregate duplicates.
      const merged = new Map<string, BulkTrainingPair>();
      for (const p of totalPairs) {
        const key = `${p.original}__${p.corrected}`;
        const e = merged.get(key);
        if (e) e.count += p.count;
        else merged.set(key, { ...p });
      }
      setTrainPreview(Array.from(merged.values()).sort((a, b) => b.count - a.count).slice(0, 500));
      toast({ title: 'נטענו קבצים', description: `נמצאו ${merged.size} זוגות תיקון` });
    };
    input.click();
  };

  const handleOpenSettings = (p: PronunciationProfile) => {
    setSettingsId(p.id);
    setSettingsLk(Boolean(p.settings?.loshonKodesh));
    setSettingsPrompt(p.settings?.initialPrompt || '');
    setSettingsExtraHotwords(p.settings?.extraHotwords || '');
  };

  const handleSaveSettings = () => {
    if (!settingsId) return;
    updateProfileSettings(settingsId, {
      loshonKodesh: settingsLk,
      initialPrompt: settingsPrompt.trim() || undefined,
      extraHotwords: settingsExtraHotwords.trim() || undefined,
    });
    refresh();
    setSettingsId('');
    toast({ title: 'הגדרות נשמרו' });
  };

  const handleOpenTrain = (p: PronunciationProfile) => {
    setTrainId(p.id);
    setTrainRaw('');
    setTrainCorrected('');
    setTrainPreview([]);
  };

  const handlePreviewTrain = () => {
    if (!trainRaw.trim() || !trainCorrected.trim()) return;
    setTrainPreview(diffForTraining(trainRaw, trainCorrected).slice(0, 200));
  };

  const handleApplyTrain = () => {
    if (!trainId || trainPreview.length === 0) return;
    const n = bulkTrainProfile(trainId, trainPreview);
    refresh();
    toast({ title: 'התבצע אימון', description: `${n} תיקונים נוספו לפרופיל` });
    setTrainId('');
  };

  const handleOpenView = (p: PronunciationProfile) => {
    setViewId(p.id);
    setViewItems(getProfileCorrections(p.id));
    setViewFilter('');
  };

  const handleDeleteFromView = (original: string, corrected: string) => {
    if (!viewId) return;
    removeProfileCorrection(viewId, original, corrected);
    setViewItems(getProfileCorrections(viewId));
    refresh();
  };

  const handleExport = (p: PronunciationProfile) => {
    const json = exportProfile(p.id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pronunciation-profile-${p.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        // Auto-detect bundle vs single profile.
        const probe = JSON.parse(text);
        if (Array.isArray(probe?.profiles)) {
          const r = importBundle(text);
          refresh();
          toast({
            title: r.imported > 0 ? 'חבילת פרופילים יובאה' : 'שום פרופיל לא יובא',
            description: `${r.imported} פרופילים${r.errors.length ? ` · ${r.errors.length} שגיאות` : ''}`,
            variant: r.imported === 0 ? 'destructive' : undefined,
          });
        } else {
          const p = importProfile(text);
          refresh();
          toast({ title: 'יובא בהצלחה', description: p.name });
        }
      } catch (e: any) {
        toast({ title: 'שגיאה בייבוא', description: e?.message || String(e), variant: 'destructive' });
      }
    };
    input.click();
  };

  const handleExportAll = () => {
    const json = exportAllProfiles();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `pronunciation-profiles-bundle-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'יוצאו כל הפרופילים', description: `${profiles.length} פרופילים נשמרו לקובץ` });
  };

  const activeProfile = profiles.find((p) => p.id === activeId);

  return (
    <div className="flex flex-col gap-2" dir="rtl">
      {suggestion && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm animate-in fade-in slide-in-from-top-1">
          <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="font-medium">המלצת הפעלה:</span>{' '}
            הקובץ הזה דומה לקבצים שתימללת עם פרופיל{' '}
            <span className="font-bold text-amber-700 dark:text-amber-400">{suggestion.profileName}</span>{' '}
            <span className="text-xs text-muted-foreground">(התאמה {Math.round(suggestion.score * 100)}%)</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-500/50"
            onClick={() => {
              setActiveProfileId(suggestion.profileId);
              setActiveId(suggestion.profileId);
              setSuggestion(null);
              toast({ title: 'הופעל פרופיל', description: suggestion.profileName });
            }}
          >
            הפעל
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="התעלם"
            onClick={() => {
              const fname = getCurrentAudioFilename();
              setDismissedSuggestions((prev) => new Set(prev).add(`${fname}::${suggestion.profileId}`));
              setSuggestion(null);
            }}
          >
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    <div
      className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
      dir="rtl"
    >
      <Users className="w-4 h-4 text-emerald-600 shrink-0" />
      <span className="font-medium shrink-0">פרופיל הגייה אישי:</span>
      <Select value={activeId || '__none__'} onValueChange={handleSelect}>
        <SelectTrigger className="h-8 text-xs flex-1 min-w-0 max-w-[260px]">
          <SelectValue placeholder="ללא פרופיל" />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value="__none__">ללא — רק המודל הכללי</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.description ? <span className="text-muted-foreground"> — {p.description}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeProfile && (
        <Badge variant="secondary" className="text-[10px] gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          פעיל
        </Badge>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
            <UserCog className="w-3.5 h-3.5" />
            ניהול
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> פרופילי הגייה
            </DialogTitle>
            <DialogDescription>
              צור פרופיל לכל דובר/רב — המנוע ילמד את ההגייה הספציפית שלו. בעת תמלול הפעל את הפרופיל המתאים.
              לימוד דרך לחיצה ימנית על מילה נשמר גם בפרופיל הפעיל וגם במודל הכללי.
            </DialogDescription>
          </DialogHeader>

          {/* Aggregate stats */}
          {profiles.length > 0 && (() => {
            const stats = getAllProfileStats();
            const totalC = stats.reduce((s, x) => s + x.corrections, 0);
            const totalV = stats.reduce((s, x) => s + x.verified, 0);
            const totalA = stats.reduce((s, x) => s + x.approved, 0);
            const avgConf = stats.length > 0
              ? stats.reduce((s, x) => s + x.avgConfidence, 0) / stats.length
              : 0;
            return (
              <div className="grid grid-cols-4 gap-2 text-center text-[11px] rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                <div>
                  <div className="font-bold text-emerald-700 dark:text-emerald-400 text-base">{profiles.length}</div>
                  <div className="text-muted-foreground">פרופילים</div>
                </div>
                <div>
                  <div className="font-bold text-blue-700 dark:text-blue-400 text-base">{totalC}</div>
                  <div className="text-muted-foreground">תיקונים</div>
                </div>
                <div>
                  <div className="font-bold text-purple-700 dark:text-purple-400 text-base">{totalV + totalA}</div>
                  <div className="text-muted-foreground">מאומתים</div>
                </div>
                <div>
                  <div className="font-bold text-amber-700 dark:text-amber-400 text-base">{Math.round(avgConf * 100)}%</div>
                  <div className="text-muted-foreground">ביטחון ממוצע</div>
                </div>
              </div>
            );
          })()}

          {/* Create */}
          <div className="rounded-lg border border-border/60 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">יצירת פרופיל חדש</div>
            <div className="flex gap-2">
              <Input
                placeholder="שם (למשל: הרב כהן)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
                dir="rtl"
              />
              <Button onClick={handleCreate} size="sm" className="h-8 text-xs gap-1" disabled={!newName.trim()}>
                <Plus className="w-3.5 h-3.5" />
                צור
              </Button>
            </div>
            <Textarea
              placeholder="תיאור (אופציונלי) — סגנון דיבור, מבטא, נושאים אופייניים…"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="text-xs min-h-[60px]"
              dir="rtl"
            />
          </div>

          {/* List */}
          {profiles.length > 4 && (
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="חפש לפי שם או תיאור..."
                value={manageFilter}
                onChange={(e) => setManageFilter(e.target.value)}
                className="h-8 text-xs pr-8"
                dir="rtl"
              />
            </div>
          )}
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {profiles.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                עדיין אין פרופילים. צור אחד למעלה.
              </div>
            ) : (
              profiles
                .filter((p) => !manageFilter.trim() || `${p.name} ${p.description || ''}`.toLowerCase().includes(manageFilter.toLowerCase()))
                .map((p) => {
                const corrections = getProfileCorrections(p.id).length;
                const verified = getProfileVerified(p.id).length;
                const usage = getProfileUsageStats(p.id);
                const isEditing = renameId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-2.5 ${
                      activeId === p.id
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-border/60 bg-muted/20'
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-8 text-sm"
                          dir="rtl"
                        />
                        <Textarea
                          value={renameDesc}
                          onChange={(e) => setRenameDesc(e.target.value)}
                          className="text-xs min-h-[50px]"
                          dir="rtl"
                          placeholder="תיאור"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={handleApplyRename}>
                            שמור
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setRenameId('')}
                          >
                            ביטול
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2">
                            {p.name}
                            {activeId === p.id && (
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                פעיל
                              </Badge>
                            )}
                          </div>
                          {p.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {corrections} תיקונים · {verified} מאומתים
                            {usage.count > 0 && (
                              <>
                                {' · '}
                                <span title={new Date(usage.lastUsed).toLocaleString('he-IL')}>
                                  שימוש ב-{usage.count} תמלולים
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                          {activeId !== p.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleSelect(p.id)}
                            >
                              הפעל
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="צפה בתיקונים"
                            onClick={() => handleOpenView(p)}
                          >
                            <ListChecks className="w-3.5 h-3.5 text-blue-500" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="גרף למידה"
                            onClick={() => setChartId(p.id)}
                          >
                            <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="אמן (לפני/אחרי)"
                            onClick={() => handleOpenTrain(p)}
                          >
                            <GraduationCap className="w-3.5 h-3.5 text-purple-500" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="הגדרות מנוע"
                            onClick={() => handleOpenSettings(p)}
                          >
                            <SettingsIcon className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="ערוך"
                            onClick={() => handleStartRename(p)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="ייצא"
                            onClick={() => handleExport(p)}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                            title="מחק"
                            onClick={() => handleDelete(p)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="sm:justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleImport}>
                <Upload className="w-3.5 h-3.5" />
                ייבא JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleExportAll}
                disabled={profiles.length === 0}
                title="גבה את כל הפרופילים לקובץ JSON אחד"
              >
                <Download className="w-3.5 h-3.5" />
                ייצא הכל
              </Button>
              <div className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1">
                <Cloud className="w-3.5 h-3.5 text-sky-600" />
                <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => { setAutoSync(e.target.checked); setAutoSyncEnabled(e.target.checked); }}
                    className="rounded"
                  />
                  סנכרון אוטומטי
                </label>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={syncing} onClick={handleSyncNow}>
                  <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                  סנכרן
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={syncing} title="העלה בלבד" onClick={handlePushOnly}>
                  <CloudUpload className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={syncing} title="משיכה בלבד" onClick={handlePullOnly}>
                  <CloudDownload className="w-3.5 h-3.5" />
                </Button>
                {lastSync > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    סונכרן לאחרונה: {new Date(lastSync).toLocaleTimeString('he-IL')}
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={() => setManageOpen(false)}>
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Settings sub-dialog ─────────────────────────────────── */}
      <Dialog open={!!settingsId} onOpenChange={(o) => { if (!o) setSettingsId(''); }}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SettingsIcon className="w-5 h-5" /> הגדרות מנוע לפרופיל
            </DialogTitle>
            <DialogDescription>
              ההגדרות יופעלו רק כאשר הפרופיל פעיל. הן מוזנות ישירות למנוע (Whisper) — לא רק כתיקון אחרי.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <input
                type="checkbox"
                checked={settingsLk}
                onChange={(e) => setSettingsLk(e.target.checked)}
                className="rounded"
              />
              <span className="font-medium">לשון הקודש (הגייה אשכנזית)</span>
              <span className="text-xs text-muted-foreground">— אילוץ פר-פרופיל</span>
            </label>
            <div>
              <div className="text-xs font-medium mb-1">Initial Prompt למנוע</div>
              <Textarea
                value={settingsPrompt}
                onChange={(e) => setSettingsPrompt(e.target.value)}
                className="text-sm min-h-[100px]"
                dir="rtl"
                placeholder='לדוגמה: "שיעור גמרא של הרב X. נושאים: בבא קמא, חושן משפט, פסיקת הלכה."'
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                מטה את המנוע לכיוון הסגנון/הנושא של הדובר. כתוב במשפט שלם בעברית.
              </div>
            </div>
            <div>
              <div className="text-xs font-medium mb-1">Hotwords נוספים</div>
              <Textarea
                value={settingsExtraHotwords}
                onChange={(e) => setSettingsExtraHotwords(e.target.value)}
                className="text-sm min-h-[60px]"
                dir="rtl"
                placeholder="מילים מופרדות בפסיק או שורה חדשה: רמב״ם, תוספות, רש״י, גמרא"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                המילים המאומתות של הפרופיל מצורפות אוטומטית. כאן רק תוספות ידניות.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSettingsId('')}>
              ביטול
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSaveSettings}>
              שמור הגדרות
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Bulk training sub-dialog ────────────────────────────── */}
      <Dialog open={!!trainId} onOpenChange={(o) => { if (!o) setTrainId(''); }}>
        <DialogContent className="max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-purple-500" /> אימון מהיר מתמלולים
            </DialogTitle>
            <DialogDescription>
              הדבק תמלול גולמי (איך המנוע תמלל) ותמלול מתוקן (מה צריך להיות). המערכת תחלץ את ההבדלים ותלמד את הפרופיל אוטומטית.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium mb-1 text-muted-foreground">תמלול גולמי (לפני)</div>
              <Textarea
                value={trainRaw}
                onChange={(e) => setTrainRaw(e.target.value)}
                className="text-sm min-h-[200px]"
                dir="rtl"
                placeholder="הדבק את הטקסט שהמנוע ייצר…"
              />
            </div>
            <div>
              <div className="text-xs font-medium mb-1 text-muted-foreground">תמלול מתוקן (אחרי)</div>
              <Textarea
                value={trainCorrected}
                onChange={(e) => setTrainCorrected(e.target.value)}
                className="text-sm min-h-[200px]"
                dir="rtl"
                placeholder="הדבק את הטקסט הנכון…"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!trainRaw.trim() || !trainCorrected.trim()}
              onClick={handlePreviewTrain}
            >
              חשב הבדלים
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleBulkFileImport}>
              <FolderOpen className="w-3.5 h-3.5" />
              טען מקבצי טקסט / JSON
            </Button>
            {trainPreview.length > 0 && (
              <span className="text-xs text-muted-foreground">
                נמצאו {trainPreview.length} זוגות תיקון
              </span>
            )}
          </div>
          {trainPreview.length > 0 && (
            <div className="max-h-[35vh] overflow-y-auto border border-border/60 rounded-lg p-2 space-y-1 bg-muted/20">
              {trainPreview.map((p, i) => (
                <div key={i} className="text-xs flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                  <span className="text-red-500 line-through">{p.original}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-emerald-600 font-medium">{p.corrected}</span>
                  {p.count > 1 && (
                    <Badge variant="secondary" className="text-[10px]">×{p.count}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setTrainId('')}>
              ביטול
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={trainPreview.length === 0}
              onClick={handleApplyTrain}
            >
              אמן את הפרופיל ({trainPreview.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Corrections-viewer sub-dialog ───────────────────────── */}
      <Dialog open={!!viewId} onOpenChange={(o) => { if (!o) setViewId(''); }}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-blue-500" /> תיקונים שלמדו לפרופיל
            </DialogTitle>
            <DialogDescription>
              ניהול ידני של מה שהפרופיל למד. אפשר למחוק תיקונים שגויים.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={viewFilter}
              onChange={(e) => setViewFilter(e.target.value)}
              placeholder="חפש מילה…"
              className="h-8 text-sm pr-8"
              dir="rtl"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto border border-border/60 rounded-lg divide-y divide-border/30">
            {viewItems.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">
                עדיין לא נלמדו תיקונים. השתמש בלחיצה ימנית או באימון מהיר.
              </div>
            ) : (
              viewItems
                .filter((c) => {
                  if (!viewFilter.trim()) return true;
                  const q = viewFilter.trim();
                  return c.original.includes(q) || c.corrected.includes(q);
                })
                .slice(0, 500)
                .map((c, i) => (
                  <div
                    key={`${c.original}__${c.corrected}__${i}`}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/40"
                  >
                    <span className="text-red-500 line-through truncate max-w-[35%]" title={c.original}>
                      {c.original}
                    </span>
                    <span className="text-muted-foreground shrink-0">→</span>
                    <span className="text-emerald-600 font-medium truncate max-w-[35%]" title={c.corrected}>
                      {c.corrected}
                    </span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {c.frequency || 1}×
                    </Badge>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {Math.round((c.confidence || 0) * 100)}%
                    </Badge>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-red-500 shrink-0"
                      title="מחק"
                      onClick={() => handleDeleteFromView(c.original, c.corrected)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
            )}
          </div>
          <DialogFooter>
            <span className="text-xs text-muted-foreground self-center mr-auto">
              סה״כ: {viewItems.length} תיקונים
            </span>
            <Button size="sm" className="h-8 text-xs" onClick={() => setViewId('')}>
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Confidence chart sub-dialog ─────────────────────────── */}
      <Dialog open={!!chartId} onOpenChange={(o) => { if (!o) setChartId(''); }}>
        <DialogContent className="max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-600" />
              עקומת למידה — {profiles.find((p) => p.id === chartId)?.name}
            </DialogTitle>
            <DialogDescription>
              תיקונים שנוספו לפי יום + ביטחון ממוצע. ככל שהפרופיל בשל, הביטחון אמור לעלות.
            </DialogDescription>
          </DialogHeader>
          {chartId && <ProfileConfidenceChart profileId={chartId} />}
          <DialogFooter>
            <Button size="sm" className="h-8 text-xs" onClick={() => setChartId('')}>
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
};
