// ──── Diarization Enhancement Utilities ────
// Pure functions for overlap detection, export formats, punctuation, topics, sentiment

export interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
  words?: Array<{ word: string; start: number; end: number; probability: number }>;
}

export interface DiarizationResult {
  text: string;
  segments: DiarizedSegment[];
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

export interface OverlapRegion {
  start: number;
  end: number;
  speakers: string[];
  duration: number;
}

export interface TopicSegment {
  startIdx: number;
  endIdx: number;
  startTime: number;
  endTime: number;
  keywords: string[];
  summary: string;
}

export interface SegmentNote {
  id: string;
  segmentIdx: number;
  text: string;
  tag: string;
  createdAt: number;
}

// ──── 1. Overlap Detection ────
export function detectOverlaps(segments: DiarizedSegment[], minOverlap = 0.3): OverlapRegion[] {
  const overlaps: OverlapRegion[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].start >= segments[i].end) break; // sorted by start
      if (segments[i].speaker_label === segments[j].speaker_label) continue;
      const overlapStart = Math.max(segments[i].start, segments[j].start);
      const overlapEnd = Math.min(segments[i].end, segments[j].end);
      const duration = overlapEnd - overlapStart;
      if (duration >= minOverlap) {
        const existing = overlaps.find(o =>
          Math.abs(o.start - overlapStart) < 0.5 && Math.abs(o.end - overlapEnd) < 0.5
        );
        if (existing) {
          if (!existing.speakers.includes(segments[j].speaker_label))
            existing.speakers.push(segments[j].speaker_label);
        } else {
          overlaps.push({
            start: overlapStart,
            end: overlapEnd,
            speakers: [segments[i].speaker_label, segments[j].speaker_label],
            duration,
          });
        }
      }
    }
  }
  return overlaps.sort((a, b) => a.start - b.start);
}

