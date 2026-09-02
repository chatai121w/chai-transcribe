export type AsrQualityTier = 'gold' | 'silver' | 'bronze';
export type AsrLabelSource = 'human-approved' | 'teacher-consensus' | 'reference-audio-import';

export interface ApprovedAsrMetadataInput {
  recordingFingerprint: string;
  sourceKind: string;
  sourceRef: string;
  sourceLabel: string;
  teacherEngines: string[];
  qualityTier?: AsrQualityTier;
  labelSource?: AsrLabelSource;
  reviewStatus?: string;
  benchmarkRole?: 'failure-holdout';
  approvedAt?: string;
  startSeconds?: number;
  endSeconds?: number;
}

/** Canonical metadata written beside every human-approved training clip. */
export function buildApprovedAsrMetadata(input: ApprovedAsrMetadataInput): Record<string, string | number> {
  const fingerprint = input.recordingFingerprint.trim();
  if (!fingerprint) throw new Error('recording fingerprint is required');
  const teachers = [...new Set(input.teacherEngines.map((value) => value.trim()).filter(Boolean))];
  const metadata: Record<string, string | number> = {
    schemaVersion: 1,
    qualityTier: input.qualityTier || 'gold',
    labelSource: input.labelSource || 'human-approved',
    sourceKind: input.sourceKind.trim() || 'unknown',
    sourceRef: input.sourceRef.trim() || 'unknown',
    sourceLabel: input.sourceLabel.trim() || 'untitled',
    sourceRecordingId: fingerprint,
    groupId: fingerprint,
    teacherEngines: teachers.join('|'),
    approvedAt: input.approvedAt || new Date().toISOString(),
  };
  if (input.reviewStatus?.trim()) metadata.reviewStatus = input.reviewStatus.trim();
  if (input.benchmarkRole) metadata.benchmarkRole = input.benchmarkRole;
  if (Number.isFinite(input.startSeconds)) metadata.start = input.startSeconds as number;
  if (Number.isFinite(input.endSeconds)) metadata.end = input.endSeconds as number;
  return metadata;
}
