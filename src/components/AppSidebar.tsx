import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { useCloudFolders } from "@/hooks/useCloudFolders";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Mic,
  FileText,
  Settings,
  LogIn,
  LogOut,
  Pin,
  PinOff,
  User,
  ChevronLeft,
  Folder,
  FolderPlus,
  FolderOpen,
  ChevronDown,
  Plus,
  Trash2,
  Server,
  BarChart3,
  Music,
  Menu,
  Users,
  GitCompareArrows,
  Waves,
  SlidersHorizontal,
  Wand2,
  AudioLines,
  Video,
  Youtube,
  Bot,
  ScrollText,
  Scissors,
  Palette,
} from "lucide-react";
import { openQuickCut } from "@/lib/quickCutBus";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/useTheme";

const SIDEBAR_WIDTH = 260;
const TRIGGER_ZONE = 16;
const SWIPE_THRESHOLD = 50;

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const navItems: NavItem[] = [
  { label: "דשבורד", icon: LayoutDashboard, path: "/" },
  { label: "תמלול", icon: Mic, path: "/transcribe" },
  { label: "תמלול מ-YouTube", icon: Youtube, path: "/youtube" },
  { label: "מקליט פגישות", icon: Video, path: "/meeting-recorder" },
  { label: "סטודיו קול", icon: Waves, path: "/voice-studio" },
  { label: "אודסיטי לאב", icon: SlidersHorizontal, path: "/audacity-lab" },
  { label: "ניקוי קול", icon: Wand2, path: "/audio-clean" },
  { label: "תיקיות", icon: FolderOpen, path: "/folders" },
  { label: "עורך טקסט", icon: FileText, path: "/text-editor" },
  { label: "בנצ'מארק", icon: BarChart3, path: "/benchmark" },
  { label: "זיהוי דוברים", icon: Users, path: "/diarization" },
  { label: "השוואת מנועים", icon: GitCompareArrows, path: "/diarization/compare" },
  { label: "ממיר ל-MP3", icon: Music, path: "/video-to-mp3" },
  { label: "הרמוניקיה", icon: AudioLines, path: "/harmonika" },
  { label: "התקנת שרת", icon: Server, path: "/setup" },
  { label: "לוח בקרה", icon: Bot, path: "/system-dashboard" },
  { label: "לשון הקודש", icon: ScrollText, path: "/lashon-kodesh" },
  { label: "השוואת תמלולים", icon: GitCompareArrows, path: "/compare-report" },
  { label: "הגדרות", icon: Settings, path: "/settings" },
];

export const useSidebarPinned = () => {
  const { preferences } = useCloudPreferences();
  return preferences.sidebar_pinned;
};

/** Local (non-cloud) folder management via localStorage */
const LOCAL_FOLDERS_KEY = 'local_folders';
const getLocalFolders = (): string[] => {
  try { return JSON.parse(localStorage.getItem(LOCAL_FOLDERS_KEY) || '[]'); } catch { return []; }
};
const saveLocalFolders = (folders: string[]) => {
  localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders));
};

