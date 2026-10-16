import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, gradeFor, HOLD_BONUS, HOLD_RELEASE_FORGIVE, COMBO_MULT_CAP, POINTS } from '../src/game.js';

function stubSynth() {
  const calls = { stopAll: 0, resume: 0, suspend: 0, miss: 0, released: 0, ticks: [], notes: [] };
  const ctx = { currentTime: 0, suspend() { calls.suspend++; }, resume() { calls.resume++; return Promise.resolve(); } };
  return {
    ctx, calls, ensure: () => ctx, getLatency: () => 0,
    stopAll() { calls.stopAll++; }, tick(o) { calls.ticks.push(o); },
    playNote(o) { calls.notes.push(o); return { release() { calls.released++; } }; },
    playMiss() { calls.miss++; },
  };
}
const note = (id, lane, time, extra = {}) => ({ id, lane, time, duration: 0.2, midi: 60, ...extra });
const chartOf = (notes, extra = {}) => ({
  notes, lanes: 4, bpm: 120, beatLen: 0.5, firstBeat: 0, backing: [],
  length: Math.max(...notes.map(n => n.time + n.duration)), ...extra,
});
function run(notes, opts) {
  const synth = stubSynth(), g = new Game(synth);
  g.start(chartOf(notes), { leadIn: 1, backing: false, ...opts });
  return { g, synth };
}

test('gradeFor: thresholds are inclusive at the lower bound', () => {
  const cases = [[100, 'S'], [95, 'S'], [94.99, 'A'], [90, 'A'], [89.99, 'B'], [80, 'B'], [79.99, 'C'], [70, 'C'], [69.99, 'D'], [0, 'D']];
  for (const [acc, g] of cases) assert.equal(gradeFor(acc), g, String(acc));
});

test('game: multiplier grows every 10 combo and stops at the cap', () => {
  const g = new Game(stubSynth());
  const at = c => { g.combo = c; return g.multiplier; };
  assert.equal(at(0), 1);
  assert.equal(at(9), 1);
  assert.ok(Math.abs(at(10) - 1.1) < 1e-9);
  assert.ok(Math.abs(at(COMBO_MULT_CAP) - 1.5) < 1e-9);
  assert.ok(Math.abs(at(COMBO_MULT_CAP + 500) - 1.5) < 1e-9);
});

test('game: hold released near the tail completes with the bonus', () => {
  const { g } = run([note(0, 0, 1, { isHold: true, duration: 1 })]);
  try {
    g.press(0, g.songStart + 1);
    assert.equal(g.holds[0].id, 0);
    const before = g.score;
    g.release(0, g.songStart + 2 - HOLD_RELEASE_FORGIVE + 0.01);
    assert.equal(g.score - before, 100, 'documented bonus');
    assert.equal(HOLD_BONUS, 100);
    assert.equal(g.holds[0], null);
    assert.equal(g.counts.miss, 0);
  } finally { g.stop(); }
});

test('game: hold released early breaks, counts a miss and silences the voice', () => {
  const { g, synth } = run([note(0, 0, 1, { isHold: true, duration: 1 }), note(1, 1, 3)]);
  try {
    g.press(0, g.songStart + 1);
    assert.equal(g.combo, 1);
    g.release(0, g.songStart + 1.3);
    assert.equal(g.counts.miss, 1);
    assert.equal(g.combo, 0);
    assert.equal(synth.calls.released, 1);
    assert.equal(synth.calls.miss, 1);
    assert.equal(g.holds[0], null);
    assert.equal(g.notesLeft, 1, 'the dropped hold head was already judged');
    assert.equal(g.fcAlive, false);
  } finally { g.stop(); }
});

test('game: hold released exactly at the forgiveness boundary still completes', () => {
  const { g } = run([note(0, 0, 1, { isHold: true, duration: 1 })]);
  try {
    g.press(0, g.songStart + 1);
    g.release(0, g.songStart + 2 - HOLD_RELEASE_FORGIVE);
    assert.equal(g.counts.miss, 0);
    assert.equal(g.holds[0], null);
  } finally { g.stop(); }
});

