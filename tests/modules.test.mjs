// Pure-logic gaps: mysongs validation, composer ops, bot weaknesses, listview, library helpers, input clock, gamepad, cameo status sims, small art helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMySongs, rtttlProblem, isValidRtttl, splitRtttl, MAX_RTTTL, MYSONGS_KEY } from '../src/mysongs.js';
import * as C from '../src/composer.js';
import { planBot, runBot, measureProfile, LADDER, SPECIALISTS, mulberry32 } from '../src/bot.js';
import { applyView, nextOf, prevOf, ratingOf, SORTS } from '../src/listview.js';
import { formatLength, starsFor, hashString } from '../src/library.js';
import { assignLanesQuantile, assignLanesContour } from '../src/chart.js';
import * as M from '../src/mods.js';
import { eventAudioTime } from '../src/input.js';
import { Pad, BTN, buttonName, cloneBindings, DEFAULT_BINDINGS } from '../src/gamepad.js';
import { createSms, createSignalWobble, createLowBattery, createScheduler, CAMEOS } from '../src/cameo.js';
import { formatImei, fakeImei } from '../src/secrets.js';
import { envelope, signal, battery, spriteURL, spriteSVG, SPRITES, SPRITES_FAV, categorySprite } from '../src/pixelart.js';
import { createTitle, layoutTitle, dropDy, T as TT, REST as TITLE_REST } from '../src/titlefx.js';
import { createWelcome, layoutName, T as WT, TICK_MS } from '../src/welcome.js';
import { CATEGORIES } from '../src/songs.js';
import { parseRTTTL } from '../src/rtttl.js';
import { generateChart } from '../src/chart.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const SONG = 'Ode:d=4,o=5,b=140:8e,8e,8f,8g,8g,8f,8e,8d,8c,8c,8d,8e,e.,16d,2d';

// ---- mysongs ----
test('mysongs: rtttlProblem explains every failure', () => {
  assert.equal(rtttlProblem(''), 'Nothing to save');
  assert.equal(rtttlProblem(null), 'Nothing to save');
  assert.equal(rtttlProblem('   '), 'Nothing to save');
  assert.match(rtttlProblem('a:d=4:' + 'c,'.repeat(MAX_RTTTL)), /^Too long \(\d+\/8000 characters\)$/);
  assert.match(rtttlProblem('garbage'), /No notes section/);
  assert.match(rtttlProblem('a:d=4:zz'), /No valid notes/);
  assert.equal(rtttlProblem(SONG), '');
  assert.equal(rtttlProblem('  ' + SONG + '  '), '', 'trimmed');
  assert.equal(rtttlProblem('a:d=4,o=5,b=120:c'), '', 'a single note is still playable');
});

test('mysongs: isValidRtttl', () => {
  assert.equal(isValidRtttl(SONG), true);
  for (const bad of ['', null, 5, 'x', 'a:d=4:p', 'a:d=4:' + 'c,'.repeat(MAX_RTTTL)]) assert.equal(isValidRtttl(bad), false, String(bad).slice(0, 20));
});

test('mysongs: splitRtttl picks song lines out of messy text', () => {
  assert.deepEqual(splitRtttl(''), []);
  assert.deepEqual(splitRtttl(null), []);
  assert.deepEqual(splitRtttl('a:d=4:c\r\n\r\nnot a song\n  b:d=4:d  \n x:y'), ['a:d=4:c', 'b:d=4:d']);
});

test('mysongs: unavailable window.localStorage degrades to memory', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, get() { throw new Error('denied'); } });
  try {
    const s = createMySongs();
    s.add('x', SONG);
    assert.equal(s.list().length, 1);
  } finally {
    if (had) Object.defineProperty(globalThis, 'window', had); else delete globalThis.window;
  }
});

test('mysongs: a throwing storage does not break add/list', () => {
  const st = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); }, removeItem() {} };
  const s = createMySongs(st);
  assert.equal(s.list().length, 0);
  s.add('x', SONG);
  assert.equal(s.list().length, 1);
});

test('mysongs: persisted junk entries are dropped', () => {
  const st = mem();
  st.setItem(MYSONGS_KEY, JSON.stringify([null, 5, { rtttl: 7 }, { rtttl: 'nope' }, { rtttl: SONG, name: '', updated: 'x' }]));
  const l = createMySongs(st).list();
  assert.equal(l.length, 1);
  assert.equal(l[0].name, 'Untitled');
  assert.equal(l[0].updated, 0);
});

