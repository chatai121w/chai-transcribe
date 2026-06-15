import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Listens for service worker updates and shows a toast prompting the user to reload.
 * Mount once in App.tsx or the root layout.
 */
export function SWUpdateNotifier() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATE_AVAILABLE") {
        toast({
          title: "עדכון זמין 🔄",
          description: "גרסה חדשה של האפליקציה זמינה. לחץ כאן לרענון.",
          duration: 15000,
          action: (
            <button
              onClick={() => {
                navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
                window.location.reload();
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              רענן כעת
            </button>
          ),
        });
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);

    // Also check if there's a waiting SW right now
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        handleMessage({ data: { type: "SW_UPDATE_AVAILABLE" } } as MessageEvent);
      }
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            handleMessage({ data: { type: "SW_UPDATE_AVAILABLE" } } as MessageEvent);
          }
        });
      });
    });

    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  return null;
}
