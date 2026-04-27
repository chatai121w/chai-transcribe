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
    port: 4000,
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
    include: ['react', 'react-dom', 'fix-webm-duration', 'dexie'],
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core', '@ffmpeg/util', '@shiguredo/rnnoise-wasm'],
  },
  build: {
    // Avoid rare esbuild minification scoping bugs in large React chunks.
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React framework
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI component library
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-tooltip', '@radix-ui/react-select', '@radix-ui/react-tabs'],
          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
          // Heavy utilities
          'vendor-utils': ['jszip', 'file-saver', 'lucide-react'],
          // Heavy libraries — split for better caching
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf'],
          'vendor-docx': ['docx'],
          'vendor-ai': ['@huggingface/transformers'],
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