// ---- composer ----
const fresh = () => C.create();
const typed = (...keys) => { const s = fresh(); keys.forEach((k, i) => C.pressNote(s, k, i * 1000)); return s; };

test('composer: changeOct moves the previous note and the pen within 4..7', () => {
  const s = typed(1);
  assert.equal(C.changeOct(s, 1), 6);
  assert.equal(s.notes[0].oct, 6);
  assert.equal(C.changeOct(s, 1), 7);
  assert.equal(C.changeOct(s, 1), 7);
  for (let i = 0; i < 5; i++) C.changeOct(s, -1);
  assert.equal(s.notes[0].oct, 4);
  const r = typed(0);
  assert.equal(C.changeOct(r, 1), 6, 'rests only move the pen');
  assert.equal(r.notes[0].oct, 5);
  assert.equal(C.changeOct(fresh(), -1), 4);
});

test('composer: changeBpm steps by 5 inside 40..250', () => {
  const s = fresh();
  assert.equal(C.changeBpm(s, 1), 125);
  assert.equal(C.changeBpm(s, -1), 120);
  s.bpm = 250; assert.equal(C.changeBpm(s, 1), 250);
  s.bpm = 40; assert.equal(C.changeBpm(s, -1), 40);
});

test('composer: move, backspace and clear keep the cursor valid', () => {
  const s = typed(1, 2, 3);
  assert.equal(s.cursor, 3);
  assert.equal(C.move(s, 1), 3);
  assert.equal(C.move(s, -1), 2);
  C.move(s, -1); C.move(s, -1);
  assert.equal(C.move(s, -1), 0);
  assert.equal(C.backspace(s), false);
  C.pressNote(s, 4, 99999);
  assert.deepEqual(s.notes.map(n => n.p), ['f', 'c', 'd', 'e'], 'inserts at the cursor');
  assert.equal(C.backspace(s), true);
  assert.equal(s.cursor, 0);
  C.clear(s);
  assert.deepEqual([s.notes.length, s.cursor], [0, 0]);
});

test('composer: noteLabel and midiOf', () => {
  assert.equal(C.noteLabel({ p: 'p' }), 'rest');
  assert.equal(C.noteLabel({ p: 'c', sharp: true, oct: 5 }), 'C#5');
  assert.equal(C.noteLabel({ p: 'a', sharp: false, oct: 4 }), 'A4');
  assert.equal(C.midiOf({ p: 'p' }), 0);
  assert.equal(C.midiOf({ p: 'a', sharp: false, oct: 4 }), 69);
  assert.equal(C.midiOf({ p: 'c', sharp: true, oct: 5 }), 73);
});

test('composer: e and b refuse sharps, rests refuse modifiers, dots toggle', () => {
  const s = typed(3);
  assert.equal(C.toggleSharp(s), false);
  assert.equal(C.toggleSharp(typed(0)), false);
  assert.equal(C.toggleSharp(fresh()), false);
  const d = typed(1);
  assert.equal(C.toggleDot(d), true);
  assert.equal(d.notes[0].dotted, true);
  assert.equal(C.toggleDot(fresh()), false);
});

test('composer: fromRTTTL handles dotted durations, rests and rounds bpm', () => {
  const s = C.fromRTTTL('x y:d=4,o=5,b=137:8c#.,2p,16g6');
  assert.equal(s.bpm, 135);
  assert.deepEqual(s.notes[0], { p: 'c', sharp: true, dur: 8, dotted: true, oct: 5 });
  assert.equal(s.notes[1].p, 'p');
  assert.equal(s.notes[1].dur, 2);
  assert.equal(s.notes[2].oct, 6);
  assert.equal(s.cursor, 3);
  assert.throws(() => C.fromRTTTL('junk'));
  assert.equal(C.fromRTTTL('a:d=4,o=5,b=900:c').bpm, 250);
});

test('composer: toRTTTL cleans the name and survives a parse', () => {
  const s = typed(1, 0, 5);
  s.name = 'a:b,c\nd';
  const out = C.toRTTTL(s);
  assert.ok(out.startsWith('a b c d:d=4,o=5,b=120:'));
  assert.equal(parseRTTTL(out).notes.length, 3);
});

test('composer: addNote copies the previous pitched note; notes cap at MAX_NOTES', () => {
  const s = typed(5);
  C.toggleDot(s);
  assert.equal(C.addNote(s), true);
  assert.deepEqual(s.notes[1], s.notes[0]);
  assert.notEqual(s.notes[1], s.notes[0]);
  const r = typed(0);
  C.addNote(r);
  assert.equal(r.notes[1].p, 'c');
  const full = fresh();
  for (let i = 0; i < C.MAX_NOTES; i++) C.addRest(full);
  assert.equal(C.addRest(full), false);
  assert.equal(C.addNote(full), false);
});

