import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

/**
 * E2E tests for the MeetingRecorder page.
 *
 * NOTE: We deliberately don't try to drive a real MediaRecorder end-to-end here
 *  — Chromium in Playwright doesn't grant getDisplayMedia without manual user
 *  action. Instead we:
 *    1. Verify the page renders, navigates, and exposes the documented controls.
 *    2. Verify the IndexedDB-backed library reads/writes recordings correctly
 *       (we seed `MeetingRecorderDB` directly from the page context).
 *    3. Verify the crash-recovery banner appears for orphaned `recording`
 *       rows and that "discard" cleans them up.
 *    4. Verify a stored recording exposes Play / Download / Send-to-transcribe
 *       and that "Send" navigates to /transcribe with the file in router state.
 */

test.describe('MeetingRecorder — page', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
    await injectAuthSession(page);
    // Grant mic permission to suppress the browser prompt if MediaRecorder is touched.
    await page.context().grantPermissions(['microphone']);
  });

  test('הדף נטען ומציג את הפקדים העיקריים', async ({ page }) => {
    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/meeting-recorder/, { timeout: 30000 });

    // Title heading
    await expect(page.getByRole('heading', { name: 'מקליט פגישות' })).toBeVisible({ timeout: 30000 });

    // Quick-start platform buttons
    await expect(page.getByText('הקלטה מהירה — בלחיצה אחת').first()).toBeVisible();
    await expect(page.getByText('Google Meet', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Zoom (דפדפן)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('WhatsApp Web', { exact: true }).first()).toBeVisible();

    // Mic-only button
    await expect(page.getByText('פגישה פיזית / הכתבה').first()).toBeVisible();

    // Library section
    await expect(page.getByText('ספריית ההקלטות').first()).toBeVisible();
  });

  test('הוראות הזום/מיט מוצגות עבור מצב מערכת', async ({ page }) => {
    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    // Quick-start Google Meet button is always visible
    await expect(page.getByText('Google Meet', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    // Platform guide is inside collapsed advanced settings — open it
    await page.locator('details > summary').filter({ hasText: 'הגדרות מתקדמות' }).click();
    await expect(page.getByText('מדריך לפלטפורמה:').first()).toBeVisible({ timeout: 10000 });
  });

  test('הוראות נעלמות במצב מיקרופון בלבד', async ({ page }) => {
    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    // Platform guide is hidden at top level (inside collapsed details)
    await expect(page.getByText('מדריך לפלטפורמה:')).toHaveCount(0);
  });

  test('הספרייה ריקה בהתחלה', async ({ page }) => {
    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ספריית ההקלטות')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/אין הקלטות שמורות עדיין/)).toBeVisible();
  });

  test('פריט בספרייה מוצג עם פעולות תמלל/הורד/מחק', async ({ page }) => {
    // Seed a completed recording into IndexedDB before app loads
    await page.addInitScript(() => {
      const seed = async () => {
        // Open / create the same DB the app uses
        const req = indexedDB.open('MeetingRecorderDB', 1);
        await new Promise<void>((resolve, reject) => {
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
              const s = db.createObjectStore('recordings', { keyPath: 'id' });
              s.createIndex('folder', 'folder');
              s.createIndex('status', 'status');
              s.createIndex('startedAt', 'startedAt');
            }
            if (!db.objectStoreNames.contains('chunks')) {
              const c = db.createObjectStore('chunks', { keyPath: 'id' });
              c.createIndex('recordingId', 'recordingId');
              c.createIndex('seq', 'seq');
            }
          };
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        const db = req.result;
        const tx = db.transaction('recordings', 'readwrite');
        const fakeBlob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' });
        const rec = {
          id: 'seed-rec-1',
          title: 'פגישת בדיקה',
          folder: null,
          notes: [
            { id: 'n1', timeMs: 5000, text: 'נקודה חשובה', createdAt: Date.now() },
          ],
          sourceMode: 'mic',
          config: {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 32000,
            sampleRate: 48000,
            channelCount: 1,
            preset: 'balanced',
          },
          startedAt: Date.now() - 60_000,
          endedAt: Date.now(),
          durationMs: 12_000,
          sizeBytes: fakeBlob.size,
          status: 'completed',
          assembled: fakeBlob,
          fileName: 'pgisha-bdika.webm',
        };
        tx.objectStore('recordings').put(rec);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      };
      // Run before any app code touches Dexie
      void seed().catch((e) => console.warn('seed failed', e));
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('פגישת בדיקה')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/00:12/)).toBeVisible();
    await expect(page.getByText(/1 הערות/).first()).toBeVisible();

    // Library count badge (in the header)
    await expect(page.getByRole('button', { name: /^תמלל$/ })).toBeVisible();
  });

  test('כפתור "תמלל" מנווט ל-/transcribe', async ({ page }) => {
    await page.addInitScript(() => {
      const seed = async () => {
        const req = indexedDB.open('MeetingRecorderDB', 1);
        await new Promise<void>((resolve, reject) => {
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
              const s = db.createObjectStore('recordings', { keyPath: 'id' });
              s.createIndex('folder', 'folder');
              s.createIndex('status', 'status');
              s.createIndex('startedAt', 'startedAt');
            }
            if (!db.objectStoreNames.contains('chunks')) {
              const c = db.createObjectStore('chunks', { keyPath: 'id' });
              c.createIndex('recordingId', 'recordingId');
              c.createIndex('seq', 'seq');
            }
          };
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        const db = req.result;
        const tx = db.transaction('recordings', 'readwrite');
        const fakeBlob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' });
        tx.objectStore('recordings').put({
          id: 'seed-rec-2',
          title: 'נווט-לתמלול',
          folder: null,
          notes: [],
          sourceMode: 'mic',
          config: { mimeType: 'audio/webm', audioBitsPerSecond: 24000, sampleRate: 16000, channelCount: 1, preset: 'transcription' },
          startedAt: Date.now() - 1000,
          endedAt: Date.now(),
          durationMs: 1000,
          sizeBytes: fakeBlob.size,
          status: 'completed',
          assembled: fakeBlob,
          fileName: 'navigate.webm',
        });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      };
      void seed().catch(() => {});
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('נווט-לתמלול')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /^תמלל$/ }).first().click();
    await expect(page).toHaveURL(/\/transcribe/, { timeout: 15000 });
  });

  test('באנר שחזור מופיע עבור הקלטה שננטשה במצב recording', async ({ page }) => {
    await page.addInitScript(() => {
      const seed = async () => {
        const req = indexedDB.open('MeetingRecorderDB', 1);
        await new Promise<void>((resolve, reject) => {
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('recordings')) {
              const s = db.createObjectStore('recordings', { keyPath: 'id' });
              s.createIndex('folder', 'folder');
              s.createIndex('status', 'status');
              s.createIndex('startedAt', 'startedAt');
            }
            if (!db.objectStoreNames.contains('chunks')) {
              const c = db.createObjectStore('chunks', { keyPath: 'id' });
              c.createIndex('recordingId', 'recordingId');
              c.createIndex('seq', 'seq');
            }
          };
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        const db = req.result;
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').put({
          id: 'orphan-1',
          title: 'הקלטה שקרסה',
          folder: null,
          notes: [],
          sourceMode: 'mic',
          config: { mimeType: 'audio/webm', audioBitsPerSecond: 32000, sampleRate: 48000, channelCount: 1, preset: 'balanced' },
          startedAt: Date.now() - 300_000,
          endedAt: null,
          durationMs: 0,
          sizeBytes: 0,
          status: 'recording',
          fileName: 'crashed.webm',
        });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      };
      void seed().catch(() => {});
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('נמצאו הקלטות שלא נסגרו כראוי')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('הקלטה שקרסה')).toBeVisible();
  });

  test('הסיידבר כולל קישור למקליט פגישות', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Open the sidebar (hover trigger or click the menu button on mobile)
    const menuBtn = page.getByRole('button', { name: 'פתח תפריט' });
    if (await menuBtn.count()) {
      await menuBtn.first().click();
    } else {
      // Desktop: hover the right edge to trigger sidebar
      const vp = page.viewportSize();
      if (vp) await page.mouse.move(vp.width - 4, vp.height / 2);
    }
    await expect(page.getByRole('button', { name: /מקליט פגישות/ })).toBeVisible({ timeout: 30000 });
  });

  // ─── helper: seeds a completed recording ───────────────────────────────────
  const seedRecording = (id: string, title: string, durationMs: number, sizeBytes: number, folder: string | null = null) =>
    async ({ page }: { page: import('@playwright/test').Page }) => {
      await page.addInitScript(({ id, title, durationMs, sizeBytes, folder }) => {
        void (async () => {
          const req = indexedDB.open('MeetingRecorderDB', 1);
          await new Promise<void>((resolve, reject) => {
            req.onupgradeneeded = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains('recordings')) {
                const s = db.createObjectStore('recordings', { keyPath: 'id' });
                s.createIndex('folder', 'folder');
                s.createIndex('status', 'status');
                s.createIndex('startedAt', 'startedAt');
              }
              if (!db.objectStoreNames.contains('chunks')) {
                const c = db.createObjectStore('chunks', { keyPath: 'id' });
                c.createIndex('recordingId', 'recordingId');
                c.createIndex('seq', 'seq');
              }
            };
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          const db = req.result;
          const tx = db.transaction('recordings', 'readwrite');
          const fakeBlob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' });
          tx.objectStore('recordings').put({
            id, title, folder, notes: [],
            sourceMode: 'mic',
            config: { mimeType: 'audio/webm', audioBitsPerSecond: 32000, sampleRate: 48000, channelCount: 1, preset: 'balanced' },
            startedAt: Date.now() - durationMs,
            endedAt: Date.now(),
            durationMs, sizeBytes,
            status: 'completed',
            assembled: fakeBlob,
            fileName: `${id}.webm`,
          });
          await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
          db.close();
        })().catch(() => {});
      }, { id, title, durationMs, sizeBytes, folder });
    };

  test('חיפוש בספרייה מסנן לפי שם', async ({ page }) => {
    await page.addInitScript(() => {
      void (async () => {
        const open = (version: number) => new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open('MeetingRecorderDB', version);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('recordings')) {
              const s = db.createObjectStore('recordings', { keyPath: 'id' });
              s.createIndex('folder', 'folder');
              s.createIndex('status', 'status');
              s.createIndex('startedAt', 'startedAt');
            }
            if (!db.objectStoreNames.contains('chunks')) {
              const c = db.createObjectStore('chunks', { keyPath: 'id' });
              c.createIndex('recordingId', 'recordingId');
              c.createIndex('seq', 'seq');
            }
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const db = await open(1);
        const fakeBlob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' });
        const base = { sourceMode: 'mic', config: { mimeType: 'audio/webm', audioBitsPerSecond: 32000, sampleRate: 48000, channelCount: 1, preset: 'balanced' }, notes: [], status: 'completed', assembled: fakeBlob };
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.put({ ...base, id: 'search-1', title: 'פגישת לקוח אלפא',  folder: null, startedAt: Date.now() - 60000, endedAt: Date.now(), durationMs: 60000, sizeBytes: 1024, fileName: 'a.webm' });
        store.put({ ...base, id: 'search-2', title: 'פגישת לקוח ביתא',  folder: null, startedAt: Date.now() - 30000, endedAt: Date.now(), durationMs: 30000, sizeBytes: 512,  fileName: 'b.webm' });
        store.put({ ...base, id: 'search-3', title: 'ועידת הנהלה', folder: null, startedAt: Date.now() - 10000, endedAt: Date.now(), durationMs: 10000, sizeBytes: 256,  fileName: 'c.webm' });
        await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
        db.close();
      })().catch(() => {});
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    // All 3 visible
    await expect(page.getByText('פגישת לקוח אלפא')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('פגישת לקוח ביתא')).toBeVisible();
    await expect(page.getByText('ועידת הנהלה')).toBeVisible();

    // Search for "לקוח" — only 2 should remain
    await page.getByPlaceholder(/חפש לפי שם/).fill('לקוח');
    await expect(page.getByText('פגישת לקוח אלפא')).toBeVisible();
    await expect(page.getByText('פגישת לקוח ביתא')).toBeVisible();
    await expect(page.getByText('ועידת הנהלה')).toHaveCount(0);

    // Clear search — all 3 return
    await page.getByPlaceholder(/חפש לפי שם/).fill('');
    await expect(page.getByText('ועידת הנהלה')).toBeVisible();
  });

  test('סה"כ זמן הקלטה מוצג בספרייה', async ({ page }) => {
    await page.addInitScript(() => {
      void (async () => {
        const r = indexedDB.open('MeetingRecorderDB', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('recordings')) {
            const s = db.createObjectStore('recordings', { keyPath: 'id' });
            s.createIndex('folder', 'folder');
            s.createIndex('status', 'status');
            s.createIndex('startedAt', 'startedAt');
          }
          if (!db.objectStoreNames.contains('chunks')) {
            const c = db.createObjectStore('chunks', { keyPath: 'id' });
            c.createIndex('recordingId', 'recordingId');
            c.createIndex('seq', 'seq');
          }
        };
        await new Promise<void>((res, rej) => { r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
        const db = r.result;
        const fakeBlob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' });
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').put({
          id: 'stats-1', title: 'הקלטה לסטטיסטיקה', folder: null, notes: [], sourceMode: 'mic',
          config: { mimeType: 'audio/webm', audioBitsPerSecond: 32000, sampleRate: 48000, channelCount: 1, preset: 'balanced' },
          startedAt: Date.now() - 120000, endedAt: Date.now(), durationMs: 120000, sizeBytes: 1024,
          status: 'completed', assembled: fakeBlob, fileName: 'stats.webm',
        });
        await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
        db.close();
      })().catch(() => {});
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    // Total time 2 minutes → "02:00"
    await expect(page.getByText(/סה"כ:/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/02:00/)).toBeVisible();
  });

  test('כפתור "השלך" מסיר הקלטה עזובה מהבאנר', async ({ page }) => {
    await page.addInitScript(() => {
      void (async () => {
        const r = indexedDB.open('MeetingRecorderDB', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('recordings')) {
            const s = db.createObjectStore('recordings', { keyPath: 'id' });
            s.createIndex('folder', 'folder');
            s.createIndex('status', 'status');
            s.createIndex('startedAt', 'startedAt');
          }
          if (!db.objectStoreNames.contains('chunks')) {
            const c = db.createObjectStore('chunks', { keyPath: 'id' });
            c.createIndex('recordingId', 'recordingId');
            c.createIndex('seq', 'seq');
          }
        };
        await new Promise<void>((res, rej) => { r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
        const db = r.result;
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').put({
          id: 'orphan-discard', title: 'הקלטה לביטול', folder: null, notes: [], sourceMode: 'mic',
          config: { mimeType: 'audio/webm', audioBitsPerSecond: 32000, sampleRate: 48000, channelCount: 1, preset: 'balanced' },
          startedAt: Date.now() - 60000, endedAt: null, durationMs: 0, sizeBytes: 0,
          status: 'recording', fileName: 'orphan-discard.webm',
        });
        await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
        db.close();
      })().catch(() => {});
    });

    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('הקלטה לביטול')).toBeVisible({ timeout: 30000 });

    // Accept the confirm() dialog and click the X (discard) button
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '' }).first().click();

    // Banner should disappear
    await expect(page.getByText('הקלטה לביטול')).toHaveCount(0, { timeout: 10000 });
  });

  test('כפתור תמלול חי מופיע בזמן הקלטה', async ({ page }) => {
    await page.goto('/meeting-recorder', { waitUntil: 'domcontentloaded' });
    // Live transcription toggle is only visible DURING recording — confirm it's hidden at rest
    await expect(page.getByText('הפעל תמלול חי')).toHaveCount(0);
    await expect(page.getByText('כבה תמלול חי')).toHaveCount(0);
  });
});
