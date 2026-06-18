import { useState, useMemo, memo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wand2, Loader2, Sparkles, MessageSquare, BookOpen, FileText,
  Languages, Users, List, Heading, Maximize2, Minimize2, ChevronUp, ChevronDown,
  CheckCheck, Volume2, AlignJustify, Quote, Cpu, Save, Gauge, Trophy,
  Eye, EyeOff, GitCompareArrows, Download, PlayCircle, StopCircle, RotateCcw, Trash2,
  Pencil, Plus, LayoutGrid, LayoutList, Rows3, RotateCw, ShieldCheck, Star, Settings, GripVertical, Filter, ArrowUpDown, Plug,
  type LucideIcon
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { editTranscriptCloud } from "@/utils/editTranscriptApi";
import { ACTION_PROMPTS, TONE_PROMPTS } from "@/lib/prompts";
import {
  parseProviderModel,
  encodeProviderModel,
  chatWithProvider,
  getProviders,
  subscribeProviders,
  loadProviderKey,
  type CustomProvider,
} from "@/lib/customProviders";
import { CustomProvidersDialog } from "@/components/CustomProvidersDialog";
import { buildHebrewGuardPrefix } from "@/lib/hebrewGuard";
import { useOllama, isOllamaModel, getOllamaModelName, getOllamaUrl } from "@/hooks/useOllama";
import { useAIEditQueue } from "@/hooks/useAIEditQueue";
import { getGpuShareMode, setGpuShareMode, subscribeGpuShareMode, type GpuShareMode } from "@/lib/gpuShareMode";
import {
  isHebrewOnlyEnabled, setHebrewOnlyEnabled,
  getAllowedLangs, setAllowedLangs, subscribeHebrewGuard,
  ALL_ALLOWED_LANGS, containsForeignScript, getAllowedLangLabel,
  type AllowedLang,
} from "@/lib/hebrewGuard";
import { useCustomActions, type CustomAction } from "@/hooks/useCustomActions";
import type { AIEditJob } from "@/lib/aiEditQueue";
import type { TextVersion } from "@/components/TextEditHistory";
import DiffMatchPatch from "diff-match-patch";

interface AIEditorDualProps {
  text: string;
  onTextChange: (text: string, source: string, customPrompt?: string) => void;
  onSaveVersion?: (text: string, source: string, engineLabel: string, actionLabel: string) => void;
  onSaveAndReplaceOriginal?: (text: string, source: string, engineLabel: string, actionLabel: string) => Promise<void> | void;
  onDuplicateAndSave?: (text: string, source: string, engineLabel: string, actionLabel: string) => Promise<void> | void;
  onSyncToPlayer?: (editedText: string) => void;
  /** Optional: all available versions for the source-picker (cloud + local + AI) */
  versions?: TextVersion[];
  /** Optional: original transcript text (shown as "מקורי" tab) */
  originalText?: string;
  /** Optional: pre-selected source version id (e.g. when sent from compare view) */
  initialSourceId?: string;
}

const CLOUD_MODELS = [
  // Google Gemini
  { value: 'gemini-flash', label: 'Gemini 2.5 Flash', apiModel: 'google/gemini-2.5-flash', local: false },
  { value: 'gemini-pro', label: 'Gemini 2.5 Pro', apiModel: 'google/gemini-2.5-pro', local: false },
  { value: 'gemini-flash-lite', label: 'Gemini Flash Lite', apiModel: 'google/gemini-2.5-flash-lite', local: false },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash', apiModel: 'google/gemini-3-flash-preview', local: false },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', apiModel: 'google/gemini-3.1-pro-preview', local: false },
  // OpenAI
  { value: 'gpt-5', label: 'GPT-5', apiModel: 'openai/gpt-5', local: false },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini', apiModel: 'openai/gpt-5-mini', local: false },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano', apiModel: 'openai/gpt-5-nano', local: false },
  { value: 'gpt-5.2', label: 'GPT-5.2', apiModel: 'openai/gpt-5.2', local: false },
  { value: 'gpt-4o', label: 'GPT-4o', apiModel: 'openai/gpt-4o', local: false },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', apiModel: 'openai/gpt-4o-mini', local: false },
  // Anthropic
  { value: 'claude-sonnet', label: 'Claude 3.5 Sonnet', apiModel: 'anthropic/claude-3.5-sonnet', local: false },
  { value: 'claude-haiku', label: 'Claude 3 Haiku', apiModel: 'anthropic/claude-3-haiku', local: false },
  // Cohere
  { value: 'command-r', label: 'Command R', apiModel: 'cohere/command-r', local: false },
  { value: 'aya-expanse-8b', label: 'Aya Expanse 8B', apiModel: 'cohere/aya-expanse-8b', local: false },
  // Meta & Mistral
  { value: 'llama-70b', label: 'Llama 3.1 70B', apiModel: 'meta-llama/llama-3.1-70b-instruct', local: false },
  { value: 'mistral-large', label: 'Mistral Large', apiModel: 'mistralai/mistral-large-latest', local: false },
  // Qwen
  { value: 'qwen2.5-14b', label: 'Qwen 2.5 14B', apiModel: 'qwen/qwen-2.5-14b-instruct', local: false },
  { value: 'qwen2.5-32b', label: 'Qwen 2.5 32B', apiModel: 'qwen/qwen-2.5-32b-instruct', local: false },
  // Hebrew-optimized additions
  { value: 'aya-expanse-32b', label: 'Aya Expanse 32B', apiModel: 'cohere/aya-expanse-32b', local: false },
  { value: 'command-r-plus', label: 'Command R+', apiModel: 'cohere/command-r-plus', local: false },
  { value: 'gemma2-27b', label: 'Gemma 2 27B', apiModel: 'google/gemma-2-27b-it', local: false },
  { value: 'mistral-nemo', label: 'Mistral Nemo 12B', apiModel: 'mistralai/mistral-nemo', local: false },
  { value: 'claude-4-haiku', label: 'Claude 4 Haiku', apiModel: 'anthropic/claude-4-haiku', local: false },
  { value: 'deepseek-v3', label: 'DeepSeek V3', apiModel: 'deepseek/deepseek-chat', local: false },
  { value: 'qwen2.5-72b', label: 'Qwen 2.5 72B', apiModel: 'qwen/qwen-2.5-72b-instruct', local: false },
];

const RECOMMENDED_OLLAMA_MODELS = [
  // 🥇 DICTA — top-tier Hebrew-specialized model (Dec 2025 release)
  'hf.co/dicta-il/DictaLM-3.0-Nemotron-12B-Instruct-GGUF:Q4_K_M',
  // Hebrew-tuned community models
  'aya:8b-hebrew',
  'qwen2.5:7b-hebrew',
  'qwen2.5:14b-hebrew',
  'mistral:7b-hebrew',
  'gemma2:9b-hebrew',
  'llama3.1:8b-hebrew',
  'hf.co/mradermacher/Zion_Alpha_Instruction_Tuned-GGUF:Q6_K',
];

// --- Smart auto-select: best model per action category ---
const DEFAULT_MODEL_KEY = 'ai_editor_default_model';

// Action → best model mapping (cloud + local considerations)
// Categories: quality-heavy tasks get bigger models, speed tasks get lighter ones
// NOTE: defaults use qwen2.5:7b-hebrew (4.7GB) — fits fully in 8GB VRAM (RTX 5050/3050/4050).
//       14b (9GB) spills to CPU on 8GB GPUs and becomes 5-10x slower. Pick 14b manually if you have ≥12GB VRAM.
const AUTO_MODEL_MAP: Record<string, { cloud: string; local: string }> = {
  // Quality-critical: grammar, improve, readable
  improve:     { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  grammar:     { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  readable:    { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  punctuation: { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  // Structural: paragraphs, headings, bullets
  paragraphs:  { cloud: 'gpt-4o', local: 'qwen2.5:7b-hebrew' },
  headings:    { cloud: 'gpt-4o', local: 'qwen2.5:7b-hebrew' },
  bullets:     { cloud: 'gpt-4o', local: 'qwen2.5:7b-hebrew' },
  // Length transforms
  expand:      { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  shorten:     { cloud: 'gpt-4o-mini', local: 'qwen2.5:7b-hebrew' },
  summarize:   { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  // Specialized
  sources:     { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  translate:   { cloud: 'gemini-flash', local: 'aya:8b-hebrew' },
  speakers:    { cloud: 'gpt-4o', local: 'qwen2.5:7b-hebrew' },
  tone:        { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
  custom:      { cloud: 'gemini-flash', local: 'qwen2.5:7b-hebrew' },
};

const inferModelHoverText = (modelName: string): string => {
  const lower = modelName.toLowerCase();
  let specialty = 'שימוש כללי';
  let hebrewTraining = 'לא ידוע';

  if (lower.includes('zion_alpha')) {
    specialty = 'עברית, הוראות, שכתוב וניסוח';
    hebrewTraining = 'כן, מותאם ומאומן לעברית';
  } else if (lower.includes('aya')) {
    specialty = 'תרגום, רב-לשוניות ושפה טבעית';
    hebrewTraining = lower.includes('hebrew') || lower.includes('expanse') ? 'כן, חזק במיוחד בעברית' : 'לא ייעודי, אבל חזק בעברית';
  } else if (lower.includes('qwen')) {
    specialty = 'כתיבה, סיכום, עריכה והוראות מורכבות';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי, אבל תומך היטב בעברית';
  } else if (lower.includes('mistral')) {
    specialty = 'מהירות, ניסוח ועריכה';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('gemma')) {
    specialty = 'טקסט כללי, עזרה וניתוח';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('llama')) {
    specialty = 'שימוש כללי וצ׳אט';
    hebrewTraining = lower.includes('hebrew') ? 'כן, גרסת Hebrew ייעודית' : 'לא ייעודי לעברית';
  } else if (lower.includes('command-r')) {
    specialty = 'RAG, עבודה עם מקורות ומסמכים';
    hebrewTraining = 'לא ייעודי לעברית';
  } else if (lower.includes('claude') || lower.includes('gpt') || lower.includes('gemini')) {
    specialty = 'מודל ענן כללי חזק לכתיבה וחשיבה';
    hebrewTraining = 'לא ייעודי לעברית';
  }

  return `התמחות: ${specialty}\nעברית: ${hebrewTraining}`;
};

function getSavedDefaultModel(): string | null {
  return localStorage.getItem(DEFAULT_MODEL_KEY);
}
function saveDefaultModel(value: string | null) {
  if (value) localStorage.setItem(DEFAULT_MODEL_KEY, value);
  else localStorage.removeItem(DEFAULT_MODEL_KEY);
}

const FAVORITE_MODELS_KEY = 'ai_editor_favorite_models_v1';
function getFavoriteModels(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v: unknown): v is string => typeof v === 'string') : [];
  } catch { return []; }
}
function saveFavoriteModels(values: string[]): void {
  try {
    localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(values));
    window.dispatchEvent(new CustomEvent('ai-favorite-models-changed'));
  } catch { /* noop */ }
}

const HIDDEN_MODELS_KEY = 'ai_editor_hidden_models_v1';
const MODEL_ORDER_KEY = 'ai_editor_model_order_v1';
function getHiddenModels(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v: unknown): v is string => typeof v === 'string') : [];
  } catch { return []; }
}
function saveHiddenModels(values: string[]): void {
  try {
    localStorage.setItem(HIDDEN_MODELS_KEY, JSON.stringify(values));
    window.dispatchEvent(new CustomEvent('ai-model-visibility-changed'));
  } catch { /* noop */ }
}
function getModelOrder(): string[] {
  try {
    const raw = localStorage.getItem(MODEL_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v: unknown): v is string => typeof v === 'string') : [];
  } catch { return []; }
}
function saveModelOrder(values: string[]): void {
  try {
    localStorage.setItem(MODEL_ORDER_KEY, JSON.stringify(values));
    window.dispatchEvent(new CustomEvent('ai-model-visibility-changed'));
  } catch { /* noop */ }
}

// --- Model classification heuristics (for filter & sort in Settings panel) ---
type ModelCategory = 'cloud' | 'local';
type ModelDomain = 'general' | 'hebrew' | 'code' | 'reasoning' | 'multilingual';

/** Estimate model size in billions of parameters from name. Returns 0 when unknown (cloud, etc.) */
function estimateModelSizeB(label: string): number {
  const m = label.match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
  if (m) return parseFloat(m[1]);
  // Common heuristics for cloud models without explicit size
  const l = label.toLowerCase();
  if (l.includes('nano')) return 1;
  if (l.includes('mini') || l.includes('haiku') || l.includes('lite') || l.includes('flash')) return 8;
  if (l.includes('sonnet') || l.includes('command-r') && !l.includes('plus')) return 35;
  if (l.includes('pro') || l.includes('large') || l.includes('plus')) return 100;
  if (l.includes('gpt-5') || l.includes('gpt-4o')) return 200;
  return 0;
}

/** Detect Hebrew-specialized models (by tag/name). */
function isHebrewModel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('hebrew') || l.includes('zion') || l.includes('aya') || l.includes('dolphin3-hebrew') || l.includes('dictalm') || l.includes('dicta-il');
}

/** Detect DICTA-built models — the gold standard for Hebrew (per HuggingFace dicta-il org). */
function isDictaModel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('dictalm') || l.includes('dicta-il') || l.includes('dictabert');
}

/** Detect rough training-domain category. */
function getModelDomain(label: string): ModelDomain {
  const l = label.toLowerCase();
  if (isHebrewModel(label)) return 'hebrew';
  if (l.includes('code') || l.includes('coder') || l.includes('deepseek')) return 'code';
  if (l.includes('reason') || l.includes('o1') || l.includes('o3') || l.includes('claude') || l.includes('gpt-5')) return 'reasoning';
  if (l.includes('aya') || l.includes('command-r') || l.includes('qwen') || l.includes('mistral') || l.includes('gemma')) return 'multilingual';
  return 'general';
}

function getDomainLabel(d: ModelDomain): string {
  switch (d) {
    case 'hebrew': return '🇮🇱 עברית';
    case 'code': return '💻 קוד';
    case 'reasoning': return '🧠 הסקה';
    case 'multilingual': return '🌐 רב-לשוני';
    default: return '📦 כללי';
  }
}

type CompareMetrics = {
  latencyMs: number;
  hebrewRatio: number;
  punctuationDensity: number;
  preserveScore: number;
  lengthDrift: number;
  qualityScore: number;
};

type BenchmarkSummary = {
  action: EditAction;
  rounds: number;
  createdAt: string;
  model1Value?: string;
  model2Value?: string;
  model1Label: string;
  model2Label: string;
  model1: {
    avgLatency: number;
    stdLatency: number;
    avgQuality: number;
    stdQuality: number;
    bestQuality: number;
    bestText: string;
  };
  model2: {
    avgLatency: number;
    stdLatency: number;
    avgQuality: number;
    stdQuality: number;
    bestQuality: number;
    bestText: string;
  };
  winner: 1 | 2;
};

const BENCHMARK_HISTORY_KEY = 'ai_benchmark_history_v1';

