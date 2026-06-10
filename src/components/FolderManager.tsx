import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu";
import {
  FolderOpen, FolderPlus, FileText, Search, Edit, Trash2,
  Star, StarOff, Tag, Grid3X3, List, ArrowUpDown, X, Check,
  StickyNote, Briefcase, GraduationCap, Users, MessageSquare, MoreHorizontal,
  Download, Loader2, Play, Pause, Volume2, Table2, RectangleHorizontal, LayoutGrid,
  Eye, Filter, SortAsc, SortDesc, SlidersHorizontal
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { CloudTranscript } from "@/hooks/useCloudTranscripts";

const CATEGORIES = [
  { value: "meeting", label: "ישיבה", icon: Briefcase },
  { value: "lecture", label: "הרצאה", icon: GraduationCap },
  { value: "interview", label: "ראיון", icon: Users },
  { value: "conversation", label: "שיחה", icon: MessageSquare },
  { value: "other", label: "אחר", icon: MoreHorizontal },
] as const;

type SortKey = "date" | "title" | "length" | "engine";
type ViewMode = "cards" | "grid" | "table" | "rectangles";

interface FolderManagerProps {
  transcripts: CloudTranscript[];
  onUpdate: (id: string, updates: Partial<Pick<CloudTranscript, 'folder' | 'tags' | 'title' | 'notes' | 'category' | 'is_favorite'>>) => void;
  onDelete: (id: string) => void;
  onGetAudioUrl?: (filePath: string) => Promise<string | null>;
}

const CUSTOM_FOLDERS_KEY = 'local_folders';
const getCustomFolders = (): string[] => {
  try { return JSON.parse(localStorage.getItem(CUSTOM_FOLDERS_KEY) || '[]'); } catch { return []; }
};
const saveCustomFolders = (folders: string[]) => {
  localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(folders));
};

