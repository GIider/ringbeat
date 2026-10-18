// Cut-off text audit: loads the app in each language and viewport, visits the screens and lists every element whose text
// is clipped (scrollWidth > clientWidth under overflow:hidden) without the marquee, or that sticks out of the LCD.
// Exits 1 when something is cut off (it runs as part of `npm test`). Usage: npm run audit:overflow   (AUDIT_LANGS=en,de AUDIT_BROWSER=chromium)
import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API_BASE } from '../src/cloud.js';
import { fixture } from './lib/screenshot-fixture.mjs';

const port = 20000 + Math.floor(Math.random() * 10000);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
const engines = { chromium, firefox, webkit };
const LANGS = (process.env.AUDIT_LANGS || 'en,de').split(',');
const LOCALES = { en: 'en-US', de: 'de-DE' };
// LCDs below 470px use the 20px font, 480+ the 30px one; 900x1100 is the framed desktop view (wide picker), 1024x600 a small desktop window
const VIEWPORTS = [[320, 640], [360, 740], [480, 800], [900, 1100], [1024, 600]];
const DEMOS = ['menu', 'select', 'info', 'pause', 'results', 'fc', 'settings', 'stats', 'message'];
const JOBS = Number(process.env.AUDIT_JOBS) || 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// two animation frames: the click handler's DOM changes have been laid out and painted
const click = async (page, sel) => { await page.evaluate(async sel => { document.querySelector(sel)?.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, sel); };
// one saved song with a long name, so My songs, the song menu and the Custom category are exercised
const SEED_SONG = [{ uid: 'audit1', name: 'My Extremely Long Custom Song', rtttl: 'My Extremely Long Custom Song:d=4,o=5,b=140:c,d,e,f,g,a,b,c6,c6,b,a,g,f,e,d,c' }];

// Clipped on purpose: screen-reader text, song titles (ellipsis, and the cursor row scrolls), the star bar's mask pieces.
const BY_DESIGN = '.sr, .song-row .t, .stars-bar *, .sel-tabs *'; // .sel-tabs scrolls sideways

// Runs in the page: every clipped or protruding element of the visible screen, the status bar and the soft keys.
function scan(BY_DESIGN) {
  const bar = document.querySelector('.statusbar');
  const lcd = bar.parentElement.getBoundingClientRect();
  const roots = [bar, document.querySelector('.softbar'), ...document.querySelectorAll('.screen:not([hidden])')].filter(Boolean);
  const bad = [];
  const seen = new Set();
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (seen.has(el) || el.matches(BY_DESIGN) || el.closest('[hidden]') || el.classList.contains('mq') || el.closest('.scrolls')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      // text that sticks out past an ancestor that clips it (an overflow:hidden panel, a flex cell...) without being a marquee
      let cut = false;
      if (![...el.childNodes].every(n => n.nodeType !== 3 || !n.textContent.trim())) {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        const tr = rg.getBoundingClientRect();
        for (let a = el.parentElement; a && !a.matches('.screen, .screens, .lcd, body'); a = a.parentElement) {
          if (getComputedStyle(a).overflowX === 'visible') continue;
          const ar = a.getBoundingClientRect();
          if (tr.right > ar.right + 1 || tr.left < ar.left - 1) cut = true;
          break;
        }
      }
      const clips = cut || (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !el.matches('.screen, .screens, .song-list, .hub-grid'));
      const out = r.left < lcd.left - 1 || r.right > lcd.right + 1;
      if (!clips && !out) continue;
      // a clipped container whose own text is not what overflows (e.g. a flex row) is reported through its children
      if (clips && !out && el.children.length && !el.matches('.sel-sub, .sel-head')) continue;
      const id = el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      bad.push({ sel: id, why: cut ? 'cut by its container' : clips ? `clipped ${el.scrollWidth}>${el.clientWidth}` : 'outside LCD', text: text.slice(0, 40) });
    }
  }
  return bad;
}

const report = [];
const reached = new Map(); // what each visit actually showed (AUDIT_VERBOSE=1 prints it), so a broken click path doesn't pass silently
async function visit(page, ctx, screen) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  reached.set(screen.replace(/\/.*|\d+\/\d+.*/, '') + '→' + await page.evaluate(() => [...document.querySelectorAll('.screen:not([hidden])')].map(e => e.id).join('+')), 1);
  for (const b of await page.evaluate(scan, BY_DESIGN)) report.push({ ...ctx, screen, ...b });
}

