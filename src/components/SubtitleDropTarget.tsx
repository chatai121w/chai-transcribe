import { useCallback, useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { importSubtitles, isSubtitleFilename } from '@/lib/subtitleImport';
import type { WordTiming } from '@/components/SyncAudioPlayer';

interface Props {
  children: React.ReactNode;
  /** נקרא אחרי ייבוא מוצלח. */
  onImported: (timings: WordTiming[], text: string, info: { cues: number; words: number }) => void;
  onError?: (message: string) => void;
  /** אורך המדיה בשניות, אם ידוע — לבדיקת התאמה. */
  mediaDuration?: number | null;
  /** כבוי פירושו שהגרירה אינה פעילה. */
  enabled?: boolean;
  className?: string;
}

/**
 * עוטף את הנגן והופך אותו למקבל קובצי כתוביות בגרירה.
 *
 * למה עטיפה ולא הוספה בתוך הנגן: הנגן כבר משתמש בגרירה לסידור
 * הכפתורים שלו. הוספת טיפול בקבצים לאותו רכיב הייתה מתנגשת עם זה,
 * וגרירת כפתור הייתה נראית כמו גרירת קובץ. העטיפה מפרידה בין
 * השניים: היא מגיבה רק לגרירה שיש בה קובץ.
 *
 * שתי נקודות שלא מובנות מאליהן:
 *
 *  1. **הספירה.** אירועי הכניסה והיציאה נורים גם כשהעכבר עובר בין
 *     רכיבים פנימיים. בלי מונה, הסימון מהבהב בכל תנועה. המונה
 *     סופר כניסות ויציאות ומכבה רק כשהוא חוזר לאפס.
 *
 *  2. **רק גרירה של קובץ.** גרירת טקסט או כפתור מתוך הנגן אינה
 *     אמורה להדליק את הסימון.
 */
export function SubtitleDropTarget({
  children, onImported, onError, mediaDuration, enabled = true, className,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const hasFile = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes('Files');

  const handleFile = useCallback(async (file: File) => {
    if (!isSubtitleFilename(file.name)) {
      onError?.(`הקובץ "${file.name}" אינו קובץ כתוביות. נדרשת סיומת srt או vtt.`);
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      onError?.('לא הצלחתי לקרוא את הקובץ.');
      return;
    }
    const imported = importSubtitles(raw);
    if (!imported.cues.length) {
      onError?.(`לא נמצא אף קטע תקין בקובץ. ${imported.warnings.join(' ')}`);
      return;
    }

    // אזהרת התאמה. לא חוסמים — ייתכן שהמשתמש יודע מה הוא עושה —
    // אבל כתוביות שאינן מאותה הקלטה נראות תקינות עד שמנסים לנגן.
    if (mediaDuration && mediaDuration > 0) {
      const lastEnd = imported.cues[imported.cues.length - 1].end;
      const ratio = lastEnd / mediaDuration;
      if (ratio > 1.05) {
        onError?.(
          `הכתוביות נמשכות ${(lastEnd / 60).toFixed(1)} דקות אבל המדיה רק ` +
          `${(mediaDuration / 60).toFixed(1)} — ייתכן שהם לא מאותה הקלטה.`);
      } else if (ratio < 0.8) {
        onError?.(
          `הכתוביות מכסות ${Math.round(ratio * 100)} אחוז מהמדיה בלבד. ` +
          `הסוף כנראה חסר.`);
      }
    }

    onImported(
      imported.words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      imported.cues.map((c) => c.text).join(' '),
      { cues: imported.cues.length, words: imported.words.length },
    );
  }, [onImported, onError, mediaDuration]);

  if (!enabled) return <>{children}</>;

  return (
    <div
      className={['relative', className].filter(Boolean).join(' ')}
      onDragEnter={(e) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFile(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
    >
      {children}

      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/90 backdrop-blur-[1px]"
          style={{ animation: 'guide-backdrop 167ms ease-out both' }}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-base font-semibold">שחרר כאן את קובץ הכתוביות</span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              srt או vtt · הטקסט יסתנכרן למדיה
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