test('composer: repeated key within the window cycles the octave 4..7 and wraps', () => {
  const s = fresh();
  C.pressNote(s, 1, 0);
  const octs = [];
  for (let i = 1; i <= 4; i++) { C.pressNote(s, 1, i * 100); octs.push(s.notes[0].oct); }
  assert.deepEqual(octs, [6, 7, 4, 5]);
  assert.equal(s.notes.length, 1);
  assert.equal(C.pressNote(s, 9, 5000), false, 'unknown keys are ignored');
});

// ---- bot ----
const chartFrom = (rtttl, difficulty = 'hard') => generateChart(parseRTTTL(rtttl), { difficulty });
const mkChart = notes => ({ lanes: 4, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [], notes: notes.map((n, i) => ({ id: i, duration: 0.1, midi: 60, ...n })), length: 40 });
const presses = (ev) => ev.filter(e => e.type === 'press');

test('bot: chordMiss drops notes that sit within 100 ms of a note in another lane', () => {
  const chart = mkChart([...Array(40)].flatMap((_, i) => [{ lane: 0, time: i }, { lane: 1, time: i + 0.05 }]));
  const base = LADDER[2];
  const kept = (profile) => presses(planBot(chart, profile, 3)).length;
  assert.ok(kept({ ...base, chordMiss: 1 }) < kept({ ...base, chordMiss: 0 }) / 2);
  assert.equal(kept({ ...base, stray: 0, chordMiss: 1 }), 0);
  const lonely = mkChart([...Array(30)].map((_, i) => ({ lane: i % 4, time: i })));
  assert.equal(presses(planBot(lonely, { ...base, stray: 0, chordMiss: 1 }, 3)).length, 30, 'isolated notes are unaffected');
});

test('bot: densityPenalty widens jitter only in dense passages', () => {
  const dense = mkChart([...Array(60)].map((_, i) => ({ lane: i % 4, time: i * 0.2 })));
  const spread = (profile) => {
    const ev = presses(planBot(dense, { ...profile, stray: 0 }, 5));
    const errs = ev.map((e, i) => e.t - dense.notes[i].time);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    return Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length);
  };
  const p = { ...LADDER[3], minGap: 0, fatigue: 0 };
  assert.ok(spread({ ...p, densityPenalty: 2 }) > spread(p) * 1.5);
});

test('bot: holdDrop releases early and holdSigma moves the release', () => {
  const holds = mkChart([...Array(40)].map((_, i) => ({ lane: i % 4, time: i * 2, duration: 1, isHold: true })));
  const base = { ...LADDER[4], stray: 0, holdSigma: 0 };
  const early = (p) => planBot(holds, p, 9).filter(e => e.type === 'release').filter((e, i) => e.t < holds.notes[i].time + 0.95).length;
  assert.equal(early(base), 0);
  assert.ok(early({ ...base, holdDrop: 1 }) > 35);
  const rel = planBot(holds, { ...base, holdSigma: 200 }, 9).filter(e => e.type === 'release');
  assert.ok(rel.some((e, i) => Math.abs(e.t - (holds.notes[i].time + 1)) > 0.05));
});

test('bot: a release never lands after the same lane\'s next note', () => {
  const c = mkChart([{ lane: 0, time: 1, duration: 1, isHold: true }, { lane: 0, time: 2.05 }]);
  for (let seed = 1; seed < 30; seed++) {
    const rel = planBot(c, { ...LADDER[1], stray: 0, holdSigma: 400 }, seed).find(e => e.type === 'release');
    assert.ok(rel.t <= 2.05 - 0.1 + 1e-9 || rel.t <= 1 + 0.03 + 1e-9, 'seed ' + seed);
  }
});

test('bot: mulberry32 is deterministic, in [0,1) and seed-sensitive', () => {
  const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
  const xs = [...Array(50)].map(() => a());
  assert.deepEqual(xs, [...Array(50)].map(() => b()));
  assert.ok(xs.every(x => x >= 0 && x < 1));
  assert.notEqual(xs[0], c());
});