test('game: a hold still held at its end completes in update()', () => {
  const { g } = run([note(0, 0, 1, { isHold: true, duration: 1 })]);
  try {
    g.press(0, g.songStart + 1);
    const before = g.score;
    g.update(2.01);
    assert.equal(g.score - before, HOLD_BONUS);
    assert.equal(g.holds[0], null);
  } finally { g.stop(); }
});

test('game: hold bonus is scaled by the multiplier', () => {
  const { g } = run([note(0, 0, 1, { isHold: true, duration: 1 })]);
  try {
    g.press(0, g.songStart + 1);
    g.combo = 20; // multiplier 1.2
    const before = g.score;
    g.release(0, g.songStart + 2);
    assert.equal(g.score - before, Math.round(HOLD_BONUS * 1.2));
  } finally { g.stop(); }
});

test('game: release with no active hold does nothing', () => {
  const { g: g2 } = run([note(0, 0, 1)]);
  try {
    assert.doesNotThrow(() => g2.release(0, g2.songStart + 1));
    assert.equal(g2.score, 0);
  } finally { g2.stop(); }
});

test('game: pause suspends the clock and stops the scheduler; presses are ignored while paused', () => {
  const { g, synth } = run([note(0, 0, 1)]);
  try {
    g.pause();
    assert.equal(g.state, 'paused');
    assert.equal(synth.calls.suspend, 1);
    g.press(0, g.songStart + 1);
    assert.equal(g.judgedCount, 0);
    g.update(5);
    assert.equal(g.counts.miss, 0, 'update is a no-op while paused');
    g.pause();
    assert.equal(synth.calls.suspend, 1, 'second pause is ignored');
  } finally { g.stop(); }
});

test('game: resume restarts play and replays releases made during the pause', async () => {
  const { g, synth } = run([note(0, 0, 1, { isHold: true, duration: 1 })]);
  try {
    g.press(0, g.songStart + 1);
    g.pause();
    g.release(0, g.songStart + 2); // arrives while paused
    assert.equal(g.pendingRelease[0], true);
    assert.ok(g.holds[0], 'still held until resume');
    synth.ctx.currentTime = g.songStart + 2; // the clock is where the release happened
    await g.resume();
    assert.equal(g.state, 'running');
    assert.equal(g.pendingRelease[0], false);
    assert.equal(g.holds[0], null);
    assert.equal(g.counts.miss, 0);
    assert.equal(synth.calls.resume, 1);
    await g.resume();
    assert.equal(synth.calls.resume, 1, 'resume while running is ignored');
  } finally { g.stop(); }
});

test('game: stop while paused resumes the audio context and goes idle', () => {
  const { g, synth } = run([note(0, 0, 1)]);
  g.pause();
  g.stop();
  assert.equal(g.state, 'idle');
  assert.equal(g.active, false);
  assert.equal(synth.calls.resume, 1);
  assert.ok(synth.calls.stopAll >= 1);
});

test('game: results report failed=false normally and failed=true after sudden death', () => {
  const { g } = run([note(0, 0, 1), note(1, 1, 2)], { suddenDeath: true });
  try {
    let res = null;
    g.onFinish = r => { res = r; };
    g.update(1.5); // first note missed
    assert.equal(g.failed, true);
    assert.equal(res.failed, true);
    assert.equal(res.fc, false);
  } finally { g.stop(); }
  const { g: ok } = run([note(0, 0, 1)]);
  try {
    ok.press(0, ok.songStart + 1);
    assert.equal(ok.results().failed, false);
    assert.equal(ok.results().fc, true);
    assert.equal(ok.results().ap, true);
  } finally { ok.stop(); }
});

