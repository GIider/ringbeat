// Speed micro-benchmarks for the pure modules + a headless render pass.
// Usage: npm run perf [-- --filter chart] [--json out.json] [--baseline scripts/perf-baseline.json] [--fail-over 25]
// Timings are machine-specific; compare against a baseline recorded on the same machine.
import { readFileSync, writeFileSync } from 'node:fs';
import { SONGS } from '../src/songs.js';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { DIFFICULTIES, buildLibrary } from '../src/library.js';
import { sliceChart, scaleChart } from '../src/practice.js';
import { applyView, SORTS } from '../src/listview.js';
import { encodeSong, decodeSong } from '../src/share.js';
import { createScores } from '../src/scores.js';
import { runBot, LADDER } from '../src/bot.js';
import { Game } from '../src/game.js';

const arg = (name, def = null) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const filter = arg('filter'), jsonOut = arg('json'), basePath = arg('baseline'), failOver = arg('fail-over');

// ---- fixtures ----
const parsed = SONGS.map(s => parseRTTTL(s.rtttl));
const charts = parsed.map(p => generateChart(p, { difficulty: 'normal' }));
const longest = charts.reduce((a, c) => (c.notes.length > a.notes.length ? c : a));
const lib = buildLibrary();
const scores = createScores({ getItem: () => null, setItem() {}, removeItem() {} });
const memStore = SONGS[0].rtttl;

// Fake DOM/canvas so Renderer runs in node; the context counts calls instead of drawing.
let canvasCalls = 0;
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() { canvasCalls++; } }) : (...a) => { canvasCalls++; }),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, devicePixelRatio: 1 };
const canvas = { getContext: () => ctx, clientWidth: 800, clientHeight: 600, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0 }) };
const { Renderer } = await import('../src/render.js');

function renderFixture() {
  const r = new Renderer(canvas);
  const synth = { ctx: { currentTime: 0, suspend() {}, resume() {} }, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
  const g = new Game(synth);
  g.fx = r.fx;
  const chart = { ...longest, notes: longest.notes.map(n => ({ ...n })) };
  g.start(chart, { leadIn: 1, backing: false });
  r.setLanes(chart.lanes || 4, []);
  r.resetState();
  return { r, g, t: chart.length / 2 };
}
const rf = renderFixture();

// ---- cases ----
const cases = [
  ['rtttl.parse (all songs)', () => { for (const s of SONGS) parseRTTTL(s.rtttl); }],
  ...DIFFICULTIES.map(d => [`chart.generate ${d} (all songs)`, () => { for (const p of parsed) generateChart(p, { difficulty: d }); }]),
  ['library.build', () => buildLibrary()],
  ['practice.slice+scale (all)', () => { for (const c of charts) scaleChart(sliceChart(c, 0, c.length * 0.5), 0.75); }],
  ['game.simulate (longest, 1 bot run)', () => { runBot(longest, LADDER[2], 1); }],
  ['listview.applyView (all sorts)', () => { for (const s of SORTS) applyView(lib, { sort: s.id }, 'normal', scores); }],
  ['share.encode+decode', () => { decodeSong(encodeSong(memStore)); }],
  ['render.draw (1 frame)', () => { rf.r.draw(rf.g, rf.t); }],
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
  return { iters: samples.length, mean, p50: samples[samples.length >> 1], p95: samples[Math.floor(samples.length * 0.95)], opsPerSec: 1000 / mean };
}

const base = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
const results = {}, rows = [];
let worst = 0;
for (const [name, fn] of cases) {
  if (filter && !name.includes(filter)) continue;
  canvasCalls = 0;
  const r = bench(fn);
  results[name] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(4)]));
  const row = { case: name, 'mean ms': +r.mean.toFixed(3), 'p50 ms': +r.p50.toFixed(3), 'p95 ms': +r.p95.toFixed(3), 'ops/s': Math.round(r.opsPerSec) };
  if (name.startsWith('render.')) { row['canvas calls/frame'] = Math.round(canvasCalls / (r.iters + WARMUP)); results[name].callsPerFrame = row['canvas calls/frame']; }
  if (base && base[name]) {
    const d = (r.mean / base[name].mean - 1) * 100;
    row['Δ% vs base'] = +d.toFixed(1);
    worst = Math.max(worst, d);
  }
  rows.push(row);
}
console.table(rows);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(results, null, 1) + '\n'); console.log('wrote', jsonOut); }
if (failOver != null && base && worst > +failOver) {
  console.error(`regression: worst case ${worst.toFixed(1)}% slower than baseline (limit ${failOver}%)`);
  process.exit(1);
}
process.exit(0); // some imported module leaves a handle open; don't hang
