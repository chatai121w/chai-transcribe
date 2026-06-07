/**
 * Tiered Audio Cut Engine — tries the fastest approach first, then falls back.
 *
 * Tier 1 — WAV byte-slice (PCM only). ~50ms for any size, zero RAM blow-up.
 * Tier 2 — ffmpeg.wasm stream-copy (-c copy -ss/-to). No re-encode, works for
 *          mp3/m4a/aac/webm/ogg/opus/flac/wav. ~2-5s for a 76MB file.
 * Tier 3 — Legacy AudioBuffer engine (`audioCutEngine.submitCutJob`). Only used
 *          when the first two paths fail or the file is unknown.
 *
 * Public API mirrors the shape used by callers: returns `CutResult[]` directly
 * (no queue) so the QuickCutDialog can show a simple list when done.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { debugLog } from "./debugLogger";
import {
  generateSegments,
  probeAudioDuration as legacyProbe,
  submitCutJob as legacySubmit,
  type CutJobConfig,
  type CutResult,
  type CutSegment,
} from "./audioCutEngine";

export type { CutJobConfig, CutResult, CutSegment } from "./audioCutEngine";
export type CutTier = "wav-slice" | "ffmpeg-copy" | "audio-buffer";

export interface TieredCutProgress {
  tier: CutTier;
  message: string;
  completed: number;
  total: number;
}

export interface TieredCutOptions {
  config: CutJobConfig;
  onProgress?: (p: TieredCutProgress) => void;
  /** When known (probed), saves a re-probe */
  knownDurationSec?: number;
}

export interface TieredCutOutcome {
  tier: CutTier;
  results: CutResult[];
  durationSec: number;
}

// ───────────────────────── helpers ──────────────────────────────────────────

