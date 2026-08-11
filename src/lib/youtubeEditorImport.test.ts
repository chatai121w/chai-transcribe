import { describe, expect, it, vi } from "vitest";
import { loadYoutubeEditorPayload } from "./youtubeEditorImport";

const outputs = [
  { kind: "audio", url: "/audio", filename: "source.m4a" },
  { kind: "json", url: "/json", filename: "transcript.json" },
  { kind: "txt", url: "/txt", filename: "transcript.txt" },
];

describe("YouTube editor import", () => {
  it("loads transcript, timings and audio without navigating to download links", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/json") return new Response(JSON.stringify({
        segments: [{ text: "שלום" }, { text: "עולם" }],
        wordTimings: [{ word: "שלום", start: 0, end: 1 }],
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (url === "/audio") return new Response(new Blob(["audio"], { type: "audio/mp4" }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    const result = await loadYoutubeEditorPayload(outputs, fetcher);
    expect(result.text).toBe("שלום עולם");
    expect(result.wordTimings).toHaveLength(1);
    expect(result.audioFileName).toBe("source.m4a");
    expect(result.audioBlob.size).toBeGreaterThan(0);
  });

  it("falls back to TXT when the JSON response is invalid", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/json") return new Response("<!doctype html>", { status: 200 });
      if (url === "/txt") return new Response("תמלול חלופי", { status: 200 });
      if (url === "/audio") return new Response("audio", { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    const result = await loadYoutubeEditorPayload(outputs, fetcher);
    expect(result.text).toBe("תמלול חלופי");
    expect(result.wordTimings).toEqual([]);
  });

  it("reports a missing server file instead of opening it as a download", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/json") return new Response("missing", { status: 404 });
      if (String(input) === "/txt") return new Response("missing", { status: 404 });
      return new Response("audio", { status: 200 });
    });

    await expect(loadYoutubeEditorPayload(outputs, fetcher)).rejects.toThrow("קובץ התמלול לא נטען מהשרת (404)");
  });

  it("falls back to cloud artifacts when local YouTube files are unavailable", async () => {
    const cloudOutputs = [
      { kind: "audio", url: "http://127.0.0.1:3000/missing-audio", artifactPath: "u/j/audio/source.m4a", filename: "source.m4a" },
      { kind: "json", url: "http://127.0.0.1:3000/missing-json", artifactPath: "u/j/transcripts/transcript.json", filename: "transcript.json" },
    ];
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));
    const artifactLoader = vi.fn(async (path: string) => {
      if (path.endsWith("transcript.json")) {
        return new Blob([JSON.stringify({
          segments: [{ text: "נטען מהענן" }],
          wordTimings: [{ word: "נטען", start: 0, end: 0.4 }],
        })], { type: "application/json" });
      }
      return new Blob(["cloud-audio"], { type: "audio/mp4" });
    });

    const result = await loadYoutubeEditorPayload(cloudOutputs, fetcher, artifactLoader);
    expect(result.text).toBe("נטען מהענן");
    expect(result.audioBlob.type).toBe("audio/mp4");
    expect(artifactLoader).toHaveBeenCalledTimes(2);
  });
});
