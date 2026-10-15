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
import { createPerf } from '../src/perf.js';
import * as C from '../src/composer.js';
import { createMySongs, MAX_SONGS, MAX_RTTTL } from '../src/mysongs.js';
import { VERSION } from '../src/version.js';
import { readFileSync } from 'node:fs';
import { sanitizeBindings, laneForSlot, DEFAULT_BINDINGS } from '../src/gamepad.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('library: every built-in parses cleanly and charts at all difficulties', () => {
  assert.ok(SONGS.length >= 15);
  const full = SONGS.filter(x => { const c = generateChart(parseRTTTL(x.rtttl), { difficulty: 'normal' }); return c.length >= 60 && c.length <= 180; });
  assert.ok(full.length >= 10, 'expected at least 10 full-length songs');
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

test('game: notesLeft counts down to zero, dropped holds do not go negative', () => {
  const { g, n } = playChart(0);
  assert.equal(g.notesLeft, 0);
  const miss = playChart(3);
  assert.equal(miss.g.notesLeft, 0);
  assert.ok(miss.n > 0);
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
  const c = (perfect, good, miss) => ({ counts: { perfect, great: 0, good, miss } });
  assert.equal(stagePassed({ maxMiss: 0, minGreatPct: 50 }, c(4, 4, 0)), true);
  assert.equal(stagePassed({ maxMiss: 0, minGreatPct: 50 }, c(3, 5, 0)), false);
  assert.equal(stagePassed({ maxMiss: 0 }, c(8, 0, 1)), false);
});

// ---- bots + list view ----
import { runBot, LADDER, measureChart } from '../src/bot.js';
import { applyView } from '../src/listview.js';

const botChart = d => generateChart(parseRTTTL(SONGS.find(s => s.id === 'twinkle').rtttl), { difficulty: d });

test('bot: deterministic per seed, perfect bot is AP', () => {
  const c = botChart('normal');
  const a = runBot(c, LADDER[2], 5), b = runBot(c, LADDER[2], 5);
  assert.deepEqual(a, b);
  const p = runBot(c, { sigma: 0 }, 1);
  assert.equal(p.ap, true);
});

test('bot: higher skill never has lower FC rate on average', () => {
  const m = measureChart(botChart('normal'), { runs: 20 });
  assert.ok(m.fc.L6 >= m.fc.L1);
  assert.ok(m.rating >= 1 && m.rating <= 10);
});

test('bot: a dead lane produces misses', () => {
  const c = botChart('normal');
  const r = runBot(c, { sigma: 0, laneMiss: { 0: 1 } }, 1);
  const lane0 = c.notes.filter(n => n.lane === 0).length;
  assert.ok(r.counts.miss >= lane0);
});

test('listview: filter and sort', () => {
  const mk = (id, rating, bpm) => ({ id, title: id, bpm, stars: { normal: 1 }, rating: { normal: rating } });
  const es = [mk('a', 5, 100), mk('b', 2, 140), mk('custom:x', 1, 90), mk('c', 8, 80)];
  const sc = { get: (id) => id === 'a' ? { top: [{ fc: true }] } : id === 'b' ? { top: [{ fc: false }] } : null };
  const ids = v => applyView(es, v, 'normal', sc).map(e => e.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'custom:x']);
  assert.deepEqual(ids({ sort: 'diff-desc' }), ['c', 'a', 'b', 'custom:x']);
  assert.deepEqual(ids({ filter: 'unplayed' }), ['c', 'custom:x']);
  assert.deepEqual(ids({ filter: 'nofc' }), ['b', 'c', 'custom:x']);
});

test('listview: category filter', () => {
  const es = [{ id: 'a', category: 'pop' }, { id: 'b', category: 'classical' }, { id: 'custom:x', category: 'custom' }];
  const sc = { get: () => null };
  const ids = v => applyView(es, v, 'normal', sc).map(e => e.id);
  assert.deepEqual(ids({ category: 'pop' }), ['a']);
  assert.deepEqual(ids({ category: 'all' }), ['a', 'b', 'custom:x']);
});

test('songs: every song has a known category and every category is used', async () => {
  const { CATEGORIES } = await import('../src/songs.js');
  const ids = new Set(CATEGORIES.map(c => c.id));
  assert.ok(SONGS.length >= 30);
  for (const s of SONGS) assert.ok(ids.has(s.category), s.id);
  for (const c of ids) assert.ok(SONGS.some(s => s.category === c), c);
});

test('scores: fc/ap flags are sticky per difficulty', () => {
  const m = new Map();
  const st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  const s = createScores(st);
  s.record('x', 'hard', { score: 100, fc: true, ap: false });
  for (let i = 0; i < 6; i++) s.record('x', 'hard', { score: 1000 + i, fc: false });
  assert.equal(s.get('x', 'hard').fc, true);
  assert.equal(s.get('x', 'hard').ap, false);
  assert.equal(createScores(st).get('x', 'hard').fc, true); // persisted
  assert.equal(s.get('x', 'easy'), null);
});

test('chart: every pitched note is either playable or backing', () => {
  const song = parseRTTTL(SONGS[0].rtttl);
  const total = song.notes.filter(n => !n.isRest).length;
  for (const d of DIFFICULTIES) {
    const c = generateChart(song, { difficulty: d });
    assert.equal(c.notes.length + c.backing.length, total, d);
  }
});

