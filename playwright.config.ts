import { defineConfig, devices } from '@playwright/test';

const ciOnlyIgnore = process.env.CI ? [
  '**/_quick-nav.spec.ts',
  '**/check-live-connection.spec.ts',
  '**/cuda-live-*.spec.ts',
  '**/health-check-debug.spec.ts',
  '**/live-transcription.spec.ts',
  '**/real-transcription.spec.ts',
  '**/server-lifecycle.spec.ts',
  '**/server-thorough.spec.ts',
  '**/studio-layout-recovery-real.spec.ts',
  '**/transcribe-wav-live.spec.ts',
] : [];

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
  testMatch: process.env.CI ? ciSmokeTests : '**/*.spec.ts',
  testIgnore: ciOnlyIgnore,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: process.env.CI ? 45_000 : 180_000,
  globalTimeout: process.env.CI ? 15 * 60_000 : undefined,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8091',
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

  webServer: {
    command: 'npx vite --force --port 8091',
    port: 8091,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
