// Node tests for the pure modules: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';
import { SONGS } from '../src/songs.js';
import { buildLibrary, customEntry, setMeasured } from '../src/library.js';
import { createScores, TOP_N } from '../src/scores.js';
import { scaleChart } from '../src/mods.js';
import { Game } from '../src/game.js';
import { STAGES, buildStageChart } from '../src/tutorial.js';
import { HOLD_MIN_SEC } from '../src/chart.js';
import { createPerf } from '../src/perf.js';
import * as C from '../src/composer.js';
import { createMySongs, MAX_SONGS, MAX_RTTTL } from '../src/mysongs.js';
import { VERSION, BUILD, buildLine } from '../src/version.js';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MESSAGES } from '../src/changelog.js';
import { computeVersion, cleanGitEnv } from '../scripts/version-lib.mjs';
import { sanitizeBindings, DEFAULT_BINDINGS } from '../src/gamepad.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('library: an entry has one chart, rating and star count', () => {
  setMeasured(JSON.parse(readFileSync(new URL('../src/difficulty.json', import.meta.url))));
  const lib = buildLibrary(), by = id => lib.find(e => e.id === id);
  setMeasured({});
  const e = by('turkish');
  assert.equal(e.notes, generateChart(e.song).notes.length);
  assert.ok(typeof e.stars === 'number' && !('only' in e) && !('chart' in e));
  assert.equal(customEntry('t:d=4,o=5,b=120:c,d,e,f,g,a,b,c6').rating, undefined); // not measured: estimated
});

test('library: every built-in parses cleanly and charts', () => {
  assert.ok(SONGS.length >= 15);
  const full = SONGS.filter(x => { const c = generateChart(parseRTTTL(x.rtttl)); return c.length >= 60 && c.length <= 180; });
  assert.ok(full.length >= 10, 'expected at least 10 full-length songs');
  assert.equal(new Set(SONGS.map(s => s.id)).size, SONGS.length);
  for (const s of SONGS) {
    const song = parseRTTTL(s.rtttl);
    assert.deepEqual(song.warnings, [], s.id);
    assert.ok(generateChart(song).notes.length > 0, s.id);
  }
  const lib = buildLibrary();
  assert.equal(lib.length, SONGS.length);
  for (const e of lib) assert.ok(e.length > 3 && e.stars >= 1 && e.stars <= 5, e.id);
});

test('library: custom entry id is stable per melody; garbage -> null', () => {
  const a = customEntry('x:d=4,o=5,b=100:c,d,e'), b = customEntry(' x:d=4,o=5,b=100:c,d,e ');
  assert.equal(a.id, b.id);
  assert.equal(customEntry('nonsense'), null);
});

test('scores: ranking, top-N cap, tie ordering, persistence, corruption', () => {
  const st = mem();
  let s = createScores(st);
  assert.equal(s.get('a'), null);
  const run = score => ({ score, grade: 'A', accuracy: 90, maxCombo: 10, fc: false, ap: false });
  assert.deepEqual(s.record('a', run(100)), { rank: 1, isNewBest: true });
  assert.deepEqual(s.record('a', run(50)), { rank: 2, isNewBest: false });
  assert.deepEqual(s.record('a', run(100)), { rank: 2, isNewBest: false }); // tie ranks below
  for (let i = 0; i < 10; i++) s.record('a', run(10 + i));
  assert.equal(s.get('a').top.length, TOP_N);
  assert.deepEqual(s.record('a', run(1)), { rank: null, isNewBest: false });
  // persisted
  s = createScores(st);
  assert.equal(s.get('a').best.score, 100);
  assert.equal(s.get('a').plays, 14);
  // fc flags survive
  s.record('b', { ...run(5), fc: true, ap: true });
  assert.equal(createScores(st).get('b').best.ap, true);
  // corruption
  for (const bad of ['{{{', 'null', '[]', '{"a":{"top":[{"score":"x"}]}}', '{"a":5}']) {
    const c = mem(); c.setItem('ringbeat.scores.v1', bad);
    assert.equal(createScores(c).get('a'), null, bad);
  }
  // scores stored per difficulty (before the single-difficulty release) are dropped
  const old = mem(); old.setItem('ringbeat.scores.v1', JSON.stringify({ a: { normal: { top: [{ score: 5, grade: 'A' }] }, hard: { top: [{ score: 9, grade: 'A' }] } } }));
  assert.equal(createScores(old).get('a'), null);
  s.clear();
  assert.equal(s.get('a'), null);
});