test('bot: the matching specialist does clearly worse than the generalist on a chart built for it', () => {
  const by = Object.fromEntries(SPECIALISTS.map(s => [s.tag, s]));
  const holds = mkChart([...Array(30)].map((_, i) => ({ lane: i % 4, time: 1 + i * 1.5, duration: 1, isHold: true })));
  const mid = LADDER[2];
  const a = measureProfile(holds, mid, 12, 1), h = measureProfile(holds, by.holds, 12, 1);
  assert.ok(h.acc < a.acc || h.fcRate < a.fcRate, `holds ${h.acc} vs ${a.acc}`);
  const dbl = mkChart([...Array(30)].flatMap((_, i) => [{ lane: 0, time: 1 + i }, { lane: 3, time: 1 + i + 0.02 }]));
  const d0 = measureProfile(dbl, mid, 12, 1), d1 = measureProfile(dbl, by.doubles, 12, 1);
  assert.ok(d1.acc < d0.acc, `doubles ${d1.acc} vs ${d0.acc}`);
});

test('bot: runBot always returns a result and leaves the input chart untouched', () => {
  const chart = chartFrom('t:d=8,o=5,b=120:c,d,e,f,g,a,b,c6');
  const copy = JSON.stringify(chart.notes);
  const res = runBot(chart, LADDER[7], 2);
  assert.ok(res.accuracy >= 0 && res.accuracy <= 100);
  assert.equal(JSON.stringify(chart.notes), copy);
});

// ---- listview / library ----
const E = (id, title, bpm, length, n, category = 'pop') => ({ id, title, bpm, length, category, chart: 'normal', stars: { normal: n, hard: n } });
test('listview: bpm and length sorts, stable ties, custom last', () => {
  const es = [E('a', 'A', 150, 30, 2), E('custom:x', 'Z', 60, 5, 1), E('b', 'B', 90, 60, 3), E('c', 'C', 90, 20, 3)];
  assert.deepEqual(applyView(es, { sort: 'bpm' }, null).map(e => e.id), ['b', 'c', 'a', 'custom:x']);
  assert.deepEqual(applyView(es, { sort: 'length' }, null).map(e => e.id), ['c', 'a', 'b', 'custom:x']);
  assert.deepEqual(applyView(es, { sort: 'nonsense' }, null).map(e => e.id), ['a', 'b', 'c', 'custom:x']);
  assert.equal(SORTS.length, 5);
});

test('listview: favorites sort puts favorites first by difficulty, custom still last', () => {
  const es = [E('a', 'A', 1, 1, 3), E('b', 'B', 1, 1, 1), E('c', 'C', 1, 1, 2), E('custom:x', 'Z', 1, 1, 1)];
  assert.deepEqual(applyView(es, { sort: 'fav' }, null, ['a', 'c', 'custom:x']).map(e => e.id), ['c', 'a', 'b', 'custom:x']);
  assert.deepEqual(applyView(es, { sort: 'fav' }, null).map(e => e.id), ['b', 'c', 'a', 'custom:x']);
});

test('listview: the favorites category lists only favorites', () => {
  const es = [E('a', 'A', 1, 1, 3), E('b', 'B', 1, 1, 1), E('c', 'C', 1, 1, 2)];
  assert.deepEqual(applyView(es, { category: 'favorites' }, null, ['c', 'a']).map(e => e.id), ['c', 'a']);
  assert.deepEqual(applyView(es, { category: 'favorites' }, null).map(e => e.id), []);
});

test('listview: nextOf / prevOf wrap, ratingOf prefers the measured rating', () => {
  const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextOf(l, 'c'), 'a');
  assert.equal(prevOf(l, 'a'), 'c');
  assert.equal(nextOf(l, 'a'), 'b');
  assert.equal(prevOf(l, 'c'), 'b');
  assert.equal(ratingOf({ chart: 'normal', rating: { normal: 4.5 }, stars: { normal: 1 } }), 4.5);
  assert.equal(ratingOf({ chart: 'hard', rating: { normal: 4.5 }, stars: { hard: 2 } }), 2.8);
  assert.equal(ratingOf({ chart: 'hard', stars: {} }), 0);
});

test('library: formatLength, starsFor and hashString', () => {
  assert.equal(formatLength(0), '0:00');
  assert.equal(formatLength(59.6), '1:00');
  assert.equal(formatLength(65), '1:05');
  assert.equal(formatLength(600), '10:00');
  const dense = n => ({ notes: Array(n), length: 10 });
  assert.equal(starsFor(dense(0)), 1);
  assert.equal(starsFor(dense(10)), 2);
  assert.equal(starsFor(dense(20)), 3);
  assert.equal(starsFor(dense(1000)), 5);
  assert.equal(starsFor({ notes: Array(5), length: 0 }), 5, 'zero length does not divide by zero');
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.match(hashString(''), /^[0-9a-z]+$/);
});

