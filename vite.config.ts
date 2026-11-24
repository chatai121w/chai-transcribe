/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { spawn, type ChildProcess } from "child_process";
import compression from "vite-plugin-compression";
import fs from "fs";
import http from "node:http";
import net from "node:net";
import { createPortResolver, meansServerIsGone } from "./src/lib/whisperBridge";

const WHISPER_PORTS = Array.from({ length: 20 }, (_, index) => 3000 + index);
// The watchdog moves the Whisper server to another port whenever 3000 is taken,
// and until now the proxy had no way to learn that: it assumed 3000 and only
// updated when someone pressed "start server" in the UI. Verified lazily on the
// first proxied request and again after any failure, so the bridge follows the
// server instead of guessing. Costs nothing once resolved.
const whisperResolver = createPortResolver({
  ports: WHISPER_PORTS,
  probe: (port) => isWhisperServer(port),
  onMoved: (port) => console.log(`[whisper] server located on port ${port}`),
});

function ensureWhisperPort(): Promise<void> {
  return whisperResolver.ensure();
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED');
    });
  });
}

/*
  זמן ההמתנה לבדיקה. היה 0.75 שניות, ונמדד ששרת התמלול עונה על
  בדיקת הבריאות אחרי כ-0.67 שניות — הוא מחזיר את כל רשימת המנועים.
  המרווח היה צר מדי, ובדיקה שנפלה בזמן נראתה בדיוק כמו שרת כבוי.
*/
const WHISPER_PROBE_TIMEOUT_MS = 2500;

/** כמה לחכות לתחילת תשובה בפניית קריאה, לפני שמוותרים. */
const READ_REPLY_TIMEOUT_MS = 8000;

function isWhisperServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/health', timeout: WHISPER_PROBE_TIMEOUT_MS }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(response.statusCode === 200 && data?.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

function isOllamaServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

function findOllamaExecutable(): string {
  const executable = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const candidates = [
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', executable)
      : '',
    executable,
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === executable || fs.existsSync(candidate)) || executable;
}

