// Node tests for the pure modules: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart, chartDistance } from '../src/chart.js';
import { SONGS } from '../src/songs.js';
import { buildLibrary, customEntry, DIFFICULTIES, COLLAPSE_MAX, setMeasured } from '../src/library.js';
import { createScores, TOP_N } from '../src/scores.js';
import { scaleChart } from '../src/mods.js';
import { Game } from '../src/game.js';
import { STAGES, buildStageChart, stagePassed } from '../src/tutorial.js';
import { HOLD_MIN_SEC } from '../src/chart.js';
import { createPerf } from '../src/perf.js';
import * as C from '../src/composer.js';
import { createMySongs, MAX_SONGS, MAX_RTTTL } from '../src/mysongs.js';
import { VERSION, BUILD, buildLine } from '../src/version.js';
import { readFileSync } from 'node:fs';
import { sanitizeBindings, DEFAULT_BINDINGS } from '../src/gamepad.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('library: songs whose Normal and Hard charts barely differ get one difficulty', () => {
  setMeasured(JSON.parse(readFileSync(new URL('../src/difficulty.json', import.meta.url))));
  const lib = buildLibrary(), by = id => lib.find(e => e.id === id);
  setMeasured({});
  assert.equal(by('ode').only, 'normal');     // identical charts, Hard rating below 5
  assert.equal(by('zelda').only, 'hard');     // identical charts, Hard rating 6.4
  assert.equal(by('tetris').only, 'hard');    // two notes apart, Hard rating 8.1
  assert.equal(by('ode').notes.hard, by('ode').notes.normal);
  assert.equal(by('ode').rating.hard, by('ode').rating.normal);
  for (const e of lib) {
    const d = chartDistance(generateChart(e.song, { difficulty: 'normal' }), generateChart(e.song, { difficulty: 'hard' }));
    assert.equal(!!e.only, d <= COLLAPSE_MAX, e.id);
  }
  assert.ok(lib.filter(e => e.only).length >= 40);
  const rich = parseRTTTL('a:d=16,o=5,b=180:c,c7,d,d7,e,e7,f,f7,g,g7,a,a7,b,b7,c6,c4');
  assert.ok(chartDistance(generateChart(rich, { difficulty: 'normal' }), generateChart(rich, { difficulty: 'hard' })) > 0);
  assert.equal(chartDistance(generateChart(rich, { difficulty: 'hard' }), generateChart(rich, { difficulty: 'hard' })), 0);
  assert.equal(customEntry('t:d=4,o=5,b=120:c,d,e,f,g,a,b,c6').only, 'normal'); // custom songs follow the same rule
  assert.equal(customEntry('a:d=16,o=5,b=180:c,c7,d,d7,e,e7,f,f7,g,g7,a,a7,b,b7,c6,c4').only, undefined);
});

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
  s.record('b', 'normal', { ...run(5), fc: true, ap: true });
  assert.equal(createScores(st).get('b', 'normal').best.ap, true);
  // corruption
  for (const bad of ['{{{', 'null', '[]', '{"a":{"normal":{"top":[{"score":"x"}]}}}', '{"a":5}']) {
    const c = mem(); c.setItem('ringbeat.scores.v1', bad);
    assert.equal(createScores(c).get('a', 'normal'), null, bad);
  }
  s.clear();
  assert.equal(s.get('a', 'normal'), null);
});

