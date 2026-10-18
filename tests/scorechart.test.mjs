import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSeries } from '../src/scorechart.js';

test('scoreSeries: density is normalised per slice, accuracy averages the weights, misses are counted', () => {
  const tl = { length: 10, noteTimes: [0.5, 0.6, 1.5, 9.5], events: [[0.5, 1], [0.6, 0], [1.5, 2 / 3], [9.5, 1]], ghosts: [4.2, 4.4] };
  const s = scoreSeries(tl, 10);
  assert.equal(s.density.length, 10);
  assert.equal(s.density[0], 1);
  assert.equal(s.density[1], 0.5);
  assert.equal(s.density[9], 0.5);
  assert.equal(s.acc[0], 50);
  assert.ok(Math.abs(s.acc[1] - 200 / 3) < 1e-9);
  assert.equal(s.acc[5], null);
  assert.deepEqual(s.miss.slice(0, 2), [1, 0]);
  assert.equal(s.ghost[4], 2);
});

test('scoreSeries: an empty or missing timeline gives empty series', () => {
  assert.deepEqual(scoreSeries(null, 4).density, [0, 0, 0, 0]);
  assert.deepEqual(scoreSeries({ length: 0 }, 4).acc, [null, null, null, null]);
});
