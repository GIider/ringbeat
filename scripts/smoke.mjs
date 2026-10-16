// Headless run of tests/smoke.html (the UI smoke test). Usage: npm run smoke
// Needs the Playwright browsers: `npx playwright install chromium firefox webkit` once.
// Engines: SMOKE_BROWSERS=chromium,firefox,webkit (default chromium); SMOKE_DEVICE='iPhone 13' emulates touch.
import { chromium, firefox, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
const engines = { chromium, firefox, webkit };
const names = (process.env.SMOKE_BROWSERS || 'chromium').split(',');
let code = 0;
async function run(name) {
  let browser, ok = false;
  try {
    browser = await engines[name].launch();
    const dev = process.env.SMOKE_DEVICE;
    // locale pinned: the app follows the browser language, which otherwise comes from the host's $LANG
    const page = await (await browser.newContext({ ...(dev ? devices[dev] : {}), locale: 'en-US' })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/tests/smoke.html`);
    await page.waitForFunction(() => /\d+ passed, \d+ failed/.test(document.getElementById('out').textContent), null, { timeout: 90000 });
    const out = await page.evaluate(() => document.getElementById('out').textContent);
    console.log(`[${name}${dev ? ' / ' + dev : ''}]`, out.split('\n').filter(l => !l.startsWith('PASS')).join('\n').trim());
    if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
    ok = /, 0 failed/.test(out) && !errors.length;
  } catch (e) {
    console.error(`smoke test could not run (${name}):`, e.message);
  } finally {
    if (browser) await browser.close();
  }
  return ok;
}
try {
  await new Promise(r => setTimeout(r, 500));
  for (const n of names) if (!(await run(n))) code = 1;
} finally {
  server.kill();
}
process.exit(code);
