/**
 * Personal Gemini API helper.
 * When user enables "use personal Gemini" toggle and provides their own key,
 * we call Google Generative Language API directly instead of Lovable AI Gateway.
 *
 * Key formats supported:
 *  - Google AI Studio keys: "AIza..." (classic) or "AQ.Ab8..." (new format)
 *
 * Features:
 *  - Global toggle: routes ALL client-side AI text calls through personal key.
 *  - Model selector: choose which Gemini variant to use (Flash / Pro / etc.).
 *  - Auto-fallback: if the personal key errors (quota, 429, 401/403), the caller
 *    can catch PersonalGeminiExhaustedError and fall back to Lovable Gateway.
 */

const LS_KEY = "gemini_api_key";
const LS_ENABLED = "use_personal_gemini";
const LS_MODEL = "personal_gemini_model";
const LS_FALLBACK = "personal_gemini_fallback"; // "1" = fall back to Lovable on error
const LS_EXHAUSTED_UNTIL = "personal_gemini_exhausted_until"; // epoch ms
const LS_USAGE = "personal_gemini_usage"; // JSON usage counters (personal key path only)
const LS_LOVABLE_USAGE = "lovable_gemini_usage"; // JSON usage counters (Lovable AI Gateway path)

// ── Usage tracking ───────────────────────────────────────────────
export type UsageSurface = "transcription" | "editing" | "summary" | "other";

export const SURFACE_LABELS: Record<UsageSurface, string> = {
  transcription: "תמלול",
  editing: "עריכה עם AI",
  summary: "סיכום",
  other: "אחר",
};

