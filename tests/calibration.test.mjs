import test from 'node:test';
import assert from 'node:assert/strict';
import { Calibration } from '../src/calibration.js';

function stubSynth() {
  const s = {
    ctx: { currentTime: 10 },
    latency: 0,
    ticks: [],
    stopped: 0,
    ensure() { return s.ctx; },
    stopAll() { s.stopped++; },
    tick(o) { s.ticks.push(o); },
    getLatency() { return s.latency; },
  };
  return s;
}
const started = () => { const s = stubSynth(), c = new Calibration(s); c.start(); return { s, c }; };
const tapAll = (c, offs) => offs.forEach((o, i) => c.recordTap(c.tickTimes[i] + o));

test('calibration: start schedules 12 ticks at 90 BPM with accents every fourth', () => {
  const { s, c } = started();
  assert.equal(s.stopped, 1);
  assert.equal(s.ticks.length, 12);
  assert.equal(c.beatsTotal, 12);
  assert.deepEqual(s.ticks.map(t => t.accent), [...Array(12)].map((_, i) => i % 4 === 0));
  assert.ok(Math.abs(c.tickTimes[0] - 11.2) < 1e-9);
  assert.ok(Math.abs(c.tickTimes[1] - c.tickTimes[0] - 60 / 90) < 1e-9);
  assert.ok(c.running);
});

test('calibration: result is the median offset (odd and even counts)', () => {
  let { c } = started();
  tapAll(c, [0.05, 0.01, 0.03, 0.02, 0.04]);
  assert.ok(Math.abs(c.result() - 0.03) < 1e-9);
  ({ c } = started());
  tapAll(c, [0.01, 0.02, 0.03, 0.04]);
  assert.ok(Math.abs(c.result() - 0.025) < 1e-9);
});

test('calibration: negative offsets (early taps) are kept', () => {
  const { c } = started();
  tapAll(c, [-0.04, -0.05, -0.06, -0.03]);
  assert.ok(c.result() < 0);
});

test('calibration: taps further than 0.25 s from any tick are outliers', () => {
  const { c } = started();
  tapAll(c, [0.02, 0.02, 0.02, 0.02]);
  c.recordTap(c.tickTimes[5] + 0.3);
  c.recordTap(c.tickTimes[6] - 0.3);
  assert.ok(Math.abs(c.result() - 0.02) < 1e-9);
  const { c: d } = started();
  tapAll(d, [0.25, 0.25, 0.25, 0.25]);
  assert.ok(d.result() !== null, '0.25 is still inside');
});

test('calibration: fewer than 4 usable taps gives null', () => {
  const { c } = started();
  tapAll(c, [0.02, 0.02, 0.02]);
  c.recordTap(c.tickTimes[0] + 0.33); // midway between ticks
  assert.equal(c.result(), null);
  assert.equal(started().c.result(), null);
});

test('calibration: taps are only recorded while running, reset clears everything', () => {
  const c = new Calibration(stubSynth());
  c.recordTap(5);
  assert.deepEqual(c.taps, []);
  const { c: d } = started();
  d.recordTap(12);
  assert.equal(d.taps.length, 1);
  d.reset();
  assert.deepEqual([d.taps, d.tickTimes, d.running], [[], [], false]);
});

test('calibration: finished 0.6 s after the last tick', () => {
  const { s, c } = started();
  assert.equal(c.finished, false);
  s.ctx.currentTime = c.tickTimes[11] + 0.5;
  assert.equal(c.finished, false);
  s.ctx.currentTime = c.tickTimes[11] + 0.61;
  assert.equal(c.finished, true);
  assert.equal(new Calibration(stubSynth()).finished, false);
});

test('calibration: pulse peaks on a tick, decays over 0.25 s and accounts for latency', () => {
  const { s, c } = started();
  assert.equal(new Calibration(stubSynth()).pulse(), 0);
  s.ctx.currentTime = 10.5; // before the first tick
  assert.equal(c.pulse(), 0);
  s.ctx.currentTime = c.tickTimes[0];
  assert.equal(c.pulse(), 1);
  s.ctx.currentTime = c.tickTimes[0] + 0.125;
  assert.ok(Math.abs(c.pulse() - 0.5) < 1e-9);
  s.ctx.currentTime = c.tickTimes[0] + 0.3;
  assert.equal(c.pulse(), 0);
  s.ctx.currentTime = c.tickTimes[0] + 0.1;
  s.latency = 0.1;
  assert.equal(c.pulse(), 1, 'output latency shifts the heard time');
});
