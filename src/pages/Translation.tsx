import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  FileText,
  FolderInput,
  FolderOpen,
  HardDrive,
  Languages,
  Laptop,
  Loader2,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomProvidersDialog } from '@/components/CustomProvidersDialog';
import { OllamaManager } from '@/components/OllamaManager';
import { TranscriptFolderDialog } from '@/components/TranscriptFolderDialog';
import { toast } from '@/hooks/use-toast';
import { useCloudTranscripts } from '@/hooks/useCloudTranscripts';
import { useOllama } from '@/hooks/useOllama';
import { editTranscriptCloud } from '@/utils/editTranscriptApi';
import { startLocalOllama } from '@/lib/localServerLauncher';
import {
  chatWithProvider,
  encodeProviderModel,
  getProviders,
  loadProviderKey,
  parseProviderModel,
  subscribeProviders,
} from '@/lib/customProviders';
import {
  buildTranslateGemmaPrompt,
  buildStrictTranslationRetryPrompt,
  buildTranslationPrompt,
  characterNgramFScore,
  extractTextFromImportedFile,
  getTranslationLanguage,
  isTranslateGemmaModel,
  isLikelyWrongTranslationLanguage,
  LOCAL_TRANSLATION_SMOKE_CASES,
  splitTranslationText,
  TRANSLATEGEMMA_MODEL,
  TRANSLATION_LANGUAGES,
} from '@/lib/translation';

type EngineOption = {
  value: string;
  label: string;
  detail: string;
  local: boolean;
};

const CLOUD_ENGINES: EngineOption[] = [
  { value: 'cloud:google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', detail: 'ענן · מומלץ למהירות ואיכות', local: false },
  { value: 'cloud:google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', detail: 'ענן · איכות גבוהה לטקסט מורכב', local: false },
  { value: 'cloud:openai/gpt-5-mini', label: 'GPT-5 Mini', detail: 'ענן · חלופה רב-לשונית', local: false },
];

const TRANSLATION_BENCHMARK_STORAGE_KEY = 'translation_benchmark_v1';

type TranslationBenchmarkResult = {
  average: number;
  scores: number[];
  testedAt: string;
};

type FolderDialogTarget = 'source' | 'translation';