interface UsageBucket {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PersonalGeminiUsage extends UsageBucket {
  byModel: Record<string, UsageBucket>;
  bySurface: Partial<Record<UsageSurface, UsageBucket>>;
  bySurfaceModel: Partial<Record<UsageSurface, Record<string, UsageBucket>>>;
  lastUsedAt: number | null;
  since: number;
}

const EMPTY_USAGE: PersonalGeminiUsage = {
  calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
  byModel: {}, bySurface: {}, bySurfaceModel: {},
  lastUsedAt: null, since: Date.now(),
};

const emptyBucket = (): UsageBucket => ({ calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

function readUsage(lsKey: string): PersonalGeminiUsage {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return { ...EMPTY_USAGE, byModel: {}, bySurface: {}, bySurfaceModel: {} };
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_USAGE,
      ...parsed,
      byModel: parsed.byModel || {},
      bySurface: parsed.bySurface || {},
      bySurfaceModel: parsed.bySurfaceModel || {},
    };
  } catch { return { ...EMPTY_USAGE, byModel: {}, bySurface: {}, bySurfaceModel: {} }; }
}

function writeUsage(lsKey: string, evt: string, usage: PersonalGeminiUsage) {
  try {
    localStorage.setItem(lsKey, JSON.stringify(usage));
    window.dispatchEvent(new CustomEvent(evt));
  } catch { /* noop */ }
}

function addToBucket(b: UsageBucket, prompt: number, completion: number) {
  b.calls += 1;
  b.promptTokens += prompt;
  b.completionTokens += completion;
  b.totalTokens += prompt + completion;
}

function bumpUsage(lsKey: string, evt: string, model: string, prompt: number, completion: number, surface: UsageSurface) {
  const u = readUsage(lsKey);
  addToBucket(u, prompt, completion);
  u.lastUsedAt = Date.now();

  const m = u.byModel[model] || emptyBucket();
  addToBucket(m, prompt, completion);
  u.byModel[model] = m;

  const s = u.bySurface[surface] || emptyBucket();
  addToBucket(s, prompt, completion);
  u.bySurface[surface] = s;

  const smMap = u.bySurfaceModel[surface] || {};
  const sm = smMap[model] || emptyBucket();
  addToBucket(sm, prompt, completion);
  smMap[model] = sm;
  u.bySurfaceModel[surface] = smMap;

  if (!u.since) u.since = Date.now();
  writeUsage(lsKey, evt, u);
}

// Personal-key path (billed by Google, USD)
export function getPersonalGeminiUsage(): PersonalGeminiUsage { return readUsage(LS_USAGE); }
export function resetPersonalGeminiUsage() {
  writeUsage(LS_USAGE, "personal-gemini-usage", { ...EMPTY_USAGE, byModel: {}, bySurface: {}, bySurfaceModel: {}, since: Date.now() });
}
export function recordPersonalGeminiUsage(model: string, prompt: number, completion: number, surface: UsageSurface = "other") {
  bumpUsage(LS_USAGE, "personal-gemini-usage", model, prompt, completion, surface);
}

// Lovable AI Gateway path (billed in Lovable credits, no direct USD)
export function getLovableGatewayUsage(): PersonalGeminiUsage { return readUsage(LS_LOVABLE_USAGE); }
export function resetLovableGatewayUsage() {
  writeUsage(LS_LOVABLE_USAGE, "lovable-gemini-usage", { ...EMPTY_USAGE, byModel: {}, bySurface: {}, bySurfaceModel: {}, since: Date.now() });
}
export function recordLovableGatewayUsage(model: string, prompt = 0, completion = 0, surface: UsageSurface = "other") {
  bumpUsage(LS_LOVABLE_USAGE, "lovable-gemini-usage", model, prompt, completion, surface);
}


/** True for any Gemini model identifier (google/gemini-…, gemini-…). */
export function isGeminiModel(model?: string | null): boolean {
  if (!model) return false;
  return /gemini/i.test(model);
}


// Google's personal Generative Language API uses alias names.
// gemini-2.5-flash/pro are blocked for NEW users ("no longer available to new users")
// so we default to the "-latest" aliases which always route to the current stable model.
export const PERSONAL_GEMINI_MODELS: Array<{ id: string; label: string; note?: string }> = [
  { id: "gemini-flash-latest", label: "Gemini Flash (Latest)", note: "מהיר וזול, נתמך תמיד (מומלץ)" },
  { id: "gemini-pro-latest", label: "Gemini Pro (Latest)", note: "איכות גבוהה, נתמך תמיד" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "רק למשתמשים ותיקים - עלול להחזיר 404" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "רק למשתמשים ותיקים - עלול להחזיר 404" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", note: "הכי זול, לפעולות פשוטות" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "יציב, זמין לכולם" },
];

/** Map stored model IDs blocked for new users to a supported alias. */
export function resolvePersonalGeminiModel(id: string): string {
  const s = (id || "").replace(/^google\//, "").trim();
  if (s === "gemini-2.5-flash") return "gemini-flash-latest";
  if (s === "gemini-2.5-pro") return "gemini-pro-latest";
  if (s === "gemini-1.5-pro" || s === "gemini-1.5-flash") return "gemini-pro-latest";
  return s || "gemini-flash-latest";
}

export class PersonalGeminiExhaustedError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PersonalGeminiExhaustedError";
    this.status = status;
  }
}

export function getPersonalGeminiKey(): string {
  try { return (localStorage.getItem(LS_KEY) || "").trim(); } catch { return ""; }
}

export function setPersonalGeminiKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(LS_KEY, key.trim());
    else localStorage.removeItem(LS_KEY);
  } catch { /* noop */ }
}

export function isPersonalGeminiEnabled(): boolean {
  try {
    if (localStorage.getItem(LS_ENABLED) !== "1") return false;
    if (!getPersonalGeminiKey()) return false;
    // Respect cooldown after we hit a quota error
    const until = parseInt(localStorage.getItem(LS_EXHAUSTED_UNTIL) || "0", 10);
    if (until && Date.now() < until) return false;
    return true;
  } catch { return false; }
}

