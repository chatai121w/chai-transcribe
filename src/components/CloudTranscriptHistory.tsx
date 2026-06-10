import { useState, useMemo, useEffect, memo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Trash2, FileText, Search, Tag, X, Edit, Cloud, HardDrive, Loader2, Calendar, Filter, FolderOpen, FolderPlus, Folder, Download, Brain } from "lucide-react";
import type { CloudTranscript } from "@/hooks/useCloudTranscripts";
import { semanticSearch } from "@/utils/semanticSearch";
import { useFolderTree } from "@/hooks/useFolderTree";
import { toast } from "@/hooks/use-toast";

interface CloudTranscriptHistoryProps {
  transcripts: CloudTranscript[];
  isCloud: boolean;
  isLoading: boolean;
  onSelect: (text: string) => void;
  onClearAll: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<CloudTranscript, 'tags' | 'notes' | 'title' | 'folder' | 'folder_id'>>) => void;
  initialFolderFilter?: string;
}

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

export const CloudTranscriptHistory = memo(({
  transcripts,
  isCloud,
  isLoading,
  onSelect,
  onClearAll,
  onDelete,
  onUpdate,
  initialFolderFilter,
}: CloudTranscriptHistoryProps) => {
  const navigate = useNavigate();
  const { folders: fileManagerFolders, createFolder } = useFolderTree();
  const [searchQuery, setSearchQuery] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>(initialFolderFilter || "all");
  const [showFilters, setShowFilters] = useState(false);
  const [useSemanticSearch, setUseSemanticSearch] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [assigningFolderId, setAssigningFolderId] = useState<string | null>(null);

  // Sync folder filter from URL when it changes
  useEffect(() => {
    if (initialFolderFilter !== undefined) {
      setFolderFilter(initialFolderFilter);
    }
  }, [initialFolderFilter]);

  // Get unique engines for filter
  const engines = useMemo(() => 
    [...new Set(transcripts.map(t => t.engine))],
    [transcripts]
  );

  // Get unique folders from transcript metadata
  const historyFolders = useMemo(() =>
    [...new Set(transcripts.map(t => t.folder).filter(f => f && f.trim() !== ''))].sort(),
    [transcripts]
  );

  const folderOptions = useMemo(() => {
    const byName = new Map<string, { id: string | null; name: string }>();
    fileManagerFolders.forEach((f) => byName.set(f.name, { id: f.id, name: f.name }));
    historyFolders.forEach((name) => {
      if (!byName.has(name)) byName.set(name, { id: null, name });
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [fileManagerFolders, historyFolders]);

  // Filter by date range
  const getDateThreshold = (filter: string): Date | null => {
    const now = new Date();
    switch (filter) {
      case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
      case 'month': { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
      default: return null;
    }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const dateThreshold = getDateThreshold(dateFilter);

    let result = transcripts.filter(t => {
      const matchesSearch = !q || !useSemanticSearch && (
        t.text.toLowerCase().includes(q) ||
        t.engine.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.tags?.some(tag => tag.toLowerCase().includes(q)));
      const matchesEngine = engineFilter === "all" || t.engine === engineFilter;
      const matchesDate = !dateThreshold || new Date(t.created_at) >= dateThreshold;
      const matchesFolder = folderFilter === "all" || 
        (folderFilter === "__none__" ? (!t.folder || t.folder.trim() === '') : t.folder === folderFilter);
      return (useSemanticSearch ? true : matchesSearch) && matchesEngine && matchesDate && matchesFolder;
    });

    // Apply semantic search reranking
    if (useSemanticSearch && q.length >= 2) {
      const docs = result.map(t => `${t.title} ${t.text}`);
      const ranked = semanticSearch(q, docs, result.length, 0.01);
      result = ranked.map(r => result[r.index]);
    }

    return result;
  }, [transcripts, searchQuery, engineFilter, dateFilter, folderFilter, useSemanticSearch]);

  if (transcripts.length === 0 && !isLoading) return null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };




  // Highlight search matches in text
  const highlightText = (text: string | null | undefined, query: string, maxLen: number = 200) => {
    const safeText = text ?? '';
    const truncated = safeText.substring(0, maxLen);
    if (!query || query.length < 2) return truncated + (safeText.length > maxLen ? '...' : '');

    const idx = safeText.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return truncated + (safeText.length > maxLen ? '...' : '');
    
    // Show context around the match
    const start = Math.max(0, idx - 60);
    const end = Math.min(safeText.length, idx + query.length + 60);
    const snippet = (start > 0 ? '...' : '') + safeText.substring(start, end) + (end < safeText.length ? '...' : '');
    
    // Bold the match
    const parts = snippet.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">{part}</mark> 
        : part
    );
  };

  const handleAddTag = (id: string, tag: string) => {
    if (!tag.trim()) return;
    const transcript = transcripts.find(t => t.id === id);
    if (!transcript) return;
    const tags = transcript.tags || [];
    if (!tags.includes(tag.trim())) {
      onUpdate(id, { tags: [...tags, tag.trim()] });
    }
    setNewTag("");
    setEditingTagId(null);
  };

  const handleRemoveTag = (id: string, tagToRemove: string) => {
    const transcript = transcripts.find(t => t.id === id);
    if (!transcript) return;
    onUpdate(id, { tags: (transcript.tags || []).filter(t => t !== tagToRemove) });
  };

  const activeFilters = (engineFilter !== "all" ? 1 : 0) + (dateFilter !== "all" ? 1 : 0) + (folderFilter !== "all" ? 1 : 0);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;

    let folderId: string | null = null;
    const existing = fileManagerFolders.find((f) => f.name === name);
    if (existing) {
      folderId = existing.id;
    } else {
      try {
        const created = await createFolder({ name });
        folderId = created.id;
      } catch (e: any) {
        toast({ title: 'שגיאה ביצירת תיקיה', description: e?.message || 'נסה שוב', variant: 'destructive' });
        return;
      }
    }

    setShowNewFolder(false);
    if (assigningFolderId) {
      onUpdate(assigningFolderId, { folder: name, folder_id: folderId });
      setAssigningFolderId(null);
    }
    setNewFolderName("");
  };

  const handleAssignFolder = (id: string, folder: string, folderId: string | null = null) => {
    onUpdate(id, { folder, folder_id: folderId });
    setAssigningFolderId(null);
  };

  const handleCardClick = (entry: CloudTranscript) => {
    navigate('/text-editor', { state: {
      text: entry.edited_text || entry.text,
      wordTimings: entry.word_timings || undefined,
      transcriptId: entry.id,
      audioFilePath: entry.audio_file_path || undefined,
    } });
  };

  const renderEntryCard = (entry: CloudTranscript, key?: string) => (
    (() => {
      const displayTitle = (entry.title ?? '').trim();
      const previewText = (entry.text ?? '').trim();
      const showTitle = displayTitle.length > 0;
      const showPreview = previewText.length > 0 && (!showTitle || !isDuplicatePreview(displayTitle, previewText));

      return (
    <div
      key={key}
      className="group p-4 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-accent/30 hover:shadow-md transition-all duration-200 text-right cursor-pointer"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
      onClick={() => handleCardClick(entry)}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className="text-[10px] font-medium px-2 py-0.5">
          {entry.engine}
        </Badge>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
        </div>
      </div>

      {showTitle && (
        <p className="text-sm font-semibold mb-1.5 text-right text-foreground">{displayTitle}</p>
      )}

      {showPreview && (
        <p className="text-sm line-clamp-2 text-right text-muted-foreground leading-relaxed mb-3">
          {highlightText(previewText, searchQuery)}
        </p>
      )}

      {/* Action icons row - stop propagation so clicking icons doesn't navigate */}
      <div className="flex items-center gap-1.5 pt-2 border-t border-border/40" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 rounded-lg hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
          onClick={() => handleCardClick(entry)}
          title="ערוך"
        >
          <Edit className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 rounded-lg hover:bg-muted transition-colors"
          onClick={() => onSelect(entry.text)}
          title="טען"
        >
          <FileText className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-lg hover:bg-muted transition-colors"
          onClick={() => {
            setEditingTagId(editingTagId === entry.id ? null : entry.id);
            setNewTag("");
          }}
          title="הוסף תגית"
        >
          <Tag className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-lg hover:bg-muted transition-colors"
          onClick={() => {
            setAssigningFolderId(assigningFolderId === entry.id ? null : entry.id);
            setShowNewFolder(false);
          }}
          title="שייך לתיקיה"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={() => onDelete(entry.id)}
          title="מחק"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {entry.folder && entry.folder.trim() !== '' && (
        <div className="mt-1">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Folder className="w-2.5 h-2.5" />
            {entry.folder}
            <X
              className="w-2.5 h-2.5 cursor-pointer hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(entry.id, { folder: '', folder_id: null });
              }}
            />
          </Badge>
        </div>
      )}

      {assigningFolderId === entry.id && (
        <div className="mt-2 p-2 rounded border bg-background space-y-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {folderOptions.map(f => (
            <Button
              key={f.id || f.name}
              variant={(entry.folder_id && entry.folder_id === f.id) || entry.folder === f.name ? "default" : "ghost"}
              size="sm"
              className="w-full justify-start text-xs h-7 gap-1"
              onClick={(e) => {
                e.stopPropagation();
                handleAssignFolder(entry.id, f.name, f.id);
              }}
            >
              <Folder className="w-3 h-3" />
              {f.name}
            </Button>
          ))}
          {entry.folder && entry.folder.trim() !== '' && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs h-7 gap-1 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleAssignFolder(entry.id, '', null);
              }}
            >
              <X className="w-3 h-3" />
              הסר מתיקיה
            </Button>
          )}
          {showNewFolder ? (
            <div className="flex gap-1 mt-1">
              <Input
                placeholder="שם תיקיה..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleCreateFolder();
                  }
                }}
                className="text-xs h-7"
                dir="rtl"
                autoFocus
              />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => {
                e.stopPropagation();
                void handleCreateFolder();
              }}>
                צור
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs h-7 gap-1"
              onClick={(e) => {
                e.stopPropagation();
                setShowNewFolder(true);
              }}
            >
              <FolderPlus className="w-3 h-3" />
              תיקיה חדשה...
            </Button>
          )}
        </div>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.tags.map((tag, tagIndex) => (
            <Badge key={tagIndex} variant="secondary" className="text-xs">
              {tag}
              <X
                className="w-3 h-3 mr-1 cursor-pointer hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(entry.id, tag);
                }}
              />
            </Badge>
          ))}
        </div>
      )}

      {editingTagId === entry.id && (
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="הוסף תגית..."
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTag(entry.id, newTag);
            }}
            className="text-xs h-7 text-right"
            dir="rtl"
            autoFocus
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => handleAddTag(entry.id, newTag)}
          >
            הוסף
          </Button>
        </div>
      )}
    </div>
      );
    })()
  );

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-right">
            היסטוריית תמלולים ({filtered.length}/{transcripts.length})
          </h2>
          {isCloud ? (
            <Badge variant="secondary" className="text-xs gap-1">
              <Cloud className="w-3 h-3" /> ענן
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1">
              <HardDrive className="w-3 h-3" /> מקומי
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onClearAll}>
          <Trash2 className="w-4 h-4 ml-2" />
          נקה הכל
        </Button>
        <Button variant="outline" size="sm" onClick={async () => {
          if (filtered.length === 0) return;
          const JSZip = (await import("jszip")).default;
          const { saveAs } = await import("file-saver");
          const zip = new JSZip();
          for (const t of filtered) {
            const safeName = (t.title || 'תמלול').replace(/[/\\?%*:|"<>]/g, '_');
            const content = JSON.stringify({
              title: t.title,
              text: t.text,
              engine: t.engine,
              folder: t.folder,
              tags: t.tags,
              notes: t.notes,
              createdAt: t.created_at,
            }, null, 2);
            zip.file(`${safeName}-${t.id.slice(0, 8)}.json`, content);
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          saveAs(blob, `transcripts-${Date.now()}.zip`);
        }}>
          <Download className="w-4 h-4 ml-2" />
          ייצוא ZIP ({filtered.length})
        </Button>
      </div>

      {/* Search + Filter toggle */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="חפש בתמלולים (טקסט, כותרת, תגית, מנוע)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10 text-right"
            dir="rtl"
          />
        </div>
        <Button
          variant={useSemanticSearch ? "default" : "outline"}
          size="icon"
          onClick={() => setUseSemanticSearch(!useSemanticSearch)}
          title={useSemanticSearch ? "חיפוש סמנטי פעיל" : "הפעל חיפוש סמנטי"}
        >
          <Brain className="w-4 h-4" />
        </Button>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="icon"
          onClick={() => setShowFilters(!showFilters)}
          title="סינון"
        >
          <Filter className="w-4 h-4" />
          {activeFilters > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full text-[10px] flex items-center justify-center">
              {activeFilters}
            </span>
          )}
        </Button>
      </div>

      {/* Filters row */}
      {showFilters && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <Select value={engineFilter} onValueChange={setEngineFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="כל המנועים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המנועים</SelectItem>
              {engines.map(e => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <Calendar className="w-3 h-3 ml-1" />
              <SelectValue placeholder="כל הזמנים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הזמנים</SelectItem>
              <SelectItem value="today">היום</SelectItem>
              <SelectItem value="week">שבוע אחרון</SelectItem>
              <SelectItem value="month">חודש אחרון</SelectItem>
            </SelectContent>
          </Select>

          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEngineFilter("all"); setDateFilter("all"); setFolderFilter("all"); }}>
              <X className="w-3 h-3 ml-1" />
              נקה סינון
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="mr-2 text-muted-foreground">טוען תמלולים...</span>
        </div>
      ) : (
        <div className="flex gap-3">
          {/* Folder sidebar */}
          {historyFolders.length > 0 && (
            <div className="w-36 shrink-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">תיקיות</p>
              <Button
                variant={folderFilter === "all" ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start text-xs h-7 gap-1"
                onClick={() => setFolderFilter("all")}
              >
                <FolderOpen className="w-3 h-3" />
                הכל ({transcripts.length})
              </Button>
              <Button
                variant={folderFilter === "__none__" ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start text-xs h-7 gap-1"
                onClick={() => setFolderFilter("__none__")}
              >
                <FileText className="w-3 h-3" />
                ללא תיקיה ({transcripts.filter(t => !t.folder || t.folder.trim() === '').length})
              </Button>
              {historyFolders.map(f => (
                <Button
                  key={f}
                  variant={folderFilter === f ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start text-xs h-7 gap-1 truncate"
                  onClick={() => setFolderFilter(f)}
                  title={f}
                >
                  <Folder className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f}</span>
                  <span className="mr-auto text-[10px] opacity-60">{transcripts.filter(t => t.folder === f).length}</span>
                </Button>
              ))}
            </div>
          )}

          {/* Transcript list */}
          <ScrollArea className="h-[400px] flex-1">
            <div className="space-y-3">
              {filtered.map((entry) => renderEntryCard(entry, entry.id))}
            </div>
          </ScrollArea>
        </div>
      )}
    </Card>
  );
});