test('speed: scaleChart keeps order/count, scales times & grid', () => {
  const c = generateChart(parseRTTTL(SONGS[0].rtttl), { difficulty: 'normal' });
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

function playWithStray(afterLast) {
  const g = new Game(stubSynth());
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'), { difficulty: 'normal' });
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
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'), { difficulty: 'normal' });
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
  const chart = generateChart(parseRTTTL('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6'), { difficulty: 'normal' });
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
  for (const kind of ['isRoll', 'chordLane', 'slide']) {
    assert.ok(STAGES.some(s => buildStageChart(s).notes.some(n => n[kind])), `a stage teaches ${kind}`);
  }
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

const songChart = (id, d) => generateChart(parseRTTTL(SONGS.find(s => s.id === id).rtttl), { difficulty: d });

test('bot: stray presses break full combo but not accuracy', () => {
  const c = botChart('normal');
  const clean = runBot(c, { sigma: 0 }, 1);
  const messy = runBot(c, { sigma: 0, stray: 1 }, 1);
  assert.equal(clean.fc, true);
  assert.equal(messy.fc, false);
  assert.equal(messy.counts.miss, 0);
  assert.equal(messy.accuracy, clean.accuracy);
});

test('bot: fatigue widens timing jitter over the song', () => {
  const c = songChart('ode-full', 'normal');
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
  for (const t of ['holds', 'rolls', 'slides', 'doubles', 'stamina']) assert.ok(!m.tags.includes(t), t);
  assert.ok(Number.isFinite(m.nps) && Number.isFinite(m.acc));
});

test('difficulty.json: complete, in range, tags plausible, tiers sane', () => {
  const d = JSON.parse(readFileSync(new URL('../src/difficulty.json', import.meta.url)));
  const levels = LADDER.map(l => l.name);
  for (const s of SONGS) {
    assert.ok(d[s.id], 'rated: ' + s.id);
    const r = DIFFICULTIES.map(k => d[s.id][k].rating);
    for (const k of DIFFICULTIES) {
      const m = d[s.id][k];
      assert.ok(m.rating >= 1 && m.rating <= 10, s.id + ' ' + k);
      assert.deepEqual(Object.keys(m.fc), levels, s.id + ' ' + k + ' ladder keys (run npm run bench)');
      assert.ok(m.tags.length <= 2);
    }
    // Normal must not outrate Hard by a wide margin.
    assert.ok(r[0] <= r[1] + 1.8, s.id + ' normal vs hard ' + r);
  }
});

test('listview: sort', () => {
  const mk = (id, rating, bpm) => ({ id, title: id, bpm, stars: { normal: 1 }, rating: { normal: rating } });
  const es = [mk('a', 5, 100), mk('b', 2, 140), mk('custom:x', 1, 90), mk('c', 8, 80)];
  const sc = { get: (id) => id === 'a' ? { top: [{ fc: true }] } : id === 'b' ? { top: [{ fc: false }] } : null };
  const ids = v => applyView(es, v, 'normal', sc).map(e => e.id);
  assert.deepEqual(ids({}), ['b', 'a', 'c', 'custom:x']);
  assert.deepEqual(ids({ sort: 'diff-desc' }), ['c', 'a', 'b', 'custom:x']);
  assert.deepEqual(ids({ sort: 'title' }), ['a', 'b', 'c', 'custom:x']);
});

test('listview: category filter', () => {
  const es = [{ id: 'a', category: 'pop' }, { id: 'b', category: 'classical' }, { id: 'custom:x', category: 'custom' }].map(e => ({ ...e, title: e.id, stars: {} }));
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
  assert.equal(s.get('x', 'normal'), null);
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
  const mm = v => v.split('.').slice(0, 2).join('.');
  assert.equal(mm(VERSION), mm(pkg.version));
});

test('buildLine formats stamped and dev builds', () => {
  assert.equal(buildLine({ number: 42, commit: '3a9f1c2', date: '2026-10-16' }), 'build 42 · 3a9f1c2 · 2026-10-16');
  assert.equal(buildLine({ number: 42, commit: '3a9f1c2', date: '2026-10-16' }, false), '3a9f1c2 · 2026-10-16');
  assert.equal(buildLine({ number: 0, commit: 'dev', date: '' }), 'dev build');
  assert.equal(buildLine(BUILD), BUILD.number ? buildLine(BUILD) : 'dev build');
});

test('fast 16th-note song still gets sparse normal chart', () => {
  const seq = [];
  for (let i = 0; i < 60; i++) { const n = ['d#', 'f', 'f#', 'g#', 'a#'][i % 5]; seq.push(`16${n}`, `16${n}`); }
  const song = parseRTTTL(`Fast:d=4,o=5,b=147:${seq.join(',')}`);
  for (const d of ['normal']) {
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

// ---- Phase A: short holds, doubles ----
const chartOf = (r, d = 'hard') => generateChart(parseRTTTL(r), { difficulty: d });

test('chart: dotted-then-short notes become short holds on normal/hard', () => {
  const r = 't:d=8,o=5,b=120:8c.,16d,8e.,16f,8g.,16a,8c6.,16b,8a.,16g';
  const isShort = n => n.isHold && n.duration < HOLD_MIN_SEC;
  assert.ok(chartOf(r, 'normal').notes.some(isShort));
  // a plain dotted note (no short follower) stays a tap
  assert.ok(!chartOf('t:d=8,o=5,b=200:8c.,8d,8e.,8f,8g.,8a', 'normal').notes.some(n => n.isHold));
});

test('chart: doubles only on hard, in a free neighbouring lane, same time', () => {
  const r = 't:d=8,o=5,b=120:c,c6,d,d6,e,e6,f,f6,g,g6,a,a6,b,b6,c,c6,d,d6';
  assert.ok(!chartOf(r, 'normal').notes.some(n => n.chordLane !== undefined));
  const c = chartOf(r, 'hard');
  const pairs = c.notes.filter(n => n.chordLane !== undefined);
  assert.ok(pairs.length >= 2);
  for (const n of pairs) {
    const mate = c.notes.find(m => m !== n && m.time === n.time && m.lane === n.chordLane);
    assert.ok(mate, 'partner exists at the same time');
    assert.equal(Math.abs(mate.lane - n.lane), 1);
  }
  c.notes.forEach((n, i) => { assert.equal(n.id, i); if (i) assert.ok(n.time >= c.notes[i - 1].time); });
});

// ---- rolls ----
const ROLL_SONG = 't:d=16,o=5,b=125:8c,e,g,g,g,g,g,g,g,g,8e,4c';

test('chart: fast same-pitch runs become one roll with tick offsets; slow repeats stay taps', () => {
  const c = chartOf(ROLL_SONG, 'normal');
  const rolls = c.notes.filter(n => n.isRoll);
  assert.equal(rolls.length, 1);
  const r = rolls[0];
  assert.equal(r.ticks.length, 8);
  assert.equal(r.ticks[0], 0);
  assert.ok(!r.isHold && r.goal >= 3 && r.goal <= r.ticks.length);
  assert.ok(Math.abs(r.duration - (r.ticks[7] + 0.05)) < 1e-9);
  // the run's own notes are gone from the playable list; their sound is not lost (it is the player's mash)
  assert.equal(c.notes.filter(n => n.midi === r.midi && !n.isRoll).length, 0);
  const slow = chartOf('t:d=4,o=5,b=100:c,c,c,c,c,c,e,g', 'normal');
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
  const c = chartOf(ROLL_SONG, 'normal');
  const r = c.notes.find(n => n.isRoll);
  const half = scaleChart(c, 0.5).notes.find(n => n.isRoll);
  assert.ok(Math.abs(half.ticks[3] - r.ticks[3] * 2) < 1e-9);
  assert.ok(Math.abs(half.duration - r.duration * 2) < 1e-9);
});

// ---- slides ----
test('chart: stepwise runs become slides, one lane per note, in one direction', () => {
  const c = chartOf('t:d=8,o=5,b=100:c,d,e,g,a,g,e,c', 'normal');
  const sl = c.notes.filter(n => n.slide !== undefined);
  assert.ok(sl.length >= 3);
  const chains = new Map();
  for (const n of sl) (chains.get(n.slide) || chains.set(n.slide, []).get(n.slide)).push(n);
  for (const ch of chains.values()) {
    assert.ok(ch.length >= 3 && ch.length <= 4);
    ch.forEach((n, k) => assert.equal(n.slideIdx, k));
    const step = Math.sign(ch[1].lane - ch[0].lane);
    assert.notEqual(step, 0);
    ch.forEach((n, k) => k && assert.equal(n.lane - ch[k - 1].lane, step));
    const dir = Math.sign(ch[1].midi - ch[0].midi);
    assert.equal(step, dir);
  }
  // leaps and repeats are not slides
  assert.equal(chartOf('t:d=8,o=5,b=100:c,g,c6,g,c,g,c6,g', 'normal').notes.filter(n => n.slide !== undefined).length, 0);
});

test('game: slide follow-ups accept wide presses as Good; the first note and ordinary notes do not', () => {
  const play = (idx, off) => {
    const g = new Game(stubSynth());
    const chart = { lanes: 4, length: 3, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
      notes: [{ id: 0, time: 1, duration: 0.2, lane: 0, midi: 60, isHold: false, slide: 0, slideIdx: idx }] };
    g.start(chart, { leadIn: 0, backing: false });
    try {
      g.update(1 + off); g.press(0, g.songStart + 1 + off);
      return chart.notes[0].judgement;
    } finally { g.stop(); }
  };
  assert.equal(play(0, 0.16), 'miss', 'first note: outside the normal window');
  assert.equal(play(1, 0.16), 'good', 'follow-up: forgiven');
  assert.equal(play(1, -0.16), 'good');
  assert.equal(play(1, 0.2), 'miss');
  assert.equal(play(1, 0.01), 'perfect');
});
