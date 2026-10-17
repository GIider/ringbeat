// Speed micro-benchmarks for the pure modules + a headless render pass.
// Usage: npm run perf [-- --filter chart] [--json out.json] [--baseline scripts/perf-baseline.json] [--fail-over 25] [--fail-over-max 100]
// Timings are machine-specific; compare against a baseline recorded on the same machine.
// Run through node --expose-gc (npm run perf does) to also get approximate bytes allocated per iteration.
// 'frames' cases replay a whole song at 60 Hz and report per-frame percentiles: stutter is about the worst frame, not the mean.
import { readFileSync, writeFileSync } from 'node:fs';
import { SONGS } from '../src/songs.js';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { DIFFICULTIES, buildLibrary } from '../src/library.js';
import { scaleChart } from '../src/mods.js';
import { applyView, SORTS } from '../src/listview.js';
import { encodeSong, decodeSong } from '../src/share.js';
import { createScores } from '../src/scores.js';
import { customEntry } from '../src/library.js';
import { MAX_RTTTL } from '../src/mysongs.js';
import { runBot, LADDER } from '../src/bot.js';
import { Game } from '../src/game.js';
import { menuFrame, menuFrames, MENU_IDS } from '../src/menuicons.js';
import { spriteSVG, spriteURL, spriteHTML, compose, SPRITES } from '../src/pixelart.js';
import { coverRows } from '../src/cover.js';
import { CAMEOS } from '../src/cameo.js';
import { eventAudioTime } from '../src/input.js';
import { Calibration } from '../src/calibration.js';
import { Pad } from '../src/gamepad.js';
import { createStats, gradeTally, topSongs, favourite } from '../src/stats.js';

const arg = (name, def = null) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const filter = arg('filter'), jsonOut = arg('json'), basePath = arg('baseline'), failOver = arg('fail-over'), failOverMax = arg('fail-over-max');

// ---- fixtures ----
const parsed = SONGS.map(s => parseRTTTL(s.rtttl));
const charts = parsed.map(p => generateChart(p, { difficulty: 'normal' }));
const longest = charts.reduce((a, c) => (c.notes.length > a.notes.length ? c : a));
const lib = buildLibrary();
const scores = createScores({ getItem: () => null, setItem() {}, removeItem() {} });
const memStore = SONGS[0].rtttl;

// Fake DOM/canvas so Renderer runs in node; the context counts calls instead of drawing.
let canvasCalls = 0;
// The stub functions are shared so the fixture itself allocates nothing (alloc B/call then reflects the code under test).
const stubGradient = { addColorStop() { canvasCalls++; } };
const countCall = function () { canvasCalls++; };
const makeGradient = function () { canvasCalls++; return stubGradient; };
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? makeGradient : countCall),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, devicePixelRatio: 1 };
// Offscreen canvases (text sprites, static layer) are counted like the visible one.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const mkCanvas = (w, h) => ({ getContext: () => ctx, clientWidth: w, clientHeight: h, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0 }) });
const canvas = { getContext: () => ctx, clientWidth: 330, clientHeight: 300, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0 }) };
const { Renderer } = await import('../src/render.js');
const { Synth } = await import('../src/synth.js');

// Counts audio-graph nodes created per playNote (fake context).
let audioNodes = 0;
const node = () => { audioNodes++; return { connect: n => n, disconnect() {}, start() {}, stop() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, value: 0 }, frequency: {}, detune: {}, Q: {} }; };
const fakeCtx = { currentTime: 0, createOscillator: node, createGain: node, createBiquadFilter: node };
const synthFx = new Synth(); synthFx.ctx = fakeCtx; synthFx.bus = node(); synthFx.voice = 'smooth';
const buzzFx = new Synth(); buzzFx.ctx = fakeCtx; buzzFx.bus = node(); buzzFx.voice = 'buzzer';