function loadTranslationBenchmark(): TranslationBenchmarkResult | null {
  try {
    const stored = localStorage.getItem(TRANSLATION_BENCHMARK_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as TranslationBenchmarkResult;
    return Number.isFinite(parsed.average) && Array.isArray(parsed.scores) ? parsed : null;
  } catch {
    return null;
  }
}

function preferredText(transcript: { edited_text?: string | null; text: string }) {
  return transcript.edited_text?.trim() || transcript.text;
}

export default function Translation() {
  const { transcripts, isLoading, saveTranscript, updateTranscript } = useCloudTranscripts();
  const ollama = useOllama();
  const fileRef = useRef<HTMLInputElement>(null);
  const [providerRevision, setProviderRevision] = useState(0);
  const [sourceText, setSourceText] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceTranscriptId, setSourceTranscriptId] = useState<string | null>(null);
  const [sourceFolderId, setSourceFolderId] = useState<string | null>(null);
  const [sourceFolderName, setSourceFolderName] = useState('');
  const [resultTranscriptId, setResultTranscriptId] = useState<string | null>(null);
  const [resultFolderId, setResultFolderId] = useState<string | null>(null);
  const [resultFolderName, setResultFolderName] = useState('');
  const [folderDialogTarget, setFolderDialogTarget] = useState<FolderDialogTarget | null>(null);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [engine, setEngine] = useState(CLOUD_ENGINES[0].value);
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [glossary, setGlossary] = useState('');
  const [result, setResult] = useState('');
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<TranslationBenchmarkResult | null>(loadTranslationBenchmark);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [isStartingOllama, setIsStartingOllama] = useState(false);

  useEffect(() => subscribeProviders(() => setProviderRevision(value => value + 1)), []);

  const customEngines = useMemo<EngineOption[]>(() => {
    void providerRevision;
    return getProviders()
      .filter(provider => provider.enabled)
      .flatMap(provider => (provider.models || []).map(model => ({
        value: encodeProviderModel(provider.id, model.id),
        label: `${provider.name} · ${model.label || model.id}`,
        detail: provider.requiresKey ? 'ספק ענן תואם OpenAI' : 'שרת מקומי תואם OpenAI',
        local: !provider.requiresKey,
      })));
  }, [providerRevision]);

  useEffect(() => {
    for (const provider of getProviders().filter(item => item.enabled && item.requiresKey)) {
      void loadProviderKey(provider.id);
    }
  }, [providerRevision]);

  const ollamaEngines = useMemo<EngineOption[]>(() => ollama.models.map(model => ({
    value: `ollama:${model.name}`,
    label: model.name,
    detail: `Ollama מקומי · ${model.details?.parameter_size || 'גודל לא ידוע'}`,
    local: true,
  })), [ollama.models]);

  const engines = useMemo(() => [...CLOUD_ENGINES, ...ollamaEngines, ...customEngines], [ollamaEngines, customEngines]);
  const localCustomEngines = useMemo(() => customEngines.filter(option => option.local), [customEngines]);
  const cloudCustomEngines = useMemo(() => customEngines.filter(option => !option.local), [customEngines]);
  const translateGemma = ollama.models.find(model => isTranslateGemmaModel(model.name));
  const translateGemmaJob = ollama.pullJobs[TRANSLATEGEMMA_MODEL];
  const translateGemmaPulling = ['starting', 'pulling', 'retrying'].includes(translateGemmaJob?.status || '');
  const selectedOllamaModel = engine.startsWith('ollama:') ? engine.slice('ollama:'.length) : '';
  const selectedTranslateGemma = isTranslateGemmaModel(selectedOllamaModel);

  const startOllama = async () => {
    setIsStartingOllama(true);
    try {
      await startLocalOllama();
      let connected = false;
      for (let attempt = 0; attempt < 12 && !connected; attempt += 1) {
        connected = await ollama.checkConnection();
        if (!connected) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!connected) throw new Error('Ollama הופעל, אך הדפדפן עדיין לא הצליח לקרוא את רשימת המודלים. בדוק הרשאת רשת מקומית או CORS.');
      toast({ title: 'Ollama מחובר', description: 'רשימת המודלים המקומיים נטענה וניתן לבחור מנוע.' });
    } catch (error) {
      toast({ title: 'הפעלת Ollama נכשלה', description: error instanceof Error ? error.message : 'שגיאת חיבור', variant: 'destructive' });
    } finally {
      setIsStartingOllama(false);
    }
  };

  const folderOptions = useMemo(() => {
    const folders = new Map<string, string>();
    transcripts.forEach(transcript => {
      if (transcript.folder_id) folders.set(transcript.folder_id, transcript.folder || 'תיקייה ללא שם');
      else if (transcript.folder) folders.set(`name:${transcript.folder}`, transcript.folder);
    });
    return [...folders.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [transcripts]);

  const visibleTranscripts = useMemo(() => transcripts.filter(transcript => {
    const q = search.trim().toLocaleLowerCase('he');
    const matchesSearch = !q
      || transcript.title?.toLocaleLowerCase('he').includes(q)
      || preferredText(transcript).toLocaleLowerCase('he').includes(q);
    const transcriptFolderKey = transcript.folder_id || (transcript.folder ? `name:${transcript.folder}` : 'root');
    return matchesSearch && (folderFilter === 'all' || folderFilter === transcriptFolderKey);
  }), [folderFilter, search, transcripts]);

  const chooseTranscript = (id: string) => {
    const transcript = transcripts.find(item => item.id === id);
    if (!transcript) return;
    setSourceText(preferredText(transcript));
    setSourceTitle(transcript.title || 'תמלול');
    setSourceTranscriptId(transcript.id);
    setSourceFolderId(transcript.folder_id || null);
    setSourceFolderName(transcript.folder || '');
    setResult('');
    setResultTranscriptId(null);
    setResultFolderId(null);
    setResultFolderName('');
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const contents = await file.text();
      const text = extractTextFromImportedFile(contents, file.name).trim();
      if (!text) throw new Error('לא נמצא טקסט בקובץ');
      setSourceText(text);
      setSourceTitle(file.name.replace(/\.[^.]+$/, ''));
      setSourceTranscriptId(null);
      setSourceFolderId(null);
      setSourceFolderName('');
      setResult('');
      setResultTranscriptId(null);
      setResultFolderId(null);
      setResultFolderName('');
    } catch (error) {
      toast({ title: 'ייבוא הקובץ נכשל', description: error instanceof Error ? error.message : 'קובץ לא תקין', variant: 'destructive' });
    }
  };

  const translateChunk = async (text: string, prompt: string): Promise<string> => {
    const target = getTranslationLanguage(targetLanguage);
    if (engine.startsWith('ollama:')) {
      return ollama.editText({
        text,
        action: 'translate',
        model: engine.slice('ollama:'.length),
        customPrompt: prompt,
        targetLanguage: `${target.modelLabel} (${target.code})`,
      });
    }
    const parsed = parseProviderModel(engine);
    if (parsed) {
      return chatWithProvider({ ...parsed, systemPrompt: prompt, userText: text, temperature: 0.1 });
    }
    const model = engine.replace(/^cloud:/, '');
    return editTranscriptCloud({
      text,
      action: 'translate',
      customPrompt: prompt,
      targetLanguage: `${target.modelLabel} (${target.code})`,
      model,
    });
  };

  const runTranslation = async () => {
    if (!sourceText.trim()) {
      toast({ title: 'אין טקסט לתרגום', variant: 'destructive' });
      return;
    }
    if (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
      toast({ title: 'שפת המקור והיעד זהות', variant: 'destructive' });
      return;
    }
    if (selectedTranslateGemma && sourceLanguage === 'auto') {
      toast({ title: 'בחר שפת מקור', description: 'TranslateGemma דורש קוד שפת מקור מפורש כדי למנוע תרגום לשפה שגויה.', variant: 'destructive' });
      return;
    }

    const chunks = splitTranslationText(sourceText, 6000);
    const prompt = selectedTranslateGemma
      ? buildTranslateGemmaPrompt({ sourceCode: sourceLanguage, targetCode: targetLanguage, preserveStructure, glossary })
      : buildTranslationPrompt({ sourceCode: sourceLanguage, targetCode: targetLanguage, preserveStructure, glossary });
    setIsTranslating(true);
    setProgress(3);
    setProgressDetail(`מכין ${chunks.length} מקטעים`);
    setResult('');
    setResultTranscriptId(null);
    try {
      const translated = new Array<string>(chunks.length);
      let nextIndex = 0;
      let completed = 0;
      const workerCount = engine.startsWith('ollama:') ? 1 : Math.min(2, chunks.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < chunks.length) {
          const index = nextIndex++;
          let output = (await translateChunk(chunks[index], prompt)).trim();
          if (isLikelyWrongTranslationLanguage(output, targetLanguage)) {
            const retryPrompt = selectedTranslateGemma
              ? `${prompt}\n\nThe previous response used the wrong language. Return ${getTranslationLanguage(targetLanguage).modelLabel} (${targetLanguage}) only, with no explanation.`
              : buildStrictTranslationRetryPrompt({ sourceCode: sourceLanguage, targetCode: targetLanguage, preserveStructure, glossary });
            output = (await translateChunk(chunks[index], retryPrompt)).trim();
          }
          if (isLikelyWrongTranslationLanguage(output, targetLanguage)) {
            throw new Error(`המנוע החזיר טקסט בשפה שגויה במקום ${getTranslationLanguage(targetLanguage).label}. נסה מנוע אחר או בחר שפת מקור ידנית.`);
          }
          translated[index] = output;
          completed += 1;
          setProgress(Math.round(5 + (completed / chunks.length) * 95));
          setProgressDetail(`הושלמו ${completed} מתוך ${chunks.length} מקטעים`);
        }
      });
      await Promise.all(workers);
      setResult(translated.join('\n\n'));
      toast({ title: 'התרגום הושלם', description: `${chunks.length} מקטעים תורגמו ללא השמטה` });
    } catch (error) {
      toast({ title: 'התרגום נכשל', description: error instanceof Error ? error.message : 'שגיאת מנוע', variant: 'destructive' });
    } finally {
      setIsTranslating(false);
      setProgressDetail('');
    }
  };

  const installTranslateGemma = async () => {
    try {
      await ollama.pullModel(TRANSLATEGEMMA_MODEL);
      setEngine(`ollama:${TRANSLATEGEMMA_MODEL}`);
      toast({ title: 'TranslateGemma הותקן', description: 'המודל המקומי מוכן לתרגום פרטי ואופליין.' });
    } catch (error) {
      toast({ title: 'התקנת TranslateGemma נכשלה', description: error instanceof Error ? error.message : 'שגיאת הורדה', variant: 'destructive' });
    }
  };

  const deleteTranslateGemma = async () => {
    if (!translateGemma || !window.confirm('למחוק את TranslateGemma מהמחשב?')) return;
    try {
      await ollama.deleteModel(translateGemma.name);
      setEngine(CLOUD_ENGINES[0].value);
      setBenchmarkResult(null);
      toast({ title: 'המודל המקומי נמחק' });
    } catch (error) {
      toast({ title: 'מחיקת המודל נכשלה', description: error instanceof Error ? error.message : 'שגיאה', variant: 'destructive' });
    }
  };

  const runLocalBenchmark = async () => {
    if (!translateGemma) return;
    setIsBenchmarking(true);
    setBenchmarkResult(null);
    try {
      const scores: number[] = [];
      for (const testCase of LOCAL_TRANSLATION_SMOKE_CASES) {
        const prompt = buildTranslateGemmaPrompt({
          sourceCode: testCase.sourceCode,
          targetCode: testCase.targetCode,
          preserveStructure: true,
        });
        const output = await ollama.editText({
          text: testCase.source,
          action: 'translate',
          model: translateGemma.name,
          customPrompt: prompt,
          targetLanguage: `${getTranslationLanguage(testCase.targetCode).modelLabel} (${testCase.targetCode})`,
        });
        scores.push(characterNgramFScore(testCase.reference, output));
      }
      const average = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
      const nextResult = { average, scores, testedAt: new Date().toISOString() };
      setBenchmarkResult(nextResult);
      localStorage.setItem(TRANSLATION_BENCHMARK_STORAGE_KEY, JSON.stringify(nextResult));
      toast({ title: 'בדיקת הייחוס הסתיימה', description: `ציון chrF ראשוני: ${average}` });
    } catch (error) {
      toast({ title: 'בדיקת המודל נכשלה', description: error instanceof Error ? error.message : 'שגיאה', variant: 'destructive' });
    } finally {
      setIsBenchmarking(false);
    }
  };

  const ensureSourceSaved = async (folderId = sourceFolderId, folderName = sourceFolderName) => {
    if (!sourceText.trim()) return null;
    if (sourceTranscriptId) {
      await updateTranscript(sourceTranscriptId, { folder_id: folderId, folder: folderName });
      return sourceTranscriptId;
    }
    const saved = await saveTranscript(
      sourceText,
      'translation-source',
      sourceTitle || 'מקור לתרגום',
      undefined,
      null,
      folderName,
    );
    if (!saved) return null;
    await updateTranscript(saved.id, { folder_id: folderId, folder: folderName });
    setSourceTranscriptId(saved.id);
    return saved.id;
  };

  const ensureResultSaved = async (folderId = resultFolderId, folderName = resultFolderName) => {
    if (!result.trim()) return null;
    if (resultTranscriptId) {
      await updateTranscript(resultTranscriptId, {
        text: result,
        folder_id: folderId,
        folder: folderName,
      });
      return resultTranscriptId;
    }
    const language = getTranslationLanguage(targetLanguage);
    const selectedEngine = engines.find(item => item.value === engine)?.label || engine;
    const saved = await saveTranscript(
      result,
      `translation:${selectedEngine}`,
      `${sourceTitle || 'תרגום'} · ${language.label}`,
      undefined,
      null,
      folderName,
    );
    if (!saved) return null;
    await updateTranscript(saved.id, { folder_id: folderId, folder: folderName });
    setResultTranscriptId(saved.id);
    return saved.id;
  };

  const saveResult = async () => {
    const id = await ensureResultSaved();
    if (id) toast({ title: 'התרגום נשמר', description: 'התרגום זמין כעת במאגר ובמערכת התיקיות' });
  };

  const assignFolder = async (folderId: string | null, folderName: string) => {
    if (folderDialogTarget === 'source') {
      const id = await ensureSourceSaved(folderId, folderName);
      if (!id) throw new Error('לא ניתן לשמור את טקסט המקור');
      setSourceFolderId(folderId);
      setSourceFolderName(folderName);
      toast({ title: folderId ? 'המקור סווג לתיקייה' : 'שיוך המקור הוסר' });
      return;
    }
    if (folderDialogTarget === 'translation') {
      const id = await ensureResultSaved(folderId, folderName);
      if (!id) throw new Error('לא ניתן לשמור את התרגום');
      setResultFolderId(folderId);
      setResultFolderName(folderName);
      toast({ title: folderId ? 'התרגום סווג לתיקייה' : 'שיוך התרגום הוסר' });
    }
  };

  const downloadResult = () => {
    const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sourceTitle || 'translation'}-${targetLanguage}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main dir="rtl" className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Languages className="h-6 w-6" /> מרכז תרגום</h1>
          <p className="mt-1 text-sm text-muted-foreground">תרגום תמלולים וקבצים עם מנועי ענן או מנועים מקומיים, בלי לשכפל את מאגר התמלולים.</p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Cloud className="h-4 w-4" /> ענן</span>
          <span className="flex items-center gap-1"><Laptop className="h-4 w-4" /> מקומי ופרטי</span>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-4 rounded-md p-4">
          <Tabs defaultValue="library" dir="rtl">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="library"><FolderOpen className="ml-2 h-4 w-4" /> מהתיקיות</TabsTrigger>
              <TabsTrigger value="file"><Upload className="ml-2 h-4 w-4" /> מהמחשב</TabsTrigger>
              <TabsTrigger value="paste"><FileText className="ml-2 h-4 w-4" /> הדבקת טקסט</TabsTrigger>
            </TabsList>
            <TabsContent value="library" className="space-y-3 pt-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש לפי כותרת או תוכן..." />
                <Select value={folderFilter} onValueChange={setFolderFilter}>
                  <SelectTrigger><SelectValue placeholder="כל התיקיות" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">כל התיקיות והענן</SelectItem>
                    <SelectItem value="root">ללא תיקייה</SelectItem>
                    {folderOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Select value={sourceTranscriptId || undefined} onValueChange={chooseTranscript} disabled={isLoading || !visibleTranscripts.length}>
                <SelectTrigger><SelectValue placeholder={isLoading ? 'טוען תמלולים...' : 'בחר תמלול מהמאגר'} /></SelectTrigger>
                <SelectContent dir="rtl" className="max-h-80">
                  {visibleTranscripts.map(transcript => (
                    <SelectItem key={transcript.id} value={transcript.id}>
                      {transcript.title || preferredText(transcript).slice(0, 60)} · {transcript.local_only ? 'מקומי' : 'ענן'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TabsContent>
            <TabsContent value="file" className="pt-3">
              <input ref={fileRef} type="file" accept=".txt,.md,.srt,.vtt,.json,text/plain,application/json" className="hidden" onChange={event => void importFile(event.target.files?.[0])} />
              <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}><Upload className="ml-2 h-4 w-4" /> בחר TXT, Markdown, SRT, VTT או JSON</Button>
            </TabsContent>
            <TabsContent value="paste" className="pt-3">
              <Input value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} placeholder="שם התרגום" />
            </TabsContent>
          </Tabs>

          <Textarea dir="auto" value={sourceText} onChange={event => { setSourceText(event.target.value); setSourceTranscriptId(null); }} placeholder="הטקסט לתרגום יופיע כאן" className="min-h-[320px] resize-y text-base leading-7" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">{sourceText.length.toLocaleString('he-IL')} תווים · {sourceText.trim() ? sourceText.trim().split(/\s+/).length.toLocaleString('he-IL') : 0} מילים</div>
            <Button type="button" variant="outline" size="sm" disabled={!sourceText.trim()} onClick={() => setFolderDialogTarget('source')} data-testid="classify-translation-source">
              <FolderInput className="ml-2 h-4 w-4" />
              {sourceFolderName ? `מקור: ${sourceFolderName}` : 'סווג מקור לתיקייה'}
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 rounded-md p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>שפת מקור</Label>
              <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl"><SelectItem value="auto">זיהוי אוטומטי</SelectItem>{TRANSLATION_LANGUAGES.map(language => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>שפת יעד</Label>
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">{TRANSLATION_LANGUAGES.map(language => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>מנוע תרגום</Label>
            <Select value={engine} onValueChange={setEngine}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl" className="max-h-80">
                <SelectGroup>
                  <SelectLabel>מנועי ענן</SelectLabel>
                  {CLOUD_ENGINES.map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.detail}</SelectItem>)}
                  {cloudCustomEngines.map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.detail}</SelectItem>)}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Ollama מקומי ופרטי ({ollamaEngines.length})</SelectLabel>
                  {ollamaEngines.length > 0
                    ? ollamaEngines.map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.detail}</SelectItem>)
                    : <SelectItem value="ollama-unavailable" disabled>{ollama.isConnected ? 'אין מודלים מותקנים' : 'Ollama אינו מחובר'}</SelectItem>}
                </SelectGroup>
                {localCustomEngines.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>שרתים מקומיים תואמי OpenAI</SelectLabel>
                      {localCustomEngines.map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.detail}</SelectItem>)}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            <div className={`rounded-md border p-3 ${ollama.isConnected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Server className={`h-5 w-5 shrink-0 ${ollama.isConnected ? 'text-emerald-600' : 'text-amber-600'}`} />
                  <div>
                    <p className="text-sm font-semibold">{ollama.isConnected ? `Ollama מחובר · ${ollama.models.length} מודלים מותקנים` : 'Ollama אינו מחובר'}</p>
                    <p className="text-xs text-muted-foreground">
                      {ollama.isConnected ? 'המנועים המותקנים זמינים בבורר שמעל.' : 'Ollama מותקן במחשב אך השירות צריך לפעול כדי לטעון ולבחור מודלים.'}
                    </p>
                    {ollama.connectionError && !ollama.isConnected && <p className="mt-1 text-xs text-destructive">{ollama.connectionError}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!ollama.isConnected && (
                    <Button type="button" size="sm" onClick={() => void startOllama()} disabled={isStartingOllama || ollama.isChecking}>
                      {isStartingOllama ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Server className="ml-2 h-4 w-4" />}
                      {isStartingOllama ? 'מפעיל ומתחבר...' : 'הפעל Ollama'}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => void ollama.checkConnection()} disabled={ollama.isChecking || isStartingOllama}>
                    <RefreshCw className={`ml-2 h-4 w-4 ${ollama.isChecking ? 'animate-spin' : ''}`} /> רענן
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setModelManagerOpen(true)}>
                    <HardDrive className="ml-2 h-4 w-4" /> מודלים והורדות
                  </Button>
                  <CustomProvidersDialog trigger={
                    <Button type="button" size="sm" variant="outline"><Settings2 className="ml-2 h-4 w-4" /> שרת מקומי נוסף</Button>
                  } />
                </div>
              </div>
            </div>
            {selectedTranslateGemma && sourceLanguage === 'auto' && (
              <p className="text-xs font-medium text-destructive">יש לבחור שפת מקור ידנית עבור TranslateGemma.</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="preserve-translation-structure" checked={preserveStructure} onCheckedChange={value => setPreserveStructure(value === true)} />
            <Label htmlFor="preserve-translation-structure">שמור פסקאות, חותמות זמן ושמות דוברים</Label>
          </div>
          <Textarea value={glossary} onChange={event => setGlossary(event.target.value)} placeholder={'מילון מונחים אופציונלי, שורה לכל כלל\nבבא בתרא = Bava Batra'} className="min-h-20" />
          <Button className="w-full" size="lg" disabled={isTranslating || !sourceText.trim()} onClick={() => void runTranslation()}>
            <Languages className="ml-2 h-5 w-5" /> {isTranslating ? `מתרגם ${progress}%` : 'תרגם'}
          </Button>
          {isTranslating && <div className="space-y-1"><Progress value={progress} className="h-2" /><p className="text-xs text-muted-foreground">{progressDetail}</p></div>}

          <Textarea dir={getTranslationLanguage(targetLanguage).direction} value={result} onChange={event => setResult(event.target.value)} placeholder="התרגום יופיע כאן" className="min-h-[250px] resize-y text-base leading-7" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!result.trim()} onClick={() => void saveResult()}><Save className="ml-2 h-4 w-4" /> שמור במאגר</Button>
            <Button type="button" variant="outline" disabled={!result.trim()} onClick={() => setFolderDialogTarget('translation')} data-testid="classify-translation-result">
              <FolderInput className="ml-2 h-4 w-4" />
              {resultFolderName ? `תרגום: ${resultFolderName}` : 'סווג תרגום לתיקייה'}
            </Button>
            <Button variant="outline" disabled={!result.trim()} onClick={() => void navigator.clipboard.writeText(result)}><Copy className="ml-2 h-4 w-4" /> העתק</Button>
            <Button variant="outline" disabled={!result.trim()} onClick={downloadResult}><Download className="ml-2 h-4 w-4" /> הורד TXT</Button>
          </div>
        </Card>
      </section>

      <section className="space-y-4 border-t border-border pt-4">
        <div>
          <h2 className="text-lg font-semibold">TranslateGemma 4B מקומי</h2>
          <p className="text-sm text-muted-foreground">תרגום פרטי ואופליין בין עברית, אנגלית, גרמנית, צרפתית, ספרדית ויידיש. גודל ההורדה כ־3.3GB.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {TRANSLATION_LANGUAGES.map(language => (
              <span
                key={language.code}
                className={`rounded border px-2 py-1 ${language.code === 'yi' ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'}`}
              >
                {language.label}: {language.code === 'yi' ? 'ניסיוני' : 'עבר בדיקת עשן מקומית'}
              </span>
            ))}
          </div>
        </div>

        <Card className="rounded-md p-4">
          {!ollama.isConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><strong>Ollama אינו מחובר</strong><p className="text-sm text-muted-foreground">יש להפעיל את Ollama לפני התקנת המודל המקומי.</p></div>
              <Button variant="outline" onClick={() => void ollama.checkConnection()}>בדוק חיבור</Button>
            </div>
          ) : translateGemma ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><div><strong>מותקן ומוכן</strong><p className="text-sm text-muted-foreground">{translateGemma.name} · {translateGemma.details?.parameter_size || '4B'}</p></div></div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEngine(`ollama:${translateGemma.name}`)}>בחר כמנוע</Button>
                  <Button variant="outline" disabled={isBenchmarking} onClick={() => void runLocalBenchmark()}>
                    {isBenchmarking && <Loader2 className="ml-2 h-4 w-4 animate-spin" />} בדיקת איכות מספרית
                  </Button>
                  <Button variant="ghost" className="text-destructive" onClick={() => void deleteTranslateGemma()}><Trash2 className="ml-2 h-4 w-4" /> מחק</Button>
                </div>
              </div>
              {benchmarkResult && (
                <div className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong>ציון chrF ראשוני: {benchmarkResult.average}</strong><span className="text-xs text-muted-foreground">6 בדיקות קבועות · {new Date(benchmarkResult.testedAt).toLocaleString('he-IL')}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 md:grid-cols-6">
                    {LOCAL_TRANSLATION_SMOKE_CASES.map((testCase, index) => <span key={`${testCase.sourceCode}-${testCase.targetCode}`}>{testCase.sourceCode}→{testCase.targetCode}: {benchmarkResult.scores[index]}</span>)}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">זהו מדד התאמת ניסוח לייחוס, לא תחליף לבדיקה אנושית של משמעות. יידיש נשארת ניסיונית עד בדיקה על קורפוס אמיתי.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="gemma-license" checked={licenseAccepted} onCheckedChange={value => setLicenseAccepted(value === true)} />
                <Label htmlFor="gemma-license">קראתי ואני מסכים לתנאי השימוש של Gemma</Label>
              </div>
              <a className="block text-sm text-primary underline" href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer">פתח את תנאי הרישיון של Google Gemma</a>
              {translateGemmaPulling && <Progress value={translateGemmaJob?.percent || 0} className="h-2" />}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!licenseAccepted || translateGemmaPulling} onClick={() => void installTranslateGemma()}>
                  <Download className="ml-2 h-4 w-4" /> {translateGemmaPulling ? `מוריד ${translateGemmaJob?.percent || 0}%` : 'הורד והתקן מקומית'}
                </Button>
                {translateGemmaPulling && <Button variant="outline" onClick={() => ollama.cancelPull(TRANSLATEGEMMA_MODEL)}><Square className="ml-2 h-4 w-4" /> עצור</Button>}
                {translateGemmaJob?.status === 'cancelled' && <Button variant="outline" onClick={() => void ollama.resumePull(TRANSLATEGEMMA_MODEL)}>המשך הורדה</Button>}
              </div>
              {translateGemmaJob?.error && <p className="text-sm text-destructive">{translateGemmaJob.error}</p>}
            </div>
          )}
        </Card>

        <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> המודל אינו נהפך לברירת מחדל אוטומטית. לאחר ההתקנה ניתן להשוות אותו מול Gemini ולבחור ידנית.</p>
      </section>

      <Dialog open={modelManagerOpen} onOpenChange={(open) => {
        setModelManagerOpen(open);
        if (!open) void ollama.checkConnection();
      }}>
        <DialogContent dir="rtl" className="max-h-[92vh] max-w-6xl overflow-y-auto p-3 sm:p-5">
          <DialogHeader className="px-1">
            <DialogTitle>מודלים מקומיים והורדות</DialogTitle>
            <DialogDescription>זהו מנהל Ollama המשותף לכל המערכת. מודל שמותקן כאן יופיע גם בבורר מנוע התרגום.</DialogDescription>
          </DialogHeader>
          <OllamaManager />
        </DialogContent>
      </Dialog>

      <TranscriptFolderDialog
        open={folderDialogTarget !== null}
        onOpenChange={(open) => { if (!open) setFolderDialogTarget(null); }}
        currentFolderId={folderDialogTarget === 'source' ? sourceFolderId : resultFolderId}
        title={folderDialogTarget === 'source' ? 'סיווג המקור לתיקייה' : 'סיווג התרגום לתיקייה'}
        description="בחר תיקייה קיימת או צור תיקייה חדשה. המקור והתרגום נשמרים בנפרד."
        onAssign={assignFolder}
      />
    </main>
  );
}
