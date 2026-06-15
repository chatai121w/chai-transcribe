/**
 * Web Worker: WAV PCM encoder.
 * Receives a mono Float32Array (transferable — zero-copy) and encodes it
 * into a 16-bit PCM WAV file off the main thread.
 *
 * Protocol (main → worker):
 *   { id: string, monoData: Float32Array, sampleRate: number }
 *
 * Protocol (worker → main):
 *   { id, ok: true,  wav: ArrayBuffer }   // wav is transferred (zero-copy)
 *   { id, ok: false, error: string }
 */

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWav(monoData: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = new Int16Array(monoData.length);
  for (let i = 0; i < monoData.length; i++) {
    const s = Math.max(-1, Math.min(1, monoData[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const wavSize = 44 + pcm.length * 2;
  const wav = new ArrayBuffer(wavSize);
  const view = new DataView(wav);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, wavSize - 8, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));

  return wav;
}

self.onmessage = (
  e: MessageEvent<{ id: string; monoData: Float32Array; sampleRate: number }>
) => {
  const { id, monoData, sampleRate } = e.data;
  try {
    const wav = encodeWav(monoData, sampleRate);
    // Transfer the ArrayBuffer — zero-copy back to main thread
    (self as unknown as Worker).postMessage({ id, ok: true, wav }, [wav]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
