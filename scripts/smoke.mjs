// Headless run of tests/smoke.html (the UI smoke test). Usage: npm run smoke
// Needs the Playwright browsers: `npx playwright install chromium firefox webkit` once.
// Engines: SMOKE_BROWSERS=chromium,firefox,webkit (default chromium); SMOKE_DEVICE='iPhone 13' emulates touch.
import { chromium, firefox, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API_BASE } from '../src/cloud.js';
import { SONGS } from '../src/songs.js';

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
    if (ok) ok = await boardsSmoke(context, name);
    if (ok) ok = await resultsEnterSmoke(context, name);
    if (ok) ok = await listWrapSmoke(context, name);
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
    // Without ?dev the item comes from the signed-in profile's dev flag (the API is unreachable here, so it stays signed in).
    for (const dev of [true, false]) {
      const p2 = await context.newPage();
      await p2.route(url => url.href.startsWith(API_BASE) && !url.pathname.startsWith('/admin/'), r => r.abort());
      await p2.addInitScript(d => localStorage.setItem('ringbeat.cloud.v1', JSON.stringify({ token: 'x', profile: { id: 'u', name: 'Me', logins: ['github'], ...(d && { dev: true }) } })), dev);
      await p2.goto(`http://127.0.0.1:${port}/`);
      await p2.evaluate(() => { window.__ringbeat.settings.tutorialDone = true; });
      await p2.keyboard.press('Space');
      await p2.waitForSelector('#mm-title');
      await p2.keyboard.press('7');
      const title = await p2.locator('#mm-title').innerText();
      const who = await p2.locator('#st-title').innerText();
      await p2.close();
      if (who !== 'Me') return fail(`signed-in menu shows "${who}" in the title bar instead of the player name`);
      if ((title === 'Admin') !== dev) return fail(`Admin item ${dev ? 'missing for' : 'shown to'} a ${dev ? 'dev' : 'non-dev'} profile`);
    }
    // Back from signing in: the rings intro (not the title) while the code is exchanged, then the menu with the name, no key needed.
    for (const good of [true, false]) {
      const p3 = await context.newPage();
      await p3.route(url => url.href.startsWith(API_BASE), r => r.abort()); // other calls fail offline: signed in stays signed in
      await p3.route(url => url.href.startsWith(API_BASE + '/auth/exchange'), r => (r.request().method() === 'OPTIONS'
        ? r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
        : good
        ? json(r, 200, { token: 'tok', profile: { id: 'u', name: 'Neo', logins: ['github'] } })
        : json(r, 401, { error: 'bad code' })));
      await p3.goto(`http://127.0.0.1:${port}/#login=${'a'.repeat(24)}`);
      if (good) {
        await p3.waitForSelector('#welcome:not([hidden])');
        await p3.waitForFunction(() => { const c = document.getElementById('welcome-fx'); return c.width > 40 && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v); }, null, { timeout: 4000 }); // the scene paints the LCD
        await p3.waitForSelector('#mm-title', { timeout: 9000 });
        if (await p3.evaluate(() => !document.getElementById('welcome-fx').hidden)) { await p3.close(); return fail('intro left its canvas behind'); }
        const who = await p3.locator('#st-title').innerText();
        if (who !== 'Neo') { await p3.close(); return fail(`sign-in intro ended with "${who}" in the title bar`); }
      } else {
        await p3.waitForSelector('#title:not([hidden])', { timeout: 6000 });
        // the title's ringing phone paints its canvas, and the canvas goes away with the title
        await p3.waitForFunction(() => { const c = document.getElementById('title-fx'); return !c.hidden && c.width > 40 && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v); }, null, { timeout: 4000 });
        await p3.keyboard.press('Space');
        await p3.waitForSelector('#mm-title');
        if (await p3.evaluate(() => !document.getElementById('title-fx').hidden)) { await p3.close(); return fail('title canvas left behind after leaving the title'); }
      }
      await p3.close();
    }
    await page.goto(`http://127.0.0.1:${port}/?dev`);
    await page.evaluate(() => { window.__ringbeat.settings.tutorialDone = true; });
    await page.keyboard.press('Space');
    await page.waitForSelector('#mm-title');
    await page.keyboard.press('7');
    if ((await text('#mm-title')) !== 'Admin') return fail('no Admin menu item');
    if ((await text('#st-title')) !== '') return fail('signed-out menu has a title bar label');
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
// The stand-alone World boards page: list, board detail, keyboard, tabs and the one-pane phone layout (the API is faked).
async function boardsSmoke(context, name) {
  const run = (rank, name, score, extra = {}) => ({ rank, total: 2, name, score, grade: 'A', accuracy: 0.9, maxCombo: 40, fc: false, ap: false, mods: [], playedAt: 1700000000000, ...extra });
  const first = SONGS[0].id;
  const json = (route, body) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await context.route(url => url.href.startsWith(API_BASE + '/board'), route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/boards') return json(route, { rules: 1, built: Date.now() - 5000, boards: { [first + '|normal']: [run(1, 'Ann', 900, { fc: true })] } });
    return json(route, { rules: 1, runs: [run(1, 'Ann', 900, { fc: true }), run(2, 'Bo', 800)] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fail = why => { console.log(`[${name}] boards smoke failed: ${why}`, errors.join(' | ')); return false; };
  try {
    await page.goto(`http://127.0.0.1:${port}/boards.html`);
    await page.waitForSelector('.bd-row');
    const rows = await page.locator('.bd-row').count();
    if (rows < 100) return fail('song list too short: ' + rows);
    if (!(await page.locator('.bd-row .lead').filter({ hasText: 'Ann' }).count())) return fail('leader missing from the list');
    await page.locator('.bd-row .lead', { hasText: 'Ann' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.bd-table tbody tr').length === 2);
    await page.keyboard.press('ArrowDown');
    if ((await page.evaluate(() => window.__boards.cur)) === first) return fail('ArrowDown kept the cursor');
    const cat = () => page.locator('#bd-cats [aria-selected=true]').innerText();
    await page.keyboard.press(']');
    if ((await cat()) === 'All') return fail('] did not change the category');
    await page.keyboard.press('[');
    if ((await cat()) !== 'All') return fail('[ did not wrap back');
    await page.keyboard.press('d');
    if ((await page.locator('#bd-diff [aria-selected=true]').innerText()) !== 'Hard') return fail('d did not switch to Hard');
    await page.keyboard.press('d');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator('.bd-row').first().click();
    await page.waitForSelector('.bd.open .bd-detail');
    if (await page.locator('.bd-list').isVisible()) return fail('list stayed visible next to an open board');
    await page.click('#bd-soft-r');
    await page.waitForSelector('.bd:not(.open) .bd-list');
    if (errors.length) return fail('page errors');
    console.log(`[${name}] boards smoke ok`);
    return true;
  } catch (e) { return fail(e.message); } finally { await page.close(); }
}
// Regression: clicking a results tab used to leave focus on it, so Enter re-clicked the tab instead of the lit footer button.
async function resultsEnterSmoke(context, name) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fail = why => { console.log(`[${name}] results-enter smoke failed: ${why}`, errors.join(' | ')); return false; };
  try {
    await page.goto(`http://127.0.0.1:${port}/?demo=results`);
    await page.waitForFunction(() => window.__ringbeat && window.__ringbeat.state === 'results', null, { timeout: 15000 });
    await page.evaluate(() => { window.__retries = 0; document.getElementById('btn-retry').addEventListener('click', e => { window.__retries++; e.stopImmediatePropagation(); }, true); });
    for (const tab of ['0', '1', '2']) {
      if (tab !== '0') await page.keyboard.press('ArrowRight'); // only the current tab is drawn, so click that one
      await page.click('#r-tabs .sel');
      if (await page.evaluate(() => !!document.activeElement.closest('#r-tabs'))) return fail(`tab ${tab} kept focus`);
      const before = await page.evaluate(() => window.__retries);
      await page.keyboard.press('Enter');
      if ((await page.evaluate(() => window.__retries)) !== before + 1) return fail(`Enter after clicking tab ${tab} did not hit the highlighted button`);
      if ((await page.evaluate(() => document.querySelector('#r-tabs .sel').dataset.page)) !== tab) return fail('Enter changed the tab');
    }
    if (errors.length) return fail('page errors');
    console.log(`[${name}] results-enter smoke ok`);
    return true;
  } catch (e) { return fail(e.message); } finally { await page.close(); }
}
// Up from the first song wraps to the last song (it used to open the category hub); the hub stays on G.
async function listWrapSmoke(context, name) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const fail = why => { console.log(`[${name}] list-wrap smoke failed: ${why}`, errors.join(' | ')); return false; };
  const cur = () => page.evaluate(() => ({ state: window.__ringbeat.state, id: (document.querySelector('#song-list .cur') || {}).dataset?.id, ids: Array.from(document.querySelectorAll('#song-list > *')).map(b => b.dataset.id).filter(Boolean) }));
  try {
    await page.addInitScript(() => localStorage.setItem('ringbeat.settings.v1', JSON.stringify({ tutorialDone: true })));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__ringbeat && window.__ringbeat.state === 'title', null, { timeout: 15000 });
    await page.evaluate(() => { window.__ringbeat.settings.tutorialDone = true; });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__ringbeat.state === 'menu', null, { timeout: 5000 });
    await page.keyboard.press('Digit1');
    await page.evaluate(() => document.getElementById('mm-go').click());
    await page.waitForFunction(() => window.__ringbeat.state === 'select', null, { timeout: 5000 });
    // jump to the first song, then let the 400 ms "fresh press" guard pass
    for (let i = 0; i < 100 && (await cur()).id !== (await cur()).ids[0]; i++) { await page.keyboard.press('PageUp'); await page.waitForTimeout(30); }
    await page.waitForTimeout(500);
    let c = await cur();
    if (c.id !== c.ids[0]) return fail('could not reach the first song ' + JSON.stringify({ ...c, ids: c.ids.slice(0, 3), n: c.ids.length }));
    await page.keyboard.press('ArrowUp');
    c = await cur();
    if (c.state !== 'select') return fail(`Up from the first song left the list (${c.state})`);
    if (c.id !== c.ids[c.ids.length - 1]) return fail('Up from the first song did not land on the last song');
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => document.getElementById('hub-grid').children.length > 0, null, { timeout: 3000 }).catch(() => {});
    if (!(await page.evaluate(() => document.getElementById('hub-grid').children.length))) return fail('G no longer opens the category hub');
    if (errors.length) return fail('page errors');
    console.log(`[${name}] list-wrap smoke ok`);
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
