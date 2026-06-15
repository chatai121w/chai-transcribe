import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Eye, Settings2, Loader2, XCircle, Trash2, Check, RefreshCw,
  Wand2, ListChecks, CheckCheck, Pause, Play, Database, Zap, SpellCheck,
} from "lucide-react";
import type { MarkingSettings, DuplicateGroup } from "@/hooks/useTextMarking";
import type { WordValidation } from "@/components/DictionaryValidator";

interface MarkingToolbarProps {
  // Settings
  settings: MarkingSettings;
  setSettings: React.Dispatch<React.SetStateAction<MarkingSettings>>;
  // State
  isActive: boolean;
  isAnalyzing: boolean;
  isPaused: boolean;
  progress: number;
  stage: string;
  cacheSource: "none" | "local" | "cloud";
  canResume: boolean;
  hasText: boolean;
  // Stats
  localIssueCount: number;
  issueStats: { unknown: number; grammar: number; context: number; duplicates: number };
  fixableResults: WordValidation[];
  // Fix selection
  selectedFixes: Set<number>;
  showFixPanel: boolean;
  setShowFixPanel: (v: boolean) => void;
  toggleFixSelection: (index: number) => void;
  toggleSelectAll: () => void;
  wordResults: WordValidation[];
  // Actions
  runAnalysis: (resume?: boolean, forceRefresh?: boolean) => void;
  handlePause: () => void;
  handleResume: () => void;
  handleCancel: () => void;
  clearResults: () => void;
  handleFixAll: () => void;
  handleFixSelected: () => void;
  handleRemoveAllDuplicates: () => void;
  // Duplicate dialog
  selectedDuplicate: DuplicateGroup | null;
  setSelectedDuplicate: (g: DuplicateGroup | null) => void;
  handleRemoveDuplicate: (g: DuplicateGroup) => void;
  // Layout
  completedBatches?: number;
  totalBatches?: number;
}