async function startOllamaServer(): Promise<'started' | 'already running'> {
  if (await isOllamaServer()) return 'already running';

  const child = spawn(findOllamaExecutable(), ['serve'], {
    env: { ...process.env, OLLAMA_ORIGINS: '*' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isOllamaServer()) return 'started';
  }
  throw new Error('Ollama לא עלה בזמן. ודא שהוא מותקן ונסה שוב.');
}

async function resolveWhisperPort(): Promise<{ port: number; alreadyRunning: boolean }> {
  for (const port of WHISPER_PORTS) {
    if (await isWhisperServer(port)) return { port, alreadyRunning: true };
  }
  for (const port of WHISPER_PORTS) {
    if (await isPortAvailable(port)) return { port, alreadyRunning: false };
  }
  throw new Error('No free Whisper port found in range 3000-3019');
}

function proxyWhisperRequest(req: any, res: any): void {
  void ensureWhisperPort().then(() => forwardWhisperRequest(req, res));
}

function forwardWhisperRequest(req: any, res: any): void {
  const upstream = http.request({
    host: '127.0.0.1',
    port: whisperResolver.port,
    path: req.url.replace(/^\/whisper/, '') || '/',
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${whisperResolver.port}` },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });

  /*
    הדפדפן ניתק באמצע: סוגרים גם את הצד השני, אחרת נשאר חיבור פתוח
    לכל פנייה שבוטלה.

    חשוב שזה יהיה על התשובה ולא על הבקשה: בקשה בלי גוף (בדיקת בריאות
    רגילה) נגמרת מיד, ומאזין על סגירת הבקשה היה הורג כל פנייה תקינה
    ברגע שהיא יצאה לדרך.
  */
  res.once('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });

  /*
    גבול זמן לפניות קריאה בלבד.

    נצפה במדידה: כששרת התמלול מופעל מחדש הוא תופס את הדלת לפני
    שהוא מוכן לענות, ואז הפנייה מתקבלת אך לא נענית — והדפדפן נתקע
    בלי סוף במקום לדווח על תקלה.

    הגבול חל רק על פניות קריאה, ורק עד שמתחילה תשובה. פנייה כבדה
    כמו תמלול אינה קריאה, ולכן אינה מוגבלת — גם אם היא נמשכת דקות.
  */
  if (req.method === 'GET' || req.method === 'HEAD') {
    const giveUp = setTimeout(() => {
      whisperResolver.invalidate();
      upstream.destroy(new Error('השרת קיבל את הפנייה אך לא ענה'));
    }, READ_REPLY_TIMEOUT_MS);
    upstream.once('response', () => clearTimeout(giveUp));
    upstream.once('error', () => clearTimeout(giveUp));
    res.once('close', () => clearTimeout(giveUp));
  }

  upstream.once('error', (error: NodeJS.ErrnoException) => {
    if (meansServerIsGone(error.code)) {
      // ייתכן שהשרת עבר דלת — שיחפש מחדש בפעם הבאה.
      whisperResolver.invalidate();
    }
    if (res.writableEnded || res.destroyed) return;
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: `Whisper server unavailable on port ${whisperResolver.port}`, detail: error.message }));
  });
  req.pipe(upstream);
}

/**
 * Vite plugin: exposes /__api/start-server and /__api/stop-server
 * to launch/kill the local Whisper Python server from the browser.
 */
function whisperServerLauncher(): Plugin {
  let serverProcess: ChildProcess | null = null;

  return {
    name: 'whisper-server-launcher',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/whisper')) {
          proxyWhisperRequest(req, res);
          return;
        }

        if (req.method === 'POST' && req.url === '/__api/start-ollama') {
          try {
            const message = await startOllamaServer();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, running: true, message }));
          } catch (err: unknown) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Ollama start failed' }));
          }
          return;
        }

        if (req.method === 'POST' && req.url === '/__api/start-server') {
          if (serverProcess && !serverProcess.killed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'already running', port: whisperResolver.port }));
            return;
          }

          try {
            const resolved = await resolveWhisperPort();
            whisperResolver.setPort(resolved.port);
            if (resolved.alreadyRunning) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, message: 'already running', port: whisperResolver.port }));
              return;
            }
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }

          const projectRoot = process.cwd();
          // Check .venv first, then venv-whisper (same order as launcher_tray.py)
          const venvDirs = ['.venv', 'venv-whisper'];
          let pythonExe = '';
          for (const dir of venvDirs) {
            const candidate = path.join(projectRoot, dir, 'Scripts', 'python.exe');
            if (fs.existsSync(candidate)) { pythonExe = candidate; break; }
          }
          if (!pythonExe) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Python venv not found (.venv or venv-whisper)' }));
            return;
          }
          const scriptPath = path.join(projectRoot, 'server', 'transcribe_server.py');

          try {
            serverProcess = spawn(pythonExe, [scriptPath, '--port', String(whisperResolver.port)], {
              cwd: projectRoot,
              stdio: 'pipe',
              detached: false,
            });

            serverProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[whisper] ${d}`));
            serverProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[whisper] ${d}`));
            serverProcess.on('exit', (code) => {
              console.log(`[whisper] server exited with code ${code}`);
              serverProcess = null;
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'started', port: whisperResolver.port }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
          return;
        }

        if (req.method === 'POST' && req.url === '/__api/stop-server') {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGTERM');
            serverProcess = null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'stopped' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'not running' }));
          }
          return;
        }

        if (req.method === 'GET' && req.url === '/__api/server-status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ running: !!(serverProcess && !serverProcess.killed), port: whisperResolver.port }));
          return;
        }

        next();
      });

      // Kill server process on Vite shutdown
      server.httpServer?.on('close', () => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGTERM');
        }
      });
    },
  };
}

/**
 * Vite plugin: auto-version the service worker cache name using the build timestamp.
 */
function swAutoVersion(): Plugin {
  return {
    name: 'sw-auto-version',
    apply: 'build',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist', 'sw.js');
      if (fs.existsSync(swPath)) {
        const buildHash = Date.now().toString(36);
        let content = fs.readFileSync(swPath, 'utf-8');
        content = content.replace(
          /const CACHE_NAME = '[^']+'/,
          `const CACHE_NAME = 'transcriber-${buildHash}'`
        );
        fs.writeFileSync(swPath, content, 'utf-8');
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isLovableCloud = Boolean(process.env.LOVABLE);

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      protocol: isLovableCloud ? "wss" : "ws",
      ...(isLovableCloud ? { clientPort: 443 } : { host: "localhost" }),
    },
    // Allow Cloudflare Tunnel and external preview origins
    allowedHosts: ['localhost', '.trycloudflare.com', '.lovable.app', '.lovableproject.com'],
  },
  plugins: [
    react(),
    // lovable-tagger only on Lovable cloud, not local dev (causes HTTPS ping errors)
    mode === "development" && process.env.LOVABLE ? componentTagger() : null,
    whisperServerLauncher(),
    compression({ algorithm: 'gzip', threshold: 1024 }),
    compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
    swAutoVersion(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      // Core framework
      'react', 'react-dom', 'react-router-dom',
      // State / data
      '@tanstack/react-query', '@supabase/supabase-js',
      // UI primitives (Radix) — pre-bundle so first page-load doesn't transform each separately
      '@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-tooltip',
      '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-scroll-area', '@radix-ui/react-toast', '@radix-ui/react-switch',
      // Utilities used on every page
      'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority',
      'zod', 'date-fns', 'sonner', 'diff-match-patch',
      // Forms
      'react-hook-form', '@hookform/resolvers',
      // Previously listed
      'fix-webm-duration', 'dexie',
    ],
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core', '@ffmpeg/util', '@shiguredo/rnnoise-wasm'],
  },
  build: {
    // Avoid rare esbuild minification scoping bugs in large React chunks.
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Critical path: always eagerly needed ──────────────────────────
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          // Radix UI primitives — needed on every page
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-ui';
          }
          // lucide-react — used everywhere
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }

          // ── Heavy libs: kept in own async chunks ──────────────────────────
          // These load only when the page/feature that needs them is first visited.
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-')) {
            return 'vendor-charts';
          }
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/html2canvas')) {
            return 'vendor-pdf';
          }
          if (id.includes('node_modules/docx')) {
            return 'vendor-docx';
          }
          // wavesurfer — audio pages only
          if (id.includes('node_modules/wavesurfer')) {
            return 'vendor-wavesurfer';
          }
          // @huggingface/transformers + onnxruntime — loaded lazily on demand
          if (id.includes('node_modules/@huggingface/') || id.includes('node_modules/onnxruntime')) {
            return 'vendor-ai';
          }
          // rnnoise — loaded lazily, huge WASM blob
          if (id.includes('node_modules/@shiguredo/rnnoise-wasm')) {
            return 'rnnoise';
          }
          // ffmpeg — loaded lazily
          if (id.includes('node_modules/@ffmpeg/')) {
            return 'vendor-ffmpeg';
          }
        },
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  };
});