const AppSidebar = () => {
  const { isAuthenticated, user, logout, isLoading, isAdmin } = useAuth();
  const { folders: cloudFolders } = useCloudFolders();
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();

  const [isOpen, setIsOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [localFolders, setLocalFolders] = useState<string[]>(getLocalFolders);

  // Merge cloud and local folders
  const folders = useMemo(() => {
    if (isAuthenticated) return cloudFolders;
    return localFolders.map(name => ({ name, count: 0 }));
  }, [isAuthenticated, cloudFolders, localFolders]);

  const addLocalFolder = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = [...new Set([...localFolders, trimmed])];
    setLocalFolders(updated);
    saveLocalFolders(updated);
  };

  const removeLocalFolder = (name: string) => {
    const updated = localFolders.filter(f => f !== name);
    setLocalFolders(updated);
    saveLocalFolders(updated);
  };
  const { preferences, updatePreference, updatePreferences } = useCloudPreferences();
  const { activeThemeId, allThemes, setTheme } = useTheme();
  const [isPinned, setIsPinned] = useState(preferences.sidebar_pinned);
  const lastPinnedRef = useRef(preferences.sidebar_pinned);

  useEffect(() => {
    if (preferences.sidebar_pinned !== isPinned) {
      setIsPinned(preferences.sidebar_pinned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.sidebar_pinned]);

  useEffect(() => {
    if (lastPinnedRef.current === isPinned) return;
    lastPinnedRef.current = isPinned;
    if (isPinned !== preferences.sidebar_pinned) {
      updatePreference('sidebar_pinned', isPinned);
    }
    window.dispatchEvent(new CustomEvent("sidebar-pin-change", { detail: isPinned }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPinned]);

  useEffect(() => {
    if (isPinned) setIsOpen(true);
  }, [isPinned]);

  // Notify AppLayout when sidebar visibility changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("sidebar-open-change", { detail: isOpen }));
  }, [isOpen]);

  useEffect(() => {
    if (!isMobile) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX >= window.innerWidth - 30) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.touches[0];
      const dx = touchStartRef.current.x - touch.clientX;
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      if (dx > SWIPE_THRESHOLD && dy < dx) {
        setIsOpen(true);
        touchStartRef.current = null;
      }
    };

    const onTouchEnd = () => {
      touchStartRef.current = null;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile]);

  const handleMouseEnterTrigger = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    setIsOpen(true);
  }, []);

  const handleMouseEnterSidebar = useCallback(() => {
    clearTimeout(closeTimerRef.current);
  }, []);

  const handleMouseLeaveSidebar = useCallback(() => {
    if (isPinned) return;
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 300);
  }, [isPinned]);

  const handleMouseLeaveTrigger = useCallback(() => {
    if (isPinned) return;
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 300);
  }, [isPinned]);

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "";

  const cycleTheme = () => {
    if (allThemes.length === 0) return;
    const currentIndex = allThemes.findIndex((theme) => theme.id === activeThemeId);
    const nextTheme = allThemes[(currentIndex + 1) % allThemes.length] || allThemes[0];
    setTheme(nextTheme.id);
    updatePreferences({
      theme: nextTheme.id,
      custom_themes: localStorage.getItem('app_custom_themes') || '[]',
    });
    toast({
      title: 'ערכת נושא הוחלפה',
      description: nextTheme.nameHe,
    });
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {isMobile && !isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed top-3 right-3 z-[61] p-2 text-foreground hover:text-foreground/80 transition-colors"
          aria-label="פתח תפריט"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Trigger zone - invisible strip on the right edge (desktop only) */}
      {!isPinned && !isMobile && (
        <div
          ref={triggerRef}
          className="fixed top-0 right-0 h-full z-[60]"
          style={{ width: TRIGGER_ZONE }}
          onMouseEnter={handleMouseEnterTrigger}
          onMouseLeave={handleMouseLeaveTrigger}
        />
      )}

      {/* Overlay when open and not pinned — transparent click-catcher, no visual blocking */}
      {isOpen && !isPinned && (
        <div
          className={cn(
            "fixed inset-0 z-[59] transition-opacity duration-300",
            isMobile && "bg-black/40"
          )}
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        dir="rtl"
        className={cn(
          "fixed top-0 right-0 h-full z-[60] flex flex-col",
          "bg-card border-l border-border shadow-xl",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width: SIDEBAR_WIDTH }}
        onMouseEnter={handleMouseEnterSidebar}
        onMouseLeave={handleMouseLeaveSidebar}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4" dir="rtl">
          <h2 className="text-base font-bold text-foreground tracking-tight text-right">
            ניווט
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={cycleTheme}
              onContextMenu={(e) => {
                e.preventDefault();
                navigate('/settings#themes-section');
                if (!isPinned) setIsOpen(false);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="החלף ערכת נושא • קליק ימני לעריכת ערכות"
            >
              <Palette className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPinned((p) => !p)}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isPinned
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={isPinned ? "שחרר" : "הצמד"}
            >
              {isPinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
            </button>
            {!isPinned && (
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ChevronLeft className="w-4 h-4 rotate-180" />
              </button>
            )}
          </div>
        </div>

        <Separator />

        {/* Nav items */}
        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-1 px-3" dir="rtl">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  if (!isPinned) setIsOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full",
                  isActive(item.path)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0 text-blue-900" />
                <span className="flex-1 text-right">{item.label}</span>
              </button>
            ))}

            {/* Quick Cut – global action (not a route) */}
            <button
              onClick={() => {
                openQuickCut();
                if (!isPinned) setIsOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full border border-yellow-500/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
            >
              <Scissors className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-right">✂️ חיתוך מהיר</span>
            </button>

            {/* Admin-only: Voice Command */}
            {isAdmin && (
              <button
                onClick={() => {
                  navigate("/voice-command-admin");
                  if (!isPinned) setIsOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full border",
                  isActive("/voice-command-admin")
                    ? "bg-purple-700 text-white border-purple-600 shadow-sm"
                    : "text-purple-400 border-purple-900 hover:bg-purple-950 hover:text-purple-200"
                )}
              >
                <Bot className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-right">פקודות קוליות</span>
                <span className="text-[0.58rem] px-1.5 py-0.5 rounded bg-purple-900 text-purple-300 border border-purple-700">ADMIN</span>
              </button>
            )}
          </nav>

          {/* Folders section - always visible */}
          <Separator className="my-2" />
          <div className="px-3" dir="rtl">
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  navigate('/folders');
                  if (!isPinned) setIsOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-colors",
                  isActive('/folders')
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <FolderOpen className="w-4 h-4" />
                <span className="text-right">תיקיות</span>
                {folders.length > 0 && (
                  <span className={cn("text-[10px] rounded-full px-1.5 py-0.5", isActive('/folders') ? "bg-primary-foreground/20 text-primary-foreground" : "text-muted-foreground bg-muted")}>{folders.length}</span>
                )}
              </button>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setFoldersOpen(p => !p)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title={foldersOpen ? "סגור רשימה" : "פתח רשימה"}
                >
                  <ChevronDown className={cn("w-4 h-4 transition-transform", foldersOpen && "rotate-180")} />
                </button>
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title="תיקיה חדשה"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {foldersOpen && (
              <div className="flex flex-col gap-0.5 mt-1">
                {/* All transcripts */}
                <button
                  onClick={() => {
                    navigate('/transcribe');
                    if (!isPinned) setIsOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors w-full text-right",
                    location.pathname === '/transcribe' && !new URLSearchParams(location.search).get('folder')
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>הכל</span>
                </button>

                {/* Folder list */}
                {folders.map(f => {
                  const isActiveFolder = location.pathname === '/transcribe' &&
                    new URLSearchParams(location.search).get('folder') === f.name;
                  return (
                    <div
                      key={f.name}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors w-full text-right group",
                        isActiveFolder
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <button
                        className="flex items-center gap-2 flex-1 min-w-0 text-right"
                        onClick={() => {
                          navigate(`/transcribe?folder=${encodeURIComponent(f.name)}`);
                          if (!isPinned) setIsOpen(false);
                        }}
                        title={f.name}
                      >
                        <Folder className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        {f.count > 0 && <span className="text-[10px] opacity-60">{f.count}</span>}
                      </button>
                      {!isAuthenticated && (
                        <button
                          onClick={() => {
                            removeLocalFolder(f.name);
                            toast({ title: "תיקיה נמחקה", description: f.name });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all"
                          title="מחק תיקיה"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}

                {folders.length === 0 && !showNewFolder && (
                  <p className="text-[11px] text-muted-foreground px-3 py-1 text-right">אין תיקיות עדיין — לחץ + להוספה</p>
                )}

                {/* Create new folder */}
                {showNewFolder && (
                  <div className="flex gap-1 px-2 mt-1">
                    <Input
                      placeholder="שם תיקיה..."
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newFolderName.trim()) {
                          if (!isAuthenticated) addLocalFolder(newFolderName.trim());
                          navigate(`/transcribe?folder=${encodeURIComponent(newFolderName.trim())}`);
                          setShowNewFolder(false);
                          setNewFolderName("");
                          if (!isPinned) setIsOpen(false);
                        }
                        if (e.key === 'Escape') {
                          setShowNewFolder(false);
                          setNewFolderName("");
                        }
                      }}
                      className="text-xs h-7"
                      dir="rtl"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Footer - user info */}
        <div className="px-3 py-3" dir="rtl">
          {isLoading ? null : isAuthenticated ? (
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-blue-900" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate text-right">
                  {displayName}
                </p>
              </div>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="התנתק"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                navigate("/login");
                if (!isPinned) setIsOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors w-full"
            >
              <LogIn className="w-5 h-5 text-blue-900" />
              <span>התחבר</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default AppSidebar;
