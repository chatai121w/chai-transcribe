import { fetchLocalServer } from "@/lib/serverConfig";
import { downloadArtifact } from "@/lib/jobs/artifactStorage";

export interface YoutubeOutputFile {
  kind?: string;
  url?: string;
  filename?: string;
  artifactPath?: string;
}

export interface YoutubeEditorPayload {
  text: string;
  audioBlob: Blob;
  audioFileName: string;
  wordTimings: Array<{ word: string; start: number; end: number; probability?: number }>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ArtifactLoader = (path: string) => Promise<Blob>;

async function fetchRequired(fetcher: Fetcher, url: string, label: string): Promise<Response> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label} לא נטען מהשרת (${response.status})`);
  return response;
}

async function loadOutputBlob(
  file: YoutubeOutputFile,
  fetcher: Fetcher,
  artifactLoader: ArtifactLoader,
  label: string,
): Promise<Blob> {
  if (file.url) {
    try {
      return await (await fetchRequired(fetcher, file.url, label)).blob();
    } catch (error) {
      if (!file.artifactPath) throw error;
    }
  }
  if (file.artifactPath) return artifactLoader(file.artifactPath);
  throw new Error(`${label} אינו זמין מקומית או בענן`);
}

export async function loadYoutubeEditorPayload(
  outputs: YoutubeOutputFile[],
  fetcher: Fetcher = fetchLocalServer,
  artifactLoader: ArtifactLoader = downloadArtifact,
): Promise<YoutubeEditorPayload> {
  const audio = outputs.find((file) => file.kind === "audio");
  const json = outputs.find((file) => file.kind === "json");
  const txt = outputs.find((file) => file.kind === "txt");
  if ((!audio?.url && !audio?.artifactPath) || (
    !json?.url && !json?.artifactPath && !txt?.url && !txt?.artifactPath
  )) {
    throw new Error("צריך קובץ אודיו וקובץ תמלול כדי לפתוח בעורך");
  }

  let text = "";
  let wordTimings: YoutubeEditorPayload["wordTimings"] = [];
  let jsonError: Error | null = null;

  if (json?.url || json?.artifactPath) {
    try {
      const raw = await (await loadOutputBlob(json, fetcher, artifactLoader, "קובץ התזמונים")).text();
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

  if (!text.trim() && (txt?.url || txt?.artifactPath)) {
    text = await (await loadOutputBlob(txt, fetcher, artifactLoader, "קובץ התמלול")).text();
  }
  if (!text.trim()) {
    throw jsonError ?? new Error("התמלול שהתקבל ריק");
  }

  const audioBlob = await loadOutputBlob(audio, fetcher, artifactLoader, "קובץ האודיו");
  if (!audioBlob.size) throw new Error("קובץ האודיו שהתקבל ריק");

  return {
    text,
    audioBlob,
    audioFileName: audio.filename || "youtube-audio",
    wordTimings,
  };
}
