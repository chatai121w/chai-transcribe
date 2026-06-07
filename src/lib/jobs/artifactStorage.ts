import { supabase } from "@/integrations/supabase/client";

const BUCKET = "pipeline-artifacts";

export function buildArtifactPath(userId: string, jobId: string, stageKey: string, filename: string) {
  return `${userId}/${jobId}/${stageKey}/${filename}`;
}

export async function uploadArtifact(
  userId: string,
  jobId: string,
  stageKey: string,
  filename: string,
  data: Blob | ArrayBuffer | string,
): Promise<string> {
  const path = buildArtifactPath(userId, jobId, stageKey, filename);
  const body: Blob =
    data instanceof Blob
      ? data
      : typeof data === "string"
      ? new Blob([data], { type: "application/json" })
      : new Blob([data]);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

export async function downloadArtifact(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? "no data"}`);
  return data;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(`Sign failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function deleteArtifact(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
