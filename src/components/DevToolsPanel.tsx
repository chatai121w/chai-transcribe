import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getDefaultDevFloatingButtonsVisibility,
  loadDevFloatingButtonsVisibility,
  saveDevFloatingButtonsVisibility,
  type DevFloatingButtonId,
  type DevFloatingButtonsVisibility,
} from "@/lib/devFloatingButtons";
import {
  Play,
  Copy,
  Trash2,
  Upload,
  FileCode,
  Terminal,
  Bug,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  RotateCcw,
  Sparkles,
  Database,
  Code2,
  ScrollText,
  LayoutGrid,
} from "lucide-react";

interface MigrationLog {
  id: string;
  sql_content: string;
  status: string;
  result: string | null;
  error_message: string | null;
  execution_time_ms: number | null;
  created_at: string;
  file_name: string | null;
}

const SQL_TEMPLATES = [
  {
    name: "צור טבלה חדשה",
    sql: `CREATE TABLE public.my_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;`,
  },
  {
    name: "הוסף עמודה",
    sql: `ALTER TABLE public.my_table
ADD COLUMN description text;`,
  },
  {
    name: "צור מדיניות RLS",
    sql: `CREATE POLICY "Users can read own data"
ON public.my_table FOR SELECT TO authenticated
USING (user_id = auth.uid());`,
  },
  {
    name: "צור פונקציה",
    sql: `CREATE OR REPLACE FUNCTION public.my_function(param text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN json_build_object('result', param);
END;
$$;`,
  },
  {
    name: "הצג טבלאות",
    sql: `SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;`,
  },
  {
    name: "הצג מדיניות RLS",
    sql: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;`,
  },
];

const DEV_FLOATING_BUTTON_OPTIONS: Array<{
  id: DevFloatingButtonId;
  label: string;
  description: string;
}> = [
  {
    id: "smartConsole",
    label: "קונסול חכם",
    description: "כפתור צף לקונסול התראות ולוגים",
  },
  {
    id: "transcriptionAnalytics",
    label: "ניתוח תמלולים",
    description: "כפתור צף לגרפים וסטטיסטיקות תמלול",
  },
  {
    id: "pwaInstall",
    label: "התקנת אפליקציה",
    description: "כפתור צף להתקנת האפליקציה (PWA)",
  },
  {
    id: "diarizationStatus",
    label: "סטטוס זיהוי דוברים",
    description: "כפתור/פאנל צף לתור זיהוי דוברים",
  },
];

const DevToolsPanel = () => {
  const [sqlContent, setSqlContent] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [activeResult, setActiveResult] = useState<{
    status: string;
    result: string;
    error?: string;
    executionTime: number;
  } | null>(null);
  const [floatingButtons, setFloatingButtons] = useState<DevFloatingButtonsVisibility>(() => loadDevFloatingButtonsVisibility());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    const { data, error } = await supabase
      .from("migration_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (data && !error) {
      setLogs(data as unknown as MigrationLog[]);
    }
  };

  const runMigration = async (mode: "execute" | "debug" = "execute") => {
    if (!sqlContent.trim()) {
      toast.error("אנא הכנס שאילתת SQL");
      return;
    }

    mode === "debug" ? setIsDebugging(true) : setIsRunning(true);

    try {
      const sqlToRun = mode === "debug"
        ? `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${sqlContent}`
        : sqlContent;

      const startTime = Date.now();
      const { data, error } = await supabase.rpc("exec_sql", { query: sqlToRun });

      const executionTime = Date.now() - startTime;

      const rpcResult = data as Record<string, unknown> | null;

      const result = {
        status: rpcResult?.success ? "success" : "error",
        result: rpcResult?.success
          ? JSON.stringify(rpcResult, null, 2)
          : "",
        error: rpcResult?.success ? undefined : String(rpcResult?.error || ""),
        executionTime: Number(rpcResult?.duration_ms ?? executionTime),
      };

      setActiveResult(result);
      if (rpcResult?.success) {
        toast.success(mode === "debug" ? "ניתוח הושלם" : "מיגרציה הורצה בהצלחה");
      } else {
        toast.error(String(rpcResult?.error || "שגיאה בהרצה"));
      }

      await loadLogs();
    } catch (err: any) {
      toast.error(err.message || "שגיאה בהרצת המיגרציה");
      setActiveResult({
        status: "error",
        result: "",
        error: err.message,
        executionTime: 0,
      });
    } finally {
      setIsRunning(false);
      setIsDebugging(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".sql") && !file.name.endsWith(".txt")) {
      toast.error("נא להעלות קובץ SQL או TXT");
      return;
    }

    const text = await file.text();
    setSqlContent(text);
    toast.success(`קובץ ${file.name} נטען בהצלחה`);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("הועתק ללוח");
  };

  const exportLogs = () => {
    const exportData = logs.map((log) => ({
      date: new Date(log.created_at).toLocaleString("he-IL"),
      status: log.status,
      sql: log.sql_content,
      result: log.result,
      error: log.error_message,
      time_ms: log.execution_time_ms,
      file: log.file_name,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("לוגים יוצאו בהצלחה");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "error":
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">הצלחה</Badge>;
      case "error":
        return <Badge variant="destructive">שגיאה</Badge>;
      default:
        return <Badge variant="secondary">ממתין</Badge>;
    }
  };

  const toggleFloatingButton = (id: DevFloatingButtonId, nextVisible: boolean) => {
    const updated: DevFloatingButtonsVisibility = {
      ...floatingButtons,
      [id]: nextVisible,
    };
    setFloatingButtons(updated);
    saveDevFloatingButtonsVisibility(updated);
  };

  const resetFloatingButtons = () => {
    const defaults = getDefaultDevFloatingButtonsVisibility();
    setFloatingButtons(defaults);
    saveDevFloatingButtonsVisibility(defaults);
    toast.success("כפתורי הפיתוח אופסו לברירת מחדל");
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Tabs defaultValue="editor" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="editor" className="gap-2 text-sm">
            <Code2 className="w-4 h-4" />
            עורך SQL
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2 text-sm">
            <ScrollText className="w-4 h-4" />
            לוגים
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2 text-sm">
            <Database className="w-4 h-4" />
            תבניות
          </TabsTrigger>
          <TabsTrigger value="dev-buttons" className="gap-2 text-sm">
            <LayoutGrid className="w-4 h-4" />
            כפתורי פיתוח
          </TabsTrigger>
        </TabsList>

        {/* SQL Editor Tab */}
        <TabsContent value="editor" className="space-y-4 mt-4">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => runMigration("execute")}
              disabled={isRunning || isDebugging}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              {isRunning ? (
                <Sparkles className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              הרץ מיגרציה
            </Button>

            <Button
              onClick={() => runMigration("debug")}
              disabled={isRunning || isDebugging}
              variant="outline"
              className="gap-2 border-accent text-accent"
            >
              {isDebugging ? (
                <Sparkles className="w-4 h-4 animate-spin" />
              ) : (
                <Bug className="w-4 h-4" />
              )}
              דיבאג
            </Button>

            <Button
              variant="outline"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              העלה קובץ
            </Button>

            <Button
              variant="ghost"
              className="gap-2"
              onClick={() => copyToClipboard(sqlContent)}
              disabled={!sqlContent}
            >
              <Copy className="w-4 h-4" />
              העתק
            </Button>

            <Button
              variant="ghost"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => {
                setSqlContent("");
                setActiveResult(null);
              }}
            >
              <Trash2 className="w-4 h-4" />
              נקה
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* SQL Editor */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={sqlContent}
              onChange={(e) => setSqlContent(e.target.value)}
              placeholder="-- הכנס שאילתת SQL כאן...
-- לדוגמה:
-- CREATE TABLE public.my_table (...)
-- ALTER TABLE public.my_table ADD COLUMN ...
-- SELECT * FROM information_schema.tables"
              className="w-full min-h-[250px] p-4 font-mono text-sm bg-foreground/5 border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
              dir="ltr"
              spellCheck={false}
            />
            <div className="absolute bottom-3 left-3 text-xs text-muted-foreground">
              {sqlContent.length} תווים
            </div>
          </div>

          {/* Result Panel */}
          {activeResult && (
            <Card
              className={`border-2 ${
                activeResult.status === "success"
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-destructive/30 bg-destructive/5"
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(activeResult.status)}
                    <CardTitle className="text-base">
                      {activeResult.status === "success" ? "הצלחה" : "שגיאה"}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1">
                      <Clock className="w-3 h-3" />
                      {activeResult.executionTime}ms
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          activeResult.error || activeResult.result
                        )
                      }
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[300px]">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all p-3 bg-foreground/5 rounded" dir="ltr">
                    {activeResult.error || activeResult.result}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              היסטוריית הרצות ({logs.length})
            </h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadLogs} className="gap-1">
                <RotateCcw className="w-3 h-3" />
                רענן
              </Button>
              <Button variant="outline" size="sm" onClick={exportLogs} className="gap-1" disabled={logs.length === 0}>
                <Download className="w-3 h-3" />
                ייצא
              </Button>
            </div>
          </div>

          <ScrollArea className="max-h-[500px]">
            <div className="space-y-3">
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Terminal className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>אין לוגים עדיין</p>
                  <p className="text-sm">הרץ מיגרציה ראשונה כדי לראות לוגים</p>
                </div>
              ) : (
                logs.map((log) => (
                  <Card key={log.id} className="overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(log.status)}
                          {log.file_name && (
                            <Badge variant="outline" className="gap-1">
                              <FileCode className="w-3 h-3" />
                              {log.file_name}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {log.execution_time_ms && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {log.execution_time_ms}ms
                            </span>
                          )}
                          <span>
                            {new Date(log.created_at).toLocaleString("he-IL")}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => copyToClipboard(log.sql_content)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      <pre className="text-xs font-mono bg-foreground/5 p-2 rounded max-h-[80px] overflow-hidden whitespace-pre-wrap break-all" dir="ltr">
                        {log.sql_content.substring(0, 200)}
                        {log.sql_content.length > 200 ? "..." : ""}
                      </pre>

                      {log.error_message && (
                        <div className="mt-2 p-2 bg-destructive/10 rounded border border-destructive/20">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              שגיאה:
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => copyToClipboard(log.error_message || "")}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                          <pre className="text-xs font-mono text-destructive mt-1 whitespace-pre-wrap" dir="ltr">
                            {log.error_message}
                          </pre>
                        </div>
                      )}

                      {log.result && log.status === "success" && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            הצג תוצאה
                          </summary>
                          <pre className="text-xs font-mono bg-foreground/5 p-2 rounded mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap" dir="ltr">
                            {log.result}
                          </pre>
                        </details>
                      )}

                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => {
                            setSqlContent(log.sql_content);
                            toast.info("SQL נטען לעורך");
                          }}
                        >
                          <RotateCcw className="w-3 h-3 ml-1" />
                          הרץ שוב
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-3 mt-4">
          <p className="text-sm text-muted-foreground">
            תבניות SQL מוכנות לשימוש - לחץ כדי לטעון לעורך
          </p>
          <div className="grid gap-3">
            {SQL_TEMPLATES.map((template, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => {
                  setSqlContent(template.sql);
                  toast.info(`תבנית "${template.name}" נטענה`);
                }}
              >
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{template.name}</span>
                    <FileCode className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <pre className="text-xs font-mono text-muted-foreground max-h-[60px] overflow-hidden whitespace-pre-wrap" dir="ltr">
                    {template.sql.substring(0, 120)}...
                  </pre>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="dev-buttons" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">כפתורי פיתוח צפים</CardTitle>
                  <CardDescription>
                    בחר אילו כפתורים יוצגו במסך הראשי. ההעדפה נשמרת אוטומטית.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={resetFloatingButtons}>
                  איפוס
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {DEV_FLOATING_BUTTON_OPTIONS.map((item, index) => (
                <div key={item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor={`dev-floating-${item.id}`} className="text-sm font-medium">
                        {item.label}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                    <Switch
                      id={`dev-floating-${item.id}`}
                      checked={floatingButtons[item.id]}
                      onCheckedChange={(checked) => toggleFloatingButton(item.id, checked)}
                    />
                  </div>
                  {index < DEV_FLOATING_BUTTON_OPTIONS.length - 1 && <Separator className="mt-3" />}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DevToolsPanel;
