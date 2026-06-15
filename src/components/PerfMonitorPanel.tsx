import { useState } from "react";
import type { PerfRecord } from "@/hooks/usePerfMonitor";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, X, ChevronDown, ChevronUp } from "lucide-react";

interface PerfMonitorPanelProps {
  records: PerfRecord[];
  onClear: () => void;
  onClose: () => void;
}

function fmtSpeed(x: number) {
  if (x >= 10) return `${x.toFixed(0)}x`;
  return `${x.toFixed(1)}x`;
}

function fmtTime(s: number) {
  if (s < 0.01) return "—";
  return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
}

function fmtPct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function speedBadge(x: number) {
  if (x >= 15) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (x >= 5)  return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
}

function hebrewBadge(r: number) {
  if (r >= 0.7) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (r >= 0.4) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
}

export function PerfMonitorPanel({ records, onClear, onClose }: PerfMonitorPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const successRecords = records.filter(r => r.status === "success");

  // Averages
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const avgSpeed = avg(successRecords.map(r => r.speedX));
  const avgProc = avg(successRecords.map(r => r.processingTime));
  const avgWall = avg(successRecords.map(r => r.wallTime));
  const avgHebrew = avg(successRecords.map(r => r.hebrewRatio));
  const avgCoverage = avg(successRecords.map(r => r.timestampCoverage));

  return (
    <Card className="border-purple-500/30 bg-purple-500/5 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
          {records.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive" onClick={onClear}>
              <Trash2 className="h-3 w-3 ml-1" />
              נקה
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">📊 מוניטור ביצועים</h3>
          <Badge variant="outline" className="text-[10px]">{records.length} רשומות</Badge>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Summary row */}
          {successRecords.length > 0 && (
            <div className="flex flex-wrap gap-3 p-3 text-xs border-b border-purple-500/10 bg-purple-500/5 justify-end">
              <span>ממוצע מהירות: <strong>{fmtSpeed(avgSpeed)}</strong></span>
              <span>עיבוד: <strong>{fmtTime(avgProc)}</strong></span>
              <span>סה״כ: <strong>{fmtTime(avgWall)}</strong></span>
              <span>עברית: <strong>{fmtPct(avgHebrew)}</strong></span>
              <span>כיסוי timestamps: <strong>{fmtPct(avgCoverage)}</strong></span>
            </div>
          )}

          {records.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              אין רשומות עדיין — בצע תמלול כדי לראות נתונים
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead className="text-right w-[60px]">שעה</TableHead>
                    <TableHead className="text-right">קובץ</TableHead>
                    <TableHead className="text-center w-[50px]">אודיו</TableHead>
                    <TableHead className="text-center w-[55px]">GPU</TableHead>
                    <TableHead className="text-center w-[55px]">סה״כ</TableHead>
                    <TableHead className="text-center w-[55px]">מהירות</TableHead>
                    <TableHead className="text-center w-[45px]">מילים</TableHead>
                    <TableHead className="text-center w-[50px]">עברית</TableHead>
                    <TableHead className="text-center w-[35px]">TS</TableHead>
                    <TableHead className="text-center w-[50px]">מנוע</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r, i) => {
                    // Compare with previous record
                    const prev = i < records.length - 1 ? records[i + 1] : null;
                    const speedDelta = prev && prev.speedX > 0
                      ? ((r.speedX - prev.speedX) / prev.speedX) * 100 : null;

                    return (
                      <TableRow key={r.id} className={`text-[11px] ${r.status === "failed" ? "bg-red-500/5" : ""}`}>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {fmtDate(r.timestamp)}
                        </TableCell>
                        <TableCell className="text-right max-w-[120px] truncate" title={r.fileName}>
                          {r.fileName}
                          <span className="text-muted-foreground mr-1">({fmtSize(r.fileSize)})</span>
                        </TableCell>
                        <TableCell className="text-center">{r.audioDuration.toFixed(0)}s</TableCell>
                        <TableCell className="text-center font-mono">{fmtTime(r.processingTime)}</TableCell>
                        <TableCell className="text-center font-mono">{fmtTime(r.wallTime)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] px-1 ${speedBadge(r.speedX)}`}>
                            {fmtSpeed(r.speedX)}
                          </Badge>
                          {speedDelta !== null && Math.abs(speedDelta) > 5 && (
                            <span className={`text-[9px] mr-0.5 ${speedDelta > 0 ? "text-green-600" : "text-red-500"}`}>
                              {speedDelta > 0 ? "▲" : "▼"}{Math.abs(speedDelta).toFixed(0)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{r.wordCount}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] px-1 ${hebrewBadge(r.hebrewRatio)}`}>
                            {fmtPct(r.hebrewRatio)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {r.timestampCount > 0 ? (
                            <span title={`כיסוי: ${fmtPct(r.timestampCoverage)}`}>
                              {r.timestampCount}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-[9px] px-1">
                            {r.engine.includes("CUDA") ? "CUDA" : r.engine.includes("ONNX") ? "ONNX" : r.engine.split(" ")[0]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </>
      )}
    </Card>
  );
}