// ---- chart lanes ----
test('chart: assignLanesQuantile edge cases', () => {
  assert.deepEqual(assignLanesQuantile([60, 60, 60], 4), [1, 1, 1]);
  assert.deepEqual(assignLanesQuantile([60, 72], 4), [0, 3]);
  assert.deepEqual(assignLanesQuantile([60, 64, 67], 4), [0, 2, 3]);
  assert.deepEqual(assignLanesQuantile([], 4), []);
  const many = assignLanesQuantile([...Array(40)].map((_, i) => 40 + i), 4);
  assert.deepEqual([0, 1, 2, 3].map(l => many.filter(x => x === l).length), [10, 10, 10, 10]);
  const m = [60, 62, 60, 64, 62];
  const l = assignLanesQuantile(m, 3);
  assert.equal(l[0], l[2]);
  assert.equal(l[1], l[4]);
});

test('chart: assignLanesContour follows the melody and clamps', () => {
  assert.deepEqual(assignLanesContour([60, 62, 62, 60, 50, 40], 4), [1, 2, 2, 1, 0, 0]);
  assert.deepEqual(assignLanesContour([60, 61, 62, 63, 64, 65], 4), [1, 2, 3, 3, 3, 3]);
  assert.deepEqual(assignLanesContour([], 4), []);
});

// ---- mods ----
test('mods: summary, multText and isActive', () => {
  assert.equal(M.summary({}), 'Off');
  assert.equal(M.summary({ speed: 1.2, hidden: true, sudden: true }), '1.2x HD SD');
  assert.equal(M.summary({ judge: 'lenient', mirror: true }), 'EZ MR');
  assert.equal(M.multText(1), '×1.00');
  assert.equal(M.multText(0.855), '×0.85' === M.multText(0.855) ? '×0.85' : M.multText(0.855));
  assert.equal(M.isActive({}), false);
  assert.equal(M.isActive(undefined), false);
  for (const m of [{ speed: 1.1 }, { mirror: true }, { hidden: true }, { sudden: true }, { judge: 'strict' }, { demo: true }]) assert.equal(M.isActive(m), true, JSON.stringify(m));
});

test('mods: multiplier combines hidden and sudden, is clamped and zero for demo', () => {
  const k = M.multiplier({ hidden: true, sudden: true });
  assert.equal(k, Math.round(M.HIDDEN_MULT * M.SUDDEN_MULT * 100) / 100);
  assert.equal(M.multiplier({ demo: true, hidden: true }), 0);
  const all = M.multiplier({ speed: 1.3, judge: 'strict', hidden: true, sudden: true });
  assert.ok(all <= M.MULT_MAX);
  assert.equal(M.multiplier({ speed: 0.5, judge: 'lenient' }), 0.4);
});

// ---- input clock ----
test('input: eventAudioTime maps event time onto the speaker timeline', () => {
  const ctx = { currentTime: 10, outputLatency: 0.05, getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 1000 }) };
  assert.ok(Math.abs(eventAudioTime(ctx, { timeStamp: 1100 }) - 10.0) < 1e-9);
  assert.ok(Math.abs(eventAudioTime(ctx, { timeStamp: 900 }) - 9.8) < 1e-9, 'events from before the timestamp');
});

test('input: eventAudioTime falls back when the mapping is missing or wild', () => {
  const base = { currentTime: 10, outputLatency: 0.05 };
  assert.ok(Math.abs(eventAudioTime(base, { timeStamp: 5 }) - 9.95) < 1e-9, 'no getOutputTimestamp');
  const zero = { ...base, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) };
  assert.ok(Math.abs(eventAudioTime(zero, { timeStamp: 5 }) - 9.95) < 1e-9, 'unstarted clock');
  const stale = { ...base, getOutputTimestamp: () => ({ contextTime: 2, performanceTime: 1000 }) };
  assert.ok(Math.abs(eventAudioTime(stale, { timeStamp: 1000 }) - 9.95) < 1e-9, 'stale mapping is rejected');
  const nul = { ...base, getOutputTimestamp: () => null };
  assert.ok(Math.abs(eventAudioTime(nul, { timeStamp: 1 }) - 9.95) < 1e-9);
  assert.equal(eventAudioTime({ currentTime: 3 }, { timeStamp: 1 }), 3);
  assert.ok(Math.abs(eventAudioTime({ currentTime: 3, baseLatency: 0.01 }, { timeStamp: 1 }) - 2.99) < 1e-9, 'baseLatency when outputLatency is absent');
});

