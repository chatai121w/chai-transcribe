import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import AppSidebar from "./components/AppSidebar";
import AppLayout from "./components/AppLayout";
import { Loader2 } from "lucide-react";
import { ThemeShortcutListener } from "./components/ThemeShortcutListener";
import { DiarizationQueueProvider } from "./contexts/DiarizationQueueContext";
import { useTheme } from "./hooks/useTheme";
import { debugLog } from "./lib/debugLogger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  DEV_FLOATING_BUTTONS_EVENT,
  DEV_FLOATING_BUTTONS_STORAGE_KEY,
  loadDevFloatingButtonsVisibility,
  type DevFloatingButtonsVisibility,
} from "./lib/devFloatingButtons";

// Lazy load with logging + auto-reload on stale chunk
function lazyWithLog(name: string, factory: () => Promise<{ default: React.ComponentType<unknown> }>) {
  return lazy(() => {
    const stop = debugLog.time('LazyLoad', name);
    return factory().then(mod => {
      stop();
      return mod;
    }).catch(err => {
      debugLog.error('LazyLoad', `❌ Failed: ${name}`, err?.message);
      // If chunk fetch failed (stale deploy), reload once
      const key = `chunk_reload_${name}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        debugLog.info('LazyLoad', `🔄 Reloading page for stale chunk: ${name}`);
        window.location.reload();
      }
      throw err;
    });
  });
}

const Dashboard = lazyWithLog('Dashboard', () => import("./pages/Dashboard"));
const Index = lazyWithLog('Transcribe', () => import("./pages/Index"));
const Login = lazyWithLog('Login', () => import("./pages/Login"));
const Settings = lazyWithLog('Settings', () => import("./pages/Settings"));
const Setup = lazyWithLog('Setup', () => import("./pages/Setup"));
const TextEditor = lazyWithLog('TextEditor', () => import("./pages/TextEditor"));
const Folders = lazyWithLog('Folders', () => import("./pages/Folders"));
const Benchmark = lazyWithLog('Benchmark', () => import("./pages/Benchmark"));
const Diarization = lazyWithLog('Diarization', () => import("./pages/Diarization"));
const DiarizationCompare = lazyWithLog('DiarizationCompare', () => import("./pages/DiarizationComparePage"));
const VoiceStudio = lazyWithLog('VoiceStudio', () => import("./pages/VoiceStudio"));
const AudacityLab = lazyWithLog('AudacityLab', () => import("./pages/AudacityLab"));
const NotFound = lazyWithLog('NotFound', () => import("./pages/NotFound"));
const ResetPassword = lazyWithLog('ResetPassword', () => import("./pages/ResetPassword"));
const VideoToMp3 = lazyWithLog('VideoToMp3', () => import("./pages/VideoToMp3"));
const AudioCleanLab = lazyWithLog('AudioCleanLab', () => import("./pages/AudioCleanLab"));
const Harmonika = lazyWithLog('Harmonika', () => import("./pages/Harmonika"));
const MeetingRecorder = lazyWithLog('MeetingRecorder', () => import("./pages/MeetingRecorder"));
const VoiceCommandAdmin = lazyWithLog('VoiceCommandAdmin', () => import("./pages/VoiceCommandAdmin"));

// Lazy non-critical UI widgets — defer past first paint
const SmartConsoleLazy = lazy(() => import("./components/SmartConsole").then(m => ({ default: m.SmartConsole })));
const TranscriptionAnalyticsLazy = lazy(() => import("./components/TranscriptionAnalytics").then(m => ({ default: m.TranscriptionAnalytics })));
const PWAInstallButtonLazy = lazy(() => import("./components/PWAInstallButton").then(m => ({ default: m.PWAInstallButton })));
const BackgroundSyncLazy = lazy(() => import("./components/BackgroundSync").then(m => ({ default: m.BackgroundSync })));
const SWUpdateNotifierLazy = lazy(() => import("./components/SWUpdateNotifier").then(m => ({ default: m.SWUpdateNotifier })));
const CloudKeySyncLazy = lazy(() => import("./components/CloudKeySync"));
const DiarizationFloatingStatusLazy = lazy(() => import("./components/DiarizationFloatingStatus").then(m => ({ default: m.DiarizationFloatingStatus })));
const VoiceInputFABLazy = lazy(() => import("./components/VoiceInputFAB").then(m => ({ default: m.VoiceInputFAB })));

/** Mounts children only after the browser is idle / a delay — keeps them off the critical path. */
function DeferredMount({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const idle = (cb: () => void) => {
      const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
      if (typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(cb, { timeout: 1500 });
      } else {
        setTimeout(cb, 200);
      }
    };
    const t = setTimeout(() => idle(() => setShow(true)), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

/** Logs route changes */
const RouteLogger = () => {
  const location = useLocation();
  const prevPath = useRef(location.pathname);
  useEffect(() => {
    debugLog.info('Router', `📍 ${prevPath.current} → ${location.pathname}`);
    prevPath.current = location.pathname;
  }, [location.pathname]);
  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  useEffect(() => {
    if (isLoading) {
      debugLog.info('Auth', '🔄 ProtectedRoute: ממתין לאימות...');
    } else if (!isAuthenticated) {
      debugLog.info('Auth', '🚫 ProtectedRoute: לא מאומת → redirect /login');
    } else {
      debugLog.info('Auth', '✅ ProtectedRoute: מאומת');
    }
  }, [isLoading, isAuthenticated]);
  if (isLoading) return <PageLoader label="auth" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

/** Spinner with logging */
const PageLoader = ({ label = 'page' }: { label?: string }) => {
  const startRef = useRef(Date.now());
  useEffect(() => {
    debugLog.info('Spinner', `⏳ Spinner מוצג (${label})`);
    return () => {
      const elapsed = Date.now() - startRef.current;
      debugLog.perf('Spinner', `Spinner הוסתר (${label})`, elapsed);
    };
  }, [label]);
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

const App = () => {
  // Initialize theme on app load
  useTheme();
  const queryClient = useMemo(() => new QueryClient(), []);
  const [devFloatingButtons, setDevFloatingButtons] = useState<DevFloatingButtonsVisibility>(() => loadDevFloatingButtonsVisibility());

  useEffect(() => {
    debugLog.info('App', '📦 App component mounted');
    return () => debugLog.info('App', '📦 App component unmounted');
  }, []);

  // Prefetch likely routes after idle — eliminates spinner on first navigation
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    const prefetchAll = () => {
      // High-priority: most visited pages
      import("./pages/Dashboard").catch(() => {});
      import("./pages/Index").catch(() => {});
      import("./pages/Settings").catch(() => {});
    };
    const prefetchSecondary = () => {
      // Lower-priority: prefetch after the primary ones land
      import("./pages/TextEditor").catch(() => {});
      import("./pages/Folders").catch(() => {});
      import("./pages/Diarization").catch(() => {});
      import("./pages/VoiceStudio").catch(() => {});
      import("./pages/MeetingRecorder").catch(() => {});
      import("./pages/AudioCleanLab").catch(() => {});
    };
    const prefetchRare = () => {
      import("./pages/Benchmark").catch(() => {});
      import("./pages/VideoToMp3").catch(() => {});
      import("./pages/AudacityLab").catch(() => {});
      import("./pages/Harmonika").catch(() => {});
      import("./pages/DiarizationComparePage").catch(() => {});
    };

    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(prefetchAll, { timeout: 3000 });
      w.requestIdleCallback(prefetchSecondary, { timeout: 6000 });
      w.requestIdleCallback(prefetchRare, { timeout: 12000 });
    } else {
      setTimeout(prefetchAll, 1500);
      setTimeout(prefetchSecondary, 4000);
      setTimeout(prefetchRare, 8000);
    }
  }, []);

  useEffect(() => {
    const handleConfigEvent = (event: Event) => {
      const customEvent = event as CustomEvent<DevFloatingButtonsVisibility>;
      if (customEvent.detail) {
        setDevFloatingButtons(customEvent.detail);
      } else {
        setDevFloatingButtons(loadDevFloatingButtonsVisibility());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === DEV_FLOATING_BUTTONS_STORAGE_KEY) {
        setDevFloatingButtons(loadDevFloatingButtonsVisibility());
      }
    };

    window.addEventListener(DEV_FLOATING_BUTTONS_EVENT, handleConfigEvent as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(DEV_FLOATING_BUTTONS_EVENT, handleConfigEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DiarizationQueueProvider>
          <RouteLogger />
          <ThemeShortcutListener />
          <DeferredMount delay={0}><CloudKeySyncLazy /></DeferredMount>
          <DeferredMount delay={500}><BackgroundSyncLazy /></DeferredMount>
          <DeferredMount delay={1000}><SWUpdateNotifierLazy /></DeferredMount>
          {devFloatingButtons.smartConsole && <DeferredMount delay={1500}><SmartConsoleLazy /></DeferredMount>}
          {devFloatingButtons.transcriptionAnalytics && <DeferredMount delay={1500}><TranscriptionAnalyticsLazy /></DeferredMount>}
          {devFloatingButtons.pwaInstall && <DeferredMount delay={2000}><PWAInstallButtonLazy /></DeferredMount>}
          {devFloatingButtons.diarizationStatus && <DeferredMount delay={500}><DiarizationFloatingStatusLazy /></DeferredMount>}
          <DeferredMount delay={800}><VoiceInputFABLazy /></DeferredMount>
          <AppSidebar />
          <AppLayout>
            <Suspense fallback={<PageLoader label="suspense" />}>
              <Routes>
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/transcribe" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                <Route path="/login" element={<Login />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/setup" element={<ProtectedRoute><Setup /></ProtectedRoute>} />
                <Route path="/text-editor" element={<ProtectedRoute><TextEditor /></ProtectedRoute>} />
                <Route path="/folders" element={<ProtectedRoute><Folders /></ProtectedRoute>} />
                <Route path="/benchmark" element={<ProtectedRoute><Benchmark /></ProtectedRoute>} />
                <Route path="/voice-studio" element={<ProtectedRoute><VoiceStudio /></ProtectedRoute>} />
                <Route path="/audacity-lab" element={<ProtectedRoute><AudacityLab /></ProtectedRoute>} />
                <Route path="/diarization" element={<ProtectedRoute><Diarization /></ProtectedRoute>} />
                <Route path="/diarization/compare" element={<ProtectedRoute><DiarizationCompare /></ProtectedRoute>} />
                <Route path="/video-to-mp3" element={<ProtectedRoute><VideoToMp3 /></ProtectedRoute>} />
                <Route path="/audio-clean" element={<ProtectedRoute><AudioCleanLab /></ProtectedRoute>} />
                <Route path="/harmonika" element={<ProtectedRoute><Harmonika /></ProtectedRoute>} />
                <Route path="/meeting-recorder" element={<ProtectedRoute><MeetingRecorder /></ProtectedRoute>} />
                <Route path="/voice-command-admin" element={<ProtectedRoute><VoiceCommandAdmin /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppLayout>
          </DiarizationQueueProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ErrorBoundary>
  );
};

export default App;
