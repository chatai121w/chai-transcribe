import { FlaskConical, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface VerifiedTranscriptLabTransferProps {
  hasAudio: boolean;
  hasText: boolean;
  busy: boolean;
  onApproveAndOpenLab: () => void;
}

export function VerifiedTranscriptLabTransfer({
  hasAudio,
  hasText,
  busy,
  onApproveAndOpenLab,
}: VerifiedTranscriptLabTransferProps) {
  return (
    <section dir="rtl" aria-label="העברה למעבדת התמלול" className="w-full border-y border-border bg-card/60 px-3 py-3 text-right">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
            טקסט אמת ומעבדת תמלול
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={hasText ? 'secondary' : 'outline'}>טקסט מתוקן</Badge>
            <Badge variant={hasAudio ? 'secondary' : 'destructive'}>{hasAudio ? 'אודיו מקושר' : 'אין אודיו מקושר'}</Badge>
            <span>התמלול המקורי נשמר בנפרד; הטקסט הנוכחי ישמש אמת למדידת A/B.</span>
          </div>
        </div>
        <Button onClick={onApproveAndOpenLab} disabled={!hasText || !hasAudio || busy}>
          {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <FlaskConical className="me-2 h-4 w-4" />}
          {busy ? 'שומר וטוען...' : 'אשר והעבר למעבדה'}
        </Button>
      </div>
    </section>
  );
}
