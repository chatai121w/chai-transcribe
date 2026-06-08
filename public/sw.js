const CACHE_NAME = 'transcriber-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/pwa-192.svg',
  '/pwa-512.svg',
];

// Offline fallback page (inline)
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>אופליין | מתמלל עברי חכם</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Rubik', 'Assistant', sans-serif;
      background: linear-gradient(135deg, #f5f3ef 0%, #e8e4de 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      color: #1a3a6b;
    }
    .container { text-align: center; padding: 2rem; max-width: 500px; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    p { color: #666; margin-bottom: 1.5rem; line-height: 1.6; }
    button {
      background: #1a3a6b; color: white; border: none; padding: 0.75rem 2rem;
      border-radius: 8px; font-size: 1rem; cursor: pointer; font-family: inherit;
    }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>אין חיבור לאינטרנט</h1>
    <p>המתמלל העברי החכם זקוק לחיבור אינטרנט לתמלול.<br>בדוק את החיבור ונסה שוב.</p>
    <button onclick="location.reload()">נסה שוב</button>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache static assets one by one so one missing file won't fail SW install
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch {
          // Keep install alive even if one optional asset fails
        }
      }
      // Store offline page
      await cache.put('/offline.html', new Response(OFFLINE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first, fallback to cache
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (e.g. local Python server on port 3000)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // For navigation requests, show offline page on failure
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const offline = await caches.match('/offline.html');
          if (offline) return offline;
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // For JS/CSS build assets — cache first (they have content hashes)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});

// ═══════════════════════════════════════════════
//  PUSH NOTIFICATIONS — batch job completion etc.
// ═══════════════════════════════════════════════

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // Show local notification (no push server needed)
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = event.data;
    self.registration.showNotification(title || 'מתמלל עברי חכם', {
      body: body || '',
      icon: '/pwa-192.svg',
      badge: '/pwa-192.svg',
      tag: tag || 'transcriber-notification',
      dir: 'rtl',
      lang: 'he',
      data: { url: url || '/' },
    });
  }

  // Client says "skip waiting" after user accepted update
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════════════════════
//  SERVICE WORKER UPDATE NOTIFICATION
// ═══════════════════════════════════════════════
// When a new SW is installed and waiting, notify all clients
self.addEventListener('install', (event) => {
  // The original install handler at the top already handles caching.
  // This additional listener notifies clients that an update is available.
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        client.postMessage({ type: 'SW_UPDATE_AVAILABLE' });
      }
    })
  );
});

// Handle notification click — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(url);
    })
  );
});

// ═══════════════════════════════════════════════
//  BACKGROUND SYNC — wake clients to retry Drive uploads
// ═══════════════════════════════════════════════
// Note: we don't perform the upload from the SW itself (would require storing
// auth tokens). Instead we ping open clients so the main-thread queue can
// retry using the live Supabase session. If no client is open, the browser
// keeps the sync registration and will retry next time the user opens the app
// (combined with the `online` listener in driveUploadQueue.ts).
self.addEventListener('sync', (event) => {
  if (event.tag !== 'drive-upload-retry') return;
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      client.postMessage({ type: 'DRIVE_RETRY_PENDING' });
    }
  })());
});
