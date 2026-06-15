import { useState } from "react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

export const PWAInstallBanner = () => {
  const { canInstall, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("pwa-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });

  if (!canInstall || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem("pwa-banner-dismissed", "1"); } catch {}
  };

  const handleInstall = async () => {
    const success = await install();
    if (success) handleDismiss();
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-primary/10 border-b border-primary/20 text-sm" dir="rtl">
      <div className="flex items-center gap-2 flex-1">
        <Download className="w-4 h-4 text-primary shrink-0" />
        <span>התקן את האפליקציה למכשיר שלך לגישה מהירה ושימוש אופליין</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleInstall}>
          התקן
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleDismiss}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
