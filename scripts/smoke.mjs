// Headless run of tests/smoke.html (the UI smoke test). Usage: npm run smoke
// Needs the Playwright browsers: `npx playwright install chromium firefox webkit` once.
// Engines: SMOKE_BROWSERS=chromium,firefox,webkit (default chromium); SMOKE_DEVICE='iPhone 13' emulates touch.
import { chromium, firefox, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API_BASE } from '../src/cloud.js';

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
    const context = await browser.newContext({ ...(dev ? devices[dev] : {}), locale: 'en-US' });
    // The live API stays out of it: an empty leaderboard snapshot, signed out for everything else (and no CORS error
    // from a localhost page, which WebKit reports as a page error).
    await context.route(url => url.href.startsWith(API_BASE + '/'), route => route.fulfill({
      status: route.request().url().endsWith('/boards') ? 200 : 401,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: route.request().url().endsWith('/boards') ? '{"rules":0,"built":0,"boards":{}}' : '{"error":"sign in"}',
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/tests/smoke.html`);
    await page.waitForFunction(() => /\d+ passed, \d+ failed/.test(document.getElementById('out').textContent), null, { timeout: 90000 });
    const out = await page.evaluate(() => document.getElementById('out').textContent);
    console.log(`[${name}${dev ? ' / ' + dev : ''}]`, out.split('\n').filter(l => !l.startsWith('PASS')).join('\n').trim());
    for (const l of out.split('\n').filter(l => l.startsWith('WARN'))) console.log(`::warning title=Smoke test (${name})::${l.slice(5)}`);
    if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
    ok = /, 0 failed/.test(out) && !errors.length;
    if (ok) ok = await adminSmoke(context, name);
  } catch (e) {
    console.error(`smoke test could not run (${name}):`, e.message);
  } finally {
    if (browser) await browser.close();
  }
  return ok;
}
// Dev mode (?dev) adds the Admin app as the 7th menu item; it unlocks with a token the (faked) API accepts.
async function adminSmoke(context, name) {
  const json = (route, status, body) => route.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await context.route(url => url.href.startsWith(API_BASE + '/admin/'), route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
    if (req.headers().authorization !== 'Bearer tok') return json(route, 404, { error: 'not found' });
    if (path === '/admin/flagged') return json(route, 200, { runs: [] });
    if (path === '/admin/players') return json(route, 200, { players: [{ id: 'u1', name: 'Ann', hidden: 0, banned: 0, created: 1, runs: 2 }] });
    return json(route, 404, { error: 'not found' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const text = sel => page.locator(sel).first().innerText();
  const fail = why => { console.log(`[${name}] admin smoke failed: ${why}`, errors.join(' | ')); return false; };
  try {
    await page.goto(`http://127.0.0.1:${port}/?dev`);
    await page.evaluate(() => { window.__ringbeat.settings.tutorialDone = true; });
    await page.keyboard.press('Space');
    await page.waitForSelector('#mm-title');
    await page.keyboard.press('7');
    if ((await text('#mm-title')) !== 'Admin') return fail('no Admin menu item');
    await page.evaluate(() => document.getElementById('mm-go').click());
    await page.fill('#ad-token', 'nope');
    await page.click('[data-act=unlock]');
    await page.waitForFunction(() => document.getElementById('ad-msg').textContent === 'Wrong token');
    await page.fill('#ad-token', 'tok');
    await page.click('[data-act=unlock]');
    await page.click('[data-act=players]');
    await page.waitForSelector('[data-act=player]');
    if (!(await text('[data-act=player]')).includes('Ann')) return fail('player row missing');
    if (errors.length) return fail('page errors');
    console.log(`[${name}] admin smoke ok`);
    return true;
  } catch (e) { return fail(e.message); } finally { await page.close(); }
}
try {
  await new Promise(r => setTimeout(r, 500));
  for (const n of names) if (!(await run(n))) code = 1;
} finally {
  server.kill();
}
process.exit(code);