function fakeSynth(clock) {
  return { ctx: clock, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
}
const cloneChart = c => ({ ...c, notes: c.notes.map(n => ({ ...n })) });
function renderFixture(cv = canvas) {
  const r = new Renderer(cv);
  const g = new Game(fakeSynth({ currentTime: 0, suspend() {}, resume() {} }));
  g.fx = r.fx;
  const chart = cloneChart(longest);
  g.start(chart, { leadIn: 1, backing: false });
  clearInterval(g.timer);
  r.setLanes(chart.lanes || 4, []);
  r.resetState();
  return { r, g, t: chart.length / 2, chart };
}
const rf = renderFixture();
const rfSmall = renderFixture(mkCanvas(200, 180));
const rfLarge = renderFixture(mkCanvas(660, 600));

// Busiest moment of the longest chart: most notes inside the scroll window.
const worstT = (() => {
  let best = 0, bestN = -1;
  const sc = rf.r.scrollTime;
  for (let t = 0; t < longest.length; t += 0.1) {
    let n = 0;
    for (const x of longest.notes) if (x.time >= t && x.time <= t + sc) n++;
    if (n > bestN) { bestN = n; best = t; }
  }
  return best;
})();

// Replays a whole song at 60 Hz with a perfect-ish player. Returns per-frame ms for each phase.
function playSong(chartSrc, { draw = true } = {}) {
  const clock = { currentTime: 0, suspend() {}, resume() {} };
  const r = new Renderer(canvas);
  const g = new Game(fakeSynth(clock));
  g.fx = r.fx;
  const chart = cloneChart(chartSrc);
  g.start(chart, { leadIn: 0, backing: false });
  clearInterval(g.timer);
  r.setLanes(chart.lanes || 4, []);
  r.resetState();
  const ev = [];
  for (const n of chart.notes) ev.push([n.time + 0.004, 1, n.lane], [n.time + (n.isHold ? n.duration : 0.05), 0, n.lane]);
  ev.sort((a, b) => a[0] - b[0]);
  const N = Math.ceil((chart.length + 1) / (1 / 60));
  const upd = new Float64Array(N), drw = new Float64Array(N), prs = [];
  let e = 0;
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  for (let f = 0; f < N; f++) {
    const t = f / 60;
    clock.currentTime = t;
    while (e < ev.length && ev[e][0] <= t) {
      const [, down, lane] = ev[e++];
      const a = now();
      if (down) { g.press(lane, t); prs.push(now() - a); } else g.release(lane, t);
    }
    let a = now();
    g.update(t);
    upd[f] = now() - a;
    if (draw) { a = now(); r.draw(g, t); drw[f] = now() - a; }
  }
  return { update: upd, draw: drw, press: Float64Array.from(prs) };
}


// ---- hit-indicator / menu / animation fixtures ----
const perfectHit = (r, lane) => r.fx.judge(lane, 'perfect');
// Every juice effect live at once: rings, debris, punch, labels (typewriter phase), shake, strike, milestone frame, holds.
function armStorm(r, g) {
  const now = performance.now() / 1000;
  const js = ['perfect', 'great', 'good', 'miss'];
  r.lastCombo = 20; r._comboTxt = '20';
  for (let i = 0; i < r.lanes; i++) { r.fx.press(i); r.fx.judge(i, js[i & 3]); }
  r.fx.judge(0, 'miss');
  r.fx.judge(1, 'perfect'); r.fx.judge(2, 'perfect');
  r.frameT = now; r.popT = now; r.bumpT = now;
  g.holds = Array.from({ length: r.lanes }, () => ({}));
}
function disarm(r, g) { r.resetState(); g.holds = new Array(r.lanes).fill(null); }
const rfStorm = renderFixture();
const rfHolds = renderFixture();
const rfCalm = renderFixture();
rfCalm.r.juice = false;
const rfReduced = renderFixture();
rfReduced.r.reduced = true;
const chipTexts = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

// Seeded rng so cameo runs are identical between benchmark runs.
const seeded = seed => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 374761393 | 0) >>> 0) / 4294967296;
// 1000 imported songs-worth of scores for the stats recompute.
const statEntries = Array.from({ length: 400 }, (_, i) => ({
  id: 's' + i, diff: i & 1 ? 'hard' : 'normal', plays: 3 + (i % 7), fc: i % 5 === 0, ap: i % 11 === 0,
  best: { score: 100000 + i, grade: 'SABCD'[i % 5] },
  top: Array.from({ length: 5 }, (_, k) => ({ score: 90000 + i * k, maxCombo: 50 + k, date: 1.7e12 + i * 8.64e7, grade: 'SABCD'[(i + k) % 5] })),
}));
const bigLib = (() => {
  const cats = ['classical', 'pop', 'dance', 'ndw', 'screen', 'videogame', 'folk'];
  return Array.from({ length: 500 }, (_, i) => ({ ...lib[i % lib.length], id: (i < lib.length ? '' : 'custom:') + lib[i % lib.length].id + i, category: cats[i % cats.length] }));
})();
let sink = 0; // keeps results of pure calls alive

