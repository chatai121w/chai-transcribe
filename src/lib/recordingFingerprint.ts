/**
 * Recording fingerprint — content-based identity for an audio file.
 *
 * Goal: if the user uploads the same recording with a different filename
 * (e.g. "shiur.mp3" vs "shiur (1).mp3" vs "lecture_final.mp3"), we still
 * recognise it as the same recording for trend tracking.
 *
 * Strategy:
 *  - SHA-256 over the first ~256KB of raw bytes (covers ~30s for typical MP3)
 *    plus the file size. This is stable across renames and cheap to compute.
 *  - Returns a short, URL-safe 16-char hex prefix (collision-safe for a
 *    single-user library of thousands of recordings).
 */

const SAMPLE_BYTES = 256 * 1024; // 256KB head — ~30s at 64kbps

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Fingerprint a File / Blob (browser). Returns a 16-char hex id. */
export async function fingerprintFile(file: Blob | File): Promise<string> {
  const size = file.size;
  const head = await file.slice(0, Math.min(SAMPLE_BYTES, size)).arrayBuffer();
  // Mix size into the hash so two files with identical heads but different
  // lengths still differ.
  const sizeBuf = new TextEncoder().encode(`|len=${size}`);
  const merged = new Uint8Array(head.byteLength + sizeBuf.byteLength);
  merged.set(new Uint8Array(head), 0);
  merged.set(sizeBuf, head.byteLength);
  const hex = await sha256Hex(merged.buffer);
  return hex.slice(0, 16);
}

/** Fingerprint from an ArrayBuffer (already-decoded audio). */
export async function fingerprintBuffer(buf: ArrayBuffer): Promise<string> {
  const head = buf.byteLength > SAMPLE_BYTES ? buf.slice(0, SAMPLE_BYTES) : buf;
  const sizeBuf = new TextEncoder().encode(`|len=${buf.byteLength}`);
  const merged = new Uint8Array(head.byteLength + sizeBuf.byteLength);
  merged.set(new Uint8Array(head), 0);
  merged.set(sizeBuf, head.byteLength);
  const hex = await sha256Hex(merged.buffer);
  return hex.slice(0, 16);
}

/** Fingerprint from any string identifier (fallback when no audio bytes). */
export async function fingerprintFromString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hex = await sha256Hex(buf.buffer);
  return hex.slice(0, 16);
}
