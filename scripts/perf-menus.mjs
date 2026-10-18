// Menu / UI interaction benchmark in headless Chromium (the menus are DOM, so node can't measure them).
// Usage: npm run perf:menus [-- --reps 3 --json out.json --baseline scripts/perf-menus-baseline.json --fail-over 50 --customs 30]
// Each scenario drives the real key handlers and reports, per interaction: `js` (the synchronous handler),
// `layout` (forced style+layout straight after it) and `frame` (time until the next animation frame callback, i.e. until
// the browser is ready to paint again). Layout/style recalc counts come from CDP Performance.getMetrics.
// Headless software rendering is slower than a real GPU: compare before/after on one machine, not absolute numbers.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const reps = +arg('reps', 3), customs = Math.min(30, +arg('customs', 30));
const jsonOut = arg('json'), basePath = arg('baseline'), failOver = arg('fail-over');

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });

// Runs inside the page. Returns { name: { samples:{js,layout,frame}, metrics } } for every scenario.
async function scenarios({ customs }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const raf = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));
  const rb = window.__ringbeat;
  // Synthetic Enter does not activate focused buttons (only real key presses do), so confirm the way the game does.
  const key = (code, k = '') => {
    if (code === 'Enter') {
      if (rb.state === 'menu') document.getElementById('mm-go').click();
      else if (document.activeElement && document.activeElement !== document.body) document.activeElement.click();
      return;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: k || code, bubbles: true }));
  };
  const settle = async () => { await raf(); await raf(); };
  const out = {};
  // One interaction = a list of key presses; every press is measured separately.
  async function run(name, presses, { setup, warm = 2 } = {}) {
    if (setup) { await setup(); await settle(); }
    const js = [], layout = [], frame = [];
    for (let i = 0; i < presses.length + warm; i++) {
      const [code, k] = presses[i % presses.length];
      await settle();
      const t0 = performance.now();
      key(code, k);
      const t1 = performance.now();
      document.body.getBoundingClientRect(); // force style + layout
      const t2 = performance.now();
      const t3 = await raf();
      if (i >= warm) { js.push(t1 - t0); layout.push(t2 - t1); frame.push(t3 - t0); }
    }
    out[name] = { js, layout, frame };
  }
  // Frame times while nothing is pressed (animations, cameos).
  async function idle(name, ms, setup) {
    if (setup) { await setup(); await settle(); }
    const frame = [];
    let last = await raf();
    const end = last + ms;
    while (last < end) { const t = await raf(); frame.push(t - last); last = t; }
    out[name] = { frame };
  }
  const toTitle = async () => { for (let i = 0; i < 20 && rb.state !== 'title'; i++) { key('Escape'); await sleep(60); } };
  const toMenu = async () => { await toTitle(); key('Space', ' '); await sleep(250); };
  const toSelect = async () => { await toMenu(); key('Digit1', '1'); key('Enter'); await sleep(500); if (rb.state !== 'select') throw new Error('select not reached: ' + rb.state); };

  rb.settings.tutorialDone = true;
  await sleep(300);

  await run('menu: scroll icons (Down x24)', Array.from({ length: 24 }, () => ['ArrowDown']), { setup: toMenu });
  await run('menu: jump by number key', '123456'.split('').map(c => ['Digit' + c, c]), { setup: toMenu });
  await idle('menu: idle 2 s (icon animation)', 2000, toMenu);
  await run('select: open + back (Enter/Esc)', [['Enter'], ['Escape']], { setup: toMenu, warm: 4 });
  await run('select: scroll list (Down x30)', Array.from({ length: 30 }, () => ['ArrowDown']), { setup: toSelect });
  await run('select: scroll list up (Up x30)', Array.from({ length: 30 }, () => ['ArrowUp']));
  await run('select: cycle category ([ ] x8)', Array.from({ length: 8 }, () => ['BracketRight']));
  // Pin the view: the category cycle above ends wherever the number of category tabs happens to leave it.
  const onAll = () => { rb.settings.view.category = 'all'; };
  await run('select: jump groups (K x6)', Array.from({ length: 6 }, () => ['KeyK']), { setup: onAll });
  await run('select: cycle sort (F x6)', Array.from({ length: 6 }, () => ['KeyF']));
  await idle('select: idle 2 s (preview + cameo)', 2000);
  await run('stats: open + flip pages', [['Enter'], ['ArrowRight'], ['ArrowRight'], ['ArrowRight'], ['ArrowRight'], ['ArrowLeft'], ['ArrowLeft'], ['ArrowLeft'], ['ArrowLeft'], ['Escape']],
    { setup: async () => { await toMenu(); key('Digit3', '3'); await sleep(200); }, warm: 0 });
  // Every built-in and custom song has a score, so the Top page lists them all and each long title goes through the marquee.
  await run('stats: Top page, every song played (flip)', [['Enter'], ['ArrowRight'], ['ArrowRight'], ['ArrowRight'], ['ArrowLeft'], ['ArrowLeft'], ['ArrowLeft'], ['Escape']], {
    setup: async () => {
      const { buildLibrary, customEntry } = await import('/src/library.js');
      const ids = buildLibrary().map(e => e.id);
      for (const s of JSON.parse(localStorage.getItem('ringbeat.songs.v1') || '[]')) ids.push(customEntry(s.rtttl).id);
      ids.forEach((id, i) => { rb.scores.record(id, { score: 1000 + i, grade: 'B', accuracy: 90, maxCombo: 10 }); });
      await toMenu(); key('Digit3', '3'); await sleep(200);
    }, warm: 0 });
  await run('inbox: open + back', [['Enter'], ['ArrowDown'], ['ArrowUp'], ['Escape']],
    { setup: async () => { await toMenu(); key('Digit4', '4'); await sleep(200); }, warm: 0 });
  await run('settings: open + back', [['Enter'], ['Escape']],
    { setup: async () => { await toMenu(); key('Digit6', '6'); await sleep(200); }, warm: 2 });
  await toTitle();
  return out;
}