test('speed: scaleChart keeps order/count, scales times & grid', () => {
  const c = generateChart(parseRTTTL(SONGS[0].rtttl));
  const half = scaleChart(c, 0.5);
  assert.equal(half.notes.length, c.notes.length);
  assert.ok(Math.abs(half.length - c.length * 2) < 1e-9);
  assert.ok(Math.abs(half.beatLen - c.beatLen * 2) < 1e-9);
  assert.equal(half.notes[3].midi, c.notes[3].midi);
  assert.notEqual(half.notes[0], c.notes[0]); // cloned
  assert.throws(() => scaleChart(c, 0));
});

// ---- Game: full combo logic with a stub synth ----
function stubSynth() {
  const ctx = { currentTime: 0, suspend() {}, resume() {} };
  return { ctx, ensure: () => ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} };
}
function playChart(missEvery) {
  const synth = stubSynth();
  const g = new Game(synth);
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'));
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

function playWithStray(afterLast) {
  const g = new Game(stubSynth());
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'));
  g.start(chart, { leadIn: 1, backing: false });
  let result = null;
  g.onFinish = r => { result = r; };
  const stray = () => g.press(chart.notes[0].lane, g.songStart - 5);
  const [first, ...rest] = chart.notes;
  g.press(first.lane, g.songStart + first.time + 0.01);
  if (!afterLast) g.press(first.lane, g.songStart + first.time + 0.4); // between notes, matches nothing
  rest.forEach(n => g.press(n.lane, g.songStart + n.time + 0.01));
  if (afterLast) stray();
  for (let t = 0; t < chart.length + 2 && !result; t += 0.05) g.update(t);
  return result;
}

test('game: a stray press before the last note breaks FC/AP', () => {
  const r = playWithStray(false);
  assert.equal(r.counts.miss, 0);
  assert.equal(r.fc, false);
  assert.equal(r.ap, false);
  assert.equal(r.ghosts, 1);
});

test('game: a stray press after the last note is not counted as a ghost hit', () => {
  assert.equal(playWithStray(true).ghosts, 0);
});

test('game: a stray press resets the running combo', () => {
  const g = new Game(stubSynth());
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'));
  g.start(chart, { leadIn: 1, backing: false });
  const a = chart.notes[0];
  g.press(a.lane, g.songStart + a.time);
  assert.equal(g.combo, 1);
  g.press(a.lane, g.songStart - 5); // far from any note, after the first was judged
  assert.equal(g.combo, 0);
  g.stop(); // clear the scheduler interval
});

test('game: presses before the first note do not break FC', () => {
  const g = new Game(stubSynth());
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'));
  g.start(chart, { leadIn: 1, backing: false });
  let result = null;
  g.onFinish = r => { result = r; };
  g.press(chart.notes[0].lane, g.songStart - 5);
  g.press(chart.notes[0].lane, g.songStart - 3);
  chart.notes.forEach(n => g.press(n.lane, g.songStart + n.time + 0.01));
  for (let t = 0; t < chart.length + 2 && !result; t += 0.05) g.update(t);
  assert.equal(result.fc, true);
});

test('game: a press after the last note keeps FC', () => {
  const r = playWithStray(true);
  assert.equal(r.fc, true);
  assert.equal(r.ap, true);
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
      assert.equal(n.isHold, !n.isRoll && n.duration >= HOLD_MIN_SEC, st.id);
      assert.ok(n.time >= lastEnd[n.lane] + 0.3, `${st.id}: lane ${n.lane} overlap`);
      lastEnd[n.lane] = n.time + n.duration;
    }
  }
  assert.ok(STAGES.some(s => buildStageChart(s).notes.some(n => n.isHold)));
  for (const kind of ['isRoll', 'chordLanes']) {
    assert.ok(STAGES.some(s => buildStageChart(s).notes.some(n => n[kind])), `a stage teaches ${kind}`);
  }
});

// ---- bots + list view ----
import { runBot, LADDER, measureChart } from '../src/bot.js';
import { applyView, sectionOf, sectionRange, jumpSection, randomOf } from '../src/listview.js';

const botChart = () => generateChart(parseRTTTL(SONGS.find(s => s.id === 'twinkle').rtttl));

test('bot: deterministic per seed, perfect bot is AP', () => {
  const c = botChart();
  const a = runBot(c, LADDER[2], 5), b = runBot(c, LADDER[2], 5);
  assert.deepEqual(a, b);
  const p = runBot(c, { sigma: 0 }, 1);
  assert.equal(p.ap, true);
});

