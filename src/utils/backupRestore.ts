/**
 * Backup & Restore — export/import all user data as a JSON file.
 * Includes: transcripts (from IndexedDB), vocabulary, correction rules,
 * analytics data, and user preferences.
 */

import { db } from "@/lib/localDb";
import { getAllTerms, type VocabularyEntry } from "@/utils/customVocabulary";
import { getAllCorrections, type CorrectionEntry } from "@/utils/correctionLearning";
import { debugLog } from "@/lib/debugLogger";

export interface BackupData {
  version: number;
  createdAt: string;
  transcripts: Array<Record<string, unknown>>;
  vocabulary: VocabularyEntry[];
  correctionRules: CorrectionEntry[];
  analytics: Record<string, unknown> | null;
  preferences: Record<string, string>;
}

const BACKUP_VERSION = 1;
const PREF_KEYS = [
  "editor_font_size",
  "editor_font_family",
  "editor_text_color",
  "editor_line_height",
  "transcription_engine",
  "theme",
  "language",
];

export async function createBackup(): Promise<BackupData> {
  debugLog.info("backup", "Creating full backup...");

  // 1. Transcripts from IndexedDB
  let transcripts: Array<Record<string, unknown>> = [];
  try {
    transcripts = (await db.transcripts.toArray()) as unknown as Array<Record<string, unknown>>;
  } catch {
    debugLog.info("backup", "No IndexedDB transcripts found");
  }

  // 2. Vocabulary
  const vocabulary = getAllTerms();

  // 3. Correction rules
  const correctionRules = getAllCorrections();

  // 4. Analytics
  let analytics: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem("transcription_analytics");
    if (raw) analytics = JSON.parse(raw);
  } catch { /* ignore */ }

  // 5. Preferences
  const preferences: Record<string, string> = {};
  for (const key of PREF_KEYS) {
    const val = localStorage.getItem(key);
    if (val) preferences[key] = val;
  }

  const backup: BackupData = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    transcripts,
    vocabulary,
    correctionRules,
    analytics,
    preferences,
  };

  debugLog.info("backup", `Backup created: ${transcripts.length} transcripts, ${vocabulary.length} vocab, ${correctionRules.length} rules`);
  return backup;
}

export function downloadBackup(data: BackupData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcriber-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function restoreBackup(file: File): Promise<{ transcripts: number; vocabulary: number; rules: number }> {
  const text = await file.text();
  const data = JSON.parse(text) as BackupData;

  if (!data.version || !data.createdAt) {
    throw new Error("קובץ גיבוי לא תקין");
  }

  let transcriptsRestored = 0;
  let vocabRestored = 0;
  let rulesRestored = 0;

  // 1. Restore transcripts
  if (data.transcripts?.length) {
    try {
      await db.transcripts.bulkPut(data.transcripts as any);
      transcriptsRestored = data.transcripts.length;
    } catch (err) {
      debugLog.error("backup", "Error restoring transcripts:", err);
    }
  }

  // 2. Restore vocabulary
  if (data.vocabulary?.length) {
    const existing = getAllTerms();
    const existingSet = new Set(existing.map(v => v.term));
    const merged = [...existing];
    for (const item of data.vocabulary) {
      if (!existingSet.has(item.term)) {
        merged.push(item);
        vocabRestored++;
      }
    }
    localStorage.setItem("custom_vocabulary", JSON.stringify(merged));
  }

  // 3. Restore correction rules
  if (data.correctionRules?.length) {
    const existing = getAllCorrections();
    const existingSet = new Set(existing.map(r => `${r.original}→${r.corrected}`));
    const merged = [...existing];
    for (const rule of data.correctionRules) {
      const key = `${rule.original}→${rule.corrected}`;
      if (!existingSet.has(key)) {
        merged.push(rule);
        rulesRestored++;
      }
    }
    localStorage.setItem("correction_rules", JSON.stringify(merged));
  }

  // 4. Restore analytics
  if (data.analytics) {
    localStorage.setItem("transcription_analytics", JSON.stringify(data.analytics));
  }

  // 5. Restore preferences
  if (data.preferences) {
    for (const [key, value] of Object.entries(data.preferences)) {
      if (PREF_KEYS.includes(key)) {
        localStorage.setItem(key, value);
      }
    }
  }

  debugLog.info("backup", `Restore complete: ${transcriptsRestored} transcripts, ${vocabRestored} vocab, ${rulesRestored} rules`);
  return { transcripts: transcriptsRestored, vocabulary: vocabRestored, rules: rulesRestored };
}
