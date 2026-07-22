/**
 * Personal Gemini API helper.
 * When user enables "use personal Gemini" toggle and provides their own key,
 * we call Google Generative Language API directly instead of Lovable AI Gateway.
 *
 * Key formats supported:
 *  - Google AI Studio keys: "AIza..." (classic) or "AQ.Ab8..." (new format)
 */

const LS_KEY = "gemini_api_key";
const LS_ENABLED = "use_personal_gemini";

export function getPersonalGeminiKey(): string {
  try {
    return (localStorage.getItem(LS_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function isPersonalGeminiEnabled(): boolean {
  try {
    return localStorage.getItem(LS_ENABLED) === "1" && !!getPersonalGeminiKey();
  } catch {
    return false;
  }
}

export function setPersonalGeminiKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(LS_KEY, key.trim());
    else localStorage.removeItem(LS_KEY);
  } catch { /* noop */ }
}

export function setPersonalGeminiEnabled(enabled: boolean) {
  try {
    localStorage.setItem(LS_ENABLED, enabled ? "1" : "0");
  } catch { /* noop */ }
}

/** Map an internal model id (e.g. "gemini-2.5-flash", "google/gemini-2.5-flash") to Google's REST model name. */
export function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-2.5-flash";
  return model.replace(/^google\//, "");
}

/**
 * Call Google's Generative Language API directly with the user's key.
 * Returns the plain text output.
 */
export async function callPersonalGemini(params: {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
}): Promise<string> {
  const key = getPersonalGeminiKey();
  if (!key) throw new Error("לא נמצא מפתח Gemini פרטי");

  const model = normalizeGeminiModel(params.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = {
    contents: [
      { role: "user", parts: [{ text: params.userPrompt }] },
    ],
    generationConfig: {
      temperature: params.temperature ?? 0.3,
    },
  };
  if (params.systemPrompt) {
    body.systemInstruction = { role: "system", parts: [{ text: params.systemPrompt }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API שגיאה (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  if (!text) throw new Error("לא התקבל טקסט מ-Gemini");
  return text.trim();
}
