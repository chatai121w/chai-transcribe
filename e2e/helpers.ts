import { test as base, type Page, type Route } from '@playwright/test';

// ─── Supabase API mock helpers ───────────────────────────────────────────────

const SUPABASE_HOST = 'pycryoyipkymaqorgpjy.supabase.co';

/** Fake user returned by auth mocks */
export const MOCK_USER = {
  id: 'test-user-00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Test User' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

export const MOCK_SESSION = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: MOCK_USER,
};

/** Sample transcript records */
export const MOCK_TRANSCRIPTS = [
  {
    id: 'tr-001',
    user_id: MOCK_USER.id,
    text: 'זהו טקסט לדוגמה של תמלול ראשון',
    engine: 'groq',
    language: 'he',
    title: 'תמלול בדיקה 1',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    tags: ['בדיקה'],
    audio_file_path: null,
    folder_id: null,
    word_timings: null,
    duration: 30,
    model: 'whisper-large-v3',
    processing_time: 2.5,
  },
  {
    id: 'tr-002',
    user_id: MOCK_USER.id,
    text: 'תמלול שני לבדיקת המערכת',
    engine: 'openai',
    language: 'he',
    title: 'תמלול בדיקה 2',
    created_at: new Date().toISOString(),
    tags: [],
    audio_file_path: 'test-audio.webm',
    folder_id: null,
    word_timings: null,
    duration: 15,
    model: 'whisper-1',
    processing_time: 1.8,
  },
];

/**
 * Intercept all Supabase REST/Auth requests and return mock data.
 * Call in beforeEach or test setup to avoid real network calls.
 */
