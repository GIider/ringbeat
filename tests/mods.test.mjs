// Node tests for modifiers: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { Game, WINDOWS } from '../src/game.js';
import { createScores } from '../src/scores.js';
import * as M from '../src/mods.js';
const { scaleChart } = M;

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
function stubSynth() {
  const ctx = { currentTime: 0, suspend() {}, resume() {} };
  return { ctx, ensure: () => ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
}
const SONG = 't:d=8,o=5,b=120:c,d,e,f,g,a,b,c6';
const SLOW = 't:d=4,o=5,b=60:c,d,e,f,g,a,b,c6'; // 1 s between notes: a late press can only match its own note
const chartOf = (diff = 'normal') => generateChart(parseRTTTL(SONG), { difficulty: diff });
const slowChart = () => generateChart(parseRTTTL(SLOW), { difficulty: 'normal' });
function run(chart, opts, play) {
  const g = new Game(stubSynth());
  g.start(chart, { leadIn: 1, backing: false, ...opts });
  let result = null;
  g.onFinish = r => { result = r; };
  play(g, chart);
  for (let t = 0; t < chart.length + 2 && !result; t += 0.05) g.update(t);
  g.stop();
  return result;
}

test('mods: normalize drops junk and fills defaults', () => {
  assert.deepEqual(M.normalize(null), M.DEFAULT_MODS);
  assert.deepEqual(M.normalize({ speed: 7, mirror: 'yes', judge: 'x', extra: 1 }), M.DEFAULT_MODS);
  assert.deepEqual(M.normalize({ speed: 1.2, hidden: true, judge: 'strict' }),
    { speed: 1.2, mirror: false, hidden: true, sudden: false, judge: 'strict', demo: false });
  assert.equal(M.isActive(M.DEFAULT_MODS), false);
  assert.equal(M.isActive({ mirror: true }), true);
});

test('mods: multiplier is the clamped product; tags are stable', () => {
  assert.equal(M.multiplier({}), 1);
  assert.equal(M.multiplier({ judge: 'lenient' }), 0.8);
  assert.equal(M.multiplier({ speed: 1.2, hidden: true }), 1.32);
  const all = { speed: 1.3, hidden: true, sudden: true, judge: 'strict' };
  assert.ok(M.multiplier(all) <= M.MULT_MAX && M.multiplier(all) > 1.5);
  assert.deepEqual(M.tags({ sudden: true, speed: 0.8, mirror: true }), ['0.8x', 'MR', 'SD']);
  assert.equal(M.summary({}), 'Off');
});

test('mods: mirror is an involution, keeps doubles paired, and does not mutate', () => {
  const c = generateChart(parseRTTTL('t:d=8,o=5,b=140:c,g,c,g,c6,c,g,e,c,g,c6,c'), { difficulty: 'hard' });
  const before = JSON.stringify(c.notes);
  const m = M.applyChart(c, { mirror: true });
  assert.equal(JSON.stringify(c.notes), before);
  assert.ok(m.notes.every((n, i) => n.lane === c.lanes - 1 - c.notes[i].lane && n.time === c.notes[i].time));
  assert.deepEqual(M.applyChart(m, { mirror: true }).notes.map(n => n.lane), c.notes.map(n => n.lane));
  for (const n of m.notes) {
    if (!n.chordLanes) continue;
    for (const l of n.chordLanes) {
      const partner = m.notes.find(p => p !== n && p.time === n.time && p.lane === l);
      assert.ok(partner && partner.chordLanes.includes(n.lane));
    }
  }
});

test('mods: speed uses scaleChart; no mods returns the same chart', () => {
  const c = chartOf();
  assert.equal(M.applyChart(c, {}), c);
  const s = M.applyChart(c, { speed: 1.2 });
  assert.deepEqual(s.notes.map(n => n.time), scaleChart(c, 1.2).notes.map(n => n.time));
  assert.ok(s.length < c.length);
});

test('game: windowScale moves the judgement boundaries', () => {
  const offset = WINDOWS.good * 1.2; // outside the normal Good window, inside Lenient (x1.4)
  const hitLate = (g, c) => c.notes.forEach(n => g.press(n.lane, g.songStart + n.time + offset));
  const normal = run(slowChart(), {}, hitLate);
  assert.equal(normal.counts.miss, slowChart().notes.length);
  const lenient = run(slowChart(), { windowScale: 1.4 }, hitLate);
  assert.equal(lenient.counts.miss, 0);
  // Strict (x0.7): great window 0.09 -> 0.063, so a 0.07 s hit drops from Great to Good
  const off = 0.07;
  const hit = (g, c) => c.notes.forEach(n => g.press(n.lane, g.songStart + n.time + off));
  assert.equal(run(slowChart(), {}, hit).counts.great, slowChart().notes.length);
  assert.equal(run(slowChart(), { windowScale: 0.7 }, hit).counts.good, slowChart().notes.length);
});

test('game: sudden death fails on the first miss and reports it', () => {
  const r = run(chartOf(), { suddenDeath: true }, (g, c) => {
    c.notes.forEach((n, i) => { if (i !== 2) g.press(n.lane, g.songStart + n.time + 0.01); });
  });
  assert.equal(r.failed, true);
  assert.equal(r.fc, false);
  assert.equal(r.counts.miss, 1); // ended at the first miss, before the remaining notes were judged by update()
});

test('game: sudden death fails on a stray press; a clean run does not fail', () => {
  const stray = run(chartOf(), { suddenDeath: true }, (g, c) => {
    const [a] = c.notes;
    g.press(a.lane, g.songStart + a.time + 0.01);
    g.press(a.lane, g.songStart + a.time + 0.5); // matches nothing
  });
  assert.equal(stray.failed, true);
  const clean = run(chartOf(), { suddenDeath: true }, (g, c) => c.notes.forEach(n => g.press(n.lane, g.songStart + n.time + 0.01)));
  assert.equal(clean.failed, false);
  assert.equal(clean.fc, true);
});

test('game: default run is unchanged (no windowScale / suddenDeath)', () => {
  const r = run(chartOf(), {}, (g, c) => c.notes.forEach(n => g.press(n.lane, g.songStart + n.time + 0.01)));
  assert.equal(r.failed, false);
  assert.equal(r.ap, true);
});

test('scores: legacy runs load; mods and mult are kept and ranked by score', () => {
  const storage = mem();
  storage.setItem('ringbeat.scores.v1', JSON.stringify({ s: { normal: { top: [{ score: 100, grade: 'B', accuracy: 80, maxCombo: 3, fc: false, ap: false, date: 1 }] } } }));
  const sc = createScores(storage);
  assert.equal(sc.get('s', 'normal').best.mods, undefined);
  sc.record('s', 'normal', { score: 500, grade: 'A', accuracy: 92, maxCombo: 9, mods: ['1.2x', 'HD'], mult: 1.32 });
  const rec = sc.get('s', 'normal');
  assert.equal(rec.best.score, 500);
  assert.deepEqual(rec.best.mods, ['1.2x', 'HD']);
  assert.equal(rec.best.mult, 1.32);
  assert.equal(rec.top[1].mult, undefined);
  // persists through a reload
  assert.deepEqual(createScores(storage).get('s', 'normal').best.mods, ['1.2x', 'HD']);
});

test('demo mod: x0 multiplier, DEMO tag, active, in game options', () => {
  const d = { demo: true, speed: 1.3, hidden: true };
  assert.equal(M.normalize({}).demo, false);
  assert.equal(M.normalize(d).demo, true);
  assert.ok(M.isActive({ demo: true }));
  assert.equal(M.multiplier(d), 0);
  assert.ok(M.tags(d).includes('DEMO'));
  assert.equal(M.gameOptions(d).demo, true);
});

test('demo autoplay plays every note perfectly, also with mirror, speed and strict judging', async () => {
  const { createAutoplay } = await import('../src/autoplay.js');
  for (const m of [{ demo: true }, { demo: true, mirror: true, speed: 1.3, judge: 'strict', sudden: true }]) {
    const chart = M.applyChart(chartOf('hard'), M.normalize(m));
    const r = run(chart, M.gameOptions(m), (g, c) => {
      const ap = createAutoplay(c);
      for (let t = 0; t < c.length + 2; t += 0.01) { ap.step(t, g); g.update(t); }
    });
    assert.equal(r.counts.miss, 0);
    assert.equal(r.ghosts, 0);
    assert.ok(r.fc && r.ap && !r.failed);
  }
});

test('mods: scaleChart scales roll tickDur with the ticks', () => {
  const c = { notes: [{ time: 1, duration: 0.5, ticks: [0, 0.2], tickDur: 0.1 }], backing: [], length: 2, bpm: 120, beatLen: 0.5 };
  assert.ok(Math.abs(scaleChart(c, 2).notes[0].tickDur - 0.05) < 1e-9);
});