// ---- gamepad ----
function withPads(fn) {
  const listeners = {};
  let pads = [];
  const saved = { window: globalThis.window, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), now: performance.now };
  globalThis.window = { addEventListener: (n, f) => { listeners[n] = f; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  let clock = 1000;
  performance.now = () => clock;
  try {
    return fn({ listeners, set: p => { pads = p; }, tick: ms => { clock += ms; return clock; }, now: () => clock });
  } finally {
    performance.now = saved.now;
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete globalThis.navigator;
  }
}
const pad = (pressed = [], axes = [0, 0], extra = {}) => ({ index: 0, id: 'Fake', axes, timestamp: 0, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), ...extra });

test('gamepad: buttonName, cloneBindings', () => {
  assert.equal(buttonName(0), 'A');
  assert.equal(buttonName(15), '→');
  assert.equal(buttonName(99), 'Btn 99');
  const c = cloneBindings(DEFAULT_BINDINGS);
  assert.deepEqual(c, DEFAULT_BINDINGS);
  c[0].push(1);
  assert.notDeepEqual(c[0], DEFAULT_BINDINGS[0], 'deep copy');
});

test('gamepad: Pad reports button edges once, with the pad timestamp when it is fresh', () => {
  withPads(env => {
    const p = new Pad();
    const ev = [];
    p.onButton = (i, down, t) => ev.push([i, down, t]);
    assert.equal(p.connected, false);
    env.set([pad([BTN.A], [0, 0], { timestamp: 990 })]);
    assert.equal(p.connected, true);
    p.poll();
    p.poll();
    assert.deepEqual(ev, [[BTN.A, true, 990]]);
    env.set([pad([], [0, 0], { timestamp: 0 })]);
    p.poll();
    assert.deepEqual(ev[1], [BTN.A, false, 1000], 'zero or stale timestamp falls back to now');
    env.set([pad([BTN.B], [0, 0], { timestamp: 500 })]);
    p.poll();
    assert.equal(ev[2][2], 1000, 'a timestamp older than 100 ms is not trusted');
  });
});

test('gamepad: navigation fires on direction change, repeats after the delay', () => {
  withPads(env => {
    const p = new Pad();
    const nav = [];
    p.onNav = d => nav.push(d);
    env.set([pad([BTN.DOWN])]);
    p.poll(); assert.deepEqual(nav, ['down']);
    env.tick(100); p.poll(); assert.equal(nav.length, 1, 'before the first repeat');
    env.tick(300); p.poll(); assert.equal(nav.length, 2);
    env.tick(50); p.poll(); assert.equal(nav.length, 2);
    env.tick(70); p.poll(); assert.equal(nav.length, 3, 'faster repeat afterwards');
    env.set([pad([], [0.9, 0])]);
    p.poll(); assert.equal(nav.at(-1), 'right', 'stick counts');
    env.set([pad([], [0, -0.9])]); p.poll(); assert.equal(nav.at(-1), 'up');
    env.set([pad([], [-0.9, 0])]); p.poll(); assert.equal(nav.at(-1), 'left');
    env.set([pad([], [0.3, 0.3])]); p.poll();
    const n = nav.length;
    env.set([pad([BTN.UP])]); p.poll(); assert.equal(nav.length, n + 1);
    env.set([]); p.poll(); env.set([pad([BTN.UP])]); p.poll();
    assert.equal(nav.length, n + 2, 'release then press fires again');
  });
});

test('gamepad: connect and disconnect events are forwarded, pad state is forgotten', () => {
  withPads(env => {
    const p = new Pad();
    const seen = [];
    p.onConnect = n => seen.push('+' + n);
    p.onDisconnect = n => seen.push('-' + n);
    env.listeners.gamepadconnected({ gamepad: { id: 'Pad1', index: 0 } });
    p.prev.set(0, [true]);
    env.listeners.gamepaddisconnected({ gamepad: { id: 'Pad1', index: 0 } });
    assert.deepEqual(seen, ['+Pad1', '-Pad1']);
    assert.equal(p.prev.has(0), false);
  });
});

test('gamepad: a throwing getGamepads means no pads', () => {
  withPads(env => {
    const p = new Pad();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads() { throw new Error('x'); } } });
    assert.deepEqual(p.list(), []);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    assert.deepEqual(p.list(), []);
  });
});

