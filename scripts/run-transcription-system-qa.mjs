import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnv } from 'vite';

const args = new Set(process.argv.slice(2));
const includeProduction = args.has('--production') || process.env.QA_INCLUDE_PRODUCTION === '1';
const includeCuda = args.has('--cuda') || process.env.QA_INCLUDE_CUDA === '1';
const projectEnv = loadEnv('production', process.cwd(), '');
const qaEnv = { ...projectEnv, ...process.env };
const npm = 'npm';
const npx = 'npx';
const startedAt = new Date();
const results = [];
let blockingFailure = false;

mkdirSync('logs/qa', { recursive: true });

function run(name, command, commandArgs, extraEnv = {}) {
  const started = Date.now();
  const executable = process.platform === 'win32' ? 'cmd.exe' : command;
  const executableArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', [command, ...commandArgs].join(' ')]
    : commandArgs;
  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    env: { ...qaEnv, ...extraEnv },
    stdio: 'inherit',
    shell: false,
  });
  const status = result.status ?? 1;
  results.push({
    name,
    status,
    durationMs: Date.now() - started,
    command: [command, ...commandArgs].join(' '),
    error: result.error?.message,
  });
  return status === 0;
}

function skipped(name, reason) {
  results.push({ name, status: null, durationMs: 0, skipped: true, reason });
}

function runGate(name, command, commandArgs, extraEnv = {}) {
  if (blockingFailure) {
    skipped(name, 'Blocked by an earlier required gate');
    return false;
  }
  const passed = run(name, command, commandArgs, extraEnv);
  if (!passed) blockingFailure = true;
  return passed;
}

