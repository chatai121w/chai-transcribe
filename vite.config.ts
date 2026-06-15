/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { spawn, type ChildProcess } from "child_process";
import compression from "vite-plugin-compression";
import fs from "fs";

/**
 * Vite plugin: exposes /__api/start-server and /__api/stop-server
 * to launch/kill the local Whisper Python server from the browser.
 */
function whisperServerLauncher(): Plugin {
  let serverProcess: ChildProcess | null = null;

  return {
    name: 'whisper-server-launcher',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'POST' && req.url === '/__api/start-server') {
          if (serverProcess && !serverProcess.killed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'already running' }));
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
            serverProcess = spawn(pythonExe, [scriptPath, '--port', '3000'], {
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
            res.end(JSON.stringify({ ok: true, message: 'started' }));
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
          res.end(JSON.stringify({ running: !!(serverProcess && !serverProcess.killed) }));
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
    proxy: {
      '/whisper': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/whisper/, ''),
      },
    },
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
