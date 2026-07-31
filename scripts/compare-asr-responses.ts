import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateAsrQualityGate } from '../src/lib/asrQualityGate';

const [referencePath, baselinePath, candidatePath, sampleId = 'recording'] = process.argv.slice(2);
if (!referencePath || !baselinePath || !candidatePath) {
  console.error('Usage: npm run quality:compare-responses -- <reference.txt> <baseline.json> <candidate.json> [sample-id]');
  process.exit(2);
}

function readResponseText(path: string): string {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as { text?: unknown; error?: unknown };
  if (parsed.error) throw new Error(`Transcription response failed: ${String(parsed.error)}`);
  if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
    throw new Error(`Transcription response has no text: ${path}`);
  }
  return parsed.text;
}

const result = evaluateAsrQualityGate([{
  id: sampleId,
  reference: readFileSync(resolve(referencePath), 'utf8'),
  baseline: readResponseText(baselinePath),
  candidate: readResponseText(candidatePath),
}]);

const pct = (value: number) => `${(value * 100).toFixed(3)}%`;
console.log(JSON.stringify({
  passed: result.passed,
  sampleId,
  baseline: {
    wer: pct(result.baseline.wer),
    cer: pct(result.baseline.cer),
    orthographicWer: pct(result.baseline.orthographicWer),
    orthographicCer: pct(result.baseline.orthographicCer),
  },
  candidate: {
    wer: pct(result.candidate.wer),
    cer: pct(result.candidate.cer),
    orthographicWer: pct(result.candidate.orthographicWer),
    orthographicCer: pct(result.candidate.orthographicCer),
  },
  improvement: {
    wer: pct(result.werImprovement),
    cer: pct(result.cerImprovement),
    orthographicWer: pct(result.orthographicWerImprovement),
    orthographicCer: pct(result.orthographicCerImprovement),
  },
  reasons: result.reasons,
}, null, 2));

if (!result.passed) process.exit(1);
