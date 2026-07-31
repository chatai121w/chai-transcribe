import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateAsrQualityGate, type AsrQualitySample } from '../src/lib/asrQualityGate';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run quality:compare -- <evaluation-set.json>');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as {
  samples?: AsrQualitySample[];
  maxAbsoluteRegression?: number;
  minOrthographicWerImprovement?: number;
};

const result = evaluateAsrQualityGate(payload.samples || [], {
  maxAbsoluteRegression: payload.maxAbsoluteRegression,
  minOrthographicWerImprovement: payload.minOrthographicWerImprovement,
});

const percent = (value: number) => `${(value * 100).toFixed(3)}%`;
console.log(JSON.stringify({
  passed: result.passed,
  samples: result.samples.length,
  improvedSamples: result.improvedSamples,
  regressedSamples: result.regressedSamples,
  baseline: {
    wer: percent(result.baseline.wer),
    cer: percent(result.baseline.cer),
    orthographicWer: percent(result.baseline.orthographicWer),
    orthographicCer: percent(result.baseline.orthographicCer),
  },
  candidate: {
    wer: percent(result.candidate.wer),
    cer: percent(result.candidate.cer),
    orthographicWer: percent(result.candidate.orthographicWer),
    orthographicCer: percent(result.candidate.orthographicCer),
  },
  improvement: {
    wer: percent(result.werImprovement),
    cer: percent(result.cerImprovement),
    orthographicWer: percent(result.orthographicWerImprovement),
    orthographicCer: percent(result.orthographicCerImprovement),
  },
  reasons: result.reasons,
}, null, 2));

if (!result.passed) process.exit(1);