test('perf: disabled is a no-op; enabled records stats, ring wraps, long frames counted', () => {
  let t = 0;
  const p = createPerf({ now: () => t, cap: 4 });
  p.begin('a'); t += 5; p.end('a'); p.frame();
  assert.deepEqual(p.stats(), {});
  assert.equal(p.time('x', () => 7), 7);
  p.enable();
  for (const d of [1, 2, 3, 4, 100]) { p.begin('a'); t += d; p.end('a'); }
  const a = p.stats().a;
  assert.equal(a.n, 5);
  assert.equal(a.max, 100);   // oldest sample (1) fell out of the 4-slot ring
  assert.equal(a.p50, 4);
  for (const d of [16, 16, 40]) { t += d; p.frame(); }
  const r = p.report();
  assert.equal(r.frames, 2);
  assert.equal(r.longFrames, 1);
  assert.equal(p.time('y', () => { t += 3; return 'ok'; }), 'ok');
  assert.equal(p.stats().y.mean, 3);
  p.reset();
  assert.deepEqual(p.stats(), {});
});

test('composer: keypad entry, modifiers, repeat-press octave cycle, RTTTL roundtrip', () => {
  const s = C.create(); s.name = 'My: Tune,';
  C.pressNote(s, 1, 0); C.pressNote(s, 3, 1000); C.pressNote(s, 0, 2000);
  assert.deepEqual(s.notes.map(n => n.p), ['c', 'e', 'p']);
  C.pressNote(s, 5, 3000); C.pressNote(s, 5, 3200); // quick repeat re-pitches instead of adding
  assert.equal(s.notes.length, 4); assert.equal(s.notes[3].oct, 6);
  C.toggleSharp(s); assert.ok(s.notes[3].sharp);
  C.toggleDot(s); C.changeDur(s, 1);
  assert.equal(s.notes[3].dur, 8);
  assert.equal(C.toggleSharp(Object.assign(C.create(), { notes: [{ p: 'e', dur: 4, oct: 5 }], cursor: 1 })), false);
  const text = C.toRTTTL(s);
  assert.ok(text.startsWith('My Tune:d=4,o=5,b=120:'));
  const back = C.fromRTTTL(text);
  assert.deepEqual(back.notes.map(n => [n.p, n.sharp, n.dur, n.dotted]), s.notes.map(n => [n.p, n.sharp, n.dur, n.dotted]));
  assert.equal(C.toRTTTL(back), text);
  C.backspace(s); assert.equal(s.notes.length, 3);
  assert.equal(customEntry(text) !== null, true);
});

test('mysongs: CRUD, limits, import/export, dedupe, corruption', () => {
  const st = mem(), m = createMySongs(st);
  const t = 'a:d=4,o=5,b=100:c,d,e,f';
  const a = m.add('Alpha', t);
  assert.ok(a); assert.equal(m.add('bad', 'nonsense'), null);
  assert.ok(m.update(a.uid, { name: 'Beta' })); assert.equal(m.get(a.uid).name, 'Beta');
  assert.ok(m.duplicate(a.uid)); assert.equal(m.count(), 2);
  const json = m.exportJSON();
  const m2 = createMySongs(mem());
  assert.deepEqual(m2.importText(json), { added: 1, skipped: 1 }); // duplicate melody text is skipped
  assert.deepEqual(m2.importText(json), { added: 0, skipped: 2 });
  assert.deepEqual(createMySongs(mem()).importText(t + '\ngarbage\nb:d=8,o=6,b=90:g,a'), { added: 2, skipped: 0 });
  assert.equal(createMySongs(mem()).importText('{oops').skipped, 1);
  assert.equal(createMySongs(st).count(), 2); // persisted
  assert.equal(createMySongs({ getItem: () => 'not json', setItem() {} }).count(), 0);
  for (let i = 0; i < MAX_SONGS + 3; i++) m.add('s' + i, `s${i}:d=4,o=5,b=100:c,d${'e'.repeat(0)},${'cdefgab'[i % 7]}${i % 4 + 4}`);
  assert.ok(m.count() <= MAX_SONGS);
  assert.ok(m.remove(a.uid));
});

test('composer: stepPitch crosses octaves and clamps; controller add', () => {
  const s = C.create();
  assert.equal(C.stepPitch(s, 1), false);
  C.addNote(s); C.stepPitch(s, -1);
  assert.deepEqual([s.notes[0].p, s.notes[0].oct], ['b', 4]);
  s.notes[0].oct = 7; s.notes[0].p = 'b';
  assert.equal(C.stepPitch(s, 1), false);
  C.addNote(s); assert.equal(s.notes.length, 2);
  C.addRest(s); assert.equal(C.stepPitch(s, 1), false);
});

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('fast 16th-note song still gets sparse easy/normal charts', () => {
  const seq = [];
  for (let i = 0; i < 60; i++) { const n = ['d#', 'f', 'f#', 'g#', 'a#'][i % 5]; seq.push(`16${n}`, `16${n}`); }
  const song = parseRTTTL(`Fast:d=4,o=5,b=147:${seq.join(',')}`);
  for (const d of ['easy', 'normal']) {
    const c = generateChart(song, { difficulty: d });
    assert.ok(c.notes.length >= 20, `${d} has ${c.notes.length} notes`);
  }
});

test('composer: a full-length song at the note cap fits the saved-song size limit', () => {
  const s = C.create(); s.name = 'x'.repeat(40);
  for (let i = 0; i < C.MAX_NOTES + 5; i++) s.notes.push({ p: 'c', sharp: true, dur: 32, dotted: true, oct: 7 });
  s.cursor = s.notes.length;
  assert.equal(C.pressNote(s, 1, 0), false); // capped
  s.notes.length = C.MAX_NOTES;
  assert.ok(C.toRTTTL(s).length <= MAX_RTTTL);
});
