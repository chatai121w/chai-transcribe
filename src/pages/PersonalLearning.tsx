import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, BrainCircuit, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const VocabularyPanel = lazy(() => import('@/components/VocabularyPanel').then(m => ({ default: m.VocabularyPanel })));
const CorrectionLearningPanel = lazy(() => import('@/components/CorrectionLearningPanel').then(m => ({ default: m.CorrectionLearningPanel })));
const PronunciationProfileSelector = lazy(() => import('@/components/PronunciationProfileSelector').then(m => ({ default: m.PronunciationProfileSelector })));
const LoshonKodeshRules = lazy(() => import('@/pages/LoshonKodeshRules'));
const DefinitiveRulesPanel = lazy(() => import('@/components/DefinitiveRulesPanel').then(m => ({ default: m.DefinitiveRulesPanel })));

const VALID_TABS = new Set(['vocabulary', 'corrections', 'definitive', 'profiles', 'loshon-kodesh']);

function LoadingPanel() {
  return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div>;
}

export default function PersonalLearning() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab') || 'vocabulary';
  const activeTab = VALID_TABS.has(requested) ? requested : 'vocabulary';

  return (
    <main dir="rtl" className="container max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BrainCircuit className="h-6 w-6" />מילון ולמידה אישית</h1>
        <p className="text-sm text-muted-foreground mt-1">מקום אחד לניהול המידע שמשפיע על זיהוי ותיקון התמלול.</p>
      </header>

      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab })}>
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="vocabulary"><BookOpen className="h-4 w-4 ml-1" />אוצר מילים</TabsTrigger>
          <TabsTrigger value="corrections"><BrainCircuit className="h-4 w-4 ml-1" />תיקונים נלמדים</TabsTrigger>
          <TabsTrigger value="definitive"><ShieldCheck className="h-4 w-4 ml-1" />תיקונים חד־משמעיים</TabsTrigger>
          <TabsTrigger value="profiles"><Users className="h-4 w-4 ml-1" />פרופילי הגייה</TabsTrigger>
          <TabsTrigger value="loshon-kodesh"><ScrollText className="h-4 w-4 ml-1" />לשון הקודש</TabsTrigger>
        </TabsList>

        <Suspense fallback={<LoadingPanel />}>
          <TabsContent value="vocabulary" className="mt-4"><VocabularyPanel /></TabsContent>
          <TabsContent value="corrections" className="mt-4"><CorrectionLearningPanel /></TabsContent>
          <TabsContent value="definitive" className="mt-4"><DefinitiveRulesPanel /></TabsContent>
          <TabsContent value="profiles" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">פרופילי הגייה לפי דובר או הקשר</CardTitle></CardHeader>
              <CardContent><PronunciationProfileSelector /></CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="loshon-kodesh" className="mt-4"><LoshonKodeshRules embedded /></TabsContent>
        </Suspense>
      </Tabs>
    </main>
  );
}
