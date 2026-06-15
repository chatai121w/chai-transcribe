import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
}

interface SpeakerHighlightOverlayProps {
  text: string;
  transcriptId: string | null;
}

const SPEAKER_HIGHLIGHT_COLORS = [
  { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.4)", label: "bg-blue-500" },
  { bg: "rgba(34,197,94,0.18)", border: "rgba(34,197,94,0.4)", label: "bg-green-500" },
  { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.4)", label: "bg-purple-500" },
  { bg: "rgba(249,115,22,0.18)", border: "rgba(249,115,22,0.4)", label: "bg-orange-500" },
  { bg: "rgba(236,72,153,0.18)", border: "rgba(236,72,153,0.4)", label: "bg-pink-500" },
  { bg: "rgba(20,184,166,0.18)", border: "rgba(20,184,166,0.4)", label: "bg-teal-500" },
];

export function SpeakerHighlightOverlay({ text, transcriptId }: SpeakerHighlightOverlayProps) {
  const [segments, setSegments] = useState<DiarizedSegment[]>([]);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [speakers, setSpeakers] = useState<string[]>([]);

  useEffect(() => {
    if (!transcriptId) return;
    supabase
      .from("diarization_results")
      .select("segments, speakers, speaker_names")
      .eq("transcript_id", transcriptId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSegments((data.segments as unknown as DiarizedSegment[]) || []);
          setSpeakers((data.speakers as unknown as string[]) || []);
          setSpeakerNames((data.speaker_names as unknown as Record<string, string>) || {});
        }
      });
  }, [transcriptId]);

  // Try to match segments to the current text using fuzzy matching
  const highlightedElements = useMemo(() => {
    if (!segments.length || !text.trim()) {
      return null;
    }

    // Build a mapping: for each segment, find its text position in the current text
    const speakerIndex = (s: string) => speakers.indexOf(s);
    
    // Strategy: split current text into words, match segment words to text words
    const textWords = text.split(/(\s+)/); // preserve whitespace
    let result: { text: string; speaker: string | null }[] = [];
    
    // Create a combined text from segments for matching
    const segTexts = segments.map(s => ({
      words: s.text.trim().split(/\s+/).filter(Boolean),
      speaker: s.speaker,
    }));

    // Simple approach: try to find each segment's words sequentially in the text
    let textPos = 0; // character position in original text
    let lastMatchEnd = 0;

    for (const seg of segTexts) {
      if (!seg.words.length) continue;
      
      // Find the first word of this segment in the remaining text
      const firstWord = seg.words[0];
      const searchStart = lastMatchEnd;
      const searchText = text.substring(searchStart).toLowerCase();
      const wordIdx = searchText.indexOf(firstWord.toLowerCase());
      
      if (wordIdx === -1) continue;
      
      const absStart = searchStart + wordIdx;
      
      // Find end: try to match as many words as possible
      let matchEnd = absStart;
      const segFullText = seg.words.join(" ");
      
      // Try exact match of full segment text
      const remainingText = text.substring(absStart);
      const fullMatchLen = findBestMatch(remainingText, segFullText);
      matchEnd = absStart + fullMatchLen;
      
      // Add unmatched text before this segment
      if (absStart > lastMatchEnd) {
        result.push({ text: text.substring(lastMatchEnd, absStart), speaker: null });
      }
      
      // Add matched segment
      result.push({ text: text.substring(absStart, matchEnd), speaker: seg.speaker });
      lastMatchEnd = matchEnd;
    }

    // Add remaining text
    if (lastMatchEnd < text.length) {
      result.push({ text: text.substring(lastMatchEnd), speaker: null });
    }

    // If no matches found at all, show text as-is
    if (result.every(r => r.speaker === null)) {
      return null;
    }

    return result.map((part, i) => {
      if (!part.speaker) {
        return <span key={i}>{part.text}</span>;
      }
      const idx = speakerIndex(part.speaker) % SPEAKER_HIGHLIGHT_COLORS.length;
      const color = SPEAKER_HIGHLIGHT_COLORS[idx >= 0 ? idx : 0];
      const name = speakerNames[part.speaker] || part.speaker;
      return (
        <span
          key={i}
          style={{
            backgroundColor: color.bg,
            borderBottom: `2px solid ${color.border}`,
            borderRadius: "2px",
            padding: "1px 0",
          }}
          title={name}
        >
          {part.text}
        </span>
      );
    });
  }, [segments, text, speakers, speakerNames]);

  if (!highlightedElements) {
    return (
      <div className="min-h-[300px] mb-4 p-3 bg-background border rounded-md text-right" dir="rtl">
        <p className="text-muted-foreground text-center py-8">
          לא נמצאו תוצאות זיהוי דוברים לתמלול זה.
          <br />
          הפעל זיהוי דוברים תחילה.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="min-h-[300px] mb-2 p-3 bg-background border rounded-md text-right overflow-y-auto max-h-[600px]" dir="rtl">
        <pre className="whitespace-pre-wrap font-mono text-base leading-relaxed">
          {highlightedElements}
        </pre>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground border-t pt-2">
        {speakers.map((speaker, i) => {
          const color = SPEAKER_HIGHLIGHT_COLORS[i % SPEAKER_HIGHLIGHT_COLORS.length];
          const name = speakerNames[speaker] || speaker;
          return (
            <span key={speaker} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
              />
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function findBestMatch(text: string, segText: string): number {
  // Try to find the segment text (or close variant) in the text
  const lowerText = text.toLowerCase();
  const lowerSeg = segText.toLowerCase();
  
  // Exact match
  if (lowerText.startsWith(lowerSeg)) {
    return segText.length;
  }
  
  // Word-by-word matching
  const segWords = segText.split(/\s+/);
  let pos = 0;
  let matchedLen = 0;
  
  for (const word of segWords) {
    const remaining = lowerText.substring(pos);
    const wordIdx = remaining.indexOf(word.toLowerCase());
    if (wordIdx === -1 || wordIdx > 20) break; // too far, stop matching
    pos += wordIdx + word.length;
    matchedLen = pos;
    // Skip whitespace
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    matchedLen = pos;
  }
  
  return matchedLen || segText.length;
}
