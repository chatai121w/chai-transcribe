import { useEffect, useState, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitCompareArrows, Users, FileAudio, TrendingUp, Wand2, Target, Loader2 } from "lucide-react";
import CompareReport from "./CompareReport";
import DiarizationComparePage from "./DiarizationComparePage";
import TrendsTab from "./compare/TrendsTab";

// Lazy-load the heavy pages so they only mount when their tab is opened
const Benchmark = lazy(() => import("./Benchmark"));
const AsrTraining = lazy(() => import("./AsrTraining"));

type TabId = "trends" | "enhance" | "transcripts" | "ground-truth" | "diarization";
const VALID: TabId[] = ["trends", "enhance", "transcripts", "ground-truth", "diarization"];

// Back-compat for old query params
const LEGACY_MAP: Record<string, TabId> = {
  // none yet
};

const TabFallback = () => (
  <div className="flex items-center justify-center py-16 text-muted-foreground">
    <Loader2 className="w-5 h-5 animate-spin mr-2" />
    טוען…
  </div>
);

const ComparisonsHub = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initial = (): TabId => {
    const raw = new URLSearchParams(location.search).get("tab");
    if (!raw) return "trends";
    if (VALID.includes(raw as TabId)) return raw as TabId;
    if (LEGACY_MAP[raw]) return LEGACY_MAP[raw];
    return "trends";
  };

  const [tab, setTab] = useState<TabId>(initial);

  useEffect(() => {
    const raw = new URLSearchParams(location.search).get("tab");
    const next = raw && VALID.includes(raw as TabId) ? (raw as TabId) : null;
    if (next && next !== tab) setTab(next);
  }, [location.search]);

  const onChange = (next: string) => {
    setTab(next as TabId);
    const params = new URLSearchParams(location.search);
    params.set("tab", next);
    navigate({ pathname: "/compare", search: `?${params.toString()}` }, { replace: true });
  };

  return (
    <div className="container mx-auto py-6 max-w-6xl space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <GitCompareArrows className="w-7 h-7 text-yellow-600" />
        <div>
          <h1 className="text-2xl font-bold">השוואות</h1>
          <p className="text-muted-foreground text-sm">
            כל סוגי ההשוואה במקום אחד — מעקב מגמות, שיפור אודיו, הגדרות תמלול, מול טקסט אמת, וזיהוי דוברים.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={onChange} dir="rtl">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="trends" className="gap-1.5">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">מגמות</span>
          </TabsTrigger>
          <TabsTrigger value="enhance" className="gap-1.5">
            <Wand2 className="w-4 h-4" />
            <span className="hidden sm:inline">שיפור אודיו</span>
          </TabsTrigger>
          <TabsTrigger value="transcripts" className="gap-1.5">
            <FileAudio className="w-4 h-4" />
            <span className="hidden sm:inline">הגדרות תמלול</span>
          </TabsTrigger>
          <TabsTrigger value="ground-truth" className="gap-1.5">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">מול טקסט אמת</span>
          </TabsTrigger>
          <TabsTrigger value="diarization" className="gap-1.5">
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">דוברים</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-4">
          <TrendsTab />
        </TabsContent>
        <TabsContent value="enhance" className="mt-4">
          <Suspense fallback={<TabFallback />}><Benchmark /></Suspense>
        </TabsContent>
        <TabsContent value="transcripts" className="mt-4">
          <CompareReport />
        </TabsContent>
        <TabsContent value="ground-truth" className="mt-4">
          <Suspense fallback={<TabFallback />}><AsrTraining /></Suspense>
        </TabsContent>
        <TabsContent value="diarization" className="mt-4">
          <DiarizationComparePage />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ComparisonsHub;
