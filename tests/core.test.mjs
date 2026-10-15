// Node tests for the pure modules: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { SONGS } from '../src/songs.js';
import { buildLibrary, customEntry, DIFFICULTIES } from '../src/library.js';
import { createScores, TOP_N } from '../src/scores.js';
import { sliceChart, scaleChart } from '../src/practice.js';
import { Game } from '../src/game.js';
import { STAGES, buildStageChart, stagePassed } from '../src/tutorial.js';
import { HOLD_MIN_SEC } from '../src/chart.js';
import { sanitizeBindings, laneForSlot, DEFAULT_BINDINGS } from '../src/gamepad.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('library: every built-in parses cleanly and charts at all difficulties', () => {
  assert.ok(SONGS.length >= 15);
  assert.equal(new Set(SONGS.map(s => s.id)).size, SONGS.length);
  for (const s of SONGS) {
    const song = parseRTTTL(s.rtttl);
    assert.deepEqual(song.warnings, [], s.id);
    for (const d of DIFFICULTIES) assert.ok(generateChart(song, { difficulty: d }).notes.length > 0, `${s.id}/${d}`);
  }
  const lib = buildLibrary();
  assert.equal(lib.length, SONGS.length);
  for (const e of lib) assert.ok(e.length > 3 && e.stars.normal >= 1 && e.stars.normal <= 5, e.id);
});

test('library: custom entry id is stable per melody; garbage -> null', () => {
  const a = customEntry('x:d=4,o=5,b=100:c,d,e'), b = customEntry(' x:d=4,o=5,b=100:c,d,e ');
  assert.equal(a.id, b.id);
  assert.equal(customEntry('nonsense'), null);
});

test('scores: ranking, top-N cap, tie ordering, persistence, corruption', () => {
  const st = mem();
  let s = createScores(st);
  assert.equal(s.get('a', 'normal'), null);
  const run = score => ({ score, grade: 'A', accuracy: 90, maxCombo: 10, fc: false, ap: false });
  assert.deepEqual(s.record('a', 'normal', run(100)), { rank: 1, isNewBest: true });
  assert.deepEqual(s.record('a', 'normal', run(50)), { rank: 2, isNewBest: false });
  assert.deepEqual(s.record('a', 'normal', run(100)), { rank: 2, isNewBest: false }); // tie ranks below
  for (let i = 0; i < 10; i++) s.record('a', 'normal', run(10 + i));
  assert.equal(s.get('a', 'normal').top.length, TOP_N);
  assert.deepEqual(s.record('a', 'normal', run(1)), { rank: null, isNewBest: false });
  assert.equal(s.get('a', 'hard'), null);
  // persisted
  s = createScores(st);
  assert.equal(s.get('a', 'normal').best.score, 100);
  assert.equal(s.get('a', 'normal').plays, 14);
  // fc flags survive
  s.record('b', 'easy', { ...run(5), fc: true, ap: true });
  assert.equal(createScores(st).get('b', 'easy').best.ap, true);
  // corruption
  for (const bad of ['{{{', 'null', '[]', '{"a":{"normal":{"top":[{"score":"x"}]}}}', '{"a":5}']) {
    const c = mem(); c.setItem('ringbeat.scores.v1', bad);
    assert.equal(createScores(c).get('a', 'normal'), null, bad);
  }
  s.clear();
  assert.equal(s.get('a', 'normal'), null);
});

test('practice: scaleChart keeps order/count, scales times & grid', () => {
  const c = generateChart(parseRTTTL(SONGS[0].rtttl), { difficulty: 'normal' });
  const half = scaleChart(c, 0.5);
  assert.equal(half.notes.length, c.notes.length);
  assert.ok(Math.abs(half.length - c.length * 2) < 1e-9);
  assert.ok(Math.abs(half.beatLen - c.beatLen * 2) < 1e-9);
  assert.equal(half.notes[3].midi, c.notes[3].midi);
  assert.notEqual(half.notes[0], c.notes[0]); // cloned
  assert.throws(() => scaleChart(c, 0));
});