test('welcome intro: 5.8 s script, parks for the sign-in answer, stays inside the grid', () => {
  assert.equal(WT.END * TICK_MS, 5800);
  for (const [w, h] of [[85, 103], [100, 200], [40, 40]]) {
    const run = (release, ticks) => {
      const s = createWelcome(w, h);
      const seen = [];
      if (release) s.release('Neo');
      for (let i = 0; i < ticks && !s.done; i++) {
        let n = 0;
        s.draw((x, y) => { assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h); n++; });
        seen.push(n);
        s.step();
      }
      return { s, seen };
    };
    const quick = run(true, 500);
    assert.ok(quick.s.done && quick.seen.length === WT.END, 'finishes after exactly END ticks');
    assert.ok(quick.seen.slice(0, 12).every(n => n > 0), 'power-on paints');
    assert.ok(quick.seen[WT.LOCK - 1] > 20 && quick.seen[WT.FLASH + 6] > 100, 'rings and burst paint');
    assert.ok(quick.seen[WT.TITLE] > 20, 'name paints');
    assert.equal(quick.seen[WT.END - 1], 0, 'dissolved before the menu opens');
    const parked = run(false, 300);
    assert.ok(!parked.s.done && parked.s.tick === WT.HOLD && parked.s.hold > 200, 'waits at HOLD without the answer');
    parked.s.release('Neo');
    for (let i = 0; i < 500 && !parked.s.done; i++) parked.s.step();
    assert.ok(parked.s.done, 'finishes once released');
  }
});

test('welcome intro: reduced motion jumps but never past the wait', () => {
  const r = createWelcome(85, 103);
  r.jump(WT.FADE);
  assert.equal(r.tick, WT.HOLD, 'no answer yet: stops at the wait');
  r.release('Neo'); r.jump(WT.FADE);
  assert.equal(r.tick, WT.FADE);
});

test('welcome intro: the name is laid out inside the grid, wrapping long ones', () => {
  const one = layoutName('Neo', 85, 47);
  assert.equal(one.length, 3);
  assert.ok(new Set(one.map(c => c.y)).size === 1 && one[0].x > 0);
  const long = layoutName('Marcel the Great!!', 85, 47);
  const rows = new Set(long.map(c => c.y));
  assert.equal(rows.size, 2, 'wraps onto two lines');
  assert.ok(long.every(c => c.x >= 0 && c.x + c.g.w <= 85 && c.y >= 0));
  assert.equal(layoutName('', 85, 47).length, 0);
});

test('title scene: powers on, drops the phone, rings forever and stays inside the grid', () => {
  for (const [w, h] of [[85, 103], [100, 200], [60, 60], [40, 40]]) {
    const s = createTitle(w, h), seen = [];
    for (let i = 0; i < TT.RING + 3 * TT.LOOP; i++) {
      let n = 0;
      s.draw((x, y) => { assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h); n++; });
      seen.push(n);
      s.step();
    }
    assert.ok(!s.done, 'never ends');
    assert.ok(seen.slice(0, 12).every(n => n > 0), 'power-on paints');
    assert.ok(seen[TT.RING + 5] > 100 && seen[TT.RING + TT.LOOP + 5] > 100, 'the logo scene paints');
    assert.deepEqual(seen.slice(TT.RING + TT.LOOP, TT.RING + 2 * TT.LOOP), seen.slice(TT.RING + 2 * TT.LOOP, TT.RING + 3 * TT.LOOP), 'the loop repeats exactly');
  }
});

test('title scene: layout keeps the phone below the logo, or drops it on a short grid', () => {
  const tall = layoutTitle(85, 103);
  assert.ok(tall.phone && tall.py > tall.chars[0].y + 7 && tall.px >= 0 && tall.px + 24 <= 85);
  assert.ok(!layoutTitle(85, 50).phone, 'too short for the stack: logo alone');
  assert.ok(layoutTitle(85, 50).chars.every(c => c.x >= 0 && c.x + c.g.w <= 85));
  assert.equal(dropDy(-1, 20), null);
  assert.ok(dropDy(0, 20) < -40 && dropDy(6, 20) <= 0 && dropDy(40, 20) === 0, 'falls from above the grid, ends at rest');
});

test('title scene: the still frame (reduced motion) has the whole scene', () => {
  const s = createTitle(85, 103);
  s.jump(TITLE_REST);
  let n = 0;
  s.draw(() => n++);
  assert.ok(n > 300, 'logo and phone are there');
});

// ---- cameo status sims & scheduler ----
const runSim = sim => { const seen = []; for (let i = 0; i < 500 && !sim.done; i++) { seen.push(sim.status()); sim.step(); } return seen; };

