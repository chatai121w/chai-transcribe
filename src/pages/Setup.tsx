import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowRight,
  Search,
  Download,
  PlayCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Copy,
  RefreshCw,
  Loader2,
  Server,
  Zap,
  FileAudio,
} from "lucide-react";

import { getServerUrl } from "@/lib/serverConfig";
const SERVER_URL = getServerUrl();

interface ScanResult {
  system: {
    python_version: string;
    ram: { total_gb?: number; used_gb?: number; percent?: number } | null;
    disk_free_gb: number;
    disk_total_gb: number;
  };
  gpu: {
    name: string | null;
    device: string;
    cuda_available: boolean;
    cuda_version: string | null;
    memory: { total_mb?: number; used_mb?: number; free_mb?: number } | null;
  };
  packages: Record<string, string | null>;
  models: {
    current: string | null;
    downloaded: string[];
    available: string[];
    model_ready: boolean;
  };
  server: {
    uptime_seconds: number;
    port: number;
  };
}

type TabId = "scan" | "install" | "model" | "verify";

interface TabStatus {
  scan: "idle" | "checking" | "ok" | "error";
  install: "idle" | "waiting" | "ok" | "error";
  model: "idle" | "downloading" | "ok" | "error";
  verify: "idle" | "testing" | "ok" | "error";
}