test('practice: sliceChart window, shift, hold clipping, grid offset', () => {
  const c = generateChart(parseRTTTL(SONGS[0].rtttl), { difficulty: 'normal' });
  const a = c.length * 0.3, b = c.length * 0.7;
  const s = sliceChart(c, a, b);
  assert.ok(s.notes.length > 0 && s.notes.length < c.notes.length);
  assert.ok(s.notes[0].time >= 0 && s.notes[0].time < 1);
  assert.ok(s.notes.every(n => !n.isHold || n.time + n.duration <= b - a + 1e-9));
  assert.ok(s.notes.every((n, i) => n.id === i));
  // beat n sits at the same absolute time before and after the shift
  const beat = 5;
  const tOrig = (beat - c.firstBeat) * c.beatLen - a;
  const tNew = (beat - s.firstBeat) * s.beatLen;
  assert.ok(Math.abs(tOrig - tNew) < 1e-9);
  assert.throws(() => sliceChart(c, c.length + 5, c.length + 6));
});

// ---- Game: full combo logic with a stub synth ----
function stubSynth() {
  const ctx = { currentTime: 0, suspend() {}, resume() {} };
  return { ctx, ensure: () => ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
}
function playChart(missEvery) {
  const synth = stubSynth();
  const g = new Game(synth);
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'), { difficulty: 'normal' });
  g.start(chart, { leadIn: 1, backing: false });
  let result = null;
  g.onFinish = r => { result = r; };
  chart.notes.forEach((n, i) => {
    if (missEvery && i % missEvery === 0) return; // skip -> auto miss
    g.press(n.lane, g.songStart + n.time + 0.01);
  });
  for (let t = 0; t < chart.length + 2 && !result; t += 0.05) g.update(t);
  return { g, result, n: chart.notes.length };
}

test('game: perfect run is ALL PERFECT / FC', () => {
  const { result, n } = playChart(0);
  assert.ok(result);
  assert.equal(result.counts.perfect, n);
  assert.equal(result.fc, true);
  assert.equal(result.ap, true);
  assert.equal(result.deltas.length, n);
  assert.ok(Math.abs(result.deltas[0] - 0.01) < 1e-9);
});

test('game: a single miss breaks FC', () => {
  const { result } = playChart(5);
  assert.ok(result.counts.miss >= 1);
  assert.equal(result.fc, false);
  assert.equal(result.ap, false);
});

test('gamepad: bindings sanitize, lane folding', () => {
  assert.deepEqual(sanitizeBindings(null), DEFAULT_BINDINGS);
  assert.deepEqual(sanitizeBindings({ 0: 'x', 1: [99], 2: [1, 2], 3: [] })[2], [1, 2]);
  assert.deepEqual(sanitizeBindings({ 1: [99] })[1], DEFAULT_BINDINGS[1]);
  assert.deepEqual([0, 1, 2, 3].map(s => laneForSlot(s, 4)), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map(s => laneForSlot(s, 3)), [0, 0, 1, 2]);
});

test('tutorial: stages build valid, non-overlapping charts', () => {
  assert.ok(STAGES.length >= 3);
  for (const st of STAGES) {
    const c = buildStageChart(st);
    assert.equal(c.lanes, 4);
    assert.ok(c.notes.length > 0 && c.length > 0);
    const lastEnd = new Array(4).fill(-Infinity);
    for (const n of c.notes) {
      assert.ok(n.lane >= 0 && n.lane < 4, st.id);
      assert.equal(n.isHold, n.duration >= HOLD_MIN_SEC, st.id);
      assert.ok(n.time >= lastEnd[n.lane] + 0.3, `${st.id}: lane ${n.lane} overlap`);
      lastEnd[n.lane] = n.time + n.duration;
    }
  }
  assert.ok(STAGES.some(s => buildStageChart(s).notes.some(n => n.isHold)));
  assert.equal(stagePassed({ maxMiss: 1 }, { counts: { miss: 1 } }), true);
  assert.equal(stagePassed({ maxMiss: 1 }, { counts: { miss: 2 } }), false);
});
