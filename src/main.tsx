import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { debugLog } from "./lib/debugLogger";
import App from "./App.tsx";
import { TauriSetupGate } from "./components/TauriSetupGate";
import "./index.css";
import "react-grid-layout/css/styles.css";
import "./styles/studio-grid.css";

// Clean up stale localStorage entries (word timings can be huge)
try {
  const MAX_LS_AGE_DAYS = 7;
  const tsKey = 'ls_cleanup_ts';
  const lastCleanup = Number(localStorage.getItem(tsKey) || '0');
  if (Date.now() - lastCleanup > MAX_LS_AGE_DAYS * 86_400_000) {
    ['last_word_timings', 'perf_records', 'crash_buffer'].forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw && raw.length > 500_000) localStorage.removeItem(k);
    });
    localStorage.setItem(tsKey, String(Date.now()));
  }
} catch { /* localStorage not available */ }

debugLog.info('Boot', `🚀 אתחול אפליקציה — ${new Date().toLocaleTimeString('he-IL')}`, {
  url: location.href,
  userAgent: navigator.userAgent,
  sessionId: debugLog.getSessionId(),
});

const stopBoot = debugLog.time('Boot', 'React mount');
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TauriSetupGate>
      <App />
    </TauriSetupGate>
  </StrictMode>
);
stopBoot();
