import { useState, useEffect, ReactNode } from "react";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import { PWAInstallBanner } from "./PWAInstallBanner";
import { GlobalJobsWidget } from "./GlobalJobsWidget";

const SIDEBAR_WIDTH = 260;

const AppLayout = ({ children }: { children: ReactNode }) => {
  const [isPinned, setIsPinned] = useState(() => {
    try {
      return localStorage.getItem("sidebar-pinned") === "true";
    } catch {
      return false;
    }
  });
  const [isOpen, setIsOpen] = useState(false);
  const [serverConnected, setServerConnected] = useState(true);

  useEffect(() => {
    const pinHandler = (e: Event) => {
      setIsPinned((e as CustomEvent).detail);
    };
    const openHandler = (e: Event) => {
      setIsOpen((e as CustomEvent).detail);
    };
    // Listen for server connection status from useLocalServer
    const serverHandler = (e: Event) => {
      setServerConnected((e as CustomEvent).detail);
    };
    window.addEventListener("sidebar-pin-change", pinHandler);
    window.addEventListener("sidebar-open-change", openHandler);
    window.addEventListener("server-connection-change", serverHandler);
    return () => {
      window.removeEventListener("sidebar-pin-change", pinHandler);
      window.removeEventListener("sidebar-open-change", openHandler);
      window.removeEventListener("server-connection-change", serverHandler);
    };
  }, []);

  const showMargin = isPinned || isOpen;

  return (
    <div
      className="min-h-screen transition-all duration-300"
      dir="rtl"
      style={{ marginRight: showMargin ? SIDEBAR_WIDTH : 0 }}
    >
      <ConnectionStatusBanner serverConnected={serverConnected} />
      <PWAInstallBanner />
      {children}
      <GlobalJobsWidget />
    </div>
  );
};

export default AppLayout;
