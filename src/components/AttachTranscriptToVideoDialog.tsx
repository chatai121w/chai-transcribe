import { useMemo, useRef, useState } from "react";
import { Captions, Download, FileVideo, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WordTiming } from "@/components/SyncAudioPlayer";
import { TRANSLATION_LANGUAGES } from "@/lib/translation";
import { buildSubtitleTracks, wordTimingsToSubtitleSegments } from "@/lib/subtitleTracks";
import { fetchLocalServer, getServerUrl } from "@/lib/serverConfig";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wordTimings: WordTiming[];
  transcriptTitle?: string;
}

const LANGUAGES = TRANSLATION_LANGUAGES.filter((language) => ["he", "en", "de", "fr", "es", "yi"].includes(language.code));

export function AttachTranscriptToVideoDialog({ open, onOpenChange, wordTimings, transcriptTitle }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [languages, setLanguages] = useState(["he", "en"]);
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(false);
  const segments = useMemo(() => wordTimingsToSubtitleSegments(wordTimings), [wordTimings]);

  const toggleLanguage = (language: string, checked: boolean) => {
    setLanguages((current) => checked ? [...new Set([...current, language])] : current.filter((item) => item !== language));
  };

  const createVideo = async () => {
    if (!video || !segments.length || !languages.length) return;
    setWorking(true);
    setProgress(2);
    try {
      const tracks = await buildSubtitleTracks(segments, "he", languages, model, async (value) => setProgress(Math.max(3, Math.round(value * 0.85))));
      setProgress(88);
      const form = new FormData();
      form.append("video", video);
      form.append("tracks", JSON.stringify(tracks));
      const response = await fetchLocalServer(`${getServerUrl()}/media/subtitles`, { method: "POST", body: form });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || "חיבור הכתוביות לווידאו נכשל");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(transcriptTitle || video.name.replace(/\.[^.]+$/, "") || "video").replace(/[\\/:*?"<>|]+/g, "-")}-with-subtitles.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setProgress(100);
      toast({ title: "הווידאו מוכן", description: "הקובץ עם מסלולי הכתוביות ירד למחשב." });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "יצירת הווידאו נכשלה", description: error instanceof Error ? error.message : "נסה שוב", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !working && onOpenChange(value)}>
      <DialogContent dir="rtl" className="max-w-xl text-right" data-testid="attach-transcript-video-dialog">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-right"><Captions className="h-5 w-5" /> חיבור התמלול לווידאו</DialogTitle>
          <p className="text-sm text-muted-foreground">הכתוביות יוטמעו כמסלולים מתחלפים לפי התזמונים של התמלול הפתוח.</p>
        </DialogHeader>

        <div className="space-y-4">
          <input ref={inputRef} type="file" accept="video/*,.mp4,.mkv,.mov,.webm" className="hidden" onChange={(event) => setVideo(event.target.files?.[0] || null)} />
          <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 py-3" onClick={() => inputRef.current?.click()} disabled={working}>
            <FileVideo className="h-5 w-5 shrink-0" />
            <span className="min-w-0 text-right"><span className="block truncate font-medium">{video?.name || "בחר קובץ וידאו"}</span><span className="block text-xs text-muted-foreground">MP4, MKV, MOV או WebM</span></span>
          </Button>

          <div>
            <Label className="mb-2 block">שפות כתוביות</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((language) => (
                <label key={language.code} className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm">
                  <Checkbox checked={languages.includes(language.code)} onCheckedChange={(checked) => toggleLanguage(language.code, checked === true)} disabled={working} />
                  {language.label}
                </label>
              ))}
            </div>
          </div>

          {languages.some((language) => language !== "he") && (
            <div>
              <Label className="mb-2 block">מנוע תרגום</Label>
              <Select value={model} onValueChange={setModel} disabled={working}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google/gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                  <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                  <SelectItem value="openai/gpt-5-mini">GPT-5 Mini</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!segments.length && <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">אין לתמלול תזמוני מילים. יש לבצע תחילה "יישור מדויק" מול האודיו.</p>}
          {working && <div className="space-y-1"><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="text-xs text-muted-foreground">{progress < 88 ? "מתרגם ומכין כתוביות..." : "מחבר את הכתוביות לווידאו..."}</p></div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>סגור</Button>
          <Button type="button" onClick={() => void createVideo()} disabled={working || !video || !segments.length || !languages.length}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} צור והורד וידאו
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