// A max-length custom song (the biggest chart a player can import).
const bigRtttl = (() => {
  const body = ['c', '8e', '16g', 'd6', '8.a', 'f', '16p', 'b', '4g6', '8c6', 'e6', '16a5'];
  let out = 'big:d=16,o=5,b=180:', i = 0;
  while (out.length + 8 < MAX_RTTTL) out += body[i++ % body.length] + ',';
  return out.slice(0, -1);
})();
const bigEntry = customEntry(bigRtttl);

// Audio graph with a registry of nodes so the onended -> disconnect cleanup can be triggered.
let ended = [];
const cleanNode = () => { const n = node(); n.onended = null; ended.push(n); n.disconnect = () => { audioNodes++; }; return n; };
const cleanCtx = { currentTime: 0, createOscillator: cleanNode, createGain: cleanNode, createBiquadFilter: cleanNode };
const synthClean = new Synth(); synthClean.ctx = cleanCtx; synthClean.bus = node(); synthClean.voice = 'smooth';

// Scheduler fixture: a chart with a backing line so _schedule has audible work.
const schedChart = (() => {
  const c = cloneChart(longest);
  c.backing = Array.from({ length: 400 }, (_, i) => ({ time: i * (c.length / 400), midi: 60 + (i % 12), duration: 0.1 }));
  return c;
})();
const schedClock = { currentTime: 0, suspend() {}, resume() {} };
const schedCalls = { n: 0 };
const schedSynth = { ctx: schedClock, getLatency: () => 0, stopAll() {}, tick() { schedCalls.n++; }, playNote() { schedCalls.n++; return { release() {} }; }, playMiss() {} };
const schedGame = new Game(schedSynth);

