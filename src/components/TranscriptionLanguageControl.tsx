import { useMemo } from "react";
import { Languages, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TRANSCRIPTION_LANGUAGES,
  type ManualTranscriptionLanguage,
  type SourceLanguage,
} from "@/lib/transcriptionLanguages";

interface TranscriptionLanguageControlProps {
  value: SourceLanguage;
  onChange: (language: SourceLanguage) => void;
  compact?: boolean;
}

const LAST_MANUAL_LANGUAGE_KEY = "transcript_last_manual_language";

function getLastManualLanguage(): ManualTranscriptionLanguage {
  try {
    const saved = localStorage.getItem(LAST_MANUAL_LANGUAGE_KEY);
    if (TRANSCRIPTION_LANGUAGES.some(({ code }) => code === saved)) {
      return saved as ManualTranscriptionLanguage;
    }
  } catch { /* localStorage is optional */ }
  return "he";
}

export function TranscriptionLanguageControl({ value, onChange, compact = false }: TranscriptionLanguageControlProps) {
  const isAuto = value === "auto";
  const manualValue = useMemo(() => value === "auto" ? getLastManualLanguage() : value, [value]);

  const selectManual = (language: ManualTranscriptionLanguage) => {
    try { localStorage.setItem(LAST_MANUAL_LANGUAGE_KEY, language); } catch { /* noop */ }
    onChange(language);
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"} dir="rtl">
      {!compact && <Label className="block text-right text-sm font-semibold">שפת הדיבור באודיו</Label>}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="אופן בחירת שפת התמלול">
        <Button
          type="button"
          size="sm"
          variant={isAuto ? "default" : "outline"}
          aria-pressed={isAuto}
          onClick={() => onChange("auto")}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          זיהוי אוטומטי
        </Button>
        <Button
          type="button"
          size="sm"
          variant={!isAuto ? "default" : "outline"}
          aria-pressed={!isAuto}
          onClick={() => selectManual(manualValue)}
          className="gap-2"
        >
          <Languages className="h-4 w-4" />
          בחירה ידנית
        </Button>
      </div>

      {!isAuto && (
        <Select value={value} onValueChange={(language) => selectManual(language as ManualTranscriptionLanguage)}>
          <SelectTrigger className="w-full text-right" dir="rtl" aria-label="שפה ידנית מחייבת">
            <SelectValue placeholder="בחר שפה" />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {TRANSCRIPTION_LANGUAGES.map(({ code, label, nativeLabel }) => (
              <SelectItem key={code} value={code}>
                {label}{nativeLabel !== label ? ` · ${nativeLabel}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <p className="text-right text-xs text-muted-foreground">
        {isAuto
          ? "המנוע יזהה את השפה ויתמלל באותה שפה. לא תתבצע כפייה לעברית; היקף הזיהוי תלוי בספק."
          : `השפה שנבחרה מחייבת את המנוע; לא יתבצע זיהוי או מעבר אוטומטי לשפה אחרת.`}
      </p>
    </div>
  );
}
