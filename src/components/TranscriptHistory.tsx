import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { History, Trash2, FileText, Search, Tag, X, Edit } from "lucide-react";

interface HistoryEntry {
  text: string;
  timestamp: number;
  engine: string;
  tags?: string[];
  notes?: string;
  word_timings?: any[] | null;
}

interface TranscriptHistoryProps {
  history: HistoryEntry[];
  onSelect: (text: string) => void;
  onClear: () => void;
  onUpdateEntry?: (index: number, entry: HistoryEntry) => void;
}

export const TranscriptHistory = ({ history, onSelect, onClear, onUpdateEntry }: TranscriptHistoryProps) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  if (history.length === 0) {
    return null;
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredHistory = history.filter(entry => {
    const searchLower = searchQuery.toLowerCase();
    return (
      entry.text.toLowerCase().includes(searchLower) ||
      entry.engine.toLowerCase().includes(searchLower) ||
      entry.tags?.some(tag => tag.toLowerCase().includes(searchLower)) ||
      entry.notes?.toLowerCase().includes(searchLower)
    );
  });

  const handleAddTag = (index: number, tag: string) => {
    if (!tag.trim() || !onUpdateEntry) return;
    
    const entry = history[index];
    const tags = entry.tags || [];
    
    if (!tags.includes(tag.trim())) {
      onUpdateEntry(index, { ...entry, tags: [...tags, tag.trim()] });
    }
    setNewTag("");
    setEditingIndex(null);
  };

  const handleRemoveTag = (index: number, tagToRemove: string) => {
    if (!onUpdateEntry) return;
    
    const entry = history[index];
    const tags = (entry.tags || []).filter(tag => tag !== tagToRemove);
    onUpdateEntry(index, { ...entry, tags });
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold text-right">היסטוריית תמלולים ({history.length})</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
        >
          <Trash2 className="w-4 h-4 ml-2" />
          נקה הכל
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="חפש בהיסטוריה..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pr-10 text-right"
          dir="rtl"
        />
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-3">
          {filteredHistory.map((entry, index) => {
            const actualIndex = history.indexOf(entry);
            return (
              <div
                key={actualIndex}
                className="p-4 rounded-lg border hover:bg-accent/50 transition-colors text-right"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium">{entry.engine}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</span>
                </div>
                
                <div className="flex items-start gap-2 mb-3">
                  <FileText className="w-4 h-4 mt-1 flex-shrink-0 text-muted-foreground" />
                  <p className="text-sm line-clamp-2 text-right flex-1">
                    {entry.text.substring(0, 200)}...
                  </p>
                </div>

                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => navigate('/text-editor', { state: { text: entry.text, wordTimings: entry.word_timings } })}
                  >
                    <Edit className="w-3 h-3 ml-1" />
                    ערוך
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-xs"
                    onClick={() => onSelect(entry.text)}
                  >
                    <FileText className="w-3 h-3 ml-1" />
                    טען
                  </Button>
                </div>

                {entry.tags && entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {entry.tags.map((tag, tagIndex) => (
                      <Badge key={tagIndex} variant="secondary" className="text-xs">
                        {tag}
                        {onUpdateEntry && (
                          <X
                            className="w-3 h-3 mr-1 cursor-pointer hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveTag(actualIndex, tag);
                            }}
                          />
                        )}
                      </Badge>
                    ))}
                  </div>
                )}

                {onUpdateEntry && editingIndex === actualIndex ? (
                  <div className="flex gap-2 mt-2">
                    <Input
                      placeholder="הוסף תגית..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddTag(actualIndex, newTag);
                        }
                      }}
                      className="text-xs h-7 text-right"
                      dir="rtl"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => handleAddTag(actualIndex, newTag)}
                    >
                      הוסף
                    </Button>
                  </div>
                ) : (
                  onUpdateEntry && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full text-xs mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingIndex(actualIndex);
                        setNewTag("");
                      }}
                    >
                      <Tag className="w-3 h-3 ml-1" />
                      הוסף תגית
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
};
