/**
 * Web Worker: DiffMatchPatch computation.
 * Runs character-level and line-level diffs off the main thread so large
 * transcripts never freeze the UI.
 *
 * Protocol:
 *   postMessage({ id, type: 'char' | 'line', left, right })
 *   onmessage   → { id, ok: true, diffs } | { id, ok: false, error }
 */

import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();

type Req =
  | { id: string; type: "char"; left: string; right: string }
  | { id: string; type: "line"; left: string; right: string };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, type, left, right } = e.data;
  try {
    if (type === "char") {
      const d = dmp.diff_main(left, right);
      dmp.diff_cleanupSemantic(d);
      self.postMessage({ id, ok: true, diffs: d });
    } else {
      // Line-level diff — fast and alignment-friendly
      const linesDiff = dmp.diff_linesToChars(left, right);
      const d = dmp.diff_main(linesDiff.chars1, linesDiff.chars2, false);
      dmp.diff_charsToLines(d, linesDiff.lineArray);
      self.postMessage({ id, ok: true, diffs: d });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