export function MarkingToolbar({
  settings, setSettings,
  isActive, isAnalyzing, isPaused, progress, stage,
  cacheSource, canResume, hasText,
  localIssueCount, issueStats, fixableResults,
  selectedFixes, showFixPanel, setShowFixPanel,
  toggleFixSelection, toggleSelectAll, wordResults,
  runAnalysis, handlePause, handleResume, handleCancel,
  clearResults, handleFixAll, handleFixSelected,
  handleRemoveAllDuplicates,
  selectedDuplicate, setSelectedDuplicate, handleRemoveDuplicate,
  completedBatches, totalBatches,
}: MarkingToolbarProps) {
  return (
    <>
      {/* Compact control bar */}
      <div className="flex items-center gap-1.5 flex-wrap" dir="rtl">
        {/* Settings popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px] px-2">
              <Settings2 className="w-3 h-3" /> הגדרות סימון
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" dir="rtl" align="start">
            <div className="space-y-4">
              <h4 className="font-medium text-sm">סוגי סימון</h4>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-amber-400 rounded" /><Label className="text-xs">בדיקה מקומית מיידית</Label></div>
                <Switch checked={settings.localSpellCheck} onCheckedChange={(v) => setSettings((s) => ({ ...s, localSpellCheck: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-red-500 rounded" /><Label className="text-xs">מילים לא קיימות</Label></div>
                <Switch checked={settings.showUnknown} onCheckedChange={(v) => setSettings((s) => ({ ...s, showUnknown: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-orange-400 rounded" /><Label className="text-xs">שגיאות דקדוק</Label></div>
                <Switch checked={settings.showGrammar} onCheckedChange={(v) => setSettings((s) => ({ ...s, showGrammar: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-yellow-400 rounded" /><Label className="text-xs">בעיות הקשר</Label></div>
                <Switch checked={settings.showContext} onCheckedChange={(v) => setSettings((s) => ({ ...s, showContext: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-blue-400 rounded" /><Label className="text-xs">מילים כפולות</Label></div>
                <Switch checked={settings.showDuplicates} onCheckedChange={(v) => setSettings((s) => ({ ...s, showDuplicates: v }))} />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Main action button */}
        <Button size="sm" className="h-7 gap-1 text-[11px] px-2" onClick={() => runAnalysis(false)} disabled={isAnalyzing || !hasText} variant={isActive ? "secondary" : "default"}>
          {isAnalyzing
            ? <><Loader2 className="w-3 h-3 animate-spin" />{stage || "מנתח..."}</>
            : isActive
              ? <><RefreshCw className="w-3 h-3" />בדוק שוב</>
              : <><Eye className="w-3 h-3" />הפעל סימון</>}
        </Button>

        {/* Force refresh */}
        {isActive && !isAnalyzing && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] px-1.5" onClick={() => runAnalysis(false, true)} title="בדיקה מחדש ללא קאש">
            <Zap className="w-3 h-3" />
          </Button>
        )}

        {/* Cache source */}
        {isActive && cacheSource !== "none" && (
          <Badge variant="outline" className="text-[10px] h-5 gap-0.5 px-1.5">
            {cacheSource === "local" ? <><Zap className="w-2.5 h-2.5" />מקומי</> : <><Database className="w-2.5 h-2.5" />ענן</>}
          </Badge>
        )}

        {/* Pause / Resume / Cancel */}
        {isAnalyzing && (
          <>
            {isPaused ? (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] px-2" onClick={handleResume}>
                <Play className="w-3 h-3" /> המשך
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] px-2" onClick={handlePause}>
                <Pause className="w-3 h-3" /> השהה
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] px-1.5 text-destructive" onClick={handleCancel}>
              <XCircle className="w-3 h-3" />
            </Button>
          </>
        )}

        {/* Resume from checkpoint */}
        {canResume && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] px-2 border-emerald-500/30 text-emerald-600" onClick={() => runAnalysis(true)}>
            <Play className="w-3 h-3" /> המשך {completedBatches !== undefined && totalBatches !== undefined ? `(${completedBatches}/${totalBatches})` : ""}
          </Button>
        )}

        {/* Clear */}
        {isActive && !isAnalyzing && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-1.5" onClick={clearResults} title="נקה">
            <XCircle className="w-3 h-3" />
          </Button>
        )}

        {/* Fix All + Select */}
        {isActive && fixableResults.length > 0 && (
          <>
            <Button size="sm" variant="default" className="h-7 gap-1 text-[11px] px-2 bg-emerald-600 hover:bg-emerald-700" onClick={handleFixAll}>
              <Wand2 className="w-3 h-3" /> תקן הכל ({fixableResults.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] px-2" onClick={() => setShowFixPanel(!showFixPanel)}>
              <ListChecks className="w-3 h-3" /> {showFixPanel ? "סגור" : "בחר"}
            </Button>
          </>
        )}

        {/* Stats badges */}
        {(isActive || localIssueCount > 0) && (
          <div className="flex gap-1 mr-auto">
            {localIssueCount > 0 && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20 h-5"><SpellCheck className="w-2.5 h-2.5 ml-0.5" />{localIssueCount}</Badge>}
            {isActive && issueStats.unknown > 0 && <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20 h-5">{issueStats.unknown}</Badge>}
            {isActive && issueStats.grammar > 0 && <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20 h-5">{issueStats.grammar}</Badge>}
            {isActive && issueStats.context > 0 && <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-400 border-yellow-500/20 h-5">{issueStats.context}</Badge>}
            {isActive && issueStats.duplicates > 0 && <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20 h-5 cursor-pointer" onClick={handleRemoveAllDuplicates}><Trash2 className="w-2.5 h-2.5 ml-0.5" />{issueStats.duplicates}</Badge>}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {(isAnalyzing || (progress > 0 && progress < 100)) && (
        <div className="mt-1.5 space-y-0.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{stage}</span>
            <span className="font-mono font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
          {isPaused && <span className="text-[10px] text-yellow-500 font-medium">⏸ מושהה</span>}
        </div>
      )}

      {/* Fix selection panel */}
      {isActive && showFixPanel && fixableResults.length > 0 && (
        <div className="mt-2 rounded-lg border border-border/40 bg-muted/10 p-2" dir="rtl">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
              <h4 className="font-medium text-xs">בחר מילים לתיקון</h4>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-1.5" onClick={toggleSelectAll}>
                <CheckCheck className="w-3 h-3" />
                {selectedFixes.size === fixableResults.length ? "בטל" : "הכל"}
              </Button>
              <Button size="sm" className="h-6 text-[10px] gap-1 px-2 bg-emerald-600 hover:bg-emerald-700" disabled={selectedFixes.size === 0} onClick={handleFixSelected}>
                <Wand2 className="w-3 h-3" /> תקן ({selectedFixes.size})
              </Button>
            </div>
          </div>
          <ScrollArea className="max-h-[180px]">
            <div className="space-y-0.5">
              {fixableResults.map((r) => {
                const isSelected = selectedFixes.has(r.index);
                const issueColor = r.issueType === "spelling" || r.issueType === "unknown_word"
                  ? "text-red-400" : r.issueType === "grammar" ? "text-orange-400" : "text-yellow-400";
                return (
                  <div key={r.index} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${isSelected ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-white/5 hover:bg-white/10"}`} onClick={() => toggleFixSelection(r.index)}>
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleFixSelection(r.index)} className="shrink-0" />
                    <span className={`font-medium ${issueColor} line-through text-xs`}>{r.word}</span>
                    <span className="text-white/30 text-[10px]">→</span>
                    <span className="font-medium text-emerald-400 text-xs">{r.suggestion}</span>
                    {r.reason && <span className="text-white/30 text-[10px] mr-auto truncate max-w-[120px]">{r.reason}</span>}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Duplicate dialog */}
      <Dialog open={!!selectedDuplicate} onOpenChange={(open) => !open && setSelectedDuplicate(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>ניהול כפילות: &quot;{selectedDuplicate?.word}&quot;</DialogTitle></DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => selectedDuplicate && handleRemoveDuplicate(selectedDuplicate)}><Trash2 className="w-3.5 h-3.5" />הסר כפילויות</Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedDuplicate(null)}><Check className="w-3.5 h-3.5 ml-1" />השאר הכל</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