// One language at one viewport, in its own browser context.
async function auditCombo(browser, lang, w, h) {
  const context = await browser.newContext({ locale: LOCALES[lang] || lang, viewport: { width: w, height: h } });
  await context.route(url => url.href.startsWith(API_BASE + '/'), route => route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '{"error":"sign in"}' }));
  const ctx = { lang, vp: `${w}x${h}` };
  await context.addInitScript(songs => { try { if (!localStorage.getItem('ringbeat.songs.v1')) localStorage.setItem('ringbeat.songs.v1', JSON.stringify(songs)); } catch { /* storage blocked */ } }, SEED_SONG);
  const open = async q => {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/${q}`);
    await page.waitForSelector('.statusbar');
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  // the stats screen needs a played-in profile (the README player), or it only shows empty pages
  const fxContext = await browser.newContext({ locale: LOCALES[lang] || lang, viewport: { width: w, height: h } });
  await fxContext.route(url => url.href.startsWith(API_BASE + '/'), route => route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '{"error":"sign in"}' }));
  // ...with the long-named custom song and a few big play counts, so the Top list has rows to cut
  const run = { score: 91250, grade: 'S', accuracy: 97.2, maxCombo: 74, fc: true, ap: false, date: 1 };
  const fx = { ...fixture, 'ringbeat.songs.v1': SEED_SONG, 'ringbeat.scores.v1': { 'custom:audit1': { top: [run], plays: 1234567 }, nokia: { top: [run], plays: 987654 } } };
  await fxContext.addInitScript(fx => { for (const [k, v] of Object.entries(fx)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, fx);
  for (const kind of DEMOS) {
    const page = kind === 'stats' ? await (async () => { const pg = await fxContext.newPage(); await pg.goto(`http://127.0.0.1:${port}/index.html?demo=stats`); await pg.waitForSelector('.statusbar'); await pg.evaluate(() => document.fonts.ready); return pg; })() : await open(`index.html?demo=${kind}`);
    await visit(page, ctx, kind);
    if (kind === 'settings') {
      for (const tab of await page.$$eval('#set-tabs [data-tab]', b => b.map(x => x.dataset.tab))) {
        await click(page, `#set-tabs [data-tab=${tab}]`);
        await visit(page, ctx, 'settings/' + tab);
      }
      await click(page, '#btn-glyphs');
      await visit(page, ctx, 'glyphs');
      await click(page, '#btn-glyphs-back');
      await click(page, '#btn-sounds');
      await visit(page, ctx, 'sounds');
    }
    if (kind === 'info') {
      if (await page.$eval('#select', e => e.clientWidth < 800)) { // narrow LCD: the details are a view of their own
        await click(page, '.song-row.cur');
        await visit(page, ctx, 'select/details');
      }
      await click(page, '#sd-chips button:nth-child(4)'); // a chip explains its mod underneath
      await visit(page, ctx, 'select/mod hint');
    }
    if (kind === 'stats') {
      for (let i = 1; i < 6; i++) { await page.keyboard.press('ArrowRight'); await visit(page, ctx, 'stats/page ' + (i + 1)); }
    }
    if (kind === 'select') {
      // every category tab, then the two hubs
      const first = await page.$eval('#sel-cat', e => e.textContent);
      for (let i = 0; i < 12; i++) {
        await click(page, '#sel-arrow-r');
        await visit(page, ctx, 'select/' + (await page.$eval('#sel-cat', e => e.textContent)));
        if ((await page.$eval('#sel-cat', e => e.textContent)) === first) break;
      }
      await click(page, '#sel-cat');
      await visit(page, ctx, 'hub/categories');
      await page.keyboard.press('Escape');
      await click(page, '#sel-sort');
      await visit(page, ctx, 'hub/sort');
      await page.keyboard.press('Escape');
      await click(page, '#sel-find');
      await visit(page, ctx, 'select/find');
    }
    await page.close();
  }
  // every main menu item (the title is big type), the screen behind it, and the sub-screens that need a click or a saved song
  for (let i = 0; i < 6; i++) {
    const page = await open('index.html?demo=menu');
    for (let k = 0; k < i; k++) await click(page, '#mm-next');
    const title = await page.$eval('#mm-title', e => e.textContent);
    await visit(page, ctx, 'menu/' + title);
    await click(page, '#mm-go');
    await visit(page, ctx, 'open/' + title);
    if (i === 1) {
      await click(page, '#ms-new'); await visit(page, ctx, 'composer');
      await page.keyboard.press('Escape'); await click(page, '#ms-paste'); await visit(page, ctx, 'rtttl text');
      await page.keyboard.press('Escape');
      await click(page, '#ms-list button'); await visit(page, ctx, 'song menu');
    }
    if (i === 3) { await click(page, '#inbox-list button'); await visit(page, ctx, 'message'); }
    await page.close();
  }
  // screens that only show in a run or a first visit: the markup and its translations, unhidden by hand
  for (const id of ['title', 'tutprompt', 'loginprompt', 'tutorial', 'calib', 'profile', 'results', 'pause', 'admin', 'nowplaying']) {
    const page = await open('index.html?demo=menu');
    await page.evaluate(id => { for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== id; }, id);
    await visit(page, ctx, 'markup/' + id);
    await page.close();
  }
  await context.close();
  await fxContext.close();
}

async function run() {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(100); } }
  const browser = await engines[process.env.AUDIT_BROWSER || 'chromium'].launch();
  try {
    const combos = LANGS.flatMap(lang => VIEWPORTS.map(([w, h]) => [lang, w, h]));
    await Promise.all(Array.from({ length: Math.min(JOBS, combos.length) }, async () => {
      for (let c; (c = combos.shift());) await auditCombo(browser, ...c);
    }));
  } finally {
    await browser.close();
  }
}

try { await run(); } catch (e) { console.error('overflow audit could not run:', e.message); process.exitCode = 1; } finally { server.kill(); }
const uniq = new Map();
for (const r of report) uniq.set([r.lang, r.vp, r.screen, r.sel, r.text].join('|'), r);
if (uniq.size) console.table([...uniq.values()].map(r => ({ lang: r.lang, vp: r.vp, screen: r.screen, selector: r.sel, why: r.why, text: r.text })));
console.log(`${uniq.size} cut-off element(s)`);
if (uniq.size) process.exitCode = 1;
if (process.env.AUDIT_VERBOSE) console.log([...reached.keys()].sort().join('\n'));