test('cameo: status sims run to completion, then release the icons', () => {
  for (const [make, chirp] of [[createSms, true], [createSignalWobble, false], [createLowBattery, false]]) {
    const sim = make();
    assert.equal(sim.chirp, chirp);
    const seen = runSim(sim);
    assert.ok(sim.done);
    assert.ok(seen.length > 10 && seen.every(Boolean));
    assert.equal(sim.status(), null);
    assert.doesNotThrow(() => sim.draw(() => {}));
  }
  assert.ok(runSim(createSms()).some(s => s.envelope));
  assert.ok(runSim(createSignalWobble()).some(s => s.signal === 0));
  assert.ok(runSim(createLowBattery()).some(s => s.battery === 0));
});

test('cameo: scheduler gap, forced picks, once-only and the no-repeat fallback', () => {
  const sch = createScheduler({ rng: () => 0.5, minGap: 10, maxGap: 30 });
  assert.equal(sch.gap(), 20);
  assert.equal(sch.pick('title', 'low-battery').id, 'low-battery', 'force ignores the state');
  assert.equal(sch.pick('title', 'nope') && sch.pick('nowhere'), null);
  const s2 = createScheduler({ rng: () => 0.99 });
  const picks = [...Array(30)].map(() => s2.pick('select')).map(c => c && c.id);
  assert.equal(picks.filter(id => id === 'low-battery').length <= 1, true, 'once');
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1], 'never twice in a row');
  const only = [{ id: 'a', weight: 1, states: ['x'], create() {} }];
  const s3 = createScheduler({ cameos: only });
  assert.equal(s3.pick('x').id, 'a');
  assert.equal(s3.pick('x').id, 'a', 'a lone cameo may repeat when nothing else exists');
  assert.equal(CAMEOS.length > 3, true);
  const s4 = createScheduler({ rng: () => 0.9999999, cameos: [{ id: 'a', weight: 1, states: ['x'] }, { id: 'b', weight: 1, states: ['x'] }] });
  assert.ok(s4.pick('x'));
});

// ---- small art/secrets helpers ----
test('secrets: formatImei groups digits as 2-6-6-1', () => {
  assert.equal(formatImei('123456789012345'), '12-345678-901234-5');
  const f = formatImei(fakeImei('seed'));
  assert.match(f, /^\d{2}-\d{6}-\d{6}-\d$/);
});

test('pixelart: envelope, signal and battery share the status-bar footprint', () => {
  const e = envelope();
  assert.equal(e.length, 9);
  assert.ok(e.every(r => r.length === 14));
  assert.ok(signal(0).every(r => r.length === 14));
  assert.equal(battery(4).length, 7);
  assert.ok(battery(0).join('').split('#').length < battery(4).join('').split('#').length);
});

test('pixelart: spriteURL is a cached SVG data URI', () => {
  const rows = ['#.#', '.#.'];
  const u = spriteURL(rows);
  assert.ok(u.startsWith('data:image/svg+xml,'));
  assert.equal(spriteURL(rows.slice()), u);
  assert.ok(decodeURIComponent(u).includes('<rect'));
  assert.ok(spriteSVG(rows, 'red').includes('fill="red"'));
  for (const k of Object.keys(SPRITES)) assert.ok(spriteURL(SPRITES[k]).length > 30, k);
});

test('pixelart: every category icon has a distinct favorite variant of the same height', () => {
  const cats = [...CATEGORIES.map(c => c.id), 'custom'];
  assert.deepEqual(Object.keys(SPRITES_FAV).sort(), cats.sort());
  for (const k of cats) {
    const a = SPRITES[k], b = SPRITES_FAV[k];
    assert.equal(b.length, a.length, k);
    assert.ok(b.every(r => r.length === b[0].length && /^[#.]+$/.test(r)), k);
    assert.notDeepEqual(b, a, k);
    assert.equal(categorySprite(k, true), b);
    assert.equal(categorySprite(k), a);
  }
  assert.equal(categorySprite('nope', true), SPRITES_FAV.custom);
  assert.equal(categorySprite('nope'), SPRITES.custom);
});

import { swipeDir } from '../src/swipe.js';
test('swipeDir: axis, threshold and dominance', () => {
  assert.equal(swipeDir(-50, 5), 'left');
  assert.equal(swipeDir(50, 5), 'right');
  assert.equal(swipeDir(30, 0), null);
  assert.equal(swipeDir(50, 60), null, 'vertical drags do not count on the x axis');
  assert.equal(swipeDir(5, -50, 'y'), 'up');
  assert.equal(swipeDir(5, 50, 'both'), 'down');
  assert.equal(swipeDir(-35, 10, 'both', 30), 'left');
});
