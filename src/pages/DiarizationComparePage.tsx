import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeftRight, BarChart3, Clock, Copy, Download, FileText,
  GitCompareArrows, MessageSquare, Users, ArrowRight,
  Maximize2, Minimize2, Eye, EyeOff, Filter, Printer, ChevronDown,
  Play, Volume2, Search, Square, Check, Merge, Subtitles, Pause,
  Loader2, Cloud, Globe, Mic, Server, Zap, Save, Pencil, Eraser, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";
import DiffMatchPatch from "diff-match-patch";
import { db } from "@/lib/localDb";
import { toast } from "@/hooks/use-toast";
import { useDiarizationQueue, type DiarizationMode as QueueDiarizationMode } from "@/contexts/DiarizationQueueContext";

/* ═══════════════════════ Types ═══════════════════════ */

interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
}

interface DiarizationResult {
  text: string;
  segments: DiarizedSegment[];
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

interface CompareEntry {
  label: string;
  result: DiarizationResult;
  speakerNames?: Record<string, string>;
}

type EngineQualityProfile = 'fast' | 'accurate';

interface LooseInsertResult {
  error: unknown;
}

interface LooseDiarizationInsertQuery {
  insert: (payload: unknown) => Promise<LooseInsertResult>;
}

interface LooseUserPreferencesRow {
  compare_settings_json?: unknown;
  draft_text?: string | null;
}

interface LooseMaybeSingleResult<T> {
  data: T | null;
  error: unknown;
}

interface LooseUserPreferencesQuery {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<LooseMaybeSingleResult<LooseUserPreferencesRow>>;
    };
  };
  upsert: (payload: unknown, options?: unknown) => Promise<LooseInsertResult>;
}

interface LooseSupabaseClient {
  from: (table: string) => LooseDiarizationInsertQuery | LooseUserPreferencesQuery;
}

/* ═══════════════════════ Constants ═══════════════════════ */

const BAR_COLORS = [
  "#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#6366f1", "#14b8a6",
];

const ENGINE_COLORS: Record<string, string> = {
  "מקומי": "#3b82f6",
  "WhisperX": "#a855f7",
  "AssemblyAI": "#22c55e",
  "Deepgram": "#f97316",
  "OpenAI": "#ec4899",
  "דפדפן": "#06b6d4",
};

const COMPARE_SETTINGS_STORAGE_KEY = 'diarization_compare_settings_v1';
const COMPARE_SETTINGS_CLOUD_PREFIX = 'compare_settings_v1::';

const ENGINE_LABELS: Record<string, string> = {
  assemblyai: 'AssemblyAI',
  deepgram: 'Deepgram',
  openai: 'OpenAI',
  browser: 'דפדפן',
  local: 'מקומי',
  whisperx: 'WhisperX',
};

/* ═══════════════════════ Utility Functions ═══════════════════════ */

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} שנ׳`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m} דק׳ ${s} שנ׳` : `${m} דק׳`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getSpeakerDistribution(result: DiarizationResult) {
  const dist: Record<string, number> = {};
  for (const seg of result.segments) {
    dist[seg.speaker_label] = (dist[seg.speaker_label] || 0) + (seg.end - seg.start);
  }
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(dist)
    .map(([label, time]) => ({ label, time, pct: (time / total) * 100 }))
    .sort((a, b) => b.time - a.time);
}

function computeAgreement(a: DiarizationResult, b: DiarizationResult): number {
  if (a.duration === 0) return 0;
  const step = 0.5;
  const totalSteps = Math.floor(a.duration / step);
  if (totalSteps === 0) return 0;

  const getSpeakerAt = (result: DiarizationResult, time: number): number => {
    for (const seg of result.segments) {
      if (time >= seg.start && time < seg.end) {
        return result.speakers.indexOf(seg.speaker_label);
      }
    }
    return -1;
  };

  const overlapMatrix: number[][] = Array.from({ length: a.speakers.length }, () =>
    new Array(b.speakers.length).fill(0)
  );

  for (let t = 0; t < totalSteps; t++) {
    const time = t * step;
    const spA = getSpeakerAt(a, time);
    const spB = getSpeakerAt(b, time);
    if (spA >= 0 && spB >= 0) {
      overlapMatrix[spA][spB] += 1;
    }
  }

  const speakerMap = new Map<number, number>();
  const usedB = new Set<number>();
  for (let i = 0; i < a.speakers.length; i++) {
    let bestJ = -1, bestOverlap = 0;
    for (let j = 0; j < b.speakers.length; j++) {
      if (!usedB.has(j) && overlapMatrix[i][j] > bestOverlap) {
        bestOverlap = overlapMatrix[i][j];
        bestJ = j;
      }
    }
    if (bestJ >= 0) { speakerMap.set(i, bestJ); usedB.add(bestJ); }
  }

  let agree = 0;
  for (let t = 0; t < totalSteps; t++) {
    const time = t * step;
    const spA = getSpeakerAt(a, time);
    const spB = getSpeakerAt(b, time);
    if (spA >= 0 && spB >= 0 && speakerMap.get(spA) === spB) agree++;
  }

  return (agree / totalSteps) * 100;
}