function readEvidence(name, path) {
  try {
    return { name, path, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { name, path, error: error instanceof Error ? error.message : String(error) };
  }
}

runGate('TypeScript', npx, ['tsc', '--noEmit']);
runGate('ESLint', npm, ['run', 'lint']);
runGate(
  'Python server tests',
  process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : 'python',
  ['-W', 'error::ResourceWarning', '-m', 'unittest', 'discover', '-s', 'server', '-p', 'test*.py'],
);
runGate('Unit tests', npm, ['run', 'test:unit']);
runGate('Production build', npm, ['run', 'build']);
runGate('Transcription lab E2E', npx, ['playwright', 'test', 'e2e/transcription-lab.spec.ts', '--workers=1'], {
  PLAYWRIGHT_SUITE: 'full',
  PLAYWRIGHT_USE_PREVIEW: '1',
  PLAYWRIGHT_OUTPUT_DIR: 'logs/qa/test-results/lab',
  PLAYWRIGHT_HTML_OUTPUT_DIR: 'logs/qa/html/lab',
});

const hasCredentials = Boolean(qaEnv.E2E_EMAIL && qaEnv.E2E_PASSWORD);
const evidence = [];
if (blockingFailure) {
  skipped('Published Gemini acceptance', 'Blocked by an earlier required gate');
} else if (includeProduction && hasCredentials) {
  const evidencePath = 'logs/qa/transcription-lab-production-gemini.json';
  rmSync(evidencePath, { force: true });
  runGate('Published Gemini acceptance', npm, ['run', 'test:production-lab'], {
    PRODUCTION_APP_URL: process.env.QA_PRODUCTION_APP_URL || 'https://chai-transcribe.lovable.app',
    PRODUCTION_LAB_CANDIDATE_ENGINE: 'gemini',
    PLAYWRIGHT_OUTPUT_DIR: 'logs/qa/test-results/gemini',
    PLAYWRIGHT_HTML_OUTPUT_DIR: 'logs/qa/html/gemini',
  });
  evidence.push(readEvidence('Gemini', evidencePath));
} else {
  skipped('Published Gemini acceptance', includeProduction ? 'E2E_EMAIL/E2E_PASSWORD are missing' : 'Use --production to enable');
}

if (blockingFailure) {
  skipped('Cloud audio with local CUDA acceptance', 'Blocked by an earlier required gate');
} else if (includeCuda && hasCredentials) {
  const evidencePath = 'logs/qa/transcription-lab-production-cuda.json';
  rmSync(evidencePath, { force: true });
  runGate('Cloud audio with local CUDA acceptance', npm, ['run', 'test:production-lab'], {
    PRODUCTION_APP_URL: process.env.QA_LOCAL_APP_URL || 'http://127.0.0.1:8080',
    PRODUCTION_LAB_CANDIDATE_ENGINE: 'local-server',
    PLAYWRIGHT_OUTPUT_DIR: 'logs/qa/test-results/cuda',
    PLAYWRIGHT_HTML_OUTPUT_DIR: 'logs/qa/html/cuda',
  });
  evidence.push(readEvidence('CUDA', evidencePath));
} else {
  skipped('Cloud audio with local CUDA acceptance', includeCuda ? 'E2E_EMAIL/E2E_PASSWORD are missing' : 'Use --cuda to enable');
}

const finishedAt = new Date();
const passed = results.filter((item) => item.status === 0).length;
const failed = results.filter((item) => typeof item.status === 'number' && item.status !== 0).length;
const summary = {
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  passed,
  failed,
  skipped: results.filter((item) => item.skipped).length,
  results,
  evidence,
};

writeFileSync('logs/qa/transcription-system-summary.json', `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const lines = [
  '# דוח אוטומטי - מערכת בדיקות התמלול',
  '',
  `- התחלה: ${summary.startedAt}`,
  `- סיום: ${summary.finishedAt}`,
  `- עברו: ${passed}`,
  `- נכשלו: ${failed}`,
  `- דולגו: ${summary.skipped}`,
  '',
  '## שלבים',
  '',
  '| שלב | מצב | משך |',
  '|---|---:|---:|',
  ...results.map((item) => `| ${item.name} | ${item.skipped ? `דולג: ${item.reason}` : item.status === 0 ? 'עבר' : `נכשל (${item.status})`} | ${(item.durationMs / 1000).toFixed(1)} שניות |`),
  '',
  '## ראיות קבלה',
  '',
  ...evidence.flatMap((item) => item.data ? [
    `### ${item.name}`,
    '',
    `- Experiment: \`${item.data.experimentId}\``,
    `- אירועי Trace מקומיים/ענן: ${item.data.localEventCount}/${item.data.cloudEventCount}`,
    `- ריצות השוואה בענן: ${item.data.cloudRunCount}`,
    `- מילים A/B: ${item.data.baselineWords}/${item.data.candidateWords}`,
    `- תזמונים A/B: ${item.data.baselineTimingCount}/${item.data.candidateTimingCount}`,
    `- מודל מבוקש A/B: ${item.data.baselineRequestedModel || 'לא זמין'} / ${item.data.candidateRequestedModel || 'לא זמין'}`,
    `- מודל שבוצע A/B: ${item.data.baselineModel || 'לא זמין'} / ${item.data.candidateModel || 'לא זמין'}`,
    `- סיבת fallback ב-B: ${item.data.candidateFallbackReason || 'אין'}`,
    `- Trace תקין: ${item.data.traceValid ? 'כן' : 'לא'}`,
    `- ניסיונות טעינת מקור: ${item.data.sourceSelectionAttempts ?? 'לא זמין'}`,
    `- העלאות מקור חדשות: ${item.data.sourceUploadCount}`,
    `- ניקוי אירועים/ריצות שנותרו: ${item.data.cleanup?.events}/${item.data.cleanup?.runs}`,
    '',
  ] : [`### ${item.name}`, '', `- אין ראיה קריאה: ${item.error}`, '']),
];
writeFileSync('logs/qa/transcription-system-summary.md', `${lines.join('\n')}\n`, 'utf8');

process.exit(failed === 0 ? 0 : 1);
