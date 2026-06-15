import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, Mail, KeyRound, Sparkles } from "lucide-react";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("rememberMe") === "true");
  const [isLoading, setIsLoading] = useState(false);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Load remembered email
  useEffect(() => {
    if (rememberMe) {
      const saved = localStorage.getItem("rememberedEmail");
      if (saved) setEmail(saved);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  // Detect OAuth error from hash params (e.g. Supabase redirects back with error)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const errorDesc = params.get("error_description") || params.get("error") || "שגיאה בהתחברות";
      toast.error(decodeURIComponent(errorDesc));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("נשלח קישור לאיפוס סיסמה לאימייל שלך 📧");
        setIsForgotPassword(false);
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("נרשמת בהצלחה! 🎉");
        navigate("/");
      } else {
        // Remember me: save email for next visit
        if (rememberMe) {
          localStorage.setItem("rememberMe", "true");
          localStorage.setItem("rememberedEmail", email);
        } else {
          localStorage.removeItem("rememberMe");
          localStorage.removeItem("rememberedEmail");
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("התחברת בהצלחה! 🎉");
        navigate("/");
      }
    } catch (error: any) {
      toast.error(error.message || "שגיאה בהתחברות");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || "שגיאה בהתחברות עם Google");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4" dir="rtl">
      <Card className="w-full max-w-md relative bg-white border-2 border-yellow-500/50 rounded-2xl shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/30 rotate-3 hover:rotate-0 transition-transform duration-300">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-3xl font-frank text-gray-900">
            {isForgotPassword ? "שכחתי סיסמה" : isSignUp ? "הרשמה" : "ברוכים הבאים"}
          </CardTitle>
          <CardDescription className="text-base font-assistant text-gray-700">
            {isForgotPassword ? "נשלח לך קישור לאיפוס" : isSignUp ? "צור חשבון חדש להתחלה" : "התחבר לחשבון שלך"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          {/* Google Sign In - hide in forgot password mode */}
          {!isForgotPassword && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 text-base font-medium gap-3 border-gray-300 hover:bg-gray-50 hover:border-yellow-500/60 transition-all duration-200 text-gray-800"
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="text-gray-800">המשך עם Google</span>
              </Button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-yellow-500/40" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-gray-500 font-assistant">או</span>
                </div>
              </div>
            </>
          )}

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type="email"
                placeholder="כתובת אימייל"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 pr-10 text-base font-assistant border-gray-300 focus:border-yellow-500 focus:ring-yellow-500/20 text-gray-900 placeholder:text-gray-400"
                required
                dir="ltr"
              />
            </div>

            {/* Password field - hidden in forgot password mode */}
            {!isForgotPassword && (
              <div className="relative">
                <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="סיסמה"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pr-10 pl-10 text-base font-assistant border-gray-300 focus:border-yellow-500 focus:ring-yellow-500/20 text-gray-900 placeholder:text-gray-400"
                  required
                  dir="ltr"
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}

            {/* Remember me + Forgot password row */}
            {!isForgotPassword && !isSignUp && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                    className="border-gray-400 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500"
                  />
                  <Label htmlFor="rememberMe" className="text-sm font-assistant text-gray-700 cursor-pointer">
                    זכור אותי
                  </Label>
                </div>
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(true)}
                  className="text-sm text-yellow-600 hover:text-yellow-700 hover:underline font-assistant"
                >
                  שכחתי סיסמה
                </button>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-medium bg-gradient-to-l from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 transition-all shadow-lg shadow-yellow-500/30 text-white"
              size="lg"
              disabled={isLoading}
            >
              {isLoading ? (
                <Sparkles className="w-5 h-5 animate-spin" />
              ) : isForgotPassword ? (
                "שלח קישור לאיפוס"
              ) : isSignUp ? (
                "הרשמה"
              ) : (
                "התחבר"
              )}
            </Button>
          </form>

          {/* Toggle Sign Up / Sign In / Back from forgot */}
          <p className="text-center text-sm text-gray-600 font-assistant">
            {isForgotPassword ? (
              <button
                type="button"
                onClick={() => setIsForgotPassword(false)}
                className="text-yellow-600 font-semibold hover:text-yellow-700 hover:underline"
              >
                חזרה להתחברות
              </button>
            ) : (
              <>
                {isSignUp ? "כבר יש לך חשבון?" : "אין לך חשבון?"}{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-yellow-600 font-semibold hover:text-yellow-700 hover:underline"
                >
                  {isSignUp ? "התחבר" : "הרשם עכשיו"}
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
