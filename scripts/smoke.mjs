// Headless run of tests/smoke.html (the UI smoke test). Usage: npm run smoke
// Needs the Playwright browser: `npx playwright install chromium` once.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
let code = 1, browser;
try {
  await new Promise(r => setTimeout(r, 500));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/tests/smoke.html`);
  await page.waitForFunction(() => /\d+ passed, \d+ failed/.test(document.getElementById('out').textContent), null, { timeout: 90000 });
  const out = await page.evaluate(() => document.getElementById('out').textContent);
  console.log(out.split('\n').filter(l => !l.startsWith('PASS')).join('\n').trim());
  if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
  code = /, 0 failed/.test(out) && !errors.length ? 0 : 1;
} catch (e) {
  console.error('smoke test could not run:', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(code);