const ACTION_LABELS: Record<EditAction, string> = {
  improve: 'שפר ניסוח',
  grammar: 'דקדוק ואיות',
  readable: 'זורם לקריאה',
  punctuation: 'פיסוק',
  paragraphs: 'חלוקה לפסקאות',
  bullets: 'נקודות מפתח',
  headings: 'כותרות',
  expand: 'הרחבה',
  shorten: 'קיצור',
  summarize: 'סיכום',
  sources: 'הוספת מקורות',
  translate: 'תרגום',
  speakers: 'זיהוי דוברים',
  tone: 'שינוי טון',
  custom: 'פרומפט מותאם',
};

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = avg(arr);
  const variance = avg(arr.map(v => (v - m) ** 2));
  return Math.sqrt(variance);
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function mapPullStatusLabel(status?: string): string {
  switch (status) {
    case 'starting': return 'מתחיל';
    case 'pulling': return 'מוריד';
    case 'retrying': return 'ממשיך אחרי תקיעה';
    case 'completed': return 'הורדה הושלמה';
    case 'cancelled': return 'נעצר';
    case 'error': return 'שגיאה';
    case 'idle': return 'מוכן להורדה';
    default: return status || 'מוכן';
  }
}

function scoreText(source: string, output: string, latencyMs: number): CompareMetrics {
  const src = source.trim();
  const out = output.trim();
  const srcWords = src.split(/\s+/).filter(Boolean);
  const outWords = out.split(/\s+/).filter(Boolean);

  const srcSet = new Set(srcWords.map(w => w.replace(/[^\u0590-\u05FFA-Za-z0-9]/g, '').toLowerCase()).filter(Boolean));
  const outSet = new Set(outWords.map(w => w.replace(/[^\u0590-\u05FFA-Za-z0-9]/g, '').toLowerCase()).filter(Boolean));
  let overlap = 0;
  srcSet.forEach(w => { if (outSet.has(w)) overlap++; });
  const preserveScore = srcSet.size > 0 ? overlap / srcSet.size : 0;

  const hebChars = (out.match(/[\u0590-\u05FF]/g) || []).length;
  const alphaChars = (out.match(/[A-Za-z\u0590-\u05FF]/g) || []).length;
  const hebrewRatio = alphaChars > 0 ? hebChars / alphaChars : 0;

  const punct = (out.match(/[.,!?;:\-—…״"'']/g) || []).length;
  const punctuationDensity = outWords.length > 0 ? punct / outWords.length : 0;

  const srcLen = Math.max(1, src.length);
  const lengthDrift = Math.min(1, Math.abs(out.length - src.length) / srcLen);

  const speedScore = Math.max(0, 1 - (latencyMs / 12000));
  const qualityScore = (
    preserveScore * 0.4 +
    Math.min(1, hebrewRatio) * 0.2 +
    Math.min(1, punctuationDensity * 8) * 0.15 +
    (1 - lengthDrift) * 0.15 +
    speedScore * 0.1
  ) * 100;

  return { latencyMs, hebrewRatio, punctuationDensity, preserveScore, lengthDrift, qualityScore };
}

// ── Icon name → component mapping ──────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  Wand2, CheckCheck, Quote, BookOpen, AlignJustify, Heading, List,
  Maximize2, Minimize2, FileText, Users, Languages, Volume2,
  MessageSquare, Sparkles, Pencil, Plus, Eye, Cpu, Save, Gauge,
};

function getIconComponent(name: string): LucideIcon {
  return ICON_MAP[name] || Wand2;
}

export const ICON_OPTIONS = Object.keys(ICON_MAP);

type EditAction = 'improve' | 'grammar' | 'readable' | 'punctuation' | 'paragraphs' |
  'bullets' | 'headings' | 'expand' | 'shorten' | 'summarize' |
  'sources' | 'translate' | 'speakers' | 'tone' | 'custom';

const TONE_OPTIONS = [
  { value: 'formal', label: 'רשמי' },
  { value: 'personal', label: 'אישי' },
  { value: 'academic', label: 'אקדמי' },
  { value: 'business', label: 'עסקי' },
];

const TRANSLATE_LANGS = [
  { value: 'אנגלית', label: '🇺🇸 עברית ← אנגלית' },
  { value: 'עברית', label: '🇮🇱 אנגלית ← עברית' },
  { value: 'ערבית', label: '🇸🇦 ערבית' },
  { value: 'רוסית', label: '🇷🇺 רוסית' },
  { value: 'צרפתית', label: '🇫🇷 צרפתית' },
  { value: 'ספרדית', label: '🇪🇸 ספרדית' },
  { value: 'גרמנית', label: '🇩🇪 גרמנית' },
];

const AIEditorDualInner = ({ text: propText, onTextChange, onSaveVersion, onSaveAndReplaceOriginal, onDuplicateAndSave, onSyncToPlayer, versions, originalText, initialSourceId }: AIEditorDualProps) => {
  // Local editable working copy of the source text. User can tweak words inline before/between AI runs;
  // changes flow automatically into the next AI run because all edit code uses `text`.
  const [text, setWorkingText] = useState(propText);
  const [isUserEditedText, setIsUserEditedText] = useState(false);
  // Snapshot of last loaded source (for isDirty detection in the source-picker)
  const [loadedSnapshot, setLoadedSnapshot] = useState<string>(propText);
  // Sync from prop when it changes externally — but only if the user hasn't manually edited yet.
  useEffect(() => {
    if (!isUserEditedText) {
      setWorkingText(propText);
      setLoadedSnapshot(propText);
    }
  }, [propText, isUserEditedText]);

  // ── Source-picker state ──
  type SourceCategory = 'all' | 'current' | 'original' | 'ai' | 'saved';
  const [sourceCategory, setSourceCategory] = useState<SourceCategory>('all');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(initialSourceId || '__current__');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [dirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const isDirty = text !== loadedSnapshot;

  const versionsList = versions || [];

  // Build the synthetic "current" / "original" entries so they appear alongside saved versions
  const allSourceVersions = useMemo<TextVersion[]>(() => {
    const list: TextVersion[] = [];
    list.push({
      id: '__current__',
      text: propText,
      timestamp: new Date(),
      source: 'manual',
      customPrompt: 'הטקסט הנוכחי בעורך',
    });
    if (originalText && originalText.trim() && originalText !== propText) {
      list.push({
        id: '__original__',
        text: originalText,
        timestamp: new Date(0),
        source: 'original',
        customPrompt: 'תמלול מקורי',
      });
    }
    for (const v of versionsList) {
      // Skip duplicates of current/original already pushed
      if (v.text === propText && list.some(x => x.id === '__current__')) continue;
      list.push(v);
    }
    return list;
  }, [propText, originalText, versionsList]);

  const filteredByCategory = useMemo(() => {
    switch (sourceCategory) {
      case 'current':
        return allSourceVersions.filter(v => v.id === '__current__');
      case 'original':
        return allSourceVersions.filter(v => v.source === 'original');
      case 'ai':
        return allSourceVersions.filter(v => v.source.startsWith('ai-'));
      case 'saved':
        return allSourceVersions.filter(v => v.source === 'manual' && v.id !== '__current__');
      default:
        return allSourceVersions;
    }
  }, [allSourceVersions, sourceCategory]);

  // Auto-categorize when initialSourceId arrives from parent (e.g. "send to AI" from compare)
  useEffect(() => {
    if (!initialSourceId) return;
    const v = allSourceVersions.find(x => x.id === initialSourceId);
    if (!v) return;
    // Keep "all" by default; only narrow if user is already in a specific category
    setSelectedSourceId(initialSourceId);
    // load text (without dirty-check — explicit user action from compare)
    setWorkingText(v.text);
    setLoadedSnapshot(v.text);
    setIsUserEditedText(false);
  }, [initialSourceId, allSourceVersions]);

  const applySourceLoad = (id: string) => {
    const v = allSourceVersions.find(x => x.id === id);
    if (!v) return;
    setSelectedSourceId(id);
    setWorkingText(v.text);
    setLoadedSnapshot(v.text);
    setIsUserEditedText(false);
  };

  const requestSourceChange = (id: string) => {
    if (id === selectedSourceId) return;
    if (isDirty) {
      setPendingSourceId(id);
      setDirtyDialogOpen(true);
      return;
    }
    applySourceLoad(id);
  };

  const handleDirtyDiscard = () => {
    setDirtyDialogOpen(false);
    if (pendingSourceId) applySourceLoad(pendingSourceId);
    setPendingSourceId(null);
  };
  const handleDirtySaveThenLoad = () => {
    if (onSaveVersion) {
      onSaveVersion(text, 'manual', 'עורך', 'עריכה ידנית');
      toast({ title: 'נשמרה גרסה חדשה' });
    }
    setDirtyDialogOpen(false);
    if (pendingSourceId) applySourceLoad(pendingSourceId);
    setPendingSourceId(null);
  };
  const handleDirtyCancel = () => {
    setDirtyDialogOpen(false);
    setPendingSourceId(null);
  };

  const currentSourceVersion = allSourceVersions.find(v => v.id === selectedSourceId);
  const formatSourceLabel = (v: TextVersion): string => {
    if (v.id === '__current__') return 'הטקסט הנוכחי בעורך';
    if (v.id === '__original__') return 'תמלול מקורי';
    const time = v.timestamp instanceof Date && v.timestamp.getTime() > 0
      ? new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(v.timestamp)
      : '';
    const tag = v.customPrompt || v.source;
    const preview = v.text.replace(/\s+/g, ' ').slice(0, 50);
    return `${tag}${time ? ' · ' + time : ''} — ${preview}${v.text.length > 50 ? '…' : ''}`;
  };

  const [showSourceEditor, setShowSourceEditor] = useState<boolean>(() => {
    try { return localStorage.getItem('ai_editor_show_source') !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('ai_editor_show_source', String(showSourceEditor)); } catch { /* noop */ }
  }, [showSourceEditor]);

  const [isEditing1, setIsEditing1] = useState(false);
  const [isEditing2, setIsEditing2] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [model1, setModel1] = useState(() => getSavedDefaultModel() || 'gemini-flash');
  const [model2, setModel2] = useState('gpt-4o');
  const [result1, setResult1] = useState("");
  const [result2, setResult2] = useState("");
  const [mergedResult, setMergedResult] = useState("");
  const [latency1Ms, setLatency1Ms] = useState<number>(0);
  const [latency2Ms, setLatency2Ms] = useState<number>(0);
  const [benchmarkRounds, setBenchmarkRounds] = useState<'3' | '5' | '7'>('3');
  const [benchmarkAction, setBenchmarkAction] = useState<EditAction>('improve');
  const [benchmarkSummary, setBenchmarkSummary] = useState<BenchmarkSummary | null>(null);
  const [benchmarkAutoApplyWinner, setBenchmarkAutoApplyWinner] = useState(false);
  const [benchmarkSaveCloud, setBenchmarkSaveCloud] = useState(true);
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkSummary[]>(() => {
    try {
      const raw = localStorage.getItem(BENCHMARK_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [historyActionFilter, setHistoryActionFilter] = useState<'all' | EditAction>('all');
  const [historyEngineFilter, setHistoryEngineFilter] = useState<'all' | 'model1' | 'model2'>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'best_quality' | 'best_latency'>('newest');
  const [lastAction, setLastAction] = useState<EditAction | null>(null);
  const [pendingExtras, setPendingExtras] = useState<{ customPrompt?: string; toneStyle?: string; targetLanguage?: string } | undefined>(undefined);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [showDiffHighlight, setShowDiffHighlight] = useState(false);
  const [autoCompare, setAutoCompare] = useState(true);
  const [activeRunCount, setActiveRunCount] = useState<0 | 1 | 2>(0);
  const [gpuShareMode, setGpuShareModeState] = useState<GpuShareMode>(() => getGpuShareMode());
  useEffect(() => subscribeGpuShareMode(setGpuShareModeState), []);
  // Hebrew-only output guard
  const [hebrewOnly, setHebrewOnly] = useState<boolean>(() => isHebrewOnlyEnabled());
  const [allowedLangs, setAllowedLangsState] = useState<AllowedLang[]>(() => getAllowedLangs());
  const [customLangInput, setCustomLangInput] = useState<string>('');
  const updateAllowed = (next: AllowedLang[]) => {
    setAllowedLangsState(next);
    setAllowedLangs(next);
  };
  const toggleLang = (value: string, on: boolean) => {
    updateAllowed(on ? [...allowedLangs, value] : allowedLangs.filter(v => v !== value));
  };

  // Favorite/pinned models
  const [favoriteModels, setFavoriteModelsState] = useState<string[]>(() => getFavoriteModels());
  useEffect(() => {
    const handler = () => setFavoriteModelsState(getFavoriteModels());
    window.addEventListener('ai-favorite-models-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('ai-favorite-models-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const isFavorite = (v: string) => favoriteModels.includes(v);
  const toggleFavorite = (v: string) => {
    const next = isFavorite(v) ? favoriteModels.filter(x => x !== v) : [...favoriteModels, v];
    setFavoriteModelsState(next);
    saveFavoriteModels(next);
  };

  // Model visibility + custom order
  const [hiddenModels, setHiddenModelsState] = useState<string[]>(() => getHiddenModels());
  const [modelOrder, setModelOrderState] = useState<string[]>(() => getModelOrder());
  useEffect(() => {
    const handler = () => {
      setHiddenModelsState(getHiddenModels());
      setModelOrderState(getModelOrder());
    };
    window.addEventListener('ai-model-visibility-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('ai-model-visibility-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const isHidden = (v: string) => hiddenModels.includes(v);
  const toggleHidden = (v: string) => {
    const next = isHidden(v) ? hiddenModels.filter(x => x !== v) : [...hiddenModels, v];
    setHiddenModelsState(next);
    saveHiddenModels(next);
  };
  const dragItemRef = useRef<string | null>(null);
  // Filter & sort state for the Settings panel (per-session, not persisted)
  const [filterCategory, setFilterCategory] = useState<'all' | ModelCategory>('all');
  const [filterDomain, setFilterDomain] = useState<'all' | ModelDomain>('all');
  const [sortMode, setSortMode] = useState<'custom' | 'name' | 'size-desc' | 'size-asc' | 'category'>('custom');
  const reorderModel = (sourceValue: string, targetValue: string) => {
    if (sourceValue === targetValue) return;
    // Build complete current order based on existing modelOrder + any new models
    const allCloud = CLOUD_MODELS.map(m => m.value);
    const allOllama = ollama.models.map(m => `ollama:${m.name}`);
    const all = [...allCloud, ...allOllama];
    const ordered = [...modelOrder.filter(v => all.includes(v)), ...all.filter(v => !modelOrder.includes(v))];
    const fromIdx = ordered.indexOf(sourceValue);
    const toIdx = ordered.indexOf(targetValue);
    if (fromIdx === -1 || toIdx === -1) return;
    ordered.splice(toIdx, 0, ordered.splice(fromIdx, 1)[0]);
    setModelOrderState(ordered);
    saveModelOrder(ordered);
  };
  /** Apply custom order + filter hidden, used in the Select dropdown. */
  const applyOrderAndVisibility = <T extends { value: string }>(items: T[]): T[] => {
    const visible = items.filter(m => !isHidden(m.value));
    if (modelOrder.length === 0) return visible;
    const indexOf = (v: string) => {
      const i = modelOrder.indexOf(v);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...visible].sort((a, b) => indexOf(a.value) - indexOf(b.value));
  };
  useEffect(() => subscribeHebrewGuard(() => {
    setHebrewOnly(isHebrewOnlyEnabled());
    setAllowedLangsState(getAllowedLangs());
  }), []);
  const ollama = useOllama();
  const bgQueue = useAIEditQueue();
  const customActions = useCustomActions();

  // State for action editing
  const [editingAction, setEditingAction] = useState<CustomAction | null>(null);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newActionLabel, setNewActionLabel] = useState('');
  const [newActionPrompt, setNewActionPrompt] = useState('');
  const [newActionIcon, setNewActionIcon] = useState('Wand2');
  const [newActionCategory, setNewActionCategory] = useState<'language' | 'structure' | 'length' | 'special' | 'custom'>('custom');

  const dmp = useMemo(() => new DiffMatchPatch(), []);

  const installedOllamaNames = new Set(ollama.models.map(m => m.name));
  const missingRecommended = RECOMMENDED_OLLAMA_MODELS.filter(m => !installedOllamaNames.has(m));

  // ── Pre-warm the default local model so the first edit is fast ──
  // Picks the smallest installed Hebrew model that fits in 8GB VRAM.
  useEffect(() => {
    if (!ollama.isConnected || ollama.models.length === 0) return;
    const candidates = ['qwen2.5:7b-hebrew', 'aya:8b-hebrew', 'mistral:7b-hebrew', 'gemma2:9b-hebrew', 'llama3.1:8b-hebrew'];
    const target = candidates.find(c => installedOllamaNames.has(c));
    if (!target) return;
    // Fire-and-forget; Ollama handles concurrency
    void ollama.warmupModel(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollama.isConnected, ollama.models.length]);

  // ── VRAM conflict detection: poll Whisper /health + Ollama /api/ps ──
  const [vramConflict, setVramConflict] = useState<{ whisperBusy: boolean; ollamaModels: string[]; gpuFreeMb: number | null }>({
    whisperBusy: false, ollamaModels: [], gpuFreeMb: null,
  });
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [whisperRes, ollamaRes] = await Promise.allSettled([
          fetch('http://localhost:3000/health', { signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : null),
          fetch(`${getOllamaUrl()}/api/ps`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        const whisperData: { transcribe_active?: boolean; gpu_memory?: { free_mb?: number } } | null =
          whisperRes.status === 'fulfilled' ? whisperRes.value : null;
        const ollamaData: { models?: Array<{ name?: string; model?: string }> } | null =
          ollamaRes.status === 'fulfilled' ? ollamaRes.value : null;
        setVramConflict({
          whisperBusy: !!whisperData?.transcribe_active,
          ollamaModels: (ollamaData?.models || []).map(m => m.name || m.model || '').filter(Boolean),
          gpuFreeMb: whisperData?.gpu_memory?.free_mb ?? null,
        });
      } catch {
        if (!cancelled) setVramConflict(prev => prev);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Custom OpenAI-compatible providers (LM Studio, Groq, DeepSeek, xAI, OpenRouter, etc.)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>(() => getProviders());
  useEffect(() => {
    // Load encrypted keys for enabled providers into in-memory cache
    (async () => {
      for (const p of getProviders()) {
        if (p.enabled && p.requiresKey) {
          try { await loadProviderKey(p.id); } catch { /* ignore */ }
        }
      }
    })();
    return subscribeProviders(() => setCustomProviders(getProviders()));
  }, []);

  // Flatten enabled providers + their discovered models into Select-compatible items
  const customProviderModels = customProviders
    .filter(p => p.enabled && p.models && p.models.length > 0)
    .flatMap(p =>
      p.models!.map(m => ({
        value: encodeProviderModel(p.id, m.id),
        label: `${p.icon || "🔌"} ${p.name} · ${m.id}`,
        apiModel: m.id,
        local: !p.requiresKey,
        custom: true as const,
      })),
    );

  // Build unified model list: cloud + local Ollama models + custom providers
  const AI_MODELS = [
    ...CLOUD_MODELS,
    ...ollama.models.map(m => ({
      value: `ollama:${m.name}`,
      label: `🖥️ ${m.name}`,
      apiModel: m.name,
      local: true,
    })),
    ...customProviderModels,
  ];

  const getModelApi = (v: string) => AI_MODELS.find(m => m.value === v)?.apiModel || 'google/gemini-2.5-flash';
  const getModelLabel = (v: string) => {
    if (v === '_auto') return '🤖 אוטומטי';
    return AI_MODELS.find(m => m.value === v)?.label || v;
  };

  /** Resolve _auto to actual model based on action + available Ollama models */
  const resolveModel = (v: string, action: EditAction): string => {
    if (v !== '_auto') return v;
    const mapping = AUTO_MODEL_MAP[action] || AUTO_MODEL_MAP.improve;
    // Prefer local if available
    const localName = mapping.local;
    if (installedOllamaNames.has(localName)) return `ollama:${localName}`;
    // Fallback to cloud
    return mapping.cloud;
  };

  const runEditOnce = async (
    action: EditAction,
    modelValue: string,
    extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string }
  ): Promise<{ text: string; latencyMs: number }> => {
    const resolved = resolveModel(modelValue, action);
    const startedAt = performance.now();
    let resultText: string;

    // Custom OpenAI-compatible provider (LM Studio, Groq, DeepSeek, xAI, OpenRouter, etc.)
    const parsed = parseProviderModel(resolved);
    if (parsed) {
      // Build the system prompt from action + Hebrew guard
      let systemPrompt = '';
      if (action === 'custom' && extra?.customPrompt) systemPrompt = extra.customPrompt;
      else if (action === 'tone') systemPrompt = TONE_PROMPTS[extra?.toneStyle || 'formal'] || TONE_PROMPTS.formal;
      else if (action === 'translate') systemPrompt = `אתה מתרגם מקצועי. תרגם את הטקסט הבא ל${extra?.targetLanguage || 'אנגלית'}. שמור על המשמעות והסגנון. החזר רק את התרגום.`;
      else systemPrompt = (ACTION_PROMPTS as Record<string, string>)[action] || '';
      const guardPrefix = buildHebrewGuardPrefix(action);
      if (guardPrefix) systemPrompt = guardPrefix + '\n' + systemPrompt;
      resultText = await chatWithProvider({
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        systemPrompt,
        userText: text,
        temperature: guardPrefix ? 0.2 : 0.7,
      });
    } else if (isOllamaModel(resolved)) {
      resultText = await ollama.editText({
        text,
        action,
        model: getOllamaModelName(resolved),
        customPrompt: extra?.customPrompt,
        toneStyle: extra?.toneStyle,
        targetLanguage: extra?.targetLanguage,
      });
    } else {
      resultText = await editTranscriptCloud({
        text,
        action,
        model: getModelApi(resolved),
        customPrompt: extra?.customPrompt,
        toneStyle: extra?.toneStyle,
        targetLanguage: extra?.targetLanguage,
      });
    }

    return {
      text: resultText,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  };

  const handleEdit = async (
    action: EditAction,
    modelValue: string,
    setLoading: (v: boolean) => void,
    setResult: (v: string) => void,
    setLatency?: (v: number) => void,
    extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string }
  ) => {
    if (!text.trim()) {
      toast({ title: "שגיאה", description: "אין טקסט לעריכה", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const resolved = resolveModel(modelValue, action);
      const resolvedLabel = modelValue === '_auto' ? `${getModelLabel(resolved)} (אוטומטי)` : getModelLabel(modelValue);
      const { text: resultText, latencyMs } = await runEditOnce(action, modelValue, extra);

      if (resultText) {
        setLatency?.(latencyMs);
        setResult(resultText);
        toast({ title: "הצלחה", description: `עריכה עם ${resolvedLabel} הושלמה` });
        // Hebrew-only guard: warn if foreign script slipped through
        if (isHebrewOnlyEnabled() && action !== 'translate') {
          const check = containsForeignScript(resultText);
          if (check.found) {
            toast({
              title: 'אזהרה: זוהה טקסט בשפה לא מורשית',
              description: `המודל ${resolvedLabel} החזיר תווים זרים: ${check.samples.slice(0, 5).join(' ')} — שקול הרצה מחדש או החלפת מודל`,
              variant: 'destructive',
            });
          }
        }
      }
    } catch (error) {
      const resolved = resolveModel(modelValue, action);
      const resolvedLabel = modelValue === '_auto' ? `${getModelLabel(resolved)} (אוטומטי)` : getModelLabel(modelValue);
      console.error(`Error editing with ${resolvedLabel}:`, error);
      toast({
        title: `שגיאה ב-${resolvedLabel}`,
        description: error instanceof Error ? error.message : "שגיאה בעריכה",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const runBoth = (action: EditAction | string, extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string }) => {
    // For user-created custom actions, resolve to 'custom' action with the stored prompt
    let resolvedAction = action as EditAction;
    let resolvedExtra = extra;
    if (action.startsWith('custom_')) {
      const actionPrompt = customActions.getActionPrompt(action);
      resolvedAction = 'custom' as EditAction;
      resolvedExtra = { ...extra, customPrompt: actionPrompt };
    } else {
      // Check if the built-in action has an overridden prompt
      const storedPrompt = customActions.getActionPrompt(action);
      const builtinAction = customActions.actions.find(a => a.id === action && a.builtin);
      if (builtinAction && storedPrompt && storedPrompt !== (ACTION_PROMPTS as Record<string, string>)[action]) {
        resolvedAction = 'custom' as EditAction;
        resolvedExtra = { ...extra, customPrompt: storedPrompt };
      }
    }
    setLastAction(action as EditAction);
    setActiveRunCount(2);
    setMergedResult('');
    setResult1('');
    setResult2('');
    setLatency1Ms(0);
    setLatency2Ms(0);
    toast({ title: 'מפעיל שני מנועים יחד', description: `${getModelLabel(model1)} מול ${getModelLabel(model2)}` });
    void Promise.allSettled([
      handleEdit(resolvedAction, model1, setIsEditing1, setResult1, setLatency1Ms, resolvedExtra),
      handleEdit(resolvedAction, model2, setIsEditing2, setResult2, setLatency2Ms, resolvedExtra),
    ]).finally(() => setActiveRunCount(0));
  };

  /** Just select an action — does NOT run the engines. User triggers run via per-engine buttons. */
  const selectAction = (action: EditAction | string, extras?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string }) => {
    setLastAction(action as EditAction);
    setPendingExtras(extras);
    const label = (() => {
      if (extras?.targetLanguage) return `תרגם → ${extras.targetLanguage}`;
      if (extras?.toneStyle) return `שנה טון → ${extras.toneStyle}`;
      const builtin = customActions.actions.find(a => a.id === action);
      return builtin?.label || String(action);
    })();
    toast({ title: 'פעולה נבחרה', description: `${label} · בחר "הפעל מנוע 1/2/שניהם" למטה` });
  };

  /** Run only one engine (1 or 2) using the last selected action */
  const runSingle = (engineNum: 1 | 2, actionOverride?: EditAction | string) => {
    const action = (actionOverride || lastAction) as EditAction | string | undefined;
    if (!action) {
      toast({ title: 'בחר פעולה תחילה', description: 'לחץ על אחת מפעולות העריכה למעלה', variant: 'destructive' });
      return;
    }
    let resolvedAction = action as EditAction;
    let resolvedExtra: { customPrompt?: string; toneStyle?: string; targetLanguage?: string } | undefined = pendingExtras;
    if (typeof action === 'string' && action.startsWith('custom_')) {
      const actionPrompt = customActions.getActionPrompt(action);
      resolvedAction = 'custom' as EditAction;
      resolvedExtra = { ...resolvedExtra, customPrompt: actionPrompt };
    } else {
      const storedPrompt = customActions.getActionPrompt(action as string);
      const builtinAction = customActions.actions.find(a => a.id === action && a.builtin);
      if (builtinAction && storedPrompt && storedPrompt !== (ACTION_PROMPTS as Record<string, string>)[action as string]) {
        resolvedAction = 'custom' as EditAction;
        resolvedExtra = { ...resolvedExtra, customPrompt: storedPrompt };
      }
    }
    setLastAction(action as EditAction);
    setActiveRunCount(1);
    if (engineNum === 1) {
      setResult1('');
      setLatency1Ms(0);
      toast({ title: 'מפעיל מנוע 1', description: getModelLabel(model1) });
      void handleEdit(resolvedAction, model1, setIsEditing1, setResult1, setLatency1Ms, resolvedExtra)
        .finally(() => setActiveRunCount(0));
    } else {
      setResult2('');
      setLatency2Ms(0);
      toast({ title: 'מפעיל מנוע 2', description: getModelLabel(model2) });
      void handleEdit(resolvedAction, model2, setIsEditing2, setResult2, setLatency2Ms, resolvedExtra)
        .finally(() => setActiveRunCount(0));
    }
  };

  const handleSmartMerge = async () => {
    if (!result1.trim() || !result2.trim()) {
      toast({ title: "חסר תוכן למיזוג", description: "צריך שתי תוצאות כדי לבצע מיזוג חכם", variant: "destructive" });
      return;
    }

    setIsMerging(true);
    try {
      const mergePrompt = [
        "אתה עורך ראשי.",
        "יש שתי גרסאות עריכה לאותו טקסט.",
        "החזר גרסה משולבת אחת בלבד בעברית, נקייה וזורמת, בלי הערות ובלי הסברים.",
        "שמור על דיוק, דקדוק, פיסוק ומבנה פסקאות.",
        "אם יש סתירה — בחר את הניסוח הבהיר והמדויק יותר.",
        "אל תאבד מידע מהותי.",
        "",
        "[מקור]",
        text,
        "",
        "[גרסה 1]",
        result1,
        "",
        "[גרסה 2]",
        result2,
      ].join('\n');

      let merged: string;
      const mergeEngine = isOllamaModel(model1) ? getModelLabel(model1) : getModelLabel(model1);

      if (isOllamaModel(model1)) {
        merged = await ollama.editText({
          text: mergePrompt,
          action: 'custom',
          model: getOllamaModelName(model1),
          customPrompt: 'בצע מיזוג חכם בין שתי גרסאות לטקסט אחד איכותי.',
        });
      } else {
        merged = await editTranscriptCloud({
          text: mergePrompt,
          action: 'custom',
          model: getModelApi(model1),
          customPrompt: 'בצע מיזוג חכם בין שתי גרסאות לטקסט אחד איכותי.',
        });
      }

      setMergedResult(merged);
      toast({ title: 'המיזוג הושלם', description: `בוצע עם ${mergeEngine}` });
    } catch (error) {
      toast({
        title: 'שגיאה במיזוג חכם',
        description: error instanceof Error ? error.message : 'שגיאה לא ידועה',
        variant: 'destructive',
      });
    } finally {
      setIsMerging(false);
    }
  };

  /**
   * Draft + Polish pipeline:
   * 1. Engine 1 produces a fast draft
   * 2. Engine 2 polishes the draft (typically a stronger Hebrew/cloud model)
   * Final polished output appears in result2.
   */
  const handleDraftPolish = async () => {
    if (!text.trim()) {
      toast({ title: 'אין טקסט', description: 'הזן טקסט לפני הפעלת ה-Pipeline', variant: 'destructive' });
      return;
    }
    const action = (lastAction || 'improve') as EditAction;
    setActiveRunCount(2);
    setResult1('');
    setResult2('');
    setMergedResult('');
    setLatency1Ms(0);
    setLatency2Ms(0);
    setIsEditing1(true);
    toast({
      title: '🔗 Pipeline החל: טיוטא → ליטוש',
      description: `שלב 1: ${getModelLabel(model1)} מכין טיוטא · שלב 2: ${getModelLabel(model2)} מלטש`,
    });
    try {
      // Stage 1 — fast draft
      const draftStart = performance.now();
      const draft = await runEditOnce(action, model1, pendingExtras);
      const draftLatency = Math.round(performance.now() - draftStart);
      setResult1(draft.text);
      setLatency1Ms(draftLatency);
      setIsEditing1(false);
      setIsEditing2(true);

      // Stage 2 — polish the draft (treat draft as the source text)
      const polishStart = performance.now();
      const polishPrompt = [
        'קיבלת טיוטא ראשונית של עריכה. תפקידך ללטש אותה לאיכות מקצועית בעברית בלבד.',
        'תקן דקדוק, פיסוק, זרימה וניסוח. שמר על המשמעות המקורית.',
        'החזר אך ורק את הטקסט המלוטש, ללא הערות, ללא הסברים, ללא כותרות.',
      ].join('\n');
      const polished = isOllamaModel(model2)
        ? await ollama.editText({
            text: draft.text,
            action: 'custom',
            model: getOllamaModelName(model2),
            customPrompt: polishPrompt,
          })
        : await editTranscriptCloud({
            text: draft.text,
            action: 'custom',
            model: getModelApi(model2),
            customPrompt: polishPrompt,
          });
      const polishLatency = Math.round(performance.now() - polishStart);
      setResult2(polished);
      setLatency2Ms(polishLatency);
      toast({
        title: '✅ Pipeline הושלם',
        description: `טיוטא: ${(draftLatency / 1000).toFixed(1)}s · ליטוש: ${(polishLatency / 1000).toFixed(1)}s`,
      });
    } catch (error) {
      toast({
        title: 'שגיאה ב-Pipeline',
        description: error instanceof Error ? error.message : 'שגיאה לא ידועה',
        variant: 'destructive',
      });
    } finally {
      setIsEditing1(false);
      setIsEditing2(false);
      setActiveRunCount(0);
    }
  };

  // ── Auto-apply completed background jobs ──────────────────
  const lastAppliedJobRef = useMemo(() => ({ current: '' }), []);

  useEffect(() => {
    const completed = bgQueue.jobs.find(
      j => j.status === 'completed' && j.summary && j.id !== lastAppliedJobRef.current
    );
    if (!completed || !completed.summary) return;
    lastAppliedJobRef.current = completed.id;

    const summary: BenchmarkSummary = {
      action: completed.summary.action,
      rounds: completed.summary.rounds,
      createdAt: completed.summary.createdAt,
      model1Value: completed.summary.model1Value,
      model2Value: completed.summary.model2Value,
      model1Label: completed.summary.model1Label,
      model2Label: completed.summary.model2Label,
      model1: completed.summary.model1,
      model2: completed.summary.model2,
      winner: completed.summary.winner,
    };

    setBenchmarkSummary(summary);
    setResult1(summary.model1.bestText);
    setResult2(summary.model2.bestText);
    setLatency1Ms(Math.round(summary.model1.avgLatency));
    setLatency2Ms(Math.round(summary.model2.avgLatency));

    const nextHistory = [summary, ...benchmarkHistory].slice(0, 30);
    setBenchmarkHistory(nextHistory);
    try { localStorage.setItem(BENCHMARK_HISTORY_KEY, JSON.stringify(nextHistory)); } catch {}

    if (benchmarkSaveCloud && onSaveVersion) {
      const cloudText = [
        `Benchmark ${ACTION_LABELS[summary.action]} (${summary.rounds} סבבים)`,
        `מנוע 1: ${summary.model1Label}`,
        `מהירות: ${summary.model1.avgLatency.toFixed(0)}ms | איכות: ${summary.model1.avgQuality.toFixed(1)}`,
        `מנוע 2: ${summary.model2Label}`,
        `מהירות: ${summary.model2.avgLatency.toFixed(0)}ms | איכות: ${summary.model2.avgQuality.toFixed(1)}`,
        `מנצח: מנוע ${summary.winner} (${summary.winner === 1 ? summary.model1Label : summary.model2Label})`,
      ].join('\n');
      onSaveVersion(cloudText, `ai-${summary.action}`, 'Benchmark', `benchmark-${summary.action}-${summary.rounds}`);
    }

    if (benchmarkAutoApplyWinner) {
      const winnerText = summary.winner === 1 ? summary.model1.bestText : summary.model2.bestText;
      if (winnerText.trim()) {
        onTextChange(winnerText, `ai-${summary.action}`, `Benchmark winner: ${summary.winner === 1 ? summary.model1Label : summary.model2Label}`);
      }
    }

    toast({ title: 'Benchmark הושלם ✅', description: `${summary.rounds} סבבים — ${ACTION_LABELS[summary.action]}` });
  }, [bgQueue.jobs]);

  const runBenchmark = async () => {
    if (!text.trim()) {
      toast({ title: "שגיאה", description: "אין טקסט לבנצ'מרק", variant: "destructive" });
      return;
    }
    if (benchmarkAction === 'custom') {
      toast({ title: "לא נתמך", description: "לבנצ'מרק יש לבחור פעולה מובנית ולא פרומפט מותאם", variant: "destructive" });
      return;
    }

    // Check if models are Ollama (local) — those can't run in background queue
    if (isOllamaModel(model1) || isOllamaModel(model2)) {
      toast({ title: "Ollama לא נתמך ברקע", description: "מודלים מקומיים רצים רק בפורגראונד. בחר מנוע ענן לריצת רקע.", variant: "destructive" });
      return;
    }

    const rounds = Number(benchmarkRounds);
    setBenchmarkSummary(null);

    try {
      await bgQueue.enqueue({
        sourceText: text,
        action: benchmarkAction,
        model1,
        model2,
        model1Label: getModelLabel(model1),
        model2Label: getModelLabel(model2),
        totalRounds: rounds,
      });
      toast({ title: "Benchmark נוסף לתור ברקע 🚀", description: `${rounds} סבבים — ממשיך גם אם עוברים עמוד` });
    } catch (error) {
      toast({
        title: "שגיאה בהוספה לתור",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive",
      });
    }
  };

  const exportBenchmarkJson = () => {
    if (!benchmarkSummary) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(
      `benchmark-${benchmarkSummary.action}-${stamp}.json`,
      JSON.stringify(benchmarkSummary, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportBenchmarkCsv = () => {
    if (!benchmarkSummary) return;
    const s = benchmarkSummary;
    const rows = [
      ['metric', 'model_1', 'model_2'],
      ['model_name', s.model1Label, s.model2Label],
      ['avg_latency_ms', s.model1.avgLatency.toFixed(2), s.model2.avgLatency.toFixed(2)],
      ['std_latency_ms', s.model1.stdLatency.toFixed(2), s.model2.stdLatency.toFixed(2)],
      ['avg_quality', s.model1.avgQuality.toFixed(2), s.model2.avgQuality.toFixed(2)],
      ['std_quality', s.model1.stdQuality.toFixed(2), s.model2.stdQuality.toFixed(2)],
      ['best_quality', s.model1.bestQuality.toFixed(2), s.model2.bestQuality.toFixed(2)],
      ['winner', s.winner === 1 ? s.model1Label : s.model2Label, ''],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`benchmark-${s.action}-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const exportAllHistoryJson = () => {
    if (benchmarkHistory.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(
      `benchmark-history-${stamp}.json`,
      JSON.stringify(benchmarkHistory, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportAllHistoryCsv = () => {
    if (benchmarkHistory.length === 0) return;
    const rows: string[][] = [
      ['created_at', 'action', 'rounds', 'winner_model', 'model1', 'model1_avg_latency', 'model1_avg_quality', 'model2', 'model2_avg_latency', 'model2_avg_quality'],
      ...benchmarkHistory.map(h => [
        h.createdAt,
        h.action,
        String(h.rounds),
        h.winner === 1 ? h.model1Label : h.model2Label,
        h.model1Label,
        h.model1.avgLatency.toFixed(2),
        h.model1.avgQuality.toFixed(2),
        h.model2Label,
        h.model2.avgLatency.toFixed(2),
        h.model2.avgQuality.toFixed(2),
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`benchmark-history-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const clearBenchmarkHistory = () => {
    setBenchmarkHistory([]);
    setBenchmarkSummary(null);
    try {
      localStorage.removeItem(BENCHMARK_HISTORY_KEY);
    } catch {
      // ignore storage issues
    }
    toast({ title: 'היסטוריה נוקתה', description: 'כל ריצות ה-Benchmark המקומיות נמחקו' });
  };

  const restoreBenchmarkRun = (historyItem: BenchmarkSummary) => {
    const allowedRounds = ['3', '5', '7'] as const;
    const roundValue = String(historyItem.rounds);
    if ((allowedRounds as readonly string[]).includes(roundValue)) {
      setBenchmarkRounds(roundValue as '3' | '5' | '7');
    }

    setBenchmarkAction(historyItem.action);
    setBenchmarkSummary(historyItem);

    const allModelValues = new Set(AI_MODELS.map(m => m.value));
    const byLabel = (label: string) => AI_MODELS.find(m => m.label === label)?.value;

    const nextModel1 = (historyItem.model1Value && allModelValues.has(historyItem.model1Value))
      ? historyItem.model1Value
      : byLabel(historyItem.model1Label);
    const nextModel2 = (historyItem.model2Value && allModelValues.has(historyItem.model2Value))
      ? historyItem.model2Value
      : byLabel(historyItem.model2Label);

    if (nextModel1) setModel1(nextModel1);
    if (nextModel2) setModel2(nextModel2);

    if (!nextModel1 || !nextModel2) {
      toast({
        title: 'שחזור חלקי',
        description: 'חלק מהמודלים לא זמינים כרגע בסביבה, אך ההגדרות שוחזרו.',
      });
      return;
    }

    toast({
      title: 'ריצה שוחזרה',
      description: `הוחזרו פעולה, סבבים ומודלים: ${historyItem.model1Label} מול ${historyItem.model2Label}`,
    });
  };

  const filteredHistory = benchmarkHistory.filter(h => {
    const createdAt = new Date(h.createdAt).getTime();
    const now = Date.now();
    const maxAgeMs = historyDateFilter === '7d'
      ? 7 * 24 * 60 * 60 * 1000
      : historyDateFilter === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : historyDateFilter === '90d'
          ? 90 * 24 * 60 * 60 * 1000
          : Number.POSITIVE_INFINITY;
    const dateOk = historyDateFilter === 'all' || (now - createdAt <= maxAgeMs);
    const actionOk = historyActionFilter === 'all' || h.action === historyActionFilter;
    const engineOk = historyEngineFilter === 'all'
      || (historyEngineFilter === 'model1' && h.winner === 1)
      || (historyEngineFilter === 'model2' && h.winner === 2);
    const searchNeedle = historySearch.trim().toLowerCase();
    const searchOk = !searchNeedle
      || ACTION_LABELS[h.action].toLowerCase().includes(searchNeedle)
      || h.model1Label.toLowerCase().includes(searchNeedle)
      || h.model2Label.toLowerCase().includes(searchNeedle)
      || (h.winner === 1 ? h.model1Label : h.model2Label).toLowerCase().includes(searchNeedle);
    return dateOk && actionOk && engineOk && searchOk;
  });

  const sortedFilteredHistory = [...filteredHistory].sort((a, b) => {
    if (historySort === 'oldest') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (historySort === 'best_quality') {
      const qa = Math.max(a.model1.avgQuality, a.model2.avgQuality);
      const qb = Math.max(b.model1.avgQuality, b.model2.avgQuality);
      return qb - qa;
    }
    if (historySort === 'best_latency') {
      const la = Math.min(a.model1.avgLatency, a.model2.avgLatency);
      const lb = Math.min(b.model1.avgLatency, b.model2.avgLatency);
      return la - lb;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const leaderboard = (() => {
    const agg = new Map<string, { wins: number; count: number; avgQualitySum: number; avgLatencySum: number }>();
    sortedFilteredHistory.forEach(h => {
      const add = (label: string, quality: number, latency: number, win: boolean) => {
        const cur = agg.get(label) || { wins: 0, count: 0, avgQualitySum: 0, avgLatencySum: 0 };
        cur.count += 1;
        cur.avgQualitySum += quality;
        cur.avgLatencySum += latency;
        if (win) cur.wins += 1;
        agg.set(label, cur);
      };
      add(h.model1Label, h.model1.avgQuality, h.model1.avgLatency, h.winner === 1);
      add(h.model2Label, h.model2.avgQuality, h.model2.avgLatency, h.winner === 2);
    });

    return Array.from(agg.entries())
      .map(([label, v]) => ({
        label,
        wins: v.wins,
        count: v.count,
        winRate: v.count > 0 ? (v.wins / v.count) * 100 : 0,
        avgQuality: v.count > 0 ? v.avgQualitySum / v.count : 0,
        avgLatency: v.count > 0 ? v.avgLatencySum / v.count : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.avgQuality - a.avgQuality)
      .slice(0, 8);
  })();

  const historyChartData = [...sortedFilteredHistory]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-10);

  const qualityPoints = historyChartData.map((h, i) => {
    const x = (i / Math.max(1, historyChartData.length - 1)) * 100;
    const y = 100 - Math.max(h.model1.avgQuality, h.model2.avgQuality);
    return `${x},${y}`;
  }).join(' ');

  const latencyPoints = historyChartData.map((h, i) => {
    const x = (i / Math.max(1, historyChartData.length - 1)) * 100;
    const bestLatency = Math.min(h.model1.avgLatency, h.model2.avgLatency);
    const normalized = Math.min(100, (bestLatency / 12000) * 100);
    const y = normalized;
    return `${x},${y}`;
  }).join(' ');

  const isLoading = isEditing1 || isEditing2 || isMerging;
  const noText = !text.trim();
  const metrics1 = result1 ? scoreText(text, result1, latency1Ms) : null;
  const metrics2 = result2 ? scoreText(text, result2, latency2Ms) : null;
  const winner = metrics1 && metrics2
    ? (metrics1.qualityScore >= metrics2.qualityScore ? 1 : 2)
    : null;

  const EnginePanel = ({
    num, modelValue, setModelValue, isEditingState, result, onApply, onSave, onSaveReplace, onDuplicateSave
  }: {
    num: number;
    modelValue: string;
    setModelValue: (v: string) => void;
    isEditingState: boolean;
    result: string;
    onApply: () => void;
    onSave: () => void;
    onSaveReplace: () => Promise<void> | void;
    onDuplicateSave: () => Promise<void> | void;
  }) => {    let diffElements: React.ReactNode = null;
    if (showDiffHighlight && result && text) {
      const d = dmp.diff_main(text, result);
      dmp.diff_cleanupSemantic(d);
      diffElements = d.map(([op, chunk], i) => {
        if (op === -1) return <span key={i} className="bg-destructive/20 line-through decoration-destructive/60">{chunk}</span>;
        if (op === 1) return <span key={i} className="bg-green-500/20 font-medium underline decoration-green-500/60">{chunk}</span>;
        return <span key={i}>{chunk}</span>;
      });
    }

    return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-sm font-semibold">מנוע {num}</Label>
          {modelValue !== '_auto' && modelValue !== getSavedDefaultModel() && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
              title="הגדר כברירת מחדל"
              onClick={() => { saveDefaultModel(modelValue); toast({ title: "ברירת מחדל נשמרה", description: getModelLabel(modelValue) }); }}
            >
              📌
            </Button>
          )}
          {modelValue === getSavedDefaultModel() && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">ברירת מחדל</Badge>
          )}
          {modelValue !== '_auto' && !modelValue.startsWith('_') && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 w-6 p-0 ${isFavorite(modelValue) ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}`}
              title={isFavorite(modelValue) ? 'הסר מהמועדפים' : 'הוסף למועדפים'}
              onClick={() => toggleFavorite(modelValue)}
            >
              <Star className={`w-3.5 h-3.5 ${isFavorite(modelValue) ? 'fill-current' : ''}`} />
            </Button>
          )}
          {/* Custom OpenAI-compatible providers (LM Studio, Groq, DeepSeek, xAI, OpenRouter, etc.) */}
          <CustomProvidersDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                title="ספקי AI נוספים — LM Studio, Groq, DeepSeek, xAI, OpenRouter ועוד"
              >
                <Plug className="w-3.5 h-3.5" />
              </Button>
            }
          />
          {/* Settings cog: open visibility + drag-and-drop manager */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                title="הגדרות מנועים — בחר מה להציג ושנה סדר"
              >
                <Settings className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent dir="rtl" className="w-80 p-0 max-h-[85vh] overflow-y-auto" align="end" side="top" sideOffset={8} collisionPadding={16} onOpenAutoFocus={(e) => e.preventDefault()}>
              <div className="flex items-center justify-between p-3 border-b bg-muted/30">
                <div>
                  <Label className="text-sm font-semibold">ניהול מנועים</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">סנן · מיין · סמן · גרור</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1.5"
                    onClick={() => { setHiddenModelsState([]); saveHiddenModels([]); }}
                    title="הצג את כל המנועים"
                  >
                    הצג הכל
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1.5 text-muted-foreground"
                    onClick={() => { setModelOrderState([]); saveModelOrder([]); setSortMode('custom'); }}
                    title="אפס לסדר ברירת המחדל"
                  >
                    אפס סדר
                  </Button>
                </div>
              </div>
              {/* Filter + Sort bar */}
              <div className="p-2 border-b bg-muted/10 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3 h-3 text-muted-foreground shrink-0" />
                  <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v as 'all' | ModelCategory)}>
                    <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="all">הכל (ענן + מקומי)</SelectItem>
                      <SelectItem value="cloud">☁️ מקוון</SelectItem>
                      <SelectItem value="local">🖥️ מקומי</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterDomain} onValueChange={(v) => setFilterDomain(v as 'all' | ModelDomain)}>
                    <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="all">כל התחומים</SelectItem>
                      <SelectItem value="hebrew">🇮🇱 עברית</SelectItem>
                      <SelectItem value="multilingual">🌐 רב-לשוני</SelectItem>
                      <SelectItem value="reasoning">🧠 הסקה</SelectItem>
                      <SelectItem value="code">💻 קוד</SelectItem>
                      <SelectItem value="general">📦 כללי</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
                  <Select value={sortMode} onValueChange={(v) => setSortMode(v as typeof sortMode)}>
                    <SelectTrigger className="h-6 text-[10px] flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="custom">סדר מותאם אישית (גרירה)</SelectItem>
                      <SelectItem value="name">לפי שם (א-ת)</SelectItem>
                      <SelectItem value="size-desc">לפי גודל (גדול → קטן)</SelectItem>
                      <SelectItem value="size-asc">לפי גודל (קטן → גדול)</SelectItem>
                      <SelectItem value="category">לפי קטגוריה (ענן/מקומי)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ScrollArea className="h-[340px]">
                <div className="p-2 space-y-0.5">
                  {(() => {
                    // Build complete model list with metadata
                    const cloud = CLOUD_MODELS.map(m => ({
                      value: m.value, label: m.label, icon: '☁️', category: 'cloud' as ModelCategory,
                      domain: getModelDomain(m.label), sizeB: estimateModelSizeB(m.label),
                    }));
                    const local = ollama.models.map(m => ({
                      value: `ollama:${m.name}`, label: m.name, icon: '🖥️', category: 'local' as ModelCategory,
                      domain: getModelDomain(m.name), sizeB: estimateModelSizeB(m.name),
                    }));
                    let all = [...cloud, ...local];
                    // Apply filters
                    if (filterCategory !== 'all') all = all.filter(m => m.category === filterCategory);
                    if (filterDomain !== 'all') all = all.filter(m => m.domain === filterDomain);
                    // Apply sort
                    if (sortMode === 'name') {
                      all = [...all].sort((a, b) => a.label.localeCompare(b.label, 'he'));
                    } else if (sortMode === 'size-desc') {
                      all = [...all].sort((a, b) => b.sizeB - a.sizeB);
                    } else if (sortMode === 'size-asc') {
                      all = [...all].sort((a, b) => a.sizeB - b.sizeB);
                    } else if (sortMode === 'category') {
                      all = [...all].sort((a, b) => a.category.localeCompare(b.category));
                    } else if (modelOrder.length > 0) {
                      const indexOf = (v: string) => {
                        const i = modelOrder.indexOf(v);
                        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
                      };
                      all = [...all].sort((a, b) => indexOf(a.value) - indexOf(b.value));
                    }
                    if (all.length === 0) {
                      return (
                        <p className="text-[11px] text-muted-foreground text-center py-6">
                          אין מנועים מתאימים לסינון הנוכחי
                        </p>
                      );
                    }
                    return all.map(m => {
                      const hidden = isHidden(m.value);
                      const dragEnabled = sortMode === 'custom';
                      return (
                        <div
                          key={m.value}
                          draggable={dragEnabled}
                          onDragStart={(e) => { if (!dragEnabled) return; dragItemRef.current = m.value; e.dataTransfer.effectAllowed = 'move'; }}
                          onDragOver={(e) => { if (!dragEnabled) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => {
                            if (!dragEnabled) return;
                            e.preventDefault();
                            const src = dragItemRef.current;
                            if (src) reorderModel(src, m.value);
                            dragItemRef.current = null;
                          }}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 ${dragEnabled ? 'cursor-move' : ''} ${hidden ? 'opacity-50' : ''}`}
                          title={dragEnabled ? 'גרור כדי לשנות מיקום' : 'מצב מיון אוטומטי — בטל כדי לגרור'}
                        >
                          <GripVertical className={`w-3.5 h-3.5 shrink-0 ${dragEnabled ? 'text-muted-foreground' : 'text-muted-foreground/30'}`} />
                          <Checkbox
                            checked={!hidden}
                            onCheckedChange={() => toggleHidden(m.value)}
                            id={`vis-${m.value}`}
                          />
                          <label htmlFor={`vis-${m.value}`} className="text-xs flex-1 cursor-pointer truncate">
                            {m.icon} {m.label}
                          </label>
                          {isDictaModel(m.label) && (
                            <Badge className="text-[9px] px-1 py-0 h-4 shrink-0 bg-blue-600 hover:bg-blue-600 text-white border-0" title="DICTA — המרכז הישראלי לניתוח טקסט · הסטנדרט המקצועי לעברית">
                              🇮🇱 DICTA
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
                            {getDomainLabel(m.domain).split(' ')[0]}
                          </Badge>
                          {m.sizeB > 0 && (
                            <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                              {m.sizeB >= 100 ? '100B+' : `${m.sizeB}B`}
                            </span>
                          )}
                          {isFavorite(m.value) && <Star className="w-3 h-3 fill-current text-amber-500 shrink-0" />}
                        </div>
                      );
                    });
                  })()}
                  {ollama.models.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-2">
                      💡 הפעל את Ollama כדי לראות גם מנועים מקומיים
                    </p>
                  )}
                </div>
              </ScrollArea>
              <div className="p-2 border-t text-[10px] text-muted-foreground text-center bg-muted/20">
                {CLOUD_MODELS.length + ollama.models.length} מנועים סה"כ · {hiddenModels.length} מוסתרים
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Select value={modelValue} onValueChange={setModelValue}>
          <SelectTrigger className="w-[200px] text-xs" dir="rtl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="_auto" className="text-xs font-semibold">🤖 אוטומטי (הכי טוב לפעולה)</SelectItem>
            {favoriteModels.length > 0 && (
              <>
                <SelectItem disabled value="_fav_header" className="text-xs font-semibold text-amber-600">⭐ מועדפים</SelectItem>
                {favoriteModels.map(fv => {
                  const cloud = CLOUD_MODELS.find(m => m.value === fv);
                  if (cloud) {
                    return <SelectItem key={`fav:${fv}`} value={fv} className="text-xs">⭐ {cloud.label}</SelectItem>;
                  }
                  if (fv.startsWith('ollama:')) {
                    const name = fv.slice('ollama:'.length);
                    const exists = ollama.models.some(m => m.name === name);
                    if (exists) return <SelectItem key={`fav:${fv}`} value={fv} className="text-xs">⭐ 🖥️ {name}</SelectItem>;
                  }
                  return null;
                })}
              </>
            )}
            <SelectItem disabled value="_all_header" className="text-xs font-semibold text-muted-foreground">
              🎯 כל המנועים ({CLOUD_MODELS.length + ollama.models.length + customProviderModels.length}) — סדר מותאם אישית
            </SelectItem>
            {(() => {
              const cloud = CLOUD_MODELS.map(m => ({ value: m.value, label: m.label, isLocal: false, isCustom: false, icon: '☁️' }));
              const local = ollama.models.map(m => ({ value: `ollama:${m.name}`, label: m.name, isLocal: true, isCustom: false, icon: '🖥️' }));
              const custom = customProviderModels.map(m => {
                const parsed = parseProviderModel(m.value);
                const provider = parsed ? customProviders.find(p => p.id === parsed.providerId) : undefined;
                return { value: m.value, label: m.label, isLocal: !provider?.requiresKey, isCustom: true, icon: provider?.icon || '🔌' };
              });
              const combined = [...cloud, ...local, ...custom];
              return applyOrderAndVisibility(combined).map(m => (
                <SelectItem key={m.value} value={m.value} title={inferModelHoverText(m.label)}>
                  {isFavorite(m.value) ? '⭐ ' : ''}{m.isCustom ? m.icon : (m.isLocal ? '🖥️' : '☁️')} {m.label}
                </SelectItem>
              ));
            })()}
          </SelectContent>
        </Select>
      </div>

      {/* Per-engine run controls */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button
          size="sm"
          variant="default"
          className="h-8 gap-1.5"
          disabled={isEditingState || !text.trim()}
          onClick={() => runSingle(num as 1 | 2)}
          title={lastAction ? `הפעל מנוע ${num} בלבד עם ${getModelLabel(modelValue)}` : 'בחר פעולה תחילה'}
        >
          <PlayCircle className="w-4 h-4" />
          הפעל מנוע {num}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={isEditing1 || isEditing2 || !text.trim()}
          onClick={() => lastAction && runBoth(lastAction, pendingExtras)}
          title={lastAction ? 'הפעל את שני המנועים יחד' : 'בחר פעולה תחילה'}
        >
          <PlayCircle className="w-4 h-4" />
          הפעל שניהם
        </Button>
        {lastAction && (
          <Badge variant="secondary" className="text-[10px]">פעולה: {lastAction}</Badge>
        )}
      </div>

      {isEditingState && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          מעבד עם {modelValue === '_auto' && lastAction ? `${getModelLabel(resolveModel(modelValue, lastAction))} (אוטומטי)` : getModelLabel(modelValue)}...
        </div>
      )}

      {result && !isEditingState && (
        <>
          {showDiffHighlight && diffElements ? (
            <ScrollArea className="min-h-[200px] max-h-[400px] rounded-md border p-3 bg-accent/10">
              <pre className="whitespace-pre-wrap text-right" dir="rtl" style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}>
                {diffElements}
              </pre>
            </ScrollArea>
          ) : (
            <Textarea
              value={result}
              readOnly
              className="min-h-[200px] text-right bg-accent/10"
              dir="rtl"
              style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
            />
          )}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={onApply} className="flex-1">
              החלף בטקסט הראשי
            </Button>
            {onSaveAndReplaceOriginal && (
              <Button size="sm" variant="default" onClick={onSaveReplace}>
                <Save className="w-3 h-3 ml-1" />
                שמור והחלף מקור
              </Button>
            )}
            {onDuplicateAndSave && (
              <Button size="sm" variant="outline" onClick={onDuplicateSave}>
                <Download className="w-3 h-3 ml-1" />
                שכפל ושמור
              </Button>
            )}
            {onSaveVersion && (
              <Button size="sm" variant="outline" onClick={onSave}>
                <Save className="w-3 h-3 ml-1" />
                שמור
              </Button>
            )}
            {onSyncToPlayer && (
              <Button size="sm" variant="outline" onClick={() => onSyncToPlayer(result)} title="סנכרן לנגן">
                🎧
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );};

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-semibold">עריכה עם AI — השוואת מנועים</h2>
        <Badge variant="secondary" className="text-xs">{AI_MODELS.length} מודלים</Badge>
        {ollama.isConnected && (
          <Badge variant="outline" className="text-xs text-green-600 border-green-300">
            <Cpu className="w-3 h-3 ml-1" />
            Ollama ({ollama.models.length})
          </Badge>
        )}
        <div className="ms-auto flex items-center gap-2">
          <Label htmlFor="gpu-share-mode" className="text-xs text-muted-foreground cursor-pointer" title="ברירת מחדל: תמלול ועריכה רצים בזה אחר זה כדי לא להעמיס. הפעל מקבילי רק אם יש לך GPU עם 12GB+">
            שיתוף GPU:
          </Label>
          <Select value={gpuShareMode} onValueChange={(v) => { setGpuShareModeState(v as 'serial' | 'parallel'); setGpuShareMode(v as 'serial' | 'parallel'); }}>
            <SelectTrigger id="gpu-share-mode" className="w-[140px] h-7 text-xs" dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="serial" className="text-xs">🔁 בזה אחר זה (מומלץ)</SelectItem>
              <SelectItem value="parallel" className="text-xs">⚡ מקבילי (12GB+ VRAM)</SelectItem>
            </SelectContent>
          </Select>

          {/* Hebrew-only output guard */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={hebrewOnly ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1"
                title="כפיית פלט בעברית בלבד — מונע מהמודל להחזיר טקסט בשפה אחרת"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {hebrewOnly ? `עברית בלבד${allowedLangs.length ? ` +${allowedLangs.length}` : ''}` : 'עברית בלבד: כבוי'}
              </Button>
            </PopoverTrigger>
            <PopoverContent dir="rtl" className="w-80 p-3 space-y-3" onOpenAutoFocus={(e) => e.preventDefault()}>
              <div className="flex items-center justify-between">
                <Label htmlFor="heb-only-toggle" className="text-sm font-semibold cursor-pointer">
                  כפה פלט בעברית בלבד
                </Label>
                <Switch
                  id="heb-only-toggle"
                  checked={hebrewOnly}
                  onCheckedChange={(v) => { setHebrewOnly(v); setHebrewOnlyEnabled(v); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                מוסיף לפרומפט הוראה חזקה לכתוב רק בעברית, בלי תרגום, בלי מילים בלועזית, בלי סימונים זרים.
                לא חל על פעולת "תרגם".
              </p>

              <div className={hebrewOnly ? '' : 'opacity-50 pointer-events-none'}>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs font-semibold">שפות מותרות לחריגה:</Label>
                  {allowedLangs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => updateAllowed([])}
                      title="נקה את כל השפות (עברית בלבד מוחלט)"
                    >
                      נקה הכל
                    </Button>
                  )}
                </div>

                {/* Currently allowed (chips with X) */}
                {allowedLangs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2 p-2 rounded border bg-muted/30">
                    {allowedLangs.map(v => (
                      <Badge key={v} variant="secondary" className="text-[10px] gap-1 pr-1.5">
                        {getAllowedLangLabel(v)}
                        <button
                          type="button"
                          className="hover:text-destructive ml-0.5"
                          onClick={() => toggleLang(v, false)}
                          title="הסר"
                        >
                          ✕
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Built-in presets — checkboxes */}
                <Label className="text-[10px] text-muted-foreground mb-1 block">בחר מהרשימה:</Label>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-3">
                  {ALL_ALLOWED_LANGS.map(lang => {
                    const checked = allowedLangs.includes(lang.value);
                    return (
                      <div key={lang.value} className="flex items-center gap-1.5 hover:bg-muted/50 rounded px-1.5 py-1">
                        <Checkbox
                          id={`lang-${lang.value}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleLang(lang.value, v === true)}
                        />
                        <label htmlFor={`lang-${lang.value}`} className="text-xs cursor-pointer flex-1">
                          {lang.label}
                        </label>
                      </div>
                    );
                  })}
                </div>

                {/* Custom language input */}
                <Label className="text-[10px] text-muted-foreground mb-1 block">הוסף שפה מותאמת אישית:</Label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customLangInput}
                    onChange={(e) => setCustomLangInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const trimmed = customLangInput.trim();
                        if (trimmed) {
                          toggleLang(`custom:${trimmed}`, true);
                          setCustomLangInput('');
                        }
                      }
                    }}
                    placeholder="למשל: יידיש, ארמית, סלאנג טכני..."
                    className="flex-1 h-7 text-xs px-2 rounded border bg-background"
                    dir="rtl"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2"
                    onClick={() => {
                      const trimmed = customLangInput.trim();
                      if (trimmed) {
                        toggleLang(`custom:${trimmed}`, true);
                        setCustomLangInput('');
                      }
                    }}
                  >
                    הוסף
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* VRAM-conflict warning: only relevant in 'parallel' mode */}
      {gpuShareMode === 'parallel' && (vramConflict.whisperBusy && vramConflict.ollamaModels.length > 0) && (
        <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
          <Cpu className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs space-y-1 flex-1">
            <div className="font-semibold text-amber-700 dark:text-amber-400">
              ⚠️ עומס VRAM — תמלול Whisper פעיל יחד עם {vramConflict.ollamaModels.length} מודל(ים) של Ollama
            </div>
            <div className="text-amber-700/80 dark:text-amber-400/80">
              מודלים טעונים: {vramConflict.ollamaModels.join(', ')}
              {vramConflict.gpuFreeMb !== null && ` · GPU פנוי: ${vramConflict.gpuFreeMb} MB`}
            </div>
            <div className="text-muted-foreground">
              עריכת AI עלולה להיות איטית. אפשר לפנות זיכרון:
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={async () => {
              const baseUrl = getOllamaUrl();
              await Promise.allSettled(vramConflict.ollamaModels.map(name =>
                fetch(`${baseUrl}/api/generate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model: name, prompt: '', keep_alive: 0 }),
                })
              ));
              toast({ title: 'פונה זיכרון', description: `שוחררו ${vramConflict.ollamaModels.length} מודלים מה-VRAM` });
            }}
          >
            פנה Ollama מה-VRAM
          </Button>
        </div>
      )}

      {/* Serial mode hint: editor is queued behind active transcription */}
      {gpuShareMode === 'serial' && vramConflict.whisperBusy && (isEditing1 || isEditing2) && (
        <div className="mb-4 rounded-lg border border-blue-400/60 bg-blue-50 dark:bg-blue-950/30 p-3 flex items-center gap-2 text-xs">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
          <span className="text-blue-700 dark:text-blue-300">
            עריכת AI ממתינה לסיום תמלול Whisper (מצב "בזה אחר זה"). תרוץ אוטומטית כשה-GPU יתפנה.
          </span>
        </div>
      )}

      {/* ── Source-picker (choose which transcript/version to edit) ── */}
      {(versions || originalText) && (
        <div className="mb-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-yellow-500/30 bg-yellow-500/10">
            <div className="flex items-center gap-2">
              <GitCompareArrows className="w-3.5 h-3.5 text-yellow-700" />
              <Label className="text-xs font-semibold">מקור הקלט לעריכה</Label>
              {isDirty && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-400">שינויים לא שמורים</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5"
              onClick={() => currentSourceVersion && applySourceLoad(currentSourceVersion.id)}
              title="טען מחדש מהמקור"
              disabled={!currentSourceVersion}
            >
              <RotateCw className="w-3 h-3 ml-1" />
              רענן
            </Button>
          </div>
          <div className="p-2">
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 relative"
                    title={`סינון: ${sourceCategory === 'all' ? 'הכל' : sourceCategory === 'current' ? 'נוכחי' : sourceCategory === 'original' ? 'מקורי' : sourceCategory === 'ai' ? 'AI' : 'שמורות'}`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    {sourceCategory !== 'all' && (
                      <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-yellow-500" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent dir="rtl" align="end" className="w-44 p-1">
                  {([
                    { v: 'all', label: 'הכל' },
                    { v: 'current', label: 'נוכחי' },
                    { v: 'original', label: 'מקורי' },
                    { v: 'ai', label: 'AI' },
                    { v: 'saved', label: 'שמורות' },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setSourceCategory(opt.v as SourceCategory)}
                      className={cn(
                        'w-full text-right text-xs px-2 py-1.5 rounded hover:bg-muted',
                        sourceCategory === opt.v && 'bg-yellow-500/15 font-semibold text-yellow-800'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <Select
                value={filteredByCategory.some(v => v.id === selectedSourceId) ? selectedSourceId : ''}
                onValueChange={requestSourceChange}
                disabled={filteredByCategory.length === 0}
              >
                <SelectTrigger className="text-xs h-8 flex-1" dir="rtl">
                  <SelectValue placeholder={filteredByCategory.length === 0 ? 'אין גרסאות בקטגוריה זו' : 'בחר גרסה...'} />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {filteredByCategory.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      {formatSourceLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentSourceVersion && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {currentSourceVersion.text.split(/\s+/).filter(Boolean).length.toLocaleString()} מילים
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Editable source-text preview ── */}
      <div className="mb-4 rounded-lg border bg-background/60">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs font-semibold">טקסט לעריכה (ניתן לשנות לפני/בין הרצות):</Label>
            {isUserEditedText && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-400">נערך ידנית</Badge>
            )}
            <span className="text-[10px] text-muted-foreground">{text.length.toLocaleString()} תווים</span>
          </div>
          <div className="flex items-center gap-1">
            {isUserEditedText && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-primary"
                onClick={() => { setWorkingText(propText); setLoadedSnapshot(propText); setIsUserEditedText(false); toast({ title: 'שוחזר למקור' }); }}
                title="שחזר את הטקסט המקורי"
              >
                <RotateCcw className="w-3 h-3 ml-1" />
                שחזר מקור
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setShowSourceEditor(v => !v)}
              title={showSourceEditor ? 'מזער' : 'הצג'}
            >
              {showSourceEditor ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        {showSourceEditor && (
          <Textarea
            value={text}
            onChange={(e) => { setWorkingText(e.target.value); setIsUserEditedText(true); }}
            className="min-h-[80px] max-h-[160px] text-right border-0 rounded-t-none focus-visible:ring-0 text-sm resize-y"
            dir="rtl"
            placeholder="הטקסט יופיע כאן..."
          />
        )}
      </div>

      {/* ── Dirty-source-change confirmation dialog ── */}
      <Dialog open={dirtyDialogOpen} onOpenChange={(o) => { if (!o) handleDirtyCancel(); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>שינויים לא שמורים</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ערכת את הטקסט מאז הטעינה האחרונה. מה לעשות לפני החלפת המקור?
          </p>
          <div className="flex flex-wrap justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={handleDirtyCancel}>בטל</Button>
            <Button variant="outline" size="sm" onClick={handleDirtyDiscard}>השלך והחלף</Button>
            <Button size="sm" onClick={handleDirtySaveThenLoad} disabled={!onSaveVersion}>
              שמור כגרסה חדשה והחלף
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Save Actions (always visible near top) */}
      {(onSaveAndReplaceOriginal || onDuplicateAndSave || onSaveVersion) && (
        <div className="mb-4 rounded-lg border p-3 bg-background/80">
          <div className="flex items-center justify-between gap-2 mb-2">
            <Label className="text-sm font-semibold">שמירה מהירה לתוצאות</Label>
            <Badge variant="outline" className="text-xs">גלוי תמיד</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={!result1}
              onClick={() => onSaveAndReplaceOriginal?.(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve')}
              title="שמור והחלף מקור - מנוע 1"
            >
              <Save className="w-3 h-3 ml-1" />
              שמור+החלף (מנוע 1)
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={!result1}
              onClick={() => onDuplicateAndSave?.(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve')}
              title="שכפל ושמור - מנוע 1"
            >
              <Download className="w-3 h-3 ml-1" />
              שכפל+שמור (מנוע 1)
            </Button>

            <Button
              size="sm"
              variant="default"
              disabled={!result2}
              onClick={() => onSaveAndReplaceOriginal?.(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve')}
              title="שמור והחלף מקור - מנוע 2"
            >
              <Save className="w-3 h-3 ml-1" />
              שמור+החלף (מנוע 2)
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={!result2}
              onClick={() => onDuplicateAndSave?.(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve')}
              title="שכפל ושמור - מנוע 2"
            >
              <Download className="w-3 h-3 ml-1" />
              שכפל+שמור (מנוע 2)
            </Button>

            {onSaveVersion && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!result1 && !result2}
                onClick={() => {
                  if (result1) onSaveVersion(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), `${lastAction || 'improve'} • מנוע 1`);
                  if (result2) onSaveVersion(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), `${lastAction || 'improve'} • מנוע 2`);
                  toast({ title: 'נשמרו גרסאות', description: 'נשמרו כל התוצאות הזמינות' });
                }}
                title="שמור היסטוריית גרסאות"
              >
                <Save className="w-3 h-3 ml-1" />
                שמור גרסאות
              </Button>
            )}
          </div>
        </div>
      )}

      {missingRecommended.length > 0 && ollama.isConnected && (
        <div className="mb-4 rounded-lg border p-3 bg-muted/20">
          <div className="flex items-center justify-between gap-2 mb-2">
            <Label className="text-sm font-semibold">מנועים מומלצים לעברית שעדיין לא מותקנים</Label>
            <Badge variant="outline" className="text-xs">{missingRecommended.length} חסרים</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const results = await Promise.allSettled(missingRecommended.map(m => ollama.pullModel(m)));
                const okCount = results.filter(r => r.status === 'fulfilled').length;
                toast({ title: 'הופעלו הורדות רקע', description: `${okCount}/${missingRecommended.length} התחילו` });
              }}
            >
              <Cpu className="w-3 h-3 ml-1" />
              הורד הכל במקביל
            </Button>
            {ollama.isPulling && (
              <Button size="sm" variant="ghost" onClick={() => ollama.cancelPull()}>
                עצור את כל ההורדות
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {missingRecommended.map(m => {
              const job = ollama.pullJobs?.[m];
              const isActive = job?.status === 'starting' || job?.status === 'pulling' || job?.status === 'retrying';
              const canResume = job?.status === 'cancelled' || job?.status === 'error';
              const percent = job?.percent || 0;
              const completed = job?.progress?.completed;
              const total = job?.progress?.total;
              const statusText = mapPullStatusLabel(job?.status);
              const progressText = total && completed
                ? `${formatBytes(completed)} / ${formatBytes(total)}`
                : (job?.progress?.status || 'ממתין לעדכון');

              return (
                <div key={m} className="rounded-md border p-2 bg-background">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs" dir="ltr">{m}</span>
                    <Badge variant="outline" className="text-[10px]">{statusText}</Badge>
                  </div>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{progressText}</span>
                      <span className="font-medium">{percent}%</span>
                    </div>
                    <Progress value={percent} className="h-1.5" />
                  </div>
                  {job?.status === 'retrying' && (
                    <div className="text-[10px] text-amber-600 mt-1">
                      ממשיך אוטומטית מהחלק שכבר ירד (ניסיון {job.retries + 1})
                    </div>
                  )}
                  {job?.error && job.status !== 'retrying' && (
                    <div className="text-[10px] text-destructive mt-1">{job.error}</div>
                  )}
                  <div className="flex gap-1 mt-1">
                    {!isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await ollama.pullModel(m);
                            toast({ title: 'הורדה הושלמה', description: `${m} מוכן לשימוש` });
                          } catch (e) {
                            toast({ title: 'שגיאה בהורדה', description: e instanceof Error ? e.message : 'שגיאה', variant: 'destructive' });
                          }
                        }}
                      >
                        {job?.status === 'starting' || job?.status === 'pulling' ? <Loader2 className="w-3 h-3 ml-1 animate-spin" /> : <Cpu className="w-3 h-3 ml-1" />}
                        {canResume ? 'המשך' : 'התקן'}
                      </Button>
                    )}
                    {isActive && (
                      <Button size="sm" variant="ghost" onClick={() => ollama.cancelPull(m)}>
                        עצור
                      </Button>
                    )}
                    {canResume && !isActive && (
                      <Button size="sm" variant="ghost" onClick={() => ollama.resumePull(m)}>
                        המשך מאותה נקודה
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Buttons - Customizable */}
      <div className="space-y-3 mb-6 p-4 bg-muted/30 rounded-lg">
        {/* Toolbar: view mode + add + reset */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1">
            <Button
              variant={customActions.viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm" className="h-7 w-7 p-0"
              onClick={() => customActions.setViewMode('grid')}
              title="תצוגת רשת"
            ><LayoutGrid className="w-3.5 h-3.5" /></Button>
            <Button
              variant={customActions.viewMode === 'list' ? 'default' : 'ghost'}
              size="sm" className="h-7 w-7 p-0"
              onClick={() => customActions.setViewMode('list')}
              title="תצוגת רשימה"
            ><LayoutList className="w-3.5 h-3.5" /></Button>
            <Button
              variant={customActions.viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm" className="h-7 w-7 p-0"
              onClick={() => customActions.setViewMode('compact')}
              title="תצוגה מצומצמת"
            ><Rows3 className="w-3.5 h-3.5" /></Button>
            <Button
              variant={customActions.viewMode === 'masonry' ? 'default' : 'ghost'}
              size="sm" className="h-7 w-7 p-0"
              onClick={() => customActions.setViewMode('masonry')}
              title="תצוגת אבנים"
            ><AlignJustify className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm" className="h-7 text-xs gap-1"
              onClick={() => {
                setNewActionLabel(''); setNewActionPrompt(''); setNewActionIcon('Wand2'); setNewActionCategory('custom');
                setShowAddAction(true);
              }}
            ><Plus className="w-3 h-3" /> הוסף פעולה</Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs gap-1"
              onClick={() => customActions.resetToDefaults()}
              title="אפס לברירת מחדל"
            ><RotateCw className="w-3 h-3" /></Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-background/80 px-3 py-2 text-xs text-muted-foreground">
          <span>כל פעולה מפעילה את מנוע 1 ואת מנוע 2 יחד.</span>
          <Badge variant={activeRunCount === 2 ? 'default' : 'outline'} className="text-[10px]">
            {activeRunCount === 2 ? '2 מנועים פעילים' : 'מוכן להפעלה כפולה'}
          </Badge>
        </div>

        {/* Dynamic action categories */}
        {customActions.groupedActions.map(group => (
          <div key={group.category}>
            <Label className="text-xs text-muted-foreground mb-1.5 block">{group.label}</Label>
            <div className={
              customActions.viewMode === 'grid' ? 'flex flex-wrap gap-1.5' :
              customActions.viewMode === 'list' ? 'flex flex-col gap-1' :
              customActions.viewMode === 'masonry' ? 'columns-2 md:columns-3 xl:columns-4 gap-2 space-y-2' :
              'flex flex-wrap gap-0.5'
            }>
              {group.actions.map(action => {
                // Special built-in actions (translate, tone) are rendered separately below
                if (action.id === 'translate' || action.id === 'tone') return null;
                const IconComp = getIconComponent(action.icon);
                return (
                  <div key={action.id} className={customActions.viewMode === 'masonry' ? 'group relative mb-2 break-inside-avoid' : 'group relative inline-flex'}>
                    {customActions.viewMode === 'list' ? (
                      <div className="flex items-center gap-2 w-full">
                        <Button
                          variant={lastAction === action.id ? "default" : "secondary"}
                          size="sm"
                          disabled={isLoading || noText}
                          className="text-xs flex-1 justify-start"
                          onClick={() => selectAction(action.id as EditAction)}
                        >
                          <IconComp className="w-3 h-3 ml-1 flex-shrink-0" />
                          {action.label}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditingAction(action)} title="ערוך">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive" onClick={() => customActions.deleteAction(action.id)} title="מחק">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : customActions.viewMode === 'compact' ? (
                      <>
                        <Button
                          variant={lastAction === action.id ? "default" : "secondary"}
                          size="sm"
                          disabled={isLoading || noText}
                          className="text-xs h-7 px-1.5"
                          onClick={() => selectAction(action.id as EditAction)}
                          title={action.label}
                        >
                          <IconComp className="w-3.5 h-3.5" />
                        </Button>
                        <div className="absolute -top-1 -left-1 hidden group-hover:flex gap-0.5 z-10 bg-background rounded shadow-sm border p-0.5">
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setEditingAction(action)}><Pencil className="w-2.5 h-2.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => customActions.deleteAction(action.id)}><Trash2 className="w-2.5 h-2.5" /></Button>
                        </div>
                      </>
                    ) : customActions.viewMode === 'masonry' ? (
                      <>
                        <Button
                          variant={lastAction === action.id ? "default" : "secondary"}
                          size="sm"
                          disabled={isLoading || noText}
                          className="text-xs w-full justify-start px-3 py-2 h-auto whitespace-normal"
                          onClick={() => selectAction(action.id as EditAction)}
                        >
                          <IconComp className="w-3 h-3 ml-1 mt-0.5 flex-shrink-0" />
                          <span className="text-right leading-5">{action.label}</span>
                        </Button>
                        <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5 z-10 bg-background rounded shadow-sm border p-0.5">
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setEditingAction(action)}><Pencil className="w-2.5 h-2.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => customActions.deleteAction(action.id)}><Trash2 className="w-2.5 h-2.5" /></Button>
                        </div>
                      </>
                    ) : (
                      /* grid (default) */
                      <>
                        <Button
                          variant={lastAction === action.id ? "default" : "secondary"}
                          size="sm"
                          disabled={isLoading || noText}
                          className="text-xs"
                          onClick={() => selectAction(action.id as EditAction)}
                        >
                          <IconComp className="w-3 h-3 ml-1" />
                          {action.label}
                        </Button>
                        <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5 z-10 bg-background rounded shadow-sm border p-0.5">
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setEditingAction(action)} title="ערוך"><Pencil className="w-2.5 h-2.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => customActions.deleteAction(action.id)} title="מחק"><Trash2 className="w-2.5 h-2.5" /></Button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Special: translate + tone (always shown in special category) */}
        <div>
          <div className={
            customActions.viewMode === 'grid' ? 'flex flex-wrap gap-1.5' :
            customActions.viewMode === 'list' ? 'flex flex-col gap-1' :
            'flex flex-wrap gap-0.5'
          }>
            {/* Translate with language picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={lastAction === 'translate' ? "default" : "secondary"}
                  size="sm"
                  disabled={isLoading || noText}
                  className="text-xs"
                >
                  <Languages className="w-3 h-3 ml-1" />
                  {customActions.viewMode !== 'compact' && 'תרגם'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" dir="rtl">
                <Label className="text-xs font-semibold mb-2 block">שפת יעד:</Label>
                <div className="space-y-0.5">
                  {TRANSLATE_LANGS.map(lang => (
                    <Button
                      key={lang.value}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => selectAction('translate', { targetLanguage: lang.value })}
                    >
                      {lang.label}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Tone with style picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={lastAction === 'tone' ? "default" : "secondary"}
                  size="sm"
                  disabled={isLoading || noText}
                  className="text-xs"
                >
                  <Volume2 className="w-3 h-3 ml-1" />
                  {customActions.viewMode !== 'compact' && 'שנה טון'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-36 p-2" dir="rtl">
                <Label className="text-xs font-semibold mb-2 block">בחר טון:</Label>
                <div className="space-y-0.5">
                  {TONE_OPTIONS.map(tone => (
                    <Button
                      key={tone.value}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => selectAction('tone', { toneStyle: tone.value })}
                    >
                      {tone.label}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Custom Prompt */}
        <div className="pt-2 border-t">
          <Dialog open={showCustomDialog} onOpenChange={setShowCustomDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isLoading || noText}>
                <MessageSquare className="w-3 h-3 ml-1" />
                פרומפט מותאם
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>פרומפט מותאם — יופעל על שני המנועים</DialogTitle>
              </DialogHeader>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="הזן הוראות מותאמות למנוע ה-AI..."
                className="min-h-[100px] text-right"
                dir="rtl"
              />
              <Button
                onClick={() => {
                  if (!customPrompt.trim()) return;
                  selectAction('custom', { customPrompt });
                  setShowCustomDialog(false);
                }}
                disabled={!customPrompt.trim()}
              >
                שמור פרומפט (לחץ "הפעל מנוע" למטה)
              </Button>
            </DialogContent>
          </Dialog>

          {/* Edit Action Dialog */}
          <Dialog open={!!editingAction} onOpenChange={(open) => { if (!open) setEditingAction(null); }}>
            <DialogContent dir="rtl" className="max-w-md">
              <DialogHeader>
                <DialogTitle>עריכת פעולה: {editingAction?.label}</DialogTitle>
              </DialogHeader>
              {editingAction && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs mb-1 block">שם הפעולה</Label>
                    <Input
                      value={editingAction.label}
                      onChange={(e) => setEditingAction({ ...editingAction, label: e.target.value })}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">הוראות (prompt)</Label>
                    <Textarea
                      value={editingAction.prompt}
                      onChange={(e) => setEditingAction({ ...editingAction, prompt: e.target.value })}
                      className="min-h-[120px] text-right text-xs"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">אייקון</Label>
                    <div className="flex flex-wrap gap-1">
                      {ICON_OPTIONS.map(iconName => {
                        const IC = getIconComponent(iconName);
                        return (
                          <Button
                            key={iconName}
                            variant={editingAction.icon === iconName ? 'default' : 'outline'}
                            size="sm" className="h-8 w-8 p-0"
                            onClick={() => setEditingAction({ ...editingAction, icon: iconName })}
                            title={iconName}
                          >
                            <IC className="w-4 h-4" />
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">קטגוריה</Label>
                    <select
                      className="w-full rounded border p-1.5 text-sm bg-background"
                      value={editingAction.category}
                      onChange={(e) => setEditingAction({ ...editingAction, category: e.target.value as any })}
                    >
                      <option value="language">ניסוח ושפה</option>
                      <option value="structure">מבנה</option>
                      <option value="length">אורך</option>
                      <option value="special">מיוחד</option>
                      <option value="custom">מותאם אישית</option>
                    </select>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (editingAction) {
                        customActions.updateAction(editingAction.id, {
                          label: editingAction.label,
                          prompt: editingAction.prompt,
                          icon: editingAction.icon,
                          category: editingAction.category,
                        });
                        setEditingAction(null);
                      }
                    }}
                  >שמור שינויים</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Add Action Dialog */}
          <Dialog open={showAddAction} onOpenChange={setShowAddAction}>
            <DialogContent dir="rtl" className="max-w-md">
              <DialogHeader>
                <DialogTitle>הוסף פעולה חדשה</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs mb-1 block">שם הפעולה</Label>
                  <Input
                    value={newActionLabel}
                    onChange={(e) => setNewActionLabel(e.target.value)}
                    placeholder="למשל: סדר טבלה"
                    dir="rtl"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">הוראות (prompt)</Label>
                  <Textarea
                    value={newActionPrompt}
                    onChange={(e) => setNewActionPrompt(e.target.value)}
                    placeholder="הזן את ההוראות למנוע ה-AI..."
                    className="min-h-[120px] text-right text-xs"
                    dir="rtl"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">אייקון</Label>
                  <div className="flex flex-wrap gap-1">
                    {ICON_OPTIONS.map(iconName => {
                      const IC = getIconComponent(iconName);
                      return (
                        <Button
                          key={iconName}
                          variant={newActionIcon === iconName ? 'default' : 'outline'}
                          size="sm" className="h-8 w-8 p-0"
                          onClick={() => setNewActionIcon(iconName)}
                          title={iconName}
                        >
                          <IC className="w-4 h-4" />
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">קטגוריה</Label>
                  <select
                    className="w-full rounded border p-1.5 text-sm bg-background"
                    value={newActionCategory}
                    onChange={(e) => setNewActionCategory(e.target.value as any)}
                  >
                    <option value="language">ניסוח ושפה</option>
                    <option value="structure">מבנה</option>
                    <option value="length">אורך</option>
                    <option value="special">מיוחד</option>
                    <option value="custom">מותאם אישית</option>
                  </select>
                </div>
                <Button
                  className="w-full"
                  disabled={!newActionLabel.trim() || !newActionPrompt.trim()}
                  onClick={() => {
                    customActions.addAction({
                      label: newActionLabel.trim(),
                      prompt: newActionPrompt.trim(),
                      icon: newActionIcon,
                      category: newActionCategory,
                    });
                    setShowAddAction(false);
                    setNewActionLabel(''); setNewActionPrompt('');
                  }}
                >הוסף פעולה</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            className="mr-2"
            onClick={handleSmartMerge}
            disabled={isLoading || !result1.trim() || !result2.trim()}
          >
            {isMerging ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Sparkles className="w-3 h-3 ml-1" />}
            מיזוג חכם (שתי תוצאות)
          </Button>

          <Button
            variant="default"
            size="sm"
            className="mr-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            onClick={handleDraftPolish}
            disabled={isLoading || !text.trim()}
            title={`Pipeline: ${getModelLabel(model1)} (טיוטא) → ${getModelLabel(model2)} (ליטוש סופי). מומלץ: מנוע מהיר ב-1 ומנוע איכותי לעברית ב-2 (DictaLM/Claude).`}
          >
            <RotateCw className="w-3 h-3 ml-1" />
            🔗 Pipeline (טיוטא → ליטוש)
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="mr-2"
                disabled={!metrics1 || !metrics2 || isLoading}
              >
                <Gauge className="w-3 h-3 ml-1" />
                דיאלוג השוואה מעמיק
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>השוואת מנועים: מהירות, דיוק ואיכות</DialogTitle>
              </DialogHeader>
              {metrics1 && metrics2 && (
                <div className="space-y-3">
                  {winner && (
                    <div className="rounded-md border p-2 bg-muted/20 text-sm flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-amber-500" />
                      מנצח לפי ציון איכות משוקלל: מנוע {winner} ({winner === 1 ? getModelLabel(model1) : getModelLabel(model2)})
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-sm">מנוע 1: {getModelLabel(model1)}</div>
                      <div className="text-xs">מהירות: {metrics1.latencyMs}ms</div>
                      <div className="text-xs">שימור משמעות: {(metrics1.preserveScore * 100).toFixed(1)}%</div>
                      <div className="text-xs">עברית בטקסט: {(metrics1.hebrewRatio * 100).toFixed(1)}%</div>
                      <div className="text-xs">צפיפות פיסוק: {(metrics1.punctuationDensity * 100).toFixed(1)}%</div>
                      <div className="text-xs">סטיית אורך: {(metrics1.lengthDrift * 100).toFixed(1)}%</div>
                      <div className="font-semibold text-sm">ציון כולל: {metrics1.qualityScore.toFixed(1)}</div>
                    </div>
                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-sm">מנוע 2: {getModelLabel(model2)}</div>
                      <div className="text-xs">מהירות: {metrics2.latencyMs}ms</div>
                      <div className="text-xs">שימור משמעות: {(metrics2.preserveScore * 100).toFixed(1)}%</div>
                      <div className="text-xs">עברית בטקסט: {(metrics2.hebrewRatio * 100).toFixed(1)}%</div>
                      <div className="text-xs">צפיפות פיסוק: {(metrics2.punctuationDensity * 100).toFixed(1)}%</div>
                      <div className="text-xs">סטיית אורך: {(metrics2.lengthDrift * 100).toFixed(1)}%</div>
                      <div className="font-semibold text-sm">ציון כולל: {metrics2.qualityScore.toFixed(1)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    הערה: זהו ציון השוואתי אוטומטי המבוסס על מהירות, שימור משמעות, יחס עברית, פיסוק וסטיית אורך. להכרעה סופית מומלץ גם review אנושי.
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="mr-2"
                disabled={isLoading || noText}
              >
                <Trophy className="w-3 h-3 ml-1" />
                Benchmark רב-סבבים
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Benchmark עמוק: מהירות, איכות ויציבות</DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">פעולה לבדיקה</Label>
                  <Select value={benchmarkAction} onValueChange={(v) => setBenchmarkAction(v as EditAction)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="improve">שפר ניסוח</SelectItem>
                      <SelectItem value="grammar">דקדוק ואיות</SelectItem>
                      <SelectItem value="punctuation">פיסוק</SelectItem>
                      <SelectItem value="readable">זורם לקריאה</SelectItem>
                      <SelectItem value="paragraphs">חלוקה לפסקאות</SelectItem>
                      <SelectItem value="headings">כותרות</SelectItem>
                      <SelectItem value="bullets">נקודות מפתח</SelectItem>
                      <SelectItem value="expand">הרחבה</SelectItem>
                      <SelectItem value="shorten">קיצור</SelectItem>
                      <SelectItem value="summarize">סיכום</SelectItem>
                      <SelectItem value="sources">הוספת מקורות</SelectItem>
                      <SelectItem value="speakers">זיהוי דוברים</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">כמות סבבים</Label>
                  <Select value={benchmarkRounds} onValueChange={(v) => setBenchmarkRounds(v as '3' | '5' | '7')}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="3">3 סבבים (מהיר)</SelectItem>
                      <SelectItem value="5">5 סבבים (מומלץ)</SelectItem>
                      <SelectItem value="7">7 סבבים (עמוק)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 flex items-end">
                  <Button className="w-full" onClick={runBenchmark} disabled={isLoading}>
                    {bgQueue.runningCount > 0 ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Gauge className="w-4 h-4 ml-1" />}
                    {bgQueue.activeCount > 0 ? `הוסף Benchmark (${bgQueue.activeCount} בתור)` : 'הרץ Benchmark ברקע'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Button
                  variant={benchmarkAutoApplyWinner ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setBenchmarkAutoApplyWinner(v => !v)}
                >
                  {benchmarkAutoApplyWinner ? 'מופעל: החלה אוטומטית של מנצח' : 'כבוי: החלה אוטומטית של מנצח'}
                </Button>
                <Button
                  variant={benchmarkSaveCloud ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setBenchmarkSaveCloud(v => !v)}
                >
                  {benchmarkSaveCloud ? 'מופעל: שמירת היסטוריה בענן' : 'כבוי: שמירת היסטוריה בענן'}
                </Button>
              </div>

              {/* ── Background Jobs Panel ── */}
              {bgQueue.jobs.length > 0 && (
                <div className="rounded-md border p-3 space-y-2 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <Cpu className="w-4 h-4" />
                      משימות ברקע ({bgQueue.activeCount} פעילות)
                    </div>
                    {bgQueue.jobs.some(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => bgQueue.clearFinished()}>
                        <Trash2 className="w-3 h-3 ml-1" />
                        נקה הושלמו
                      </Button>
                    )}
                  </div>
                  {bgQueue.jobs.map(job => (
                    <div key={job.id} className="rounded border p-2 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {ACTION_LABELS[job.action]} — {job.model1Label} vs {job.model2Label}
                        </span>
                        <div className="flex items-center gap-1">
                          {job.status === 'running' && (
                            <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={() => bgQueue.cancel(job.id)} title="עצור">
                              <StopCircle className="w-3 h-3 text-destructive" />
                            </Button>
                          )}
                          {job.status === 'pending' && (
                            <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={() => bgQueue.cancel(job.id)} title="בטל">
                              <StopCircle className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          )}
                          {(job.status === 'failed' || job.status === 'cancelled') && (
                            <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={() => bgQueue.resume(job.id)} title="המשך מאותה נקודה">
                              <RotateCcw className="w-3 h-3 text-primary" />
                            </Button>
                          )}
                          {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                            <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={() => bgQueue.remove(job.id)} title="מחק">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={(job.completedRounds / job.totalRounds) * 100} className="h-1.5 flex-1" />
                        <span className="text-muted-foreground whitespace-nowrap">
                          {job.completedRounds}/{job.totalRounds} סבבים
                        </span>
                        <Badge variant={
                          job.status === 'completed' ? 'default' :
                          job.status === 'running' ? 'secondary' :
                          job.status === 'failed' ? 'destructive' :
                          job.status === 'cancelled' ? 'outline' : 'outline'
                        } className="text-[10px] h-4">
                          {job.status === 'pending' ? 'ממתין' :
                           job.status === 'running' ? 'רץ...' :
                           job.status === 'completed' ? 'הושלם ✅' :
                           job.status === 'failed' ? 'נכשל ❌' : 'נעצר ⏸️'}
                        </Badge>
                      </div>
                      {job.error && (
                        <div className="text-destructive text-[10px]">{job.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {benchmarkSummary && (
                <div className="space-y-3 mt-2">
                  <div className="rounded-md border p-2 bg-muted/20 text-sm flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    מנצח Benchmark ({ACTION_LABELS[benchmarkSummary.action]}, {benchmarkSummary.rounds} סבבים):
                    מנוע {benchmarkSummary.winner} ({benchmarkSummary.winner === 1 ? benchmarkSummary.model1Label : benchmarkSummary.model2Label})
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-sm">מנוע 1: {benchmarkSummary.model1Label}</div>
                      <div className="text-xs">מהירות ממוצעת: {benchmarkSummary.model1.avgLatency.toFixed(0)}ms</div>
                      <div className="text-xs">יציבות מהירות (סטיית תקן): {benchmarkSummary.model1.stdLatency.toFixed(1)}ms</div>
                      <div className="text-xs">איכות ממוצעת: {benchmarkSummary.model1.avgQuality.toFixed(1)}</div>
                      <div className="text-xs">יציבות איכות (סטיית תקן): {benchmarkSummary.model1.stdQuality.toFixed(2)}</div>
                      <div className="text-xs">איכות שיא: {benchmarkSummary.model1.bestQuality.toFixed(1)}</div>
                    </div>

                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-sm">מנוע 2: {benchmarkSummary.model2Label}</div>
                      <div className="text-xs">מהירות ממוצעת: {benchmarkSummary.model2.avgLatency.toFixed(0)}ms</div>
                      <div className="text-xs">יציבות מהירות (סטיית תקן): {benchmarkSummary.model2.stdLatency.toFixed(1)}ms</div>
                      <div className="text-xs">איכות ממוצעת: {benchmarkSummary.model2.avgQuality.toFixed(1)}</div>
                      <div className="text-xs">יציבות איכות (סטיית תקן): {benchmarkSummary.model2.stdQuality.toFixed(2)}</div>
                      <div className="text-xs">איכות שיא: {benchmarkSummary.model2.bestQuality.toFixed(1)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={exportBenchmarkJson}>
                      ייצוא JSON
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportBenchmarkCsv}>
                      ייצוא CSV
                    </Button>
                  </div>

                  {benchmarkHistory.length > 0 && (
                    <div className="rounded-md border p-2 text-xs space-y-2">
                      <div className="font-semibold">היסטוריית Benchmark</div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Select value={historyActionFilter} onValueChange={(v) => setHistoryActionFilter(v as 'all' | EditAction)}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="סנן לפי פעולה" /></SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="all">כל הפעולות</SelectItem>
                            <SelectItem value="improve">שפר ניסוח</SelectItem>
                            <SelectItem value="grammar">דקדוק ואיות</SelectItem>
                            <SelectItem value="punctuation">פיסוק</SelectItem>
                            <SelectItem value="readable">זורם לקריאה</SelectItem>
                            <SelectItem value="paragraphs">חלוקה לפסקאות</SelectItem>
                            <SelectItem value="headings">כותרות</SelectItem>
                            <SelectItem value="bullets">נקודות מפתח</SelectItem>
                            <SelectItem value="expand">הרחבה</SelectItem>
                            <SelectItem value="shorten">קיצור</SelectItem>
                            <SelectItem value="summarize">סיכום</SelectItem>
                            <SelectItem value="sources">הוספת מקורות</SelectItem>
                            <SelectItem value="speakers">זיהוי דוברים</SelectItem>
                            <SelectItem value="translate">תרגום</SelectItem>
                            <SelectItem value="tone">שינוי טון</SelectItem>
                          </SelectContent>
                        </Select>

                        <Select value={historyEngineFilter} onValueChange={(v) => setHistoryEngineFilter(v as 'all' | 'model1' | 'model2')}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="סנן לפי מנצח" /></SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="all">כל המנצחים</SelectItem>
                            <SelectItem value="model1">מנוע 1 ניצח</SelectItem>
                            <SelectItem value="model2">מנוע 2 ניצח</SelectItem>
                          </SelectContent>
                        </Select>

                        <Select value={historyDateFilter} onValueChange={(v) => setHistoryDateFilter(v as 'all' | '7d' | '30d' | '90d')}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="סנן לפי זמן" /></SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="all">כל הזמן</SelectItem>
                            <SelectItem value="7d">7 ימים אחרונים</SelectItem>
                            <SelectItem value="30d">30 ימים אחרונים</SelectItem>
                            <SelectItem value="90d">90 ימים אחרונים</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          className="h-9 rounded-md border bg-background px-3 text-xs"
                          placeholder="חיפוש במודלים/פעולה/מנצח..."
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                        />
                        <Select value={historySort} onValueChange={(v) => setHistorySort(v as 'newest' | 'oldest' | 'best_quality' | 'best_latency')}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="מיון" /></SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="newest">מיון: חדש לישן</SelectItem>
                            <SelectItem value="oldest">מיון: ישן לחדש</SelectItem>
                            <SelectItem value="best_quality">מיון: איכות גבוהה</SelectItem>
                            <SelectItem value="best_latency">מיון: מהירות גבוהה</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Button variant="outline" size="sm" onClick={exportAllHistoryJson}>
                          ייצוא כל ההיסטוריה JSON
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportAllHistoryCsv}>
                          ייצוא כל ההיסטוריה CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={clearBenchmarkHistory}>
                          נקה היסטוריה
                        </Button>
                      </div>

                      {leaderboard.length > 0 && (
                        <div className="rounded-md border p-2 bg-muted/10 space-y-1">
                          <div className="text-[11px] font-medium">Leaderboard מנועים (לפי פילטרים)</div>
                          {leaderboard.map((row, idx) => (
                            <div key={`${row.label}-${idx}`} className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground">
                              <span className="font-medium text-foreground col-span-2 truncate">{idx + 1}. {row.label}</span>
                              <span>Win% {row.winRate.toFixed(1)}</span>
                              <span>Q {row.avgQuality.toFixed(1)}</span>
                              <span>L {row.avgLatency.toFixed(0)}ms</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {historyChartData.length > 1 && (
                        <div className="rounded-md border p-2 bg-muted/20 space-y-1">
                          <div className="text-[11px] font-medium">מגמות 10 ריצות אחרונות (איכות ומהירות)</div>
                          <svg viewBox="0 0 100 100" className="w-full h-24">
                            <polyline points={qualityPoints} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
                            <polyline points={latencyPoints} fill="none" stroke="hsl(var(--destructive))" strokeWidth="2" />
                          </svg>
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> איכות (גבוה=טוב)</span>
                            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> מהירות (נמוך=טוב)</span>
                          </div>
                        </div>
                      )}

                      {sortedFilteredHistory.slice(0, 8).map((h, idx) => (
                        <div key={`${h.createdAt}-${idx}`} className="flex items-center justify-between gap-2 text-muted-foreground">
                          <span>{new Date(h.createdAt).toLocaleString('he-IL')} • {ACTION_LABELS[h.action]} • {h.rounds} סבבים</span>
                          <span>מנצח: {h.winner === 1 ? h.model1Label : h.model2Label}</span>
                          <Button size="sm" variant="outline" onClick={() => restoreBenchmarkRun(h)}>
                            שחזר ריצה
                          </Button>
                        </div>
                      ))}
                      {sortedFilteredHistory.length === 0 && (
                        <div className="text-[11px] text-muted-foreground">אין נתונים עבור הפילטרים הנוכחיים</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Engine comparison panels — call as functions (not <EnginePanel/>) so React doesn't remount on every parent re-render and close open Selects */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EnginePanel({
          num: 1,
          modelValue: model1,
          setModelValue: setModel1,
          isEditingState: isEditing1,
          result: result1,
          onApply: () => onTextChange(result1, `ai-${lastAction || 'improve'}`, `${getModelLabel(model1)}`),
          onSave: () => onSaveVersion?.(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve'),
          onSaveReplace: () => onSaveAndReplaceOriginal?.(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve'),
          onDuplicateSave: () => onDuplicateAndSave?.(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve'),
        })}
        {EnginePanel({
          num: 2,
          modelValue: model2,
          setModelValue: setModel2,
          isEditingState: isEditing2,
          result: result2,
          onApply: () => onTextChange(result2, `ai-${lastAction || 'improve'}`, `${getModelLabel(model2)}`),
          onSave: () => onSaveVersion?.(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve'),
          onSaveReplace: () => onSaveAndReplaceOriginal?.(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve'),
          onDuplicateSave: () => onDuplicateAndSave?.(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve'),
        })}
      </div>

      {/* Diff Highlight Toggle + Save Both + Auto-Compare */}
      {(result1 || result2) && !isEditing1 && !isEditing2 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/30 border">
          <Button
            variant={showDiffHighlight ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDiffHighlight(v => !v)}
            title="הצג/הסתר סימון שינויים"
          >
            {showDiffHighlight ? <EyeOff className="w-3 h-3 ml-1" /> : <Eye className="w-3 h-3 ml-1" />}
            {showDiffHighlight ? 'הסתר שינויים' : 'סמן שינויים'}
          </Button>

          {onSaveVersion && result1 && result2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onSaveVersion(text, 'original', 'מקור', 'טקסט מקורי');
                onSaveVersion(result1, `ai-${lastAction || 'improve'}`, getModelLabel(model1), lastAction || 'improve');
                onSaveVersion(result2, `ai-${lastAction || 'improve'}`, getModelLabel(model2), lastAction || 'improve');
                toast({ title: 'נשמרו 3 גרסאות', description: 'מקורי + מנוע 1 + מנוע 2' });
              }}
            >
              <Download className="w-3 h-3 ml-1" />
              שמור מקורי + שתי גרסאות
            </Button>
          )}
        </div>
      )}

      {/* Auto-Compare Summary - shown when both results are ready */}
      {autoCompare && result1 && result2 && !isEditing1 && !isEditing2 && metrics1 && metrics2 && (
        <div className="mt-3 border rounded-lg p-4 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitCompareArrows className="w-4 h-4 text-primary" />
              <Label className="text-sm font-semibold">השוואה אוטומטית</Label>
            </div>
            <Badge variant={winner === 1 ? "default" : "secondary"} className="text-xs">
              <Trophy className="w-3 h-3 ml-1" />
              מנצח: {winner === 1 ? getModelLabel(model1) : getModelLabel(model2)}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className={`rounded-md border p-2 ${winner === 1 ? 'border-primary bg-primary/5' : ''}`}>
              <div className="font-semibold mb-1">{getModelLabel(model1)}</div>
              <div>מהירות: {metrics1.latencyMs}ms</div>
              <div>שימור: {(metrics1.preserveScore * 100).toFixed(0)}%</div>
              <div>עברית: {(metrics1.hebrewRatio * 100).toFixed(0)}%</div>
              <div className="font-semibold">ציון: {metrics1.qualityScore.toFixed(1)}</div>
            </div>
            <div className={`rounded-md border p-2 ${winner === 2 ? 'border-primary bg-primary/5' : ''}`}>
              <div className="font-semibold mb-1">{getModelLabel(model2)}</div>
              <div>מהירות: {metrics2.latencyMs}ms</div>
              <div>שימור: {(metrics2.preserveScore * 100).toFixed(0)}%</div>
              <div>עברית: {(metrics2.hebrewRatio * 100).toFixed(0)}%</div>
              <div className="font-semibold">ציון: {metrics2.qualityScore.toFixed(1)}</div>
            </div>
          </div>
        </div>
      )}

      {mergedResult && (
        <div className="mt-4 border rounded-lg p-4 space-y-3 bg-accent/5">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">גרסה משולבת (מיזוג חכם)</Label>
            <Badge variant="outline" className="text-xs">AI Merge</Badge>
          </div>
          <Textarea
            value={mergedResult}
            readOnly
            className="min-h-[220px] text-right bg-background"
            dir="rtl"
            style={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Button onClick={() => onTextChange(mergedResult, `ai-${lastAction || 'improve'}`, 'מיזוג חכם')}>
              החלף בטקסט הראשי
            </Button>
            {onSaveVersion && (
              <Button variant="outline" onClick={() => onSaveVersion(mergedResult, `ai-${lastAction || 'improve'}`, 'AI Merge', `merge-${lastAction || 'improve'}`)}>
                <Save className="w-3 h-3 ml-1" />
                שמור גרסה משולבת
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};

export const AIEditorDual = memo(AIEditorDualInner);