function fileExt(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

function formatTag(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}m${s.toString().padStart(2, "0")}s`;
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function toResult(
  segment: CutSegment,
  file: File,
  outputBlob: Blob,
  ext: string,
): CutResult {
  const fileName = `${baseName(file)}-${formatTag(segment.startSec)}-${formatTag(segment.endSec)}.${ext}`;
  const outFile = new File([outputBlob], fileName, { type: outputBlob.type || file.type || "application/octet-stream" });
  return {
    segmentIndex: segment.index,
    file: outFile,
    label: segment.label,
    startSec: segment.startSec,
    endSec: segment.endSec,
    durationSec: segment.endSec - segment.startSec,
    sizeBytes: outFile.size,
  };
}

// ─────────────────────── TIER 1 — WAV byte-slice ────────────────────────────

interface WavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  durationSec: number;
  bytesPerSec: number;
  blockAlign: number;
}

async function parseWavHeader(file: File): Promise<WavInfo | null> {
  try {
    // Read first 4KB — enough for almost any RIFF header chain.
    const headerSize = Math.min(file.size, 4096);
    const buf = await file.slice(0, headerSize).arrayBuffer();
    const view = new DataView(buf);

    const ascii = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, off, len));

    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;

    let off = 12;
    let fmt: { sampleRate: number; numChannels: number; bitsPerSample: number } | null = null;
    let data: { offset: number; size: number } | null = null;

    while (off + 8 <= view.byteLength) {
      const chunkId = ascii(off, 4);
      const chunkSize = view.getUint32(off + 4, true);
      const payloadStart = off + 8;
      if (chunkId === "fmt ") {
        const audioFormat = view.getUint16(payloadStart, true);
        // 1 = PCM, 3 = IEEE float — both safe to byte-slice on sample boundary
        if (audioFormat !== 1 && audioFormat !== 3) return null;
        fmt = {
          numChannels: view.getUint16(payloadStart + 2, true),
          sampleRate: view.getUint32(payloadStart + 4, true),
          bitsPerSample: view.getUint16(payloadStart + 14, true),
        };
      } else if (chunkId === "data") {
        data = { offset: payloadStart, size: chunkSize };
        break;
      }
      off = payloadStart + chunkSize + (chunkSize % 2); // word-align
    }

    if (!fmt || !data) return null;
    const blockAlign = (fmt.numChannels * fmt.bitsPerSample) / 8;
    if (blockAlign <= 0) return null;
    const bytesPerSec = fmt.sampleRate * blockAlign;
    const actualDataSize = Math.min(data.size, file.size - data.offset);
    return {
      ...fmt,
      dataOffset: data.offset,
      dataSize: actualDataSize,
      bytesPerSec,
      blockAlign,
      durationSec: actualDataSize / bytesPerSec,
    };
  } catch (e) {
    debugLog.warn("TieredCut", "WAV header parse failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

function buildWavHeader(info: WavInfo, dataLen: number): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, info.bitsPerSample === 32 ? 3 : 1, true); // float vs PCM
  v.setUint16(22, info.numChannels, true);
  v.setUint32(24, info.sampleRate, true);
  v.setUint32(28, info.bytesPerSec, true);
  v.setUint16(32, info.blockAlign, true);
  v.setUint16(34, info.bitsPerSample, true);
  writeStr(36, "data");
  v.setUint32(40, dataLen, true);
  return buf;
}

async function tierWavSlice(
  file: File,
  options: TieredCutOptions,
): Promise<TieredCutOutcome | null> {
  if (!["wav", "wave"].includes(fileExt(file.name))) return null;
  const info = await parseWavHeader(file);
  if (!info) return null;

  const segments = generateSegments(options.config, info.durationSec);
  if (segments.length === 0) throw new Error("לא נוצרו קטעים — בדוק את ההגדרות");

  options.onProgress?.({
    tier: "wav-slice",
    message: "חיתוך מהיר (WAV) — מקטעים נוצרים בייטים…",
    completed: 0,
    total: segments.length,
  });

  const results: CutResult[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startByte =
      info.dataOffset +
      Math.floor(seg.startSec * info.bytesPerSec / info.blockAlign) * info.blockAlign;
    const endByte = Math.min(
      info.dataOffset + info.dataSize,
      info.dataOffset + Math.floor(seg.endSec * info.bytesPerSec / info.blockAlign) * info.blockAlign,
    );
    const dataLen = Math.max(0, endByte - startByte);
    const header = buildWavHeader(info, dataLen);
    const dataBlob = file.slice(startByte, endByte);
    const outBlob = new Blob([header, dataBlob], { type: "audio/wav" });
    results.push(toResult(seg, file, outBlob, "wav"));
    options.onProgress?.({
      tier: "wav-slice",
      message: `חותך קטע ${i + 1} / ${segments.length}…`,
      completed: i + 1,
      total: segments.length,
    });
  }

  return { tier: "wav-slice", results, durationSec: info.durationSec };
}

// ─────────────────────── TIER 2 — ffmpeg stream-copy ────────────────────────

let ffmpegSinglePromise: Promise<FFmpeg> | null = null;
let ffmpegInUse = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegSinglePromise) {
    ffmpegSinglePromise = (async () => {
      const ffmpeg = new FFmpeg();
      const cdns = [
        "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd",
        "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd",
        "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd",
      ];
      let lastErr: unknown = null;
      for (const cdn of cdns) {
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${cdn}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${cdn}/ffmpeg-core.wasm`, "application/wasm"),
          });
          debugLog.info("TieredCut", `FFmpeg loaded from ${cdn}`);
          return ffmpeg;
        } catch (e) {
          lastErr = e;
          debugLog.warn("TieredCut", `FFmpeg load failed from ${cdn}`, e instanceof Error ? e.message : String(e));
        }
      }
      ffmpegSinglePromise = null; // allow retry next time
      throw new Error(`טעינת FFmpeg נכשלה מכל ה-CDNs: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    })();
  }
  return ffmpegSinglePromise;
}

const FFMPEG_COPY_EXTS = new Set([
  "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "webm", "mp4", "m4b",
]);

async function probeDurationViaFFmpeg(ffmpeg: FFmpeg, file: File, ext: string): Promise<number> {
  let captured = -1;
  const onLog = ({ message }: { message: string }) => {
    // ffmpeg prints "Duration: 00:01:23.45,"
    const m = message.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      captured = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    }
  };
  ffmpeg.on("log", onLog);
  const inName = `probe_in.${ext}`;
  await ffmpeg.writeFile(inName, await fetchFile(file));
  try {
    // -i alone prints metadata then errors out — we ignore the exit code
    await ffmpeg.exec(["-i", inName]);
  } catch { /* expected */ }
  ffmpeg.off("log", onLog);
  try { await ffmpeg.deleteFile(inName); } catch { /* */ }
  if (captured <= 0) throw new Error("לא ניתן לחלץ את אורך הקובץ");
  return captured;
}

async function tierFFmpegCopy(
  file: File,
  options: TieredCutOptions,
): Promise<TieredCutOutcome | null> {
  const ext = fileExt(file.name);
  if (!FFMPEG_COPY_EXTS.has(ext)) return null;

  // Single-instance lock — only one ffmpeg cut at a time to avoid OOM
  while (ffmpegInUse) await new Promise((r) => setTimeout(r, 200));
  ffmpegInUse = true;

  try {
    options.onProgress?.({
      tier: "ffmpeg-copy",
      message: "טוען מנוע FFmpeg…",
      completed: 0,
      total: 1,
    });

    const ffmpeg = await getFFmpeg();
    const inName = `cut_in.${ext}`;
    await ffmpeg.writeFile(inName, await fetchFile(file));

    // Always prefer ffmpeg's own probe — knownDurationSec from a browser
    // decodeAudioData can be truncated for long MP3/MP4 files.
    let duration = 0;
    try {
      duration = await probeDurationViaFFmpeg(ffmpeg, file, ext);
    } catch {
      duration = options.knownDurationSec ?? 0;
    }
    if (!duration || duration <= 0) {
      throw new Error("ffmpeg-probe-failed");
    }


    const segments = generateSegments(options.config, duration);
    if (segments.length === 0) throw new Error("לא נוצרו קטעים — בדוק את ההגדרות");

    options.onProgress?.({
      tier: "ffmpeg-copy",
      message: `חיתוך FFmpeg — ${segments.length} מקטעים…`,
      completed: 0,
      total: segments.length,
    });

    const results: CutResult[] = [];
    const outExt = ext === "mp4" ? "m4a" : ext;
    const mime =
      outExt === "mp3" ? "audio/mpeg" :
      outExt === "m4a" || outExt === "aac" ? "audio/mp4" :
      outExt === "wav" ? "audio/wav" :
      outExt === "webm" ? "audio/webm" :
      outExt === "ogg" || outExt === "opus" ? "audio/ogg" :
      outExt === "flac" ? "audio/flac" :
      "application/octet-stream";

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const outName = `cut_out_${i}.${outExt}`;
      const args = [
        "-y",
        "-ss", String(seg.startSec.toFixed(3)),
        "-to", String(seg.endSec.toFixed(3)),
        "-i", inName,
        "-c", "copy",
        "-vn",
        outName,
      ];
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outName);
      const u8 = data as Uint8Array;
      const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: mime });
      try { await ffmpeg.deleteFile(outName); } catch { /* */ }
      results.push(toResult(seg, file, blob, outExt));
      options.onProgress?.({
        tier: "ffmpeg-copy",
        message: `קטע ${i + 1} / ${segments.length} נחתך`,
        completed: i + 1,
        total: segments.length,
      });
    }

    try { await ffmpeg.deleteFile(inName); } catch { /* */ }
    return { tier: "ffmpeg-copy", results, durationSec: duration };
  } finally {
    ffmpegInUse = false;
  }
}

// ─────────────────────── TIER 3 — legacy AudioBuffer ────────────────────────

async function tierAudioBuffer(
  file: File,
  options: TieredCutOptions,
): Promise<TieredCutOutcome> {
  options.onProgress?.({
    tier: "audio-buffer",
    message: "חוזר למנוע מלא (פיענוח שלם)…",
    completed: 0,
    total: 1,
  });

  const job = legacySubmit(file, options.config);
  const { onCutJobUpdate } = await import("./audioCutEngine");

  return await new Promise<TieredCutOutcome>((resolve, reject) => {
    const unsub = onCutJobUpdate((upd) => {
      if (upd.id !== job.id) return;
      options.onProgress?.({
        tier: "audio-buffer",
        message: upd.status === "decoding" ? "מפענח אודיו…" : `מקטעים: ${upd.completedSegments} / ${upd.totalSegments}`,
        completed: upd.completedSegments,
        total: Math.max(1, upd.totalSegments),
      });
      if (upd.status === "done") {
        unsub();
        resolve({ tier: "audio-buffer", results: upd.results, durationSec: upd.durationSec ?? 0 });
      } else if (upd.status === "error") {
        unsub();
        reject(new Error(upd.error || "שגיאת חיתוך"));
      }
    });
  });
}

// ───────────────────────────── public entry ─────────────────────────────────

/**
 * Fast, accurate duration probe via HTMLMediaElement metadata.
 * Works for almost any browser-playable audio/video without full decode,
 * and unlike `decodeAudioData` it does NOT silently truncate long files.
 */
function probeDurationViaMediaElement(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video") || /\.(mp4|mkv|mov|webm|avi)$/i.test(file.name);
    const el = document.createElement(isVideo ? "video" : "audio") as HTMLMediaElement;
    el.preload = "metadata";
    let done = false;
    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      try { el.removeAttribute("src"); el.load(); } catch { /* */ }
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    el.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      const d = el.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    });
    el.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(null);
    });
    el.src = url;
  });
}

/** Best-effort duration probe — WAV header → MediaElement → legacy decode. */
export async function probeDurationFast(file: File): Promise<number | null> {
  try {
    if (["wav", "wave"].includes(fileExt(file.name))) {
      const info = await parseWavHeader(file);
      if (info) return info.durationSec;
    }
  } catch { /* */ }
  try {
    const d = await probeDurationViaMediaElement(file);
    if (d && d > 0) return d;
  } catch { /* */ }
  try {
    return await legacyProbe(file);
  } catch {
    return null;
  }
}

/**
 * Cut a file using the fastest viable tier, falling back automatically.
 * Throws only if every tier fails.
 */
export async function cutWithFallback(
  file: File,
  options: TieredCutOptions,
): Promise<TieredCutOutcome> {
  const errors: string[] = [];
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  console.info(`%c[TieredCut]%c Starting cut: ${file.name} (${sizeMB}MB, ext=${fileExt(file.name)})`, "color:#eab308;font-weight:bold", "color:inherit");

  // Tier 1 — WAV byte-slice
  try {
    const out = await tierWavSlice(file, options);
    if (out) {
      console.info(`%c[TieredCut]%c ✅ Tier 1 (WAV byte-slice) succeeded — ${out.results.length} segments`, "color:#22c55e;font-weight:bold", "color:inherit");
      return out;
    }
    console.info(`%c[TieredCut]%c ⏭️ Tier 1 skipped (not a WAV file)`, "color:#94a3b8", "color:inherit");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`WAV: ${msg}`);
    console.warn(`%c[TieredCut]%c ❌ Tier 1 (WAV) failed: ${msg}`, "color:#ef4444;font-weight:bold", "color:inherit");
    debugLog.warn("TieredCut", "Tier 1 failed", msg);
  }

  // Tier 2 — ffmpeg stream copy
  try {
    const out = await tierFFmpegCopy(file, options);
    if (out) {
      console.info(`%c[TieredCut]%c ✅ Tier 2 (FFmpeg -c copy) succeeded — ${out.results.length} segments, original codec preserved`, "color:#22c55e;font-weight:bold", "color:inherit");
      return out;
    }
    console.info(`%c[TieredCut]%c ⏭️ Tier 2 skipped (extension not supported by FFmpeg copy)`, "color:#94a3b8", "color:inherit");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`FFmpeg: ${msg}`);
    console.warn(`%c[TieredCut]%c ❌ Tier 2 (FFmpeg) failed — THIS is why output became WAV. Reason: ${msg}`, "color:#ef4444;font-weight:bold", "color:inherit");
    debugLog.warn("TieredCut", "Tier 2 failed", msg);
  }

  // Tier 3 — legacy full decode (skip for large non-WAV to prevent OOM crash)
  const LARGE_FILE_LIMIT = 25 * 1024 * 1024; // 25MB
  if (file.size > LARGE_FILE_LIMIT && !["wav", "wave"].includes(fileExt(file.name))) {
    console.error(`%c[TieredCut]%c 🛑 Aborting — file too large for Tier 3 fallback`, "color:#ef4444;font-weight:bold", "color:inherit");
    throw new Error(
      `לא ניתן לחתוך את הקובץ — מנוע FFmpeg לא נטען (${errors.join(" | ")}). ` +
      `הקובץ גדול מדי (${sizeMB}MB) לפענוח מלא בדפדפן. ` +
      `נסה לרענן את הדף או בדוק חיבור אינטרנט (נדרש לטעינת FFmpeg).`,
    );
  }

  console.warn(`%c[TieredCut]%c ⚠️ Falling back to Tier 3 (AudioBuffer → WAV re-encode). Output will be LARGE uncompressed WAV.`, "color:#f59e0b;font-weight:bold", "color:inherit");
  try {
    const out = await tierAudioBuffer(file, options);
    console.info(`%c[TieredCut]%c ✅ Tier 3 (AudioBuffer/WAV) succeeded — ${out.results.length} WAV segments`, "color:#22c55e;font-weight:bold", "color:inherit");
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`AudioBuffer: ${msg}`);
    throw new Error(`כל מנועי החיתוך נכשלו: ${errors.join(" | ")}`);
  }
}
