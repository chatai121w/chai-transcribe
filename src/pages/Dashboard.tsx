import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { debugLog } from "@/lib/debugLogger";
import { FolderManager } from "@/components/FolderManager";
import { RecentFilesWidget } from "@/components/RecentFiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic, FileText, Settings, LogIn, BarChart3, Clock, Zap, 
  FileEdit, Cloud, ArrowLeft, TrendingUp, Grid3X3, Table2, RectangleHorizontal, LayoutGrid
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";

type RecentViewMode = 'cards' | 'table' | 'rectangles' | 'grid';

const Dashboard = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { transcripts, stats, isLoading, updateTranscript, deleteTranscript, getAudioUrl } = useCloudTranscripts();
  const { preferences, updatePreference } = useCloudPreferences();

  useEffect(() => {
    debugLog.info('Dashboard', '📊 Dashboard mounted');
    return () => debugLog.info('Dashboard', '📊 Dashboard unmounted');
  }, []);

  useEffect(() => {
    if (!isLoading) {
      debugLog.info('Dashboard', `📊 נתונים נטענו: ${transcripts.length} תמלולים`, stats);
    }
  }, [isLoading, transcripts.length, stats]);

  const recentTranscripts = transcripts.slice(0, 5);
  const recentViewMode = (preferences.dashboard_view_mode || 'cards') as RecentViewMode;
  const setRecentViewMode = useCallback((mode: RecentViewMode) => {
    updatePreference('dashboard_view_mode', mode);
  }, [updatePreference]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const estimateWords = (chars: number) => Math.round(chars / 5);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-end gap-2">
          {!isAuthenticated && (
            <Button variant="outline" onClick={() => navigate("/login")}>
              <LogIn className="h-4 w-4 ml-2" />
              התחבר
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="fixed top-3 left-3 z-[61] md:static p-2 text-foreground hover:text-foreground/80 hover:bg-transparent"
            onClick={() => navigate("/settings")}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-primary/20 hover:border-primary/50"
            onClick={() => navigate("/transcribe")}
          >
            <CardContent className="flex items-center gap-4 p-6">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                <Mic className="w-7 h-7 text-blue-900" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">תמלול חדש</h3>
                <p className="text-sm text-muted-foreground">העלה קובץ או הקלט ישירות</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>

          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-accent/20 hover:border-accent/50"
            onClick={() => navigate("/text-editor")}
          >
            <CardContent className="flex items-center gap-4 p-6">
              <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
                <FileEdit className="w-7 h-7 text-blue-900" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">עריכת טקסט</h3>
                <p className="text-sm text-muted-foreground">עריכה מתקדמת עם AI</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>

          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-secondary/40 hover:border-secondary"
            onClick={() => navigate("/settings")}
          >
            <CardContent className="flex items-center gap-4 p-6">
              <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                <Settings className="w-7 h-7 text-blue-900" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">הגדרות</h3>
                <p className="text-sm text-muted-foreground">מפתחות API והגדרות מערכת</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        {isAuthenticated && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <BarChart3 className="w-5 h-5 text-blue-900" />
                </div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">סה״כ תמלולים</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-2">
                  <FileText className="w-5 h-5 text-blue-900" />
                </div>
                <p className="text-2xl font-bold">{estimateWords(stats.totalChars).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">מילים בסה״כ</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mx-auto mb-2">
                  <Zap className="w-5 h-5 text-blue-900" />
                </div>
                <p className="text-2xl font-bold">{stats.engines.length}</p>
                <p className="text-xs text-muted-foreground">מנועים בשימוש</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <Cloud className="w-5 h-5 text-blue-900" />
                </div>
                <div className="text-2xl font-bold">
                  <Badge variant="secondary" className="text-xs">מסונכרן</Badge>
                </div>
                <p className="text-xs text-muted-foreground">שמירה בענן</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Transcripts */}
        {recentTranscripts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-900" />
                  <CardTitle className="text-xl">תמלולים אחרונים</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu dir="rtl">
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8" title="תצוגה">
                        {recentViewMode === 'cards' ? <LayoutGrid className="w-4 h-4" /> : recentViewMode === 'table' ? <Table2 className="w-4 h-4" /> : recentViewMode === 'rectangles' ? <RectangleHorizontal className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>תצוגה</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className={recentViewMode === 'cards' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('cards')}>
                        <LayoutGrid className="w-4 h-4 ml-2" />כרטיסיות
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'table' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('table')}>
                        <Table2 className="w-4 h-4 ml-2" />טבלה
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'rectangles' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('rectangles')}>
                        <RectangleHorizontal className="w-4 h-4 ml-2" />מלבנים
                      </DropdownMenuItem>
                      <DropdownMenuItem className={recentViewMode === 'grid' ? 'bg-accent' : ''} onClick={() => setRecentViewMode('grid')}>
                        <Grid3X3 className="w-4 h-4 ml-2" />רשת
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/transcribe")}>
                    הצג הכל
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {recentViewMode === 'table' ? (
                <div className="rounded-lg border overflow-hidden" dir="rtl">
                  <table className="w-full text-sm" dir="rtl">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-right px-3 py-2 font-medium">כותרת</th>
                        <th className="text-right px-3 py-2 font-medium">מנוע</th>
                        <th className="text-right px-3 py-2 font-medium">תאריך</th>
                        <th className="text-right px-3 py-2 font-medium">תגיות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTranscripts.map((t) => (
                        <tr
                          key={t.id}
                          className="border-t hover:bg-accent/30 cursor-pointer"
                          onClick={() => navigate('/text-editor', { state: { text: t.edited_text || t.text, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                        >
                          <td className="px-3 py-2 text-right truncate max-w-[280px]">{t.title || t.text.substring(0, 50)}</td>
                          <td className="px-3 py-2 text-right">{t.engine}</td>
                          <td className="px-3 py-2 text-right">{formatDate(t.created_at)}</td>
                          <td className="px-3 py-2 text-right">{t.tags?.length || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={recentViewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-2' : 'space-y-2'}>
                  {recentTranscripts.map((t) => (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer ${
                        recentViewMode === 'rectangles' ? 'p-2' : 'p-3'
                      }`}
                      onClick={() => navigate('/text-editor', { state: { text: t.edited_text || t.text, transcriptId: t.id, audioFilePath: t.audio_file_path } })}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{t.title || t.text.substring(0, 50)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(t.created_at)}</p>
                          {recentViewMode !== 'rectangles' && (
                            <p className="text-xs text-muted-foreground truncate mt-1">{(t.edited_text || t.text).substring(0, 90)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{t.engine}</Badge>
                        {t.tags && t.tags.length > 0 && (
                          <Badge variant="secondary" className="text-xs">{t.tags.length} תגיות</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Folder Manager */}
        {isAuthenticated && transcripts.length > 0 && (
          <FolderManager
            transcripts={transcripts}
            onUpdate={(id, updates) => updateTranscript(id, updates)}
            onDelete={deleteTranscript}
            onGetAudioUrl={getAudioUrl}
          />
        )}

        {/* Recent Local Files (localStorage-based, works without auth) */}
        <RecentFilesWidget />

        {/* Empty state for non-authenticated */}
        {!isAuthenticated && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Cloud className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">התחבר כדי לשמור את התמלולים שלך</h3>
              <p className="text-sm text-muted-foreground mb-4">
                שמירה בענן, גישה מכל מכשיר, וסטטיסטיקות שימוש
              </p>
              <Button onClick={() => navigate("/login")}>
                <LogIn className="w-4 h-4 ml-2" />
                התחבר עכשיו
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
