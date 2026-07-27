import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { BookmarkPlus, X, Tag, MessageSquare, Clock, Trash2 } from "lucide-react";
import type { SegmentNote } from "@/utils/diarizationEnhancements";

interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
}

interface DiarizationNotesProps {
  segments: DiarizedSegment[];
  notes: SegmentNote[];
  onNotesChange: (notes: SegmentNote[]) => void;
  speakerNames: Record<string, string>;
  onSeek?: (time: number) => void;
}

const TAG_OPTIONS = [
  { value: 'important', label: '⭐ חשוב', color: 'bg-yellow-500' },
  { value: 'question', label: '❓ שאלה', color: 'bg-blue-500' },
  { value: 'action', label: '✅ משימה', color: 'bg-green-500' },
  { value: 'error', label: '❌ טעות', color: 'bg-red-500' },
  { value: 'quote', label: '💬 ציטוט', color: 'bg-purple-500' },
  { value: 'idea', label: '💡 רעיון', color: 'bg-orange-500' },
  { value: 'follow-up', label: '📌 מעקב', color: 'bg-pink-500' },
  { value: 'custom', label: '🏷️ מותאם', color: 'bg-gray-500' },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DiarizationNotes({ segments, notes, onNotesChange, speakerNames, onSeek }: DiarizationNotesProps) {
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteTag, setNewNoteTag] = useState("important");
  const [selectedSegIdx, setSelectedSegIdx] = useState<number | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const addNote = useCallback(() => {
    if (selectedSegIdx === null || !newNoteText.trim()) return;
    const note: SegmentNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      segmentIdx: selectedSegIdx,
      text: newNoteText.trim(),
      tag: newNoteTag,
      createdAt: Date.now(),
    };
    onNotesChange([...notes, note]);
    setNewNoteText("");
    setSelectedSegIdx(null);
  }, [selectedSegIdx, newNoteText, newNoteTag, notes, onNotesChange]);

  const removeNote = useCallback((noteId: string) => {
    onNotesChange(notes.filter(n => n.id !== noteId));
  }, [notes, onNotesChange]);

  const getName = (sp: string) => speakerNames[sp] || sp;
  const getTagInfo = (tag: string) => TAG_OPTIONS.find(t => t.value === tag) || TAG_OPTIONS[TAG_OPTIONS.length - 1];

  const filteredNotes = filterTag ? notes.filter(n => n.tag === filterTag) : notes;
  const sortedNotes = [...filteredNotes].sort((a, b) => {
    const segA = segments[a.segmentIdx];
    const segB = segments[b.segmentIdx];
    return (segA?.start || 0) - (segB?.start || 0);
  });

  // Group notes by segment
  const notesBySegment = new Map<number, SegmentNote[]>();
  for (const note of sortedNotes) {
    const arr = notesBySegment.get(note.segmentIdx) || [];
    arr.push(note);
    notesBySegment.set(note.segmentIdx, arr);
  }

  return (
    <div className="space-y-4">
      {/* Add note form */}
      <div className="border rounded-xl p-3 space-y-3 bg-muted/20">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <BookmarkPlus className="w-4 h-4 text-primary" />
          הוסף הערה / סימנייה
        </Label>

        {/* Select segment */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">בחר קטע:</Label>
          <div className="max-h-[150px] overflow-y-auto border rounded-lg divide-y">
            {segments.slice(0, 100).map((seg, i) => (
              <button
                key={i}
                className={`w-full text-right p-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                  selectedSegIdx === i ? 'bg-primary/10 font-medium' : ''
                }`}
                onClick={() => setSelectedSegIdx(selectedSegIdx === i ? null : i)}
              >
                <span className="text-muted-foreground tabular-nums shrink-0">{formatTime(seg.start)}</span>
                <span className="font-medium shrink-0">{getName(seg.speaker_label)}</span>
                <span className="truncate text-muted-foreground">{seg.text.slice(0, 60)}</span>
                {notes.some(n => n.segmentIdx === i) && (
                  <Badge variant="secondary" className="text-[9px] py-0 mr-auto shrink-0">
                    {notes.filter(n => n.segmentIdx === i).length} 📌
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>

        {selectedSegIdx !== null && (
          <>
            {/* Tag selection */}
            <div className="flex flex-wrap gap-1">
              {TAG_OPTIONS.map(tag => (
                <button
                  key={tag.value}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                    newNoteTag === tag.value ? 'ring-2 ring-primary/40 font-semibold bg-muted' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setNewNoteTag(tag.value)}
                >
                  {tag.label}
                </button>
              ))}
            </div>

            {/* Note text */}
            <div className="flex gap-2">
              <Input
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
                placeholder="הוסף הערה..."
                className="flex-1 text-sm"
                onKeyDown={e => { if (e.key === 'Enter') addNote(); }}
              />
              <Button size="sm" onClick={addNote} disabled={!newNoteText.trim()}>
                <BookmarkPlus className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Filter tags */}
      {notes.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-muted-foreground">סינון:</span>
          <button
            className={`text-[11px] px-2 py-0.5 rounded-full border ${!filterTag ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}
            onClick={() => setFilterTag(null)}
          >
            הכל ({notes.length})
          </button>
          {TAG_OPTIONS.filter(t => notes.some(n => n.tag === t.value)).map(tag => (
            <button
              key={tag.value}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${filterTag === tag.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}
              onClick={() => setFilterTag(filterTag === tag.value ? null : tag.value)}
            >
              {tag.label} ({notes.filter(n => n.tag === tag.value).length})
            </button>
          ))}
        </div>
      )}

      {/* Notes list */}
      {sortedNotes.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">
          <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>אין הערות עדיין</p>
          <p className="text-xs mt-1">בחר קטע מהרשימה למעלה כדי להוסיף הערה</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {Array.from(notesBySegment.entries()).map(([segIdx, segNotes]) => {
            const seg = segments[segIdx];
            if (!seg) return null;
            return (
              <div key={segIdx} className="border rounded-lg p-2.5 space-y-1.5 hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => onSeek?.(seg.start)}
                  >
                    <Clock className="w-3 h-3" />
                    <span className="tabular-nums">{formatTime(seg.start)}</span>
                  </button>
                  <span className="font-medium">{getName(seg.speaker_label)}</span>
                  <span className="text-muted-foreground truncate flex-1">{seg.text.slice(0, 50)}</span>
                </div>
                {segNotes.map(note => {
                  const tagInfo = getTagInfo(note.tag);
                  return (
                    <div key={note.id} className="flex items-start gap-2 text-xs pr-4">
                      <Badge variant="secondary" className={`text-[9px] py-0 shrink-0 ${tagInfo.color} text-white`}>
                        {tagInfo.label}
                      </Badge>
                      <span className="flex-1">{note.text}</span>
                      <button
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeNote(note.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Export notes */}
      {notes.length > 0 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => {
            const text = sortedNotes.map(n => {
              const seg = segments[n.segmentIdx];
              const tagInfo = getTagInfo(n.tag);
              return `[${formatTime(seg?.start || 0)}] [${tagInfo.label}] ${getName(seg?.speaker_label || '')} — ${n.text}`;
            }).join('\n');
            navigator.clipboard.writeText(text);
          }}>
            העתק הערות
          </Button>
          <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={() => onNotesChange([])}>
            <Trash2 className="w-3 h-3 ml-1" />מחק הכל
          </Button>
        </div>
      )}
    </div>
  );
}
