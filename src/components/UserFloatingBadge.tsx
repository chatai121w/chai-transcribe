import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User } from "lucide-react";

const UserFloatingBadge = () => {
  const { isAuthenticated, user, logout, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) return null;

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "";

  if (!isAuthenticated) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={() => navigate("/login")}
          className="gap-2 shadow-lg shadow-primary/20 rounded-full px-5 h-11"
        >
          <LogIn className="w-4 h-4" />
          התחבר
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2" dir="rtl">
      <div className="flex items-center gap-2 bg-background border border-border rounded-full shadow-lg pl-2 pr-4 h-11">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-medium text-foreground max-w-[120px] truncate">
          {displayName}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-destructive"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          <LogOut className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default UserFloatingBadge;
