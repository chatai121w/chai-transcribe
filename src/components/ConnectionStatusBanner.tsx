import { useState, useEffect } from "react";
import { WifiOff, Wifi, ServerCrash, RefreshCw } from "lucide-react";

interface ConnectionStatusBannerProps {
  serverConnected: boolean;
  serverUrl?: string;
}

export const ConnectionStatusBanner = ({ serverConnected, serverUrl }: ConnectionStatusBannerProps) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showBanner, setShowBanner] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        // Show "back online" briefly
        setTimeout(() => setShowBanner(false), 3000);
      }
    };
    const onOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [wasOffline]);

  // Show banner when offline or server disconnected
  useEffect(() => {
    setShowBanner(!isOnline || !serverConnected);
  }, [isOnline, serverConnected]);

  if (!showBanner) return null;

  if (!isOnline) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 text-destructive-foreground px-4 py-2 text-sm backdrop-blur-sm" dir="rtl">
        <WifiOff className="w-4 h-4 animate-pulse" />
        <span>אין חיבור לאינטרנט — תמלול מקומי בלבד (ענן לא זמין)</span>
        <button
          onClick={() => window.location.reload()}
          className="mr-2 flex items-center gap-1 rounded-md border border-destructive-foreground/30 px-2 py-0.5 text-xs hover:bg-destructive-foreground/10 transition"
        >
          <RefreshCw className="w-3 h-3" />
          נסה שוב
        </button>
      </div>
    );
  }

  if (!serverConnected) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-yellow-500/90 text-yellow-950 px-4 py-2 text-sm backdrop-blur-sm" dir="rtl">
        <ServerCrash className="w-4 h-4" />
        <span>שרת GPU מנותק — תמלול מקומי לא זמין</span>
        <span className="text-[10px] opacity-70">({serverUrl || '/whisper'})</span>
      </div>
    );
  }

  // Back online flash
  if (wasOffline && isOnline && serverConnected) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-green-500/90 text-white px-4 py-2 text-sm backdrop-blur-sm animate-fade-in" dir="rtl">
        <Wifi className="w-4 h-4" />
        <span>חזר לאונליין!</span>
      </div>
    );
  }

  return null;
};