export function setPersonalGeminiEnabled(enabled: boolean) {
  try {
    localStorage.setItem(LS_ENABLED, enabled ? "1" : "0");
    if (enabled) localStorage.removeItem(LS_EXHAUSTED_UNTIL);
  } catch { /* noop */ }
}

export function getPersonalGeminiModel(): string {
  try {
    const stored = localStorage.getItem(LS_MODEL) || "gemini-flash-latest";
    return resolvePersonalGeminiModel(stored);
  } catch { return "gemini-flash-latest"; }
}

export function setPersonalGeminiModel(model: string) {
  try { localStorage.setItem(LS_MODEL, resolvePersonalGeminiModel(model)); } catch { /* noop */ }
}

export function isPersonalGeminiFallbackEnabled(): boolean {
  try { return localStorage.getItem(LS_FALLBACK) !== "0"; } // default ON
  catch { return true; }
}

export function setPersonalGeminiFallbackEnabled(enabled: boolean) {
  try { localStorage.setItem(LS_FALLBACK, enabled ? "1" : "0"); } catch { /* noop */ }
}

/** Mark the personal key as exhausted (cooldown 1 hour). */
export function markPersonalGeminiExhausted(minutes = 60) {
  try {
    localStorage.setItem(LS_EXHAUSTED_UNTIL, String(Date.now() + minutes * 60_000));
    window.dispatchEvent(new CustomEvent("personal-gemini-exhausted"));
  } catch { /* noop */ }
}

/** Map an internal model id to Google's REST model name (and auto-upgrade blocked names). */
export function normalizeGeminiModel(model?: string): string {
  if (!model) return getPersonalGeminiModel();
  return resolvePersonalGeminiModel(model);
}

/**
 * Call Google's Generative Language API directly with the user's key.
 * Throws PersonalGeminiExhaustedError on quota / auth failures so callers can fall back.
 */
export async function callPersonalGemini(params: {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  surface?: UsageSurface;
}): Promise<string> {

  const key = getPersonalGeminiKey();
  if (!key) throw new PersonalGeminiExhaustedError("לא נמצא מפתח Gemini פרטי");

  const model = normalizeGeminiModel(params.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
    generationConfig: { temperature: params.temperature ?? 0.3 },
  };
  if (params.systemPrompt) {
    body.systemInstruction = { role: "system", parts: [{ text: params.systemPrompt }] };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // network — treat as transient, do NOT mark exhausted
    throw new Error(`Gemini network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // 404 "no longer available to new users" → retry once with the latest-alias
    if (res.status === 404 && /no longer available|not found/i.test(errText)) {
      const fallbackModel = model.includes("pro") ? "gemini-pro-latest" : "gemini-flash-latest";
      if (fallbackModel !== model) {
        try { setPersonalGeminiModel(fallbackModel); } catch { /* noop */ }
        return callPersonalGemini({ ...params, model: fallbackModel });
      }
    }
    // Quota / auth → mark exhausted so callers fall back and future calls skip us
    if (res.status === 429 || res.status === 403 || res.status === 401 ||
        /quota|exhausted|billing|RESOURCE_EXHAUSTED/i.test(errText)) {
      markPersonalGeminiExhausted(60);
      throw new PersonalGeminiExhaustedError(
        `Gemini האישי מוצה (${res.status}). עוברים ל-Lovable AI.`,
        res.status,
      );
    }
    throw new Error(`Gemini API שגיאה (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  if (!text) throw new Error("לא התקבל טקסט מ-Gemini");

  // Record usage (best-effort — Google returns usageMetadata on success)
  const usage = data?.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  const promptTok = usage?.promptTokenCount ?? 0;
  const completionTok = usage?.candidatesTokenCount ?? Math.max(0, (usage?.totalTokenCount ?? 0) - promptTok);
  recordPersonalGeminiUsage(model, promptTok, completionTok, params.surface ?? "other");

  return text.trim();
}

