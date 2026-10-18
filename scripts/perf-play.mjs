// Plays real songs in headless Chromium with a keyboard bot and reports frame pacing from the in-page profiler.
// Usage: npm run perf:play [-- --songs 0,6,12 --seconds 30 --max-long 2 --max-p99 25]
// Needs the Playwright browser (`npx playwright install chromium`). Headless software rendering is slower than a real
// GPU, so use it for before/after comparisons on one machine, not as an absolute fps number.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const songs = arg('songs', '0,6,12').split(',').map(Number);
const seconds = +arg('seconds', 30);
const maxLongPct = +arg('max-long', 2);   // % of frames over 1.5x budget
const maxP99 = +arg('max-p99', 25);       // ms

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
let code = 1, browser;
try {
  await new Promise(r => setTimeout(r, 500));
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const rows = [];
  let bad = false;
  for (const idx of songs) {
    const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('ringbeat.perf', '1')); // the profiler on, as F3 leaves it
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__ringbeat, null, { timeout: 15000 });
    const info = await page.evaluate(async ([idx, seconds]) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const rb = window.__ringbeat, $ = id => document.getElementById(id);
      rb.settings.tutorialDone = true;
      await sleep(200);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      await sleep(200);
      $('mm-go').click();                     // menu -> Tones (song select)
      await sleep(300);
      const row = document.querySelectorAll('.song-row')[idx];
      row.click(); await sleep(150);
      row.click(); await sleep(250);          // second click = play (wide LCD) or the details view (narrow: Play button there)
      if (rb.state === 'select') {
        const go = $('sd-go');
        if (!go) return { error: 'no song details, state=' + rb.state };
        go.click();
      }
      for (let i = 0; i < 100 && !rb.game.active; i++) await sleep(50);
      if (!rb.game.active) return { error: 'song did not start, state=' + rb.state };
      const KEYS = { 3: ['KeyF', 'KeyJ', 'KeyK'], 4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'] };
      const g = rb.game, lanes = g.chart.lanes, notes = g.chart.notes;
      rb.perf.reset();
      let pi = 0; const rel = [];
      const t0 = performance.now();
      await new Promise(done => {
        const tick = () => {
          const t = g.songTime();
          while (pi < notes.length && notes[pi].time <= t) {
            const n = notes[pi++];
            window.dispatchEvent(new KeyboardEvent('keydown', { code: KEYS[lanes][n.lane], bubbles: true }));
            rel.push([n.time + (n.isHold || n.isRoll ? n.duration : 0.04), n.lane]);
          }
          for (let i = rel.length - 1; i >= 0; i--) if (rel[i][0] <= t) {
            window.dispatchEvent(new KeyboardEvent('keyup', { code: KEYS[lanes][rel[i][1]], bubbles: true }));
            rel.splice(i, 1);
          }
          if (!g.active || g.state === 'done' || performance.now() - t0 > seconds * 1000) done(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const r = rb.perf.report(), f = r.sections.frame || {};
      return { title: $('st-title').textContent, notes: notes.length, fps: r.fps, frames: r.frames, long: r.longFrames,
        p50: f.p50, p95: f.p95, p99: f.p99, max: f.max, draw: r.sections.draw && r.sections.draw.p99, update: r.sections.update && r.sections.update.p99,
        score: g.score, combo: g.maxCombo };
    }, [idx, seconds]);
    if (info.error) { console.error(`song ${idx}: ${info.error}`); bad = true; await page.close(); continue; }
    const longPct = 100 * info.long / Math.max(1, info.frames);
    rows.push({ song: idx, notes: info.notes, fps: +info.fps.toFixed(1), frames: info.frames, 'long %': +longPct.toFixed(2),
      'p50': +info.p50.toFixed(1), 'p95': +info.p95.toFixed(1), 'p99': +info.p99.toFixed(1), 'max': +info.max.toFixed(1),
      'draw p99': +(info.draw || 0).toFixed(2), 'update p99': +(info.update || 0).toFixed(2), combo: info.combo });
    if (longPct > maxLongPct || info.p99 > maxP99) bad = true;
    if (errors.length) { console.log('page errors:', [...new Set(errors)].join(' | ')); bad = true; }
    await page.close();
  }
  console.table(rows);
  console.log(bad ? `FAIL: thresholds long<=${maxLongPct}% p99<=${maxP99}ms` : 'ok');
  code = bad ? 1 : 0;
} catch (e) {
  console.error('perf:play could not run:', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(code);
