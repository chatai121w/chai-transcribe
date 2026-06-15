/**
 * /ab-compare — Compare two recordings/transcripts side-by-side.
 *
 * Use cases:
 *   • A/B: run the same audio with different toggles, paste both transcripts
 *     here, see exactly what changed.
 *   • Manual: compare any two transcripts (e.g. two engines, before/after
 *     editing) plus their audio.
 *
 * Two independent audio players with optional sync (play/pause/seek mirror).
 * Word-level diff highlighting + similarity stats so the user can tell if a
 * toggle improved or regressed accuracy.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitCompareArrows,
  Link2,
  Link2Off,
  Upload,
  ArrowLeftRight,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import DiffMatchPatch from "diff-match-patch";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────

interface Side {
  label: string;
  audioUrl: string | null;
  audioName: string;
  text: string;
}

const EMPTY_SIDE: Side = { label: "", audioUrl: null, audioName: "", text: "" };

// ── Diff helpers ─────────────────────────────────────────────

const dmp = new DiffMatchPatch();

interface DiffToken {
  op: -1 | 0 | 1;
  text: string;
}

function wordDiff(a: string, b: string): DiffToken[] {
  // Tokenize by whitespace boundaries — works well for Hebrew.
  const re = /(\s+)/;
  const A = a.split(re).filter(Boolean);
  const B = b.split(re).filter(Boolean);

  // Map each unique token to a single char so DMP runs on words, not chars.
  const map = new Map<string, string>();
  const back: string[] = [];
  const encode = (arr: string[]) =>
    arr
      .map(tok => {
        let ch = map.get(tok);
        if (!ch) {
          if (back.length > 0xfff0) return ""; // safety
          ch = String.fromCharCode(0xe000 + back.length); // private use area
          map.set(tok, ch);
          back.push(tok);
        }
        return ch;
      })
      .join("");

  const eA = encode(A);
  const eB = encode(B);
  const diffs = dmp.diff_main(eA, eB);
  dmp.diff_cleanupSemantic(diffs);

  const out: DiffToken[] = [];
  for (const [op, str] of diffs) {
    const words = Array.from(str as string).map((ch: string) => back[ch.charCodeAt(0) - 0xe000] || "");
    out.push({ op: op as -1 | 0 | 1, text: words.join("") });
  }
  return out;
}

function diffStats(diffs: DiffToken[]): {
  added: number;
  removed: number;
  same: number;
  similarity: number;
} {
  const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
  let added = 0, removed = 0, same = 0;
  for (const d of diffs) {
    const n = count(d.text);
    if (d.op === 1) added += n;
    else if (d.op === -1) removed += n;
    else same += n;
  }
  const total = added + removed + same;
  const similarity = total === 0 ? 100 : Math.round((same / total) * 100);
  return { added, removed, same, similarity };
}

// ── DiffView ─────────────────────────────────────────────────

function DiffView({
  diffs,
  side,
  showUnchanged,
}: {
  diffs: DiffToken[];
  side: "A" | "B";
  showUnchanged: boolean;
}) {
  return (
    <div className="text-sm leading-7 whitespace-pre-wrap break-words" dir="rtl">
      {diffs.map((d, i) => {
        // Side A shows removed (op=-1) + unchanged (op=0). Side B shows added (op=1) + unchanged (op=0).
        if (side === "A" && d.op === 1) return null;
        if (side === "B" && d.op === -1) return null;
        if (!showUnchanged && d.op === 0) {
          // Keep spaces between changed tokens
          if (d.text.trim() === "") return <span key={i}>{d.text}</span>;
          return <span key={i} className="text-muted-foreground/40">…</span>;
        }
        const cls =
          d.op === 1
            ? "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 rounded px-0.5"
            : d.op === -1
              ? "bg-destructive/20 text-destructive rounded px-0.5 line-through decoration-1"
              : "";
        return (
          <span key={i} className={cls}>
            {d.text}
          </span>
        );
      })}
    </div>
  );
}

// ── Player slot ─────────────────────────────────────────────

function SideSlot({
  side,
  data,
  onChange,
  audioRef,
}: {
  side: "A" | "B";
  data: Side;
  onChange: (next: Side) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (data.audioUrl) URL.revokeObjectURL(data.audioUrl);
    const url = URL.createObjectURL(file);
    onChange({ ...data, audioUrl: url, audioName: file.name });
  };

  return (
    <Card className="p-4 space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={side === "A" ? "default" : "secondary"} className="font-bold">
            {side}
          </Badge>
          <Input
            value={data.label}
            onChange={e => onChange({ ...data, label: e.target.value })}
            placeholder={`תווית (לדוגמה: ${side === "A" ? "VAD כבוי" : "VAD פעיל"})`}
            className="h-8 text-sm w-56"
            dir="rtl"
          />
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            אודיו
          </Button>
          {data.audioUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (data.audioUrl) URL.revokeObjectURL(data.audioUrl);
                onChange({ ...data, audioUrl: null, audioName: "" });
              }}
              title="הסר אודיו"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {data.audioUrl ? (
        <audio
          ref={audioRef}
          src={data.audioUrl}
          controls
          className="w-full"
          preload="metadata"
        />
      ) : (
        <div className="border border-dashed rounded-md p-4 text-center text-xs text-muted-foreground">
          לא נטען אודיו — לחץ "אודיו" להעלאה
        </div>
      )}

      {data.audioName && (
        <p className="text-[11px] text-muted-foreground truncate">{data.audioName}</p>
      )}

      <div>
        <Label className="text-xs text-muted-foreground">תמלול</Label>
        <Textarea
          value={data.text}
          onChange={e => onChange({ ...data, text: e.target.value })}
          placeholder="הדבק כאן את התמלול…"
          dir="rtl"
          className="min-h-[180px] text-sm leading-7 mt-1"
        />
        <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
          <span>{data.text.split(/\s+/).filter(Boolean).length} מילים</span>
          <span>{data.text.length} תווים</span>
        </div>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────

const STORAGE_KEY = "ab_compare_state_v1";

export default function ABCompare() {
  const [sideA, setSideA] = useState<Side>(EMPTY_SIDE);
  const [sideB, setSideB] = useState<Side>(EMPTY_SIDE);
  const [syncPlayers, setSyncPlayers] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(true);

  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const isMirroring = useRef(false);

  // Restore text-only state (audio Blob URLs don't survive reload).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.A) setSideA(s => ({ ...s, label: parsed.A.label || "", text: parsed.A.text || "" }));
      if (parsed?.B) setSideB(s => ({ ...s, label: parsed.B.label || "", text: parsed.B.text || "" }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        A: { label: sideA.label, text: sideA.text },
        B: { label: sideB.label, text: sideB.text },
      }));
    } catch { /* ignore */ }
  }, [sideA.label, sideA.text, sideB.label, sideB.text]);

  // Player sync — mirror play/pause/seek from each side to the other.
  useEffect(() => {
    if (!syncPlayers) return;
    const a = audioARef.current;
    const b = audioBRef.current;
    if (!a || !b) return;

    const mirror = (src: HTMLAudioElement, dst: HTMLAudioElement) => {
      const onPlay = () => {
        if (isMirroring.current) return;
        isMirroring.current = true;
        dst.play().catch(() => { /* ignore */ });
        setTimeout(() => { isMirroring.current = false; }, 0);
      };
      const onPause = () => {
        if (isMirroring.current) return;
        isMirroring.current = true;
        dst.pause();
        setTimeout(() => { isMirroring.current = false; }, 0);
      };
      const onSeek = () => {
        if (isMirroring.current) return;
        if (Math.abs(dst.currentTime - src.currentTime) < 0.3) return;
        isMirroring.current = true;
        dst.currentTime = src.currentTime;
        setTimeout(() => { isMirroring.current = false; }, 0);
      };
      src.addEventListener("play", onPlay);
      src.addEventListener("pause", onPause);
      src.addEventListener("seeked", onSeek);
      return () => {
        src.removeEventListener("play", onPlay);
        src.removeEventListener("pause", onPause);
        src.removeEventListener("seeked", onSeek);
      };
    };

    const offA = mirror(a, b);
    const offB = mirror(b, a);
    return () => { offA?.(); offB?.(); };
  }, [syncPlayers, sideA.audioUrl, sideB.audioUrl]);

  const diffs = useMemo(() => {
    if (!sideA.text && !sideB.text) return [];
    return wordDiff(sideA.text, sideB.text);
  }, [sideA.text, sideB.text]);

  const stats = useMemo(() => diffStats(diffs), [diffs]);

  const swap = () => {
    setSideA(sideB);
    setSideB(sideA);
    toast({ title: "הוחלף", description: "A ↔ B" });
  };

  const reset = () => {
    if (!confirm("לאפס את שני הצדדים?")) return;
    if (sideA.audioUrl) URL.revokeObjectURL(sideA.audioUrl);
    if (sideB.audioUrl) URL.revokeObjectURL(sideB.audioUrl);
    setSideA(EMPTY_SIDE);
    setSideB(EMPTY_SIDE);
  };

  return (
    <div dir="rtl" className="container max-w-7xl py-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompareArrows className="h-6 w-6" />
            השוואת A/B
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            השווה הקלטות ותמלולים זה לצד זה — דע בדיוק איזה טוגל משפר ואיזה גורם לרגרסיה.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
            {syncPlayers ? <Link2 className="h-4 w-4 text-primary" /> : <Link2Off className="h-4 w-4 text-muted-foreground" />}
            <Label htmlFor="sync-toggle" className="text-xs cursor-pointer">
              סנכרון נגנים
            </Label>
            <Switch id="sync-toggle" checked={syncPlayers} onCheckedChange={setSyncPlayers} />
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={swap}>
            <ArrowLeftRight className="h-4 w-4" />
            החלף
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={reset}>
            <Trash2 className="h-4 w-4" />
            אפס
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SideSlot side="A" data={sideA} onChange={setSideA} audioRef={audioARef} />
        <SideSlot side="B" data={sideB} onChange={setSideB} audioRef={audioBRef} />
      </div>

      <Card className="p-4 space-y-3" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">השוואת תמלולים</h2>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="gap-1">
              דמיון: <span className="font-bold">{stats.similarity}%</span>
            </Badge>
            <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
              נוסף: +{stats.added}
            </Badge>
            <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
              הוסר: -{stats.removed}
            </Badge>
            <Badge variant="outline">זהה: {stats.same}</Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowUnchanged(v => !v)}
            >
              {showUnchanged ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showUnchanged ? "הצג רק שינויים" : "הצג הכל"}
            </Button>
          </div>
        </div>

        <Separator />

        {diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            הזן תמלולים בשני הצדדים כדי לראות השוואה.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs font-medium mb-2 text-muted-foreground">
                A {sideA.label && `— ${sideA.label}`}
              </div>
              <DiffView diffs={diffs} side="A" showUnchanged={showUnchanged} />
            </div>
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs font-medium mb-2 text-muted-foreground">
                B {sideB.label && `— ${sideB.label}`}
              </div>
              <DiffView diffs={diffs} side="B" showUnchanged={showUnchanged} />
            </div>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground border-t pt-2 leading-relaxed">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/20 align-middle ms-1" />
          ירוק = קיים ב-B ולא ב-A &nbsp;·&nbsp;
          <span className="inline-block w-3 h-3 rounded bg-destructive/20 align-middle ms-1" />
          אדום = קיים ב-A ולא ב-B
        </div>
      </Card>
    </div>
  );
}
