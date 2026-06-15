import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Youtube, Loader2, Copy, Download, CheckCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface YouTubeTranscriberProps {
  serverUrl?: string;
  onTranscriptComplete: (text: string) => void;
}

export const YouTubeTranscriber = ({ serverUrl = "/whisper", onTranscriptComplete }: YouTubeTranscriberProps) => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    text: string;
    duration: number;
    processing_time: number;
    language: string;
    segments: number;
  } | null>(null);

  const isValidYouTubeUrl = (url: string) => {
    return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w\-]+/.test(url);
  };

  const handleTranscribe = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isValidYouTubeUrl(trimmed)) {
      toast({ title: "כתובת לא תקינה", description: "יש להזין כתובת YouTube חוקית", variant: "destructive" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${serverUrl}/youtube-transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, language: "he" }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "שגיאה", description: data.error || "שגיאה בתמלול", variant: "destructive" });
        return;
      }

      setResult({
        text: data.text,
        duration: data.duration,
        processing_time: data.processing_time,
        language: data.language,
        segments: data.segments,
      });

      toast({ title: "תמלול YouTube הושלם!", description: `${data.segments} קטעים, ${data.processing_time}s` });
    } catch (err) {
      toast({ title: "שגיאת חיבור", description: "לא ניתן להתחבר לשרת", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUseTranscript = () => {
    if (result?.text) {
      onTranscriptComplete(result.text);
    }
  };

  const handleCopy = () => {
    if (result?.text) {
      navigator.clipboard.writeText(result.text);
      toast({ title: "הועתק ללוח" });
    }
  };

  const handleDownload = () => {
    if (!result?.text) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "youtube-transcript.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Youtube className="w-5 h-5 text-red-500" />
        <h3 className="text-lg font-semibold">תמלול מ-YouTube</h3>
      </div>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="הדבק כתובת YouTube כאן..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && handleTranscribe()}
          className="flex-1"
          dir="ltr"
          disabled={loading}
        />
        <Button onClick={handleTranscribe} disabled={loading || !url.trim()}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin ml-1" />
          ) : (
            <Youtube className="w-4 h-4 ml-1" />
          )}
          {loading ? "מוריד ומתמלל..." : "תמלל"}
        </Button>
      </div>

      {loading && (
        <div className="text-center text-muted-foreground py-4 text-sm animate-pulse">
          מוריד אודיו מ-YouTube ומתמלל... זה עלול לקחת דקה או שתיים.
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary">
              אורך: {formatDuration(result.duration)}
            </Badge>
            <Badge variant="secondary">
              עיבוד: {result.processing_time}s
            </Badge>
            <Badge variant="secondary">
              שפה: {result.language}
            </Badge>
            <Badge variant="secondary">
              {result.segments} קטעים
            </Badge>
          </div>

          {/* Text preview */}
          <div className="rounded-md border p-4 bg-muted/30 max-h-[250px] overflow-y-auto text-right leading-relaxed whitespace-pre-wrap text-sm">
            {result.text}
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="w-4 h-4 ml-1" />
              העתק
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 ml-1" />
              הורד
            </Button>
            <Button size="sm" onClick={handleUseTranscript}>
              <CheckCircle className="w-4 h-4 ml-1" />
              השתמש בתמלול
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-3">
        דורש yt-dlp מותקן על השרת. מוריד ומתמלל עם Whisper GPU.
      </p>
    </Card>
  );
};
