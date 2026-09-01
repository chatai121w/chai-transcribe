import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, File, Loader2, Braces, Archive } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useTranscriptFormatting } from "@/hooks/useTranscriptFormatting";
import { buildTranscriptDocxBlob } from "@/lib/transcriptDocx";


interface ExportButtonProps {
  text: string;
  title?: string;
  disabled?: boolean;
  wordTimings?: Array<{ word: string; start: number; end: number }>;
  compact?: boolean;
  className?: string;
}

export const ExportButton = ({ text, title = "תמלול", disabled, wordTimings, compact = false, className }: ExportButtonProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const formatter = useTranscriptFormatting();

  const exportToPDF = async () => {
    setIsExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // Add Hebrew font support - use built-in Helvetica (limited Hebrew support)
      // For full Hebrew, we'll use Unicode text rendering
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const maxWidth = pageWidth - margin * 2;

      // Title
      doc.setFontSize(18);
      doc.text(title, pageWidth - margin, 20, { align: "right" });

      // Date
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      const dateStr = new Date().toLocaleString('he-IL');
      doc.text(dateStr, pageWidth - margin, 28, { align: "right" });

      // Content
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);

      const lines = doc.splitTextToSize(text, maxWidth);
      let y = 40;

      for (const line of lines) {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, pageWidth - margin, y, { align: "right" });
        y += 7;
      }

      doc.save(`${title}-${Date.now()}.pdf`);
      toast({ title: "PDF הורד בהצלחה" });
    } catch (error) {
      console.error("PDF export error:", error);
      toast({ title: "שגיאה בייצוא PDF", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToDOCX = async (formatWithAi: boolean) => {
    setIsExporting(true);
    try {
      const exportText = formatWithAi ? await formatter.run(text, 'fix_and_split') : text;
      const { saveAs } = await import("file-saver");
      const blob = await buildTranscriptDocxBlob(exportText, title, new Date().toLocaleString('he-IL'));
      saveAs(blob, `${title}-${Date.now()}.docx`);
      toast({ title: "DOCX הורד בהצלחה", description: formatWithAi ? "הטקסט פוסק וחולק לפסקאות לפני הייצוא" : "נשמר במבנה RTL" });
    } catch (error) {
      console.error("DOCX export error:", error);
      toast({ title: "שגיאה בייצוא DOCX", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToTXT = async () => {
    const { saveAs } = await import("file-saver");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    saveAs(blob, `${title}-${Date.now()}.txt`);
    toast({ title: "TXT הורד בהצלחה" });
  };

  const exportToJSON = async () => {
    const { saveAs } = await import("file-saver");
    const data = {
      title,
      text,
      exportedAt: new Date().toISOString(),
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      ...(wordTimings && wordTimings.length > 0 ? {
        wordTimings: wordTimings.map(w => ({
          word: w.word,
          start: w.start,
          end: w.end,
          ...('probability' in w && w.probability != null ? { probability: (w as any).probability } : {}),
        })),
        audioDuration: wordTimings[wordTimings.length - 1]?.end,
      } : {}),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    saveAs(blob, `${title}-${Date.now()}.json`);
    toast({ title: "JSON הורד בהצלחה" });
  };

  const formatTimeSRT = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };

  const formatTimeVTT = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  const buildSubtitleSegments = () => {
    if (!wordTimings || wordTimings.length === 0) return [];
    const segments: Array<{ start: number; end: number; text: string }> = [];
    let segWords: typeof wordTimings = [];
    for (const w of wordTimings) {
      segWords.push(w);
      if (segWords.length >= 8 || (segments.length > 0 && w.end - segWords[0].start > 5)) {
        segments.push({ start: segWords[0].start, end: segWords[segWords.length - 1].end, text: segWords.map(sw => sw.word).join(' ') });
        segWords = [];
      }
    }
    if (segWords.length > 0) {
      segments.push({ start: segWords[0].start, end: segWords[segWords.length - 1].end, text: segWords.map(sw => sw.word).join(' ') });
    }
    return segments;
  };

  const exportToSRT = async () => {
    const segments = buildSubtitleSegments();
    if (segments.length === 0) {
      toast({ title: "אין חותמות זמן", description: "SRT דורש חותמות זמן — תמלל עם שרת CUDA", variant: "destructive" });
      return;
    }
    const { saveAs } = await import("file-saver");
    const srt = segments.map((seg, i) =>
      `${i + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`
    ).join('\n');
    const blob = new Blob([srt], { type: "text/srt;charset=utf-8" });
    saveAs(blob, `${title}-${Date.now()}.srt`);
    toast({ title: "SRT הורד בהצלחה" });
  };

  const exportToVTT = async () => {
    const segments = buildSubtitleSegments();
    if (segments.length === 0) {
      toast({ title: "אין חותמות זמן", description: "VTT דורש חותמות זמן — תמלל עם שרת CUDA", variant: "destructive" });
      return;
    }
    const { saveAs } = await import("file-saver");
    const vtt = 'WEBVTT\n\n' + segments.map((seg, i) =>
      `${i + 1}\n${formatTimeVTT(seg.start)} --> ${formatTimeVTT(seg.end)}\n${seg.text}\n`
    ).join('\n');
    const blob = new Blob([vtt], { type: "text/vtt;charset=utf-8" });
    saveAs(blob, `${title}-${Date.now()}.vtt`);
    toast({ title: "VTT הורד בהצלחה" });
  };

  const exportAllAsZip = async () => {
    setIsExporting(true);
    try {
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import("jszip"),
        import("file-saver"),
      ]);
      const zip = new JSZip();
      const ts = Date.now();
      const baseName = title;

      // TXT
      zip.file(`${baseName}.txt`, text);

      // JSON
      const jsonData = {
        title, text,
        exportedAt: new Date().toISOString(),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        charCount: text.length,
        ...(wordTimings && wordTimings.length > 0 ? {
          wordTimings: wordTimings.map(w => ({ word: w.word, start: w.start, end: w.end })),
          audioDuration: wordTimings[wordTimings.length - 1]?.end,
        } : {}),
      };
      zip.file(`${baseName}.json`, JSON.stringify(jsonData, null, 2));

      // SRT & VTT (only if word timings exist)
      const segments = buildSubtitleSegments();
      if (segments.length > 0) {
        const srt = segments.map((seg, i) =>
          `${i + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`
        ).join('\n');
        zip.file(`${baseName}.srt`, srt);

        const vtt = 'WEBVTT\n\n' + segments.map((seg, i) =>
          `${i + 1}\n${formatTimeVTT(seg.start)} --> ${formatTimeVTT(seg.end)}\n${seg.text}\n`
        ).join('\n');
        zip.file(`${baseName}.vtt`, vtt);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${baseName}-${ts}.zip`);
      toast({ title: "ZIP הורד בהצלחה", description: "כל הפורמטים בקובץ אחד" });
    } catch (error) {
      console.error("ZIP export error:", error);
      toast({ title: "שגיאה בייצוא ZIP", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !text.trim() || isExporting}
          className={cn(compact && "h-6 gap-1 px-2 text-[10px]", className)}
          title="ייצוא התמלול"
          data-testid="export-transcript"
        >
          {isExporting ? (
            <Loader2 className={cn("animate-spin", compact ? "h-3 w-3" : "ml-2 h-4 w-4")} />
          ) : (
            <Download className={cn(compact ? "h-3 w-3" : "ml-2 h-4 w-4")} />
          )}
          ייצוא
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 text-right" style={{ direction: "rtl" }}>
        <DropdownMenuItem onClick={exportToPDF}>
          <File className="w-4 h-4 ml-2" />
          ייצוא ל-PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportToDOCX(true)}>
          <FileText className="w-4 h-4 ml-2" />
          Word עם פיסוק ופסקאות
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportToDOCX(false)}>
          <FileText className="w-4 h-4 ml-2" />
          Word כפי שמופיע
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToTXT}>
          <FileText className="w-4 h-4 ml-2" />
          ייצוא ל-TXT
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToJSON}>
          <Braces className="w-4 h-4 ml-2" />
          ייצוא ל-JSON (מטא-דאטה)
        </DropdownMenuItem>
        {wordTimings && wordTimings.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={exportToSRT}>
              <FileText className="w-4 h-4 ml-2" />
              ייצוא ל-SRT (כתוביות)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportToVTT}>
              <FileText className="w-4 h-4 ml-2" />
              ייצוא ל-VTT (כתוביות)
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportAllAsZip}>
          <Archive className="w-4 h-4 ml-2" />
          ייצוא הכול (ZIP)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