export async function mockSupabase(page: Page, options?: {
  authenticated?: boolean;
  transcripts?: typeof MOCK_TRANSCRIPTS;
  apiKeys?: Record<string, string>;
  isAdmin?: boolean;
}) {
  const {
    authenticated = true,
    transcripts = MOCK_TRANSCRIPTS,
    apiKeys = {},
    isAdmin = false,
  } = options ?? {};

  // ── Auth: ALL auth endpoints ──
  await page.route(`**/${SUPABASE_HOST}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Token refresh / sign in
    if (url.includes('/token')) {
      if (!authenticated) {
        return route.fulfill({ status: 401, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } });
      }
      return route.fulfill({ status: 200, json: MOCK_SESSION });
    }

    // Get user
    if (url.includes('/user')) {
      if (!authenticated) {
        return route.fulfill({ status: 401, json: { error: 'not_authenticated' } });
      }
      return route.fulfill({ status: 200, json: MOCK_USER });
    }

    // Sign up
    if (url.includes('/signup')) {
      return route.fulfill({ status: 200, json: { user: MOCK_USER, session: MOCK_SESSION } });
    }

    // Logout
    if (url.includes('/logout')) {
      return route.fulfill({ status: 200, json: {} });
    }

    // Catch-all for other auth endpoints
    return route.fulfill({ status: 200, json: {} });
  });

  // ── REST: ALL database endpoints ──
  await page.route(`**/${SUPABASE_HOST}/rest/v1/**`, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // transcripts
    if (url.includes('/transcripts')) {
      if (method === 'GET') return route.fulfill({ status: 200, json: transcripts });
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: [{ ...body, id: 'tr-new-' + Date.now() }] });
      }
      if (method === 'DELETE') return route.fulfill({ status: 200, json: [] });
      if (method === 'PATCH') return route.fulfill({ status: 200, json: [transcripts[0]] });
    }

    // user_api_keys
    if (url.includes('/user_api_keys')) {
      if (method === 'GET') {
        const keys = Object.entries(apiKeys).map(([provider, key]) => ({
          id: `key-${provider}`,
          user_id: MOCK_USER.id,
          provider,
          api_key: key,
        }));
        return route.fulfill({ status: 200, json: keys });
      }
      if (method === 'POST' || method === 'PATCH') {
        return route.fulfill({ status: 200, json: [{}] });
      }
    }

    // user_roles (admin check)
    if (url.includes('/user_roles')) {
      if (isAdmin) {
        return route.fulfill({ status: 200, json: [{ user_id: MOCK_USER.id, role: 'admin' }] });
      }
      return route.fulfill({ status: 200, json: [] });
    }

    // profiles
    if (url.includes('/profiles')) {
      return route.fulfill({
        status: 200,
        json: [{ id: MOCK_USER.id, full_name: 'Test User', avatar_url: null }],
      });
    }

    // transcription_jobs
    if (url.includes('/transcription_jobs')) {
      if (method === 'GET') return route.fulfill({ status: 200, json: [] });
      if (method === 'POST') return route.fulfill({ status: 201, json: [{ id: 'job-001', status: 'pending' }] });
      return route.fulfill({ status: 200, json: [] });
    }

    // Catch-all for any other REST endpoint
    return route.fulfill({ status: 200, json: [] });
  });

  // ── Storage: permanent-audio ──
  await page.route(`**/${SUPABASE_HOST}/storage/v1/**`, async (route) => {
    return route.fulfill({ status: 200, json: { Key: 'test-audio.webm' } });
  });

  // ── Realtime: block WebSocket upgrade noise ──
  await page.route(`**/${SUPABASE_HOST}/realtime/**`, async (route) => {
    return route.abort('connectionrefused');
  });

  // ── Lovable auth (cloud-auth-js) ──
  await page.route('**/lovable.dev/**', async (route) => {
    return route.fulfill({ status: 200, json: {} });
  });
}

/**
 * Inject a fake authenticated session into localStorage before navigation.
 * This bypasses the login flow entirely.
 */
export async function injectAuthSession(page: Page) {
  await page.addInitScript(() => {
    const session = {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'test-user-00000000-0000-0000-0000-000000000001',
        email: 'test@example.com',
        app_metadata: { provider: 'email' },
        user_metadata: { full_name: 'Test User' },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
    };
    const storageKey = 'sb-pycryoyipkymaqorgpjy-auth-token';
    localStorage.setItem(storageKey, JSON.stringify(session));
  });
}

/**
 * Mock the local CUDA whisper server health endpoint.
 */
export async function mockLocalServer(page: Page, options?: {
  connected?: boolean;
  model?: string;
}) {
  const { connected = false, model = 'ivrit-ai/whisper-large-v3-turbo' } = options ?? {};

  // Mock both direct localhost:3000 AND the Vite /whisper proxy path
  const healthPatterns = ['**/localhost:3000/health', '**/whisper/health'];
  for (const pattern of healthPatterns) {
    await page.route(pattern, async (route) => {
      if (!connected) {
        return route.abort('connectionrefused');
      }
      return route.fulfill({
        status: 200,
        json: {
          status: 'ok',
          device: 'cuda',
          gpu: 'NVIDIA GeForce RTX 5050 Laptop GPU',
          current_model: model,
          downloaded_models: [model],
        },
      });
    });
  }

  const transcribePatterns = ['**/localhost:3000/transcribe-stream', '**/whisper/transcribe-stream'];
  for (const pattern of transcribePatterns) {
    await page.route(pattern, async (route) => {
      if (!connected) return route.abort('connectionrefused');
      // Return a simple SSE mock with a done event
      const sseBody = [
        'data: {"type":"info","duration":5.0}\n\n',
        'data: {"type":"segment","text":"טקסט תמלול מוק","progress":100,"words":[]}\n\n',
        'data: {"type":"done","text":"טקסט תמלול מוק","duration":5.0,"language":"he","model":"' + model + '","processing_time":1.2,"wordTimings":[]}\n\n',
      ].join('');
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: sseBody,
      });
    });
  }

  const shutdownPatterns = ['**/localhost:3000/shutdown', '**/whisper/shutdown'];
  for (const pattern of shutdownPatterns) {
    await page.route(pattern, async (route) => {
      return route.fulfill({ status: 200, json: { status: 'shutting_down' } });
    });
  }

  const modelsPatterns = ['**/localhost:3000/models', '**/whisper/models'];
  for (const pattern of modelsPatterns) {
    await page.route(pattern, async (route) => {
      return route.fulfill({
        status: 200,
        json: { models: [model], current: model },
      });
    });
  }

  const downloadedModelsPatterns = ['**/localhost:3000/downloaded-models', '**/whisper/downloaded-models'];
  for (const pattern of downloadedModelsPatterns) {
    await page.route(pattern, async (route) => {
      return route.fulfill({
        status: 200,
        json: { models: [{ name: model, size_mb: 1500 }] },
      });
    });
  }

  // Also block convert-mp3 to prevent tests from hitting real server
  const convertPatterns = ['**/localhost:3000/convert-mp3', '**/whisper/convert-mp3'];
  for (const pattern of convertPatterns) {
    await page.route(pattern, async (route) => {
      if (!connected) return route.abort('connectionrefused');
      return route.abort('connectionrefused');
    });
  }
}

/** Create a minimal WAV file buffer for upload tests */
export function createTestAudioBuffer(): Buffer {
  // Minimal valid WAV: 44-byte header + 100 samples of silence
  const numSamples = 100;
  const dataSize = numSamples * 2; // 16-bit
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);

  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);     // chunk size
  buf.writeUInt16LE(1, 20);      // PCM
  buf.writeUInt16LE(1, 22);      // mono
  buf.writeUInt32LE(16000, 24);  // sample rate
  buf.writeUInt32LE(32000, 28);  // byte rate
  buf.writeUInt16LE(2, 32);      // block align
  buf.writeUInt16LE(16, 34);     // bits per sample

  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // silence (zeros) — already initialized by Buffer.alloc

  return buf;
}

/**
 * Extended test fixture that provides common helpers.
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