test('bot: higher skill never has lower FC rate on average', () => {
  const m = measureChart(botChart(), { runs: 20 });
  assert.ok(m.fc.L6 >= m.fc.L1);
  assert.ok(m.rating >= 1 && m.rating <= 10);
});

test('bot: a dead lane produces misses', () => {
  const c = botChart();
  const r = runBot(c, { sigma: 0, laneMiss: { 0: 1 } }, 1);
  const lane0 = c.notes.filter(n => n.lane === 0).length;
  assert.ok(r.counts.miss >= lane0);
});

const songChart = id => generateChart(parseRTTTL(SONGS.find(s => s.id === id).rtttl));

test('bot: stray presses break full combo but not accuracy', () => {
  const c = botChart();
  const clean = runBot(c, { sigma: 0 }, 1);
  const messy = runBot(c, { sigma: 0, stray: 1 }, 1);
  assert.equal(clean.fc, true);
  assert.equal(messy.fc, false);
  assert.equal(messy.counts.miss, 0);
  assert.equal(messy.accuracy, clean.accuracy);
});

test('bot: fatigue widens timing jitter over the song', () => {
  const c = songChart('ode-full');
  const fresh = measureChart(c, { runs: 1 }).acc; // smoke: runs and returns a number
  assert.ok(Number.isFinite(fresh));
  const prof = { sigma: 30 };
  const acc = p => { let s = 0; for (let i = 1; i <= 8; i++) s += runBot(c, { ...prof, ...p }, i).accuracy; return s / 8; };
  assert.ok(acc({ fatigue: 0 }) > acc({ fatigue: 2 }));
});

test('bot: ladder is strictly ordered in jitter and repeat gap', () => {
  assert.equal(LADDER.length, 8);
  for (let i = 1; i < LADDER.length; i++) {
    assert.ok(LADDER[i].sigma < LADDER[i - 1].sigma);
    assert.ok(LADDER[i].minGap < LADDER[i - 1].minGap);
  }
});

test('bot: alternating lanes sustain a faster pace than repeating one lane', () => {
  const mk = lanes => ({ lanes: 2, length: 4, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
    notes: Array.from({ length: 20 }, (_, i) => ({ id: i, time: i * 0.1, duration: 0.05, lane: lanes[i % lanes.length], midi: 60,
      isHold: false, hit: false, judged: false })) });
  const prof = { sigma: 0, minGap: 150 };
  const same = runBot(mk([0]), prof, 1), alt = runBot(mk([0, 1]), prof, 1);
  assert.ok(alt.counts.miss < same.counts.miss);
});

test('bot: specialists only tag features the chart contains', () => {
  const plain = { lanes: 4, length: 20, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
    notes: Array.from({ length: 30 }, (_, i) => ({ id: i, time: i * 0.6, duration: 0.2, lane: i % 4, midi: 60 + (i % 4),
      isHold: false, hit: false, judged: false })) };
  const m = measureChart(plain, { runs: 5 });
  for (const t of ['holds', 'rolls', 'doubles', 'stamina']) assert.ok(!m.tags.includes(t), t);
  assert.ok(Number.isFinite(m.nps) && Number.isFinite(m.acc));
});

test('difficulty.json: complete, in range, tags plausible, tiers sane', () => {
  const d = JSON.parse(readFileSync(new URL('../src/difficulty.json', import.meta.url)));
  const levels = LADDER.map(l => l.name);
  for (const s of SONGS) {
    assert.ok(d[s.id], 'rated: ' + s.id);
    const m = d[s.id];
    assert.ok(m.rating >= 1 && m.rating <= 10, s.id);
    assert.deepEqual(Object.keys(m.fc), levels, s.id + ' ladder keys (run npm run bench)');
    assert.ok(m.tags.length <= 2);
  }
});

test('listview: sort', () => {
  const mk = (id, rating, bpm) => ({ id, title: id, bpm, stars: 1, rating: rating });
  const es = [mk('a', 5, 100), mk('b', 2, 140), mk('custom:x', 1, 90), mk('c', 8, 80)];
  const sc = { get: (id) => id === 'a' ? { top: [{ fc: true }] } : id === 'b' ? { top: [{ fc: false }] } : null };
  const ids = v => applyView(es, v, sc).map(e => e.id);
  assert.deepEqual(ids({}), ['b', 'a', 'c', 'custom:x']);
  assert.deepEqual(ids({ sort: 'title' }), ['a', 'b', 'c', 'custom:x']);
});

