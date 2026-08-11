import { fetchLocalServer } from "@/lib/serverConfig";

export interface YoutubeOutputFile {
  kind?: string;
  url?: string;
  filename?: string;
}

export interface YoutubeEditorPayload {
  text: string;
  audioBlob: Blob;
  audioFileName: string;
  wordTimings: Array<{ word: string; start: number; end: number; probability?: number }>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchRequired(fetcher: Fetcher, url: string, label: string): Promise<Response> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label} לא נטען מהשרת (${response.status})`);
  return response;
}

export async function loadYoutubeEditorPayload(
  outputs: YoutubeOutputFile[],
  fetcher: Fetcher = fetchLocalServer,
): Promise<YoutubeEditorPayload> {
  const audio = outputs.find((file) => file.kind === "audio");
  const json = outputs.find((file) => file.kind === "json");
  const txt = outputs.find((file) => file.kind === "txt");
  if (!audio?.url || (!json?.url && !txt?.url)) {
    throw new Error("צריך קובץ אודיו וקובץ תמלול כדי לפתוח בעורך");
  }

  let text = "";
  let wordTimings: YoutubeEditorPayload["wordTimings"] = [];
  let jsonError: Error | null = null;

  if (json?.url) {
    try {
      const response = await fetchRequired(fetcher, json.url, "קובץ התזמונים");
      const raw = await response.text();
      const data = JSON.parse(raw) as {
        segments?: Array<{ text?: string }>;
        wordTimings?: YoutubeEditorPayload["wordTimings"];
      };
      text = (data.segments ?? []).map((segment) => (segment.text || "").trim()).filter(Boolean).join(" ");
      wordTimings = Array.isArray(data.wordTimings) ? data.wordTimings : [];
    } catch (error) {
      jsonError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!text.trim() && txt?.url) {
    const response = await fetchRequired(fetcher, txt.url, "קובץ התמלול");
    text = await response.text();
  }
  if (!text.trim()) {
    throw jsonError ?? new Error("התמלול שהתקבל ריק");
  }

  const audioResponse = await fetchRequired(fetcher, audio.url, "קובץ האודיו");
  const audioBlob = await audioResponse.blob();
  if (!audioBlob.size) throw new Error("קובץ האודיו שהתקבל ריק");

  return {
    text,
    audioBlob,
    audioFileName: audio.filename || "youtube-audio",
    wordTimings,
  };
}