// ---- cases ----
const cases = [
  ['rtttl.parse (all songs)', () => { for (const s of SONGS) parseRTTTL(s.rtttl); }],
  ...DIFFICULTIES.map(d => [`chart.generate ${d} (all songs)`, () => { for (const p of parsed) generateChart(p, { difficulty: d }); }]),
  ['library.build', () => buildLibrary()],
  ['library.build x2 (boot + rebuild)', () => { buildLibrary(); buildLibrary(); }],
  ['mods.scale (all)', () => { for (const c of charts) scaleChart(c, 0.75); }],
  ['game.simulate (longest, 1 bot run)', () => { runBot(longest, LADDER[2], 1); }],
  ['listview.applyView (all sorts)', () => { for (const s of SORTS) applyView(lib, { sort: s.id }, scores); }],
  ['share.encode+decode', () => { decodeSong(encodeSong(memStore)); }],
  ['render.draw (1 frame)', () => { rf.r.draw(rf.g, rf.t); }],
  ['render.drawIdle (settled)', () => { rf.r.drawIdle(); }],
  ['synth.playNote x8 (plain)', () => { for (let i = 0; i < 8; i++) synthFx.playNote({ midi: 60 + i, when: 0, duration: 0.2 }); }],
  ['synth.playNote x8 (buzzer)', () => { for (let i = 0; i < 8; i++) buzzFx.playNote({ midi: 60 + i, when: 0, duration: 0.2 }); }],

  // -- stutter-oriented: worst frames, allocation, cold caches, whole-song replays --
  ['render.draw busiest frame', () => { rf.r.draw(rf.g, worstT); }],
  ['render.draw small LCD (100x90)', () => { rfSmall.r.draw(rfSmall.g, rfSmall.t); }],
  ['render.draw large LCD (330x300)', () => { rfLarge.r.draw(rfLarge.g, rfLarge.t); }],
  ['render.draw FX saturated (rings+labels+banners+countdown)', () => {
    const r = rf.r, now = performance.now() / 1000;
    for (const x of r.rings) { x.t = now; x.big = true; }
    for (const l of r.labels) { l.t = now; l.text = 'PERFECT'; }
    for (let i = 0; i < r.banners.length; i++) { r.banners[i].t = now - i * 0.1; r.banners[i].text = (i + 1) * 50 + ' COMBO'; }
    r.draw(rf.g, rf.t);
  }],
  ['render.text sprites cold (cache cleared)', () => { rf.r._sprites.clear(); rf.r.draw(rf.g, rf.t); }],
  ['render.text sprite churn (250 distinct strings)', () => {
    const r = rf.r;
    for (let i = 0; i < 250; i++) r._text(ctx, 'N' + i, 3, 1, '#1d2b12', i & 1);
  }],
  ['game._schedule (backing, 25 ms steps, full song)', () => {
    schedClock.currentTime = 0;
    schedGame.start(schedChart, { leadIn: 0, backing: true });
    clearInterval(schedGame.timer);
    for (let t = 0; t < schedChart.length; t += 0.025) { schedClock.currentTime = t; schedGame._schedule(); }
  }],
  ['synth.playNote x16 burst + cleanup (smooth)', () => {
    for (let i = 0; i < 16; i++) synthClean.playNote({ midi: 48 + i, when: 0, duration: 0.2 });
    for (const n of ended) if (typeof n.onended === 'function') n.onended();
    ended = [];
  }],
  ['chart.generate custom max-length song (3 diffs)', () => { for (const d of DIFFICULTIES) generateChart(bigEntry.song, { difficulty: d }); }],
  ['library.customEntry max-length (import)', () => { customEntry(bigRtttl); }],

  // -- hit indicators (chips, punch, debris, shimmer, shake, milestone) --
  ['render.draw hit storm (all juice live, 4 lanes)', () => { armStorm(rfStorm.r, rfStorm.g); rfStorm.r.draw(rfStorm.g, rfStorm.t); disarm(rfStorm.r, rfStorm.g); }],
  ['render.draw holds + shimmer (all lanes held)', () => {
    rfHolds.g.holds = Array.from({ length: rfHolds.r.lanes }, () => ({}));
    rfHolds.r.draw(rfHolds.g, rfHolds.t);
  }],
  ['render.draw perfect-spam (1 hit/frame, rolling)', () => { perfectHit(rfStorm.r, sink++ & 3); rfStorm.r.draw(rfStorm.g, rfStorm.t); }],
  ['render._chip x4 (perfect/great/good/miss)', () => { for (const j in chipTexts) rf.r._chip(ctx, chipTexts[j], j, 100, 200); }],
  ['render.draw juice off (floor)', () => { rfCalm.r.draw(rfCalm.g, rfCalm.t); }],
  ['render.draw reduced motion', () => { rfReduced.r.draw(rfReduced.g, rfReduced.t); }],
  ['render.fx.judge x100 (pool churn)', () => { for (let i = 0; i < 100; i++) rf.r.fx.judge(i & 3, i % 7 ? 'perfect' : 'miss'); }],

  // -- menu / pixel-art / animation (pure parts; DOM parts live in perf-menus) --
  ['menuicons.menuFrame (all ids x 8 ticks)', () => { for (const id of MENU_IDS) for (let n = 0; n < 8; n++) sink += menuFrame(id, n, { unread: n & 1 }).length; }],
  ['menuicons.menuFrames (all ids, preload)', () => { for (const id of MENU_IDS) sink += menuFrames(id).length; }],
  ['pixelart.spriteSVG (all menu frames)', () => { for (const id of MENU_IDS) for (let n = 0; n < 4; n++) sink += spriteSVG(menuFrame(id, n)).length; }],
  ['pixelart.spriteURL warm (menu icon tick)', () => { for (const id of MENU_IDS) sink += spriteURL(menuFrame(id, 1)).length; }],
  ['pixelart.spriteHTML x60 (list rows)', () => { for (let i = 0; i < 60; i++) sink += spriteHTML(SPRITES.custom || Object.values(SPRITES)[0], 2).length; }],
  ['cover.coverRows (all songs, cold)', () => { for (const e of lib) sink += coverRows(e.id + Math.random(), e.category).length; }],
  ['cover.coverRows (all songs, warm)', () => { for (const e of lib) sink += coverRows(e.id, e.category).length; }],
  ...CAMEOS.map(c => [`cameo.${c.id} (full run: step+draw)`, () => {
    const s = c.create(seeded(7), 60, 30);
    let n = 0;
    while (!s.done && n++ < 3000) { s.step(); if (c.kind === 'canvas') s.draw((x, y) => { sink += x + y; }); else sink += s.status() ? 1 : 0; }
  }]),
  ['input.eventAudioTime x100', () => {
    const c = { currentTime: 10, outputLatency: 0.05, getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 1000 }) };
    for (let i = 0; i < 100; i++) sink += eventAudioTime(c, { timeStamp: 1000 + i });
  }],
  ['calibration.result (12 ticks, 40 taps)', () => {
    const cal = new Calibration({ ctx: { currentTime: 0 }, ensure() { return this.ctx; }, stopAll() {}, tick() {}, getLatency: () => 0 });
    cal.start();
    for (let i = 0; i < 40; i++) cal.recordTap(cal.tickTimes[i % 12] + 0.03 + (i % 5) * 0.004);
    sink += cal.result();
  }],
  ['gamepad.Pad.poll x60 (4 buttons flipping)', () => {
    const pad = new Pad();
    let f = 0;
    pad.list = () => [{ index: 0, axes: [0, 0], timestamp: 0, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i < 4 && f % 2 === 0 })) }];
    pad.onButton = () => { sink++; };
    for (f = 0; f < 60; f++) pad.poll();
  }],
  ['stats.gradeTally+topSongs+favourite (400 songs)', () => { gradeTally(statEntries, 'all'); gradeTally(statEntries, 'hard'); topSongs(statEntries); favourite(statEntries); }],
  ['stats.recordRun x5 (persist)', () => {
    const st = createStats({ getItem: () => null, setItem() {}, removeItem() {} });
    for (let i = 0; i < 5; i++) st.recordRun({ diff: 'normal', result: { score: 1000, maxCombo: 60, counts: { perfect: 90, great: 5, good: 3, miss: 2 }, fc: false, ap: false } });
  }],
  ['listview.applyView (500-song library, all sorts + cats)', () => { for (const s of SORTS) for (const c of ['all', 'pop', 'folk']) applyView(bigLib, { sort: s.id, category: c }, scores); }],
  ['scores.record x5 (persist to storage)', () => {
    const sc = createScores({ getItem: () => null, setItem() {}, removeItem() {} });
    for (let i = 0; i < 5; i++) sc.record('s', 'normal', { score: 1000 * i, maxCombo: 50, accuracy: 90, grade: 'A', counts: { perfect: 1, great: 1, good: 1, miss: 0 }, deltas: [] });
  }],
];