const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const stat = a => ({ n: a.length, mean: mean(a), p50: q(a, 0.5), p95: q(a, 0.95), max: Math.max(...a) });

let code = 1, browser;
try {
  await new Promise(r => setTimeout(r, 500));
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = {};
  const merge = (name, part) => { const r = results[name] ||= {}; for (const k in part) (r[k] ||= []).push(...part[k]); };
  const metrics = {};
  for (let rep = 0; rep < reps; rep++) {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 1000 } });
    // Seed the personal library so My songs / Tones carry custom songs as well.
    await ctx.addInitScript(n => {
      try {
        const rt = (i) => `cust${i}:d=8,o=${5 + (i % 2)},b=${100 + i * 5}:c,e,g,${i % 3 ? 'a' : 'p'},c6,g,e,c,d,f,a,c6,a,f,d,4c`;
        localStorage.setItem('ringbeat.songs.v1', JSON.stringify(Array.from({ length: n }, (_, i) => ({ uid: 'u' + i, name: 'Custom ' + i + ' with a deliberately long title that must scroll', rtttl: rt(i), updated: i }))));
      } catch { /* ignore */ }
    }, customs);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__ringbeat, null, { timeout: 15000 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const res = await page.evaluate(scenarios, { customs });
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    for (const k of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']) metrics[k] = (metrics[k] || 0) + (m1[k] - m0[k]);
    for (const [name, part] of Object.entries(res)) merge(name, part);
    if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
    await ctx.close();
  }
  const base = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  const rows = [], saved = {};
  let worst = 0;
  for (const [name, r] of Object.entries(results)) {
    const f = stat(r.frame);
    const row = { scenario: name, n: f.n };
    if (r.js) { const j = stat(r.js), l = stat(r.layout); row['js mean'] = +j.mean.toFixed(2); row['js max'] = +j.max.toFixed(2); row['layout mean'] = +l.mean.toFixed(2); row['layout max'] = +l.max.toFixed(2); }
    row['frame mean'] = +f.mean.toFixed(2); row['frame p95'] = +f.p95.toFixed(2); row['frame max'] = +f.max.toFixed(2);
    // Interactive cost = handler + layout (frame includes the idle wait for rAF); idle scenarios compare frame times.
    const cost = r.js ? mean(r.js) + mean(r.layout) : f.mean;
    saved[name] = { cost, frameP95: f.p95, frameMax: f.max };
    if (base && base[name]) { const d = (cost / base[name].cost - 1) * 100; row['Δ% cost'] = +d.toFixed(1); worst = Math.max(worst, d); }
    rows.push(row);
  }
  console.table(rows);
  console.log('browser totals:', Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, k.endsWith('Count') ? v : +(v * 1000).toFixed(0) + ' ms'])));
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(saved, null, 1) + '\n'); console.log('wrote', jsonOut); }
  code = failOver != null && base && worst > +failOver ? 1 : 0;
  if (code) console.error(`regression: worst scenario ${worst.toFixed(1)}% slower than baseline (limit ${failOver}%)`);
} catch (e) {
  console.error('perf:menus could not run:', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(code);
