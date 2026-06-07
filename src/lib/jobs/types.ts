export type JobKind = "youtube" | "convert" | "cut" | "transcribe";
export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type JobStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled"
  | "paused";

export interface JobStage {
  key: string;
  label: string;
  status: StageStatus;
  percent: number;
  weight: number;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  /** Path inside `pipeline-artifacts` bucket (user_id/job_id/stage_key/file) */
  artifact_path?: string | null;
  /** Free-form per-stage metadata for resume */
  meta?: Record<string, unknown> | null;
}

export interface JobRecord {
  id: string;
  user_id: string;
  job_kind: JobKind;
  url: string; // for youtube; for others can be source filename
  title: string | null;
  video_title: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  mode: string;
  status: JobStatus | string;
  progress_pct: number;
  overall_percent: number;
  stages: JobStage[];
  current_stage: string | null;
  resume_token: Record<string, unknown> | null;
  backend: string | null;
  output_files: Array<{ kind: string; url: string; filename: string; size?: number }>;
  transcript_id: string | null;
  error: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export const STAGE_TEMPLATES: Record<JobKind, JobStage[]> = {
  youtube: [
    { key: "probe", label: "בדיקת קישור", status: "pending", percent: 0, weight: 5 },
    { key: "download", label: "הורדה", status: "pending", percent: 0, weight: 40 },
    { key: "extract_audio", label: "חילוץ אודיו", status: "pending", percent: 0, weight: 15 },
    { key: "upload_audio", label: "שמירה בענן", status: "pending", percent: 0, weight: 10 },
    { key: "transcribe", label: "תמלול", status: "pending", percent: 0, weight: 30 },
  ],
  convert: [
    { key: "probe", label: "בדיקה", status: "pending", percent: 0, weight: 10 },
    { key: "convert", label: "המרה", status: "pending", percent: 0, weight: 70 },
    { key: "upload", label: "שמירה בענן", status: "pending", percent: 0, weight: 20 },
  ],
  cut: [
    { key: "probe", label: "בדיקה", status: "pending", percent: 0, weight: 10 },
    { key: "cut", label: "חיתוך", status: "pending", percent: 0, weight: 70 },
    { key: "upload", label: "שמירה בענן", status: "pending", percent: 0, weight: 20 },
  ],
  transcribe: [
    { key: "prepare", label: "הכנה", status: "pending", percent: 0, weight: 10 },
    { key: "chunk", label: "חלוקה לחתיכות", status: "pending", percent: 0, weight: 10 },
    { key: "transcribe", label: "תמלול", status: "pending", percent: 0, weight: 70 },
    { key: "merge", label: "איחוד", status: "pending", percent: 0, weight: 10 },
  ],
};

export function computeOverall(stages: JobStage[]): number {
  const totalWeight = stages.reduce((s, st) => s + (st.weight || 0), 0) || 1;
  const sum = stages.reduce((s, st) => {
    const p = st.status === "done" || st.status === "skipped" ? 100 : st.percent || 0;
    return s + (p * (st.weight || 0)) / 100;
  }, 0);
  return Math.round((sum / totalWeight) * 100);
}