// Whole-song replays: each phase is a frame series, reported per frame (not per replay).
const frameCases = [
  ['frames.update (longest song, 60 Hz)', 'update', longest],
  ['frames.draw (longest song, 60 Hz)', 'draw', longest],
  ['frames.press (judge + synth call)', 'press', longest],
  ['frames.draw (max-length custom song)', 'draw', bigEntry && generateChart(bigEntry.song, { difficulty: 'hard' })],
];

// ---- harness ----
const MIN_MS = 200, WARMUP = 5;
function bench(fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples = [];
  let total = 0;
  while (total < MIN_MS || samples.length < 10) {
    const t0 = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    samples.push(ms); total += ms;
  }
  samples.sort((a, b) => a - b);
  const mean = total / samples.length;
  const q = f => samples[Math.min(samples.length - 1, Math.floor(samples.length * f))];
  return { iters: samples.length, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: samples[samples.length - 1], opsPerSec: 1000 / mean };
}
// Approximate bytes allocated per call (needs --expose-gc; scavenges during the loop make it a lower bound).
function allocPerCall(fn, n = 200) {
  if (typeof globalThis.gc !== 'function') return null;
  for (let i = 0; i < 20; i++) fn();
  globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) fn();
  return Math.max(0, (process.memoryUsage().heapUsed - h0) / n);
}
// Per-frame series from whole-song replays.
function benchFrames(kind, chart, reps = 5) {
  playSong(chart, { draw: kind !== 'update' && kind !== 'press' }); // warm up
  const all = [];
  for (let i = 0; i < reps; i++) for (const v of playSong(chart)[kind]) if (v > 0 || kind !== 'press') all.push(v);
  all.sort((a, b) => a - b);
  const mean = all.reduce((x, y) => x + y, 0) / all.length;
  const q = f => all[Math.min(all.length - 1, Math.floor(all.length * f))];
  return { iters: all.length, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: all[all.length - 1], opsPerSec: 1000 / mean };
}