test('listview: unplayed keeps a just-played song', () => {
  const es = [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map(e => ({ ...e, title: e.id, stars: {}, rating: e.id.charCodeAt(0) - 96 }));
  const sc = { get: id => id === 'a' ? { top: [{}] } : null };
  const ids = keep => applyView(es, { category: 'unplayed' }, sc, [], [], '', keep).map(e => e.id);
  assert.deepEqual(ids([]), ['b', 'c']);
  assert.deepEqual(ids(['a']), ['a', 'b', 'c']);
});

test('listview: category filter', () => {
  const es = [{ id: 'a', category: 'pop' }, { id: 'b', category: 'classical' }, { id: 'custom:x', category: 'custom' }].map(e => ({ ...e, title: e.id, stars: {} }));
  const sc = { get: () => null };
  const ids = v => applyView(es, v, sc).map(e => e.id);
  assert.deepEqual(ids({ category: 'pop' }), ['a']);
  assert.deepEqual(ids({ category: 'all' }), ['a', 'b', 'custom:x']);
});

test('listview: sections and section jumps', () => {
  const es = ['Apple', 'Axe', 'Beta', '99 Balloons', 'Cat', 'Cow', 'Cub'].map(t => ({ id: t, title: t, bpm: 100, length: 40, stars: {}, rating: 4 }));
  assert.equal(sectionOf(es[0], 'title'), 'A');
  assert.equal(sectionOf(es[3], 'title'), '#');
  assert.equal(sectionOf({ ...es[0], rating: 7 }, 'diff-asc'), '3.5');
  assert.equal(sectionOf({ ...es[0], rating: 6 }, 'diff-asc'), '3');
  assert.equal(sectionOf({ ...es[0], rating: 0.2 }, 'diff-asc'), '0.5');
  assert.equal(sectionOf({ ...es[0], rating: 10 }, 'diff-asc'), '5');
  assert.equal(sectionOf(es[0], 'length'), '0:40+');
  assert.equal(sectionRange('3.5', 'diff-asc'), '3 - 3.5');
  assert.equal(sectionRange('0.5', 'diff-asc'), '0 - 0.5');
  assert.equal(sectionRange('120', 'bpm'), '120 - 139');
  assert.equal(sectionRange('0:40+', 'length'), '0:40 - 0:49');
  assert.equal(sectionRange('1:10+', 'length'), '1:10 - 1:19');
  assert.equal(sectionRange('<0:10', 'length'), '0:00 - 0:09');
  assert.equal(sectionRange('T', 'title'), 'T');
  assert.equal(sectionRange('*', 'bpm'), '*');
  assert.equal(sectionRange('', 'bpm'), '');
  assert.equal(sectionOf({ ...es[0], length: 9 }, 'length'), '<0:10');
  assert.equal(sectionOf(es[0], 'fav'), '');
  assert.equal(sectionOf({ ...es[0], id: 'custom:1' }, 'title'), '*');
  const j = (i, step) => jumpSection(es, i, step, 'title');
  assert.equal(j(0, 1), 2);
  assert.equal(j(2, 1), 3);
  assert.equal(j(4, 1), 6); // last section: stays at the end
  assert.equal(j(1, -1), 0);   // back to the start of the current section
  assert.equal(j(0, -1), 0);
  assert.equal(j(5, -1), 4);
  assert.equal(j(4, -1), 3);   // start of the previous section
  assert.equal(jumpSection([], 0, 1, 'title'), -1);
});

test('listview: recent, unplayed, search and random', () => {
  const es = [{ id: 'a', title: 'Alpha', tag: 'Game' }, { id: 'b', title: 'Beta' }, { id: 'c', title: 'Gamma' }, { id: 'd', title: 'Delta', tag: 'Alpha cousin' }]
    .map(e => ({ category: 'pop', stars: {}, ...e }));
  const sc = { get: id => (id === 'a' ? { best: {} } : null) };
  const ids = (v, ...rest) => applyView(es, v, sc, [], ...rest).map(e => e.id);
  assert.deepEqual(ids({ category: 'recent' }, ['d', 'a', 'zzz']), ['d', 'a']); // newest first, regardless of sort
  assert.deepEqual(ids({ category: 'unplayed', sort: 'title' }), ['b', 'd', 'c']);   // not played
  assert.deepEqual(ids({ sort: 'title' }, [], 'alpha'), ['a', 'd']);            // title or tag, case-insensitive
  assert.deepEqual(ids({ sort: 'title' }, [], '  '), ['a', 'b', 'd', 'c']);
  assert.equal(randomOf(es, 'a', () => 0).id, 'b');                             // never the current song
  assert.equal(randomOf([es[0]], 'a').id, 'a');
  assert.equal(randomOf([], 'a'), null);
});

test('songs: every song has a known category and every category is used', async () => {
  const { CATEGORIES } = await import('../src/songs.js');
  const ids = new Set(CATEGORIES.map(c => c.id));
  assert.ok(SONGS.length >= 30);
  for (const s of SONGS) assert.ok(ids.has(s.category), s.id);
  for (const c of ids) assert.ok(SONGS.some(s => s.category === c), c);
});

test('scores: fc/ap flags are sticky per song', () => {
  const m = new Map();
  const st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  const s = createScores(st);
  s.record('x', { score: 100, fc: true, ap: false });
  for (let i = 0; i < 6; i++) s.record('x', { score: 1000 + i, fc: false });
  assert.equal(s.get('x').fc, true);
  assert.equal(s.get('x').ap, false);
  assert.equal(createScores(st).get('x').fc, true); // persisted
  assert.equal(s.get('y'), null);
});

test('chart: every pitched note is either playable or backing', () => {
  const song = parseRTTTL(SONGS[0].rtttl);
  const total = song.notes.filter(n => !n.isRest).length;
  const c = generateChart(song);
  const chords = c.notes.filter(n => n.chordLanes);
  const partners = chords.length - new Set(chords.map(n => n.time)).size; // each chord adds all but one of its notes
  assert.equal(c.notes.length - partners + c.backing.length, total);
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

test('computeVersion: minor from the newest changelog entry, patch = commits since it was added', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rb-ver-'));
  const sh = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, env: cleanGitEnv(), stdio: 'ignore' }); // the pre-commit hook runs the tests with GIT_DIR set
  const entry = v => writeFileSync(join(dir, 'src/changelog.js'), `export const MESSAGES = [\n  {\n    version: '${v}', date: 'x',\n  },\n];\n`);
  mkdirSync(join(dir, 'src'));
  sh('init', '-q');
  entry('1.0'); sh('add', '.'); sh('commit', '-qm', 'one');
  writeFileSync(join(dir, 'a.txt'), '1'); sh('add', '.'); sh('commit', '-qm', 'two');
  writeFileSync(join(dir, 'a.txt'), '2'); sh('add', '.'); sh('commit', '-qm', 'three');
  assert.equal(computeVersion(dir).version, '1.0.2');
  entry('1.1'); sh('add', '.'); sh('commit', '-qm', 'four');
  assert.equal(computeVersion(dir).version, '1.1.0');
  writeFileSync(join(dir, 'a.txt'), '3'); sh('add', '.'); sh('commit', '-qm', 'five');
  assert.equal(computeVersion(dir).version, '1.1.1');
  rmSync(dir, { recursive: true, force: true });
});