function getMergedSegments(result: DiarizationResult): DiarizedSegment[] {
  const merged: DiarizedSegment[] = [];
  for (const seg of result.segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker_label === seg.speaker_label) {
      prev.text = prev.text + ' ' + seg.text;
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function getMergedText(entry: CompareEntry): string {
  return getMergedSegments(entry.result)
    .map(s => `[${resolveSpeakerLabel(entry, s.speaker_label)}] ${s.text}`)
    .join('\n');
}

function resolveSpeakerLabel(entry: CompareEntry, speakerLabel: string): string {
  return entry.speakerNames?.[speakerLabel] || speakerLabel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCompareSettingsFromDraft(raw: string | null | undefined): {
  qualityByEngine?: Record<'local' | 'whisperx', EngineQualityProfile>;
  syncPlaybackEnabled?: boolean;
} | null {
  if (!raw || !raw.startsWith(COMPARE_SETTINGS_CLOUD_PREFIX)) return null;
  try {
    return JSON.parse(raw.slice(COMPARE_SETTINGS_CLOUD_PREFIX.length));
  } catch {
    return null;
  }
}

function parseCompareSettingsFromJson(raw: unknown): {
  qualityByEngine?: Record<'local' | 'whisperx', EngineQualityProfile>;
  syncPlaybackEnabled?: boolean;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as {
    qualityByEngine?: Record<'local' | 'whisperx', EngineQualityProfile>;
    syncPlaybackEnabled?: boolean;
  };
}

/* ═══════════════════════ Speaker Mapping ═══════════════════════ */

/** Build a map: speakerLabelA → speakerLabelB based on time overlap */
function buildSpeakerMap(a: DiarizationResult, b: DiarizationResult): Map<string, string> {
  const step = 0.5;
  const duration = Math.max(a.duration, b.duration);
  const totalSteps = Math.floor(duration / step);
  if (totalSteps === 0) return new Map();

  const overlapMatrix: Record<string, Record<string, number>> = {};
  for (const sp of a.speakers) {
    overlapMatrix[sp] = {};
    for (const sp2 of b.speakers) overlapMatrix[sp][sp2] = 0;
  }

  for (let t = 0; t < totalSteps; t++) {
    const time = t * step;
    const segA = a.segments.find(s => time >= s.start && time < s.end);
    const segB = b.segments.find(s => time >= s.start && time < s.end);
    if (segA && segB) {
      overlapMatrix[segA.speaker_label] = overlapMatrix[segA.speaker_label] || {};
      overlapMatrix[segA.speaker_label][segB.speaker_label] = (overlapMatrix[segA.speaker_label][segB.speaker_label] || 0) + 1;
    }
  }

  const map = new Map<string, string>();
  const usedB = new Set<string>();
  for (const spA of a.speakers) {
    let bestB = '', bestCount = 0;
    for (const spB of b.speakers) {
      if (!usedB.has(spB) && (overlapMatrix[spA]?.[spB] || 0) > bestCount) {
        bestCount = overlapMatrix[spA]?.[spB] || 0;
        bestB = spB;
      }
    }
    if (bestB) { map.set(spA, bestB); usedB.add(bestB); }
  }
  return map;
}

/** Find the matching segment by time overlap */
function findMatchingSegment(seg: DiarizedSegment, otherSegs: DiarizedSegment[]): DiarizedSegment | null {
  const mid = (seg.start + seg.end) / 2;
  return otherSegs.find(s => mid >= s.start && mid < s.end) || null;
}

/* ═══════════════════════ SRT/VTT Export ═══════════════════════ */

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVttTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function exportSRT(entry: CompareEntry) {
  const segs = getMergedSegments(entry.result);
  const lines = segs.map((seg, i) =>
    `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n[${resolveSpeakerLabel(entry, seg.speaker_label)}] ${seg.text}\n`
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${entry.label}-diarization.srt`; a.click();
  URL.revokeObjectURL(url);
}

function exportVTT(entry: CompareEntry) {
  const segs = getMergedSegments(entry.result);
  const lines = [`WEBVTT\n`];
  segs.forEach((seg, i) => {
    lines.push(`${i + 1}\n${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n<v ${resolveSpeakerLabel(entry, seg.speaker_label)}>${seg.text}\n`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/vtt;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${entry.label}-diarization.vtt`; a.click();
  URL.revokeObjectURL(url);
}

function saveEntryTranscript(entry: CompareEntry) {
  const merged = getMergedSegments(entry.result);
  const lines = merged.map((seg) =>
    `[${resolveSpeakerLabel(entry, seg.speaker_label)}] (${formatTime(seg.start)}-${formatTime(seg.end)})\n${seg.text}`
  );
  const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${entry.label}-diarization.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════ Search highlight helper ═══════════════════════ */

function highlightSearchTerm(text: string, query: string): React.ReactNode {
  if (!query || query.length < 2) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-yellow-300 dark:bg-yellow-700 px-0.5 rounded">{part}</mark> : part
  );
}

/* ═══════════════════════ Section Components ═══════════════════════ */

/** Agreement matrix heatmap */
function AgreementMatrix({ entries, comparisons, activePair, onSelectPair }: {
  entries: CompareEntry[];
  comparisons: Array<{ a: string; b: string; aIdx: number; bIdx: number; agreement: number }>;
  activePair: [number, number];
  onSelectPair: (pair: [number, number]) => void;
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <ArrowLeftRight className="w-4 h-4 text-primary" />
        מטריצת התאמה בין מנועים
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="p-1 text-right" />
              {entries.map((e, i) => (
                <th key={i} className="p-1 text-center font-medium min-w-[80px]">
                  <Badge variant="outline" className="text-xs" style={{ borderColor: ENGINE_COLORS[e.label] || '#888' }}>
                    {e.label}
                  </Badge>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((rowEntry, ri) => (
              <tr key={ri}>
                <td className="p-1 text-right font-medium">
                  <Badge variant="outline" className="text-xs" style={{ borderColor: ENGINE_COLORS[rowEntry.label] || '#888' }}>
                    {rowEntry.label}
                  </Badge>
                </td>
                {entries.map((_colEntry, ci) => {
                  if (ri === ci) {
                    return (
                      <td key={ci} className="p-1 text-center">
                        <div className="w-full h-8 rounded bg-muted/50 flex items-center justify-center text-muted-foreground">—</div>
                      </td>
                    );
                  }
                  const comp = comparisons.find(c =>
                    (c.aIdx === ri && c.bIdx === ci) || (c.aIdx === ci && c.bIdx === ri)
                  );
                  const agreement = comp ? comp.agreement : 0;
                  const isActive = (activePair[0] === ri && activePair[1] === ci) || (activePair[0] === ci && activePair[1] === ri);
                  const bg = agreement > 70 ? 'bg-green-100 dark:bg-green-900/30' : agreement > 40 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30';
                  return (
                    <td key={ci} className="p-1 text-center">
                      <button
                        className={`w-full h-8 rounded font-bold text-sm transition-all ${bg} ${isActive ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50'}`}
                        onClick={() => onSelectPair([Math.min(ri, ci), Math.max(ri, ci)])}
                      >
                        {Math.round(agreement)}%
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Side-by-side diff view */
function SideBySideDiff({ entries, diffPair, dmp }: {
  entries: CompareEntry[];
  diffPair: [number, number];
  dmp: DiffMatchPatch;
}) {
  const diffResult = useMemo(() => {
    if (!entries[diffPair[0]] || !entries[diffPair[1]]) return null;
    const textA = getMergedText(entries[diffPair[0]]);
    const textB = getMergedText(entries[diffPair[1]]);
    const diffs = dmp.diff_main(textA, textB);
    dmp.diff_cleanupSemantic(diffs);

    let added = 0, removed = 0, same = 0;
    for (const [op, text] of diffs) {
      const words = text.split(/\s+/).filter(Boolean).length;
      if (op === 1) added += words;
      else if (op === -1) removed += words;
      else same += words;
    }
    const total = same + Math.max(added, removed);
    const similarity = total > 0 ? Math.round((same / total) * 100) : 0;
    return { diffs, added, removed, same, similarity };
  }, [entries, diffPair, dmp]);

  const renderSide = (side: 'left' | 'right') => {
    if (!diffResult) return null;
    return diffResult.diffs.map(([op, text], i) => {
      if (side === 'left') {
        if (op === 0) return <span key={i}>{text}</span>;
        if (op === -1) return <span key={i} className="bg-red-200/70 dark:bg-red-900/40 text-red-800 dark:text-red-300 line-through px-0.5 rounded">{text}</span>;
        return null;
      }
      if (op === 0) return <span key={i}>{text}</span>;
      if (op === 1) return <span key={i} className="bg-green-200/70 dark:bg-green-900/40 text-green-800 dark:text-green-300 font-semibold px-0.5 rounded">{text}</span>;
      return null;
    });
  };

  if (!diffResult) return null;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <Badge variant="secondary" className="gap-1 text-sm font-bold">
          דמיון: {diffResult.similarity}%
        </Badge>
        <span className="text-green-600 dark:text-green-400 font-medium">+{diffResult.added} מילים נוספו</span>
        <span className="text-red-600 dark:text-red-400 font-medium">−{diffResult.removed} מילים הוסרו</span>
        <span className="text-muted-foreground">{diffResult.same} מילים משותפות</span>
      </div>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-2 gap-4">
        {([diffPair[0], diffPair[1]] as const).map((idx, sideNum) => {
          const side = sideNum === 0 ? 'left' : 'right';
          const entry = entries[idx];
          const color = ENGINE_COLORS[entry?.label] || '#888';
          return (
            <Card key={sideNum} className="flex flex-col" style={{ borderTopColor: color, borderTopWidth: '3px' }}>
              <div className="sticky top-0 bg-card z-10 p-3 pb-2 flex items-center justify-between border-b">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-semibold text-sm">{entry?.label}</span>
                  <Badge variant="outline" className="text-[10px]">{entry?.result.diarization_method}</Badge>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                        navigator.clipboard.writeText(getMergedText(entry));
                      }}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>העתק טקסט</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ScrollArea className="h-[500px] p-3" dir="rtl">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {renderSide(side as 'left' | 'right')}
                </div>
              </ScrollArea>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Segment-by-segment timeline comparison aligned by time */
function TimelineComparison({ entries, diffPair }: {
  entries: CompareEntry[];
  diffPair: [number, number];
}) {
  const entryA = entries[diffPair[0]];
  const entryB = entries[diffPair[1]];

  const duration = Math.max(entryA?.result.duration || 0, entryB?.result.duration || 0);
  const timeSlots = useMemo(() => {
    if (!entryA || !entryB) return [];
    const step = 2; // 2-second slots
    const slots: Array<{
      time: number;
      segA: DiarizedSegment | null;
      segB: DiarizedSegment | null;
      match: boolean;
    }> = [];

    for (let t = 0; t < duration; t += step) {
      const segA = entryA.result.segments.find(s => t >= s.start && t < s.end) || null;
      const segB = entryB.result.segments.find(s => t >= s.start && t < s.end) || null;
      const match = segA && segB ? segA.speaker_label === segB.speaker_label : (segA === null && segB === null);
      slots.push({ time: t, segA, segB, match });
    }
    return slots;
  }, [entryA, entryB, duration]);

  if (!entryA || !entryB) return null;

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        השוואת ציר זמן — {entryA.label} מול {entryB.label}
      </h3>

      {/* Dual timeline bars */}
      <div className="space-y-1">
        {[entryA, entryB].map((entry, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-2">
            <span className="text-xs font-medium min-w-[70px] text-left">{entry.label}</span>
            <div className="flex-1 relative h-5 bg-muted/30 rounded overflow-hidden">
              {entry.result.segments.map((seg, si) => {
                const left = (seg.start / duration) * 100;
                const width = ((seg.end - seg.start) / duration) * 100;
                const spIdx = entry.result.speakers.indexOf(seg.speaker_label);
                return (
                  <div
                    key={si}
                    className="absolute top-0 h-full opacity-80 hover:opacity-100 transition-opacity"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.3)}%`,
                      backgroundColor: BAR_COLORS[spIdx % BAR_COLORS.length],
                    }}
                    title={`${seg.speaker_label}: ${formatTime(seg.start)}-${formatTime(seg.end)}\n${seg.text.slice(0, 60)}`}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Agreement bar */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground min-w-[70px] text-left">התאמה</span>
          <div className="flex-1 relative h-3 bg-muted/30 rounded overflow-hidden flex">
            {timeSlots.map((slot, i) => (
              <div
                key={i}
                className="h-full"
                style={{
                  flex: '1',
                  backgroundColor: slot.match ? '#22c55e' : '#ef4444',
                  opacity: (slot.segA || slot.segB) ? 0.7 : 0.15,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatTime(duration / 4)}</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration * 3 / 4)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </Card>
  );
}

/** Per-engine statistics cards */
function EngineStatsCards({ entries }: { entries: CompareEntry[] }) {
  return (
    <div className={`grid gap-4 ${entries.length === 2 ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
      {entries.map((entry, idx) => {
        const dist = getSpeakerDistribution(entry.result);
        const mergedSegs = getMergedSegments(entry.result);
        const color = ENGINE_COLORS[entry.label] || '#888';
        const avgSegLen = entry.result.segments.length > 0
          ? (entry.result.segments.reduce((a, s) => a + (s.end - s.start), 0) / entry.result.segments.length)
          : 0;
        const totalWords = entry.result.segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0);

        return (
          <Card key={idx} className="p-4" style={{ borderTopColor: color, borderTopWidth: '3px' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-semibold text-sm">{entry.label}</span>
              </div>
              <Badge variant="outline" className="text-[10px]">{entry.result.diarization_method}</Badge>
            </div>

            {/* Key stats */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-primary">{entry.result.speaker_count}</div>
                <div className="text-muted-foreground">דוברים</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-primary">{entry.result.segments.length}</div>
                <div className="text-muted-foreground">קטעים</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-primary">{totalWords}</div>
                <div className="text-muted-foreground">מילים</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-primary">{entry.result.processing_time.toFixed(1)}s</div>
                <div className="text-muted-foreground">זמן עיבוד</div>
              </div>
            </div>

            {/* Speaker bar */}
            <div className="flex h-5 rounded-full overflow-hidden mb-2">
              {dist.map((d, i) => (
                <div
                  key={d.label}
                  className="h-full transition-all"
                  style={{ width: `${d.pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                  title={`${d.label}: ${Math.round(d.pct)}%`}
                />
              ))}
            </div>

            {/* Speaker legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {dist.map((d, i) => (
                <span key={d.label} className="flex items-center gap-1 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                  {d.label} ({Math.round(d.pct)}%)
                </span>
              ))}
            </div>

            <Separator className="my-2" />

            {/* Extra info */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>משך: {formatDuration(entry.result.duration)}</div>
              <div>ממוצע קטע: {avgSegLen.toFixed(1)} שנ׳</div>
              <div>פסקאות ממוזגות: {mergedSegs.length}</div>
            </div>

            {/* Timeline */}
            <div className="mt-2 relative h-6 bg-muted/30 rounded overflow-hidden">
              {entry.result.segments.map((seg, si) => {
                const left = (seg.start / entry.result.duration) * 100;
                const width = ((seg.end - seg.start) / entry.result.duration) * 100;
                const spIdx = entry.result.speakers.indexOf(seg.speaker_label);
                return (
                  <div
                    key={si}
                    className="absolute top-0 h-full opacity-80"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.3)}%`,
                      backgroundColor: BAR_COLORS[spIdx % BAR_COLORS.length],
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>0:00</span>
              <span>{formatTime(entry.result.duration)}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Side-by-side transcript comparison by segments */
function TranscriptComparison({ entries, diffPair }: {
  entries: CompareEntry[];
  diffPair: [number, number];
}) {
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);

  const entryA = entries[diffPair[0]];
  const entryB = entries[diffPair[1]];
  if (!entryA || !entryB) return null;

  const mergedA = getMergedSegments(entryA.result);
  const mergedB = getMergedSegments(entryB.result);

  const allSpeakers = [...new Set([...entryA.result.speakers, ...entryB.result.speakers])];

  const filterSegs = (segs: DiarizedSegment[]) => {
    if (!speakerFilter) return segs;
    return segs.filter(s => s.speaker_label === speakerFilter);
  };

  return (
    <div className="space-y-3">
      {/* Speaker filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">סנן לפי דובר:</span>
        <Button variant={!speakerFilter ? 'default' : 'outline'} size="sm" className="text-xs h-6" onClick={() => setSpeakerFilter(null)}>
          הכל
        </Button>
        {allSpeakers.map((sp, i) => (
          <Button
            key={sp}
            variant={speakerFilter === sp ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-6 gap-1"
            onClick={() => setSpeakerFilter(sp === speakerFilter ? null : sp)}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
            {resolveSpeakerLabel(entryA, sp)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[{ entry: entryA, segs: filterSegs(mergedA) }, { entry: entryB, segs: filterSegs(mergedB) }].map(({ entry, segs }, sideNum) => {
          const color = ENGINE_COLORS[entry.label] || '#888';
          return (
            <Card key={sideNum} className="flex flex-col" style={{ borderTopColor: color, borderTopWidth: '3px' }}>
              <div className="sticky top-0 bg-card z-10 p-3 pb-2 flex items-center justify-between border-b">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-semibold text-sm">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">{segs.length} פסקאות</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                  const text = segs.map(s => `[${resolveSpeakerLabel(entry, s.speaker_label)}] (${formatTime(s.start)}-${formatTime(s.end)})\n${s.text}`).join('\n\n');
                  navigator.clipboard.writeText(text);
                }}>
                  <Copy className="w-3 h-3 mr-1" />העתק
                </Button>
              </div>
              <ScrollArea className="h-[500px] p-3" dir="rtl">
                <div className="space-y-3">
                  {segs.map((seg, i) => {
                    const spIdx = entry.result.speakers.indexOf(seg.speaker_label);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: BAR_COLORS[spIdx % BAR_COLORS.length] }} />
                          <span className="text-xs font-semibold">{resolveSpeakerLabel(entry, seg.speaker_label)}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(seg.start)} – {formatTime(seg.end)}</span>
                        </div>
                        <p className="text-sm leading-relaxed pr-5">{seg.text}</p>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════ Split Column: Full Engine Result ═══════════════════════ */

interface EngineColumnProps {
  entry: CompareEntry;
  idx: number;
  canClear: boolean;
  currentTime: number;
  onSeek: (time: number) => void;
  audioUrl: string | null;
  searchQuery: string;
  highlightedSegIdx: number | null;
  onHighlightSeg: (idx: number | null) => void;
  otherEntry: CompareEntry | null;
  speakerMap: Map<string, string>;
  onPlaySegment: (start: number, end: number) => void;
  mergeSelections: Map<number, 'left' | 'right'>;
  onToggleMerge: (segIdx: number, side: 'left' | 'right') => void;
  side: 'left' | 'right';
  showMerge: boolean;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  syncPlaybackEnabled: boolean;
  onSyncSeekPlay?: (time: number, play?: boolean) => void;
  onSyncPauseAll?: () => void;
  onRegisterAudio?: (idx: number, el: HTMLAudioElement | null) => void;
  onClearColumn: (idx: number) => void;
  onSaveColumn: (idx: number) => void;
  onRenameColumn: (idx: number, name: string) => void;
  dmp: DiffMatchPatch;
}

function EngineColumn({
  entry, idx, canClear, currentTime, onSeek, searchQuery, highlightedSegIdx,
  onHighlightSeg, otherEntry, speakerMap, onPlaySegment,
  audioUrl,
  mergeSelections, onToggleMerge, side, showMerge, scrollRef, onScroll,
  syncPlaybackEnabled, onSyncSeekPlay, onSyncPauseAll, onRegisterAudio,
  onClearColumn, onSaveColumn, onRenameColumn,
  dmp,
}: EngineColumnProps) {
  const color = ENGINE_COLORS[entry.label] || '#888';
  const merged = useMemo(() => getMergedSegments(entry.result), [entry.result]);
  const otherMerged = useMemo(() => otherEntry ? getMergedSegments(otherEntry.result) : [], [otherEntry]);
  const dist = getSpeakerDistribution(entry.result);
  const totalWords = entry.result.segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0);
  const columnAudioRef = useRef<HTMLAudioElement | null>(null);
  const segmentStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [columnTime, setColumnTime] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(entry.label);

  useEffect(() => {
    setEditedName(entry.label);
  }, [entry.label]);

  // Find current segment for highlight
  const effectiveTime = audioUrl ? columnTime : currentTime;
  const activeIdx = merged.findIndex(s => effectiveTime >= s.start && effectiveTime < s.end);

  const seekToTime = useCallback((time: number) => {
    if (syncPlaybackEnabled && onSyncSeekPlay) {
      onSyncSeekPlay(Math.max(0, time), false);
      return;
    }
    if (audioUrl && columnAudioRef.current) {
      columnAudioRef.current.currentTime = Math.max(0, time);
      setColumnTime(Math.max(0, time));
      return;
    }
    onSeek(time);
  }, [audioUrl, onSeek, onSyncSeekPlay, syncPlaybackEnabled]);

  const playSegmentLocal = useCallback((start: number, end: number) => {
    if (syncPlaybackEnabled && onSyncSeekPlay) {
      onSyncSeekPlay(Math.max(0, start), true);
      if (segmentStopTimerRef.current) clearTimeout(segmentStopTimerRef.current);
      segmentStopTimerRef.current = setTimeout(() => {
        if (onSyncPauseAll) onSyncPauseAll();
      }, Math.max(0, end - start) * 1000);
      return;
    }
    if (audioUrl && columnAudioRef.current) {
      const audioEl = columnAudioRef.current;
      audioEl.currentTime = Math.max(0, start);
      setColumnTime(Math.max(0, start));
      void audioEl.play();
      if (segmentStopTimerRef.current) clearTimeout(segmentStopTimerRef.current);
      segmentStopTimerRef.current = setTimeout(() => {
        audioEl.pause();
      }, Math.max(0, end - start) * 1000);
      return;
    }
    onPlaySegment(start, end);
  }, [audioUrl, onPlaySegment, onSyncPauseAll, onSyncSeekPlay, syncPlaybackEnabled]);

  const handleAudioRef = useCallback((el: HTMLAudioElement | null) => {
    columnAudioRef.current = el;
    if (onRegisterAudio) onRegisterAudio(idx, el);
  }, [idx, onRegisterAudio]);

  useEffect(() => {
    return () => {
      if (segmentStopTimerRef.current) clearTimeout(segmentStopTimerRef.current);
    };
  }, []);

  // Word-level diff per segment (Enhancement 3)
  const segmentDiffs = useMemo(() => {
    if (!otherEntry) return [];
    return merged.map(seg => {
      const match = findMatchingSegment(seg, otherMerged);
      if (!match) return null;
      const diffs = dmp.diff_main(seg.text, match.text);
      dmp.diff_cleanupSemantic(diffs);
      return diffs;
    });
  }, [merged, otherMerged, dmp, otherEntry]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Engine header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3" style={{ borderTopColor: color, borderTopWidth: '3px' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: color }} />
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="h-7 w-36 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const nextName = editedName.trim();
                      if (nextName) {
                        onRenameColumn(idx, nextName);
                        setIsEditingName(false);
                      }
                    }
                    if (e.key === 'Escape') {
                      setEditedName(entry.label);
                      setIsEditingName(false);
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    const nextName = editedName.trim();
                    if (!nextName) return;
                    onRenameColumn(idx, nextName);
                    setIsEditingName(false);
                  }}
                >
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setEditedName(entry.label);
                    setIsEditingName(false);
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <span className="font-bold text-base">{entry.label}</span>
            )}
            <Badge variant="outline" className="text-[10px]">{entry.result.diarization_method}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 px-1 py-0.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => onSaveColumn(idx)}
                      aria-label="שמור עמודה"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>שמור עמודה</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setIsEditingName(true)}
                      aria-label="עריכת שם"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>עריכת שם</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={() => onClearColumn(idx)}
                      disabled={!canClear}
                      aria-label="ניקוי עמודה"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{canClear ? 'ניקוי עמודה' : 'נדרש לפחות מנוע נוסף'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* SRT/VTT export (Enhancement 7) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => exportSRT(entry)}>
                    <Subtitles className="w-3 h-3" />
                    SRT
                  </Button>
                </TooltipTrigger>
                <TooltipContent>ייצוא SRT</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => exportVTT(entry)}>
                    <Subtitles className="w-3 h-3" />
                    VTT
                  </Button>
                </TooltipTrigger>
                <TooltipContent>ייצוא VTT</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                    const text = merged.map(s => `[${resolveSpeakerLabel(entry, s.speaker_label)}] (${formatTime(s.start)}-${formatTime(s.end)})\n${s.text}`).join('\n\n');
                    navigator.clipboard.writeText(text);
                  }}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>העתק תמלול</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Quick stats + speaker mapping (Enhancement 4) */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{entry.result.speaker_count} דוברים</span>
          <span>·</span>
          <span>{entry.result.segments.length} קטעים</span>
          <span>·</span>
          <span>{totalWords} מילים</span>
          <span>·</span>
          <span>{entry.result.processing_time.toFixed(1)}s עיבוד</span>
        </div>
        {speakerMap.size > 0 && (
          <div className="flex flex-wrap gap-x-3 mt-1 text-[10px] text-muted-foreground/70">
            {[...speakerMap.entries()].map(([a, b]) => (
              <span key={a}>
                {side === 'left' ? `${a} ↔ ${b}` : `${b} ↔ ${a}`}
              </span>
            ))}
          </div>
        )}

        {/* Speaker distribution bar */}
        <div className="flex h-3 rounded-full overflow-hidden mt-2">
          {dist.map((d, i) => (
            <div
              key={d.label}
              className="h-full"
              style={{ width: `${d.pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
              title={`${d.label}: ${Math.round(d.pct)}%`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {dist.map((d, i) => (
            <span key={d.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
              {d.label} ({Math.round(d.pct)}%)
            </span>
          ))}
        </div>

        {/* Mini timeline */}
        <div className="mt-2 relative h-5 bg-muted/30 rounded overflow-hidden cursor-pointer"
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seekToTime(pct * entry.result.duration);
          }}
        >
          {entry.result.segments.map((seg, si) => {
            const left = (seg.start / entry.result.duration) * 100;
            const width = ((seg.end - seg.start) / entry.result.duration) * 100;
            const spIdx = entry.result.speakers.indexOf(seg.speaker_label);
            return (
              <div
                key={si}
                className="absolute top-0 h-full opacity-80 hover:opacity-100 transition-opacity"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.3)}%`,
                  backgroundColor: BAR_COLORS[spIdx % BAR_COLORS.length],
                }}
              />
            );
          })}
          {/* Playhead */}
          {entry.result.duration > 0 && (
            <div
              className="absolute top-0 h-full w-0.5 bg-foreground/80 z-10"
              style={{ left: `${(effectiveTime / entry.result.duration) * 100}%` }}
            />
          )}
        </div>

        {audioUrl && (
          <audio
            ref={handleAudioRef}
            src={audioUrl}
            controls
            preload="metadata"
            className="w-full mt-2 h-8"
            onTimeUpdate={(e) => setColumnTime((e.currentTarget as HTMLAudioElement).currentTime)}
          />
        )}
      </div>

      {/* Transcript segments — flowing continuously */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" onScroll={onScroll}>
        {merged.map((seg, i) => {
          const spIdx = entry.result.speakers.indexOf(seg.speaker_label);
          const displaySpeaker = resolveSpeakerLabel(entry, seg.speaker_label);
          const isActive = i === activeIdx;
          const isCrossHighlighted = highlightedSegIdx !== null && highlightedSegIdx === i;
          const isSelected = mergeSelections.get(i) === side;
          const diffResult = segmentDiffs[i];

          // Render text with search highlight or word-level diff (Enhancement 3 & 5)
          let renderedText: React.ReactNode = seg.text;
          if (searchQuery && searchQuery.length >= 2) {
            renderedText = highlightSearchTerm(seg.text, searchQuery);
          } else if (diffResult) {
            renderedText = diffResult.map(([op, text], di) => {
              if (op === 0) return <span key={di}>{text}</span>;
              if (op === -1) return <span key={di} className="bg-red-200 dark:bg-red-900/50 line-through text-red-700 dark:text-red-300">{text}</span>;
              return null; // op === 1: text from the other side, skip
            });
          }

          return (
            <div
              key={i}
              data-seg-idx={i}
              className={`space-y-1 p-2 rounded-lg cursor-pointer transition-colors group relative
                ${isActive ? 'bg-primary/10 ring-1 ring-primary/30' : ''}
                ${isCrossHighlighted ? 'bg-yellow-100 dark:bg-yellow-900/30 ring-1 ring-yellow-400/50' : ''}
                ${!isActive && !isCrossHighlighted ? 'hover:bg-muted/50' : ''}
                ${isSelected ? 'ring-2 ring-green-500' : ''}
              `}
              onClick={() => seekToTime(seg.start)}
              onMouseEnter={() => onHighlightSeg(i)}
              onMouseLeave={() => onHighlightSeg(null)}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: BAR_COLORS[spIdx % BAR_COLORS.length] }} />
                <span className="text-xs font-semibold">{displaySpeaker}</span>
                <span className="text-[10px] text-muted-foreground">{formatTime(seg.start)} – {formatTime(seg.end)}</span>
                {/* Play segment button (Enhancement 6) */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => { e.stopPropagation(); playSegmentLocal(seg.start, seg.end); }}
                >
                  <Play className="w-3 h-3" />
                </Button>
                {/* Merge select button (Enhancement 8) */}
                {showMerge && (
                  <Button
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    className="h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity mr-auto"
                    onClick={e => { e.stopPropagation(); onToggleMerge(i, side); }}
                  >
                    <Check className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <p className="text-sm leading-relaxed pr-5">
                <span className="font-semibold">[{displaySpeaker}] </span>
                {renderedText}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════ Main Page Component ═══════════════════════ */

const DiarizationComparePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [diffPair, setDiffPair] = useState<[number, number]>([0, 1]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dmp = useMemo(() => new DiffMatchPatch(), []);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [pendingEngineJobs, setPendingEngineJobs] = useState<Record<string, string>>({});
  const [qualityByEngine, setQualityByEngine] = useState<Record<'local' | 'whisperx', EngineQualityProfile>>({
    local: 'fast',
    whisperx: 'fast',
  });
  const [syncPlaybackEnabled, setSyncPlaybackEnabled] = useState(false);
  const { keys: cloudKeys } = useCloudApiKeys();
  const queue = useDiarizationQueue();

  // New enhancement state
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedSegIdx, setHighlightedSegIdx] = useState<number | null>(null);
  const [mergeSelections, setMergeSelections] = useState<Map<number, 'left' | 'right'>>(new Map());
  const [showMerge, setShowMerge] = useState(false);
  const [syncScrollEnabled, setSyncScrollEnabled] = useState(true);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const audioRefs = useRef<Map<number, HTMLAudioElement>>(new Map());

  // Enhancement 4: Speaker mapping
  const speakerMap = useMemo(() => {
    if (entries.length < 2) return new Map<string, string>();
    return buildSpeakerMap(entries[diffPair[0]]?.result, entries[diffPair[1]]?.result);
  }, [entries, diffPair]);

  // Load entries from navigation state or localStorage
  useEffect(() => {
    const state = location.state as { entries?: CompareEntry[]; audioUrl?: string; audioFileName?: string } | null;
    const stateEntries = state?.entries;
    if (stateEntries && stateEntries.length >= 1) {
      setEntries(stateEntries);
      if (stateEntries.length >= 2) {
        localStorage.setItem('diarization_compare_entries', JSON.stringify(stateEntries));
      }
    } else {
      try {
        const saved = localStorage.getItem('diarization_compare_entries');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length >= 2) setEntries(parsed);
        }
      } catch { /* ignore */ }
    }
    if (state?.audioUrl) {
      setAudioUrl(state.audioUrl);
      localStorage.setItem('diarization_compare_audioUrl', state.audioUrl);
    } else {
      const savedUrl = localStorage.getItem('diarization_compare_audioUrl');
      if (savedUrl) setAudioUrl(savedUrl);
    }
    if (state?.audioFileName) {
      setAudioFileName(state.audioFileName);
    }
  }, [location.state]);

  const comparisons = useMemo(() => {
    if (entries.length < 2) return [];
    const results: Array<{ a: string; b: string; aIdx: number; bIdx: number; agreement: number }> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        results.push({
          a: entries[i].label,
          b: entries[j].label,
          aIdx: i,
          bIdx: j,
          agreement: computeAgreement(entries[i].result, entries[j].result),
        });
      }
    }
    return results;
  }, [entries]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handlePlaySegment = useCallback((start: number) => {
    setCurrentTime(start);
  }, []);

  const registerAudio = useCallback((idx: number, el: HTMLAudioElement | null) => {
    if (!el) {
      audioRefs.current.delete(idx);
      return;
    }
    audioRefs.current.set(idx, el);
  }, []);

  const syncSeekPlay = useCallback((time: number, play = false) => {
    setCurrentTime(time);
    audioRefs.current.forEach((audioEl) => {
      audioEl.currentTime = Math.max(0, time);
      if (play) void audioEl.play();
    });
  }, []);

  const pauseAll = useCallback(() => {
    audioRefs.current.forEach((audioEl) => audioEl.pause());
  }, []);

  const playAll = useCallback(() => {
    audioRefs.current.forEach((audioEl) => {
      void audioEl.play();
    });
  }, []);

  const runningEngines = useMemo(() => {
    const active = new Set<string>();
    for (const [engine, jobId] of Object.entries(pendingEngineJobs)) {
      const job = queue.jobs.find(j => j.id === jobId);
      if (job && (job.status === 'queued' || job.status === 'processing')) {
        active.add(engine);
      }
    }
    return active;
  }, [pendingEngineJobs, queue.jobs]);

  useEffect(() => {
    if (Object.keys(pendingEngineJobs).length === 0) return;

    const toRemove: string[] = [];
    for (const [engine, jobId] of Object.entries(pendingEngineJobs)) {
      const job = queue.jobs.find(j => j.id === jobId);
      if (!job) continue;

      if (job.status === 'completed' && job.result) {
        const label = ENGINE_LABELS[engine] || engine;
        const newEntry: CompareEntry = {
          label,
          result: job.result as unknown as DiarizationResult,
        };
        setEntries(prev => {
          const exists = prev.some(e => e.label.toLowerCase() === label.toLowerCase());
          const next = exists
            ? prev.map(e => e.label.toLowerCase() === label.toLowerCase() ? newEntry : e)
            : [...prev, newEntry];
          localStorage.setItem('diarization_compare_entries', JSON.stringify(next));
          return next;
        });
        toast({ title: 'זיהוי דוברים הושלם', description: `${label} מוכן ונשמר בענן` });
        toRemove.push(engine);
      }

      if (job.status === 'error') {
        toast({ title: 'שגיאה בזיהוי דוברים', description: `${ENGINE_LABELS[engine] || engine}: ${job.error || 'שגיאה'}`, variant: 'destructive' });
        toRemove.push(engine);
      }
    }

    if (toRemove.length > 0) {
      setPendingEngineJobs(prev => {
        const next = { ...prev };
        for (const key of toRemove) delete next[key];
        return next;
      });
    }
  }, [pendingEngineJobs, queue.jobs]);

  // Load compare settings from local storage first.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPARE_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        qualityByEngine?: Record<'local' | 'whisperx', EngineQualityProfile>;
        syncPlaybackEnabled?: boolean;
      };
      if (parsed.qualityByEngine?.local && parsed.qualityByEngine?.whisperx) {
        setQualityByEngine(parsed.qualityByEngine);
      }
      if (typeof parsed.syncPlaybackEnabled === 'boolean') {
        setSyncPlaybackEnabled(parsed.syncPlaybackEnabled);
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Then sync compare settings from cloud (if available).
  useEffect(() => {
    const loadCompareSettingsFromCloud = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const looseSupabase = supabase as unknown as LooseSupabaseClient;
      const prefsTable = looseSupabase.from('user_preferences') as LooseUserPreferencesQuery;
      const { data, error } = await prefsTable
        .select('compare_settings_json,draft_text')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return;

      const parsed = parseCompareSettingsFromJson(data.compare_settings_json) || parseCompareSettingsFromDraft(data.draft_text || null);
      if (!parsed) return;

      if (parsed.qualityByEngine?.local && parsed.qualityByEngine?.whisperx) {
        setQualityByEngine(parsed.qualityByEngine);
      }
      if (typeof parsed.syncPlaybackEnabled === 'boolean') {
        setSyncPlaybackEnabled(parsed.syncPlaybackEnabled);
      }
    };

    void loadCompareSettingsFromCloud();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COMPARE_SETTINGS_STORAGE_KEY, JSON.stringify({
        qualityByEngine,
        syncPlaybackEnabled,
      }));
    } catch {
      // ignore storage write failures
    }
  }, [qualityByEngine, syncPlaybackEnabled]);

  // Persist compare settings to cloud.
  useEffect(() => {
    const saveCompareSettingsToCloud = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        qualityByEngine,
        syncPlaybackEnabled,
      };
      const looseSupabase = supabase as unknown as LooseSupabaseClient;
      const prefsTable = looseSupabase.from('user_preferences') as LooseUserPreferencesQuery;
      const { error } = await prefsTable.upsert({
        user_id: user.id,
        compare_settings_json: payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (error) {
        console.warn('Failed to persist compare settings to cloud', error);
      }
    };

    void saveCompareSettingsToCloud();
  }, [qualityByEngine, syncPlaybackEnabled]);

  // Enhancement 1: Synchronized scrolling
  const handleLeftScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!syncScrollEnabled || isScrolling.current) return;
    isScrolling.current = true;
    const target = e.currentTarget;
    if (rightScrollRef.current) {
      const pct = target.scrollTop / (target.scrollHeight - target.clientHeight || 1);
      rightScrollRef.current.scrollTop = pct * (rightScrollRef.current.scrollHeight - rightScrollRef.current.clientHeight);
    }
    requestAnimationFrame(() => { isScrolling.current = false; });
  }, [syncScrollEnabled]);

  const handleRightScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!syncScrollEnabled || isScrolling.current) return;
    isScrolling.current = true;
    const target = e.currentTarget;
    if (leftScrollRef.current) {
      const pct = target.scrollTop / (target.scrollHeight - target.clientHeight || 1);
      leftScrollRef.current.scrollTop = pct * (leftScrollRef.current.scrollHeight - leftScrollRef.current.clientHeight);
    }
    requestAnimationFrame(() => { isScrolling.current = false; });
  }, [syncScrollEnabled]);

  // Enhancement 8: Toggle merge selection
  const handleToggleMerge = useCallback((segIdx: number, side: 'left' | 'right') => {
    setMergeSelections(prev => {
      const next = new Map(prev);
      if (next.get(segIdx) === side) next.delete(segIdx);
      else next.set(segIdx, side);
      return next;
    });
  }, []);

  // Enhancement 8: Build merged transcript
  const mergedTranscript = useMemo(() => {
    if (!showMerge || entries.length < 2) return '';
    const leftMerged = getMergedSegments(entries[diffPair[0]].result);
    const rightMerged = getMergedSegments(entries[diffPair[1]].result);
    const maxLen = Math.max(leftMerged.length, rightMerged.length);
    const lines: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const sel = mergeSelections.get(i);
      const seg = sel === 'right' ? rightMerged[i] : leftMerged[i]; // default to left
      const entry = sel === 'right' ? entries[diffPair[1]] : entries[diffPair[0]];
      if (seg) lines.push(`[${resolveSpeakerLabel(entry, seg.speaker_label)}] (${formatTime(seg.start)}-${formatTime(seg.end)})\n${seg.text}`);
    }
    return lines.join('\n\n');
  }, [showMerge, entries, diffPair, mergeSelections]);

  const exportAsJSON = () => {
    const data = { entries, comparisons, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `diarization-compare-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsText = () => {
    let text = `═══ השוואת זיהוי דוברים ═══\n\n`;
    for (const comp of comparisons) {
      text += `${comp.a} ↔ ${comp.b}: ${Math.round(comp.agreement)}% התאמה\n`;
    }
    text += '\n';
    for (const entry of entries) {
      text += `── ${entry.label} (${entry.result.diarization_method}) ──\n`;
      text += `דוברים: ${entry.result.speaker_count} | קטעים: ${entry.result.segments.length} | עיבוד: ${entry.result.processing_time}s\n\n`;
      const merged = getMergedSegments(entry.result);
      for (const seg of merged) {
        text += `[${resolveSpeakerLabel(entry, seg.speaker_label)}] (${formatTime(seg.start)}-${formatTime(seg.end)})\n${seg.text}\n\n`;
      }
      text += '\n';
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `diarization-compare-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  const handleClearEntry = useCallback((idxToClear: number) => {
    setEntries((prev) => {
      if (idxToClear < 0 || idxToClear >= prev.length) return prev;
      if (prev.length <= 1) return prev;

      const next = prev.filter((_, i) => i !== idxToClear);
      if (next.length >= 2) {
        localStorage.setItem('diarization_compare_entries', JSON.stringify(next));
      } else {
        localStorage.removeItem('diarization_compare_entries');
      }

      setDiffPair((pairPrev) => {
        if (next.length < 2) return [0, 1];

        const remap = (v: number) => (v > idxToClear ? v - 1 : v);
        const removedInPair = pairPrev[0] === idxToClear || pairPrev[1] === idxToClear;
        if (removedInPair) return [0, 1];

        const a = remap(pairPrev[0]);
        const b = remap(pairPrev[1]);
        if (a === b || a >= next.length || b >= next.length) return [0, 1];
        return [Math.min(a, b), Math.max(a, b)];
      });

      toast({ title: 'העמודה נוקתה', description: 'אפשר להוסיף מנוע חדש במקומה' });
      return next;
    });
  }, []);

  const handleSaveEntry = useCallback((idxToSave: number) => {
    const entry = entries[idxToSave];
    if (!entry) return;
    saveEntryTranscript(entry);
    toast({ title: 'נשמר', description: `נשמר קובץ עבור ${entry.label}` });
  }, [entries]);

  const handleRenameEntry = useCallback((idxToRename: number, nextNameRaw: string) => {
    const nextName = nextNameRaw.trim();
    if (!nextName) {
      toast({ title: 'שם לא תקין', description: 'נא להזין שם עמודה', variant: 'destructive' });
      return;
    }

    setEntries((prev) => {
      if (idxToRename < 0 || idxToRename >= prev.length) return prev;
      const duplicate = prev.some((e, i) => i !== idxToRename && e.label.trim().toLowerCase() === nextName.toLowerCase());
      if (duplicate) {
        toast({ title: 'שם כבר קיים', description: 'בחר שם שונה לעמודה', variant: 'destructive' });
        return prev;
      }

      const next = prev.map((entry, i) => i === idxToRename ? { ...entry, label: nextName } : entry);
      if (next.length >= 2) {
        localStorage.setItem('diarization_compare_entries', JSON.stringify(next));
      }
      toast({ title: 'השם עודכן', description: `העמודה נקראת עכשיו ${nextName}` });
      return next;
    });
  }, []);

  // handleRunSecondEngine removed — replaced by handleAddEngine above

  // Add engine handler — works for both 1-entry and 2+ entry states
  const handleAddEngine = useCallback(async (engine: string) => {
    if (pendingEngineJobs[engine]) return;
    try {
      let sourceBlob: Blob | null = null;
      let sourceName = audioFileName || 'audio.webm';

      // Prefer the audio currently displayed in compare screen.
      if (audioUrl) {
        try {
          const resp = await fetch(audioUrl);
          if (resp.ok) {
            sourceBlob = await resp.blob();
          }
        } catch {
          // Ignore and fallback to local DB source.
        }
      }

      // Fallback for refresh/new sessions.
      if (!sourceBlob) {
        const audioEntry = await db.audioBlobs.get("last_audio");
        if (audioEntry?.blob) {
          sourceBlob = audioEntry.blob;
          sourceName = audioEntry.name || sourceName;
        }
      }

      if (!sourceBlob) {
        toast({ title: "לא נמצא קובץ אודיו", description: "טען מחדש את קובץ האודיו לפני הוספת מנוע", variant: "destructive" });
        return;
      }
      const mode = engine as QueueDiarizationMode;
      const apiKeyMap: Record<string, string> = {
        assemblyai: cloudKeys.assemblyai_key || '',
        deepgram: cloudKeys.deepgram_key || '',
        openai: cloudKeys.openai_key || '',
      };

      if ((engine === 'assemblyai' || engine === 'deepgram' || engine === 'openai') && !apiKeyMap[engine]) {
        toast({ title: `חסר מפתח API`, description: `הגדר מפתח ${ENGINE_LABELS[engine]} בהגדרות`, variant: 'destructive' });
        return;
      }

      let hfToken = '';
      if (engine === 'local' && qualityByEngine.local === 'accurate') {
        hfToken = (cloudKeys.huggingface_key || '').trim();
        if (!hfToken) {
          toast({ title: 'אין HuggingFace Token', description: 'ממשיך במצב Fast (silence-gap)' });
        }
      }
      if (engine === 'whisperx' && qualityByEngine.whisperx === 'accurate') {
        hfToken = (cloudKeys.huggingface_key || '').trim();
        if (!hfToken) {
          toast({ title: 'אין HuggingFace Token', description: 'WhisperX יפעל ללא pyannote (Fast)' });
        }
      }

      const file = new File([sourceBlob], sourceName, { type: sourceBlob.type || 'audio/webm' });
      const jobId = queue.enqueue(file, mode, {
        serverUrl: (cloudKeys.whisper_server_url || '/whisper').trim().replace(/\/$/, ''),
        minGap: 1.5,
        hfToken,
        pyannoteModel: 'community-1',
        expectedSpeakers: 0,
        cloudApiKey: apiKeyMap[engine] || '',
        autoSaveToCloud: true,
      });

      setPendingEngineJobs(prev => ({ ...prev, [engine]: jobId }));
      toast({ title: 'נשלח לתור רקע', description: `${ENGINE_LABELS[engine] || engine} נוסף לתור` });
    } catch (err) {
      toast({ title: "שגיאה בזיהוי דוברים", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    }
  }, [audioFileName, audioUrl, cloudKeys, pendingEngineJobs, qualityByEngine, queue]);

  // Build engine list (show all; mark already-added instead of hiding)
  const getAvailableEngines = useCallback(() => {
    const toEngineValue = (label: string): string | null => {
      const l = label.trim().toLowerCase();
      if (l.includes('מקומי') || l.includes('local') || l.includes('silence-gap')) return 'local';
      if (l.includes('whisperx')) return 'whisperx';
      if (l.includes('assembly')) return 'assemblyai';
      if (l.includes('deepgram')) return 'deepgram';
      if (l.includes('openai')) return 'openai';
      if (l.includes('דפדפן') || l.includes('browser')) return 'browser';
      return null;
    };

    const existingValues = new Set(entries.map(e => toEngineValue(e.label)).filter(Boolean) as string[]);

    return [
      { value: 'local', label: 'מקומי', icon: Server, hasKey: true, alreadyAdded: existingValues.has('local') },
      { value: 'whisperx', label: 'WhisperX', icon: Mic, hasKey: true, alreadyAdded: existingValues.has('whisperx') },
      { value: 'assemblyai', label: 'AssemblyAI', icon: Cloud, hasKey: !!cloudKeys.assemblyai_key, alreadyAdded: existingValues.has('assemblyai') },
      { value: 'deepgram', label: 'Deepgram', icon: Cloud, hasKey: !!cloudKeys.deepgram_key, alreadyAdded: existingValues.has('deepgram') },
      { value: 'openai', label: 'OpenAI', icon: Cloud, hasKey: !!cloudKeys.openai_key, alreadyAdded: existingValues.has('openai') },
      { value: 'browser', label: 'דפדפן (pyannote)', icon: Globe, hasKey: true, alreadyAdded: existingValues.has('browser') },
    ];
  }, [entries, cloudKeys]);

  // ── Single entry: split view with result on left, picker on right ──
  if (entries.length === 1) {
    const firstEntry = entries[0];
    const engines = getAvailableEngines();

    return (
      <div className="flex flex-col h-[calc(100vh-64px)]" dir="rtl">
        {/* Top Bar */}
        <div className="shrink-0 border-b px-4 py-2 flex items-center justify-between bg-background">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <GitCompareArrows className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">השוואת זיהוי דוברים</h1>
              <p className="text-[10px] text-muted-foreground">בחר מנוע נוסף להשוואה</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => navigate('/diarization')}>
            <ArrowRight className="w-3.5 h-3.5" />
            חזרה
          </Button>
        </div>

        {/* Split: left = result, right = engine picker */}
        <div className="flex-1 min-h-0 flex">
          {/* Left: existing result */}
          <div className="flex-1 min-w-0 min-h-0 border-l overflow-hidden flex">
            <EngineColumn
              entry={firstEntry}
              idx={0}
              canClear={false}
              currentTime={currentTime}
              onSeek={handleSeek}
              audioUrl={audioUrl}
              searchQuery=""
              highlightedSegIdx={null}
              onHighlightSeg={() => {}}
              otherEntry={null}
              speakerMap={new Map()}
              onPlaySegment={handlePlaySegment}
              mergeSelections={new Map()}
              onToggleMerge={() => {}}
              side="left"
              showMerge={false}
              scrollRef={leftScrollRef}
              onScroll={() => {}}
              syncPlaybackEnabled={syncPlaybackEnabled}
              onSyncSeekPlay={syncSeekPlay}
              onSyncPauseAll={pauseAll}
              onRegisterAudio={registerAudio}
              onClearColumn={handleClearEntry}
              onSaveColumn={handleSaveEntry}
              onRenameColumn={handleRenameEntry}
              dmp={dmp}
            />
          </div>

          {/* Right: engine picker */}
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col items-center justify-center p-6 bg-muted/10">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Zap className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-lg font-bold mb-2">הוסף מנוע להשוואה</h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
              בחר מנוע זיהוי דוברים נוסף כדי להשוות את התוצאות זה מול זה
            </p>
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
              {engines.map(eng => (
                <Button
                  key={eng.value}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 relative hover:bg-primary/5 hover:border-primary/30"
                  disabled={!eng.hasKey || runningEngines.has(eng.value) || eng.alreadyAdded}
                  onClick={() => handleAddEngine(eng.value)}
                >
                  {runningEngines.has(eng.value) ? (
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  ) : (
                    <eng.icon className="w-6 h-6 text-primary" />
                  )}
                  <span className="text-sm font-medium">{eng.label}</span>
                  {!eng.hasKey && <span className="text-[9px] text-destructive">חסר מפתח</span>}
                  {eng.alreadyAdded && <span className="text-[9px] text-muted-foreground">כבר נוסף</span>}
                  {runningEngines.has(eng.value) && (() => {
                    const jobId = pendingEngineJobs[eng.value];
                    const job = queue.jobs.find(j => j.id === jobId);
                    return (
                      <span className="text-[9px] text-muted-foreground">
                        {job?.progressStage || 'מעבד...'} {job && job.progress > 0 ? `(${Math.round(job.progress)}%)` : ''}
                      </span>
                    );
                  })()}
                </Button>
              ))}
            </div>
            {runningEngines.size > 0 && (
              <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                מריץ זיהוי דוברים במקביל... ({runningEngines.size})
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── No entries: empty state ──
  if (entries.length === 0) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <GitCompareArrows className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold mb-2">השוואת מנועי זיהוי דוברים</h2>
        <p className="text-muted-foreground mb-6">הרץ זיהוי דוברים ולחץ על טאב "השוואה" כדי להשוות מנועים</p>
        <Button onClick={() => navigate('/diarization')} className="gap-2">
          <Users className="w-4 h-4" />
          לדף זיהוי דוברים
        </Button>
      </div>
    );
  }

  const pairAgreement = comparisons.find(c =>
    (c.aIdx === diffPair[0] && c.bIdx === diffPair[1]) || (c.aIdx === diffPair[1] && c.bIdx === diffPair[0])
  );

  return (
    <div ref={containerRef} className={`flex flex-col ${isFullscreen ? 'h-screen bg-background' : 'h-[calc(100vh-64px)]'}`} dir="rtl">
      {/* ═══ Top Bar ═══ */}
      <div className="shrink-0 border-b px-4 py-2 flex items-center justify-between flex-wrap gap-2 print:hidden bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <GitCompareArrows className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">השוואת זיהוי דוברים</h1>
            <p className="text-[10px] text-muted-foreground">{entries.length} מנועים · {formatDuration(entries[0]?.result.duration || 0)}</p>
          </div>
          {pairAgreement && (
            <Badge variant="secondary" className="text-sm font-bold mr-2">
              התאמה: {Math.round(pairAgreement.agreement)}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Enhancement 5: Search bar */}
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="חיפוש..."
              className="h-7 w-36 text-xs pr-7"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Enhancement 1: Sync scroll toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={syncScrollEnabled ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7 gap-1"
                  onClick={() => setSyncScrollEnabled(!syncScrollEnabled)}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{syncScrollEnabled ? 'גלילה מסונכרנת: פעיל' : 'גלילה מסונכרנת: כבוי'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Sync playback controls */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={syncPlaybackEnabled ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7 gap-1"
                  onClick={() => setSyncPlaybackEnabled(!syncPlaybackEnabled)}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  סנכרון ניגון
                </Button>
              </TooltipTrigger>
              <TooltipContent>{syncPlaybackEnabled ? 'ניגון מסונכרן: פעיל' : 'נגנים עצמאיים: פעיל'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {audioUrl && entries.length > 1 && (
            <>
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={playAll}>
                <Play className="w-3.5 h-3.5" />
                Play all
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={pauseAll}>
                <Pause className="w-3.5 h-3.5" />
                Pause all
              </Button>
            </>
          )}

          {/* Enhancement 8: Merge toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showMerge ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7 gap-1"
                  onClick={() => setShowMerge(!showMerge)}
                >
                  <Merge className="w-3.5 h-3.5" />
                  מיזוג
                </Button>
              </TooltipTrigger>
              <TooltipContent>בחר את הקטעים הטובים מכל מנוע</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Pair selector for >2 engines */}
          {entries.length > 2 && comparisons.map((c, i) => (
            <Button
              key={i}
              variant={diffPair[0] === c.aIdx && diffPair[1] === c.bIdx ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7 gap-1"
              onClick={() => setDiffPair([c.aIdx, c.bIdx])}
            >
              {c.a} ↔ {c.b}
            </Button>
          ))}

          {/* Local engine quality controls */}
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground">Local</Label>
            <Button
              variant={qualityByEngine.local === 'fast' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setQualityByEngine(prev => ({ ...prev, local: 'fast' }))}
            >
              Fast
            </Button>
            <Button
              variant={qualityByEngine.local === 'accurate' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setQualityByEngine(prev => ({ ...prev, local: 'accurate' }))}
            >
              Accurate
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground">WhisperX</Label>
            <Button
              variant={qualityByEngine.whisperx === 'fast' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setQualityByEngine(prev => ({ ...prev, whisperx: 'fast' }))}
            >
              Fast
            </Button>
            <Button
              variant={qualityByEngine.whisperx === 'accurate' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setQualityByEngine(prev => ({ ...prev, whisperx: 'accurate' }))}
            >
              Accurate
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground">במקביל</Label>
            {[1, 2, 3, 4].map(n => (
              <Button
                key={n}
                variant={queue.maxConcurrent === n ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => queue.setMaxConcurrent(n)}
              >
                {n}
              </Button>
            ))}
          </div>

          {/* Add engine button */}
          {(() => {
            const avail = getAvailableEngines();
            if (avail.length === 0) return null;
            return (
              <Select value="" onValueChange={(engine) => handleAddEngine(engine)}>
                <SelectTrigger className="h-7 w-auto text-xs gap-1 border-primary/30">
                  {runningEngines.size > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  הוסף מנוע
                </SelectTrigger>
                <SelectContent>
                  {avail.map(eng => (
                    <SelectItem key={eng.value} value={eng.value} disabled={!eng.hasKey || eng.alreadyAdded || runningEngines.has(eng.value)}>
                      {eng.label} {eng.alreadyAdded ? '(כבר נוסף)' : !eng.hasKey ? '(חסר מפתח)' : runningEngines.has(eng.value) ? '(בעיבוד)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })()}

          <Separator orientation="vertical" className="h-5 mx-1" />
          <Button variant={showAnalysis ? 'default' : 'outline'} size="sm" className="text-xs h-7 gap-1" onClick={() => setShowAnalysis(!showAnalysis)}>
            <BarChart3 className="w-3.5 h-3.5" />
            ניתוח
          </Button>
          <TooltipProvider>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={exportAsJSON}>
                <Download className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger><TooltipContent>ייצוא JSON</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={exportAsText}>
                <FileText className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger><TooltipContent>ייצוא טקסט</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger><TooltipContent>הדפסה</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger><TooltipContent>{isFullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'}</TooltipContent></Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => navigate('/diarization')}>
            <ArrowRight className="w-3.5 h-3.5" />
            חזרה
          </Button>
        </div>
      </div>

      {/* ═══ Split-Screen: Dynamic Columns Per Engine ═══ */}
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div
          className="grid min-h-0 h-full items-stretch"
          style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(360px, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}
        >
          {entries.map((entry, i) => {
            const isLeftPair = i === diffPair[0];
            const isRightPair = i === diffPair[1];
            const side: 'left' | 'right' = isRightPair ? 'right' : 'left';
            const otherEntry = isLeftPair ? entries[diffPair[1]] : isRightPair ? entries[diffPair[0]] : null;
            const columnScrollRef = isLeftPair ? leftScrollRef : isRightPair ? rightScrollRef : undefined;
            const columnOnScroll = isLeftPair ? handleLeftScroll : isRightPair ? handleRightScroll : undefined;

            return (
              <div key={`${entry.label}-${i}`} className={`min-w-0 min-h-0 overflow-hidden flex ${i > 0 ? 'border-l' : ''}`}>
                <EngineColumn
                  entry={entry}
                  idx={i}
                  canClear={entries.length > 1}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  audioUrl={audioUrl}
                  searchQuery={searchQuery}
                  highlightedSegIdx={highlightedSegIdx}
                  onHighlightSeg={setHighlightedSegIdx}
                  otherEntry={otherEntry}
                  speakerMap={speakerMap}
                  onPlaySegment={handlePlaySegment}
                  mergeSelections={mergeSelections}
                  onToggleMerge={handleToggleMerge}
                  side={side}
                  showMerge={showMerge}
                  scrollRef={columnScrollRef}
                  onScroll={columnOnScroll}
                  syncPlaybackEnabled={syncPlaybackEnabled}
                  onSyncSeekPlay={syncSeekPlay}
                  onSyncPauseAll={pauseAll}
                  onRegisterAudio={registerAudio}
                  onClearColumn={handleClearEntry}
                  onSaveColumn={handleSaveEntry}
                  onRenameColumn={handleRenameEntry}
                  dmp={dmp}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Merge Panel (Enhancement 8) ═══ */}
      {showMerge && mergeSelections.size > 0 && (
        <div className="shrink-0 border-t bg-green-50 dark:bg-green-950/20 max-h-[30vh] overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Merge className="w-4 h-4 text-green-600" />
                <span className="font-bold text-sm">תמלול ממוזג</span>
                <Badge variant="outline" className="text-[10px]">{mergeSelections.size} קטעים נבחרו</Badge>
              </div>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => navigator.clipboard.writeText(mergedTranscript)}>
                <Copy className="w-3 h-3" />
                העתק
              </Button>
            </div>
            <pre className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-40 overflow-y-auto">{mergedTranscript}</pre>
          </div>
        </div>
      )}

      {/* ═══ Analysis Panel (collapsible) ═══ */}
      {showAnalysis && (
        <div className="shrink-0 border-t bg-background max-h-[50vh] overflow-y-auto">
          <div className="p-4 space-y-4">
            <Tabs defaultValue="diff" className="w-full" dir="rtl">
              <TabsList className="w-full max-w-2xl mb-3">
                <TabsTrigger value="diff" className="flex-1 text-xs gap-1.5">
                  <GitCompareArrows className="w-3.5 h-3.5" />
                  השוואת טקסט
                </TabsTrigger>
                <TabsTrigger value="timeline" className="flex-1 text-xs gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  ציר זמן
                </TabsTrigger>
                <TabsTrigger value="stats" className="flex-1 text-xs gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />
                  סטטיסטיקות
                </TabsTrigger>
              </TabsList>

              <TabsContent value="diff" className="space-y-4">
                <AgreementMatrix entries={entries} comparisons={comparisons} activePair={diffPair} onSelectPair={setDiffPair} />
                <SideBySideDiff entries={entries} diffPair={diffPair} dmp={dmp} />
              </TabsContent>

              <TabsContent value="timeline" className="space-y-4">
                <TimelineComparison entries={entries} diffPair={diffPair} />
                <AgreementMatrix entries={entries} comparisons={comparisons} activePair={diffPair} onSelectPair={setDiffPair} />
              </TabsContent>

              <TabsContent value="stats" className="space-y-4">
                <EngineStatsCards entries={entries} />
                <AgreementMatrix entries={entries} comparisons={comparisons} activePair={diffPair} onSelectPair={setDiffPair} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiarizationComparePage;
