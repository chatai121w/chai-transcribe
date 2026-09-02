import { defineConfig, devices } from '@playwright/test';

const requestedSuite = process.env.PLAYWRIGHT_SUITE || 'smoke';
const runSmokeSuite = process.env.CI === 'true' || process.env.CI === '1' || requestedSuite === 'smoke';
const runLiveSuite = requestedSuite === 'live';
const runProductionSuite = requestedSuite === 'production';
const useBuiltPreview = process.env.PLAYWRIGHT_USE_PREVIEW === '1';

const externalOrManualTests = [
  '**/_quick-nav.spec.ts',
  '**/check-live-connection.spec.ts',
  '**/cuda-live-*.spec.ts',
  '**/health-check-debug.spec.ts',
  '**/harmonika-studio.spec.ts',
  '**/real-transcription.spec.ts',
  '**/studio-layout-recovery-real.spec.ts',
  '**/transcribe-wav-live.spec.ts',
  '**/video-diarization-demo.spec.ts',
  '**/video-transcription-demo.spec.ts',
];

const liveTests = [
  'cuda-live-debug.spec.ts',
  'harmonika-studio.spec.ts',
  'real-transcription.spec.ts',
  'video-diarization-demo.spec.ts',
  'video-transcription-demo.spec.ts',
];

const ciSmokeTests = [
  'api-mocks.spec.ts',
  'auth.spec.ts',
  'design-mode.spec.ts',
  'navigation.spec.ts',
  'transcription.spec.ts',
  'video-to-mp3.spec.ts',
];

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  testMatch: runSmokeSuite
    ? ciSmokeTests
    : runLiveSuite
      ? liveTests
      : runProductionSuite
        ? 'transcription-lab.production.spec.ts'
        : '**/*.spec.ts',
  testIgnore: runLiveSuite || runProductionSuite ? [] : externalOrManualTests,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: process.env.CI ? 45_000 : 180_000,
  globalTimeout: process.env.CI ? 15 * 60_000 : undefined,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL
      || (runProductionSuite ? process.env.PRODUCTION_APP_URL || 'https://chai-transcribe.lovable.app' : 'http://localhost:8091'),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.RECORD_VIDEO ? 'on' : 'off',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL || runProductionSuite || runLiveSuite ? undefined : {
    command: useBuiltPreview ? 'npx vite preview --port 8091 --strictPort' : 'npx vite --port 8091',
    port: 8091,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
