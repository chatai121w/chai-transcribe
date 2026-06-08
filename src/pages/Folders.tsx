import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { FileManager } from "@/components/file-manager/FileManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Cloud, FolderOpen, LogIn } from "lucide-react";

const Folders = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" dir="rtl">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-right">
            <h1 className="text-3xl font-bold flex items-center gap-3 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              <FolderOpen className="w-8 h-8 text-primary" />
              ניהול תיקיות
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Explorer מלא · גרירה · העתק/הדבק (Ctrl+C/X/V) · בחירה מרובה · Google Drive
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
            <ArrowRight className="w-4 h-4" /> חזרה לדשבורד
          </Button>
        </div>

        {isAuthenticated ? (
          <FileManager />
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Cloud className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">התחבר כדי לנהל תיקיות</h3>
              <p className="text-sm text-muted-foreground mb-4">
                שמירה בענן, ניהול תיקיות וקבצים מכל מכשיר
              </p>
              <Button onClick={() => navigate("/login")} className="gap-2">
                <LogIn className="w-4 h-4" /> התחבר
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Folders;
