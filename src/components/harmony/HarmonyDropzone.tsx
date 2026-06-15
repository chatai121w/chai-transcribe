import { useCallback, useRef, useState } from "react";
import { Upload, FileAudio } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  fileName?: string;
}

export function HarmonyDropzone({ onFile, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("audio/")) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {fileName ? (
            <FileAudio className="h-6 w-6 text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
        </div>
        {fileName ? (
          <div>
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <p className="mt-1 text-xs text-muted-foreground">לחץ או גרור כדי להחליף</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-foreground">גרור קובץ ווקאל לכאן או לחץ לבחירה</p>
            <p className="mt-1 text-xs text-muted-foreground">WAV, MP3, M4A · אקפלה נותן את התוצאה הטובה ביותר</p>
          </div>
        )}
      </div>
    </div>
  );
}