test('the newest changelog entry is major.minor and VERSION starts with it', () => {
  assert.match(MESSAGES[0].version, /^\d+\.\d+$/);
  assert.ok(VERSION.startsWith(MESSAGES[0].version + '.'));
});

test('buildLine formats stamped and dev builds', () => {
  assert.equal(buildLine({ number: 42, commit: '3a9f1c2', date: '2026-10-16' }), 'build 42 · 3a9f1c2 · 2026-10-16');
  assert.equal(buildLine({ number: 42, commit: '3a9f1c2', date: '2026-10-16' }, false), '3a9f1c2 · 2026-10-16');
  assert.equal(buildLine({ number: 0, commit: 'dev', date: '' }), 'dev build');
  assert.equal(buildLine(BUILD), BUILD.number ? buildLine(BUILD) : 'dev build');
});

test('fast 16th-note song still gets sparse chart', () => {
  const seq = [];
  for (let i = 0; i < 60; i++) { const n = ['d#', 'f', 'f#', 'g#', 'a#'][i % 5]; seq.push(`16${n}`, `16${n}`); }
  const song = parseRTTTL(`Fast:d=4,o=5,b=147:${seq.join(',')}`);
  const c = generateChart(song);
  assert.ok(c.notes.length >= 20, `${c.notes.length} notes`);
});

test('composer: a full-length song at the note cap fits the saved-song size limit', () => {
  const s = C.create(); s.name = 'x'.repeat(40);
  for (let i = 0; i < C.MAX_NOTES + 5; i++) s.notes.push({ p: 'c', sharp: true, dur: 32, dotted: true, oct: 7 });
  s.cursor = s.notes.length;
  assert.equal(C.pressNote(s, 1, 0), false); // capped
  s.notes.length = C.MAX_NOTES;
  assert.ok(C.toRTTTL(s).length <= MAX_RTTTL);
});

