/**
 * Smart Conversion Router — decides browser (WASM) vs server FFmpeg.
 *
 * Strategy:
 * - < 100 MB        → WASM (fast locally, no upload needed)
 * - 100–500 MB      → try WASM with timeout, fallback to server
 * - > 500 MB        → server directly (WASM will OOM / take too long)
 * - server offline   → always WASM regardless of size
 */

import { getServerUrl } from "./serverConfig";
import { debugLog } from "./debugLogger";

export type ConversionPath = "browser" | "server";

const SIZE_100MB = 100 * 1024 * 1024;
const SIZE_500MB = 500 * 1024 * 1024;
const WASM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout (OPUS is slower than MP3 in WASM)

let _serverOnline: boolean | null = null;
let _lastCheck = 0;
const CHECK_INTERVAL = 30_000; // 30s cache

/** Check if the local Whisper server is reachable and has FFmpeg. */
export async function isServerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_serverOnline !== null && now - _lastCheck < CHECK_INTERVAL) {
    debugLog.info("ConversionRouter", "Using cached server availability", {
      cached: _serverOnline,
      cacheAgeMs: now - _lastCheck,
    });
    return _serverOnline;
  }
  try {
    const url = getServerUrl();
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("not ok");
    const data = await res.json();
    _serverOnline = data.ffmpeg === true || data.ffmpeg_available === true;
    _lastCheck = now;
    debugLog.info("ConversionRouter", "Server health check completed", {
      url,
      status: res.status,
      ffmpeg: data.ffmpeg,
      ffmpeg_available: data.ffmpeg_available,
      online: _serverOnline,
    });
    return _serverOnline;
  } catch (error) {
    _serverOnline = false;
    _lastCheck = now;
    debugLog.warn("ConversionRouter", "Server health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Force re-check on next call. */
export function invalidateServerCache() {
  _serverOnline = null;
  _lastCheck = 0;
}

/** Decide optimal conversion path for a given file size. */
export async function chooseConversionPath(fileSize: number): Promise<ConversionPath> {
  let chosen: ConversionPath;
  if (fileSize > SIZE_500MB) {
    const online = await isServerAvailable();
    chosen = online ? "server" : "browser"; // fallback to WASM even for large
    debugLog.info("ConversionRouter", "Path chosen for large file", {
      fileSize,
      chosen,
      threshold: "500MB",
    });
    return chosen;
  }
  if (fileSize > SIZE_100MB) {
    const online = await isServerAvailable();
    chosen = online ? "server" : "browser"; // mid-range: prefer server if available
    debugLog.info("ConversionRouter", "Path chosen for mid-size file", {
      fileSize,
      chosen,
      threshold: "100MB",
    });
    return chosen;
  }
  chosen = "browser";
  debugLog.info("ConversionRouter", "Path chosen for small file", {
    fileSize,
    chosen,
  });
  return chosen;
}

/** Get timeout for WASM conversion based on file size (for mid-range fallback). */
export function getWasmTimeout(fileSize: number): number {
  if (fileSize <= SIZE_100MB) return 0; // no timeout
  return WASM_TIMEOUT_MS;
}

// ─── Server-side conversion ──────────────────────────────────────────────────

export interface ServerConversionProgress {
  progress: number;
  done?: boolean;
  error?: string;
  file_size?: number;
  download_id?: string;
}

export type ProgressCallback = (p: ServerConversionProgress) => void;
export type ConversionOutputFormat = "mp3" | "opus" | "aac";

/**
 * Convert a file using the server-side FFmpeg endpoint.
 * Uses SSE streaming for progress, then downloads the result.
 * Returns the converted blob on success.
 */
export async function convertOnServer(
  file: File,
  outputFormat: ConversionOutputFormat,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Blob> {
  const url = getServerUrl();
  debugLog.info("ConversionRouter", "Starting server conversion", {
    fileName: file.name,
    fileSize: file.size,
    outputFormat,
    url,
  });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("output_format", outputFormat);

  // Try SSE streaming for progress
  const res = await fetch(`${url}/convert-mp3`, {
    method: "POST",
    body: formData,
    headers: { Accept: "text/event-stream" },
    signal: abortSignal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Server error" }));
    debugLog.error("ConversionRouter", "Server conversion request failed", {
      status: res.status,
      statusText: res.statusText,
      body,
    });
    throw new Error(body.error || `Server returned ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";

  // SSE streaming response
  if (contentType.includes("text/event-stream")) {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let lastProgress: ServerConversionProgress = { progress: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6)) as ServerConversionProgress;
            lastProgress = data;
            onProgress?.(data);
            if (data.progress % 20 === 0 || data.done || data.error) {
              debugLog.info("ConversionRouter", "SSE conversion progress", data);
            }
            if (data.error) throw new Error(data.error);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    }

    if (!lastProgress.done || !lastProgress.download_id) {
      debugLog.error("ConversionRouter", "SSE conversion ended without download id", {
        lastProgress,
      });
      throw new Error("Server conversion ended without completion");
    }

    // Download the converted file using the staged download_id
    const dlRes = await fetch(`${url}/convert-mp3/download/${lastProgress.download_id}`, {
      signal: abortSignal,
    });

    if (!dlRes.ok) {
      debugLog.error("ConversionRouter", "Failed to download staged conversion", {
        status: dlRes.status,
        downloadId: lastProgress.download_id,
      });
      throw new Error("Failed to download converted file");
    }
    debugLog.info("ConversionRouter", "Downloaded staged conversion", {
      downloadId: lastProgress.download_id,
      status: dlRes.status,
    });
    return await dlRes.blob();
  }

  // Direct binary response (non-SSE fallback)
  if (contentType.includes("audio/")) {
    onProgress?.({ progress: 100, done: true });
    debugLog.info("ConversionRouter", "Received direct audio response", {
      contentType,
      status: res.status,
    });
    return await res.blob();
  }

  debugLog.error("ConversionRouter", "Unexpected response content type", {
    contentType,
    status: res.status,
  });
  throw new Error("Unexpected response from server");
}