const base = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
const results = {}, rows = [];
let worst = 0, worstMax = 0;
function addRow(name, r, extra = {}) {
  results[name] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : +v.toFixed(4)]));
  const row = { case: name, 'mean ms': +r.mean.toFixed(3), 'p50 ms': +r.p50.toFixed(3), 'p95 ms': +r.p95.toFixed(3),
    'p99 ms': +r.p99.toFixed(3), 'max ms': +r.max.toFixed(3), 'ops/s': Math.round(r.opsPerSec), ...extra };
  if (r.allocBytes != null) row['alloc B/call'] = Math.round(r.allocBytes);
  if (base && base[name]) {
    const d = (r.mean / base[name].mean - 1) * 100;
    row['Δ% vs base'] = +d.toFixed(1);
    worst = Math.max(worst, d);
    if (base[name].max) { const dm = (r.max / base[name].max - 1) * 100; row['Δ% max'] = +dm.toFixed(1); worstMax = Math.max(worstMax, dm); }
  }
  rows.push(row);
}
for (const [name, fn] of cases) {
  if (filter && !name.includes(filter)) continue;
  canvasCalls = 0;
  const r = bench(fn);
  const extra = {};
  if (name.startsWith('render.')) { extra['canvas calls/frame'] = Math.round(canvasCalls / (r.iters + WARMUP)); results[name] = { callsPerFrame: extra['canvas calls/frame'] }; }
  r.allocBytes = allocPerCall(fn);
  const cpf = results[name] && results[name].callsPerFrame;
  addRow(name, r, extra);
  if (cpf != null) results[name].callsPerFrame = cpf;
}
for (const [name, kind, chart] of frameCases) {
  if (filter && !name.includes(filter)) continue;
  if (!chart) continue;
  addRow(name, benchFrames(kind, chart));
}
console.table(rows);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(results, null, 1) + '\n'); console.log('wrote', jsonOut); }
if (failOver != null && base && worst > +failOver) {
  console.error(`regression: worst case ${worst.toFixed(1)}% slower than baseline (limit ${failOver}%)`);
  process.exit(1);
}
if (failOverMax != null && base && worstMax > +failOverMax) {
  console.error(`regression: worst max-frame ${worstMax.toFixed(1)}% slower than baseline (limit ${failOverMax}%)`);
  process.exit(1);
}
process.exit(0); // some imported module leaves a handle open; don't hang
