import { usePWAInstall } from '@/hooks/usePWAInstall';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const PWAInstallButton = () => {
  const { canInstall, install } = usePWAInstall();

  if (!canInstall) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          onClick={install}
          className="fixed bottom-28 left-4 z-50 w-11 h-11 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 border-0 animate-in fade-in slide-in-from-bottom-2"
        >
          <Download className="h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>התקן את האפליקציה</p>
      </TooltipContent>
    </Tooltip>
  );
};
