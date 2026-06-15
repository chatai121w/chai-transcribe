import { test, expect } from '@playwright/test';

test('Can browser reach localhost:3000 from localhost:8083?', async ({ page }) => {
  await page.goto('http://localhost:8083', { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  const result = await page.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:3000/health', { signal: AbortSignal.timeout(5000) });
      const json = await r.json();
      return { ok: r.ok, status: r.status, device: json.device, model: json.current_model };
    } catch(e: any) {
      return { error: e.message, name: e.name };
    }
  });
  
  console.log('HEALTH CHECK FROM BROWSER:', JSON.stringify(result, null, 2));
  
  // Also test through Vite proxy
  const proxyResult = await page.evaluate(async () => {
    try {
      const r = await fetch('/whisper/health', { signal: AbortSignal.timeout(5000) });
      const json = await r.json();
      return { ok: r.ok, status: r.status, device: json.device };
    } catch(e: any) {
      return { error: e.message, name: e.name };
    }
  });
  
  console.log('PROXY HEALTH CHECK:', JSON.stringify(proxyResult, null, 2));
});
