/// <reference lib="webworker" />
/* Heavy processing Web Worker
 * Keeps the main thread free for UI during long transcript operations.
 *
 * Tasks supported:
 *  - normalizeText: collapse whitespace, fix punctuation spacing (Hebrew safe)
 *  - chunkTextForAI: split a long text into ~N-char chunks on paragraph/sentence boundaries
 *  - mergeAdjacentSegments: merge transcript segments by same speaker / short gap
 *  - countWords: cheap stats
 *
 * Protocol: { id, task, payload } → { id, ok, result?, error? }
 */

type TaskName = 'normalizeText' | 'chunkTextForAI' | 'mergeAdjacentSegments' | 'countWords';

interface Segment {
  text: string;
  start: number;
  end: number;
  speaker?: string | null;
}

function normalizeText(input: string): string {
  if (!input) return '';
  let t = input.replace(/\r\n?/g, '\n');
  // collapse 3+ blank lines → 2
  t = t.replace(/\n{3,}/g, '\n\n');
  // trim trailing spaces on each line
  t = t.replace(/[ \t]+\n/g, '\n');
  // remove space before punctuation (Hebrew + Latin)
  t = t.replace(/\s+([.,;:!?\u05BE\u05C3])/g, '$1');
  return t.trim();
}

function chunkTextForAI(text: string, maxChars = 4000): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  const push = () => { if (buf) { chunks.push(buf); buf = ''; } };
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > maxChars) {
      push();
      if (p.length > maxChars) {
        // split by sentence
        const sentences = p.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          if ((buf + ' ' + s).length > maxChars) {
            push();
            buf = s;
          } else {
            buf = buf ? buf + ' ' + s : s;
          }
        }
      } else {
        buf = p;
      }
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  push();
  return chunks;
}

function mergeAdjacentSegments(segments: Segment[], maxGap = 0.8): Segment[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const out: Segment[] = [{ ...segments[0] }];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    const cur = segments[i];
    const sameSpeaker = (prev.speaker || null) === (cur.speaker || null);
    const gap = cur.start - prev.end;
    if (sameSpeaker && gap <= maxGap) {
      prev.text = (prev.text + ' ' + cur.text).replace(/\s+/g, ' ').trim();
      prev.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function countWords(text: string): { words: number; chars: number } {
  const t = (text || '').trim();
  if (!t) return { words: 0, chars: 0 };
  const words = t.split(/\s+/).length;
  return { words, chars: t.length };
}

self.addEventListener('message', (ev: MessageEvent) => {
  const { id, task, payload } = ev.data || {};
  try {
    let result: unknown;
    switch (task as TaskName) {
      case 'normalizeText':       result = normalizeText(payload?.text || ''); break;
      case 'chunkTextForAI':      result = chunkTextForAI(payload?.text || '', payload?.maxChars); break;
      case 'mergeAdjacentSegments': result = mergeAdjacentSegments(payload?.segments || [], payload?.maxGap); break;
      case 'countWords':          result = countWords(payload?.text || ''); break;
      default:
        throw new Error(`Unknown task: ${task}`);
    }
    (self as any).postMessage({ id, ok: true, result });
  } catch (e: any) {
    (self as any).postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});

export {};