// ---- Phase A: short holds, doubles ----
const chartOf = r => generateChart(parseRTTTL(r));

test('chart: dotted-then-short notes become short holds ', () => {
  const r = 't:d=8,o=5,b=120:8c.,16d,8e.,16f,8g.,16a,8c6.,16b,8a.,16g';
  const isShort = n => n.isHold && n.duration < HOLD_MIN_SEC;
  assert.ok(chartOf(r).notes.some(isShort));
  // a plain dotted note (no short follower) stays a tap
  assert.ok(!chartOf('t:d=8,o=5,b=200:8c.,8d,8e.,8f,8g.,8a').notes.some(n => n.isHold));
});

test('chart: doubles in a free neighbouring lane, same time', () => {
  const r = 't:d=8,o=5,b=120:c,c6,d,d6,e,e6,f,f6,g,g6,a,a6,b,b6,c,c6,d,d6';
  const c = chartOf(r);
  const pairs = c.notes.filter(n => n.chordLanes?.length === 1);
  assert.ok(pairs.length >= 2);
  for (const n of pairs) {
    const mate = c.notes.find(m => m !== n && m.time === n.time && m.lane === n.chordLanes[0]);
    assert.ok(mate, 'partner exists at the same time');
    assert.equal(Math.abs(mate.lane - n.lane), 1);
  }
  c.notes.forEach((n, i) => { assert.equal(n.id, i); if (i) assert.ok(n.time >= c.notes[i - 1].time); });
});

// ---- rolls ----
const ROLL_SONG = 't:d=16,o=5,b=125:8c,e,g,g,g,g,g,g,g,g,8e,4c';

test('chart: fast same-pitch runs become one roll with tick offsets; slow repeats stay taps', () => {
  const c = chartOf(ROLL_SONG);
  const rolls = c.notes.filter(n => n.isRoll);
  assert.equal(rolls.length, 1);
  const r = rolls[0];
  assert.equal(r.ticks.length, 8);
  assert.equal(r.ticks[0], 0);
  assert.ok(!r.isHold && r.goal >= 3 && r.goal <= r.ticks.length);
  assert.ok(Math.abs(r.duration - (r.ticks[7] + 0.05)) < 1e-9);
  // the run's own notes are gone from the playable list; their sound is not lost (it is the player's mash)
  assert.equal(c.notes.filter(n => n.midi === r.midi && !n.isRoll).length, 0);
  const slow = chartOf('t:d=4,o=5,b=100:c,c,c,c,c,c,e,g');
  assert.equal(slow.notes.filter(n => n.isRoll).length, 0);
});

test('game: roll is judged by share of its goal; each press scores; misses when ignored', () => {
  const run = presses => {
    const g = new Game(stubSynth());
    const chart = {
      lanes: 4, length: 3, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
      notes: [
        { id: 0, time: 1, duration: 0.65, lane: 1, midi: 60, isHold: false, isRoll: true, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], goal: 5 },
        { id: 1, time: 2, duration: 0.2, lane: 1, midi: 64, isHold: false },
      ],
    };
    g.start(chart, { leadIn: 0, backing: false });
    try {
      for (let k = 0; k < presses; k++) { g.update(1 + k * 0.1); g.press(1, g.songStart + 1 + k * 0.1); }
      g.update(1.8);
      const roll = chart.notes[0];
      g.update(2); g.press(1, g.songStart + 2); // the tap after the roll is still hittable
      return { judgement: roll.judgement, hits: roll.rollHits, score: g.score, tap: chart.notes[1].judgement, miss: g.counts.miss };
    } finally { g.stop(); }
  };
  const full = run(7), great = run(3), good = run(2), one = run(1), none = run(0);
  assert.equal(full.judgement, 'perfect');
  assert.equal(full.hits, 7);
  assert.ok(full.score > 300 + 70, 'tick points on top of the roll judgement');
  assert.equal(great.judgement, 'great'); // 3 of goal 5 = 0.6
  assert.equal(good.judgement, 'good');   // 0.4
  assert.equal(one.judgement, 'miss');
  assert.equal(none.judgement, 'miss');
  assert.equal(none.miss, 1);
  assert.equal(none.tap, 'perfect');
});

