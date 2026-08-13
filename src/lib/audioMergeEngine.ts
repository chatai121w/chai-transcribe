import { audioBufferToWav } from "./harmony-engine";
import { getServerUrl } from "./serverConfig";
import { isServerAvailable } from "./conversionRouter";

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

async function mergeInBrowser(files: File[], outputName: string): Promise<File> {
  const context = new AudioContext();
  try {
    const buffers = [] as AudioBuffer[];
    for (const file of files) {
      buffers.push(await context.decodeAudioData((await file.arrayBuffer()).slice(0)));
    }
    const sampleRate = buffers[0].sampleRate;
    const channels = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
    if (buffers.some((buffer) => buffer.sampleRate !== sampleRate)) {
      throw new Error("לקטעים קצבי דגימה שונים; נדרש שרת FFmpeg מקומי לאיחוד");
    }
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const merged = context.createBuffer(channels, totalLength, sampleRate);
    let offset = 0;
    for (const buffer of buffers) {
      for (let channel = 0; channel < channels; channel++) {
        const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        merged.copyToChannel(source, channel, offset);
      }
      offset += buffer.length;
    }
    return new File([audioBufferToWav(merged)], `${outputName}.wav`, { type: "audio/wav" });
  } finally {
    void context.close();
  }
}

export async function mergeAudioFiles(files: File[], outputName?: string): Promise<File> {
  if (files.length < 2) throw new Error("יש לבחור לפחות שני קטעים לאיחוד");
  const name = outputName?.trim() || `${baseName(files[0].name)}-מאוחד`;

  if (await isServerAvailable()) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.name));
    form.append("outputName", name);
    const response = await fetch(`${getServerUrl()}/merge-audio`, { method: "POST", body: form });
    if (response.ok) {
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
      const filename = match ? decodeURIComponent(match[1].replace(/\"/g, "")) : `${name}.m4a`;
      return new File([blob], filename, { type: blob.type || "audio/mp4" });
    }
  }

  return mergeInBrowser(files, name);
}
