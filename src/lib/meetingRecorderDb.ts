/**
 * meetingRecorderDb — IndexedDB (Dexie) storage for the Meeting Recorder.
 *
 * Two stores:
 *  - recordings : metadata + notes (small)
 *  - chunks     : raw Blob chunks written every few seconds for crash safety
 *
 * On `stop()` we assemble chunks → final Blob → store as `assembled` field on
 * the recording row, then delete the per-chunk rows. If the page crashes mid
 * recording the chunks remain and we surface a "recover" UX on next load.
 *
 * Kept separate from SmartTranscriberDB to avoid schema collisions.
 */

import Dexie, { Table } from "dexie";

export type SourceMode = "mic" | "system" | "both";
export type RecordingStatus = "recording" | "completed" | "crashed";

export interface MeetingNote {
  id: string;
  /** Position in the recording, in milliseconds (0 = start). */
  timeMs: number;
  text: string;
  createdAt: number;
}

export interface RecordingConfig {
  mimeType: string;
  audioBitsPerSecond: number;
  sampleRate: number;
  channelCount: 1 | 2;
  preset: "transcription" | "balanced" | "high";
}

export interface MeetingRecording {
  id: string;
  title: string;
  folder: string | null;
  notes: MeetingNote[];
  sourceMode: SourceMode;
  config: RecordingConfig;
  /** Wall-clock start time, ms since epoch. */
  startedAt: number;
  /** Wall-clock end time, ms since epoch. Null while recording. */
  endedAt: number | null;
  /** Total media duration in ms (recorded time, excluding paused gaps). */
  durationMs: number;
  /** Total bytes of all chunks (or assembled file). */
  sizeBytes: number;
  status: RecordingStatus;
  /** Final assembled Blob (set after stop+fix). Absent while still recording. */
  assembled?: Blob;
  /** Original filename to use when sending to transcribe / downloading. */
  fileName: string;
}

export interface RecordingChunk {
  /** Composite key as string: `${recordingId}:${seq.toString().padStart(8,'0')}` */
  id: string;
  recordingId: string;
  seq: number;
  blob: Blob;
  createdAt: number;
}

class MeetingRecorderDB extends Dexie {
  recordings!: Table<MeetingRecording, string>;
  chunks!: Table<RecordingChunk, string>;

  constructor() {
    super("MeetingRecorderDB");
    this.version(1).stores({
      recordings: "id, folder, status, startedAt",
      chunks: "id, recordingId, seq",
    });
  }
}

export const meetingDb = new MeetingRecorderDB();

const chunkId = (recordingId: string, seq: number) =>
  `${recordingId}:${seq.toString().padStart(8, "0")}`;

export const meetingDbApi = {
  async createRecording(rec: MeetingRecording): Promise<void> {
    await meetingDb.recordings.put(rec);
  },

  async updateRecording(id: string, patch: Partial<MeetingRecording>): Promise<void> {
    await meetingDb.recordings.update(id, patch);
  },

  async getRecording(id: string): Promise<MeetingRecording | undefined> {
    return meetingDb.recordings.get(id);
  },

  async listRecordings(): Promise<MeetingRecording[]> {
    const all = await meetingDb.recordings.orderBy("startedAt").reverse().toArray();
    return all;
  },

  async deleteRecording(id: string): Promise<void> {
    await meetingDb.transaction("rw", meetingDb.recordings, meetingDb.chunks, async () => {
      await meetingDb.chunks.where("recordingId").equals(id).delete();
      await meetingDb.recordings.delete(id);
    });
  },

  async appendChunk(recordingId: string, seq: number, blob: Blob): Promise<void> {
    await meetingDb.chunks.put({
      id: chunkId(recordingId, seq),
      recordingId,
      seq,
      blob,
      createdAt: Date.now(),
    });
  },

  async getChunks(recordingId: string): Promise<RecordingChunk[]> {
    return meetingDb.chunks
      .where("recordingId")
      .equals(recordingId)
      .sortBy("seq");
  },

  async clearChunks(recordingId: string): Promise<void> {
    await meetingDb.chunks.where("recordingId").equals(recordingId).delete();
  },

  /**
   * Find recordings still marked as "recording" — these are crash leftovers.
   */
  async findOrphaned(): Promise<MeetingRecording[]> {
    return meetingDb.recordings.where("status").equals("recording").toArray();
  },

  async assembleFromChunks(recordingId: string, mimeType: string): Promise<Blob | null> {
    const chunks = await this.getChunks(recordingId);
    if (chunks.length === 0) return null;
    return new Blob(chunks.map((c) => c.blob), { type: mimeType });
  },
};