test('speed: rolls scale with the chart', () => {
  const c = chartOf(ROLL_SONG);
  const r = c.notes.find(n => n.isRoll);
  const half = scaleChart(c, 0.5).notes.find(n => n.isRoll);
  assert.ok(Math.abs(half.ticks[3] - r.ticks[3] * 2) < 1e-9);
  assert.ok(Math.abs(half.duration - r.duration * 2) < 1e-9);
});

// ---- slides are gone, triples ----
test('chart: stepwise runs stay plain notes (no slide fields, ordinary windows)', () => {
  const c = chartOf('t:d=8,o=5,b=100:c,d,e,g,a,g,e,c');
  assert.ok(c.notes.every(n => n.slide === undefined && n.slideIdx === undefined));
});

test('chart: triples on strong free-lane notes, >= 4 s apart, partners at the same time', () => {
  const song = SONGS.find(s => s.id === 'entertainer-full').rtttl;
  const c = chartOf(song);
  const heads = c.notes.filter(n => n.chordLanes?.length === 2 && !c.notes.some(m => m.time === n.time && m.lane < n.lane && m.chordLanes?.length === 2));
  assert.ok(heads.length >= 1, 'the chart has a triple');
  for (const n of c.notes.filter(x => x.chordLanes?.length === 2)) {
    const group = c.notes.filter(m => m.time === n.time && m.chordLanes?.length === 2);
    assert.equal(group.length, 3, 'three notes at the same time');
    assert.equal(new Set(group.map(m => m.lane)).size, 3, 'in three different lanes');
    for (const m of group) assert.deepEqual(m.chordLanes, group.map(x => x.lane).filter(l => l !== m.lane).sort((a, b) => a - b));
  }
  const times = [...new Set(c.notes.filter(n => n.chordLanes?.length === 2).map(n => n.time))].sort((a, b) => a - b);
  times.forEach((t, i) => i && assert.ok(t - times[i - 1] >= 4 - 1e-9));
  c.notes.forEach((n, i) => assert.equal(n.id, i));
});

test('game: notes of a chord are judged separately and only the hit window applies', () => {
  const play = off => {
    const g = new Game(stubSynth());
    const chart = { lanes: 4, length: 3, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
      notes: [0, 1, 2].map(l => ({ id: l, time: 1, duration: 0.2, lane: l, midi: 60 + l, isHold: false, hit: false, judged: false,
        chordLanes: [0, 1, 2].filter(x => x !== l) })) };
    g.start(chart, { leadIn: 0, backing: false });
    try {
      g.press(0, g.songStart + 1 + off); g.press(1, g.songStart + 1 + off);
      return chart.notes.map(n => n.judgement);
    } finally { g.stop(); }
  };
  assert.deepEqual(play(0.01), ['perfect', 'perfect', null], 'the unpressed lane stays open');
  assert.deepEqual(play(0.16), [null, null, null], 'outside the Good window nothing is hit');
});

test('game: chord partners are silent, so a perfect run sounds like the song', () => {
  const synth = stubSynth(), played = [];
  synth.playNote = o => { played.push(o.midi); return { release() {} }; };
  const g = new Game(synth);
  const chart = { lanes: 4, length: 3, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
    notes: [{ lane: 0, midi: 60, chordLanes: [1, 2] }, { lane: 1, midi: 60, silent: true, chordLanes: [0, 2] },
      { lane: 2, midi: 60, silent: true, chordLanes: [0, 1] }].map((n, id) => ({ id, time: 1, duration: 0.2, isHold: false, hit: false, judged: false, ...n })) };
  g.start(chart, { leadIn: 0, backing: false });
  try { for (const l of [0, 1, 2]) g.press(l, g.songStart + 1); } finally { g.stop(); }
  assert.deepEqual(chart.notes.map(n => n.judgement), ['perfect', 'perfect', 'perfect']);
  assert.deepEqual(played, [60], 'only the melody note sounds');
});

test('game: a slide hits chord notes only, silently ignores everything else', () => {
  const g = new Game(stubSynth());
  const mk = (id, time, lane, extra) => ({ id, time, duration: 0.2, lane, midi: 60, isHold: false, hit: false, judged: false, ...extra });
  const chart = { lanes: 4, length: 5, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
    notes: [mk(0, 1, 0, { chordLanes: [1, 2] }), mk(1, 1, 1, { chordLanes: [0, 2] }), mk(2, 1, 2, { chordLanes: [0, 1] }), mk(3, 2, 3, {})] };
  g.start(chart, { leadIn: 0, backing: false });
  try {
    g.press(0, g.songStart + 1);
    g.slide(1, g.songStart + 1.02); g.slide(2, g.songStart + 1.04);
    assert.deepEqual(chart.notes.slice(0, 3).map(n => n.judged), [true, true, true]);
    g.update(1.5);
    assert.deepEqual(g.chords.triples, { done: 1, total: 1 });
    assert.equal(g.strays, 0);
    g.slide(3, g.songStart + 2);                                            // plain note: ignored
    g.slide(1, g.songStart + 3);                                            // nothing there: no stray
    assert.equal(chart.notes[3].judged, false);
    assert.equal(g.strays, 0);
    assert.ok(g.log.some(([, l]) => l === 1), 'the slide is logged as a press');
  } finally { g.stop(); }
});