test('game: judgement boundaries (perfect / great / good / miss) and points', () => {
  const { g } = run([note(0, 0, 1), note(1, 1, 2), note(2, 2, 3), note(3, 3, 4)]);
  try {
    g.press(0, g.songStart + 1.04);
    g.press(1, g.songStart + 2.08);
    g.press(2, g.songStart + 3.13);
    g.press(3, g.songStart + 4.2);
    assert.deepEqual([g.counts.perfect, g.counts.great, g.counts.good], [1, 1, 1]);
    assert.equal(g.notesLeft, 1);
    assert.equal(g.strays, 1, 'press outside every window is a stray');
    assert.ok(g.score >= POINTS.perfect + POINTS.great + POINTS.good);
  } finally { g.stop(); }
});

test('game: calibration shifts judging time, latency shifts songTime', () => {
  const { g } = run([note(0, 0, 1)], { calibration: 0.1 });
  try {
    g.press(0, g.songStart + 1.1);
    assert.equal(g.counts.perfect, 1);
    assert.ok(Math.abs(g.deltas[0]) < 1e-9);
    g.synth.ctx.currentTime = g.songStart + 1;
    assert.ok(Math.abs(g.songTime() - 0.9) < 1e-9);
  } finally { g.stop(); }
});

test('game: scheduler ticks the backing pulse only when enabled, and plays backing notes', () => {
  const synth = stubSynth(), g = new Game(synth);
  const chart = chartOf([note(0, 0, 1)], { backing: [{ time: 0.05, midi: 70, duration: 0.2 }] });
  g.start(chart, { leadIn: 0.2, backing: true });
  try {
    synth.ctx.currentTime = 0.2;
    g._schedule();
    assert.ok(synth.calls.ticks.length > 0);
    assert.equal(synth.calls.notes.length, 1, 'backing note');
    assert.equal(synth.calls.notes[0].midi, 70);
    g._schedule();
    assert.equal(synth.calls.notes.length, 1, 'backing note is not replayed');
    assert.ok(synth.calls.ticks.some(t => t.accent));
    assert.equal(synth.calls.ticks.length, new Set(synth.calls.ticks.map(t => t.when)).size, 'no tick scheduled twice');
  } finally { g.stop(); }
  const quiet = stubSynth(), q = new Game(quiet);
  q.start(chart, { leadIn: 0.2, backing: false });
  try {
    quiet.ctx.currentTime = 0.2;
    q._schedule();
    assert.equal(quiet.calls.ticks.length, 0);
    assert.equal(quiet.calls.notes.length, 1, 'backing notes play regardless of the pulse');
  } finally { q.stop(); }
});

test('game: restarting resets per-run state', () => {
  const { g } = run([note(0, 0, 1)]);
  try {
    g.press(0, g.songStart + 1);
    assert.equal(g.score > 0, true);
    g.start(chartOf([note(0, 0, 1)]), { leadIn: 1, backing: false });
    assert.deepEqual([g.score, g.combo, g.judgedCount, g.strays, g.failed], [0, 0, 0, 0, false]);
    assert.equal(g.accuracy, 100);
    assert.equal(g.fcAlive, false, 'nothing judged yet');
  } finally { g.stop(); }
});

test('game: rollAudio plays the roll as written from the first press; mashing only scores', () => {
  const ticks = [0, 0.1, 0.2, 0.3, 0.4];
  const roll = () => note(0, 0, 1, { isRoll: true, ticks, tickDur: 0.08, goal: 5, duration: 0.45 });
  const mash = opts => {
    const { g, synth } = run([roll()], opts);
    g.synth.ctx.currentTime = g.songStart + 1;
    for (let i = 0; i < 5; i++) g.press(0, g.songStart + 1 + i * 0.05);
    for (let t = 1; t <= 1.5; t += 0.05) { g.synth.ctx.currentTime = g.songStart + t; g._schedule(); }
    const out = { score: g.score, notes: synth.calls.notes.length, n: g.chart.notes[0] };
    g.stop();
    return out;
  };
  const off = mash({}), on = mash({ rollAudio: true });
  assert.equal(off.notes, 5, 'one blip per press');
  assert.equal(on.notes, ticks.length, 'one note per roll tick, regardless of presses');
  assert.equal(on.score, off.score, 'scoring is unaffected');
});
