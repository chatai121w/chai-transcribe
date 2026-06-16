import Dexie, { type Table } from 'dexie';

// ─── Interfaces ──────────────────────────────────────────────────
export interface LocalTranscript {
  id: string;
  user_id: string;
  text: string;
  engine: string;
  tags: string[];
  notes: string;
  title: string;
  folder: string;
  category: string;
  is_favorite: boolean;
  audio_file_path: string | null;
  /** Word-level timings for audio-sync player [{word, start, end, probability?}] */
  word_timings?: Array<{word: string; start: number; end: number; probability?: number}> | null;
  /** User-edited text (original kept in `text`) */
  edited_text?: string | null;
  created_at: string;
  updated_at: string;
  /** Audio blob cached locally for offline use */
  audio_blob?: Blob;
  /** Tracks if this record needs to be pushed to cloud */
  _dirty?: boolean;
  /** Tracks if this record was deleted locally and needs cloud delete */
  _deleted?: boolean;
}

export interface LocalPreferences {
  id: string; // always 'current' for singleton
  user_id: string;
  font_size: number;
  font_family: string;
  text_color: string;
  line_height: number;
  sidebar_pinned: boolean;
  theme: string;
  engine: string;
  source_language: string;
  custom_themes: string;
  editor_columns: number;
  cuda_preset: string;
  cuda_fast_mode: boolean;
  cuda_compute_type: string;
  cuda_beam_size: number;
  cuda_no_condition_prev: boolean;
  cuda_vad_aggressive: boolean;
  cuda_hotwords: string;
  cuda_paragraph_threshold: number;
  cuda_preload_mode: string;
  cuda_cloud_save: string;
  personal_pronunciation_enabled: boolean;
  updated_at: string;
  _dirty?: boolean;
}

export interface LocalApiKeys {
  id: string; // always 'current' for singleton
  user_identifier: string;
  openai_key: string;
  google_key: string;
  groq_key: string;
  claude_key: string;
  assemblyai_key: string;
  deepgram_key: string;
  huggingface_key?: string;
  whisper_server_url?: string;
  whisper_api_key?: string;
  ollama_base_url?: string;
  openai_keys_pool?: string[];
  google_keys_pool?: string[];
  groq_keys_pool?: string[];
  assemblyai_keys_pool?: string[];
  deepgram_keys_pool?: string[];
  updated_at: string;
  _dirty?: boolean;
}

export interface LocalTranscriptionJob {
  id: string;
  user_id: string;
  status: string;
  engine: string;
  file_name: string | null;
  file_path: string | null;
  language: string | null;
  result_text: string | null;
  error_message: string | null;
  progress: number | null;
  partial_result: string | null;
  total_chunks: number | null;
  completed_chunks: number | null;
  created_at: string;
  updated_at: string;
}

export interface SyncMeta {
  id: string; // table name
  last_synced_at: string;
  last_cloud_updated_at: string;
}

export interface LocalVersion {
  id: string;
  transcript_id: string;
  user_id: string;
  text: string;
  source: string;
  engine_label?: string | null;
  action_label?: string | null;
  version_number: number;
  created_at: string;
  ai_usage_event_id?: string | null;
  folder_id?: string | null;
  audio_file_path?: string | null;
  _dirty?: boolean;
}

export interface LocalAudioBlob {
  /** Unique key, e.g. 'last_audio' */
  id: string;
  blob: Blob;
  type: string;
  name: string;
  saved_at: number; // Date.now()
}

// ─── Database ────────────────────────────────────────────────────
class SmartTranscriberDB extends Dexie {
  transcripts!: Table<LocalTranscript, string>;
  preferences!: Table<LocalPreferences, string>;
  apiKeys!: Table<LocalApiKeys, string>;
  jobs!: Table<LocalTranscriptionJob, string>;
  syncMeta!: Table<SyncMeta, string>;
  audioBlobs!: Table<LocalAudioBlob, string>;
  versions!: Table<LocalVersion, string>;
  drivePending!: Table<PendingDriveUpload, string>;

  constructor() {
    super('SmartTranscriberDB');

    this.version(1).stores({
      transcripts: 'id, user_id, created_at, updated_at, folder, engine, is_favorite, _dirty, _deleted',
      preferences: 'id, user_id',
      apiKeys: 'id, user_identifier',
      jobs: 'id, user_id, status, created_at',
      syncMeta: 'id',
    });

    // v2: word_timings + edited_text columns (no index changes needed, stored inline)
    this.version(2).stores({});

    // v3: audioBlobs table for audio recovery (replaces raw indexedDB usage)
    this.version(3).stores({
      audioBlobs: 'id, saved_at',
    });

    // v4: transcript_versions for version history
    this.version(4).stores({
      versions: 'id, transcript_id, user_id, version_number, created_at, _dirty',
    });

    // v5: pending Drive uploads (background-sync queue)
    this.version(5).stores({
      drivePending: 'id, created_at',
    });
  }
}

// ─── Pending Drive Upload (background sync) ─────────────────────
export interface PendingDriveUpload {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string;
  text: string;
  resolution?: 'overwrite' | 'duplicate' | 'skip';
  attempts: number;
  last_error?: string;
  created_at: number;
}

export const db = new SmartTranscriberDB();

// ─── Helper: check if DB is available ────────────────────────────
let dbAvailable: boolean | null = null;

export async function isDbAvailable(): Promise<boolean> {
  if (dbAvailable !== null) return dbAvailable;
  try {
    await db.syncMeta.count();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  return dbAvailable;
}

// ─── Full-text search across local transcripts ────────────────────
export async function searchTranscripts(
  query: string,
  userId?: string
): Promise<LocalTranscript[]> {
  const q = query.toLowerCase();
  return db.transcripts
    .filter(
      t =>
        (!userId || t.user_id === userId) &&
        !t._deleted &&
        (t.text.toLowerCase().includes(q) ||
          (t.title || '').toLowerCase().includes(q) ||
          (t.notes || '').toLowerCase().includes(q))
    )
    .toArray();
}