test('game: chord counters count a chord only when all its notes were hit', () => {
  const g = new Game(stubSynth());
  const mk = (id, time, lane, chordLanes) => ({ id, time, duration: 0.2, lane, midi: 60, isHold: false, hit: false, judged: false, chordLanes });
  const chart = { lanes: 4, length: 5, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
    notes: [mk(0, 1, 0, [1]), mk(1, 1, 1, [0]), mk(2, 2, 0, [1, 2]), mk(3, 2, 1, [0, 2]), mk(4, 2, 2, [0, 1]), mk(5, 3, 0, [1]), mk(6, 3, 1, [0])] };
  g.start(chart, { leadIn: 0, backing: false });
  try {
    assert.deepEqual(g.chords, { doubles: { done: 0, total: 2 }, triples: { done: 0, total: 1 } });
    g.press(0, g.songStart + 1); g.press(1, g.songStart + 1);              // double cleared
    for (const l of [0, 1, 2]) g.press(l, g.songStart + 2);                // triple cleared
    g.press(0, g.songStart + 3);                                           // second double: one note left to miss
    g.update(3.5);
    assert.deepEqual(g.chords, { doubles: { done: 1, total: 2 }, triples: { done: 1, total: 1 } });
  } finally { g.stop(); }
});

test('chartStats: counts per note kind add up for the chart the song plays', async () => {
  const { chartStats, peakPerSecond } = await import('../src/chartstats.js');
  assert.equal(peakPerSecond([0, 0.5, 0.9, 1.5, 3]), 3);
  const lib = buildLibrary();
  assert.equal(lib.length, SONGS.length);
  for (const e of lib.filter(x => ['entertainer-full', 'ode'].includes(x.id))) {
    const st = chartStats(e), c = generateChart(e.song);
    assert.equal(st.notes, c.notes.length);
    assert.equal(st.taps + st.holds + st.rolls, st.notes);
    assert.equal(st.lanes.reduce((x, y) => x + y, 0), st.notes);
    assert.equal(st.doubles * 2 + st.triples * 3, c.notes.filter(n => n.chordLanes).length);
  }
  assert.ok(chartStats(lib.find(x => x.id === 'entertainer-full')).triples > 0);
});

test('chart: every extra chord note is silent and no chart invents pitches', () => {
  for (const id of ['entertainer-full', 'canon-full']) {
    const song = parseRTTTL(SONGS.find(s => s.id === id).rtttl);
    const c = generateChart(song);
    const sounding = c.notes.filter(n => !n.silent);
    assert.ok(c.notes.some(n => n.silent), id);
    assert.equal(sounding.length + c.backing.length, song.notes.filter(n => !n.isRest).length, id);
  }
});

test('tutorial: roll notes carry a finite tickDur (auto-play rolls must not sustain forever)', () => {
  const rolls = STAGES.flatMap(s => buildStageChart(s).notes).filter(n => n.isRoll);
  assert.ok(rolls.length > 0);
  for (const n of rolls) assert.ok(Number.isFinite(n.tickDur) && n.tickDur > 0);
});

test('applyView: the Favorites sort can use its own favorite list, so toggling a heart keeps the order', () => {
  const es = ['a', 'b', 'c'].map((id, i) => ({ id, title: id, bpm: 100, length: 10, category: 'pop', stars: i + 1, rating: null }));
  const sc = { get: () => null };
  const ids = (favs, sortFavs) => applyView(es, { sort: 'fav' }, sc, favs, [], '', [], sortFavs).map(e => e.id);
  assert.deepEqual(ids(['c'], ['c']), ['c', 'a', 'b']);
  assert.deepEqual(ids(['c', 'a'], ['c']), ['c', 'a', 'b']); // 'a' was just favorited: it stays put
  assert.deepEqual(ids(['c', 'a']), ['a', 'c', 'b']);        // a fresh snapshot moves it up
});