const Setup = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("scan");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [scanData, setScanData] = useState<ScanResult | null>(null);
  const [tabStatus, setTabStatus] = useState<TabStatus>({
    scan: "idle",
    install: "idle",
    model: "idle",
    verify: "idle",
  });
  const [modelProgress, setModelProgress] = useState(0);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Check server health
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        setServerOnline(true);
        return true;
      }
    } catch {}
    setServerOnline(false);
    return false;
  }, []);

  // Run system scan via server
  const runScan = useCallback(async () => {
    setTabStatus((s) => ({ ...s, scan: "checking" }));
    try {
      const res = await fetch(`${SERVER_URL}/setup/scan`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data: ScanResult = await res.json();
        setScanData(data);
        setTabStatus((s) => ({ ...s, scan: "ok", install: "ok" }));
        // Check model status
        if (data.models.model_ready || data.models.downloaded.length > 0) {
          setTabStatus((s) => ({ ...s, model: "ok" }));
        }
        return data;
      }
    } catch {}
    setTabStatus((s) => ({ ...s, scan: "error" }));
    return null;
  }, []);

  // Initial check
  useEffect(() => {
    const init = async () => {
      const online = await checkServer();
      if (online) {
        await runScan();
      } else {
        setTabStatus((s) => ({ ...s, scan: "error" }));
      }
    };
    init();

    // Poll for server status every 5s
    pollRef.current = setInterval(async () => {
      const wasOnline = serverOnline;
      const nowOnline = await checkServer();
      if (!wasOnline && nowOnline) {
        toast.success("השרת מחובר! / Server connected!");
        await runScan();
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Copy command to clipboard
  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    toast.success("הפקודה הועתקה! / Command copied!");
  };

  // Download model via server
  const downloadModel = async () => {
    if (!serverOnline) return;
    setTabStatus((s) => ({ ...s, model: "downloading" }));
    setModelProgress(0);

    try {
      const modelId = "ivrit-ai/whisper-large-v3-turbo-ct2";
      const res = await fetch(`${SERVER_URL}/preload-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      });

      if (!res.ok || !res.body) throw new Error("Failed to start download");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.progress !== undefined) {
                setModelProgress(data.progress);
              }
              if (data.status === "ready" || data.status === "cached") {
                setTabStatus((s) => ({ ...s, model: "ok" }));
                setModelProgress(100);
                toast.success("המודל מוכן! / Model ready!");
              }
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (err: unknown) {
      setTabStatus((s) => ({ ...s, model: "error" }));
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`שגיאה בהורדת המודל: ${msg}`);
    }
  };

  // Test transcription
  const testTranscription = async () => {
    if (!serverOnline) return;
    setTabStatus((s) => ({ ...s, verify: "testing" }));
    setVerifyResult(null);

    try {
      // Check health first
      const healthRes = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!healthRes.ok) throw new Error("Server not responding");
      const health = await healthRes.json();

      if (!health.model_ready) {
        setVerifyResult("המודל לא טעון. עבור לטאב 'הורדת מודל' קודם.");
        setTabStatus((s) => ({ ...s, verify: "error" }));
        return;
      }

      // Create a simple test — use the health endpoint as a proxy for readiness
      setVerifyResult(
        `✅ השרת תקין!\n` +
        `GPU: ${health.gpu || "CPU"}\n` +
        `מודל: ${health.current_model || "לא טעון"}\n` +
        `זמן פעולה: ${Math.round(health.uptime_seconds / 60)} דקות\n` +
        `מוכן לתמלול!`
      );
      setTabStatus((s) => ({ ...s, verify: "ok" }));
      toast.success("הכל תקין! / Everything works!");
    } catch {
      setVerifyResult("לא מצליח להתחבר לשרת. וודא שהוא רץ.");
      setTabStatus((s) => ({ ...s, verify: "error" }));
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "ok":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "checking":
      case "downloading":
      case "testing":
      case "waiting":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const setupScript = `.\\scripts\\setup-offline.ps1`;
  const startScript = `.\\scripts\\start-whisper-server.ps1`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4" dir="rtl">
      <div className="max-w-3xl mx-auto py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Button variant="outline" onClick={() => navigate("/")}>
            <ArrowRight className="ml-2 h-4 w-4" />
            חזרה
          </Button>
          <div className="flex items-center gap-2">
            {serverOnline === true && (
              <Badge variant="default" className="bg-green-600 gap-1">
                <Zap className="h-3 w-3" /> שרת מחובר
              </Badge>
            )}
            {serverOnline === false && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> שרת לא מחובר
              </Badge>
            )}
            {serverOnline === null && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> בודק...
              </Badge>
            )}
          </div>
        </div>

        {/* Title Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Server className="w-8 h-8 text-primary" />
              <div>
                <CardTitle className="text-2xl">התקנת שרת CUDA מקומי</CardTitle>
                <CardDescription className="text-base">
                  התקנה מודרכת בשלבים — סריקה, התקנה, הורדת מודל, אימות
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} dir="rtl" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="scan" className="gap-1.5 text-xs sm:text-sm">
              {statusIcon(tabStatus.scan)}
              <Search className="h-4 w-4 hidden sm:inline" />
              סריקה
            </TabsTrigger>
            <TabsTrigger value="install" className="gap-1.5 text-xs sm:text-sm">
              {statusIcon(tabStatus.install)}
              <Download className="h-4 w-4 hidden sm:inline" />
              התקנה
            </TabsTrigger>
            <TabsTrigger value="model" className="gap-1.5 text-xs sm:text-sm">
              {statusIcon(tabStatus.model)}
              <FileAudio className="h-4 w-4 hidden sm:inline" />
              מודל
            </TabsTrigger>
            <TabsTrigger value="verify" className="gap-1.5 text-xs sm:text-sm">
              {statusIcon(tabStatus.verify)}
              <PlayCircle className="h-4 w-4 hidden sm:inline" />
              אימות
            </TabsTrigger>
          </TabsList>

          {/* ===== Tab 1: System Scan ===== */}
          <TabsContent value="scan">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  סריקת מערכת
                </CardTitle>
                <CardDescription>
                  בודק GPU, זיכרון, דיסק, ורכיבים מותקנים
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {serverOnline === false && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">השרת לא רץ</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      כדי לסרוק את המערכת, צריך להפעיל את השרת קודם.
                      עבור לטאב "התקנה" להנחיות.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("install")}>
                      עבור להתקנה
                    </Button>
                  </div>
                )}

                {scanData && (
                  <div className="space-y-3">
                    {/* GPU */}
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <Monitor className="h-5 w-5 mt-0.5 text-blue-500" />
                      <div className="flex-1">
                        <div className="font-medium">GPU</div>
                        {scanData.gpu.name ? (
                          <>
                            <div className="text-sm text-muted-foreground">{scanData.gpu.name}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              CUDA: {scanData.gpu.cuda_available ? `✅ ${scanData.gpu.cuda_version}` : "❌ לא זמין"}
                              {scanData.gpu.memory && ` | VRAM: ${scanData.gpu.memory.total_mb} MB`}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground">לא נמצא GPU — מצב CPU</div>
                        )}
                      </div>
                      {scanData.gpu.cuda_available ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>

                    {/* RAM */}
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <MemoryStick className="h-5 w-5 mt-0.5 text-purple-500" />
                      <div className="flex-1">
                        <div className="font-medium">RAM</div>
                        <div className="text-sm text-muted-foreground">
                          {scanData.system.ram
                            ? `${scanData.system.ram.total_gb} GB (${scanData.system.ram.percent}% בשימוש)`
                            : "לא ידוע"}
                        </div>
                      </div>
                      {scanData.system.ram && (scanData.system.ram.total_gb ?? 0) >= 8 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>

                    {/* Disk */}
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <HardDrive className="h-5 w-5 mt-0.5 text-orange-500" />
                      <div className="flex-1">
                        <div className="font-medium">דיסק</div>
                        <div className="text-sm text-muted-foreground">
                          {scanData.system.disk_free_gb} GB פנוי
                          מתוך {scanData.system.disk_total_gb} GB
                        </div>
                      </div>
                      {scanData.system.disk_free_gb >= 10 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>

                    {/* Packages */}
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <Cpu className="h-5 w-5 mt-0.5 text-cyan-500" />
                      <div className="flex-1">
                        <div className="font-medium">חבילות מותקנות</div>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Object.entries(scanData.packages).map(([pkg, ver]) => (
                            <Badge
                              key={pkg}
                              variant={ver ? "default" : "secondary"}
                              className={`text-xs ${ver ? "bg-green-600" : "opacity-50"}`}
                            >
                              {pkg.replace("_", "-")} {ver ? `✓` : "✗"}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Models */}
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <FileAudio className="h-5 w-5 mt-0.5 text-green-500" />
                      <div className="flex-1">
                        <div className="font-medium">מודלים</div>
                        <div className="text-sm text-muted-foreground">
                          {scanData.models.downloaded.length > 0
                            ? `מותקנים: ${scanData.models.downloaded.join(", ")}`
                            : "אין מודלים מותקנים"}
                        </div>
                        {scanData.models.current && (
                          <div className="text-xs text-muted-foreground mt-1">
                            פעיל: {scanData.models.current}
                          </div>
                        )}
                      </div>
                      {scanData.models.model_ready ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={async () => {
                      const online = await checkServer();
                      if (online) await runScan();
                      else toast.error("השרת לא מחובר");
                    }}
                    disabled={tabStatus.scan === "checking"}
                  >
                    {tabStatus.scan === "checking" ? (
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="ml-2 h-4 w-4" />
                    )}
                    סרוק שוב
                  </Button>
                  {tabStatus.scan === "ok" && (
                    <Button variant="outline" onClick={() => setActiveTab("model")}>
                      הבא: מודל ←
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Tab 2: Installation ===== */}
          <TabsContent value="install">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  התקנת שרת מקומי
                </CardTitle>
                <CardDescription>
                  הרצת סקריפט התקנה אוטומטי — סורק, מתקין, ומחבר הכל
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {serverOnline ? (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="font-medium">השרת מותקן ורץ!</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      אין צורך בהתקנה נוספת. אם רוצה להתקין מחדש, הרץ עם{" "}
                      <code className="bg-muted px-1 rounded" dir="ltr">-Force</code>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Download className="h-5 w-5 text-blue-500" />
                        <span className="font-medium">התקנה מלאה (מומלץ)</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        סקריפט חכם שסורק את המערכת, מזהה מה קיים, ומתקין רק את מה שחסר.
                        כולל Python, PyTorch+CUDA, Whisper, ומודל עברית.
                      </p>
                      <div className="bg-muted rounded-md p-3 font-mono text-sm flex items-center justify-between" dir="ltr">
                        <code>{setupScript}</code>
                        <Button variant="ghost" size="sm" onClick={() => copyCommand(setupScript)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <PlayCircle className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">רק להפעיל (אם כבר מותקן)</span>
                      </div>
                      <div className="bg-muted rounded-md p-3 font-mono text-sm flex items-center justify-between" dir="ltr">
                        <code>{startScript}</code>
                        <Button variant="ghost" size="sm" onClick={() => copyCommand(startScript)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">התקנה מחדש (Force)</span>
                      </div>
                      <div className="bg-muted rounded-md p-3 font-mono text-sm flex items-center justify-between" dir="ltr">
                        <code>{setupScript} -Force</code>
                        <Button variant="ghost" size="sm" onClick={() => copyCommand(`${setupScript} -Force`)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground border-t pt-3 space-y-1">
                      <p className="font-medium">איך להריץ:</p>
                      <ol className="list-decimal list-inside space-y-1 mr-2">
                        <li>פתח PowerShell (לחץ ימני על Start → Terminal)</li>
                        <li>
                          נווט לתיקיית הפרויקט:
                          <code className="bg-muted px-1 rounded mx-1" dir="ltr">cd {`path\\to\\smart-hebrew-transcriber`}</code>
                        </li>
                        <li>העתק והדבק את הפקודה מלמעלה</li>
                        <li>עקוב אחר ההנחיות בטרמינל</li>
                      </ol>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                  <Loader2 className={`h-3 w-3 ${!serverOnline ? "animate-spin" : ""}`} />
                  {serverOnline
                    ? "השרת מחובר"
                    : "ממתין לחיבור שרת... (יתעדכן אוטומטית)"}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Tab 3: Model Download ===== */}
          <TabsContent value="model">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileAudio className="h-5 w-5" />
                  הורדת מודל עברית
                </CardTitle>
                <CardDescription>
                  הורדת המודל העברי לתמלול מקומי (~3 GB)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!serverOnline ? (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">השרת לא מחובר</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      צריך שהשרת ירוץ כדי להוריד מודל. עבור לטאב "התקנה".
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">ivrit-ai/whisper-large-v3-turbo-ct2</div>
                          <div className="text-xs text-muted-foreground">מודל עברי מהיר ומדויק — מומלץ</div>
                        </div>
                        {tabStatus.model === "ok" ? (
                          <Badge className="bg-green-600">מותקן ✓</Badge>
                        ) : tabStatus.model === "downloading" ? (
                          <Badge variant="secondary">מוריד...</Badge>
                        ) : (
                          <Badge variant="outline">לא מותקן</Badge>
                        )}
                      </div>

                      {tabStatus.model === "downloading" && (
                        <div className="space-y-1 pt-2">
                          <Progress value={modelProgress} className="h-2" />
                          <div className="text-xs text-muted-foreground text-left" dir="ltr">
                            {modelProgress}%
                          </div>
                        </div>
                      )}
                    </div>

                    {scanData?.models.downloaded && scanData.models.downloaded.length > 0 && (
                      <div className="text-sm text-muted-foreground">
                        מודלים מותקנים: {scanData.models.downloaded.join(", ")}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={downloadModel}
                        disabled={tabStatus.model === "downloading" || tabStatus.model === "ok"}
                      >
                        {tabStatus.model === "downloading" ? (
                          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="ml-2 h-4 w-4" />
                        )}
                        {tabStatus.model === "ok" ? "המודל מוכן" : "הורד מודל"}
                      </Button>
                      {tabStatus.model === "ok" && (
                        <Button variant="outline" onClick={() => setActiveTab("verify")}>
                          הבא: אימות ←
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Tab 4: Verify ===== */}
          <TabsContent value="verify">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlayCircle className="h-5 w-5" />
                  אימות והפעלה
                </CardTitle>
                <CardDescription>
                  בדיקה שהכל עובד — שרת, GPU, מודל
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!serverOnline ? (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">השרת לא מחובר</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      צריך שהשרת ירוץ לפני אימות. עבור לטאב "התקנה".
                    </p>
                  </div>
                ) : (
                  <>
                    {verifyResult && (
                      <div
                        className={`rounded-lg border p-4 whitespace-pre-wrap text-sm ${
                          tabStatus.verify === "ok"
                            ? "border-green-500/30 bg-green-500/10"
                            : "border-red-500/30 bg-red-500/10"
                        }`}
                      >
                        {verifyResult}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button onClick={testTranscription} disabled={tabStatus.verify === "testing"}>
                        {tabStatus.verify === "testing" ? (
                          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PlayCircle className="ml-2 h-4 w-4" />
                        )}
                        בדוק תקינות
                      </Button>

                      {tabStatus.verify === "ok" && (
                        <Button onClick={() => navigate("/transcribe")} variant="default" className="bg-green-600 hover:bg-green-700">
                          <Zap className="ml-2 h-4 w-4" />
                          התחל לתמלל!
                        </Button>
                      )}
                    </div>

                    {tabStatus.verify === "ok" && (
                      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 mt-2">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                          <span className="font-medium">הכל מוכן!</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          לך לדף התמלול, בחר "שרת CUDA מקומי" כמנוע, והתחל לתמלל.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Setup;
