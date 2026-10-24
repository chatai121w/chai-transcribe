import { useCallback, useRef, useState } from "react";
import { Upload, FileText, AlertTriangle, Check } from "lucide-react";
import { importSubtitles, isSubtitleFilename, type SubtitleImportResult } from "@/lib/subtitleImport";
import type { WordTiming } from "@/components/SyncAudioPlayer";

interface Props {
  /** נקרא עם התזמונים והטקסט אחרי ייבוא מוצלח. */
  onImported: (timings: WordTiming[], text: string, info: SubtitleImportResult) => void;
  /** אורך האודיו בשניות, אם ידוע — משמש לבדיקת התאמה. */
  audioDuration?: number | null;
  className?: string;
}

/**
 * אזור לגרירה או בחירה של קובץ כתוביות, שהופך אותו לתזמון ברמת המילה.
 *
 * למה גם גרירה וגם בחירה: גרירה נוחה כשהקובץ כבר פתוח בסייר, ובחירה נוחה
 * כשהוא קבור בתיקייה. שתי הדרכים מגיעות לאותו קוד.
 */
export function SubtitleDropZone({ onImported, audioDuration, className }: Props) {
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<SubtitleImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setResult(null);

    if (!isSubtitleFilename(file.name)) {
      setError(`הקובץ "${file.name}" אינו קובץ כתוביות. נדרש קובץ עם סיומת srt או vtt.`);
      return;
    }

    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setError("לא הצלחתי לקרוא את הקובץ.");
      return;
    }

    const imported = importSubtitles(raw);
    if (!imported.cues.length) {
      setError(`לא נמצא אף קטע תקין בקובץ. ${imported.warnings.join(" ")}`);
      return;
    }

    // אזהרת התאמה לאודיו. לא חוסמים — ייתכן שהמשתמש יודע מה הוא עושה —
    // אבל חייבים להגיד, כי כתוביות שלא מתאימות לאודיו נראות תקינות לגמרי
    // עד שמנסים לנגן, וזה בדיוק סוג התקלה שמתגלה מאוחר מדי.
    const warnings = [...imported.warnings];
    if (audioDuration && audioDuration > 0) {
      const lastEnd = imported.cues[imported.cues.length - 1].end;
      const ratio = lastEnd / audioDuration;
      if (ratio > 1.05) {
        warnings.push(
          `הכתוביות נמשכות ${(lastEnd / 60).toFixed(1)} דקות אבל האודיו רק ` +
          `${(audioDuration / 60).toFixed(1)} — ייתכן שהם לא מאותה הקלטה.`
        );
      } else if (ratio < 0.8) {
        warnings.push(
          `הכתוביות מכסות ${Math.round(ratio * 100)} אחוז מהאודיו בלבד. ` +
          `הסוף כנראה חסר.`
        );
      }
    }

    const text = imported.cues.map((c) => c.text).join(" ");
    const timings: WordTiming[] = imported.words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    setFilename(file.name);
    setResult({ ...imported, warnings });
    onImported(timings, text, { ...imported, warnings });
  }, [audioDuration, onImported]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="אזור גרירה לקובץ כתוביות"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        className={[
          "rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors",
          dragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/40",
        ].join(" ")}
      >
        <Upload className="mx-auto mb-2 h-7 w-7 opacity-60" aria-hidden />
        <div className="font-medium">גרור לכאן קובץ כתוביות</div>
        <div className="text-sm text-muted-foreground mt-1">
          או לחץ לבחירה מהמחשב · srt או vtt
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".srt,.vtt,.webvtt,text/vtt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Check className="h-4 w-4 text-green-600" aria-hidden />
            <FileText className="h-4 w-4 opacity-60" aria-hidden />
            <span className="truncate">{filename}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-semibold">{result.cues.length}</div>
              <div className="text-xs text-muted-foreground">קטעים</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{result.words.length}</div>
              <div className="text-xs text-muted-foreground">מילים</div>
            </div>
            <div>
              <div className="text-lg font-semibold">
                {(result.durationCovered / 60).toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground">דקות</div>
            </div>
          </div>
          {result.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-400">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            הסנכרון מדויק ברמת המשפט ומשוער ברמת המילה הבודדת, כי קובץ כתוביות
            נותן זמנים לקטעים שלמים ולא למילים.
          </p>
        </div>
      )}
    </div>
  );
}
