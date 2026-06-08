import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { FolderManager } from "@/components/FolderManager";
import { GoogleDriveBrowser } from "@/components/GoogleDriveBrowser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Cloud, FolderOpen, Loader2, LogIn } from "lucide-react";


const Folders = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { transcripts, isLoading, updateTranscript, deleteTranscript, getAudioUrl } = useCloudTranscripts();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-right flex-1">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent flex items-center gap-3">
              <FolderOpen className="w-9 h-9 text-primary" />
              ניהול תיקיות
            </h1>
            <p className="text-muted-foreground">
              ארגן, חפש וסנן את התמלולים שלך לפי תיקיות, קטגוריות ותגיות
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            חזרה לדשבורד
          </Button>
        </div>

        {/* Main content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : isAuthenticated ? (
          <>
            <GoogleDriveBrowser
              onImportAudio={(file) => {
                // Stash file in sessionStorage handoff and navigate to home for transcription
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    sessionStorage.setItem(
                      "drive_import_file",
                      JSON.stringify({
                        name: file.name,
                        type: file.type,
                        dataUrl: reader.result,
                      })
                    );
                    navigate("/?source=drive");
                  } catch (e) {
                    console.error("drive import handoff failed", e);
                  }
                };
                reader.readAsDataURL(file);
              }}
            />
            <FolderManager
              transcripts={transcripts}
              onUpdate={(id, updates) => updateTranscript(id, updates)}
              onDelete={deleteTranscript}
              onGetAudioUrl={getAudioUrl}
            />
          </>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Cloud className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">התחבר כדי לנהל תיקיות</h3>
              <p className="text-sm text-muted-foreground mb-4">
                שמירה בענן, ניהול תיקיות, תגיות וקטגוריות מכל מכשיר
              </p>
              <Button onClick={() => navigate("/login")} className="gap-2">
                <LogIn className="w-4 h-4" />
                התחבר
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Folders;
