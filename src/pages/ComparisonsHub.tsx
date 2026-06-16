import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitCompareArrows, Users, FileAudio } from "lucide-react";
import CompareReport from "./CompareReport";
import DiarizationComparePage from "./DiarizationComparePage";

type TabId = "transcripts" | "diarization";

const VALID: TabId[] = ["transcripts", "diarization"];

const ComparisonsHub = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initial = (): TabId => {
    const param = new URLSearchParams(location.search).get("tab") as TabId | null;
    return param && VALID.includes(param) ? param : "transcripts";
  };

  const [tab, setTab] = useState<TabId>(initial);

  useEffect(() => {
    const param = new URLSearchParams(location.search).get("tab");
    if (param && VALID.includes(param as TabId) && param !== tab) {
      setTab(param as TabId);
    }
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
            כל סוגי ההשוואה במקום אחד — תמלולים מלאים מאודיו וגם זיהוי דוברים.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={onChange} dir="rtl">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="transcripts" className="gap-2">
            <FileAudio className="w-4 h-4" />
            תמלולים (אודיו)
          </TabsTrigger>
          <TabsTrigger value="diarization" className="gap-2">
            <Users className="w-4 h-4" />
            זיהוי דוברים
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcripts" className="mt-4">
          <CompareReport />
        </TabsContent>
        <TabsContent value="diarization" className="mt-4">
          <DiarizationComparePage />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ComparisonsHub;