const normalizeForCompare = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/["'`.,;:!?()\[\]{}<>\\/|\-]/g, '')
    .trim()
    .toLowerCase();

const isDuplicatePreview = (title: string, preview: string) => {
  const normTitle = normalizeForCompare(title);
  const normPreview = normalizeForCompare(preview);
  if (!normTitle || !normPreview) return false;
  return normPreview === normTitle || normPreview.startsWith(normTitle);
};

export const FolderManager = ({ transcripts, onUpdate, onDelete, onGetAudioUrl }: FolderManagerProps) => {
  const navigate = useNavigate();
  const { preferences, updatePreference } = useCloudPreferences();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const sortKey = (preferences.folder_sort_key || 'date') as SortKey;
  const setSortKey = useCallback((k: SortKey) => updatePreference('folder_sort_key', k), [updatePreference]);
  const sortAsc = preferences.folder_sort_asc ?? false;
  const setSortAsc = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(preferences.folder_sort_asc ?? false) : v;
    updatePreference('folder_sort_asc', next);
  }, [updatePreference, preferences.folder_sort_asc]);
  const viewMode = (preferences.folder_view_mode || 'cards') as ViewMode;
  const setViewMode = useCallback((m: ViewMode) => updatePreference('folder_view_mode', m), [updatePreference]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [addingTagId, setAddingTagId] = useState<string | null>(null);
  const [customFolders, setCustomFolders] = useState<string[]>(getCustomFolders);

  // Merge transcript-derived folders + user-created custom folders
  const folders = useMemo(() => {
    const fromTranscripts = transcripts.map(t => t.folder).filter(Boolean);
    const all = new Set([...fromTranscripts, ...customFolders]);
    return Array.from(all).sort((a, b) => a.localeCompare(b, 'he'));
  }, [transcripts, customFolders]);

  const allTags = useMemo(() => {
    const s = new Set(transcripts.flatMap(t => t.tags || []));
    return Array.from(s).sort();
  }, [transcripts]);

  // Filter & sort
  const filteredTranscripts = useMemo(() => {
    let result = transcripts;
    if (showFavoritesOnly) result = result.filter(t => t.is_favorite);
    if (selectedFolder !== null) result = result.filter(t => (t.folder || '') === selectedFolder);
    if (selectedCategory) result = result.filter(t => t.category === selectedCategory);
    if (selectedTag) result = result.filter(t => t.tags?.includes(selectedTag));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.text ?? '').toLowerCase().includes(q) ||
        t.title?.toLowerCase().includes(q) ||
        t.engine.toLowerCase().includes(q) ||
        t.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }
    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date": cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        case "title": cmp = (a.title || '').localeCompare(b.title || '', 'he'); break;
        case "length": cmp = a.text.length - b.text.length; break;
        case "engine": cmp = a.engine.localeCompare(b.engine); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [transcripts, showFavoritesOnly, selectedFolder, selectedCategory, selectedTag, searchQuery, sortKey, sortAsc]);

  const unfolderedCount = transcripts.filter(t => !t.folder).length;

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (folders.includes(name)) {
      toast({ title: "התיקיה כבר קיימת", variant: "destructive" });
      setSelectedFolder(name);
    } else {
      const updated = [...new Set([...customFolders, name])];
      setCustomFolders(updated);
      saveCustomFolders(updated);
      setSelectedFolder(name);
      toast({ title: "תיקיה נוצרה", description: name });
    }
    setNewFolderName("");
    setShowNewFolder(false);
  };

  const handleDeleteFolder = (folderName: string) => {
    // Remove from custom folders
    const updated = customFolders.filter(f => f !== folderName);
    setCustomFolders(updated);
    saveCustomFolders(updated);
    // Move transcripts out of this folder
    transcripts.filter(t => t.folder === folderName).forEach(t => onUpdate(t.id, { folder: '' }));
    if (selectedFolder === folderName) setSelectedFolder(null);
    toast({ title: "תיקיה נמחקה", description: folderName });
  };

  const handleMoveToFolder = (transcriptId: string, folder: string) => {
    onUpdate(transcriptId, { folder });
    setMovingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    selectedIds.forEach(id => onDelete(id));
    setSelectedIds(new Set());
  };

  const handleBulkMove = (folder: string) => {
    selectedIds.forEach(id => onUpdate(id, { folder }));
    setSelectedIds(new Set());
  };

  const saveTitle = (id: string) => {
    if (editingTitle.trim()) onUpdate(id, { title: editingTitle.trim() });
    setEditingTitleId(null);
  };

  const saveNotes = (id: string) => {
    onUpdate(id, { notes: editingNotes });
    setEditingNotesId(null);
  };

  const addTag = (id: string, existingTags: string[]) => {
    const tag = newTagInput.trim();
    if (!tag || existingTags.includes(tag)) return;
    onUpdate(id, { tags: [...existingTags, tag] });
    setNewTagInput("");
    setAddingTagId(null);
  };

  const removeTag = (id: string, existingTags: string[], tagToRemove: string) => {
    onUpdate(id, { tags: existingTags.filter(t => t !== tagToRemove) });
  };

  const [isExportingZip, setIsExportingZip] = useState(false);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const getCategoryLabel = (val: string) => CATEGORIES.find(c => c.value === val)?.label || val;

  const handleExportFolderZip = async (folderName: string | null) => {
    const items = folderName === null
      ? filteredTranscripts
      : transcripts.filter(t => (t.folder || '') === folderName);
    if (items.length === 0) {
      toast({ title: "אין תמלולים לייצוא", variant: "destructive" });
      return;
    }
    setIsExportingZip(true);
    try {
      const JSZip = (await import("jszip")).default;
      const { saveAs } = await import("file-saver");
      const zip = new JSZip();
      const label = folderName || "כל_התמלולים";
      const folder = zip.folder(label)!;
      items.forEach((t, i) => {
        const name = (t.title || `תמלול_${i + 1}`).replace(/[/\\:*?"<>|]/g, '_');
        let content = `כותרת: ${t.title || '(ללא)'}\n`;
        content += `מנוע: ${t.engine}\n`;
        content += `תאריך: ${new Date(t.created_at).toLocaleString('he-IL')}\n`;
        if (t.category) content += `קטגוריה: ${getCategoryLabel(t.category)}\n`;
        if (t.tags?.length) content += `תגיות: ${t.tags.join(', ')}\n`;
        if (t.notes) content += `הערות: ${t.notes}\n`;
        content += `\n---\n\n${t.text}`;
        folder.file(`${name}.txt`, content);
      });
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${label}.zip`);
      toast({ title: `יוצאו ${items.length} תמלולים בהצלחה` });
    } catch {
      toast({ title: "שגיאה בייצוא", variant: "destructive" });
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <Card dir="rtl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <CardTitle className="text-xl">ניהול תמלולים</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-1">
                <Badge variant="secondary">{selectedIds.size} נבחרו</Badge>
                <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                  <Trash2 className="w-3 h-3 ml-1" />מחק
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline"><FolderOpen className="w-3 h-3 ml-1" />העבר</Button>
                  </DialogTrigger>
                  <DialogContent dir="rtl" className="max-w-sm">
                    <DialogHeader><DialogTitle>העבר נבחרים לתיקיה</DialogTitle></DialogHeader>
                    <div className="space-y-2 py-2">
                      <Button variant="outline" className="w-full justify-start" onClick={() => handleBulkMove('')}>ללא תיקיה</Button>
                      {folders.map(f => (
                        <Button key={f} variant="outline" className="w-full justify-start gap-2" onClick={() => handleBulkMove(f)}>
                          <FolderOpen className="w-4 h-4" />{f}
                        </Button>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" title="תצוגה">
                  {viewMode === 'cards' ? <LayoutGrid className="w-4 h-4" /> : viewMode === 'table' ? <Table2 className="w-4 h-4" /> : viewMode === 'rectangles' ? <RectangleHorizontal className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>תצוגה</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={viewMode === 'cards' ? 'bg-accent' : ''} onClick={() => setViewMode('cards')}>
                  <LayoutGrid className="w-4 h-4 ml-2" />כרטיסיות
                </DropdownMenuItem>
                <DropdownMenuItem className={viewMode === 'table' ? 'bg-accent' : ''} onClick={() => setViewMode('table')}>
                  <Table2 className="w-4 h-4 ml-2" />טבלה
                </DropdownMenuItem>
                <DropdownMenuItem className={viewMode === 'rectangles' ? 'bg-accent' : ''} onClick={() => setViewMode('rectangles')}>
                  <RectangleHorizontal className="w-4 h-4 ml-2" />מלבנים
                </DropdownMenuItem>
                <DropdownMenuItem className={viewMode === 'grid' ? 'bg-accent' : ''} onClick={() => setViewMode('grid')}>
                  <Grid3X3 className="w-4 h-4 ml-2" />רשת
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => handleExportFolderZip(selectedFolder)} disabled={isExportingZip}>
              {isExportingZip ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Download className="w-4 h-4 ml-1" />}
              ייצוא ZIP
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowNewFolder(true)}>
              <FolderPlus className="w-4 h-4 ml-1" />תיקיה חדשה
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* New Folder Input */}
        {showNewFolder && (
          <div className="flex gap-2">
            <Input placeholder="שם התיקיה..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} className="text-right" dir="rtl" autoFocus />
            <Button size="sm" onClick={handleCreateFolder}>צור</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(false)}>ביטול</Button>
          </div>
        )}

        <div className="rounded-xl border bg-card/60 p-3 space-y-3">
          {/* Search + Sort + Category */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="חפש תמלולים..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="pr-10 text-right" dir="rtl" />
            </div>
            <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[130px]">
                <ArrowUpDown className="w-3 h-3 ml-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">תאריך</SelectItem>
                <SelectItem value="title">שם</SelectItem>
                <SelectItem value="length">אורך</SelectItem>
                <SelectItem value="engine">מנוע</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" onClick={() => setSortAsc(!sortAsc)} title={sortAsc ? 'א → ת' : 'ת → א'} className="gap-0.5 w-auto px-2">
              {sortAsc ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
              <span className="text-[10px] font-medium">{sortAsc ? 'א→ת' : 'ת→א'}</span>
            </Button>
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <Filter className="w-3.5 h-3.5" />
                  {selectedCategory ? CATEGORIES.find(c => c.value === selectedCategory)?.label : 'קטגוריות'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>קטגוריות</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={!selectedCategory ? 'bg-accent' : ''} onClick={() => setSelectedCategory(null)}>
                  הכל
                </DropdownMenuItem>
                {CATEGORIES.map(cat => (
                  <DropdownMenuItem key={cat.value} className={selectedCategory === cat.value ? 'bg-accent' : ''}
                    onClick={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}>
                    <cat.icon className="w-4 h-4 ml-2" />{cat.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedCategory && (
              <Badge variant="default" className="cursor-pointer gap-1" onClick={() => setSelectedCategory(null)}>
                {CATEGORIES.find(c => c.value === selectedCategory)?.label}
                <X className="w-3 h-3" />
              </Badge>
            )}
          </div>

          {/* Folders row */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Badge variant={showFavoritesOnly ? "default" : "outline"} className="cursor-pointer gap-1 shrink-0"
              onClick={() => { setShowFavoritesOnly(!showFavoritesOnly); }}>
              <Star className="w-3 h-3" />מועדפים
            </Badge>
            <Badge variant={selectedFolder === null && !showFavoritesOnly ? "default" : "outline"} className="cursor-pointer shrink-0"
              onClick={() => { setSelectedFolder(null); setShowFavoritesOnly(false); }}>
              הכל ({transcripts.length})
            </Badge>
            <Badge variant={selectedFolder === '' ? "default" : "outline"} className="cursor-pointer shrink-0"
              onClick={() => setSelectedFolder('')}>
              ללא תיקיה ({unfolderedCount})
            </Badge>
            {folders.map(folder => {
              const count = transcripts.filter(t => t.folder === folder).length;
              return (
                <div key={folder} className="relative group inline-flex shrink-0">
                  <Badge variant={selectedFolder === folder ? "default" : "outline"} className="cursor-pointer gap-1"
                    onClick={() => setSelectedFolder(folder)}>
                    <FolderOpen className="w-3 h-3" />{folder} ({count})
                  </Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder); }}
                    className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px] transition-opacity"
                    title="מחק תיקיה"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tags filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-xs text-muted-foreground">תגיות:</span>
            {allTags.map(tag => (
              <Badge key={tag} variant={selectedTag === tag ? "default" : "secondary"}
                className="cursor-pointer text-xs" onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}>
                {tag}
                {selectedTag === tag && <X className="w-2 h-2 mr-1" />}
              </Badge>
            ))}
          </div>
        )}

        {/* Transcript list */}
        <ScrollArea className="h-[400px]">
          {viewMode === 'table' ? (
            <div className="rounded-lg border overflow-hidden" dir="rtl">
              <table className="w-full text-sm" dir="rtl">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">שם</th>
                    <th className="text-right px-3 py-2 font-medium">מנוע</th>
                    <th className="text-right px-3 py-2 font-medium">תיקיה</th>
                    <th className="text-right px-3 py-2 font-medium">תאריך</th>
                    <th className="text-right px-3 py-2 font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTranscripts.map(t => (
                    <tr key={t.id} className="border-t hover:bg-accent/30">
                      <td className="px-3 py-2 text-right max-w-[280px] truncate">{t.title || t.text.substring(0, 55)}</td>
                      <td className="px-3 py-2 text-right">{t.engine}</td>
                      <td className="px-3 py-2 text-right">{t.folder || 'ללא'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatDate(t.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/text-editor', { state: { text: t.edited_text || t.text, transcriptId: t.id, audioFilePath: t.audio_file_path } })}>
                            ערוך
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => onDelete(t.id)}>
                            מחק
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTranscripts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>אין תמלולים {selectedFolder ? `בתיקיה "${selectedFolder}"` : ''}</p>
                </div>
              )}
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
              {filteredTranscripts.map(t => (
                <TranscriptItem
                  key={t.id}
                  t={t}
                  isSelected={selectedIds.has(t.id)}
                  onToggleSelect={() => toggleSelect(t.id)}
                  onToggleFavorite={() => onUpdate(t.id, { is_favorite: !t.is_favorite })}
                  onCategoryChange={(cat) => onUpdate(t.id, { category: cat })}
                  editingTitleId={editingTitleId}
                  editingTitle={editingTitle}
                  onStartEditTitle={() => { setEditingTitleId(t.id); setEditingTitle(t.title || ''); }}
                  onEditTitleChange={setEditingTitle}
                  onSaveTitle={() => saveTitle(t.id)}
                  onCancelEditTitle={() => setEditingTitleId(null)}
                  editingNotesId={editingNotesId}
                  editingNotes={editingNotes}
                  onStartEditNotes={() => { setEditingNotesId(t.id); setEditingNotes(t.notes || ''); }}
                  onEditNotesChange={setEditingNotes}
                  onSaveNotes={() => saveNotes(t.id)}
                  onCancelEditNotes={() => setEditingNotesId(null)}
                  addingTagId={addingTagId}
                  newTagInput={newTagInput}
                  allTags={allTags}
                  onStartAddTag={() => { setAddingTagId(t.id); setNewTagInput(''); }}
                  onNewTagChange={setNewTagInput}
                  onAddTag={() => addTag(t.id, t.tags || [])}
                  onRemoveTag={(tag) => removeTag(t.id, t.tags || [], tag)}
                  onCancelAddTag={() => setAddingTagId(null)}
                  onNavigateEdit={() => navigate('/text-editor', { state: { text: t.edited_text || t.text, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                  onNavigateDiarization={() => navigate('/diarization', { state: { text: t.edited_text || t.text, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                  onDelete={() => onDelete(t.id)}
                  movingId={movingId}
                  setMovingId={setMovingId}
                  folders={folders}
                  onMoveToFolder={(folder) => handleMoveToFolder(t.id, folder)}
                  onGetAudioUrl={onGetAudioUrl}
                  formatDate={formatDate}
                  getCategoryLabel={getCategoryLabel}
                  viewMode={viewMode}
                />
              ))}
              {filteredTranscripts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground col-span-2">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>אין תמלולים {selectedFolder ? `בתיקיה "${selectedFolder}"` : ''}</p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

// Extracted sub-component for each transcript item
interface TranscriptItemProps {
  t: CloudTranscript;
  isSelected: boolean;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
  onCategoryChange: (cat: string) => void;
  editingTitleId: string | null;
  editingTitle: string;
  onStartEditTitle: () => void;
  onEditTitleChange: (v: string) => void;
  onSaveTitle: () => void;
  onCancelEditTitle: () => void;
  editingNotesId: string | null;
  editingNotes: string;
  onStartEditNotes: () => void;
  onEditNotesChange: (v: string) => void;
  onSaveNotes: () => void;
  onCancelEditNotes: () => void;
  addingTagId: string | null;
  newTagInput: string;
  allTags: string[];
  onStartAddTag: () => void;
  onNewTagChange: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onCancelAddTag: () => void;
  onNavigateEdit: () => void;
  onNavigateDiarization: () => void;
  onDelete: () => void;
  movingId: string | null;
  setMovingId: (id: string | null) => void;
  folders: string[];
  onMoveToFolder: (folder: string) => void;
  onGetAudioUrl?: (filePath: string) => Promise<string | null>;
  formatDate: (d: string) => string;
  getCategoryLabel: (v: string) => string;
  viewMode: ViewMode;
}

const TranscriptItem = ({
  t, isSelected, onToggleSelect, onToggleFavorite, onCategoryChange,
  editingTitleId, editingTitle, onStartEditTitle, onEditTitleChange, onSaveTitle, onCancelEditTitle,
  editingNotesId, editingNotes, onStartEditNotes, onEditNotesChange, onSaveNotes, onCancelEditNotes,
  addingTagId, newTagInput, allTags, onStartAddTag, onNewTagChange, onAddTag, onRemoveTag, onCancelAddTag,
  onNavigateEdit, onNavigateDiarization, onDelete, movingId, setMovingId, folders, onMoveToFolder, onGetAudioUrl,
  formatDate, getCategoryLabel, viewMode
}: TranscriptItemProps) => {
  const [playingAudio, setPlayingAudio] = useState<HTMLAudioElement | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [handlesOpen, setHandlesOpen] = useState(false);
  const rawTitle = (t.title ?? '').trim();
  const previewText = (t.text ?? '').trim();
  const displayTitle = rawTitle || previewText.substring(0, 60) || 'ללא כותרת';
  const shouldShowPreview =
    viewMode !== 'rectangles' &&
    previewText.length > 0 &&
    !isDuplicatePreview(displayTitle, previewText);

  const handlePlayAudio = async () => {
    if (playingAudio) {
      playingAudio.pause();
      setPlayingAudio(null);
      return;
    }
    if (!t.audio_file_path || !onGetAudioUrl) return;
    setIsLoadingAudio(true);
    try {
      const url = await onGetAudioUrl(t.audio_file_path);
      if (!url) throw new Error('No URL');
      const audio = new Audio(url);
      audio.onended = () => setPlayingAudio(null);
      await audio.play();
      setPlayingAudio(audio);
    } catch {
      toast({ title: 'שגיאה בהפעלת אודיו', variant: 'destructive' });
    } finally {
      setIsLoadingAudio(false);
    }
  };

  return (
    <div dir="rtl" className={`group relative p-3 rounded-lg border hover:bg-accent/50 transition-colors text-right ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
      <Dialog open={handlesOpen} onOpenChange={setHandlesOpen}>
        <DialogTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="absolute left-2 top-2 z-10 h-7 w-7 rounded-full border bg-background/90 backdrop-blur-sm"
            title="פתח הנדלים"
            onClick={(e) => e.stopPropagation()}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>הנדלים ופרטי תמלול</DialogTitle>
          </DialogHeader>

          <div className="max-h-[68vh] overflow-y-auto pr-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">{t.engine}</Badge>
              <span>{formatDate(t.created_at)}</span>
              {t.folder ? <Badge variant="secondary" className="text-xs">{t.folder}</Badge> : null}
              {t.category ? <Badge variant="secondary" className="text-xs">{getCategoryLabel(t.category)}</Badge> : null}
              {t.audio_file_path ? <Badge variant="outline" className="text-xs">אודיו</Badge> : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-right">{displayTitle}</p>
              <p className="text-sm text-muted-foreground leading-7 whitespace-pre-wrap break-words text-right">
                {(t.text ?? '').trim() || 'אין תוכן להצגה'}
              </p>
            </div>

            {t.tags && t.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.tags.map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}

            <div className="border-t pt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              {t.audio_file_path && onGetAudioUrl && (
                <Button size="sm" variant={playingAudio ? "default" : "outline"} className="text-xs"
                  onClick={async (e) => { e.stopPropagation(); await handlePlayAudio(); }}
                  disabled={isLoadingAudio}
                >
                  {isLoadingAudio ? <Loader2 className="w-3 h-3 ml-1 animate-spin" /> : playingAudio ? <Pause className="w-3 h-3 ml-1" /> : <Play className="w-3 h-3 ml-1" />}
                  {playingAudio ? 'עצור' : 'נגן'}
                </Button>
              )}
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { onNavigateEdit(); setHandlesOpen(false); }}>
                <Edit className="w-3 h-3 ml-1" />ערוך
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { onNavigateDiarization(); setHandlesOpen(false); }}>
                <Users className="w-3 h-3 ml-1" />דוברים
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => { onStartEditNotes(); setHandlesOpen(false); }}>
                <StickyNote className="w-3 h-3 ml-1" />הערה
              </Button>
              <Button size="sm" variant="ghost" className="text-xs text-destructive hover:text-destructive" onClick={() => { onDelete(); setHandlesOpen(false); }}>
                <Trash2 className="w-3 h-3 ml-1" />מחק
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Top row */}
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} />
          <button onClick={onToggleFavorite} className="hover:scale-110 transition-transform">
            {t.is_favorite
              ? <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              : <StarOff className="w-4 h-4 text-muted-foreground" />}
          </button>
          <Badge
            variant="outline"
            className="text-xs md:opacity-0 md:max-w-0 md:px-0 md:overflow-hidden md:border-transparent md:group-hover:opacity-100 md:group-hover:max-w-[220px] md:group-hover:px-2.5 md:group-hover:border-border md:group-focus-within:opacity-100 md:group-focus-within:max-w-[220px] md:group-focus-within:px-2.5 md:group-focus-within:border-border md:transition-all md:duration-150"
          >
            {t.engine}
          </Badge>
          {t.folder && (
            <Badge variant="secondary" className="text-xs gap-1">
              <FolderOpen className="w-3 h-3" />{t.folder}
            </Badge>
          )}
          {t.category && (
            <Badge variant="secondary" className="text-xs">{getCategoryLabel(t.category)}</Badge>
          )}
          {t.audio_file_path && (
            <Badge
              variant="outline"
              className="text-xs gap-1 md:opacity-0 md:max-w-0 md:px-0 md:overflow-hidden md:border-transparent md:group-hover:opacity-100 md:group-hover:max-w-[90px] md:group-hover:px-2.5 md:group-hover:border-border md:group-focus-within:opacity-100 md:group-focus-within:max-w-[90px] md:group-focus-within:px-2.5 md:group-focus-within:border-border md:transition-all md:duration-150"
            >
              <Volume2 className="w-3 h-3" />אודיו
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(t.created_at)}</span>
      </div>

      {/* Title - inline editable */}
      {editingTitleId === t.id ? (
        <div className="flex gap-1 mb-1">
          <Input value={editingTitle} onChange={e => onEditTitleChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveTitle(); if (e.key === 'Escape') onCancelEditTitle(); }}
            className="h-7 text-sm text-right" dir="rtl" autoFocus />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onSaveTitle}><Check className="w-3 h-3" /></Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCancelEditTitle}><X className="w-3 h-3" /></Button>
        </div>
      ) : (
        <p className="text-sm font-medium truncate mb-1 cursor-pointer hover:text-primary text-right"
          onDoubleClick={onStartEditTitle}>
          {displayTitle}
        </p>
      )}

      {shouldShowPreview && (
        <p className="text-xs text-muted-foreground line-clamp-1 mb-1">{previewText.substring(0, 100)}</p>
      )}

      {/* Notes inline */}
      {editingNotesId === t.id ? (
        <div className="flex gap-1 mb-1">
          <Input value={editingNotes} onChange={e => onEditNotesChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveNotes(); if (e.key === 'Escape') onCancelEditNotes(); }}
            placeholder="הערות..." className="h-7 text-xs text-right" dir="rtl" autoFocus />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onSaveNotes}><Check className="w-3 h-3" /></Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCancelEditNotes}><X className="w-3 h-3" /></Button>
        </div>
      ) : t.notes && viewMode !== 'rectangles' ? (
        <p className="text-xs text-muted-foreground italic cursor-pointer hover:text-foreground mb-1"
          onDoubleClick={onStartEditNotes}>
          <StickyNote className="w-3 h-3 inline ml-1" />{t.notes}
        </p>
      ) : null}

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-2">
        {t.tags?.map((tag, i) => (
          <Badge key={i} variant="secondary" className="text-xs gap-1 group">
            {tag}
            <button onClick={() => onRemoveTag(tag)} className="opacity-0 group-hover:opacity-100 transition-opacity">
              <X className="w-2 h-2" />
            </button>
          </Badge>
        ))}
        {viewMode !== 'rectangles' && addingTagId === t.id ? (
          <div className="flex gap-1 items-center">
            <Input value={newTagInput} onChange={e => onNewTagChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onAddTag(); if (e.key === 'Escape') onCancelAddTag(); }}
              placeholder="תגית..." className="h-6 w-20 text-xs" dir="rtl" autoFocus
              list={`tags-${t.id}`} />
            <datalist id={`tags-${t.id}`}>
              {allTags.filter(tag => !t.tags?.includes(tag)).map(tag => <option key={tag} value={tag} />)}
            </datalist>
            <Button size="sm" variant="ghost" className="h-6 px-1" onClick={onAddTag}><Check className="w-3 h-3" /></Button>
          </div>
        ) : viewMode !== 'rectangles' ? (
          <button onClick={onStartAddTag} className="text-xs text-muted-foreground hover:text-primary">
            <Tag className="w-3 h-3 inline" /> +
          </button>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex gap-1 flex-wrap flex-row-reverse md:opacity-0 md:max-h-0 md:overflow-hidden md:pointer-events-none md:group-hover:opacity-100 md:group-hover:max-h-24 md:group-hover:pointer-events-auto md:group-focus-within:opacity-100 md:group-focus-within:max-h-24 md:group-focus-within:pointer-events-auto md:transition-all md:duration-150">
        {t.audio_file_path && onGetAudioUrl && (
          <Button size="sm" variant={playingAudio ? "default" : "outline"} className="text-xs h-7" onClick={handlePlayAudio} disabled={isLoadingAudio}>
            {isLoadingAudio ? <Loader2 className="w-3 h-3 ml-1 animate-spin" /> : playingAudio ? <Pause className="w-3 h-3 ml-1" /> : <Play className="w-3 h-3 ml-1" />}
            {playingAudio ? 'עצור' : 'נגן'}
          </Button>
        )}
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={onNavigateEdit}>
          <Edit className="w-3 h-3 ml-1" />ערוך
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={onNavigateDiarization} title="זיהוי דוברים">
          <Users className="w-3 h-3 ml-1" />דוברים
        </Button>
        {viewMode !== 'rectangles' && (
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={onStartEditNotes}>
            <StickyNote className="w-3 h-3 ml-1" />הערה
          </Button>
        )}
        {/* Category dropdown */}
        {viewMode !== 'rectangles' && (
          <Select value={t.category || 'none'} onValueChange={v => onCategoryChange(v === 'none' ? '' : v)}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue placeholder="קטגוריה" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ללא</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {/* Move */}
        {viewMode !== 'rectangles' && (
          <Dialog open={movingId === t.id} onOpenChange={o => setMovingId(o ? t.id : null)}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-xs h-7">
                <FolderOpen className="w-3 h-3 ml-1" />העבר
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-sm">
              <DialogHeader><DialogTitle>העבר לתיקיה</DialogTitle></DialogHeader>
              <div className="space-y-2 py-2">
                <Button variant="outline" className="w-full justify-start" onClick={() => onMoveToFolder('')}>ללא תיקיה</Button>
                {folders.map(f => (
                  <Button key={f} variant={t.folder === f ? "default" : "outline"} className="w-full justify-start gap-2"
                    onClick={() => onMoveToFolder(f)}>
                    <FolderOpen className="w-4 h-4" />{f}
                  </Button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}
        <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};
