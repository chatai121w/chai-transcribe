import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { debugLog } from "@/lib/debugLogger";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Detect if supabase has a stored session in localStorage (optimistic auth).
// Key format: sb-<projectRef>-auth-token
const _hasStoredSession = (): boolean => {
  try {
    const key = Object.keys(localStorage).find(
      k => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!key) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    // Valid if access_token exists and not expired
    const exp = parsed?.expires_at ?? parsed?.session?.expires_at;
    if (!exp) return !!parsed?.access_token || !!parsed?.session?.access_token;
    return Date.now() / 1000 < exp;
  } catch { return false; }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Always start loading=true so ProtectedRoute waits for the first auth event.
  // Without this, session=null + isLoading=false causes / → /login → / flash.
  const [isLoading, setIsLoading] = useState(true);

  const checkAdmin = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
    debugLog.info('Auth', `👤 Admin check: ${!!data ? 'admin' : 'user'}`);
  };

  useEffect(() => {
    const authStart = Date.now();
    debugLog.info('Auth', '🔐 מאתחל auth listener...');

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Single source of truth: onAuthStateChange handles all auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Clear fallback timeout as soon as we get any auth response
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const elapsed = Date.now() - authStart;
        debugLog.info('Auth', `🔐 Auth event: ${event} (${elapsed}ms)`, {
          hasSession: !!session,
          email: session?.user?.email ?? null,
        });
        setSession(session);
        setUser(session?.user ?? null);
        // Set loading false BEFORE admin check so pages render immediately
        setIsLoading(false);
        if (session?.user) {
          // Admin check runs in background — doesn't block page load
          checkAdmin(session.user.id);
        } else {
          setIsAdmin(false);
        }
      }
    );

    // Trigger initial session check (will flow through onAuthStateChange)
    // If refresh token is stale, clear it silently instead of spamming console errors
    supabase.auth.getSession().then(({ error }) => {
      if (error?.message?.includes('Refresh Token')) {
        debugLog.warn('Auth', '🧹 Refresh token פג תוקף — מנקה session');
        supabase.auth.signOut({ scope: 'local' });
      }
    });

    // Fallback: if auth never responds, stop loading after 5 seconds
    timeoutId = setTimeout(() => {
      debugLog.warn('Auth', '⚠ Auth timeout — 5s ללא תגובה, ממשיך בלי auth');
      setIsLoading(false);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const logout = useCallback(async () => {
    debugLog.info('Auth', '🚪 מתנתק...');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    debugLog.info('Auth', '🚪 התנתק בהצלחה');
  }, []);

  const value = useMemo(() => ({
    isAuthenticated: !!session,
    user,
    session,
    isAdmin,
    isLoading,
    logout,
  }), [session, user, isAdmin, isLoading, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
