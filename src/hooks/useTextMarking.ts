import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { analyzeMorphology } from "@/utils/dictaApi";
import { supabase } from "@/integrations/supabase/client";
import { buildIssueMap, type SyncedSpellAssistSettings, type MenuSuggestion } from "@/utils/syncedSpellAssist";
import type { WordValidation } from "@/components/DictionaryValidator";

/* ── Types ───────────────────────────────────────────────────── */

export interface MarkingSettings {
  showUnknown: boolean;
  showGrammar: boolean;
  showContext: boolean;
  showDuplicates: boolean;
  localSpellCheck: boolean;
}

export interface DuplicateGroup {
  word: string;
  indices: number[];
}

interface CachedAnalysis {
  wordResults: WordValidation[];
  duplicates: DuplicateGroup[];
  timestamp: number;
}

/* ── Constants ───────────────────────────────────────────────── */

const BATCH_SIZE = 40;
const PARALLEL_LIMIT = 4;
const LOCAL_CACHE_KEY = "text_analysis_cache";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MARKING_SETTINGS_KEY = "marking_settings_v1";

/* ── Hash / Cache helpers ─────────────────────────────────────── */

const hashText = (text: string): string => {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36) + "_" + text.length;
};

const getLocalCache = (hash: string): CachedAnalysis | null => {
  try {
    const raw = localStorage.getItem(`${LOCAL_CACHE_KEY}_${hash}`);
    if (!raw) return null;
    const cached: CachedAnalysis = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(`${LOCAL_CACHE_KEY}_${hash}`);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
};

const setLocalCache = (hash: string, data: CachedAnalysis) => {
  try {
    localStorage.setItem(`${LOCAL_CACHE_KEY}_${hash}`, JSON.stringify(data));
  } catch {
    /* quota exceeded */
  }
};

function loadMarkingSettings(): MarkingSettings {
  try {
    const raw = localStorage.getItem(MARKING_SETTINGS_KEY);
    if (!raw) return { showUnknown: true, showGrammar: true, showContext: false, showDuplicates: true, localSpellCheck: true };
    return { showUnknown: true, showGrammar: true, showContext: false, showDuplicates: true, localSpellCheck: true, ...JSON.parse(raw) };
  } catch {
    return { showUnknown: true, showGrammar: true, showContext: false, showDuplicates: true, localSpellCheck: true };
  }
}

/* ── Hook ─────────────────────────────────────────────────────── */

export function useTextMarking(words: string[], onWordReplace?: (index: number, replacement: string) => void) {
  const text = useMemo(() => words.join(" "), [words]);

  const [settings, setSettings] = useState<MarkingSettings>(loadMarkingSettings);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [wordResults, setWordResults] = useState<WordValidation[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [cacheSource, setCacheSource] = useState<"none" | "local" | "cloud">("none");
  const [selectedFixes, setSelectedFixes] = useState<Set<number>>(new Set());
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [selectedDuplicate, setSelectedDuplicate] = useState<DuplicateGroup | null>(null);

  const completedBatchesRef = useRef<Set<number>>(new Set());
  const morphResultsRef = useRef<WordValidation[]>([]);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const totalBatchesRef = useRef(0);
  const completedCountRef = useRef(0);
  const lastTextHashRef = useRef<string>("");

  // Persist marking settings
  useEffect(() => {
    try { localStorage.setItem(MARKING_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  /* split preserving spaces (for index-based replacement) */
  const splitWords = useMemo(() => {
    if (!text.trim()) return [];
    return text.split(/(\s+)/).filter((w) => w.length > 0);
  }, [text]);

  const actualWords = useMemo(
    () =>
      splitWords
        .map((w, i) => ({ word: w, index: i }))
        .filter(({ word }) => /\S/.test(word)),
    [splitWords],
  );

  /* ── Duplicate detection ── */
  const detectDuplicates = useCallback(() => {
    const groups: DuplicateGroup[] = [];
    const cleanWords = actualWords.map((w) =>
      w.word.replace(/[.,;:!?'"()\-–—]/g, "").trim(),
    );
    let i = 0;
    while (i < cleanWords.length) {
      if (cleanWords[i].length < 2) { i++; continue; }
      const curr = cleanWords[i];
      const dupeIndices = [actualWords[i].index];
      let j = i + 1;
      while (j < cleanWords.length && cleanWords[j] === curr) {
        dupeIndices.push(actualWords[j].index);
        j++;
      }
      if (dupeIndices.length > 1) groups.push({ word: curr, indices: dupeIndices });
      i = j;
    }
    return groups;
  }, [actualWords]);

  /* ── AI batch processor ── */
  // Module-level latch: once the AI gateway returns 402 (Payment Required) we
  // stop firing new requests for the rest of the session to avoid spamming
  // the network with calls that will all fail. The user is notified once.
  const aiCreditsExhaustedRef = useRef(false);
  const processAIBatch = useCallback(
    async (
      batch: { word: string; index: number }[],
      allActualWords: { word: string; index: number }[],
    ): Promise<Partial<WordValidation>[]> => {
      if (aiCreditsExhaustedRef.current) return [];
      const wordsPayload = batch.map((r) => {
        const wordIdx = allActualWords.findIndex((aw) => aw.index === r.index);
        return {
          word: r.word,
          index: r.index,
          prev: wordIdx > 0 ? allActualWords[wordIdx - 1].word : undefined,
          next: wordIdx < allActualWords.length - 1 ? allActualWords[wordIdx + 1].word : undefined,
        };
      });
      const { data, error } = await supabase.functions.invoke("check-dictionary", {
        body: { words: wordsPayload },
      });
      if (error) {
        // FunctionsHttpError exposes context.status — also fall back to message scan
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        const msg = String((error as any)?.message ?? "");
        if (status === 402 || /402|payment required/i.test(msg)) {
          if (!aiCreditsExhaustedRef.current) {
            aiCreditsExhaustedRef.current = true;
            cancelRef.current = true;
            toast({
              title: "אין קרדיט ל־AI",
              description: "בדיקת דקדוק/הקשר הושבתה לסשן זה (Lovable AI Gateway החזיר 402). בדוק חיוב ונסה שוב.",
              variant: "destructive",
            });
          }
          return [];
        }
      }
      if (!error && data?.results) return data.results;
      return [];
    },
    [],
  );

  /* ── Cloud cache ── */
  const saveToCloud = useCallback(async (hash: string, results: WordValidation[], dupes: DuplicateGroup[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("text_analysis_cache" as any).upsert(
        {
          user_id: user.id, text_hash: hash, word_count: results.length,
          results: JSON.stringify(results), duplicates: JSON.stringify(dupes),
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "user_id,text_hash" },
      );
    } catch (err) {
      console.error("Cloud cache save error:", err);
    }
  }, []);

  const loadFromCloud = useCallback(async (hash: string): Promise<CachedAnalysis | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from("text_analysis_cache" as any)
        .select("results, duplicates, updated_at")
        .eq("user_id", user.id)
        .eq("text_hash", hash)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as any;
      const updatedAt = new Date(row.updated_at).getTime();
      if (Date.now() - updatedAt > CACHE_MAX_AGE_MS) return null;
      return {
        wordResults: typeof row.results === "string" ? JSON.parse(row.results) : row.results,
        duplicates: typeof row.duplicates === "string" ? JSON.parse(row.duplicates) : row.duplicates,
        timestamp: updatedAt,
      };
    } catch { return null; }
  }, []);

  const clearCacheForHash = useCallback(async (hash: string) => {
    try { localStorage.removeItem(`${LOCAL_CACHE_KEY}_${hash}`); } catch {}
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("text_analysis_cache" as any).delete().eq("user_id", user.id).eq("text_hash", hash);
      }
    } catch (err) { console.error("Failed to clear cloud cache:", err); }
  }, []);

  /* Auto-clear when text changes */
  useEffect(() => {
    if (!text.trim()) return;
    const currentHash = hashText(text);
    if (lastTextHashRef.current && lastTextHashRef.current !== currentHash && isActive) {
      clearCacheForHash(lastTextHashRef.current);
      setWordResults([]); setDuplicates([]); setIsActive(false);
      setProgress(0); setCacheSource("none");
      morphResultsRef.current = [];
      completedBatchesRef.current.clear();
      completedCountRef.current = 0;
    }
    lastTextHashRef.current = currentHash;
  }, [text, isActive, clearCacheForHash]);

  /* ── Main analysis ── */
  const runAnalysis = useCallback(async (resume = false, forceRefresh = false) => {
    if (!text.trim()) return;
    cancelRef.current = false;
    pauseRef.current = false;
    setIsPaused(false);
    setIsAnalyzing(true);
    setCacheSource("none");

    const textHash = hashText(text);

    if (!resume && !forceRefresh) {
      const localCached = getLocalCache(textHash);
      if (localCached) {
        setWordResults(localCached.wordResults); setDuplicates(localCached.duplicates);
        morphResultsRef.current = localCached.wordResults;
        setIsActive(true); setIsAnalyzing(false); setProgress(100); setCacheSource("local");
        toast({ title: "⚡ נטען מקאש מקומי", description: `${localCached.wordResults.filter((r) => r.issueType !== "none").length} ממצאים` });
        return;
      }
      setStage("בודק קאש בענן..."); setProgress(5);
      const cloudCached = await loadFromCloud(textHash);
      if (cloudCached) {
        setWordResults(cloudCached.wordResults); setDuplicates(cloudCached.duplicates);
        morphResultsRef.current = cloudCached.wordResults;
        setIsActive(true); setIsAnalyzing(false); setProgress(100); setCacheSource("cloud");
        setLocalCache(textHash, cloudCached);
        toast({ title: "☁️ נטען מהענן", description: `${cloudCached.wordResults.filter((r) => r.issueType !== "none").length} ממצאים` });
        return;
      }
    }

    try {
      let results: WordValidation[];

      if (resume && morphResultsRef.current.length > 0) {
        results = [...morphResultsRef.current];
        setStage("ממשיך מאיפה שעצרנו...");
      } else {
        completedBatchesRef.current = new Set();
        completedCountRef.current = 0;
        setProgress(0); setWordResults([]); setDuplicates([]);

        setStage("זיהוי כפילויות...");
        const dupes = detectDuplicates();
        setDuplicates(dupes); setProgress(5);

        setStage("ניתוח מורפולוגי...");
        const onlyWords = actualWords.map((w) => w.word);
        const morphResult = await analyzeMorphology(onlyWords.join(" "));
        setProgress(25);
        if (cancelRef.current) return;

        results = actualWords.map((w, idx) => {
          const isHebrew = /[\u0590-\u05FF]/.test(w.word);
          const isPunctuation = /^[.,;:!?'"()\-–—]+$/.test(w.word);
          const isNumber = /^\d+$/.test(w.word);
          if (!isHebrew || isPunctuation || isNumber) {
            return { word: w.word, index: w.index, exists: true, grammarOk: true, contextOk: true, issueType: "none" as const };
          }
          const morph = morphResult.success && morphResult.words[idx];
          const hasLemma = morph && morph.lemma && morph.lemma !== "";
          return {
            word: w.word, index: w.index, exists: !!hasLemma,
            lemma: morph ? morph.lemma : undefined, pos: morph ? morph.pos : undefined,
            grammarOk: true, contextOk: true,
            issueType: (hasLemma ? "none" : "unknown_word") as WordValidation["issueType"],
          };
        });

        morphResultsRef.current = results;
        setWordResults([...results]);
        setIsActive(true);
      }

      if (cancelRef.current) return;

      if (settings.showGrammar || settings.showContext) {
        setStage("בדיקת דקדוק והקשר...");
        const hebrewResults = results.filter((r) => /[\u0590-\u05FF]/.test(r.word) && r.word.length > 1);
        const batches: (typeof hebrewResults)[] = [];
        for (let i = 0; i < hebrewResults.length; i += BATCH_SIZE) batches.push(hebrewResults.slice(i, i + BATCH_SIZE));
        totalBatchesRef.current = batches.length;

        const pendingBatchIndices = batches.map((_, i) => i).filter((i) => !completedBatchesRef.current.has(i));

        if (pendingBatchIndices.length === 0) {
          setProgress(100); setStage(""); setIsAnalyzing(false);
          const dupes = detectDuplicates();
          const cacheData: CachedAnalysis = { wordResults: results, duplicates: dupes, timestamp: Date.now() };
          setLocalCache(textHash, cacheData);
          saveToCloud(textHash, results, dupes);
          return;
        }

        for (let chunk = 0; chunk < pendingBatchIndices.length; chunk += PARALLEL_LIMIT) {
          if (cancelRef.current) break;
          while (pauseRef.current && !cancelRef.current) await new Promise((r) => setTimeout(r, 200));
          if (cancelRef.current) break;

          const chunkIndices = pendingBatchIndices.slice(chunk, chunk + PARALLEL_LIMIT);
          setStage(`בדיקת דקדוק והקשר (${completedCountRef.current}/${totalBatchesRef.current})...`);

          const promises = chunkIndices.map(async (bIdx) => {
            try {
              const batch = batches[bIdx];
              const aiResults = await processAIBatch(batch, actualWords);
              for (const aiResult of aiResults) {
                const rIdx = results.findIndex((r) => r.index === (aiResult as any).index);
                if (rIdx !== -1) {
                  results[rIdx] = {
                    ...results[rIdx],
                    exists: (aiResult as any).exists,
                    grammarOk: (aiResult as any).grammarOk,
                    contextOk: (aiResult as any).contextOk,
                    suggestion: (aiResult as any).suggestion || undefined,
                    reason: (aiResult as any).reason || undefined,
                    issueType: (aiResult as any).issueType || results[rIdx].issueType,
                  };
                }
              }
              completedBatchesRef.current.add(bIdx);
              completedCountRef.current++;
            } catch (err) {
              console.error(`AI batch ${bIdx} error:`, err);
              completedBatchesRef.current.add(bIdx);
              completedCountRef.current++;
            }
          });

          await Promise.all(promises);
          morphResultsRef.current = [...results];
          setWordResults([...results]);
          const pct = 25 + Math.round((completedCountRef.current / totalBatchesRef.current) * 70);
          setProgress(Math.min(pct, 95));
        }
      }

      if (!cancelRef.current) {
        setWordResults([...results]);
        morphResultsRef.current = results;
        setProgress(100); setStage(""); setIsActive(true);
        const dupes = detectDuplicates();
        const cacheData: CachedAnalysis = { wordResults: results, duplicates: dupes, timestamp: Date.now() };
        setLocalCache(textHash, cacheData);
        saveToCloud(textHash, results, dupes);
        toast({ title: "✅ הבדיקה הושלמה ונשמרה", description: "התוצאות נשמרו בענן ובמקומי" });
      }
    } catch (err) {
      console.error("Analysis error:", err);
      toast({ title: "שגיאה", description: "הניתוח נכשל — ניתן להמשיך מאיפה שעצר", variant: "destructive" });
    } finally {
      setIsAnalyzing(false); setIsPaused(false);
    }
  }, [text, actualWords, settings, detectDuplicates, processAIBatch, loadFromCloud, saveToCloud]);

  const handlePause = useCallback(() => { pauseRef.current = true; setIsPaused(true); }, []);

  const handleResume = useCallback(() => {
    if (isPaused) { pauseRef.current = false; setIsPaused(false); }
    else runAnalysis(true);
  }, [isPaused, runAnalysis]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true; setIsAnalyzing(false); setIsPaused(false); setStage("");
    if (wordResults.length > 0) {
      setIsActive(true);
      toast({ title: "הופסק", description: `נשמרו ${wordResults.filter((r) => r.issueType !== "none").length} ממצאים — ניתן להמשיך` });
    }
  }, [wordResults]);

  const clearResults = useCallback(() => {
    setIsActive(false); setWordResults([]); setDuplicates([]);
    setSelectedFixes(new Set()); setShowFixPanel(false);
    morphResultsRef.current = [];
    completedBatchesRef.current = new Set();
    completedCountRef.current = 0;
    totalBatchesRef.current = 0;
  }, []);

  /* ── Derived state ── */

  const resultMap = useMemo(() => {
    const map = new Map<number, WordValidation>();
    wordResults.forEach((r) => map.set(r.index, r));
    return map;
  }, [wordResults]);

  const duplicateIndices = useMemo(() => {
    const set = new Set<number>();
    duplicates.forEach((d) => d.indices.forEach((i) => set.add(i)));
    return set;
  }, [duplicates]);

  const localSpellSettings = useMemo<SyncedSpellAssistSettings>(
    () => ({
      enabled: settings.localSpellCheck,
      grammarEnabled: true,
      duplicateWordsRule: true,
      punctuationRule: true,
      latinWordsRule: true,
      useDictionary: true,
      markMode: "underline",
      markColor: "#f59e0b",
      keepMarkedAfterFix: false,
    }),
    [settings.localSpellCheck],
  );

  const localIssueMap = useMemo(() => {
    if (!settings.localSpellCheck || !words.length) return new Map<number, MenuSuggestion[]>();
    return buildIssueMap(words, localSpellSettings, new Set());
  }, [words, settings.localSpellCheck, localSpellSettings]);

  const localIssueCount = localIssueMap.size;

  const issueStats = useMemo(() => {
    const unknown = wordResults.filter((r) => r.issueType === "unknown_word" || r.issueType === "spelling").length;
    const grammar = wordResults.filter((r) => r.issueType === "grammar").length;
    const context = wordResults.filter((r) => r.issueType === "context").length;
    return { unknown, grammar, context, duplicates: duplicates.length };
  }, [wordResults, duplicates]);

  const canResume = !isAnalyzing && morphResultsRef.current.length > 0 && completedBatchesRef.current.size < totalBatchesRef.current && totalBatchesRef.current > 0;

  const fixableResults = useMemo(() => wordResults.filter((r) => r.issueType !== "none" && r.suggestion), [wordResults]);

  /* ── Word styling (returns Tailwind class string) ── */
  const getWordMarkingStyle = useCallback(
    (wordIndex: number): string => {
      const styles: string[] = [];
      if (settings.localSpellCheck && localIssueMap.has(wordIndex))
        styles.push("decoration-amber-400 decoration-wavy underline decoration-2");

      if (!isActive) return styles.join(" ");
      const result = resultMap.get(wordIndex);
      const isDuplicate = settings.showDuplicates && duplicateIndices.has(wordIndex);
      if (isDuplicate) styles.push("decoration-blue-400 decoration-wavy underline decoration-2");
      if (result) {
        if (settings.showUnknown && (result.issueType === "unknown_word" || result.issueType === "spelling"))
          styles.push("decoration-red-500 decoration-wavy underline decoration-2");
        else if (settings.showGrammar && result.issueType === "grammar")
          styles.push("decoration-orange-400 decoration-wavy underline decoration-2");
        else if (settings.showContext && result.issueType === "context")
          styles.push("decoration-yellow-400 decoration-wavy underline decoration-2");
      }
      return styles.join(" ");
    },
    [isActive, resultMap, duplicateIndices, settings, localIssueMap],
  );

  /* ── Fix helpers ── */
  const handleApplyFix = useCallback(
    (wordIndex: number, suggestion: string) => {
      if (onWordReplace) {
        onWordReplace(wordIndex, suggestion);
        toast({ title: "תוקן" });
        setIsActive(false);
      }
    },
    [onWordReplace],
  );

  const handleRemoveDuplicate = useCallback(
    (group: DuplicateGroup) => {
      // Remove duplicate words by replacing with empty, let parent handle
      for (const idx of group.indices.slice(1)) {
        onWordReplace?.(idx, "");
      }
      setSelectedDuplicate(null);
      setIsActive(false);
    },
    [onWordReplace],
  );

  const handleRemoveAllDuplicates = useCallback(() => {
    if (duplicates.length === 0) return;
    for (const d of duplicates) {
      for (const idx of d.indices.slice(1)) {
        onWordReplace?.(idx, "");
      }
    }
    setIsActive(false);
  }, [duplicates, onWordReplace]);

  const handleFixAll = useCallback(() => {
    if (fixableResults.length === 0) return;
    let count = 0;
    for (const r of fixableResults) {
      if (r.suggestion) {
        onWordReplace?.(r.index, r.suggestion);
        count++;
      }
    }
    toast({ title: "תוקן הכל", description: `${count} מילים תוקנו` });
    setIsActive(false); setWordResults([]); setSelectedFixes(new Set()); setShowFixPanel(false);
  }, [fixableResults, onWordReplace]);

  const handleFixSelected = useCallback(() => {
    if (selectedFixes.size === 0) return;
    let count = 0;
    for (const idx of selectedFixes) {
      const r = wordResults.find((wr) => wr.index === idx);
      if (r?.suggestion) { onWordReplace?.(idx, r.suggestion); count++; }
    }
    toast({ title: "תוקנו נבחרים", description: `${count} מילים תוקנו` });
    setIsActive(false); setWordResults([]); setSelectedFixes(new Set()); setShowFixPanel(false);
  }, [selectedFixes, wordResults, onWordReplace]);

  const toggleFixSelection = useCallback((index: number) => {
    setSelectedFixes((prev) => { const next = new Set(prev); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedFixes.size === fixableResults.length) setSelectedFixes(new Set());
    else setSelectedFixes(new Set(fixableResults.map((r) => r.index)));
  }, [fixableResults, selectedFixes]);

  return {
    // Settings
    settings, setSettings,
    // Analysis state
    isActive, isAnalyzing, isPaused, progress, stage, cacheSource, canResume,
    // Results
    wordResults, duplicates, resultMap, duplicateIndices,
    localIssueMap, localIssueCount, issueStats, fixableResults,
    // Actions
    runAnalysis, handlePause, handleResume, handleCancel, clearResults,
    handleApplyFix, handleRemoveDuplicate, handleRemoveAllDuplicates,
    handleFixAll, handleFixSelected,
    // Fix selection
    selectedFixes, showFixPanel, setShowFixPanel,
    toggleFixSelection, toggleSelectAll,
    // Duplicate dialog
    selectedDuplicate, setSelectedDuplicate,
    // Styling
    getWordMarkingStyle,
  };
}