// ──── 2. VTT Export ────
export function exportAsVTT(
  segments: DiarizedSegment[],
  speakerNames: Record<string, string>
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fmtVTT = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${ms.toString().padStart(3, '0')}`;
  };
  let vtt = 'WEBVTT\n\n';
  segments.forEach((seg, i) => {
    const name = speakerNames[seg.speaker_label] || seg.speaker_label;
    vtt += `${i + 1}\n`;
    vtt += `${fmtVTT(seg.start)} --> ${fmtVTT(seg.end)}\n`;
    vtt += `<v ${name}>${seg.text}\n\n`;
  });
  return vtt;
}

// ──── 3. ASS Export ────
export function exportAsASS(
  segments: DiarizedSegment[],
  speakerNames: Record<string, string>,
  speakers: string[]
): string {
  const colors = ['&H00FF8800', '&H0000CC00', '&H00FF00FF', '&H000066FF', '&H00FFAA00',
    '&H00AAFF00', '&H0000FFFF', '&H006600FF', '&H0066FFFF', '&H00FF6666'];
  const fmtASS = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.round((sec % 1) * 100);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  };
  let ass = `[Script Info]
Title: Speaker Diarization
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;
  speakers.forEach((sp, i) => {
    const name = (speakerNames[sp] || sp).replace(/,/g, '');
    const color = colors[i % colors.length];
    ass += `Style: ${name},Arial,48,${color},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,20,1\n`;
  });
  ass += `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  segments.forEach(seg => {
    const name = (speakerNames[seg.speaker_label] || seg.speaker_label).replace(/,/g, '');
    ass += `Dialogue: 0,${fmtASS(seg.start)},${fmtASS(seg.end)},${name},${name},0,0,0,,${seg.text}\n`;
  });
  return ass;
}

// ──── 4. Simple Topic Segmentation ────
// Hebrew stop words to ignore
const HE_STOP_WORDS = new Set([
  'את', 'של', 'על', 'עם', 'אני', 'הוא', 'היא', 'הם', 'הן', 'אנחנו', 'אתה', 'אתם',
  'זה', 'זאת', 'אלה', 'כל', 'לא', 'כן', 'גם', 'אם', 'או', 'כי', 'אבל', 'רק', 'עוד',
  'יש', 'אין', 'היה', 'להיות', 'שם', 'פה', 'כאן', 'מה', 'איך', 'למה', 'מתי', 'איפה',
  'אז', 'כבר', 'עכשיו', 'הזה', 'הזאת', 'בין', 'לפני', 'אחרי', 'מאוד', 'קצת', 'הרבה',
  'טוב', 'the', 'a', 'is', 'and', 'or', 'but', 'in', 'to', 'of', 'for', 'that', 'this',
]);

export function detectTopics(segments: DiarizedSegment[], windowSize = 5): TopicSegment[] {
  if (segments.length < windowSize * 2) {
    // Too short — single topic
    return [{
      startIdx: 0, endIdx: segments.length - 1,
      startTime: segments[0]?.start || 0,
      endTime: segments[segments.length - 1]?.end || 0,
      keywords: extractKeywords(segments.map(s => s.text).join(' '), 5),
      summary: '',
    }];
  }

  const getWindowWords = (startIdx: number, size: number): Set<string> => {
    const words = new Set<string>();
    for (let i = startIdx; i < Math.min(startIdx + size, segments.length); i++) {
      segments[i].text.split(/\s+/).forEach(w => {
        const clean = w.replace(/[^\u0590-\u05FFa-zA-Z]/g, '').toLowerCase();
        if (clean.length > 2 && !HE_STOP_WORDS.has(clean)) words.add(clean);
      });
    }
    return words;
  };

  const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 1 : intersection.size / union.size;
  };

  // Find topic boundaries using sliding window similarity
  const boundaries: number[] = [0];
  for (let i = windowSize; i < segments.length - windowSize; i++) {
    const before = getWindowWords(i - windowSize, windowSize);
    const after = getWindowWords(i, windowSize);
    const sim = jaccardSimilarity(before, after);
    if (sim < 0.15) { // Low similarity = topic change
      if (boundaries[boundaries.length - 1] < i - 2) { // Min gap between topics
        boundaries.push(i);
      }
    }
  }
  boundaries.push(segments.length);

  const topics: TopicSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startIdx = boundaries[i];
    const endIdx = boundaries[i + 1] - 1;
    const text = segments.slice(startIdx, endIdx + 1).map(s => s.text).join(' ');
    topics.push({
      startIdx, endIdx,
      startTime: segments[startIdx].start,
      endTime: segments[endIdx].end,
      keywords: extractKeywords(text, 4),
      summary: '',
    });
  }
  return topics;
}

function extractKeywords(text: string, count: number): string[] {
  const freq: Record<string, number> = {};
  text.split(/\s+/).forEach(w => {
    const clean = w.replace(/[^\u0590-\u05FFa-zA-Z]/g, '');
    if (clean.length > 2 && !HE_STOP_WORDS.has(clean.toLowerCase())) {
      freq[clean] = (freq[clean] || 0) + 1;
    }
  });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

// ──── 5. Simple Sentiment Analysis ────
const POSITIVE_HE = new Set(['טוב', 'מעולה', 'נהדר', 'יפה', 'אהבתי', 'מצוין', 'נפלא', 'שמח', 'מרגש', 'מדהים', 'חיובי', 'אוהב', 'מסכים', 'נכון', 'בטח', 'בהחלט', 'כמובן', 'תודה', 'מושלם', 'מקסים']);
const NEGATIVE_HE = new Set(['רע', 'גרוע', 'נורא', 'בעיה', 'שגיאה', 'טעות', 'לא', 'אבל', 'שלילי', 'כועס', 'עצוב', 'מתוסכל', 'מאכזב', 'קשה', 'חבל', 'מפחיד', 'מבאס', 'שונא', 'נגד', 'בלתי']);

export type SentimentType = 'positive' | 'negative' | 'neutral';

export function analyzeSentiment(text: string): { type: SentimentType; score: number } {
  const words = text.split(/\s+/).map(w => w.replace(/[^\u0590-\u05FF]/g, ''));
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE_HE.has(w)) pos++;
    if (NEGATIVE_HE.has(w)) neg++;
  }
  const total = Math.max(pos + neg, 1);
  if (pos > neg) return { type: 'positive', score: pos / total };
  if (neg > pos) return { type: 'negative', score: neg / total };
  return { type: 'neutral', score: 0.5 };
}

export function analyzeSpeakerSentiment(segments: DiarizedSegment[], speakers: string[]): Record<string, { type: SentimentType; score: number; details: { positive: number; negative: number; neutral: number } }> {
  const result: Record<string, { type: SentimentType; score: number; details: { positive: number; negative: number; neutral: number } }> = {};
  for (const sp of speakers) {
    const spSegs = segments.filter(s => s.speaker_label === sp);
    let pos = 0, neg = 0, neu = 0;
    for (const seg of spSegs) {
      const s = analyzeSentiment(seg.text);
      if (s.type === 'positive') pos++;
      else if (s.type === 'negative') neg++;
      else neu++;
    }
    const total = spSegs.length || 1;
    const pScore = pos / total;
    const nScore = neg / total;
    result[sp] = {
      type: pScore > nScore ? 'positive' : nScore > pScore ? 'negative' : 'neutral',
      score: Math.max(pScore, nScore, 0.5),
      details: { positive: pos, negative: neg, neutral: neu },
    };
  }
  return result;
}

// ──── 6. Auto Punctuation (rule-based Hebrew) ────
export function autoPunctuate(text: string): string {
  let result = text.trim();
  // Ensure first letter is "capitalized" (for mixed Hebrew/English)
  // Add period at end if missing
  if (result && !/[.!?،؟]$/.test(result)) result += '.';
  // Add comma before common Hebrew conjunctions if missing
  result = result.replace(/\s+(אבל|אולם|אלא|לעומת|בנוסף|כלומר|למשל|כגון)\s+/g, ', $1 ');
  // Question mark for question words at start
  result = result.replace(/^(האם|מה|איך|למה|מתי|איפה|מי|כמה)\s+(.+?)\.$/gm, '$1 $2?');
  // Fix double punctuation
  result = result.replace(/([.!?])\1+/g, '$1');
  result = result.replace(/\s+([.!?,])/g, '$1');
  return result;
}

// ──── 7. AI Summary via OpenAI ────
export async function aiSummarize(
  segments: DiarizedSegment[],
  speakers: string[],
  speakerNames: Record<string, string>,
  apiKey: string,
  prompt?: string,
): Promise<string> {
  const transcript = segments.map(s => {
    const name = speakerNames[s.speaker_label] || s.speaker_label;
    return `[${name}]: ${s.text}`;
  }).join('\n');

  const systemPrompt = prompt || `אתה עוזר שמסכם שיחות בעברית. סכם את השיחה הבאה:
- תן סיכום כללי קצר (2-3 משפטים)
- עבור כל דובר, תן סיכום של מה שהוא אמר (1-2 משפטים)
- ציין נקודות מפתח שעלו
- הכתב הכל בעברית`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `שיחה עם ${speakers.length} דוברים:\n\n${transcript}` },
      ],
      max_tokens: 1500,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || 'לא התקבל סיכום';
}

// ──── 8. AI Topic Segmentation ────
export async function aiTopicSegmentation(
  segments: DiarizedSegment[],
  speakerNames: Record<string, string>,
  apiKey: string,
): Promise<TopicSegment[]> {
  const transcript = segments.map((s, i) => {
    const name = speakerNames[s.speaker_label] || s.speaker_label;
    return `[${i}] [${name}] (${Math.floor(s.start / 60)}:${Math.floor(s.start % 60).toString().padStart(2, '0')}): ${s.text}`;
  }).join('\n');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `חלק את השיחה לנושאים. עבור כל נושא, החזר JSON עם:
- startIdx: מספר הקטע הראשון
- endIdx: מספר הקטע האחרון
- keywords: מילות מפתח (מערך)
- summary: משפט אחד שמתאר את הנושא
החזר מערך JSON בלבד, ללא טקסט נוסף.` },
        { role: 'user', content: transcript },
      ],
      max_tokens: 1000,
      temperature: 0.2,
    }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '[]';
  // Extract JSON from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const raw = JSON.parse(jsonMatch[0]) as Array<{ startIdx: number; endIdx: number; keywords: string[]; summary: string }>;
  return raw.map(t => ({
    ...t,
    startTime: segments[Math.min(t.startIdx, segments.length - 1)]?.start || 0,
    endTime: segments[Math.min(t.endIdx, segments.length - 1)]?.end || 0,
  }));
}

// ──── 9. PDF Export (simple HTML-based) ────
export function exportAsPDFHtml(
  segments: DiarizedSegment[],
  speakers: string[],
  speakerNames: Record<string, string>,
  speakerRoles: Record<string, string>,
  stats: Array<{ label: string; totalTime: number; percentage: number; wordCount: number }>,
  duration: number,
  method: string,
  overlaps: OverlapRegion[],
): void {
  const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];
  const getName = (sp: string) => speakerNames[sp] || sp;

  const merged: DiarizedSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker_label === seg.speaker_label) {
      prev.text += ' ' + seg.text;
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>זיהוי דוברים</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; direction: rtl; color: #1a1a1a; }
  h1 { font-size: 22px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .stat-card .name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  .stat-card .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .stat-card .info { font-size: 12px; color: #666; margin-top: 4px; }
  .bar-container { height: 16px; display: flex; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
  .segment { padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-right: 3px solid; }
  .segment .header { font-size: 12px; color: #666; margin-bottom: 4px; }
  .segment .speaker { font-weight: 600; font-size: 13px; }
  .segment .text { font-size: 14px; line-height: 1.8; }
  .overlap { background: #fef3c7; padding: 6px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 4px; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>🎙️ זיהוי דוברים — ${speakers.length} דוברים</h1>
<div class="meta">משך: ${fmtTime(duration)} | שיטה: ${method} | ${segments.length} קטעים</div>

<div class="bar-container">
${stats.map((s, i) => `<div style="width:${s.percentage}%;background:${colors[i % colors.length]}" title="${getName(s.label)}: ${Math.round(s.percentage)}%"></div>`).join('')}
</div>

<div class="stats">
${stats.map((s, i) => `<div class="stat-card">
  <div class="name"><span class="dot" style="background:${colors[i % colors.length]}"></span>${getName(s.label)}</div>
  <div class="info">${Math.round(s.percentage)}% · ${fmtTime(s.totalTime)} · ${s.wordCount} מילים</div>
</div>`).join('')}
</div>

${overlaps.length > 0 ? `<h3>⚡ חפיפות (${overlaps.length})</h3>
${overlaps.map(o => `<div class="overlap">${fmtTime(o.start)}–${fmtTime(o.end)}: ${o.speakers.map(getName).join(' + ')} (${o.duration.toFixed(1)} שנ׳)</div>`).join('')}` : ''}

<h3>📝 תמלול</h3>
${merged.map(seg => {
    const spIdx = speakers.indexOf(seg.speaker_label);
    const color = colors[spIdx % colors.length];
    return `<div class="segment" style="border-color:${color}">
  <div class="header"><span class="speaker">${getName(seg.speaker_label)}</span> · ${fmtTime(seg.start)}–${fmtTime(seg.end)}</div>
  <div class="text">${seg.text}</div>
</div>`;
  }).join('')}

<div style="text-align:center;margin-top:30px;font-size:11px;color:#999">
  נוצר באמצעות Smart Hebrew Transcriber · ${new Date().toLocaleDateString('he-IL')}
</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) {
    w.addEventListener('load', () => {
      setTimeout(() => { w.print(); }, 500);
    });
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ──── 10. Share URL generation ────
export function generateShareableText(
  segments: DiarizedSegment[],
  speakers: string[],
  speakerNames: Record<string, string>,
  stats: Array<{ label: string; totalTime: number; percentage: number; wordCount: number }>,
  duration: number,
): string {
  const getName = (sp: string) => speakerNames[sp] || sp;
  const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;

  const merged: DiarizedSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker_label === seg.speaker_label) {
      prev.text += ' ' + seg.text;
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  let text = `🎙️ זיהוי דוברים — ${speakers.length} דוברים | ${fmtTime(duration)}\n\n`;
  text += `📊 סטטיסטיקות:\n`;
  for (const s of stats) {
    text += `• ${getName(s.label)}: ${Math.round(s.percentage)}% (${s.wordCount} מילים)\n`;
  }
  text += `\n📝 תמלול:\n\n`;
  for (const seg of merged) {
    text += `[${getName(seg.speaker_label)}] (${fmtTime(seg.start)})\n${seg.text}\n\n`;
  }
  return text;
}
