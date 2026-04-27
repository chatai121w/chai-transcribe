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
import CloudKeySync from "./components/CloudKeySync";
import { ThemeShortcutListener } from "./components/ThemeShortcutListener";
import { SmartConsole } from "./components/SmartConsole";
import { TranscriptionAnalytics } from "./components/TranscriptionAnalytics";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { BackgroundSync } from "./components/BackgroundSync";
import { SWUpdateNotifier } from "./components/SWUpdateNotifier";
import { DiarizationQueueProvider } from "./contexts/DiarizationQueueContext";
import { DiarizationFloatingStatus } from "./components/DiarizationFloatingStatus";
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
          <CloudKeySync />
          <BackgroundSync />
          <SWUpdateNotifier />
          {devFloatingButtons.smartConsole && <SmartConsole />}
          {devFloatingButtons.transcriptionAnalytics && <TranscriptionAnalytics />}
          {devFloatingButtons.pwaInstall && <PWAInstallButton />}
          {devFloatingButtons.diarizationStatus && <DiarizationFloatingStatus />}
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
